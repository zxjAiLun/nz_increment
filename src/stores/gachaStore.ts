import { defineStore } from 'pinia'
import { reactive } from 'vue'
import type { GachaReward, GachaState } from '../types/gacha'
import { GACHA_POOLS } from '../data/gachaPools'
import { usePlayerStore } from './playerStore'
import { PityResolver, RewardResolver, SeededRng, type ProbabilityAudit } from '../systems/probability/probability'
import { toResolverModifier, type RewardIntentModifier } from '../systems/probability/probabilityModifier'
import type { RewardIntentCostType } from '../systems/probability/chanceGame'
import { useProbabilityStore } from './probabilityStore'

const GACHA_KEY = 'nz_gacha_v1'
// probabilityStore 的 key（T8.1 概率系统）。事务需读取/补偿该 key 的旧 raw。
const PROBABILITY_KEY = 'nz_probability_v1'

interface PullOptions {
  free?: boolean
  rng?: () => number
  seed?: number
}

type GachaFailReason =
  | 'invalid request'
  | 'invalid state'
  | 'insufficient resources'
  | 'daily free unavailable'
  | 'persistence failed'

type GachaTransactionResult =
  | { ok: true; rewards: GachaReward[] }
  | { ok: false; reason: GachaFailReason }

export const useGachaStore = defineStore('gacha', () => {
  const state = reactive<GachaState>({
    pityCounters: {},
    lastDailyFree: {},
    history: []
  })

  function load() {
    const saved = localStorage.getItem(GACHA_KEY)
    if (saved) {
      const data = JSON.parse(saved) as GachaState
      state.pityCounters = data.pityCounters || {}
      state.lastDailyFree = data.lastDailyFree || {}
      state.history = data.history || []
    }
  }

  function save() {
    localStorage.setItem(GACHA_KEY, JSON.stringify({
      pityCounters: state.pityCounters,
      lastDailyFree: state.lastDailyFree,
      history: state.history
    }))
  }

  function appliesToDraw(modifier: RewardIntentModifier, drawIndex: number): boolean {
    if (modifier.appliesTo === 'nextPull') return drawIndex === 0
    return true
  }

  function getPullCostType(options: PullOptions, ticketsToUse: number, paidCount: number): RewardIntentCostType {
    if (options.free) return 'free'
    if (paidCount <= 0 && ticketsToUse > 0) return 'ticket'
    return 'diamond'
  }

  function pull(poolId: string, count: 1 | 10 = 1, options: PullOptions = {}): GachaReward[] {
    const result = runGachaTransaction(poolId, count, options, false)
    return result.ok ? result.rewards : []
  }

  // Phase 3.62：所有抽卡模式收口到同一同步补偿事务。
  function runGachaTransaction(
    poolId: string,
    count: 1 | 10,
    options: PullOptions,
    isDailyFree: boolean
  ): GachaTransactionResult {
    // 权威资格门（任何 mutation / RNG / raw 读取之前）。
    const pool = GACHA_POOLS[poolId]
    if (!pool) return { ok: false, reason: 'invalid request' }
    if (count !== 1 && count !== 10) return { ok: false, reason: 'invalid request' }
    if (options.free !== undefined && typeof options.free !== 'boolean') return { ok: false, reason: 'invalid request' }
    if (options.rng !== undefined && typeof options.rng !== 'function') return { ok: false, reason: 'invalid request' }
    if (options.seed !== undefined && !Number.isSafeInteger(options.seed)) return { ok: false, reason: 'invalid request' }

    const playerStore = usePlayerStore()
    const probabilityStore = useProbabilityStore()

    const diamond = playerStore.player.diamond
    const gachaTickets = playerStore.player.gachaTickets
    if (!Number.isSafeInteger(diamond) || diamond < 0) return { ok: false, reason: 'invalid state' }
    if (!Number.isSafeInteger(gachaTickets) || gachaTickets < 0) return { ok: false, reason: 'invalid state' }
    if (!Number.isSafeInteger(pool.cost) || pool.cost <= 0) return { ok: false, reason: 'invalid state' }

    const ticketsToUse = options.free === true || isDailyFree ? 0 : Math.min(gachaTickets, count)
    const paidCount = options.free === true || isDailyFree ? 0 : count - ticketsToUse
    if (!Number.isSafeInteger(ticketsToUse) || ticketsToUse < 0) return { ok: false, reason: 'invalid state' }
    if (!Number.isSafeInteger(paidCount) || paidCount < 0) return { ok: false, reason: 'invalid state' }
    const totalCost = pool.cost * paidCount
    if (!Number.isSafeInteger(totalCost) || totalCost < 0) return { ok: false, reason: 'invalid state' }
    const costType = getPullCostType(options, ticketsToUse, paidCount)
    const requiresMainSave = !(options.free === true || isDailyFree)

    if (requiresMainSave && diamond < totalCost) return { ok: false, reason: 'insufficient resources' }

    // Gacha 容器与当前 pity 校验
    const pityCounters = state.pityCounters
    const lastDailyFree = state.lastDailyFree
    const history = state.history
    if (pityCounters === null || typeof pityCounters !== 'object' || Array.isArray(pityCounters)) return { ok: false, reason: 'invalid state' }
    if (lastDailyFree === null || typeof lastDailyFree !== 'object' || Array.isArray(lastDailyFree)) return { ok: false, reason: 'invalid state' }
    if (!Array.isArray(history)) return { ok: false, reason: 'invalid state' }
    const currentPity = pityCounters[poolId] ?? 0
    if (!Number.isSafeInteger(currentPity) || currentPity < 0) return { ok: false, reason: 'invalid state' }
    if (currentPity >= pool.pity.target) return { ok: false, reason: 'invalid state' }

    // Probability 状态校验
    const pendingModifiers = probabilityStore.state.pendingModifiers
    if (!Array.isArray(pendingModifiers)) return { ok: false, reason: 'invalid state' }

    // 每日免费资格（事务入口内权威判断，不依赖按钮 disabled）。
    // Phase 3.62 Repair 1：marker 必须为正安全整数；0/负数/非法值一律 invalid state fail-closed。
    if (isDailyFree) {
      const last = lastDailyFree[poolId]
      if (last !== undefined) {
        if (!Number.isSafeInteger(last) || last <= 0) return { ok: false, reason: 'invalid state' }
        const today = new Date().setHours(0, 0, 0, 0)
        if (last >= today) return { ok: false, reason: 'daily free unavailable' }
      }
    }

    // Phase 3.62 Repair 1：事务时间戳候选必须为正安全整数；Date.now 抛异常原样上送。
    const transactionTimestamp = Date.now()
    if (!Number.isSafeInteger(transactionTimestamp) || transactionTimestamp <= 0) {
      return { ok: false, reason: 'invalid state' }
    }

    // 候选构造（RNG / resolver 异常在此抛出，零 Store/storage 副作用）。
    const pullIntent = { count, costType }
    const applicableModifiers = probabilityStore.getApplicableModifiers(poolId, pullIntent)
    if (!Array.isArray(applicableModifiers)) return { ok: false, reason: 'invalid state' }
    const willConsumeModifiers = applicableModifiers.length > 0
    const seeded = options.seed !== undefined ? new SeededRng(options.seed) : null
    const rng = options.rng ?? seeded?.fn() ?? Math.random
    const rewards: GachaReward[] = []
    const historyEntries: GachaState['history'] = []
    let nextCounter = currentPity

    for (let i = 0; i < count; i++) {
      const currentCounter = nextCounter
      const pullNumber = currentCounter + 1
      const pityResolver = new PityResolver(pool.pity.target, pool.pity.softPity)
      const chanceModifiers = applicableModifiers
        .filter(modifier => appliesToDraw(modifier, i))
        .map(toResolverModifier)
      const modifiers = [
        ...pityResolver.getModifiers(pullNumber),
        ...chanceModifiers
      ]
      const resolver = new RewardResolver<GachaReward>(
        pool.rewards,
        pool.rates,
        ['legendary', 'epic', 'rare', 'common']
      )
      const resolved = resolver.resolve({
        rng,
        context: { pullNumber },
        modifiers,
        seed: options.seed
      })
      const reward = resolved.reward
      const isPity = resolved.audit.modifiers.some(modifier => modifier.id === 'hard_pity' && modifier.active)
      rewards.push(reward)

      historyEntries.unshift({
        timestamp: transactionTimestamp,
        poolId,
        result: reward,
        isPity,
        audit: resolved.audit
      })

      nextCounter = pityResolver.nextCounter(currentCounter, reward.rarity)
    }

    // 资源扣减候选
    const nextDiamond = requiresMainSave ? diamond - totalCost : diamond
    const nextTickets = requiresMainSave ? gachaTickets - ticketsToUse : gachaTickets
    if (!Number.isSafeInteger(nextDiamond) || nextDiamond < 0) return { ok: false, reason: 'invalid state' }
    if (!Number.isSafeInteger(nextTickets) || nextTickets < 0) return { ok: false, reason: 'invalid state' }

    const nextPityCounters = { ...pityCounters, [poolId]: nextCounter }
    const nextHistory = [...historyEntries, ...history]
    const nextLastDailyFree = isDailyFree ? { ...lastDailyFree, [poolId]: transactionTimestamp } : lastDailyFree
    const consumedIds = new Set(applicableModifiers.map(modifier => modifier.id))
    const nextPendingModifiers = willConsumeModifiers
      ? pendingModifiers.filter(modifier => !consumedIds.has(modifier.id))
      : pendingModifiers

    // 事务前内存快照
    const prevDiamond = diamond
    const prevTickets = gachaTickets
    const prevPityCounters = pityCounters
    const prevLastDailyFree = lastDailyFree
    const prevHistory = history
    const prevPendingModifiers = pendingModifiers

    // 旧 raw 快照（getItem 抛错 → 普通 persistence failure，零 mutation）。
    let prevGachaRaw: string | null
    let prevProbabilityRaw: string | null = null
    try {
      prevGachaRaw = localStorage.getItem(GACHA_KEY)
      if (willConsumeModifiers) prevProbabilityRaw = localStorage.getItem(PROBABILITY_KEY)
    } catch {
      return { ok: false, reason: 'persistence failed' }
    }

    function rollbackMemory() {
      playerStore.player.diamond = prevDiamond
      playerStore.player.gachaTickets = prevTickets
      state.pityCounters = prevPityCounters
      state.lastDailyFree = prevLastDailyFree
      state.history = prevHistory
      probabilityStore.state.pendingModifiers = prevPendingModifiers
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

    // 失败收口：内存回滚 → 补偿已写入 key → 补偿失败抛固定分类错误。
    function finalizeFailure(writtenRaws: { key: string; previous: string | null }[]): GachaTransactionResult {
      rollbackMemory()
      const failures = compensateRaws(writtenRaws)
      if (failures.length > 0) {
        throw new Error('gacha persistence rollback failed')
      }
      return { ok: false, reason: 'persistence failed' }
    }

    const probabilityRaw = { key: PROBABILITY_KEY, previous: prevProbabilityRaw }
    const gachaRaw = { key: GACHA_KEY, previous: prevGachaRaw }

    // 内存提交（引用替换，可完整回滚）。
    try {
      playerStore.player.diamond = nextDiamond
      playerStore.player.gachaTickets = nextTickets
      state.pityCounters = nextPityCounters
      state.history = nextHistory
      if (isDailyFree) state.lastDailyFree = nextLastDailyFree
      if (willConsumeModifiers) probabilityStore.state.pendingModifiers = nextPendingModifiers
    } catch (error) {
      rollbackMemory()
      throw error
    }

    // 持久化顺序：
    //   有 modifier 消耗：Probability → Gacha → 主存档（仅非免费）
    //   无 modifier 消耗：Gacha → 主存档（仅非免费）
    if (willConsumeModifiers) {
      try {
        probabilityStore.saveProbabilityData()
      } catch {
        return finalizeFailure([])
      }
    }

    try {
      save()
    } catch {
      return finalizeFailure(willConsumeModifiers ? [probabilityRaw] : [])
    }

    if (requiresMainSave) {
      let saved: boolean
      try {
        saved = playerStore.saveGame()
      } catch {
        return finalizeFailure(willConsumeModifiers ? [probabilityRaw, gachaRaw] : [gachaRaw])
      }
      if (!saved) {
        return finalizeFailure(willConsumeModifiers ? [probabilityRaw, gachaRaw] : [gachaRaw])
      }
    }

    return { ok: true, rewards }
  }

  function canClaimDailyFree(poolId: string): boolean {
    const last = state.lastDailyFree[poolId]
    // Phase 3.62 Repair 1：与权威 action 的 marker 类型边界一致（fail-closed）。
    if (last === undefined) return true
    if (!Number.isSafeInteger(last) || last <= 0) return false
    const today = new Date().setHours(0, 0, 0, 0)
    return last < today
  }

  function claimDailyFree(poolId: string): GachaReward | null {
    const result = runGachaTransaction(poolId, 1, { free: true }, true)
    return result.ok ? result.rewards[0] ?? null : null
  }

  function getPityProgress(poolId: string): { current: number, target: number, bonus: boolean } {
    const pool = GACHA_POOLS[poolId]
    const current = state.pityCounters[poolId] || 0
    return {
      current,
      target: pool?.pity.target || 90,
      bonus: current >= (pool?.pity.softPity || 80)
    }
  }

  function addPityProgress(poolId: string, amount: number) {
    const pool = GACHA_POOLS[poolId]
    if (!pool) return
    state.pityCounters[poolId] = Math.min(pool.pity.target - 1, (state.pityCounters[poolId] || 0) + Math.max(0, amount))
    save()
  }

  function getProbabilityAudit(poolId: string, seed?: number, count: 1 | 10 = 1): ProbabilityAudit | null {
    const pool = GACHA_POOLS[poolId]
    if (!pool) return null
    const pullNumber = (state.pityCounters[poolId] || 0) + 1
    const pityResolver = new PityResolver(pool.pity.target, pool.pity.softPity)
    const seeded = seed !== undefined ? new SeededRng(seed) : null
    const resolver = new RewardResolver<GachaReward>(
      pool.rewards,
      pool.rates,
      ['legendary', 'epic', 'rare', 'common']
    )
    const probabilityStore = useProbabilityStore()
    const chanceModifiers = probabilityStore.getApplicableModifiers(poolId, { count, costType: 'diamond' })
      .filter(modifier => appliesToDraw(modifier, 0))
      .map(toResolverModifier)
    return resolver.resolve({
      rng: seeded?.fn() ?? Math.random,
      context: { pullNumber },
      modifiers: [
        ...pityResolver.getModifiers(pullNumber),
        ...chanceModifiers
      ],
      seed
    }).audit
  }

  function getProbabilityPreview(poolId: string, count: 1 | 10 = 1): ProbabilityAudit | null {
    return getProbabilityAudit(poolId, undefined, count)
  }

  function getLastPullAudit(poolId: string): ProbabilityAudit | null {
    return state.history.find(record => record.poolId === poolId)?.audit ?? null
  }

  load()

  return {
    state,
    pull,
    claimDailyFree,
    getPityProgress,
    getProbabilityAudit,
    getProbabilityPreview,
    getLastPullAudit,
    addPityProgress,
    canClaimDailyFree
  }
})
