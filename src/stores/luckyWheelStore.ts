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

export const useLuckyWheelStore = defineStore('luckyWheel', () => {
  const state = reactive<LuckyWheelState>({
    lastDailyFree: 0,
    buildTokens: {},
    history: []
  })

  function load() {
    const saved = localStorage.getItem(LUCKY_WHEEL_KEY)
    if (!saved) return
    const data = JSON.parse(saved) as LuckyWheelState
    state.lastDailyFree = data.lastDailyFree || 0
    state.buildTokens = data.buildTokens || {}
    state.history = data.history || []
  }

  function save() {
    localStorage.setItem(LUCKY_WHEEL_KEY, JSON.stringify(state))
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
    getPreviewAudit
  }
})
