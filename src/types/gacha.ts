export type GachaPoolType = 'limited' | 'permanent'
export type GachaRewardType = 'skill' | 'passive' | 'statFragment' | 'diamond' | 'material' | 'gold' | 'equip'

export interface GachaReward {
  id: string
  type: GachaRewardType
  name: string
  value: number  // 数量或等级
  rarity: 'common' | 'rare' | 'epic' | 'legendary'
  description?: string
}

export interface GachaPool {
  id: string
  name: string
  type: GachaPoolType
  description: string
  theme?: string  // 限定池主题，如"深渊征服者"
  cost: number  // 抽一次需要的钻石数量
  pity: {
    target: number  // 保底阈值，默认90
    softPity: number  // 软保底开始抽数，默认80
  }
  rewards: GachaReward[]
  rates: {
    common: number
    rare: number
    epic: number
    legendary: number
  }
}

export interface GachaRecord {
  timestamp: number
  poolId: string
  result: GachaReward
  isPity: boolean  // 是否触发保底
}

export interface GachaState {
  pityCounters: Record<string, number>  // 每个池的抽数
  lastDailyFree: Record<string, number>  // 每个池上次免费时间
  history: GachaRecord[]
}
