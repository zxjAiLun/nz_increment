export interface Talent {
  id: string
  name: string
  description: string
  type: 'active' | 'passive'
  tier: number        // 1-5
  prerequisite?: string
  effect: { stat?: string; value?: number; skill?: string }
  cost: number        // 天赋点消耗
}

export const TALENTS: Talent[] = [
  // Tier 1
  { id: 'talent_power_strike', name: '强力打击', description: '攻击力+5%', type: 'passive', tier: 1, effect: { stat: 'attack', value: 5 }, cost: 1 },
  { id: 'talent_toughness', name: '坚韧', description: '防御力+5%', type: 'passive', tier: 1, effect: { stat: 'defense', value: 5 }, cost: 1 },
  { id: 'talent_vitality', name: '活力', description: '最大HP+8%', type: 'passive', tier: 1, effect: { stat: 'maxHp', value: 8 }, cost: 1 },
  // Tier 2
  { id: 'talent_crit_master', name: '暴击大师', description: '暴击率+5%', type: 'passive', tier: 2, prerequisite: 'talent_power_strike', effect: { stat: 'critRate', value: 5 }, cost: 2 },
  { id: 'talent_lifesteal', name: '生命偷取', description: '生命偷取+3%', type: 'passive', tier: 2, prerequisite: 'talent_toughness', effect: { stat: 'lifesteal', value: 3 }, cost: 2 },
  // Tier 3
  { id: 'talent_fireball', name: '火球术', description: '释放火球造成150%攻击力伤害', type: 'active', tier: 3, prerequisite: 'talent_power_strike', effect: { skill: 'fireball' }, cost: 3 },
  { id: 'talent_shield', name: '护盾', description: '生成护盾抵挡100点伤害', type: 'active', tier: 3, prerequisite: 'talent_toughness', effect: { skill: 'shield' }, cost: 3 },
  // Tier 4
  { id: 'talent_crit_mastery', name: '暴击精通', description: '暴击伤害+15%', type: 'passive', tier: 4, prerequisite: 'talent_crit_master', effect: { stat: 'critDamage', value: 15 }, cost: 3 },
  // Tier 5
  { id: 'talent_ultimate_power', name: '终极力量', description: '所有属性+10%', type: 'passive', tier: 5, prerequisite: 'talent_crit_mastery', effect: { stat: 'allStats', value: 10 }, cost: 5 },
]
