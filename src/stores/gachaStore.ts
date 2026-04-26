import { defineStore } from 'pinia'
import { reactive } from 'vue'
import type { GachaReward, GachaState } from '../types/gacha'
import { GACHA_POOLS } from '../data/gachaPools'
import { usePlayerStore } from './playerStore'
import { PityResolver, RewardResolver, SeededRng, type ProbabilityAudit, type ProbabilityModifier, type RarityRateMap } from '../systems/probability/probability'

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
    pendingRarePlusBonus: {},
    pendingTenPullRarePlusBonus: {},
    pendingEventRarePlusBonus: {},
    history: []
  })

  function load() {
    const saved = localStorage.getItem(GACHA_KEY)
    if (saved) {
      const data = JSON.parse(saved) as GachaState
      state.pityCounters = data.pityCounters || {}
      state.lastDailyFree = data.lastDailyFree || {}
      state.pendingRarePlusBonus = data.pendingRarePlusBonus || {}
      state.pendingTenPullRarePlusBonus = data.pendingTenPullRarePlusBonus || {}
      state.pendingEventRarePlusBonus = data.pendingEventRarePlusBonus || {}
      state.history = data.history || []
    }
  }

  function save() {
    localStorage.setItem(GACHA_KEY, JSON.stringify({
      pityCounters: state.pityCounters,
      lastDailyFree: state.lastDailyFree,
      pendingRarePlusBonus: state.pendingRarePlusBonus,
      pendingTenPullRarePlusBonus: state.pendingTenPullRarePlusBonus,
      pendingEventRarePlusBonus: state.pendingEventRarePlusBonus,
      history: state.history
    }))
  }

  function createRarePlusModifierFromBonus(
    bonus: number,
    id: string,
    label: string,
    description: string
  ): ProbabilityModifier | null {
    if (bonus <= 0) return null
    return {
      id,
      label,
      description,
      isActive: () => true,
      apply: rates => {
        const rarePlusKeys = ['rare', 'epic', 'legendary']
        const rarePlusTotal = rarePlusKeys.reduce((sum, key) => sum + Math.max(0, rates[key] || 0), 0)
        if (rarePlusTotal <= 0) return rates
        const next: RarityRateMap = { ...rates, common: Math.max(0, (rates.common || 0) - bonus) }
        for (const key of rarePlusKeys) {
          next[key] = (next[key] || 0) + bonus * Math.max(0, rates[key] || 0) / rarePlusTotal
        }
        return next
      }
    }
  }

  function createRarePlusModifier(poolId: string): ProbabilityModifier | null {
    const bonus = state.pendingRarePlusBonus[poolId] || 0
    return createRarePlusModifierFromBonus(
      bonus,
      'rare_plus_bonus',
      'rare+ 加成',
      `下一抽 rare/epic/legendary 合计概率 +${bonus}%`
    )
  }

  function createTenPullRarePlusModifier(poolId: string): ProbabilityModifier | null {
    const bonus = state.pendingTenPullRarePlusBonus[poolId] || 0
    return createRarePlusModifierFromBonus(
      bonus,
      'pachinko_ten_pull_modifier',
      '幸运投球十连加成',
      `下一次十连每抽 rare/epic/legendary 合计概率 +${bonus}%`
    )
  }

  function createEventRarePlusModifier(poolId: string): ProbabilityModifier | null {
    const bonus = state.pendingEventRarePlusBonus[poolId] || 0
    return createRarePlusModifierFromBonus(
      bonus,
      'pinball_event_modifier',
      '弹球活动加成',
      `下一次抽卡 rare/epic/legendary 合计概率 +${bonus}%`
    )
  }

  function pull(poolId: string, count: 1 | 10 = 1, options: PullOptions = {}): GachaReward[] {
    const pool = GACHA_POOLS[poolId]
    if (!pool) return []

    const playerStore = usePlayerStore()
    const ticketsToUse = options.free ? 0 : Math.min(playerStore.player.gachaTickets || 0, count)
    const paidCount = options.free ? 0 : count - ticketsToUse
    const totalCost = pool.cost * paidCount

    // 检查钻石是否足够
    if (playerStore.player.diamond < totalCost) {
      return []
    }

    // 扣减钻石
    playerStore.player.diamond -= totalCost
    if (ticketsToUse > 0) playerStore.player.gachaTickets -= ticketsToUse

    const seeded = options.seed !== undefined ? new SeededRng(options.seed) : null
    const rng = options.rng ?? seeded?.fn() ?? Math.random
    const results: GachaReward[] = []
    const rarePlusModifier = createRarePlusModifier(poolId)
    const tenPullRarePlusModifier = count === 10 ? createTenPullRarePlusModifier(poolId) : null
    const eventRarePlusModifier = createEventRarePlusModifier(poolId)

    for (let i = 0; i < count; i++) {
      const currentCounter = state.pityCounters[poolId] || 0
      const pullNumber = currentCounter + 1
      const pityResolver = new PityResolver(pool.pity.target, pool.pity.softPity)
      const modifiers = [
        ...pityResolver.getModifiers(pullNumber),
        ...(rarePlusModifier && i === 0 ? [rarePlusModifier] : []),
        ...(tenPullRarePlusModifier ? [tenPullRarePlusModifier] : []),
        ...(eventRarePlusModifier ? [eventRarePlusModifier] : [])
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

      state.history.unshift({
        timestamp: Date.now(),
        poolId,
        result: reward,
        isPity,
        audit: resolved.audit
      })

      state.pityCounters[poolId] = pityResolver.nextCounter(currentCounter, reward.rarity)
    }

    if (rarePlusModifier) state.pendingRarePlusBonus[poolId] = 0
    if (tenPullRarePlusModifier) state.pendingTenPullRarePlusBonus[poolId] = 0
    if (eventRarePlusModifier) state.pendingEventRarePlusBonus[poolId] = 0
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

  function addRarePlusBonus(poolId: string, amount: number) {
    if (!GACHA_POOLS[poolId]) return
    state.pendingRarePlusBonus[poolId] = (state.pendingRarePlusBonus[poolId] || 0) + Math.max(0, amount)
    save()
  }

  function addTenPullRarePlusBonus(poolId: string, amount: number) {
    if (!GACHA_POOLS[poolId]) return
    state.pendingTenPullRarePlusBonus[poolId] = (state.pendingTenPullRarePlusBonus[poolId] || 0) + Math.max(0, amount)
    save()
  }

  function addEventRarePlusBonus(poolId: string, amount: number) {
    if (!GACHA_POOLS[poolId]) return
    state.pendingEventRarePlusBonus[poolId] = (state.pendingEventRarePlusBonus[poolId] || 0) + Math.max(0, amount)
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
    const rarePlusModifier = createRarePlusModifier(poolId)
    const tenPullRarePlusModifier = count === 10 ? createTenPullRarePlusModifier(poolId) : null
    const eventRarePlusModifier = createEventRarePlusModifier(poolId)
    return resolver.resolve({
      rng: seeded?.fn() ?? Math.random,
      context: { pullNumber },
      modifiers: [
        ...pityResolver.getModifiers(pullNumber),
        ...(rarePlusModifier ? [rarePlusModifier] : []),
        ...(tenPullRarePlusModifier ? [tenPullRarePlusModifier] : []),
        ...(eventRarePlusModifier ? [eventRarePlusModifier] : [])
      ],
      seed
    }).audit
  }

  load()

  return {
    state,
    pull,
    claimDailyFree,
    getPityProgress,
    getProbabilityAudit,
    addPityProgress,
    addRarePlusBonus,
    addTenPullRarePlusBonus,
    addEventRarePlusBonus,
    canClaimDailyFree
  }
})
