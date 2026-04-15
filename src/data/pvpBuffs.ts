export interface PvpBuff {
  id: string
  name: string
  description: string
  effect: { stat: string; value: number }[]
}

export const PVP_BUFFS: PvpBuff[] = [
  {
    id: 'pvp_atk',
    name: '进攻强化',
    description: '攻击+15%',
    effect: [{ stat: 'attack', value: 15 }],
  },
  {
    id: 'pvp_def',
    name: '防御强化',
    description: '防御+20%',
    effect: [{ stat: 'defense', value: 20 }],
  },
  {
    id: 'pvp_crit',
    name: '暴击强化',
    description: '暴击率+10%',
    effect: [{ stat: 'critRate', value: 10 }],
  },
  {
    id: 'pvp_hp',
    name: '生命强化',
    description: '最大HP+25%',
    effect: [{ stat: 'maxHp', value: 25 }],
  },
]
