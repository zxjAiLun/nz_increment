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

// T95 扩展天赋
export const EXTENDED_TALENTS: Talent[] = [
  // 攻击系扩展
  { id: 'talent_heavy_strike', name: '重击', description: '攻击力+8%', type: 'passive', tier: 1, effect: { stat: 'attack', value: 8 }, cost: 1 },
  { id: 'talent_blade_master', name: '刀术大师', description: '持武时攻击+12%', type: 'passive', tier: 2, prerequisite: 'talent_power_strike', effect: { stat: 'attack', value: 12 }, cost: 2 },
  { id: 'talent_executioner', name: '处刑人', description: '对HP<30%的敌人伤害+25%', type: 'passive', tier: 3, effect: { stat: 'executeDamage', value: 25 }, cost: 3 },
  { id: 'talent_bloodlust', name: '血嗜', description: '击杀回复5%HP', type: 'passive', tier: 2, effect: { stat: 'killHeal', value: 5 }, cost: 2 },
  
  // 防御系扩展
  { id: 'talent_iron_skin', name: '铁皮', description: '受到伤害-5%', type: 'passive', tier: 1, effect: { stat: 'damageReduction', value: 5 }, cost: 1 },
  { id: 'talent_armor_master', name: '护甲大师', description: '护甲效果+15%', type: 'passive', tier: 2, prerequisite: 'talent_toughness', effect: { stat: 'armorEffect', value: 15 }, cost: 2 },
  { id: 'talent_immortal', name: '不朽', description: '死亡时30%概率复活', type: 'passive', tier: 4, effect: { stat: 'reviveChance', value: 30 }, cost: 4 },
  { id: 'talent_reflect', name: '反伤', description: '受到攻击时反弹10%伤害', type: 'passive', tier: 3, effect: { stat: 'damageReflect', value: 10 }, cost: 3 },
  
  // 速度系扩展
  { id: 'talent_swift', name: '迅捷', description: '速度+10%', type: 'passive', tier: 1, effect: { stat: 'speed', value: 10 }, cost: 1 },
  { id: 'talent_first_strike', name: '先发制人', description: '战斗开始时ATB+20%', type: 'passive', tier: 2, effect: { stat: 'firstStrike', value: 20 }, cost: 2 },
  { id: 'talent_flurry', name: '连击', description: '攻击速度+15%', type: 'passive', tier: 3, effect: { stat: 'attackSpeed', value: 15 }, cost: 3 },
  
  // 暴击系扩展
  { id: 'talent_precision', name: '精准', description: '命中率+10%', type: 'passive', tier: 1, effect: { stat: 'accuracy', value: 10 }, cost: 1 },
  { id: 'talent_deadly_aim', name: '致命瞄准', description: '暴击率+8%', type: 'passive', tier: 2, prerequisite: 'talent_crit_master', effect: { stat: 'critRate', value: 8 }, cost: 2 },
  { id: 'talent_explosive_crit', name: '爆裂暴击', description: '暴击时额外造成50%伤害', type: 'passive', tier: 4, effect: { stat: 'critBonus', value: 50 }, cost: 4 },
  
  // 生命系扩展
  { id: 'talent_regeneration', name: '回复', description: '每回合回复3%HP', type: 'passive', tier: 1, effect: { stat: 'regen', value: 3 }, cost: 1 },
  { id: 'talent_giant', name: '巨人', description: 'HP上限+15%', type: 'passive', tier: 2, prerequisite: 'talent_vitality', effect: { stat: 'maxHp', value: 15 }, cost: 2 },
  { id: 'talent_second_wind', name: '第二呼吸', description: 'HP<20%时自动回复10%HP(每副本一次)', type: 'passive', tier: 3, effect: { stat: 'secondWind', value: 10 }, cost: 3 },
  
  // 幸运系扩展
  { id: 'talent_fortune', name: '幸运', description: '幸运值+15%', type: 'passive', tier: 1, effect: { stat: 'luck', value: 15 }, cost: 1 },
  { id: 'talent_critical_luck', name: '暴击幸运', description: '暴击率+5%, 幸运值影响暴击', type: 'passive', tier: 2, effect: { stat: 'critRate', value: 5 }, cost: 2 },
  { id: 'talent_drop_boost', name: '掉落提升', description: '金币和装备掉落率+20%', type: 'passive', tier: 3, effect: { stat: 'dropRate', value: 20 }, cost: 3 },
]
