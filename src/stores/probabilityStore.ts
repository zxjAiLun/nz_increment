import { defineStore } from 'pinia'
import { computed, reactive } from 'vue'
import type { ChanceGameId, ChanceGameOutcome } from '../systems/probability/chanceGame'
import type { RewardIntentModifier } from '../systems/probability/probabilityModifier'
import { CHANCE_GAMES } from '../data/chanceGames'

const PROBABILITY_KEY = 'nz_probability_v1'

interface ProbabilityBudgetUsage {
  periodKey: string
  expectedValue: number
  legendaryRateBonus: number
  pityGain: number
  freePulls: number
  jackpots: number
}

interface ProbabilityState {
  outcomes: ChanceGameOutcome[]
  pendingModifiers: RewardIntentModifier[]
  budgetUsage: Partial<Record<ChanceGameId, ProbabilityBudgetUsage>>
}

export const useProbabilityStore = defineStore('probability', () => {
  const state = reactive<ProbabilityState>({
    outcomes: [],
    pendingModifiers: [],
    budgetUsage: {}
  })

  const latestOutcome = computed(() => state.outcomes[0] ?? null)
  const visibleModifiers = computed(() => state.pendingModifiers)
  const budgetRows = computed(() => CHANCE_GAMES.map(game => {
    const usage = getBudgetUsage(game.id)
    return {
      id: game.id,
      name: game.name,
      expectedValue: `${usage.expectedValue}/${game.budget.expectedValueBudget}`,
      legendaryRateBonus: `${usage.legendaryRateBonus}/${game.budget.maxLegendaryRateBonus}`,
      pityGain: `${usage.pityGain}/${game.budget.maxPityGainPerDay}`,
      freePulls: `${usage.freePulls}/${game.budget.maxFreePullsPerWeek}`,
      jackpots: `${usage.jackpots}/${game.budget.maxJackpotPerWeek}`
    }
  }))

  function load() {
    const saved = localStorage.getItem(PROBABILITY_KEY)
    if (!saved) return
    const data = JSON.parse(saved) as ProbabilityState
    state.outcomes = data.outcomes || []
    state.pendingModifiers = data.pendingModifiers || []
    state.budgetUsage = data.budgetUsage || {}
  }

  function save() {
    localStorage.setItem(PROBABILITY_KEY, JSON.stringify(state))
  }

  function getPeriodKey(gameId: ChanceGameId, timestamp: number = Date.now()): string {
    const date = new Date(timestamp)
    date.setHours(0, 0, 0, 0)
    if (gameId === 'monopoly') {
      const day = date.getDay() || 7
      date.setDate(date.getDate() - day + 1)
      return `week:${date.toISOString().slice(0, 10)}`
    }
    return `day:${date.toISOString().slice(0, 10)}`
  }

  function getBudgetUsage(gameId: ChanceGameId): ProbabilityBudgetUsage {
    const periodKey = getPeriodKey(gameId)
    const existing = state.budgetUsage[gameId]
    if (existing?.periodKey === periodKey) return existing
    const fresh = { periodKey, expectedValue: 0, legendaryRateBonus: 0, pityGain: 0, freePulls: 0, jackpots: 0 }
    state.budgetUsage[gameId] = fresh
    return fresh
  }

  function getOutcomeBudgetCost(outcome: ChanceGameOutcome): Omit<ProbabilityBudgetUsage, 'periodKey'> {
    return {
      expectedValue: outcome.expectedValueCost ?? 0,
      legendaryRateBonus: outcome.modifier?.rarityBonus?.legendary ?? 0,
      pityGain: outcome.modifier?.pityBonus ?? 0,
      freePulls: outcome.freePulls ?? 0,
      jackpots: outcome.jackpot ? 1 : 0
    }
  }

  function canRecordOutcome(outcome: ChanceGameOutcome): boolean {
    const definition = CHANCE_GAMES.find(game => game.id === outcome.gameId)
    if (!definition) return false
    const usage = getBudgetUsage(outcome.gameId)
    const cost = getOutcomeBudgetCost(outcome)
    return usage.expectedValue + cost.expectedValue <= definition.budget.expectedValueBudget &&
      usage.legendaryRateBonus + cost.legendaryRateBonus <= definition.budget.maxLegendaryRateBonus &&
      usage.pityGain + cost.pityGain <= definition.budget.maxPityGainPerDay &&
      usage.freePulls + cost.freePulls <= definition.budget.maxFreePullsPerWeek &&
      usage.jackpots + cost.jackpots <= definition.budget.maxJackpotPerWeek
  }

  function applyOutcomeBudget(outcome: ChanceGameOutcome) {
    const usage = getBudgetUsage(outcome.gameId)
    const cost = getOutcomeBudgetCost(outcome)
    usage.expectedValue += cost.expectedValue
    usage.legendaryRateBonus += cost.legendaryRateBonus
    usage.pityGain += cost.pityGain
    usage.freePulls += cost.freePulls
    usage.jackpots += cost.jackpots
  }

  function recordOutcome(outcome: ChanceGameOutcome): boolean {
    if (!canRecordOutcome(outcome)) return false
    applyOutcomeBudget(outcome)
    state.outcomes.unshift(outcome)
    if (outcome.modifier) state.pendingModifiers.unshift(outcome.modifier)
    if (state.outcomes.length > 50) state.outcomes.pop()
    if (state.pendingModifiers.length > 30) state.pendingModifiers.pop()
    save()
    return true
  }

  function consumeModifier(id: string) {
    state.pendingModifiers = state.pendingModifiers.filter(modifier => modifier.id !== id)
    save()
  }

  function getOutcomesByGame(gameId: ChanceGameId): ChanceGameOutcome[] {
    return state.outcomes.filter(outcome => outcome.gameId === gameId)
  }

  function clear() {
    state.outcomes = []
    state.pendingModifiers = []
    state.budgetUsage = {}
    save()
  }

  load()

  return {
    state,
    latestOutcome,
    visibleModifiers,
    budgetRows,
    getBudgetUsage,
    canRecordOutcome,
    recordOutcome,
    consumeModifier,
    getOutcomesByGame,
    clear
  }
})
