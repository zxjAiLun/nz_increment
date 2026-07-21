/**
 * 击杀掉落 roll 模块 —— Phase 3.1.1
 *
 * 从 luck.ts 拆出，专门负责「基于概率的掉落 roll」，依赖 luck（概率计算）
 * 与 equipmentGenerator（装备生成）。这样 luck.ts 不再反向依赖 equipmentGenerator，
 * 从而打破 calc → luck → equipmentGenerator → calc 的循环依赖。
 *
 * 锁定的 RNG 调用顺序（每次 rollKillDrops 固定消费）：
 *   1) 钻石掉落门（固定 1 次，无论是否掉落都消费）
 *   2) 钻石数量（仅掉落时 1 次）
 *   3) 装备掉落门（固定 1 次，即使 equipChance ≥ 1 也不短路，保证 RNG 相位稳定）
 *   4) 槽位随机（仅掉落时 1 次）
 *   5) 稀有度随机（仅掉落时 1 次）
 *   6) 装备词条生成（仅掉落时，由 generateEquipment 消费若干次）
 *
 * 固定消费装备门是关键：runtime（gameStore → rollKillDrops）与 simulator（battleSimulator → rollKillDrops）
 * 共用本函数，因此同种子下掉落判定消耗的 RNG 次数完全一致，不会因「equipChance ≥ 1 时是否短路」而错位。
 */

import type { Equipment } from '../types'
import { EQUIPMENT_SLOTS } from '../types'
import {
  calculateKillDropChances,
  combineIndependentDropChances,
  type KillDropChanceParams
} from './luck'
import { generateRandomRarity, generateEquipment } from './equipmentGenerator'

export interface KillDropRollParams extends KillDropChanceParams {
  /** 随机数源（runtime 用 combatRng，simulator 用 seeded rng） */
  rng: () => number
  /** 当前难度（用于生成装备等级/词条，应使用击杀时怪物的难度 rewardDifficulty） */
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
 * 统一击杀掉落 roll（runtime 与 simulator 共用），锁定 RNG 调用顺序（见模块注释）。
 * 未掉落时不得额外消费对应数量 / 装备生成 RNG；装备门即使必然掉落也固定消费一次，不短路。
 */
export function rollKillDrops(params: KillDropRollParams): KillDropRollResult {
  const chances = calculateKillDropChances(params)
  const equipChance = combineIndependentDropChances(chances.equipmentChance, params.talentEquipmentDropBonusRate ?? 0)

  // 固定消费：钻石掉落门（无论是否掉落都消费一次 RNG 用于判定）
  let diamondCount = 0
  const diamondRoll = params.rng()
  if (diamondRoll < chances.diamondChance) {
    diamondCount = Math.floor(1 + params.rng() * (params.isBoss ? 200 : 10))
  }

  // 固定消费：装备掉落门（即使 equipChance ≥ 1 也固定消费一次，不短路，保持 RNG 相位稳定）
  let shouldDropEquipment = false
  let equipment: Equipment | null = null
  const equipRoll = params.rng()
  if (equipRoll < equipChance) {
    shouldDropEquipment = true
    const slot = EQUIPMENT_SLOTS[Math.floor(params.rng() * EQUIPMENT_SLOTS.length)]
    const rarity = generateRandomRarity(params.rarityBonus ?? 0, params.rng, params.isBoss ? 'boss' : 'normal')
    equipment = generateEquipment(slot, rarity, params.difficulty, params.rng)
  }

  return { diamondCount, shouldDropEquipment, equipment }
}
