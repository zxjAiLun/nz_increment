import type { ConditionalPassiveEffect } from '../types'

export const PASSIVE_SKILLS: ConditionalPassiveEffect[] = [
  {
    id: 'bloodlust',
    name: '血战',
    description: 'HP < 30% 时，受到伤害 -20%',
    type: 'conditional',
    condition: { field: 'hpPercent', operator: '<', value: 30 },
    effect: { stat: 'damageReduction', value: 20, type: 'percent' },
    priority: 1
  },
  {
    id: 'combo_fury',
    name: '连击狂热',
    description: 'combo > 5 时，伤害 +25%',
    type: 'conditional',
    condition: { field: 'combo', operator: '>', value: 5 },
    effect: { stat: 'attack', value: 25, type: 'percent' },
    priority: 2
  },
  {
    id: 'boss_slayer',
    name: 'Boss杀手',
    description: '对BOSS伤害 +30%',
    type: 'conditional',
    condition: { field: 'isBoss', operator: '==', value: 1 },
    effect: { stat: 'damageBonusIII', value: 30, type: 'percent' },
    priority: 3
  },
  {
    id: 'first_strike',
    name: '先发制人',
    description: '战斗第1回合，伤害 +20%',
    type: 'conditional',
    condition: { field: 'turnCount', operator: '==', value: 1 },
    effect: { stat: 'attack', value: 20, type: 'percent' },
    priority: 4
  },
  {
    id: 'pearlessence',
    name: '珍珠之守护',
    description: 'HP > 80% 时，防御 +15%',
    type: 'conditional',
    condition: { field: 'hpPercent', operator: '>', value: 80 },
    effect: { stat: 'defense', value: 15, type: 'percent' },
    priority: 5
  },
  {
    id: 'swift_attack',
    name: '疾风攻击',
    description: '速度 > 100 时，暴击率 +10%',
    type: 'conditional',
    condition: { field: 'speed', operator: '>', value: 100 },
    effect: { stat: 'critRate', value: 10, type: 'flat' },
    priority: 6
  },
  {
    id: 'crit_lifesteal',
    name: '暴击吸血',
    description: '暴击率 >= 50% 时，回复造成伤害的 10%',
    type: 'conditional',
    condition: { field: 'critRate', operator: '>=', value: 50 },
    effect: { stat: 'critDamage', value: 10, type: 'flat', special: 'lifesteal' },
    priority: 7
  },
  {
    id: 'anti_boss',
    name: '反Boss专家',
    description: '对BOSS穿透 +30',
    type: 'conditional',
    condition: { field: 'isBoss', operator: '==', value: 1 },
    effect: { stat: 'penetration', value: 30, type: 'flat' },
    priority: 8
  },
  {
    id: 'low_hp_fury',
    name: '低血狂暴',
    description: 'HP < 50% 时，攻击 +15%',
    type: 'conditional',
    condition: { field: 'hpPercent', operator: '<', value: 50 },
    effect: { stat: 'attack', value: 15, type: 'percent' },
    priority: 9
  },
  {
    id: 'damage_shield',
    name: '伤害护盾',
    description: '每回合开始时，抵消下一次受到的伤害的 5%',
    type: 'static',
    effect: { stat: 'damageReduction', value: 5, type: 'percent' },
    priority: 10
  },
]
