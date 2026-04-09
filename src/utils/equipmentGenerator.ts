/**
 * 装备生成器模块
 * 根据难度值和稀有度生成随机装备，包含词条生成、名称生成等功能
 */

import type { Equipment, EquipmentSlot, Rarity, StatBonus, StatType, StatAffix } from '../types'
import { generateId } from './calc'
import { RARITY_MULTIPLIER, UPGRADEABLE_STATS } from '../types'

/** 稀有度从低到高的顺序数组 */
const RARITY_ORDER: Rarity[] = ['common', 'good', 'fine', 'epic', 'legend', 'myth', 'ancient', 'eternal']

/**
 * 各稀有度对应的词条数量范围 [最小, 最大]
 * common: 1条, good: 1-2条, fine: 2条, epic: 2-3条
 * legend: 3条, myth: 3-4条, ancient: 4条, eternal: 4-5条
 */
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

/**
 * 属性池，按品质分层
 * - basic: 基础属性（attack/defense/maxHp/speed）
 * - advanced: 进阶属性（暴击/穿透/闪避等）
 * - high: 高级属性（幸运/虚空伤害/真实伤害等）
 * - ultimate: 终极属性（时间扭曲/质量崩塌/维度撕裂）
 */
const STAT_POOLS: Record<string, StatType[]> = {
  basic: ['attack', 'defense', 'maxHp', 'speed'],
  advanced: ['critRate', 'critDamage', 'penetration', 'dodge', 'accuracy', 'critResist', 'damageBonusI'],
  high: ['luck', 'voidDamage', 'trueDamage', 'gravityRange', 'gravityStrength', 'combo', 'damageBonusII'],
  ultimate: ['timeWarp', 'massCollapse', 'dimensionTear', 'damageBonusIII']
}

/**
 * 各属性的随机值范围 [最小值, 最大值]
 * 实际生成时还会乘以 levelScale × rarityScale
 */
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

/**
 * 各属性的最大上限值
 * Infinity 表示无上限
 * 百分比属性（critRate/dodge等）有明确上限
 */
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

/**
 * 各装备槽位的中文名称前缀
 * 共12个槽位，每个槽位有4个可选前缀
 */
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

/** 装备名称后缀列表 */
const ITEM_SUFFIXES = ['之魂', '之心', '之力', '之怒', '之光', '之影', '的庇护', '的愤怒', '的荣耀']

/** 套装ID列表 */
const SET_IDS = ['warrior', 'guardian', 'swift', 'tyrant', 'void'] as const

/** 各稀有度对应的套装概率（ancient+必出套装） */
const SET_CHANCE_BY_RARITY: Record<Rarity, number> = {
  common: 0,
  good: 0,
  fine: 0.05,
  epic: 0.10,
  legend: 0.20,
  myth: 0.35,
  ancient: 0.60,
  eternal: 0.80
}

/**
 * 从数组中随机选择一个元素
 * @param arr - 任意类型的数组
 * @returns 随机选中的元素
 */
function randomChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

/**
 * 生成指定范围内的随机整数（含首尾）
 * @param min - 最小值
 * @param max - 最大值
 * @returns 随机整数
 */
function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

/**
 * 根据稀有度随机生成词条类型列表
 * 
 * 生成规则（按稀有度索引分层）：
 * - 索引0-1（common/good）：从basic池随机1-2条
 * - 索引2-3（fine/epic）：1条basic + 1-2条（basic或advanced）
 * - 索引4-5（legend/myth）：1条basic + 1条advanced + 1-2条（advanced或high）
 * - 索引6-7（ancient/eternal）：1-2条（basic或advanced）+ 1条advanced + 1-2条（high或ultimate）
 * 
 * @param rarity - 装备稀有度
 * @returns 随机生成的属性类型数组（去重）
 */
function getRandomStatsForRarity(rarity: Rarity): StatType[] {
  const stats: StatType[] = []
  const rarityIndex = RARITY_ORDER.indexOf(rarity)
  
  if (rarityIndex <= 1) {
    // common/good: 基础属性池
    const extraChance = rarity === 'common' ? 0.1 : (rarity === 'good' ? 0.2 : 0)
    const extraStats = Math.random() < extraChance ? 1 : 0
    for (let i = 0; i < randomInt(1, 2) + extraStats; i++) {
      stats.push(randomChoice([...STAT_POOLS.basic]))
    }
  } else if (rarityIndex <= 3) {
    // fine/epic: 基础 + 进阶
    stats.push(randomChoice(STAT_POOLS.basic))
    stats.push(randomChoice([...STAT_POOLS.basic, ...STAT_POOLS.advanced]))
  } else if (rarityIndex <= 5) {
    // legend/myth: 基础 + 进阶 + 高级
    stats.push(randomChoice(STAT_POOLS.basic))
    stats.push(randomChoice(STAT_POOLS.advanced))
    stats.push(randomChoice([...STAT_POOLS.advanced, ...STAT_POOLS.high]))
  } else {
    // ancient/eternal: 全部层次
    stats.push(randomChoice([...STAT_POOLS.basic, ...STAT_POOLS.advanced]))
    stats.push(randomChoice(STAT_POOLS.advanced))
    stats.push(randomChoice(STAT_POOLS.high))
    stats.push(randomChoice([...STAT_POOLS.high, ...STAT_POOLS.ultimate]))
  }
  
  // 去重：同一属性不会重复出现
  return [...new Set(stats)]
}

/**
 * 生成一件随机装备
 * 
 * @param slot - 装备槽位
 * @param rarity - 装备稀有度
 * @param difficultyValue - 当前难度值（影响装备等级和词条强度）
 * @returns 生成的装备对象
 * 
 * @description 生成流程：
 * 1. 根据稀有度确定词条数量（1-5条）
 * 2. 从对应属性池随机抽取词条类型
 * 3. 计算等级缩放系数：1.12^(difficultyValue/50)
 * 4. 计算词条实际值：基础值 × 等级缩放 × 稀有度倍率 × 随机系数
 * 5. 拼接装备名称（前缀 + 后缀）
 * 6. 返回完整装备对象
 */
export function generateEquipment(slot: EquipmentSlot, rarity: Rarity, difficulty: number, rng: () => number = Math.random): Equipment {
  // 装备等级 = 当前难度 - 50 ~ 当前难度
  const minLevel = Math.max(1, difficulty - 50)
  const maxLevel = difficulty
  const level = Math.floor(rng() * (maxLevel - minLevel + 1)) + minLevel

  // 1. 确定词条数量
  const [minStats, maxStats] = RARITY_STATS_COUNT[rarity]
  const statCount = randomInt(minStats, maxStats)
  const statTypes = getRandomStatsForRarity(rarity).slice(0, statCount)
  
  // 2. 计算强度缩放（使用生成的 level 而非 difficulty）
  const levelScale = Math.pow(1.12, level / 50)
  const rarityScale = RARITY_MULTIPLIER[rarity]
  
  // 3. 生成词条
  const stats: StatBonus[] = statTypes.map(type => {
    const [min, max] = STAT_VALUES[type]
    // 基础值 × 等级缩放 × 稀有度倍率 × 随机系数
    const value = randomInt(min, max) * levelScale * rarityScale
    // 判断是否为百分比属性
    const isPercent = ['critRate', 'dodge', 'timeWarp', 'critDamage', 'accuracy', 'critResist'].includes(type)
    const maxValue = STAT_MAX_VALUES[type] || Infinity
    // 百分比属性有上限，整数属性取整
    const finalValue = isPercent ? Math.min(value, maxValue) : Math.floor(value)
    
    return { type, value: Math.floor(finalValue), isPercent }
  })
  
  // 3b. 生成新版词缀（affixes）- 用于装备升级系统
  // 60%概率从可升级池抽取，40%从锁定池抽取
  const affixes: StatAffix[] = statTypes.map(type => {
    const [min, max] = STAT_VALUES[type]
    const value = randomInt(min, max) * levelScale * rarityScale
    const isPercent = ['critRate', 'dodge', 'timeWarp', 'critDamage', 'accuracy', 'critResist'].includes(type)
    const maxValue = STAT_MAX_VALUES[type] || Infinity
    const finalValue = isPercent ? Math.min(value, maxValue) : Math.floor(value)
    const isUpgradeable = (UPGRADEABLE_STATS as readonly string[]).includes(type)
    return { stat: type, value: Math.floor(finalValue), isUpgradeable, upgradeLevel: 0 }
  })
  
  // 4. 生成名称
  const prefix = randomChoice(SLOT_PREFIXES[slot])
  const suffix = randomChoice(ITEM_SUFFIXES)

  // 5. 套装ID（legend及以上稀有度有机会获得）
  const setChance = SET_CHANCE_BY_RARITY[rarity] || 0
  const setId: string | undefined = rng() < setChance
    ? randomChoice([...SET_IDS])
    : undefined

  return {
    id: generateId(),
    slot,
    name: `${prefix}${suffix}`,
    rarity,
    level, // 装备等级 = difficulty - 50 ~ difficulty
    stats,
    setId,
    isLocked: false,
    affixes
  }
}

/**
 * 根据随机roll值和加成计算装备稀有度
 * 
 * @param rarityBonus - 稀有度加成（来自幸运值等）
 * @returns 随机生成的稀有度
 * 
 * @description 基础掉落概率（无加成）：
 * - common: 30%
 * - good: 20%
 * - fine: 15%
 * - epic: 13%
 * - legend: 10%
 * - myth: 7%
 * - ancient: 4%
 * - eternal: 1%
 * 
 * 稀有度加成会将roll值向更高稀有度偏移
 */
export function generateRandomRarity(rarityBonus: number = 0): Rarity {
  const roll = Math.random() * 100
  // 稀有度加成会让roll值变小（更易获得高稀有度）
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

/**
 * 重新导出calc.ts中的装备评分函数
 * 保持向后兼容
 */
export { calculateEquipmentScore } from './calc'
