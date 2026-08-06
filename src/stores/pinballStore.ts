import { defineStore } from 'pinia'
import { computed, reactive } from 'vue'
import { PERMANENT_POOL_ID } from '../data/gachaPools'
import {
  PINBALL_MAX_CONVERT_TOKENS,
  PINBALL_SCORE_BANDS,
  PINBALL_TOKEN_TO_RARE_PLUS,
  type PinballScoreBand
} from '../data/pinball'
import type { ChanceGameOutcome } from '../systems/probability/chanceGame'
import { SeededRng } from '../systems/probability/rewardResolver'
import { useProbabilityStore } from './probabilityStore'

const PINBALL_KEY = 'nz_pinball_v1'
const PROBABILITY_KEY = 'nz_probability_v1'

interface PinballPlayRecord {
  timestamp: number
  score: number
  tokensGained: number
  rolls: number[]
  scoreBand: PinballScoreBand
}

interface PinballConversionRecord {
  timestamp: number
  poolId: string
  tokensSpent: number
  rarePlusBonus: number
}

interface PinballState {
  tokens: number
  plays: PinballPlayRecord[]
  conversions: PinballConversionRecord[]
}

// Phase 3.71：nz_pinball_v1 安全 hydration 专用 fail-closed 规范化 helper。
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function normalizeTokens(value: unknown): number {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? (value as number) : 0
}

/** 仅保留可经 canonical scoreBand 重建的 play record。 */
function normalizePlayRecord(value: unknown): PinballPlayRecord | null {
  if (!isPlainObject(value)) return null
  if (!Number.isSafeInteger(value.timestamp) || (value.timestamp as number) <= 0) return null
  if (typeof value.score !== 'number' || !Number.isFinite(value.score) || !Number.isInteger(value.score) || value.score < 0) return null
  if (!Number.isSafeInteger(value.tokensGained) || (value.tokensGained as number) < 0) return null
  if (!Array.isArray(value.rolls) || value.rolls.length !== 3) return null
  for (const roll of value.rolls) {
    if (typeof roll !== 'number' || !Number.isFinite(roll) || roll < 0 || roll > 1) return null
  }
  const scoreBandValue = value.scoreBand
  if (!isPlainObject(scoreBandValue)) return null
  if (typeof scoreBandValue.id !== 'string') return null
  const band = PINBALL_SCORE_BANDS.find(b => b.id === scoreBandValue.id)
  if (!band) return null
  return {
    timestamp: value.timestamp as number,
    score: value.score as number,
    tokensGained: value.tokensGained as number,
    rolls: value.rolls as number[],
    scoreBand: band // 用当前 canonical band 重建，不信任 raw 副本
  }
}

function normalizePlays(value: unknown): PinballPlayRecord[] {
  if (!Array.isArray(value)) return []
  const result: PinballPlayRecord[] = []
  for (const entry of value) {
    if (result.length >= 20) break
    const normalized = normalizePlayRecord(entry)
    if (normalized) result.push(normalized)
  }
  return result
}

/** 仅保留符合当前兑换合同（rarePlusBonus = tokensSpent × TOKEN_TO_RARE_PLUS）的 conversion record。 */
function normalizeConversionRecord(value: unknown): PinballConversionRecord | null {
  if (!isPlainObject(value)) return null
  if (!Number.isSafeInteger(value.timestamp) || (value.timestamp as number) <= 0) return null
  if (typeof value.poolId !== 'string' || value.poolId === '') return null
  if (!Number.isSafeInteger(value.tokensSpent) || (value.tokensSpent as number) < 1 || (value.tokensSpent as number) > PINBALL_MAX_CONVERT_TOKENS) return null
  if (typeof value.rarePlusBonus !== 'number' || !Number.isFinite(value.rarePlusBonus) || value.rarePlusBonus < 0) return null
  if (value.rarePlusBonus !== (value.tokensSpent as number) * PINBALL_TOKEN_TO_RARE_PLUS) return null
  return {
    timestamp: value.timestamp as number,
    poolId: value.poolId as string,
    tokensSpent: value.tokensSpent as number,
    rarePlusBonus: value.rarePlusBonus as number
  }
}

function normalizeConversions(value: unknown): PinballConversionRecord[] {
  if (!Array.isArray(value)) return []
  const result: PinballConversionRecord[] = []
  for (const entry of value) {
    if (result.length >= 20) break
    const normalized = normalizeConversionRecord(entry)
    if (normalized) result.push(normalized)
  }
  return result
}

function getScoreBand(score: number): PinballScoreBand {
  return [...PINBALL_SCORE_BANDS]
    .sort((a, b) => b.minScore - a.minScore)
    .find(band => score >= band.minScore) ?? PINBALL_SCORE_BANDS[0]
}

function calculateScore(rolls: number[]): number {
  const base = rolls.reduce((sum, roll, index) => sum + Math.floor(roll * 120) + 35 + index * 10, 0)
  const comboBonus = rolls.filter(roll => roll >= 0.72).length * 40
  return base + comboBonus
}

export const usePinballStore = defineStore('pinball', () => {
  const state = reactive<PinballState>({
    tokens: 0,
    plays: [],
    conversions: []
  })

  const nextRarePlusBonus = computed(() => Math.min(state.tokens, PINBALL_MAX_CONVERT_TOKENS) * PINBALL_TOKEN_TO_RARE_PLUS)

  function load() {
    let candidate = {
      tokens: 0,
      plays: [] as PinballPlayRecord[],
      conversions: [] as PinballConversionRecord[]
    }
    try {
      const saved = localStorage.getItem(PINBALL_KEY)
      if (saved) {
        const parsed: unknown = JSON.parse(saved)
        if (isPlainObject(parsed)) {
          candidate = {
            tokens: normalizeTokens(parsed.tokens),
            plays: normalizePlays(parsed.plays),
            conversions: normalizeConversions(parsed.conversions)
          }
        }
      }
    } catch {
      // getItem / JSON.parse / normalization 异常 → 保持默认 candidate
    }
    // Phase 3.71：全部规范化完成后一次性提交，杜绝部分水合；不写盘、不删除原 raw。
    state.tokens = candidate.tokens
    state.plays = candidate.plays
    state.conversions = candidate.conversions
  }

  function save() {
    localStorage.setItem(PINBALL_KEY, JSON.stringify(state))
  }

  function playEvent(options: { seed?: number; rng?: () => number; now?: number } = {}): PinballPlayRecord | null {
    const probabilityStore = useProbabilityStore()

    // Phase 3.70：单次时间戳候选（options.now 优先，否则仅一次 Date.now；正安全整数校验）。
    const transactionTimestamp = options.now ?? Date.now()
    if (!Number.isSafeInteger(transactionTimestamp) || transactionTimestamp <= 0) return null

    // RNG / rolls / score / band 候选（时间源或任意一次 RNG 抛错 → 零副作用上送）。
    const seeded = options.seed !== undefined ? new SeededRng(options.seed) : null
    const rng = options.rng ?? seeded?.fn() ?? Math.random
    const rolls = [rng(), rng(), rng()]
    const score = calculateScore(rolls)
    const scoreBand = getScoreBand(score)
    const tokensGained = scoreBand.tokens
    const outcome: ChanceGameOutcome = {
      gameId: 'pinball',
      seed: String(options.seed ?? transactionTimestamp),
      source: 'pinball',
      label: scoreBand.name,
      route: rolls.map((roll, index) => `bumper${index + 1}:${roll.toFixed(4)}`),
      score,
      tokens: tokensGained,
      expectedValueCost: tokensGained
    }

    const record: PinballPlayRecord = {
      timestamp: transactionTimestamp,
      score,
      tokensGained,
      rolls,
      scoreBand
    }

    // 事务前内存快照（深拷贝，供完整回滚）。
    const prevOutcomes = [...probabilityStore.state.outcomes]
    const prevBudgetUsage = JSON.parse(JSON.stringify(probabilityStore.state.budgetUsage)) as typeof probabilityStore.state.budgetUsage
    const prevPendingModifiers = [...probabilityStore.state.pendingModifiers]
    const prevTokens = state.tokens
    const prevPlays = [...state.plays]

    // 旧 raw 快照（getItem 抛错 → 普通 null，零 mutation）。
    let prevProbabilityRaw: string | null
    try {
      prevProbabilityRaw = localStorage.getItem(PROBABILITY_KEY)
      localStorage.getItem(PINBALL_KEY)
    } catch {
      return null
    }

    function rollbackMemory() {
      probabilityStore.state.outcomes = prevOutcomes
      probabilityStore.state.budgetUsage = prevBudgetUsage
      probabilityStore.state.pendingModifiers = prevPendingModifiers
      state.tokens = prevTokens
      state.plays = prevPlays
    }

    // 逆序补偿已写入 key；全部尝试并收集失败，不因第一个错误跳过后续补偿。
    function compensateRaws(raws: { key: string; previous: string | null }[]): unknown[] {
      const failures: unknown[] = []
      for (let i = raws.length - 1; i >= 0; i--) {
        const { key, previous } = raws[i]
        try {
          if (previous === null) localStorage.removeItem(key)
          else localStorage.setItem(key, previous)
        } catch (error) {
          failures.push(error)
        }
      }
      return failures
    }

    // 失败收口：内存回滚 → 逆序补偿已写入 key → 补偿失败抛固定分类错误。
    function finalizeFailure(writtenRaws: { key: string; previous: string | null }[]): null {
      rollbackMemory()
      const failures = compensateRaws(writtenRaws)
      if (failures.length > 0) {
        throw new Error('pinball play persistence rollback failed')
      }
      return null
    }

    const probabilityRaw = { key: PROBABILITY_KEY, previous: prevProbabilityRaw }

    // 内存提交：Probability 无写盘 outcome（预算拒绝 → 五类内存状态完全不变）。
    if (!probabilityStore.applyChanceOutcomeInMemory(outcome, transactionTimestamp)) {
      return null
    }
    state.tokens += tokensGained
    state.plays.unshift(record)
    if (state.plays.length > 20) state.plays.pop()

    // 固定持久化顺序：Probability → Pinball。
    try {
      probabilityStore.saveProbabilityData()
    } catch {
      return finalizeFailure([])
    }
    try {
      save()
    } catch {
      return finalizeFailure([probabilityRaw])
    }

    return record
  }

  function convertTokensToModifier(poolId: string = PERMANENT_POOL_ID, tokens: number = Math.min(state.tokens, PINBALL_MAX_CONVERT_TOKENS), options: { now?: number } = {}): PinballConversionRecord | null {
    // tokensSpent 候选：保持原 floor/clamp 语义；无可兑换 token 时零时间/storage 访问。
    const tokensSpent = Math.min(Math.max(0, Math.floor(tokens)), state.tokens, PINBALL_MAX_CONVERT_TOKENS)
    if (tokensSpent <= 0) return null

    // Phase 3.69：单次时间戳候选（options.now 优先，否则仅一次 Date.now；正安全整数校验）。
    const transactionTimestamp = options.now ?? Date.now()
    if (!Number.isSafeInteger(transactionTimestamp) || transactionTimestamp <= 0) return null

    const probabilityStore = useProbabilityStore()
    const rarePlusBonus = tokensSpent * PINBALL_TOKEN_TO_RARE_PLUS
    const record: PinballConversionRecord = {
      timestamp: transactionTimestamp,
      poolId,
      tokensSpent,
      rarePlusBonus
    }
    const outcome: ChanceGameOutcome = {
      gameId: 'pinball',
      seed: String(transactionTimestamp),
      source: 'pinball',
      label: `弹球 token 兑换 rare+ +${rarePlusBonus}%`,
      tokens: tokensSpent, // 信息字段；phase364 hydration 要求非负（原 -tokensSpent 无消费行为，仅信息）
      expectedValueCost: rarePlusBonus,
      modifier: {
        id: `pinball_event_modifier:${transactionTimestamp}:${tokensSpent}`,
        source: 'pinball',
        label: `弹球活动 rare+ +${rarePlusBonus}%`,
        poolId,
        appliesTo: 'anyPull',
        appliesToCost: 'paidOnly',
        rarePlusBonus
      }
    }

    // 事务前内存快照（深拷贝，供完整回滚）。
    const prevOutcomes = [...probabilityStore.state.outcomes]
    const prevBudgetUsage = JSON.parse(JSON.stringify(probabilityStore.state.budgetUsage)) as typeof probabilityStore.state.budgetUsage
    const prevPendingModifiers = [...probabilityStore.state.pendingModifiers]
    const prevTokens = state.tokens
    const prevConversions = [...state.conversions]

    // 旧 raw 快照（getItem 抛错 → 普通 null，零 mutation）。
    let prevProbabilityRaw: string | null
    try {
      prevProbabilityRaw = localStorage.getItem(PROBABILITY_KEY)
      localStorage.getItem(PINBALL_KEY)
    } catch {
      return null
    }

    function rollbackMemory() {
      probabilityStore.state.outcomes = prevOutcomes
      probabilityStore.state.budgetUsage = prevBudgetUsage
      probabilityStore.state.pendingModifiers = prevPendingModifiers
      state.tokens = prevTokens
      state.conversions = prevConversions
    }

    // 逆序补偿已写入 key；全部尝试并收集失败，不因第一个错误跳过后续补偿。
    function compensateRaws(raws: { key: string; previous: string | null }[]): unknown[] {
      const failures: unknown[] = []
      for (let i = raws.length - 1; i >= 0; i--) {
        const { key, previous } = raws[i]
        try {
          if (previous === null) localStorage.removeItem(key)
          else localStorage.setItem(key, previous)
        } catch (error) {
          failures.push(error)
        }
      }
      return failures
    }

    // 失败收口：内存回滚 → 逆序补偿已写入 key → 补偿失败抛固定分类错误。
    function finalizeFailure(writtenRaws: { key: string; previous: string | null }[]): null {
      rollbackMemory()
      const failures = compensateRaws(writtenRaws)
      if (failures.length > 0) {
        throw new Error('pinball conversion persistence rollback failed')
      }
      return null
    }

    const probabilityRaw = { key: PROBABILITY_KEY, previous: prevProbabilityRaw }

    // 内存提交：Probability 无写盘 outcome（预算拒绝 → 五类内存状态完全不变）。
    if (!probabilityStore.applyChanceOutcomeInMemory(outcome, transactionTimestamp)) {
      return null
    }
    state.tokens -= tokensSpent
    state.conversions.unshift(record)
    if (state.conversions.length > 20) state.conversions.pop()

    // 固定持久化顺序：Probability → Pinball。
    try {
      probabilityStore.saveProbabilityData()
    } catch {
      return finalizeFailure([])
    }
    try {
      save()
    } catch {
      return finalizeFailure([probabilityRaw])
    }

    return record
  }

  load()

  return {
    state,
    nextRarePlusBonus,
    playEvent,
    convertTokensToModifier
  }
})
