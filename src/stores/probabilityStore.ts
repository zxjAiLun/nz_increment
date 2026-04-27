import { defineStore } from 'pinia'
import { computed, reactive } from 'vue'
import type { ChanceGameId, ChanceGameOutcome, RewardIntentCostType } from '../systems/probability/chanceGame'
import type { RewardIntentModifier } from '../systems/probability/probabilityModifier'
import { CHANCE_GAMES } from '../data/chanceGames'

const PROBABILITY_KEY = 'nz_probability_v1'

interface ProbabilityBudgetUsage {
  periodKey: string
  dailyPeriodKey?: string
  weeklyPeriodKey?: string
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

interface PullIntent {
  count: 1 | 10
  costType: RewardIntentCostType
}

interface BudgetPeriodKeys {
  periodKey: string
  dailyPeriodKey: string
  weeklyPeriodKey: string
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

  function getBudgetSnapshot(gameId: ChanceGameId) {
    const definition = CHANCE_GAMES.find(game => game.id === gameId)
    if (!definition) return null
    const usage = getBudgetUsage(gameId)
    return {
      game: definition,
      usage,
      remaining: {
        expectedValue: Math.max(0, definition.budget.expectedValueBudget - usage.expectedValue),
        legendaryRateBonus: Math.max(0, definition.budget.maxLegendaryRateBonus - usage.legendaryRateBonus),
        pityGain: Math.max(0, definition.budget.maxPityGainPerDay - usage.pityGain),
        freePulls: Math.max(0, definition.budget.maxFreePullsPerWeek - usage.freePulls),
        jackpots: Math.max(0, definition.budget.maxJackpotPerWeek - usage.jackpots)
      }
    }
  }

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

  function formatLocalDateKey(date: Date): string {
    const year = date.getFullYear()
    const month = `${date.getMonth() + 1}`.padStart(2, '0')
    const day = `${date.getDate()}`.padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  function getBudgetPeriodKeys(timestamp: number = Date.now()): BudgetPeriodKeys {
    const date = new Date(timestamp)
    date.setHours(0, 0, 0, 0)
    const dailyPeriodKey = `day:${formatLocalDateKey(date)}`
    const weekStart = new Date(date)
    const day = weekStart.getDay() || 7
    weekStart.setDate(weekStart.getDate() - day + 1)
    const weeklyPeriodKey = `week:${formatLocalDateKey(weekStart)}`
    return {
      dailyPeriodKey,
      weeklyPeriodKey,
      periodKey: `${dailyPeriodKey}|${weeklyPeriodKey}`
    }
  }

  function normalizeBudgetUsage(existing: ProbabilityBudgetUsage, keys: BudgetPeriodKeys): ProbabilityBudgetUsage {
    const legacyDailyKey = existing.periodKey.startsWith('day:') ? existing.periodKey : undefined
    const legacyWeeklyKey = existing.periodKey.startsWith('week:') ? existing.periodKey : undefined
    const existingDailyKey = existing.dailyPeriodKey ?? legacyDailyKey
    const existingWeeklyKey = existing.weeklyPeriodKey ?? legacyWeeklyKey
    const keepDaily = existingDailyKey === keys.dailyPeriodKey
    const keepWeekly = existingWeeklyKey === keys.weeklyPeriodKey
    return {
      periodKey: keys.periodKey,
      dailyPeriodKey: keys.dailyPeriodKey,
      weeklyPeriodKey: keys.weeklyPeriodKey,
      expectedValue: keepDaily ? existing.expectedValue : 0,
      legendaryRateBonus: keepDaily ? existing.legendaryRateBonus : 0,
      pityGain: keepDaily ? existing.pityGain : 0,
      freePulls: keepWeekly ? existing.freePulls : 0,
      jackpots: keepWeekly ? existing.jackpots : 0
    }
  }

  function getBudgetUsage(gameId: ChanceGameId): ProbabilityBudgetUsage {
    const keys = getBudgetPeriodKeys()
    const existing = state.budgetUsage[gameId]
    if (
      existing?.dailyPeriodKey === keys.dailyPeriodKey &&
      existing.weeklyPeriodKey === keys.weeklyPeriodKey
    ) return existing
    const fresh = existing
      ? normalizeBudgetUsage(existing, keys)
      : {
          periodKey: keys.periodKey,
          dailyPeriodKey: keys.dailyPeriodKey,
          weeklyPeriodKey: keys.weeklyPeriodKey,
          expectedValue: 0,
          legendaryRateBonus: 0,
          pityGain: 0,
          freePulls: 0,
          jackpots: 0
        }
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

  function addBudgetCost(a: Omit<ProbabilityBudgetUsage, 'periodKey'>, b: Omit<ProbabilityBudgetUsage, 'periodKey'>): Omit<ProbabilityBudgetUsage, 'periodKey'> {
    return {
      expectedValue: a.expectedValue + b.expectedValue,
      legendaryRateBonus: a.legendaryRateBonus + b.legendaryRateBonus,
      pityGain: a.pityGain + b.pityGain,
      freePulls: a.freePulls + b.freePulls,
      jackpots: a.jackpots + b.jackpots
    }
  }

  function shouldQueueModifier(modifier: RewardIntentModifier): boolean {
    return Boolean(
      modifier.poolId &&
      modifier.appliesTo &&
      (
        modifier.rarePlusBonus ||
        modifier.rarityBonus ||
        modifier.extraRolls ||
        modifier.guaranteedMinRarity ||
        modifier.chooseOneOfN
      )
    )
  }

  function isApplicableModifier(modifier: RewardIntentModifier, poolId: string, intent: PullIntent): boolean {
    if (modifier.poolId !== poolId) return false
    const costScope = modifier.appliesToCost ?? 'any'
    if (costScope === 'paidOnly' && intent.costType === 'free') return false
    if (costScope === 'freeOnly' && intent.costType !== 'free') return false
    if (modifier.appliesTo === 'anyPull') return true
    if (modifier.appliesTo === 'nextPull') return true
    if (modifier.appliesTo === 'tenPull') return intent.count === 10
    return false
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

  function canRecordOutcomes(outcomes: ChanceGameOutcome[]): boolean {
    const costsByGame = new Map<ChanceGameId, Omit<ProbabilityBudgetUsage, 'periodKey'>>()
    for (const outcome of outcomes) {
      const definition = CHANCE_GAMES.find(game => game.id === outcome.gameId)
      if (!definition) return false
      const existing = costsByGame.get(outcome.gameId) ?? { expectedValue: 0, legendaryRateBonus: 0, pityGain: 0, freePulls: 0, jackpots: 0 }
      costsByGame.set(outcome.gameId, addBudgetCost(existing, getOutcomeBudgetCost(outcome)))
    }

    for (const [gameId, cost] of costsByGame) {
      const definition = CHANCE_GAMES.find(game => game.id === gameId)
      if (!definition) return false
      const usage = getBudgetUsage(gameId)
      if (
        usage.expectedValue + cost.expectedValue > definition.budget.expectedValueBudget ||
        usage.legendaryRateBonus + cost.legendaryRateBonus > definition.budget.maxLegendaryRateBonus ||
        usage.pityGain + cost.pityGain > definition.budget.maxPityGainPerDay ||
        usage.freePulls + cost.freePulls > definition.budget.maxFreePullsPerWeek ||
        usage.jackpots + cost.jackpots > definition.budget.maxJackpotPerWeek
      ) return false
    }
    return true
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
    if (outcome.modifier && shouldQueueModifier(outcome.modifier)) {
      addPendingModifier(outcome.modifier.poolId!, outcome.modifier)
    }
    if (state.outcomes.length > 50) state.outcomes.pop()
    save()
    return true
  }

  function applyChanceOutcome<T>(outcome: ChanceGameOutcome, applyReward: () => T): T | null {
    if (!recordOutcome(outcome)) return null
    return applyReward()
  }

  function applyChanceOutcomes<T>(outcomes: ChanceGameOutcome[], applyRewards: () => T): T | null {
    if (!canRecordOutcomes(outcomes)) return null
    for (const outcome of outcomes) {
      applyOutcomeBudget(outcome)
      state.outcomes.unshift(outcome)
      if (outcome.modifier && shouldQueueModifier(outcome.modifier)) {
        addPendingModifier(outcome.modifier.poolId!, outcome.modifier)
      }
    }
    while (state.outcomes.length > 50) state.outcomes.pop()
    save()
    return applyRewards()
  }

  function addPendingModifier(poolId: string, modifier: RewardIntentModifier) {
    state.pendingModifiers.unshift({
      ...modifier,
      poolId,
      appliesTo: modifier.appliesTo ?? 'nextPull'
    })
    if (state.pendingModifiers.length > 30) state.pendingModifiers.pop()
    save()
  }

  function getApplicableModifiers(poolId: string, intent: PullIntent): RewardIntentModifier[] {
    return state.pendingModifiers.filter(modifier => isApplicableModifier(modifier, poolId, intent))
  }

  function consumeApplicableModifiers(poolId: string, intent: PullIntent): RewardIntentModifier[] {
    const applicable = getApplicableModifiers(poolId, intent)
    if (applicable.length === 0) return []
    const consumedIds = new Set(applicable.map(modifier => modifier.id))
    state.pendingModifiers = state.pendingModifiers.filter(modifier => !consumedIds.has(modifier.id))
    save()
    return applicable
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
    getBudgetSnapshot,
    getBudgetUsage,
    canRecordOutcome,
    canRecordOutcomes,
    recordOutcome,
    applyChanceOutcome,
    applyChanceOutcomes,
    addPendingModifier,
    getApplicableModifiers,
    consumeApplicableModifiers,
    consumeModifier,
    getOutcomesByGame,
    clear
  }
})
