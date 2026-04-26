import type { BuildTarget } from '../types/navigation'

export type LuckyWheelRewardType = 'pity' | 'rarePlus' | 'gachaTicket' | 'buildToken'

export interface LuckyWheelReward {
  id: string
  name: string
  description: string
  rarity: 'common' | 'rare' | 'epic' | 'legendary'
  type: LuckyWheelRewardType
  value: number
  buildTarget?: BuildTarget
}

export const LUCKY_WHEEL_ID = 'daily_lucky_wheel'

export const LUCKY_WHEEL_RATES = {
  common: 65,
  rare: 25,
  epic: 9,
  legendary: 1
}

export const LUCKY_WHEEL_REWARDS: LuckyWheelReward[] = [
  {
    id: 'pity_plus_1',
    name: '保底 +1',
    description: '常驻奖池保底进度 +1',
    rarity: 'common',
    type: 'pity',
    value: 1
  },
  {
    id: 'pity_plus_3',
    name: '保底 +3',
    description: '常驻奖池保底进度 +3',
    rarity: 'rare',
    type: 'pity',
    value: 3
  },
  {
    id: 'rare_plus_5',
    name: 'rare+ 概率 +5%',
    description: '下一次常驻抽卡 rare+ 概率 +5%',
    rarity: 'rare',
    type: 'rarePlus',
    value: 5
  },
  {
    id: 'gacha_ticket_1',
    name: '抽卡券 x1',
    description: '获得 1 张抽卡券',
    rarity: 'epic',
    type: 'gachaTicket',
    value: 1
  },
  {
    id: 'token_speed_skill',
    name: '极速技能 token',
    description: '获得 1 个极速技能流派 token',
    rarity: 'legendary',
    type: 'buildToken',
    value: 1,
    buildTarget: 'speedSkill'
  },
  {
    id: 'token_luck_treasure',
    name: '幸运寻宝 token',
    description: '获得 1 个幸运寻宝流派 token',
    rarity: 'epic',
    type: 'buildToken',
    value: 1,
    buildTarget: 'luckTreasure'
  },
  {
    id: 'token_crit_burst',
    name: '暴击爆发 token',
    description: '获得 1 个暴击爆发流派 token',
    rarity: 'epic',
    type: 'buildToken',
    value: 1,
    buildTarget: 'critBurst'
  }
]
