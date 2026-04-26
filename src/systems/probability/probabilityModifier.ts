import type { GachaReward } from '../../types/gacha'
import type { ProbabilityModifier, RarityRateMap } from './probability'

export type GachaRarity = GachaReward['rarity']
export type ProbabilityModifierSource = 'pachinko' | 'pinball' | 'monopoly' | 'pity' | 'event'

export interface RewardIntentModifier {
  id: string
  source: ProbabilityModifierSource
  label: string
  poolId?: string
  appliesTo?: 'nextPull' | 'tenPull' | 'anyPull'
  appliesToCost?: 'any' | 'paidOnly' | 'freeOnly'
  rarePlusBonus?: number
  rarityBonus?: Partial<Record<GachaRarity, number>>
  extraRolls?: number
  guaranteedMinRarity?: GachaRarity
  pityBonus?: number
  chooseOneOfN?: number
}

export function modifierToAuditRows(modifier: RewardIntentModifier): Array<{ label: string; value: string }> {
  const rows = [{ label: '来源', value: modifier.source }, { label: '效果', value: modifier.label }]
  if (modifier.rarityBonus) {
    for (const [rarity, bonus] of Object.entries(modifier.rarityBonus)) rows.push({ label: `${rarity} 概率`, value: `+${bonus}%` })
  }
  if (modifier.rarePlusBonus) rows.push({ label: 'rare+ 概率', value: `+${modifier.rarePlusBonus}%` })
  if (modifier.extraRolls) rows.push({ label: '额外判定', value: `+${modifier.extraRolls}` })
  if (modifier.guaranteedMinRarity) rows.push({ label: '最低稀有度', value: modifier.guaranteedMinRarity })
  if (modifier.pityBonus) rows.push({ label: '保底进度', value: `+${modifier.pityBonus}` })
  if (modifier.chooseOneOfN) rows.push({ label: '可选奖励', value: `${modifier.chooseOneOfN} 选 1` })
  return rows
}

export function toResolverModifier(modifier: RewardIntentModifier): ProbabilityModifier {
  return {
    id: modifier.id,
    label: modifier.label,
    description: modifierToAuditRows(modifier).map(row => `${row.label}:${row.value}`).join('，'),
    isActive: () => true,
    apply: rates => applyRarityBonus(applyRarePlusBonus(rates, modifier.rarePlusBonus), modifier.rarityBonus)
  }
}

function applyRarePlusBonus(rates: RarityRateMap, bonus?: number): RarityRateMap {
  const amount = Math.max(0, bonus ?? 0)
  if (amount <= 0) return rates

  const rarePlusKeys: GachaRarity[] = ['rare', 'epic', 'legendary']
  const rarePlusTotal = rarePlusKeys.reduce((sum, key) => sum + Math.max(0, rates[key] || 0), 0)
  if (rarePlusTotal <= 0) return rates

  const next: RarityRateMap = { ...rates, common: Math.max(0, (rates.common || 0) - amount) }
  for (const key of rarePlusKeys) {
    next[key] = (next[key] || 0) + amount * Math.max(0, rates[key] || 0) / rarePlusTotal
  }
  return next
}

function applyRarityBonus(rates: RarityRateMap, rarityBonus?: Partial<Record<GachaRarity, number>>): RarityRateMap {
  if (!rarityBonus) return rates
  const next: RarityRateMap = { ...rates }
  let bonusTotal = 0
  for (const [rarity, bonus] of Object.entries(rarityBonus)) {
    const amount = Math.max(0, bonus ?? 0)
    next[rarity] = (next[rarity] || 0) + amount
    bonusTotal += amount
  }
  if (bonusTotal > 0 && next.common !== undefined) next.common = Math.max(0, next.common - bonusTotal)
  return next
}
