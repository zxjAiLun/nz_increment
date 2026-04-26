import type { GachaReward } from '../../types/gacha'
import type { ProbabilityAudit } from './probabilityAudit'
import type { GachaRarity, ProbabilityModifierSource, RewardIntentModifier } from './probabilityModifier'

export type RewardIntentAction = 'gacha' | 'loot' | 'eventReward'
export type RewardIntentCostType = 'diamond' | 'ticket' | 'free'
export type ChanceGameId = 'pachinko' | 'pinball' | 'monopoly' | 'luckyWheel'

export interface RewardIntent {
  id: string
  poolId: string
  action: RewardIntentAction
  costType: RewardIntentCostType
  count: number
  seed: string
}

export type ChanceGameModifier = RewardIntentModifier

export interface RewardResolution {
  rewards: GachaReward[]
  consumedCost: number
  pityBefore: number
  pityAfter: number
  modifiers: ChanceGameModifier[]
  audit: Array<{ label: string; value: string }>
  seed: string
}

export interface ChanceGameOutcome {
  gameId: ChanceGameId
  seed: string
  source: ProbabilityModifierSource
  label: string
  route?: string[]
  score?: number
  tokens?: number
  expectedValueCost?: number
  freePulls?: number
  jackpot?: boolean
  modifier?: ChanceGameModifier
  audit?: ProbabilityAudit
}

export interface ChanceGameBudget {
  expectedValueBudget: number
  maxLegendaryRateBonus: number
  maxPityGainPerDay: number
  maxFreePullsPerWeek: number
  maxJackpotPerWeek: number
}

export interface ChanceGameDefinition {
  id: ChanceGameId
  name: string
  cadence: 'prePull' | 'shortRun' | 'daily' | 'weekly'
  output: 'modifier' | 'token' | 'route' | 'bonus'
  description: string
  allowedModifierSources: ProbabilityModifierSource[]
  budget: ChanceGameBudget
}

export function createRarityBonusModifier(params: {
  id: string
  source: ProbabilityModifierSource
  label: string
  rarity: GachaRarity
  bonus: number
}): ChanceGameModifier {
  return {
    id: params.id,
    source: params.source,
    label: params.label,
    rarityBonus: { [params.rarity]: params.bonus }
  }
}
