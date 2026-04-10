import type { EquipmentSlot, StatType } from '../types'

// T37.1 套装突破数据
export interface EquipmentSetBreakthrough {
  level: number       // 突破等级 0-3
  material: string
  cost: number        // 金币
  statMultiplier: number  // 属性倍率
}

export const SET_BREAKTHROUGH: { [setId: string]: EquipmentSetBreakthrough[] } = {
  'berserker': [
    { level: 1, material: 'berserker_shard_1', cost: 5000, statMultiplier: 1.1 },
    { level: 2, material: 'berserker_shard_2', cost: 15000, statMultiplier: 1.25 },
    { level: 3, material: 'berserker_shard_3', cost: 50000, statMultiplier: 1.5 },
  ],
  'guardian': [
    { level: 1, material: 'guardian_shard_1', cost: 5000, statMultiplier: 1.1 },
    { level: 2, material: 'guardian_shard_2', cost: 15000, statMultiplier: 1.25 },
    { level: 3, material: 'guardian_shard_3', cost: 50000, statMultiplier: 1.5 },
  ],
  'sorcerer': [
    { level: 1, material: 'sorcerer_shard_1', cost: 5000, statMultiplier: 1.1 },
    { level: 2, material: 'sorcerer_shard_2', cost: 15000, statMultiplier: 1.25 },
    { level: 3, material: 'sorcerer_shard_3', cost: 50000, statMultiplier: 1.5 },
  ],
  'assassin': [
    { level: 1, material: 'assassin_shard_1', cost: 5000, statMultiplier: 1.1 },
    { level: 2, material: 'assassin_shard_2', cost: 15000, statMultiplier: 1.25 },
    { level: 3, material: 'assassin_shard_3', cost: 50000, statMultiplier: 1.5 },
  ],
  'paladin': [
    { level: 1, material: 'paladin_shard_1', cost: 5000, statMultiplier: 1.1 },
    { level: 2, material: 'paladin_shard_2', cost: 15000, statMultiplier: 1.25 },
    { level: 3, material: 'paladin_shard_3', cost: 50000, statMultiplier: 1.5 },
  ],
}

export interface SetEffect {
  description: string
  stat?: { stat: StatType; value: number; type: 'flat' | 'percent' }
  special?: string
}

export interface EquipmentSetDefinition {
  id: string
  name: string
  slots: EquipmentSlot[]  // 触发套装所需的装备槽位
  effects: {
    2?: SetEffect   // 2件套效果
    3?: SetEffect   // 3件套效果
    5?: SetEffect   // 5件套效果
  }
}

export const EQUIPMENT_SETS: EquipmentSetDefinition[] = [
  {
    id: 'warrior_power',
    name: '战士之力',
    slots: ['weapon', 'chest', 'boots'],
    effects: {
      2: { description: '攻击+10%', stat: { stat: 'attack', value: 10, type: 'percent' } },
      3: { description: '生命偷取+5%', special: 'lifesteal' },
      5: { description: '必杀一击：暴击伤害+50%', stat: { stat: 'critDamage', value: 50, type: 'flat' } }
    }
  },
  {
    id: 'ranger_agility',
    name: '游侠敏捷',
    slots: ['weapon', 'ringLeft', 'neck'],
    effects: {
      2: { description: '攻速+8%', stat: { stat: 'attackSpeed', value: 8, type: 'percent' } },
      3: { description: '暴击+5%', stat: { stat: 'critRate', value: 5, type: 'flat' } },
      5: { description: '连击触发：combo+1 per hit' }
    }
  },
  {
    id: 'mage_wisdom',
    name: '法师智慧',
    slots: ['weapon', 'robe', 'hat'],
    effects: {
      2: { description: '技能伤害+15%', stat: { stat: 'skillDamageBonus', value: 15, type: 'percent' } },
      3: { description: '冷却缩减+10%', stat: { stat: 'cooldownReduction', value: 10, type: 'percent' } },
      5: { description: '奥术飞弹：技能攻击额外发射魔法弹' }
    }
  },
  {
    id: 'abyss_conqueror',
    name: '深渊征服者',
    slots: ['weapon', 'accessory', 'boots'],
    effects: {
      2: { description: '穿透+10', stat: { stat: 'penetration', value: 10, type: 'flat' } },
      3: { description: '真实伤害+5%', stat: { stat: 'trueDamage', value: 5, type: 'percent' } },
      5: { description: '深渊祝福：全属性+5%' }
    }
  },
  {
    id: 'eternal_guardian',
    name: '永恒守护',
    slots: ['chest', 'shield', 'robe'],
    effects: {
      2: { description: '防御+15%', stat: { stat: 'defense', value: 15, type: 'percent' } },
      3: { description: '减伤+8%', stat: { stat: 'damageReduction', value: 8, type: 'percent' } },
      5: { description: '免疫一次致命伤/30s', special: 'immortal_shield' }
    }
  },
  // 突破系统套装（独立于原有套装）
  {
    id: 'berserker',
    name: '狂战士',
    slots: ['weapon', 'chest', 'boots', 'ringLeft', 'ringRight'],
    effects: {
      2: { description: '攻击+15%' },
      3: { description: '暴击+8%' },
      5: { description: '嗜血：生命低于30%时伤害+30%' }
    }
  },
  {
    id: 'guardian',
    name: '守护者',
    slots: ['chest', 'shield', 'robe', 'accessory', 'neck'],
    effects: {
      2: { description: '防御+20%' },
      3: { description: '减伤+10%' },
      5: { description: '钢铁壁垒：受到致命伤害时免疫一次' }
    }
  },
  {
    id: 'sorcerer',
    name: '巫师',
    slots: ['weapon', 'robe', 'hat', 'ringLeft', 'ringRight'],
    effects: {
      2: { description: '技能伤害+20%' },
      3: { description: '冷却缩减+15%' },
      5: { description: '奥术精通：技能额外发射追踪魔法弹' }
    }
  },
  {
    id: 'assassin',
    name: '刺客',
    slots: ['weapon', 'boots', 'accessory', 'ringLeft', 'ringRight'],
    effects: {
      2: { description: '攻速+12%' },
      3: { description: '闪避+10%' },
      5: { description: '暗影步伐：闪避成功后下次攻击必定暴击' }
    }
  },
  {
    id: 'paladin',
    name: '圣骑士',
    slots: ['chest', 'shield', 'boots', 'accessory', 'neck'],
    effects: {
      2: { description: '生命+25%' },
      3: { description: '治疗效果+20%' },
      5: { description: '神圣庇护：队伍成员受到致命伤害时代替其承受50%' }
    }
  },
]
