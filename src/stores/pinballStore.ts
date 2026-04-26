import { defineStore } from 'pinia'
import { computed, reactive } from 'vue'
import { PERMANENT_POOL_ID } from '../data/gachaPools'
import {
  PINBALL_MAX_CONVERT_TOKENS,
  PINBALL_SCORE_BANDS,
  PINBALL_TOKEN_TO_RARE_PLUS,
  type PinballScoreBand
} from '../data/pinball'
import { SeededRng } from '../systems/probability/rewardResolver'
import { useGachaStore } from './gachaStore'
import { useProbabilityStore } from './probabilityStore'

const PINBALL_KEY = 'nz_pinball_v1'

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

  function playEvent(options: { seed?: number; rng?: () => number } = {}): PinballPlayRecord {
    const probabilityStore = useProbabilityStore()
    const seeded = options.seed !== undefined ? new SeededRng(options.seed) : null
    const rng = options.rng ?? seeded?.fn() ?? Math.random
    const rolls = [rng(), rng(), rng()]
    const score = calculateScore(rolls)
    const scoreBand = getScoreBand(score)
    const tokensGained = scoreBand.tokens

    state.tokens += tokensGained
    const record = {
      timestamp: Date.now(),
      score,
      tokensGained,
      rolls,
      scoreBand
    }
    state.plays.unshift(record)
    if (state.plays.length > 20) state.plays.pop()
    probabilityStore.recordOutcome({
      gameId: 'pinball',
      seed: String(options.seed ?? Date.now()),
      source: 'pinball',
      label: scoreBand.name,
      route: rolls.map((roll, index) => `bumper${index + 1}:${roll.toFixed(4)}`),
      score,
      tokens: tokensGained,
      expectedValueCost: tokensGained
    })
    save()
    return record
  }

  function convertTokensToModifier(poolId: string = PERMANENT_POOL_ID, tokens: number = Math.min(state.tokens, PINBALL_MAX_CONVERT_TOKENS)): PinballConversionRecord | null {
    const tokensSpent = Math.min(Math.max(0, Math.floor(tokens)), state.tokens, PINBALL_MAX_CONVERT_TOKENS)
    if (tokensSpent <= 0) return null

    const rarePlusBonus = tokensSpent * PINBALL_TOKEN_TO_RARE_PLUS
    const gachaStore = useGachaStore()
    const probabilityStore = useProbabilityStore()
    gachaStore.addEventRarePlusBonus(poolId, rarePlusBonus)
    state.tokens -= tokensSpent

    const record = {
      timestamp: Date.now(),
      poolId,
      tokensSpent,
      rarePlusBonus
    }
    state.conversions.unshift(record)
    if (state.conversions.length > 20) state.conversions.pop()
    probabilityStore.recordOutcome({
      gameId: 'pinball',
      seed: `${Date.now()}`,
      source: 'pinball',
      label: `弹球 token 兑换 rare+ +${rarePlusBonus}%`,
      tokens: -tokensSpent,
      expectedValueCost: rarePlusBonus,
      modifier: {
        id: `pinball:${record.timestamp}:${tokensSpent}`,
        source: 'pinball',
        label: `弹球活动 rare+ +${rarePlusBonus}%`,
        rarityBonus: { rare: rarePlusBonus }
      }
    })
    save()
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
