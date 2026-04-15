import type { StatType } from './index'

export type StarLevel = 1 | 2 | 3 | 4 | 5 | 6
export type AscensionPhase = 0 | 1 | 2 | 3 | 4 | 5 | 6

export interface ConstellationNode {
  id: string
  position: number  // 1-6
  name: string
  description: string
  unlockCost: { type: string; amount: number }
  passiveEffect: {
    stat?: StatType
    value?: number
    type?: 'flat' | 'percent'
  }
}

export interface CharacterCultivation {
  starLevel: StarLevel
  ascensionPhase: AscensionPhase
  constellationNodes: boolean[]  // 6 nodes, true=unlocked
  starExp: number  // 当前星级经验
}

export const CONSTELLATION_TREE: ConstellationNode[] = [
  { id: 'c1', position: 1, name: '星魂之力', description: '攻击+5%', unlockCost: { type: 'starSoul', amount: 10 }, passiveEffect: { stat: 'attack', value: 5, type: 'percent' } },
  { id: 'c2', position: 2, name: '星魂护盾', description: '防御+5%', unlockCost: { type: 'starSoul', amount: 10 }, passiveEffect: { stat: 'defense', value: 5, type: 'percent' } },
  { id: 'c3', position: 3, name: '星魂意志', description: '生命+5%', unlockCost: { type: 'starSoul', amount: 15 }, passiveEffect: { stat: 'maxHp', value: 5, type: 'percent' } },
  { id: 'c4', position: 4, name: '星魂疾风', description: '速度+5%', unlockCost: { type: 'starSoul', amount: 15 }, passiveEffect: { stat: 'speed', value: 5, type: 'percent' } },
  { id: 'c5', position: 5, name: '星魂暴击', description: '暴击率+3%', unlockCost: { type: 'starSoul', amount: 20 }, passiveEffect: { stat: 'critRate', value: 3 } },
  { id: 'c6', position: 6, name: '星魂终解', description: '全属性+10%', unlockCost: { type: 'starSoul', amount: 30 }, passiveEffect: { stat: 'attack', value: 10, type: 'percent' } },
]

// 星级属性倍率表
export const STAR_MULTIPLIERS: Record<StarLevel, number> = {
  1: 1.0,
  2: 1.15,
  3: 1.30,
  4: 1.45,
  5: 1.60,
  6: 1.80,
}

// 觉醒阶段属性加成
export const ASCENSION_BONUS: Record<AscensionPhase, number> = {
  0: 1.0,
  1: 1.05,
  2: 1.10,
  3: 1.15,
  4: 1.20,
  5: 1.25,
  6: 1.30,
}
