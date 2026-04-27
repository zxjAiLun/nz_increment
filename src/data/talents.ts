import type { StatType } from '../types'

export type TalentBranchId = 'survival' | 'combat' | 'treasure'
export type TalentEffectType = 'flat' | 'percent'
export type TalentSpecialEffect =
  | 'deathSetbackReduction'
  | 'safeModeBonusSeconds'
  | 'fatigueReductionPercent'
  | 'goldBonusPercent'
  | 'equipmentDropBonusPercent'
  | 'rarityBonus'

export interface TalentEffect {
  stat?: StatType
  special?: TalentSpecialEffect
  value: number
  type?: TalentEffectType
}

export interface TalentNode {
  id: string
  branch: TalentBranchId
  name: string
  description: string
  tier: number
  maxLevel: number
  costPerLevel: number
  prerequisites?: string[]
  effects: TalentEffect[]
}

export interface TalentBranch {
  id: TalentBranchId
  name: string
  summary: string
}

// Compatibility shape for old call sites.
export interface Talent {
  id: string
  name: string
  description: string
  type: 'active' | 'passive'
  tier: number
  prerequisite?: string
  effect: { stat?: string; value?: number; skill?: string }
  cost: number
}

export const TALENT_BRANCHES: TalentBranch[] = [
  { id: 'survival', name: '生存树', summary: '回复、格挡和死亡保护，解决挂机必死问题。' },
  { id: 'combat', name: '战斗树', summary: '攻击、命中和暴击，提升推图速度。' },
  { id: 'treasure', name: '寻宝树', summary: '金币、掉装和稀有度，提高挂机收益但占用战斗点数。' }
]

export const TALENT_NODES: TalentNode[] = [
  { id: 'survival_regen', branch: 'survival', name: '生命再生', description: '每秒回复 +0.1% 最大生命。', tier: 1, maxLevel: 5, costPerLevel: 1, effects: [{ stat: 'hpRegenPercent', value: 0.1, type: 'flat' }] },
  { id: 'survival_breath', branch: 'survival', name: '战后喘息', description: '击杀回复 +2% 最大生命。', tier: 1, maxLevel: 5, costPerLevel: 1, effects: [{ stat: 'killHealPercent', value: 2, type: 'flat' }] },
  { id: 'survival_vitality', branch: 'survival', name: '坚韧体魄', description: '最大生命 +3%。', tier: 1, maxLevel: 5, costPerLevel: 1, effects: [{ stat: 'maxHp', value: 3, type: 'percent' }] },
  { id: 'survival_block', branch: 'survival', name: '基础格挡', description: '格挡率 +1.5%。', tier: 1, maxLevel: 5, costPerLevel: 1, effects: [{ stat: 'blockChance', value: 1.5, type: 'flat' }] },
  { id: 'survival_retreat', branch: 'survival', name: '后撤战术', description: '死亡后退层数 -1。', tier: 2, maxLevel: 3, costPerLevel: 2, prerequisites: ['survival_breath'], effects: [{ special: 'deathSetbackReduction', value: 1 }] },
  { id: 'survival_recovery', branch: 'survival', name: '安全复苏', description: '死亡保护时间 +2 秒。', tier: 2, maxLevel: 3, costPerLevel: 2, prerequisites: ['survival_regen'], effects: [{ special: 'safeModeBonusSeconds', value: 2 }] },
  { id: 'survival_fatigue', branch: 'survival', name: '疲劳抵抗', description: '死亡疲劳效果降低 10%。', tier: 2, maxLevel: 3, costPerLevel: 2, prerequisites: ['survival_vitality'], effects: [{ special: 'fatigueReductionPercent', value: 10 }] },
  { id: 'survival_bloodstand', branch: 'survival', name: '血战到底', description: '低血构筑核心：生命偷取 +5%，伤害减免 +8%。', tier: 3, maxLevel: 1, costPerLevel: 4, prerequisites: ['survival_retreat', 'survival_recovery'], effects: [{ stat: 'lifesteal', value: 5, type: 'flat' }, { stat: 'damageReduction', value: 8, type: 'flat' }] },

  { id: 'combat_attack', branch: 'combat', name: '攻击训练', description: '攻击 +3%。', tier: 1, maxLevel: 5, costPerLevel: 1, effects: [{ stat: 'attack', value: 3, type: 'percent' }] },
  { id: 'combat_accuracy', branch: 'combat', name: '精准打击', description: '命中 +2%。', tier: 1, maxLevel: 5, costPerLevel: 1, effects: [{ stat: 'accuracy', value: 2, type: 'flat' }] },
  { id: 'combat_crit', branch: 'combat', name: '致命节奏', description: '暴击率 +1.5%。', tier: 1, maxLevel: 5, costPerLevel: 1, effects: [{ stat: 'critRate', value: 1.5, type: 'flat' }] },
  { id: 'combat_speed', branch: 'combat', name: '追击步伐', description: '速度 +2%。', tier: 1, maxLevel: 5, costPerLevel: 1, effects: [{ stat: 'speed', value: 2, type: 'percent' }] },
  { id: 'combat_killrush', branch: 'combat', name: '击杀亢奋', description: '攻击 +2%，击杀回复 +1%。', tier: 2, maxLevel: 5, costPerLevel: 2, prerequisites: ['combat_attack'], effects: [{ stat: 'attack', value: 2, type: 'percent' }, { stat: 'killHealPercent', value: 1, type: 'flat' }] },
  { id: 'combat_focus', branch: 'combat', name: '破绽追击', description: '技能伤害 +5%。', tier: 2, maxLevel: 5, costPerLevel: 2, prerequisites: ['combat_accuracy'], effects: [{ stat: 'skillDamageBonus', value: 5, type: 'flat' }] },
  { id: 'combat_core', branch: 'combat', name: '连杀爆发', description: '战斗核心：攻击 +10%，暴击伤害 +20%。', tier: 3, maxLevel: 1, costPerLevel: 4, prerequisites: ['combat_killrush', 'combat_crit'], effects: [{ stat: 'attack', value: 10, type: 'percent' }, { stat: 'critDamage', value: 20, type: 'flat' }] },

  { id: 'treasure_gold', branch: 'treasure', name: '财富嗅觉', description: '金币收益 +4%。', tier: 1, maxLevel: 5, costPerLevel: 1, effects: [{ special: 'goldBonusPercent', value: 4 }] },
  { id: 'treasure_drop', branch: 'treasure', name: '装备猎手', description: '装备掉率 +2%。', tier: 1, maxLevel: 5, costPerLevel: 1, effects: [{ special: 'equipmentDropBonusPercent', value: 2 }] },
  { id: 'treasure_quality', branch: 'treasure', name: '品质直觉', description: '稀有度加成 +0.5。', tier: 1, maxLevel: 5, costPerLevel: 1, effects: [{ special: 'rarityBonus', value: 0.5 }] },
  { id: 'treasure_luck', branch: 'treasure', name: '好运体质', description: '幸运 +4%。', tier: 1, maxLevel: 5, costPerLevel: 1, effects: [{ stat: 'luck', value: 4, type: 'percent' }] },
  { id: 'treasure_filter', branch: 'treasure', name: '词条筛选', description: '稀有度加成 +1，装备掉率 +1%。', tier: 2, maxLevel: 5, costPerLevel: 2, prerequisites: ['treasure_quality'], effects: [{ special: 'rarityBonus', value: 1 }, { special: 'equipmentDropBonusPercent', value: 1 }] },
  { id: 'treasure_trade', branch: 'treasure', name: '商路熟手', description: '金币收益 +6%，幸运 +3%。', tier: 2, maxLevel: 5, costPerLevel: 2, prerequisites: ['treasure_gold'], effects: [{ special: 'goldBonusPercent', value: 6 }, { stat: 'luck', value: 3, type: 'percent' }] },
  { id: 'treasure_core', branch: 'treasure', name: '宝藏直觉', description: '寻宝核心：金币收益 +15%，稀有度加成 +2。', tier: 3, maxLevel: 1, costPerLevel: 4, prerequisites: ['treasure_filter', 'treasure_trade'], effects: [{ special: 'goldBonusPercent', value: 15 }, { special: 'rarityBonus', value: 2 }] }
]

export const TALENTS: Talent[] = TALENT_NODES.map(node => ({
  id: node.id,
  name: node.name,
  description: node.description,
  type: 'passive',
  tier: node.tier,
  prerequisite: node.prerequisites?.[0],
  effect: node.effects[0]?.stat
    ? { stat: node.effects[0].stat, value: node.effects[0].value }
    : { stat: node.effects[0]?.special, value: node.effects[0]?.value },
  cost: node.costPerLevel
}))
