/**
 * 幸运（luck）管线统一模块 —— Phase 3.1
 *
 * 这是 runtime（Pinia gameStore / playerStore）与 simulator（battleSimulator）
 * 唯一共享的幸运来源。所有幸运效果都必须通过本模块计算，禁止在两侧各自硬编码。
 *
 * 设计要点：
 *  - 唯一配置 LUCK_CONFIG，所有数值从此读取，便于平衡校准。
 *  - calculateLuckEffects 对所有输入做规范化（NaN / Infinity / 负数 → 0），
 *    所有概率收敛到合法区间。
 *  - 战斗属性（暴击率 / 穿透）只通过 applyLuckCombatEffects 应用一次。
 *  - 金币与掉落通过 calculateCombatGoldReward / calculateKillDropChances / rollKillDrops 统一。
 *  - 禁止再使用容易误解的旧字段名 critBonus / equipmentDropBonus。
 */

import type { PlayerStats, Equipment } from '../types'
import { EQUIPMENT_SLOTS } from '../types'
import { generateRandomRarity, generateEquipment } from './equipmentGenerator'

/** 掉落概率的最终硬上限（与历史 simulator 行为一致） */
const DROP_CHANCE_CAP = 0.95

/**
 * 唯一幸运配置。平衡校准只允许调整本对象的公开参数，
 * 不得通过按 buildType 判断的隐藏倍率或放宽 guardrail 来补偿。
 */
export interface LuckConfig {
  /** 每点幸运提供的金币收益加成（线性，封顶 goldBonusCap） */
  goldBonusPerPoint: number
  /** 金币收益加成上限（比例，如 0.4 = +40%） */
  goldBonusCap: number
  /** 每点幸运提供的「普通怪装备掉率乘区」加成（线性，封顶 equipmentDropMultiplierCap） */
  equipmentDropMultiplierPerPoint: number
  /** 装备掉率乘区加成上限（同时作为最终装备掉率上限） */
  equipmentDropMultiplierCap: number
  /** 每点幸运提供的钻石掉落概率增量（线性，封顶 diamondChanceCap） */
  diamondChancePerPoint: number
  /** 钻石掉落概率增量上限（比例） */
  diamondChanceCap: number
  /** 每点幸运提供的暴击率（百分点，作为 critRateFlat 加到战斗属性） */
  critRatePerPoint: number
  /** 每点幸运提供的穿透（取整，作为 penetrationFlat 加到战斗属性） */
  penetrationPerPoint: number
}

export const LUCK_CONFIG: LuckConfig = {
  goldBonusPerPoint: 0.0025,
  goldBonusCap: 0.98,
  equipmentDropMultiplierPerPoint: 0.008,
  equipmentDropMultiplierCap: DROP_CHANCE_CAP,
  diamondChancePerPoint: 0.0002,
  diamondChanceCap: 0.15,
  critRatePerPoint: 0.08,
  penetrationPerPoint: 0.1
}

/** 幸运效果（字段名即单位，避免歧义） */
export interface LuckEffects {
  /** 金币收益加成率（比例，如 0.4 = +40%） */
  goldBonusRate: number
  /** 普通怪装备掉率乘区加成（比例，用于 (1 + bonus)） */
  equipmentDropMultiplierBonus: number
  /** 钻石掉落概率增量（比例） */
  diamondDropChanceAdd: number
  /** 暴击率平面加成（百分点），由 applyLuckCombatEffects 加到 critRate */
  critRateFlat: number
  /** 穿透平面加成（取整），由 applyLuckCombatEffects 加到 penetration */
  penetrationFlat: number
}

/** 规范化幸运输入：NaN / Infinity / 负数 → 0 */
export function normalizeLuck(luck: number): number {
  return Number.isFinite(luck) && luck > 0 ? luck : 0
}

/** 将数值收敛到 [0, cap] */
export function clampRate(value: number, cap: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(value, cap))
}

/** 将概率收敛到 [0, DROP_CHANCE_CAP] */
function clampDropChance(value: number): number {
  return clampRate(value, DROP_CHANCE_CAP)
}

/**
 * 计算幸运值的所有效果。只读取 LUCK_CONFIG。
 * @param luck 幸运值（任意输入都会被规范化）
 */
export function calculateLuckEffects(luck: number): LuckEffects {
  const l = normalizeLuck(luck)
  return {
    goldBonusRate: clampRate(l * LUCK_CONFIG.goldBonusPerPoint, LUCK_CONFIG.goldBonusCap),
    equipmentDropMultiplierBonus: clampRate(l * LUCK_CONFIG.equipmentDropMultiplierPerPoint, LUCK_CONFIG.equipmentDropMultiplierCap),
    diamondDropChanceAdd: clampRate(l * LUCK_CONFIG.diamondChancePerPoint, LUCK_CONFIG.diamondChanceCap),
    critRateFlat: l * LUCK_CONFIG.critRatePerPoint,
    penetrationFlat: Math.floor(l * LUCK_CONFIG.penetrationPerPoint)
  }
}

/**
 * 一次性把幸运的战斗属性（暴击率 / 穿透）应用到属性表。
 * 调用方必须保证整条管线只调用一次（runtime 在 totalStats 汇总后、simulator 在 build 生成后）。
 * 暴击率应用现有有效上限 80。
 */
export function applyLuckCombatEffects(stats: PlayerStats): PlayerStats {
  const effects = calculateLuckEffects(stats.luck)
  stats.critRate = (stats.critRate ?? 0) + effects.critRateFlat
  if (stats.critRate > 80) stats.critRate = 80
  stats.penetration = (stats.penetration ?? 0) + effects.penetrationFlat
  return stats
}

export interface CombatGoldRewardParams {
  /** 战斗/击杀基础金币（未含任何幸运或奖励乘区） */
  baseGold: number
  /** 有效幸运（playerStore.totalStats.luck），不是原始 player.stats.luck */
  luck: number
  /** 天赋金币加成率（比例，如 0.02） */
  talentGoldBonusRate?: number
  /** 转生金币加成率（比例） */
  rebirthGoldBonusRate?: number
  /** 月卡金币加成率（比例） */
  monthlyCardGoldBonusRate?: number
  /** 死亡奖励倍率（纯乘区，默认 1） */
  deathRewardMultiplier?: number
}

/**
 * 计算战斗金币奖励净额。锁定乘区顺序：
 *   baseGold × (1 + talent) × death × (1 + luck + rebirth + monthly)
 * 保持当前已有奖励来源，不重复应用任何乘区。
 */
export function calculateCombatGoldReward(params: CombatGoldRewardParams): number {
  const base = Number.isFinite(params.baseGold) && params.baseGold > 0 ? Math.floor(params.baseGold) : 0
  const luckBonusRate = calculateLuckEffects(params.luck).goldBonusRate
  const talent = params.talentGoldBonusRate ?? 0
  const rebirth = params.rebirthGoldBonusRate ?? 0
  const monthly = params.monthlyCardGoldBonusRate ?? 0
  const deathReward = params.deathRewardMultiplier
  const death = typeof deathReward === 'number' && deathReward > 0 ? deathReward : 1
  const multiplier = (1 + talent) * death * (1 + luckBonusRate + rebirth + monthly)
  return Math.floor(base * multiplier)
}

export interface KillDropChanceParams {
  /** 怪物基础装备掉率（0~1） */
  baseEquipmentChance: number
  /** 怪物基础钻石掉率（0~1） */
  baseDiamondChance: number
  /** 有效幸运 */
  luck: number
  /** 是否为 Boss（Boss 装备基础掉率不受幸运影响） */
  isBoss: boolean
}

/**
 * 计算击杀掉落概率（runtime 与 simulator 共用）。
 *  - 普通怪装备掉率：base × (1 + equipmentDropMultiplierBonus)，封顶 DROP_CHANCE_CAP
 *  - Boss 装备掉率：保持基础值（不受幸运影响）
 *  - 钻石掉率：base + diamondDropChanceAdd（普通怪与 Boss 都受幸运提高），封顶 DROP_CHANCE_CAP
 */
export function calculateKillDropChances(params: KillDropChanceParams): { equipmentChance: number; diamondChance: number } {
  const effects = calculateLuckEffects(params.luck)
  const equipmentChance = params.isBoss
    ? clampDropChance(params.baseEquipmentChance)
    : clampDropChance(params.baseEquipmentChance * (1 + effects.equipmentDropMultiplierBonus))
  const diamondChance = clampDropChance(params.baseDiamondChance + effects.diamondDropChanceAdd)
  return { equipmentChance, diamondChance }
}

/**
 * 两个独立掉落来源的合并概率：1 - (1 - a)(1 - b)
 * 用于天赋装备掉率作为基础失败后的独立二次来源。
 */
export function combineIndependentDropChances(baseChance: number, extraChance: number): number {
  const a = clampDropChance(baseChance)
  const b = clampDropChance(extraChance)
  return 1 - (1 - a) * (1 - b)
}

export interface KillDropRollParams extends KillDropChanceParams {
  /** 随机数源（runtime 用 combatRng，simulator 用 seeded rng） */
  rng: () => number
  /** 当前难度（用于生成装备等级/词条） */
  difficulty: number
  /** 稀有度加成（rebirth + talent），默认 0 */
  rarityBonus?: number
  /** 天赋装备掉率加成率（比例），与基础概率独立合并 */
  talentEquipmentDropBonusRate?: number
}

export interface KillDropRollResult {
  /** 钻石数量（0 表示未掉落） */
  diamondCount: number
  /** 是否掉落装备 */
  shouldDropEquipment: boolean
  /** 生成的装备（未掉落为 null） */
  equipment: Equipment | null
}

/**
 * 统一击杀掉落 roll（runtime 与 simulator 共用），锁定 RNG 调用顺序：
 *   1) 钻石掉落门
 *   2) 钻石数量
 *   3) 装备掉落门（基础概率与天赋概率独立合并）
 *   4) 槽位随机
 *   5) 稀有度随机
 *   6) 装备词条生成
 * 未掉落时不得额外消费对应数量 / 装备生成 RNG。
 */
export function rollKillDrops(params: KillDropRollParams): KillDropRollResult {
  const chances = calculateKillDropChances(params)
  const equipChance = combineIndependentDropChances(chances.equipmentChance, params.talentEquipmentDropBonusRate ?? 0)

  let diamondCount = 0
  if (params.rng() < chances.diamondChance) {
    diamondCount = Math.floor(1 + params.rng() * (params.isBoss ? 200 : 10))
  }

  let shouldDropEquipment = false
  let equipment: Equipment | null = null
  if (equipChance >= 1 || params.rng() < equipChance) {
    shouldDropEquipment = true
    const slot = EQUIPMENT_SLOTS[Math.floor(params.rng() * EQUIPMENT_SLOTS.length)]
    const rarity = generateRandomRarity(params.rarityBonus ?? 0, params.rng, params.isBoss ? 'boss' : 'normal')
    equipment = generateEquipment(slot, rarity, params.difficulty, params.rng)
  }

  return { diamondCount, shouldDropEquipment, equipment }
}
