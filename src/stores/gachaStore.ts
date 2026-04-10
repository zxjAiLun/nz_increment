import { defineStore } from 'pinia'
import { reactive } from 'vue'
import type { GachaReward, GachaState } from '../types/gacha'
import { GACHA_POOLS } from '../data/gachaPools'
import { usePlayerStore } from './playerStore'

const GACHA_KEY = 'nz_gacha_v1'

function weightedRandom<T extends { rarity: string }>(pool: T[], rates: Record<string, number>): T {
  const roll = Math.random() * 100
  let cumulative = 0
  const rarityOrder = ['legendary', 'epic', 'rare', 'common'] as const

  for (const rarity of rarityOrder) {
    cumulative += rates[rarity] || 0
    if (roll < cumulative) {
      const filtered = pool.filter(p => p.rarity === rarity)
      if (filtered.length > 0) {
        return filtered[Math.floor(Math.random() * filtered.length)]
      }
    }
  }
  return pool[Math.floor(Math.random() * pool.length)]
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

  function pull(poolId: string, count: 1 | 10 = 1): GachaReward[] {
    const pool = GACHA_POOLS[poolId]
    if (!pool) return []

    const playerStore = usePlayerStore()
    const totalCost = pool.cost * count

    // 检查钻石是否足够
    if (playerStore.player.diamond < totalCost) {
      return []
    }

    // 扣减钻石
    playerStore.player.diamond -= totalCost

    const results: GachaReward[] = []
    for (let i = 0; i < count; i++) {
      state.pityCounters[poolId] = (state.pityCounters[poolId] || 0) + 1
      const counter = state.pityCounters[poolId]

      // 保底逻辑
      let isPity = false
      let rates = { ...pool.rates }
      if (counter >= pool.pity.target) {
        isPity = true
        // 保底必出传说
        rates = { common: 0, rare: 0, epic: 0, legendary: 100 }
      } else if (counter >= pool.pity.softPity) {
        // 软保底后概率逐渐提升
        const bonus = (counter - pool.pity.softPity) * 2  // 每抽+2%
        rates.legendary += bonus
      }

      const reward = weightedRandom(pool.rewards, rates)
      results.push(reward)

      state.history.unshift({
        timestamp: Date.now(),
        poolId,
        result: reward,
        isPity
      })

      if (isPity) state.pityCounters[poolId] = 0  // 保底后清零
    }

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
    const result = pull(poolId, 1)
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

  load()

  return { state, pull, claimDailyFree, getPityProgress, canClaimDailyFree }
})
