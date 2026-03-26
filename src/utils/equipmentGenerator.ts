import type { Equipment, EquipmentSlot, Rarity, StatBonus, StatType } from '../types'
import { generateId } from './calc'
import { RARITY_MULTIPLIER } from '../types'

const RARITY_ORDER: Rarity[] = ['common', 'good', 'fine', 'epic', 'legend', 'myth', 'ancient', 'eternal']

const RARITY_STATS_COUNT: Record<Rarity, [number, number]> = {
  common: [1, 1],
  good: [1, 2],
  fine: [2, 2],
  epic: [2, 3],
  legend: [3, 3],
  myth: [3, 4],
  ancient: [4, 4],
  eternal: [4, 5]
}

const STAT_POOLS: Record<string, StatType[]> = {
  basic: ['attack', 'defense', 'maxHp', 'speed'],
  advanced: ['critRate', 'critDamage', 'penetration', 'dodge', 'accuracy', 'critResist', 'damageBonusI'],
  high: ['luck', 'voidDamage', 'trueDamage', 'gravityRange', 'gravityStrength', 'combo', 'damageBonusII'],
  ultimate: ['timeWarp', 'massCollapse', 'dimensionTear', 'damageBonusIII']
}

const STAT_VALUES: Record<StatType, [number, number]> = {
  attack: [5, 20],
  defense: [3, 15],
  maxHp: [20, 100],
  speed: [1, 5],
  critRate: [1, 8],
  critDamage: [10, 30],
  penetration: [5, 20],
  dodge: [1, 5],
  accuracy: [1, 8],
  critResist: [1, 8],
  combo: [1, 10],
  damageBonusI: [1, 5],
  damageBonusII: [1, 5],
  damageBonusIII: [1, 5],
  luck: [1, 10],
  gravityRange: [5, 25],
  gravityStrength: [5, 25],
  voidDamage: [20, 100],
  trueDamage: [20, 100],
  timeWarp: [5, 15],
  massCollapse: [20, 100],
  dimensionTear: [20, 100]
}

const STAT_MAX_VALUES: Record<string, number> = {
  attack: Infinity,
  defense: Infinity,
  maxHp: Infinity,
  speed: 10000,
  critRate: 95,
  critDamage: 500,
  penetration: 100,
  dodge: 80,
  accuracy: 100,
  critResist: 80,
  combo: 1000,
  damageBonusI: 500,
  damageBonusII: 500,
  damageBonusIII: 500,
  luck: 1000,
  gravityRange: 500,
  gravityStrength: 500,
  voidDamage: 5000,
  trueDamage: 5000,
  timeWarp: 100,
  massCollapse: 5000,
  dimensionTear: 5000,
  size: Infinity
}

const SLOT_PREFIXES: Record<EquipmentSlot, string[]> = {
  head: ['勇者', '骑士', '暗黑', '神圣'],
  neck: ['龙鳞', '凤凰', '月光', '星辰'],
  shoulder: ['战神', '守护', '疾风', '雷霆'],
  chest: ['钢铁', '魔法', '生命', ' spirit'],
  back: ['天使', '恶魔', '幽灵', '机械'],
  hand: ['力量', '敏捷', '智慧', '幸运'],
  waist: ['巨人', '精灵', '矮人', '兽人'],
  legs: ['风暴', '闪电', '火焰', '寒冰'],
  leftHand: ['庇护', '坚韧', '神圣', '暗影'],
  rightHand: ['杀意', '冰霜', '雷霆', '火焰'],
  ringLeft: ['永恒', '神秘', '古老', '禁忌'],
  ringRight: ['命运', '轮回', '时空', '虚空']
}

const ITEM_SUFFIXES = ['之魂', '之心', '之力', '之怒', '之光', '之影', '的庇护', '的愤怒', '的荣耀']

function randomChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function getRandomStatsForRarity(rarity: Rarity): StatType[] {
  const stats: StatType[] = []
  const rarityIndex = RARITY_ORDER.indexOf(rarity)
  
  if (rarityIndex <= 1) {
    const extraChance = rarity === 'common' ? 0.1 : (rarity === 'good' ? 0.2 : 0)
    const extraStats = Math.random() < extraChance ? 1 : 0
    for (let i = 0; i < randomInt(1, 2) + extraStats; i++) {
      stats.push(randomChoice([...STAT_POOLS.basic]))
    }
  } else if (rarityIndex <= 3) {
    stats.push(randomChoice(STAT_POOLS.basic))
    stats.push(randomChoice([...STAT_POOLS.basic, ...STAT_POOLS.advanced]))
  } else if (rarityIndex <= 5) {
    stats.push(randomChoice(STAT_POOLS.basic))
    stats.push(randomChoice(STAT_POOLS.advanced))
    stats.push(randomChoice([...STAT_POOLS.advanced, ...STAT_POOLS.high]))
  } else {
    stats.push(randomChoice([...STAT_POOLS.basic, ...STAT_POOLS.advanced]))
    stats.push(randomChoice(STAT_POOLS.advanced))
    stats.push(randomChoice(STAT_POOLS.high))
    stats.push(randomChoice([...STAT_POOLS.high, ...STAT_POOLS.ultimate]))
  }
  
  return [...new Set(stats)]
}

export function generateEquipment(slot: EquipmentSlot, rarity: Rarity, difficultyValue: number): Equipment {
  const [minStats, maxStats] = RARITY_STATS_COUNT[rarity]
  const statCount = randomInt(minStats, maxStats)
  const statTypes = getRandomStatsForRarity(rarity).slice(0, statCount)
  
  const levelScale = Math.pow(1.12, difficultyValue / 50)
  const rarityScale = RARITY_MULTIPLIER[rarity]
  
  const stats: StatBonus[] = statTypes.map(type => {
    const [min, max] = STAT_VALUES[type]
    const value = randomInt(min, max) * levelScale * rarityScale
    const isPercent = ['critRate', 'dodge', 'timeWarp', 'critDamage', 'accuracy', 'critResist'].includes(type)
    const maxValue = STAT_MAX_VALUES[type] || Infinity
    const finalValue = isPercent ? Math.min(value, maxValue) : Math.floor(value)
    
    return { type, value: Math.floor(finalValue), isPercent }
  })
  
  const prefix = randomChoice(SLOT_PREFIXES[slot])
  const suffix = randomChoice(ITEM_SUFFIXES)
  
  return {
    id: generateId(),
    slot,
    name: `${prefix}${suffix}`,
    rarity,
    level: difficultyValue,
    stats,
    isLocked: false
  }
}

export function generateRandomRarity(rarityBonus: number = 0): Rarity {
  const roll = Math.random() * 100
  const adjustedRoll = roll + rarityBonus * 2
  
  if (adjustedRoll < 30) return 'common'
  if (adjustedRoll < 50) return 'good'
  if (adjustedRoll < 65) return 'fine'
  if (adjustedRoll < 78) return 'epic'
  if (adjustedRoll < 88) return 'legend'
  if (adjustedRoll < 95) return 'myth'
  if (adjustedRoll < 99) return 'ancient'
  return 'eternal'
}

export { calculateEquipmentScore } from './calc'
