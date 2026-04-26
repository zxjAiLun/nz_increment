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

interface PullOptions {
  free?: boolean
  rng?: () => number
  seed?: number
}

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
    const pool = GACHA_POOLS[poolId]
    if (!pool) return []

    const playerStore = usePlayerStore()
    const ticketsToUse = options.free ? 0 : Math.min(playerStore.player.gachaTickets || 0, count)
    const paidCount = options.free ? 0 : count - ticketsToUse
    const totalCost = pool.cost * paidCount
    const costType = getPullCostType(options, ticketsToUse, paidCount)

    // 检查钻石是否足够
    if (playerStore.player.diamond < totalCost) {
      return []
    }

    const seeded = options.seed !== undefined ? new SeededRng(options.seed) : null
    const rng = options.rng ?? seeded?.fn() ?? Math.random
    const results: GachaReward[] = []
    const probabilityStore = useProbabilityStore()
    const pullIntent = { count, costType }
    const pendingModifiers = probabilityStore.getApplicableModifiers(poolId, pullIntent)
    const historyEntries: GachaState['history'] = []
    let nextCounter = state.pityCounters[poolId] || 0

    for (let i = 0; i < count; i++) {
      const currentCounter = nextCounter
      const pullNumber = currentCounter + 1
      const pityResolver = new PityResolver(pool.pity.target, pool.pity.softPity)
      const chanceModifiers = pendingModifiers
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
      results.push(reward)

      historyEntries.unshift({
        timestamp: Date.now(),
        poolId,
        result: reward,
        isPity,
        audit: resolved.audit
      })

      nextCounter = pityResolver.nextCounter(currentCounter, reward.rarity)
    }

    // 扣减钻石
    playerStore.player.diamond -= totalCost
    if (ticketsToUse > 0) playerStore.player.gachaTickets -= ticketsToUse
    state.history.unshift(...historyEntries)
    state.pityCounters[poolId] = nextCounter
    probabilityStore.consumeApplicableModifiers(poolId, pullIntent)

    save()
    return results
  }

  function canClaimDailyFree(poolId: string): boolean {
    const last = state.lastDailyFree[poolId]
    if (!last) return true
    const today = new Date().setHours(0, 0, 0, 0)
    return last < today
  }

  function claimDailyFree(poolId: string): GachaReward | null {
    if (!canClaimDailyFree(poolId)) return null
    const result = pull(poolId, 1, { free: true })
    if (result.length === 0) return null
    state.lastDailyFree[poolId] = Date.now()
    save()
    return result[0] || null
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
