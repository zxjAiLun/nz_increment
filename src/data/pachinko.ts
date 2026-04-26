export interface PachinkoModifierReward {
  id: string
  name: string
  description: string
  rarity: 'common' | 'rare' | 'epic' | 'legendary'
  rarePlusBonus: number
}

export const PACHINKO_RATES = {
  common: 58,
  rare: 30,
  epic: 10,
  legendary: 2
}

export const PACHINKO_MODIFIERS: PachinkoModifierReward[] = [
  {
    id: 'ten_pull_rare_plus_2',
    name: '十连 rare+ +2%',
    description: '下一次十连每抽 rare+ 概率 +2%',
    rarity: 'common',
    rarePlusBonus: 2
  },
  {
    id: 'ten_pull_rare_plus_4',
    name: '十连 rare+ +4%',
    description: '下一次十连每抽 rare+ 概率 +4%',
    rarity: 'rare',
    rarePlusBonus: 4
  },
  {
    id: 'ten_pull_rare_plus_6',
    name: '十连 rare+ +6%',
    description: '下一次十连每抽 rare+ 概率 +6%',
    rarity: 'epic',
    rarePlusBonus: 6
  },
  {
    id: 'ten_pull_rare_plus_8',
    name: '十连 rare+ +8%',
    description: '下一次十连每抽 rare+ 概率 +8%',
    rarity: 'legendary',
    rarePlusBonus: 8
  }
]
