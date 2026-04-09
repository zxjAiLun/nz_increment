import type { EquipmentSlot, StatType } from '../types'

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
]
