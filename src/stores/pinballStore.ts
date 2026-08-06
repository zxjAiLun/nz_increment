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
    const saved = localStorage.getItem(PINBALL_KEY)
    if (!saved) return
    const data = JSON.parse(saved) as PinballState
    state.tokens = data.tokens || 0
    state.plays = data.plays || []
    state.conversions = data.conversions || []
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
