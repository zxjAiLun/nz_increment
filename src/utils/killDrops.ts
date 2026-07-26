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
import { planRuneGeneration } from './runeGeneration'
import { normalizeRuneDropChance } from './runeDrop'
import type { Rune } from '../stores/runeStore'

export interface KillDropRollParams extends KillDropChanceParams {
  /** 随机数源（runtime 用 combatRng，simulator 用 seeded rng） */
  rng: () => number
  /** 当前难度（用于生成装备等级/词条，应使用击杀时怪物的难度 rewardDifficulty） */
  difficulty: number
  /** 稀有度加成（rebirth + talent），默认 0 */
  rarityBonus?: number
  /** 天赋装备掉率加成率（比例），与基础概率独立合并 */
  talentEquipmentDropBonusRate?: number
  /** Phase 3.9：基础 Rune 掉率（已规范化前的原始值，由调用方从怪物快照传入）。chance <= 0 不消费任何 Rune RNG。 */
  baseRuneDropChance?: unknown
  /** Phase 3.9：Rune 生成的 timestamp 工厂（仅在 Rune 门命中时调用恰好一次）。缺失或抛异常 → 不掉落。 */
  runeTimestampFactory?: () => unknown
}

export interface KillDropRollResult {
  /** 钻石数量（0 表示未掉落） */
  diamondCount: number
  /** 是否掉落装备 */
  shouldDropEquipment: boolean
  /** 生成的装备（未掉落为 null） */
  equipment: Equipment | null
  /** Phase 3.9：是否掉落 Rune */
  shouldDropRune: boolean
  /** Phase 3.9：生成的 Rune（未掉落为 null） */
  rune: Rune | null
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

  // Phase 3.9：Rune 掉落门 —— 必须严格追加在「全部现有钻石/装备逻辑」之后，禁止插队，
  // 否则会改变已有钻石/装备的 RNG 相位。Rune 生成规则（type/rarity/baseStat/multiplier/ID）复用 runeGeneration，
  // 不在本文件复制第二份。
  //   - baseRuneChance <= 0：不消费任何 Rune RNG、不调用 timestamp factory、不生成。
  //   - baseRuneChance > 0：固定消费「Rune 门」1 次（即使 chance >= 1 也不短路）。
  //   - 门命中：timestamp factory 恰好 1 次 + planRuneGeneration 恰好再消费 3 次 RNG。
  //   - 门未命中：不调用 factory、不消费 type/rarity/suffix。
  //   - 生成失败（factory 缺失/抛异常、timestamp 非法、planner 失败、postcondition 不通过）：
  //     rune = null / shouldDropRune = false，不影响已算出的钻石/装备，不向外抛出 Rune 子流程异常。
  let shouldDropRune = false
  let rune: Rune | null = null
  const baseRuneChance = normalizeRuneDropChance(params.baseRuneDropChance)
  if (baseRuneChance > 0) {
    const runeGateRoll = params.rng() // 固定消费 1 次 Rune 门
    if (runeGateRoll < baseRuneChance) {
      try {
        const ts = params.runeTimestampFactory ? params.runeTimestampFactory() : (() => { throw new Error('runeTimestampFactory missing') })()
        const runePlan = planRuneGeneration(params.rng, ts)
        if (runePlan.ok) {
          shouldDropRune = true
          rune = runePlan.rune
        }
      } catch {
        // 失败隔离：保留 rune=null / shouldDropRune=false
      }
    }
  }

  return { diamondCount, shouldDropEquipment, equipment, shouldDropRune, rune }
}
