import { defineStore } from 'pinia'
import { reactive } from 'vue'
import { PERMANENT_POOL_ID, GACHA_POOLS } from '../data/gachaPools'
import { LUCKY_WHEEL_RATES, LUCKY_WHEEL_REWARDS, type LuckyWheelReward } from '../data/luckyWheel'
import { RewardResolver, SeededRng, type ProbabilityAudit } from '../systems/probability/probability'
import type { BuildTarget } from '../types/navigation'
import type { StatType } from '../types'
import type { ChanceGameOutcome } from '../systems/probability/chanceGame'
import { useGachaStore } from './gachaStore'
import { usePlayerStore } from './playerStore'
import { useProbabilityStore } from './probabilityStore'

const LUCKY_WHEEL_KEY = 'nz_lucky_wheel_v1'
const GACHA_KEY = 'nz_gacha_v1'
const PROBABILITY_KEY = 'nz_probability_v1'
const BUILD_TOKEN_FOCUS_DURATION_SECONDS = 15 * 60

const BUILD_TOKEN_FOCUS: Record<BuildTarget, { stat: StatType; value: number; label: string }> = {
  critBurst: { stat: 'critRate', value: 10, label: '暴击爆发聚焦' },
  lifestealTank: { stat: 'maxHp', value: 12, label: '吸血坦克聚焦' },
  armorTrueDamage: { stat: 'penetration', value: 12, label: '破甲真伤聚焦' },
  speedSkill: { stat: 'speed', value: 10, label: '极速技能聚焦' },
  luckTreasure: { stat: 'luck', value: 15, label: '幸运寻宝聚焦' }
}

interface LuckyWheelRecord {
  timestamp: number
  reward: LuckyWheelReward
  audit: ProbabilityAudit
}

interface LuckyWheelState {
  lastDailyFree: number
  buildTokens: Partial<Record<BuildTarget, number>>
  history: LuckyWheelRecord[]
}

// Phase 3.66：nz_lucky_wheel_v1 安全 hydration 专用 fail-closed 规范化 helper。
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function normalizeLastDailyFree(value: unknown): number {
  return Number.isSafeInteger(value) && (value as number) > 0 ? (value as number) : 0
}

function normalizeBuildTokens(value: unknown): Partial<Record<BuildTarget, number>> {
  if (!isPlainObject(value)) return {}
  const result: Partial<Record<BuildTarget, number>> = {}
  for (const [target, count] of Object.entries(value)) {
    if (!BUILD_TOKEN_FOCUS[target as BuildTarget]) continue
    if (!Number.isSafeInteger(count) || (count as number) < 0) continue
    result[target as BuildTarget] = count as number
  }
  return result
}

/** modifier display 必须满足 id/label/description/active 结构。 */
function isValidModifierDisplay(value: unknown): boolean {
  if (!isPlainObject(value)) return false
  return typeof value.id === 'string' &&
    typeof value.label === 'string' &&
    typeof value.description === 'string' &&
    typeof value.active === 'boolean'
}

/** audit step 必须满足 label/rates（全部 finite number）/可选合法 modifier。 */
function isValidAuditStep(value: unknown): boolean {
  if (!isPlainObject(value)) return false
  if (typeof value.label !== 'string') return false
  if (!isPlainObject(value.rates)) return false
  for (const rate of Object.values(value.rates)) {
    if (typeof rate !== 'number' || !Number.isFinite(rate)) return false
  }
  if (value.modifier !== undefined && !isValidModifierDisplay(value.modifier)) return false
  return true
}

/** audit 满足 ProbabilityAudit 安全结构（含嵌套 modifiers/steps）。 */
function isValidAudit(value: unknown): value is ProbabilityAudit {
  if (!isPlainObject(value)) return false
  if (typeof value.roll !== 'number' || !Number.isFinite(value.roll)) return false
  if (!isPlainObject(value.normalizedRates)) return false
  for (const rate of Object.values(value.normalizedRates)) {
    if (typeof rate !== 'number' || !Number.isFinite(rate)) return false
  }
  if (typeof value.selectedRarity !== 'string') return false
  if (typeof value.selectedRewardId !== 'string') return false
  if (!Array.isArray(value.modifiers) || !value.modifiers.every(isValidModifierDisplay)) return false
  if (!Array.isArray(value.steps) || !value.steps.every(isValidAuditStep)) return false
  if (value.seed !== undefined && !Number.isFinite(value.seed)) return false
  return true
}

/** 仅保留可经 canonical reward 重建、且 audit.selectedRewardId 与 canonical reward ID 一致的记录。 */
function normalizeHistoryEntry(value: unknown): LuckyWheelRecord | null {
  if (!isPlainObject(value)) return null
  if (!Number.isSafeInteger(value.timestamp) || (value.timestamp as number) <= 0) return null
  const rewardId = (value.reward as Record<string, unknown> | null | undefined)?.id
  if (typeof rewardId !== 'string') return null
  const reward = LUCKY_WHEEL_REWARDS.find(r => r.id === rewardId)
  if (!reward) return null
  if (!isValidAudit(value.audit)) return null
  if (value.audit.selectedRewardId !== rewardId) return null
  return {
    timestamp: value.timestamp as number,
    reward, // 用当前奖励表中的 canonical reward 重建，不信任持久化副本
    audit: value.audit
  }
}

function normalizeHistory(value: unknown): LuckyWheelRecord[] {
  if (!Array.isArray(value)) return []
  const result: LuckyWheelRecord[] = []
  for (const entry of value) {
    if (result.length >= 20) break
    const normalized = normalizeHistoryEntry(entry)
    if (normalized) result.push(normalized)
  }
  return result
}

export const useLuckyWheelStore = defineStore('luckyWheel', () => {
  const state = reactive<LuckyWheelState>({
    lastDailyFree: 0,
    buildTokens: {},
    history: []
  })

  function load() {
    let candidate = {
      lastDailyFree: 0,
      buildTokens: {} as Partial<Record<BuildTarget, number>>,
      history: [] as LuckyWheelRecord[]
    }
    try {
      const saved = localStorage.getItem(LUCKY_WHEEL_KEY)
      if (saved) {
        const parsed: unknown = JSON.parse(saved)
        if (isPlainObject(parsed)) {
          candidate = {
            lastDailyFree: normalizeLastDailyFree(parsed.lastDailyFree),
            buildTokens: normalizeBuildTokens(parsed.buildTokens),
            history: normalizeHistory(parsed.history)
          }
        }
      }
    } catch {
      // getItem / JSON.parse / normalization 异常 → 保持默认 candidate
    }
    // Phase 3.66：全部规范化完成后一次性提交，杜绝部分水合。
    state.lastDailyFree = candidate.lastDailyFree
    state.buildTokens = candidate.buildTokens
    state.history = candidate.history
  }

  function save() {
    localStorage.setItem(LUCKY_WHEEL_KEY, JSON.stringify(state))
  }

  // Phase 3.67：显式 LuckyWheel key 保存（供 Monopoly 补偿事务控制提交时机）。
  function saveLuckyWheelData() {
    save()
  }

  function canSpinDaily(): boolean {
    if (!state.lastDailyFree) return true
    const today = new Date().setHours(0, 0, 0, 0)
    return state.lastDailyFree < today
  }

  function buildOutcome(reward: LuckyWheelReward, audit: ProbabilityAudit, seed: string): ChanceGameOutcome {
    return {
      gameId: 'luckyWheel',
      seed,
      source: reward.type === 'pity' ? 'pity' : 'event',
      label: reward.name,
      expectedValueCost: reward.type === 'gachaTicket' ? 4 : reward.value,
      freePulls: reward.type === 'gachaTicket' ? reward.value : 0,
      jackpot: false,
      modifier: reward.type === 'pity'
        ? { id: `wheel:${seed}:${reward.id}`, source: 'pity', label: reward.name, pityBonus: reward.value }
        : reward.type === 'rarePlus'
          ? {
              id: `rare_plus_bonus:${seed}:${reward.id}`,
              source: 'event',
              label: reward.name,
              poolId: PERMANENT_POOL_ID,
              appliesTo: 'nextPull',
              appliesToCost: 'paidOnly',
              rarePlusBonus: reward.value
            }
          : undefined,
      audit
    }
  }

  function addBuildToken(target: BuildTarget, amount: number) {
    state.buildTokens[target] = (state.buildTokens[target] || 0) + Math.max(0, amount)
    save()
  }

  function consumeBuildToken(target: BuildTarget, amount: number = 1): boolean {
    const normalized = Math.max(1, Math.floor(amount))
    const current = state.buildTokens[target] || 0
    if (current < normalized) return false
    state.buildTokens[target] = current - normalized
    save()
    return true
  }

  function activateBuildTokenFocus(target: BuildTarget): { stat: StatType; value: number; durationSeconds: number; label: string } | null {
    if (!consumeBuildToken(target, 1)) return null
    const focus = BUILD_TOKEN_FOCUS[target]
    const playerStore = usePlayerStore()
    playerStore.applyBuff(focus.stat, focus.value, BUILD_TOKEN_FOCUS_DURATION_SECONDS)
    playerStore.saveGame()
    return { ...focus, durationSeconds: BUILD_TOKEN_FOCUS_DURATION_SECONDS }
  }

  function spinDaily(options: { seed?: number; rng?: () => number } = {}): LuckyWheelRecord | null {
    // Phase 3.65：权威资格门（RNG / 时间源 / storage 之前）。
    if (!canSpinDaily()) return null
    const probabilityStore = useProbabilityStore()
    const gachaStore = useGachaStore()
    const playerStore = usePlayerStore()

    // 单次时间戳候选：record timestamp 与 daily marker 共用；非法值普通失败，Date.now 抛错原样上送。
    const transactionTimestamp = Date.now()
    if (!Number.isSafeInteger(transactionTimestamp) || transactionTimestamp <= 0) {
      return null
    }

    // RNG / resolver 候选（异常向组件边界上送，零 Store/storage 副作用）。
    const seeded = options.seed !== undefined ? new SeededRng(options.seed) : null
    const rng = options.rng ?? seeded?.fn() ?? Math.random
    const resolver = new RewardResolver<LuckyWheelReward>(
      LUCKY_WHEEL_REWARDS,
      LUCKY_WHEEL_RATES,
      ['legendary', 'epic', 'rare', 'common']
    )
    const resolved = resolver.resolve({
      rng,
      context: { pullNumber: 1 },
      seed: options.seed
    })
    const record: LuckyWheelRecord = {
      timestamp: transactionTimestamp,
      reward: resolved.reward,
      audit: resolved.audit
    }
    const outcome = buildOutcome(resolved.reward, resolved.audit, String(options.seed ?? transactionTimestamp))

    const reward = resolved.reward
    const isPity = reward.type === 'pity'
    const isTicket = reward.type === 'gachaTicket'
    const isBuildToken = reward.type === 'buildToken'

    // 事务前内存快照（深拷贝，供完整回滚）。
    const prevOutcomes = [...probabilityStore.state.outcomes]
    const prevBudgetUsage = JSON.parse(JSON.stringify(probabilityStore.state.budgetUsage)) as typeof probabilityStore.state.budgetUsage
    const prevPendingModifiers = [...probabilityStore.state.pendingModifiers]
    const prevLastDailyFree = state.lastDailyFree
    const prevBuildTokens = JSON.parse(JSON.stringify(state.buildTokens)) as typeof state.buildTokens
    const prevHistory = [...state.history]
    const prevPityCounters = isPity ? { ...gachaStore.state.pityCounters } : null
    const prevTickets = isTicket ? playerStore.player.gachaTickets : 0

    // 旧 raw 快照（getItem 抛错 → 普通 null，零 mutation）。
    let prevProbabilityRaw: string | null
    let prevLuckyWheelRaw: string | null
    let prevGachaRaw: string | null = null
    try {
      prevProbabilityRaw = localStorage.getItem(PROBABILITY_KEY)
      prevLuckyWheelRaw = localStorage.getItem(LUCKY_WHEEL_KEY)
      if (isPity) prevGachaRaw = localStorage.getItem(GACHA_KEY)
    } catch {
      return null
    }

    function rollbackMemory() {
      probabilityStore.state.outcomes = prevOutcomes
      probabilityStore.state.budgetUsage = prevBudgetUsage
      probabilityStore.state.pendingModifiers = prevPendingModifiers
      state.lastDailyFree = prevLastDailyFree
      state.buildTokens = prevBuildTokens
      state.history = prevHistory
      if (isPity && prevPityCounters) gachaStore.state.pityCounters = prevPityCounters
      if (isTicket) playerStore.player.gachaTickets = prevTickets
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
        throw new Error('lucky wheel persistence rollback failed')
      }
      return null
    }

    // 内存提交：Probability 无写盘记录（预算拒绝 → 普通 null，零 mutation），随后奖励。
    if (!probabilityStore.applyChanceOutcomeInMemory(outcome, transactionTimestamp)) {
      return null
    }
    if (isPity) {
      const pool = GACHA_POOLS[PERMANENT_POOL_ID]
      gachaStore.state.pityCounters[PERMANENT_POOL_ID] = Math.min(
        pool.pity.target - 1,
        (gachaStore.state.pityCounters[PERMANENT_POOL_ID] || 0) + Math.max(0, reward.value)
      )
    } else if (isTicket) {
      playerStore.player.gachaTickets += reward.value
    } else if (isBuildToken && reward.buildTarget) {
      state.buildTokens[reward.buildTarget] = (state.buildTokens[reward.buildTarget] || 0) + Math.max(0, reward.value)
    }
    state.lastDailyFree = transactionTimestamp
    state.history.unshift(record)
    if (state.history.length > 20) state.history.pop()

    // 持久化顺序：probability → luckyWheel → gacha（仅 pity）→ main（仅 ticket）。
    const probabilityRaw = { key: PROBABILITY_KEY, previous: prevProbabilityRaw }
    const luckyWheelRaw = { key: LUCKY_WHEEL_KEY, previous: prevLuckyWheelRaw }
    const gachaRaw = { key: GACHA_KEY, previous: prevGachaRaw }

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
    if (isPity) {
      try {
        gachaStore.saveGachaData()
      } catch {
        return finalizeFailure([probabilityRaw, luckyWheelRaw])
      }
    }
    if (isTicket) {
      let saved: boolean
      try {
        // Phase 3.65 Repair 1：显式传入事务时间戳，避免 saveGame 默认 Date.now 二次取时。
        saved = playerStore.saveGame(transactionTimestamp)
      } catch {
        return finalizeFailure(isPity ? [probabilityRaw, luckyWheelRaw, gachaRaw] : [probabilityRaw, luckyWheelRaw])
      }
      if (!saved) {
        return finalizeFailure(isPity ? [probabilityRaw, luckyWheelRaw, gachaRaw] : [probabilityRaw, luckyWheelRaw])
      }
    }

    return record
  }

  function getPreviewAudit(seed?: number): ProbabilityAudit {
    const seeded = seed !== undefined ? new SeededRng(seed) : null
    const resolver = new RewardResolver<LuckyWheelReward>(
      LUCKY_WHEEL_REWARDS,
      LUCKY_WHEEL_RATES,
      ['legendary', 'epic', 'rare', 'common']
    )
    return resolver.resolve({
      rng: seeded?.fn() ?? Math.random,
      context: { pullNumber: 1 },
      seed
    }).audit
  }

  load()

  return {
    state,
    addBuildToken,
    consumeBuildToken,
    activateBuildTokenFocus,
    canSpinDaily,
    spinDaily,
    getPreviewAudit,
    saveLuckyWheelData
  }
})
