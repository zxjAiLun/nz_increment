import { defineStore } from 'pinia'
import { reactive } from 'vue'
import { PERMANENT_POOL_ID } from '../data/gachaPools'
import { LUCKY_WHEEL_RATES, LUCKY_WHEEL_REWARDS, type LuckyWheelReward } from '../data/luckyWheel'
import { RewardResolver, SeededRng, type ProbabilityAudit } from '../systems/probability/probability'
import type { BuildTarget } from '../types/navigation'
import type { StatType } from '../types'
import type { ChanceGameOutcome } from '../systems/probability/chanceGame'
import { useGachaStore } from './gachaStore'
import { usePlayerStore } from './playerStore'
import { useProbabilityStore } from './probabilityStore'

const LUCKY_WHEEL_KEY = 'nz_lucky_wheel_v1'
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

  function applyReward(reward: LuckyWheelReward) {
    const gachaStore = useGachaStore()
    const playerStore = usePlayerStore()

    if (reward.type === 'pity') {
      gachaStore.addPityProgress(PERMANENT_POOL_ID, reward.value)
    } else if (reward.type === 'rarePlus') {
      return
    } else if (reward.type === 'gachaTicket') {
      playerStore.addGachaTicket(reward.value)
    } else if (reward.type === 'buildToken' && reward.buildTarget) {
      addBuildToken(reward.buildTarget, reward.value)
    }
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
    if (!canSpinDaily()) return null
    const probabilityStore = useProbabilityStore()

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
    const outcome = buildOutcome(resolved.reward, resolved.audit, String(options.seed ?? record.timestamp))
    return probabilityStore.applyChanceOutcome(outcome, () => {
      applyReward(resolved.reward)
      state.lastDailyFree = Date.now()
      state.history.unshift(record)
      if (state.history.length > 20) state.history.pop()
      save()
      return record
    })
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
