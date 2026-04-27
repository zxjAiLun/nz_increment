/**
 * 装备生成器模块
 * 根据难度值和稀有度生成随机装备，包含词条生成、名称生成等功能
 */

import type { Equipment, EquipmentSlot, Rarity, StatBonus, StatType, StatAffix } from '../types'
import { generateId } from './calc'
import { RARITY_MULTIPLIER, UPGRADEABLE_STATS } from '../types'

const EQUIPMENT_GROWTH_PER_50_LEVELS = 2
const PERCENT_STAT_PRECISION = 10

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

const PERCENT_STATS = new Set<StatType>([
  'critRate', 'dodge', 'timeWarp', 'critDamage', 'accuracy', 'critResist',
  'lifesteal', 'damageReduction', 'attackSpeed', 'cooldownReduction',
  'skillDamageBonus', 'fireResist', 'waterResist', 'windResist', 'darkResist',
  'damageBonusI', 'damageBonusII', 'damageBonusIII',
  'hpRegenPercent', 'killHealPercent', 'blockChance', 'blockReduction'
])

const NORMAL_RARITY_TABLE: Array<{ rarity: Rarity; weight: number }> = [
  { rarity: 'common', weight: 55 },
  { rarity: 'good', weight: 25 },
  { rarity: 'fine', weight: 12 },
  { rarity: 'epic', weight: 5 },
  { rarity: 'legend', weight: 2 },
  { rarity: 'myth', weight: 0.7 },
  { rarity: 'ancient', weight: 0.25 },
  { rarity: 'eternal', weight: 0.05 }
]

const BOSS_RARITY_TABLE: Array<{ rarity: Rarity; weight: number }> = [
  { rarity: 'common', weight: 25 },
  { rarity: 'good', weight: 30 },
  { rarity: 'fine', weight: 22 },
  { rarity: 'epic', weight: 13 },
  { rarity: 'legend', weight: 6 },
  { rarity: 'myth', weight: 2.5 },
  { rarity: 'ancient', weight: 1.2 },
  { rarity: 'eternal', weight: 0.3 }
]

const PERCENT_RARITY_MULTIPLIER: Record<Rarity, number> = {
  common: 1,
  good: 1.2,
  fine: 1.5,
  epic: 2,
  legend: 2.8,
  myth: 3.5,
  ancient: 4.2,
  eternal: 5
}

/**
 * 属性池，按品质分层
 * - basic: 基础属性（attack/defense/maxHp/speed）
 * - advanced: 进阶属性（暴击/穿透/闪避等）
 * - high: 高级属性（幸运/虚空伤害/真实伤害等）
 * - ultimate: 终极属性（时间扭曲/质量崩塌/维度撕裂）
 */
export const STAT_POOLS: Record<string, StatType[]> = {
  basic: ['attack', 'defense', 'maxHp', 'speed'],
  advanced: ['critRate', 'critDamage', 'penetration', 'dodge', 'accuracy', 'critResist', 'lifesteal', 'damageReduction', 'attackSpeed', 'cooldownReduction', 'skillDamageBonus', 'damageBonusI', 'hpRegenPercent', 'killHealPercent', 'hitHealFlat', 'blockChance', 'blockReduction'],
  high: ['luck', 'voidDamage', 'trueDamage', 'gravityRange', 'gravityStrength', 'combo', 'damageBonusII'],
  ultimate: ['timeWarp', 'massCollapse', 'dimensionTear', 'damageBonusIII']
}

/**
 * 各属性的随机值范围 [最小值, 最大值]
 * flat 属性会乘以 levelScale × rarityScale；百分比属性只吃低倍率稀有度缩放。
 */
const STAT_VALUES: Record<StatType, [number, number]> = {
  attack: [5, 20],
  defense: [3, 15],
  maxHp: [20, 100],
  speed: [1, 5],
  critRate: [1, 3],
  critDamage: [5, 12],
  penetration: [5, 20],
  dodge: [1, 2],
  accuracy: [1, 3],
  critResist: [1, 3],
  combo: [1, 10],
  damageReduction: [1, 2],
  damageBonusI: [2, 5],
  damageBonusII: [2, 5],
  damageBonusIII: [2, 5],
  luck: [1, 10],
  gravityRange: [5, 25],
  gravityStrength: [5, 25],
  voidDamage: [20, 100],
  trueDamage: [20, 100],
  timeWarp: [0.5, 1],
  massCollapse: [20, 100],
  dimensionTear: [20, 100],
  attackSpeed: [1, 3],
  cooldownReduction: [1, 2],
  skillDamageBonus: [2, 5],
  lifesteal: [0.5, 1],
  fireResist: [1, 5],
  waterResist: [1, 5],
  windResist: [1, 5],
  darkResist: [1, 5],
  hpRegenPercent: [0.1, 0.5],
  killHealPercent: [2, 6],
  hitHealFlat: [1, 10],
  blockChance: [1, 2],
  blockReduction: [2, 8]
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
  critRate: 80,
  critDamage: 500,
  penetration: 100,
  dodge: 60,
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
  timeWarp: 40,
  damageReduction: 70,
  attackSpeed: 100,
  cooldownReduction: 60,
  skillDamageBonus: 300,
  lifesteal: 15,
  fireResist: 80,
  waterResist: 80,
  windResist: 80,
  darkResist: 80,
  hpRegenPercent: 3,
  killHealPercent: 30,
  hitHealFlat: Infinity,
  blockChance: 45,
  blockReduction: 70,
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
  ringRight: ['命运', '轮回', '时空', '虚空'],
  weapon: ['圣剑', '魔杖', '弓箭', '战斧'],
  boots: ['疾风', '瞬步', '闪电', '飞翔'],
  robe: ['法袍', '布甲', '丝绸', '魔衣'],
  hat: ['皇冠', '头巾', '兜帽', '法帽'],
  accessory: ['戒指', '项链', '手镯', '耳环'],
  shield: ['护盾', '护甲', '护腕', '护肩']
}

/** 装备名称后缀列表 */
const ITEM_SUFFIXES = ['之魂', '之心', '之力', '之怒', '之光', '之影', '的庇护', '的愤怒', '的荣耀']

/** 套装ID列表 */
const SET_IDS = ['warrior', 'guardian', 'swift', 'tyrant', 'void', 'blood_guardian', 'fortune'] as const

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
function randomChoice<T>(arr: T[], rng: () => number = Math.random): T {
  return arr[Math.floor(rng() * arr.length)]
}

/**
 * 生成指定范围内的随机整数（含首尾）
 * @param min - 最小值
 * @param max - 最大值
 * @returns 随机整数
 */
function randomInt(min: number, max: number, rng: () => number = Math.random): number {
  return Math.floor(rng() * (max - min + 1)) + min
}

function randomFloat(min: number, max: number, rng: () => number = Math.random): number {
  return min + rng() * (max - min)
}

function rollStatValue(type: StatType, levelScale: number, rarity: Rarity, rng: () => number): { value: number; isPercent: boolean } {
  const [min, max] = STAT_VALUES[type]
  const isPercent = PERCENT_STATS.has(type)
  const baseValue = isPercent ? randomFloat(min, max, rng) : randomInt(min, max, rng)
  const scaledValue = isPercent
    ? baseValue * PERCENT_RARITY_MULTIPLIER[rarity]
    : baseValue * levelScale * RARITY_MULTIPLIER[rarity]
  const maxValue = STAT_MAX_VALUES[type] || Infinity
  const finalValue = Math.min(scaledValue, maxValue)

  return {
    value: isPercent
      ? Math.round(finalValue * PERCENT_STAT_PRECISION) / PERCENT_STAT_PRECISION
      : Math.floor(finalValue),
    isPercent
  }
}

function rollRarityFromTable(table: Array<{ rarity: Rarity; weight: number }>, rarityBonus: number, rng: () => number): Rarity {
  const adjusted = table.map((entry, index) => ({
    ...entry,
    weight: entry.weight * (1 + rarityBonus * index * 0.015)
  }))
  const total = adjusted.reduce((sum, entry) => sum + entry.weight, 0)
  let roll = rng() * total
  for (const entry of adjusted) {
    roll -= entry.weight
    if (roll <= 0) return entry.rarity
  }
  return adjusted[adjusted.length - 1].rarity
}

function weightedChoice<T extends string>(weights: Array<{ item: T; weight: number }>, rng: () => number): T {
  const total = weights.reduce((sum, entry) => sum + entry.weight, 0)
  let roll = rng() * total
  for (const entry of weights) {
    roll -= entry.weight
    if (roll <= 0) return entry.item
  }
  return weights[weights.length - 1].item
}

function getPoolWeights(difficulty: number): Array<{ item: keyof typeof STAT_POOLS; weight: number }> {
  if (difficulty < 50) return [{ item: 'basic', weight: 1 }]
  if (difficulty < 150) return [{ item: 'basic', weight: 80 }, { item: 'advanced', weight: 20 }]
  if (difficulty < 400) return [{ item: 'basic', weight: 45 }, { item: 'advanced', weight: 45 }, { item: 'high', weight: 10 }]
  if (difficulty < 800) return [{ item: 'basic', weight: 35 }, { item: 'advanced', weight: 45 }, { item: 'high', weight: 18 }, { item: 'ultimate', weight: 2 }]
  return [{ item: 'basic', weight: 30 }, { item: 'advanced', weight: 40 }, { item: 'high', weight: 25 }, { item: 'ultimate', weight: 5 }]
}

function getAllowedStatsForDifficulty(difficulty: number): StatType[] {
  const poolNames = getPoolWeights(difficulty).map(entry => entry.item)
  return [...new Set(poolNames.flatMap(poolName => STAT_POOLS[poolName]))]
}

function randomStatFromDifficulty(difficulty: number, rng: () => number): StatType {
  const poolName = weightedChoice(getPoolWeights(difficulty), rng)
  return randomChoice(STAT_POOLS[poolName], rng)
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
function getRandomStatsForRarity(rarity: Rarity, difficulty: number, targetCount: number, rng: () => number = Math.random): StatType[] {
  const stats: StatType[] = []
  const rarityIndex = RARITY_ORDER.indexOf(rarity)
  
  if (rarityIndex <= 1) {
    const extraChance = rarity === 'common' ? 0.1 : (rarity === 'good' ? 0.2 : 0)
    const extraStats = rng() < extraChance ? 1 : 0
    for (let i = 0; i < randomInt(1, 2, rng) + extraStats; i++) {
      stats.push(randomStatFromDifficulty(difficulty, rng))
    }
  } else if (rarityIndex <= 3) {
    stats.push(randomChoice(STAT_POOLS.basic, rng))
    stats.push(randomStatFromDifficulty(difficulty, rng))
  } else if (rarityIndex <= 5) {
    stats.push(randomChoice(STAT_POOLS.basic, rng))
    stats.push(randomStatFromDifficulty(difficulty, rng))
    stats.push(randomStatFromDifficulty(difficulty, rng))
  } else {
    stats.push(randomChoice(STAT_POOLS.basic, rng))
    stats.push(randomStatFromDifficulty(difficulty, rng))
    stats.push(randomStatFromDifficulty(difficulty, rng))
    stats.push(randomStatFromDifficulty(difficulty, rng))
  }
  
  const uniqueStats = [...new Set(stats)]
  let attempts = 0
  while (uniqueStats.length < targetCount && attempts < 32) {
    const next = randomStatFromDifficulty(difficulty, rng)
    if (!uniqueStats.includes(next)) uniqueStats.push(next)
    attempts++
  }
  if (uniqueStats.length < targetCount) {
    for (const stat of getAllowedStatsForDifficulty(difficulty)) {
      if (!uniqueStats.includes(stat)) uniqueStats.push(stat)
      if (uniqueStats.length >= targetCount) break
    }
  }

  return uniqueStats
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
 * 3. 计算等级缩放系数：2^(equipmentLevel/50)，让基础装备成长稳定追赶怪物曲线
 * 4. 计算词条实际值：基础值 × 等级缩放 × 平滑稀有度倍率 × 随机系数
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
  const statCount = randomInt(minStats, maxStats, rng)
  const statTypes = getRandomStatsForRarity(rarity, difficulty, statCount, rng).slice(0, statCount)
  
  // 2. 计算强度缩放（使用生成的 level 而非 difficulty）
  const levelScale = Math.pow(EQUIPMENT_GROWTH_PER_50_LEVELS, level / 50)
  // 3. 生成词条。stats 与 affixes 使用同一次 roll，避免展示值和升级值不一致。
  const rolledStats = statTypes.map(type => {
    const rolled = rollStatValue(type, levelScale, rarity, rng)
    return { type, ...rolled }
  })
  const stats: StatBonus[] = rolledStats.map(({ type, value, isPercent }) => ({ type, value, isPercent }))
  
  // 3b. 生成新版词缀（affixes）- 用于装备升级系统
  const affixes: StatAffix[] = rolledStats.map(({ type, value }) => {
    const isUpgradeable = (UPGRADEABLE_STATS as readonly string[]).includes(type)
    return { stat: type, value, isUpgradeable, upgradeLevel: 0 }
  })
  
  // 4. 生成名称
  const prefix = randomChoice(SLOT_PREFIXES[slot], rng)
  const suffix = randomChoice(ITEM_SUFFIXES, rng)

  // 5. 套装ID（legend及以上稀有度有机会获得）
  const setChance = SET_CHANCE_BY_RARITY[rarity] || 0
  const setId: string | undefined = rng() < setChance
    ? randomChoice([...SET_IDS], rng)
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
    affixes,
    refiningSlots: [],
    refiningLevel: 0,
    runeSlots: []
  }
}

/**
 * 根据随机roll值和加成计算装备稀有度
 * 
 * @param rarityBonus - 稀有度加成（来自幸运值等）
 * @returns 随机生成的稀有度
 * 
 * @description 普通怪基础掉落概率（无加成）：
 * - common: 55%
 * - good: 25%
 * - fine: 12%
 * - epic: 5%
 * - legend: 2%
 * - myth: 0.7%
 * - ancient: 0.25%
 * - eternal: 0.05%
 * 
 * Boss 使用独立掉率表，不再直接给百分位 roll 加值，避免 eternal 概率被线性抬爆。
 */
export function generateRandomRarity(rarityBonus: number = 0, rng: () => number = Math.random, source: 'normal' | 'boss' = 'normal'): Rarity {
  return rollRarityFromTable(source === 'boss' ? BOSS_RARITY_TABLE : NORMAL_RARITY_TABLE, rarityBonus, rng)
}

/**
 * 重新导出calc.ts中的装备评分函数
 * 保持向后兼容
 */
export { calculateEquipmentScore } from './calc'
