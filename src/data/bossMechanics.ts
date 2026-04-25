import type { ElementType } from '../types'

export type BossMechanicId =
  | 'highArmor'
  | 'highDodge'
  | 'enrage'
  | 'lifesteal'
  | 'shield'
  | 'elemental'

export interface BossMechanicTemplate {
  id: BossMechanicId
  name: string
  description: string
  recommendedBuild: string
  feedback: string
  defenseMultiplier?: number
  dodgeBonus?: number
  accuracyBonus?: number
  speedMultiplier?: number
  enrageAfterMs?: number
  enrageAttackMultiplier?: number
  healThreshold?: number
  healPercent?: number
  shieldIntervalTurns?: number
  shieldPercent?: number
  weakElement?: ElementType
  resistedElement?: ElementType
  enabled: boolean
}

export interface BossMechanicState {
  spawnedAt: number
  turnCounter: number
  shield: number
  enraged: boolean
  healedOnce: boolean
}

export const BOSS_MECHANICS: BossMechanicTemplate[] = [
  {
    id: 'highArmor',
    name: '重甲 Boss',
    description: '防御极高，普通攻击容易刮痧。',
    recommendedBuild: '破甲真伤流：穿透 / 真伤 / 虚空伤害',
    feedback: '护甲压制',
    defenseMultiplier: 4,
    enabled: true
  },
  {
    id: 'highDodge',
    name: '幻影 Boss',
    description: '闪避很高，低命中会频繁 miss。',
    recommendedBuild: '极速命中流：命中 / 速度 / 多次出手',
    feedback: '频繁闪避',
    dodgeBonus: 28,
    accuracyBonus: 20,
    speedMultiplier: 1.25,
    enabled: true
  },
  {
    id: 'enrage',
    name: '狂暴 Boss',
    description: '战斗 30 秒后进入狂暴，攻击翻倍。',
    recommendedBuild: '暴击爆发流：攻击 / 暴击 / 暴伤',
    feedback: '限时爆发',
    enrageAfterMs: 30_000,
    enrageAttackMultiplier: 2,
    enabled: true
  },
  {
    id: 'lifesteal',
    name: '汲血 Boss',
    description: '低血量时会大量回血一次。',
    recommendedBuild: '爆发压血：暴击爆发 / 高倍率技能',
    feedback: '濒死回血',
    healThreshold: 0.35,
    healPercent: 0.25,
    enabled: true
  },
  {
    id: 'shield',
    name: '护盾 Boss',
    description: '每隔数回合生成护盾，单次大伤害会被护盾吸收。',
    recommendedBuild: '极速技能流：速度 / 冷却 / 多段技能',
    feedback: '周期护盾',
    shieldIntervalTurns: 4,
    shieldPercent: 0.12,
    enabled: true
  },
  {
    id: 'elemental',
    name: '元素 Boss',
    description: '拥有明显元素抗性与弱点。',
    recommendedBuild: '元素构筑：元素武器 / 技能 / 宠物',
    feedback: '元素克制',
    weakElement: 'water',
    resistedElement: 'fire',
    enabled: false
  }
]

const ENABLED_BOSS_MECHANICS = BOSS_MECHANICS.filter(mechanic => mechanic.enabled)

export function getBossMechanicById(id: BossMechanicId): BossMechanicTemplate | undefined {
  return BOSS_MECHANICS.find(mechanic => mechanic.id === id)
}

export function selectBossMechanic(difficultyValue: number, level: number): BossMechanicTemplate {
  const index = Math.abs(Math.floor(difficultyValue / 10) + level) % ENABLED_BOSS_MECHANICS.length
  return ENABLED_BOSS_MECHANICS[index]
}

export function createBossMechanicState(): BossMechanicState {
  return {
    spawnedAt: Date.now(),
    turnCounter: 0,
    shield: 0,
    enraged: false,
    healedOnce: false
  }
}
