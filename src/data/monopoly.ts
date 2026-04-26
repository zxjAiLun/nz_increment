import type { BuildTarget } from '../types/navigation'

export type MonopolyRewardType = 'gold' | 'material' | 'gachaTicket' | 'pity' | 'rarePlus' | 'buildToken'

export interface MonopolyReward {
  id: string
  rarity: 'common' | 'rare' | 'epic' | 'legendary'
  name: string
  description: string
  type: MonopolyRewardType
  value: number
  buildTarget?: BuildTarget
}

export interface MonopolyBoss {
  name: string
  requiredPower: number
  rewards: MonopolyReward[]
}

export type MonopolyTileType = 'start' | 'reward' | 'boss'

export interface MonopolyTile {
  id: string
  index: number
  type: MonopolyTileType
  name: string
  reward?: MonopolyReward
  boss?: MonopolyBoss
}

export const MONOPOLY_BOARD_SIZE = 20
export const DAILY_MONOPOLY_DICE = 3

export const MONOPOLY_REWARD_RATES = {
  common: 58,
  rare: 30,
  epic: 10,
  legendary: 2
}

export const MONOPOLY_REWARDS: MonopolyReward[] = [
  { id: 'gold_1500', rarity: 'common', name: '金币补给', description: '金币 +1500', type: 'gold', value: 1500 },
  { id: 'material_3', rarity: 'common', name: '材料补给', description: '材料 +3', type: 'material', value: 3 },
  { id: 'pity_1', rarity: 'common', name: '保底推进', description: '常驻保底 +1', type: 'pity', value: 1 },
  { id: 'pity_3', rarity: 'rare', name: '保底跃迁', description: '常驻保底 +3', type: 'pity', value: 3 },
  { id: 'rare_plus_5', rarity: 'rare', name: '概率路标', description: '下一次常驻抽卡 rare+ +5%', type: 'rarePlus', value: 5 },
  { id: 'ticket_1', rarity: 'epic', name: '抽卡券', description: '抽卡券 +1', type: 'gachaTicket', value: 1 },
  { id: 'token_crit', rarity: 'epic', name: '暴击流 token', description: '暴击爆发 token +1', type: 'buildToken', value: 1, buildTarget: 'critBurst' },
  { id: 'token_armor', rarity: 'epic', name: '破甲流 token', description: '破甲真伤 token +1', type: 'buildToken', value: 1, buildTarget: 'armorTrueDamage' },
  { id: 'token_speed', rarity: 'legendary', name: '极速技能 token', description: '极速技能 token +1', type: 'buildToken', value: 1, buildTarget: 'speedSkill' },
  { id: 'token_luck', rarity: 'legendary', name: '幸运寻宝 token', description: '幸运寻宝 token +1', type: 'buildToken', value: 1, buildTarget: 'luckTreasure' }
]

export function createMonopolyBoss(index: number): MonopolyBoss {
  return {
    name: index >= 15 ? '周常守门人' : '资源守卫',
    requiredPower: index >= 15 ? 1800 : 900,
    rewards: [
      { id: `boss_ticket_${index}`, rarity: 'epic', name: 'Boss抽卡券', description: '抽卡券 +1', type: 'gachaTicket', value: 1 },
      { id: `boss_pity_${index}`, rarity: 'rare', name: 'Boss保底推进', description: '常驻保底 +3', type: 'pity', value: 3 }
    ]
  }
}
