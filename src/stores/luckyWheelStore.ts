import { defineStore } from 'pinia'
import { reactive } from 'vue'
import { PERMANENT_POOL_ID } from '../data/gachaPools'
import { LUCKY_WHEEL_RATES, LUCKY_WHEEL_REWARDS, type LuckyWheelReward } from '../data/luckyWheel'
import { RewardResolver, SeededRng, type ProbabilityAudit } from '../systems/probability/probability'
import type { BuildTarget } from '../types/navigation'
import { useGachaStore } from './gachaStore'
import { usePlayerStore } from './playerStore'

const LUCKY_WHEEL_KEY = 'nz_lucky_wheel_v1'

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

  function applyReward(reward: LuckyWheelReward) {
    const gachaStore = useGachaStore()
    const playerStore = usePlayerStore()

    if (reward.type === 'pity') {
      gachaStore.addPityProgress(PERMANENT_POOL_ID, reward.value)
    } else if (reward.type === 'rarePlus') {
      gachaStore.addRarePlusBonus(PERMANENT_POOL_ID, reward.value)
    } else if (reward.type === 'gachaTicket') {
      playerStore.addGachaTicket(reward.value)
    } else if (reward.type === 'buildToken' && reward.buildTarget) {
      addBuildToken(reward.buildTarget, reward.value)
    }
  }

  function addBuildToken(target: BuildTarget, amount: number) {
    state.buildTokens[target] = (state.buildTokens[target] || 0) + Math.max(0, amount)
    save()
  }

  function spinDaily(options: { seed?: number; rng?: () => number } = {}): LuckyWheelRecord | null {
    if (!canSpinDaily()) return null

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
    const record = {
      timestamp: Date.now(),
      reward: resolved.reward,
      audit: resolved.audit
    }

    applyReward(resolved.reward)
    state.lastDailyFree = Date.now()
    state.history.unshift(record)
    if (state.history.length > 20) state.history.pop()
    save()
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
    canSpinDaily,
    spinDaily,
    getPreviewAudit
  }
})
