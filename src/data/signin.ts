export interface SigninReward {
  day: number       // 第几天
  type: 'gold' | 'diamond' | 'material'
  amount: number
  itemId?: string
}

export const SIGNIN_REWARDS: SigninReward[] = [
  { day: 1, type: 'gold', amount: 100 },
  { day: 2, type: 'gold', amount: 150 },
  { day: 3, type: 'diamond', amount: 5 },
  { day: 4, type: 'gold', amount: 200 },
  { day: 5, type: 'diamond', amount: 10 },
  { day: 6, type: 'gold', amount: 300 },
  { day: 7, type: 'diamond', amount: 20 },  // 周奖励
]

export const SIGNIN_CYCLE = 7  // 7天循环
