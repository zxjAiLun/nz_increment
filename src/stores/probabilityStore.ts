import { defineStore } from 'pinia'
import { computed, reactive } from 'vue'
import type { ChanceGameId, ChanceGameOutcome, RewardIntentCostType } from '../systems/probability/chanceGame'
import type { RewardIntentModifier, GachaRarity, ProbabilityModifierSource } from '../systems/probability/probabilityModifier'
import { CHANCE_GAMES } from '../data/chanceGames'

const PROBABILITY_KEY = 'nz_probability_v1'

// Phase 3.64：安全 hydration 常量。
const VALID_GAME_IDS: ChanceGameId[] = CHANCE_GAMES.map(game => game.id)
const VALID_SOURCES: ProbabilityModifierSource[] = ['pachinko', 'pinball', 'monopoly', 'pity', 'event']
const VALID_APPLIES_TO = ['nextPull', 'tenPull', 'anyPull']
const VALID_APPLIES_TO_COST = ['any', 'paidOnly', 'freeOnly']
const VALID_RARITIES: GachaRarity[] = ['common', 'rare', 'epic', 'legendary']
const MAX_OUTCOMES = 50

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isFiniteNonNegative(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isNonNegativeSafeInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && (value as number) >= 0
}

/** modifier 合法性校验（含枚举与数值边界）。 */
function isValidModifier(value: unknown): boolean {
  if (!isPlainObject(value)) return false
  const m = value as Record<string, unknown>
  if (typeof m.id !== 'string' || m.id === '') return false
  if (typeof m.label !== 'string' || m.label === '') return false
  if (typeof m.source !== 'string' || !VALID_SOURCES.includes(m.source as ProbabilityModifierSource)) return false
  if (m.poolId !== undefined && typeof m.poolId !== 'string') return false
  if (m.appliesTo !== undefined && !VALID_APPLIES_TO.includes(m.appliesTo as string)) return false
  if (m.appliesToCost !== undefined && !VALID_APPLIES_TO_COST.includes(m.appliesToCost as string)) return false
  for (const key of ['rarePlusBonus', 'extraRolls', 'pityBonus', 'chooseOneOfN']) {
    if (m[key] !== undefined && !isFiniteNonNegative(m[key])) return false
  }
  if (m.rarityBonus !== undefined) {
    if (!isPlainObject(m.rarityBonus)) return false
    for (const [rarity, bonus] of Object.entries(m.rarityBonus as Record<string, unknown>)) {
      if (!VALID_RARITIES.includes(rarity as GachaRarity)) return false
      if (!isFiniteNonNegative(bonus)) return false
    }
  }
  return true
}

function normalizeOutcomes(value: unknown): ChanceGameOutcome[] {
  if (!Array.isArray(value)) return []
  const result: ChanceGameOutcome[] = []
  for (const entry of value) {
    if (result.length >= MAX_OUTCOMES) break
    if (!isPlainObject(entry)) continue
    const record = entry as Record<string, unknown>
    if (typeof record.gameId !== 'string' || !VALID_GAME_IDS.includes(record.gameId as ChanceGameId)) continue
    if (typeof record.seed !== 'string' || typeof record.label !== 'string') continue
    if (typeof record.source !== 'string' || !VALID_SOURCES.includes(record.source as ProbabilityModifierSource)) continue
    if (record.route !== undefined && !(Array.isArray(record.route) && record.route.every(r => typeof r === 'string'))) continue
    if (record.score !== undefined && !isFiniteNonNegative(record.score)) continue
    if (record.tokens !== undefined && !isFiniteNonNegative(record.tokens)) continue
    if (record.expectedValueCost !== undefined && !isFiniteNonNegative(record.expectedValueCost)) continue
    if (record.freePulls !== undefined && !isNonNegativeSafeInteger(record.freePulls)) continue
    if (record.jackpot !== undefined && typeof record.jackpot !== 'boolean') continue
    // 明显非法 modifier/audit → 整条 outcome 丢弃（一致策略）
    if (record.modifier !== undefined && !isValidModifier(record.modifier)) continue
    if (record.audit !== undefined && !isPlainObject(record.audit)) continue
    const outcome: ChanceGameOutcome = {
      gameId: record.gameId as ChanceGameId,
      seed: record.seed,
      source: record.source as ProbabilityModifierSource,
      label: record.label
    }
    if (record.route !== undefined) outcome.route = record.route as string[]
    if (record.score !== undefined) outcome.score = record.score as number
    if (record.tokens !== undefined) outcome.tokens = record.tokens as number
    if (record.expectedValueCost !== undefined) outcome.expectedValueCost = record.expectedValueCost as number
    if (record.freePulls !== undefined) outcome.freePulls = record.freePulls as number
    if (record.jackpot !== undefined) outcome.jackpot = record.jackpot as boolean
    if (record.modifier !== undefined) outcome.modifier = record.modifier as ChanceGameOutcome['modifier']
    if (record.audit !== undefined) outcome.audit = record.audit as unknown as ChanceGameOutcome['audit']
    result.push(outcome)
  }
  return result
}

function normalizePendingModifiers(value: unknown): RewardIntentModifier[] {
  if (!Array.isArray(value)) return []
  const result: RewardIntentModifier[] = []
  for (const entry of value) {
    if (!isValidModifier(entry)) continue
    result.push(entry as RewardIntentModifier)
  }
  return result
}

function normalizeBudgetUsageData(value: unknown): Partial<Record<ChanceGameId, ProbabilityBudgetUsage>> {
  if (!isPlainObject(value)) return {}
  const result: Partial<Record<ChanceGameId, ProbabilityBudgetUsage>> = {}
  for (const [gameId, usage] of Object.entries(value)) {
    if (!VALID_GAME_IDS.includes(gameId as ChanceGameId)) continue
    if (!isPlainObject(usage)) continue
    const u = usage as Record<string, unknown>
    if (typeof u.periodKey !== 'string') continue
    if (u.dailyPeriodKey !== undefined && typeof u.dailyPeriodKey !== 'string') continue
    if (u.weeklyPeriodKey !== undefined && typeof u.weeklyPeriodKey !== 'string') continue
    if (!isFiniteNonNegative(u.expectedValue)) continue
    if (!isFiniteNonNegative(u.legendaryRateBonus)) continue
    if (!isFiniteNonNegative(u.pityGain)) continue
    if (!isNonNegativeSafeInteger(u.freePulls)) continue
    if (!isNonNegativeSafeInteger(u.jackpots)) continue
    const normalized: ProbabilityBudgetUsage = {
      periodKey: u.periodKey as string,
      expectedValue: u.expectedValue as number,
      legendaryRateBonus: u.legendaryRateBonus as number,
      pityGain: u.pityGain as number,
      freePulls: u.freePulls as number,
      jackpots: u.jackpots as number
    }
    if (u.dailyPeriodKey !== undefined) normalized.dailyPeriodKey = u.dailyPeriodKey as string
    if (u.weeklyPeriodKey !== undefined) normalized.weeklyPeriodKey = u.weeklyPeriodKey as string
    result[gameId as ChanceGameId] = normalized
  }
  return result
}

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
    let candidate = {
      outcomes: [] as ChanceGameOutcome[],
      pendingModifiers: [] as RewardIntentModifier[],
      budgetUsage: {} as Partial<Record<ChanceGameId, ProbabilityBudgetUsage>>
    }
    try {
      const saved = localStorage.getItem(PROBABILITY_KEY)
      if (saved) {
        const parsed: unknown = JSON.parse(saved)
        if (isPlainObject(parsed)) {
          const record = parsed as Record<string, unknown>
          candidate = {
            outcomes: normalizeOutcomes(record.outcomes),
            pendingModifiers: normalizePendingModifiers(record.pendingModifiers),
            budgetUsage: normalizeBudgetUsageData(record.budgetUsage)
          }
        }
      }
    } catch {
      // getItem / JSON.parse / normalization 异常 → 保持默认 candidate
    }
    // Phase 3.64：全部规范化完成后一次性提交，杜绝部分水合。
    state.outcomes = candidate.outcomes
    state.pendingModifiers = candidate.pendingModifiers
    state.budgetUsage = candidate.budgetUsage
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

  // Phase 3.65：无写盘 outcome 记录（供 LuckyWheel 补偿事务控制提交时机）。
  function applyChanceOutcomeInMemory(outcome: ChanceGameOutcome): boolean {
    if (!canRecordOutcome(outcome)) return false
    applyOutcomeBudget(outcome)
    state.outcomes.unshift(outcome)
    if (outcome.modifier && shouldQueueModifier(outcome.modifier)) {
      state.pendingModifiers.unshift({
        ...outcome.modifier,
        poolId: outcome.modifier.poolId,
        appliesTo: outcome.modifier.appliesTo ?? 'nextPull'
      })
      if (state.pendingModifiers.length > 30) state.pendingModifiers.pop()
    }
    if (state.outcomes.length > 50) state.outcomes.pop()
    return true
  }

  function recordOutcome(outcome: ChanceGameOutcome): boolean {
    if (!applyChanceOutcomeInMemory(outcome)) return false
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

  // Phase 3.62：只改内存、不写盘的 modifier 消耗；供抽卡补偿事务在提交阶段调用。
  function consumeApplicableModifiersInMemory(poolId: string, intent: PullIntent): RewardIntentModifier[] {
    const applicable = getApplicableModifiers(poolId, intent)
    if (applicable.length === 0) return []
    const consumedIds = new Set(applicable.map(modifier => modifier.id))
    state.pendingModifiers = state.pendingModifiers.filter(modifier => !consumedIds.has(modifier.id))
    return applicable
  }

  function consumeApplicableModifiers(poolId: string, intent: PullIntent): RewardIntentModifier[] {
    const applicable = consumeApplicableModifiersInMemory(poolId, intent)
    if (applicable.length > 0) save()
    return applicable
  }

  // Phase 3.62：显式 Probability key 保存（供抽卡补偿事务控制提交时机）。
  function saveProbabilityData() {
    save()
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
    applyChanceOutcomeInMemory,
    addPendingModifier,
    getApplicableModifiers,
    consumeApplicableModifiers,
    consumeApplicableModifiersInMemory,
    saveProbabilityData,
    consumeModifier,
    getOutcomesByGame,
    clear
  }
})
