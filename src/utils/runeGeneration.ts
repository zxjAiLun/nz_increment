/**
 * 符文生成与入库 —— 唯一纯模块（Phase 3.8）
 *
 * 本文件是“符文确定性生成 + 唯一 ID 校验 + 纯入库规划”的唯一事实来源，取代旧
 * runeStore.generateRune() 内联的 type/rarity/baseStat/multiplier/ID 拼接实现。
 *
 * 设计约束（与 equipmentRunes.ts / runeExperience.ts 同一纪律）：
 *   - 所有函数纯函数、可注入 RNG / timestamp、不抛异常（malformed 一律返回失败结果）。
 *   - 生成公式（type / rarity / baseStat / multiplier / ID 格式）集中于此，禁止在
 *     runeStore、测试或其他文件复制第二份概率或基础数值。
 *   - 一次成功生成恰好消费三次 RNG：type roll → rarity roll → ID 后缀 roll。timestamp 不属于 RNG。
 *   - 入库规划纯函数、不调用 RNG、不修改输入；候选 Rune 永远追加到末尾，canonical 重复拒绝。
 *   - 生产落库只经 playerStore 的原子事务（tryAcquireRune / tryGenerateAndAcquireRune），
 *     且这些事务只调用本文件的 plan* 纯规划。
 *   - 击杀掉率、Monster.runeDropChance、killDrops 接入、runtime/simulator RNG parity、
 *     套装 / 合成 / 回收 / 容量限制 / 自动镶嵌 一律不在此实现（后续独立阶段）。
 */

import type { Rune, RuneType, RuneRarity } from '../stores/runeStore'
import { validateRune, validateRuneInventory } from './equipmentRunes'
import { validateRuneProgressionState } from './runeExperience'

// ----------------------------- 常量单一来源（只读冻结） -----------------------------

/**
 * 符文类型（六种等概率）。index = floor(typeRoll × 6)。
 * 顺序即概率区间顺序，禁止调整。
 */
export const RUNE_GENERATION_TYPES = Object.freeze([
  'attack',
  'defense',
  'health',
  'crit',
  'speed',
  'luck'
] as const)

/**
 * 稀有度阈值（累积上界，开区间判定）：
 *   roll < common(0.60) → common
 *   roll < rare(0.85)   → rare
 *   roll < epic(0.97)   → epic
 *   否则                → legend
 * 禁止调整概率。
 */
export const RUNE_GENERATION_RARITY_THRESHOLDS = Object.freeze({
  common: 0.6,
  rare: 0.85,
  epic: 0.97
} as const)

/** 各类型基础 statValue（唯一来源，禁止重平衡）。 */
export const RUNE_BASE_STAT_VALUES = Object.freeze({
  attack: 10,
  defense: 8,
  health: 50,
  crit: 3,
  speed: 5,
  luck: 5
} as const)

/** 各稀有度 statValue 乘数（唯一来源，禁止重平衡）。 */
export const RUNE_RARITY_MULTIPLIERS = Object.freeze({
  common: 1,
  rare: 1.5,
  epic: 2,
  legend: 3
} as const)

// ----------------------------- 内部纯 helper -----------------------------

/** RNG 返回值必须是 number / finite / 0 <= value < 1。 */
function isValidRoll(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < 1
}

/** timestamp 必须是有限正整数。 */
function isValidTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value > 0
}

/** 由 rarity roll 派生稀有度（阈值来自唯一常量）。 */
function deriveRarity(roll: number): RuneRarity {
  const t = RUNE_GENERATION_RARITY_THRESHOLDS
  if (roll < t.common) return 'common'
  if (roll < t.rare) return 'rare'
  if (roll < t.epic) return 'epic'
  return 'legend'
}

/** 两枚 Rune 关键字段是否相等（入库后置校验用）。 */
function runeEquals(a: Rune, b: Rune): boolean {
  return (
    a.id === b.id &&
    a.type === b.type &&
    a.rarity === b.rarity &&
    a.level === b.level &&
    a.exp === b.exp &&
    a.statValue === b.statValue
  )
}

// ----------------------------- 纯生成 API -----------------------------

/** 符文生成规划结果（判别联合）。成功恰好消费三次 RNG。 */
export type RuneGenerationPlan =
  | {
      ok: true
      rune: Rune
      rollsConsumed: 3
    }
  | {
      ok: false
      reason: string
      rollsConsumed: number
    }

/**
 * 纯规划：给定可注入 RNG 与 timestamp，确定性生成一枚 Rune。
 * 不修改任何输入、不抛异常。
 *
 * RNG 顺序锁定（成功恰好三次）：
 *   1. type roll   → index = floor(roll × 6)
 *   2. rarity roll → 阈值判定
 *   3. ID 后缀 roll → `rune_${timestamp}_${roll.toString(36).substr(2,5)}`
 * timestamp 不属于 RNG 消费；不使用 crypto.randomUUID；不因分支增加 RNG；不重 roll ID。
 *
 * 失败条件（任一 → 返回失败，不返回部分 Rune）：
 *   - rng 非函数（rollsConsumed 0）
 *   - timestamp 非有限正整数（rollsConsumed 0，在消费任何 RNG 前校验）
 *   - 任一 RNG 返回值非 number / 非 finite / <0 / >=1
 *   - RNG 抛异常
 *   - 候选 Rune 未通过 validateRune / validateRuneProgressionState
 *   - level !== 1 / exp !== 0 / statValue 非有限非负整数 / id 非 canonical 非空
 */
export function planRuneGeneration(rng: unknown, timestamp: unknown): RuneGenerationPlan {
  let rollsConsumed = 0
  try {
    // 1. rng 必须是函数
    if (typeof rng !== 'function') {
      return { ok: false, reason: 'rng must be a function', rollsConsumed: 0 }
    }
    // 2. timestamp 必须是有限正整数（消费任何 RNG 前校验，确保失败时 rollsConsumed = 0）
    if (!isValidTimestamp(timestamp)) {
      return { ok: false, reason: 'timestamp must be a finite positive integer', rollsConsumed: 0 }
    }

    const roll = rng as () => unknown

    // 3. type roll
    const typeRoll = roll()
    rollsConsumed++
    if (!isValidRoll(typeRoll)) {
      return { ok: false, reason: 'type roll must be a finite number in [0, 1)', rollsConsumed }
    }

    // 4. rarity roll
    const rarityRoll = roll()
    rollsConsumed++
    if (!isValidRoll(rarityRoll)) {
      return { ok: false, reason: 'rarity roll must be a finite number in [0, 1)', rollsConsumed }
    }

    // 5. ID 后缀 roll
    const suffixRoll = roll()
    rollsConsumed++
    if (!isValidRoll(suffixRoll)) {
      return { ok: false, reason: 'suffix roll must be a finite number in [0, 1)', rollsConsumed }
    }

    // 派生 type
    const typeIndex = Math.floor(typeRoll * RUNE_GENERATION_TYPES.length)
    const type = RUNE_GENERATION_TYPES[typeIndex] as RuneType | undefined
    if (!type) {
      return { ok: false, reason: 'derived type index out of range', rollsConsumed }
    }

    // 派生 rarity
    const rarity = deriveRarity(rarityRoll)

    // 派生 statValue = floor(base × multiplier)
    const baseStat = RUNE_BASE_STAT_VALUES[type]
    const multiplier = RUNE_RARITY_MULTIPLIERS[rarity]
    const statValue = Math.floor(baseStat * multiplier)

    // 派生 ID（保持旧格式，禁止改前缀 / 字段顺序 / 后缀算法）
    const id = `rune_${timestamp}_${suffixRoll.toString(36).substr(2, 5)}`

    const candidate: Rune = { id, type, rarity, level: 1, exp: 0, statValue }

    // 依次通过结构校验与进度校验
    const rv = validateRune(candidate)
    if (!rv.ok) return { ok: false, reason: `candidate invalid: ${rv.reason}`, rollsConsumed }
    const pv = validateRuneProgressionState(candidate)
    if (!pv.ok) return { ok: false, reason: `candidate progression invalid: ${pv.reason}`, rollsConsumed }

    // 再次确认初始 progression 与数值约束
    if (rv.rune.level !== 1 || rv.rune.exp !== 0) {
      return { ok: false, reason: 'generated rune must start at level 1 / exp 0', rollsConsumed }
    }
    if (!Number.isFinite(rv.rune.statValue) || !Number.isInteger(rv.rune.statValue) || rv.rune.statValue < 0) {
      return { ok: false, reason: 'generated statValue must be a finite non-negative integer', rollsConsumed }
    }
    if (typeof rv.rune.id !== 'string' || rv.rune.id.trim().length === 0) {
      return { ok: false, reason: 'generated id must be a canonical non-empty string', rollsConsumed }
    }

    // 使用 validateRune 返回的 canonical 副本
    return { ok: true, rune: rv.rune, rollsConsumed: 3 }
  } catch {
    return { ok: false, reason: 'rune generation threw', rollsConsumed }
  }
}

// ----------------------------- 纯入库规划 API -----------------------------

/** 符文入库规划结果（判别联合）。 */
export type RuneAcquisitionPlan =
  | {
      ok: true
      acquiredRune: Rune
      nextInventory: Rune[]
      insertIndex: number
    }
  | {
      ok: false
      reason: string
    }

/**
 * 纯规划：把候选 Rune 追加到 inventory 末尾（不镶嵌）。
 * 不修改任何输入、不调用 RNG、不抛异常。
 *
 * 执行顺序：
 *   validateRuneInventory(inventory) → validateRune(candidate)
 *   → validateRuneProgressionState(candidate) → canonical ID 重复检查
 *   → 构造追加后的 nextInventory → validateRuneInventory(nextInventory)
 *   → validateRuneProgressionState(追加项) → postcondition gate
 *
 * 约束：
 *   - 候选 Rune 永远追加到末尾；原 inventory 数量、顺序、每枚字段完全不变（字节级）。
 *   - candidate 采用 validateRune 返回的 canonical 副本（padded id 被 trim）。
 *   - canonical 重复必须拒绝（例如 inventory 已有 id="  r1  "、candidate id="r1" → 冲突）。
 *   - 不覆盖旧 Rune、不自动改名、不重新生成 ID。
 */
export function planRuneAcquisition(inventory: unknown, candidate: unknown): RuneAcquisitionPlan {
  try {
    // 1. inventory 必须通过校验
    const inv = validateRuneInventory(inventory)
    if (!inv.ok) return { ok: false, reason: `inventory invalid: ${inv.reason}` }

    // 2. candidate 必须通过结构校验（返回 canonical 副本）
    const cv = validateRune(candidate)
    if (!cv.ok) return { ok: false, reason: `candidate invalid: ${cv.reason}` }

    // 3. candidate 进度状态必须 canonical
    const pv = validateRuneProgressionState(candidate)
    if (!pv.ok) return { ok: false, reason: `candidate progression invalid: ${pv.reason}` }

    const canonical: Rune = { ...cv.rune }

    // 4. canonical ID 重复检查（inv.inventory 的 id 已 trim；能识别 padded 与 candidate 冲突）
    if (inv.inventory.some(r => r.id === canonical.id)) {
      return { ok: false, reason: 'duplicate rune id' }
    }

    // 5. 构造 nextInventory：保留原 inventory 原始字段（字节级不变）+ canonical candidate 追加末尾
    const original = inventory as Rune[]
    const nextInventory: Rune[] = [...original.map(r => ({ ...r })), canonical]
    const insertIndex = nextInventory.length - 1

    // 6. 追加后 inventory 必须整体合法（含唯一性）
    const nv = validateRuneInventory(nextInventory)
    if (!nv.ok) return { ok: false, reason: `next inventory invalid: ${nv.reason}` }

    // 7. 追加项进度状态必须 canonical
    const npv = validateRuneProgressionState(nextInventory[insertIndex])
    if (!npv.ok) return { ok: false, reason: 'appended rune progression invalid' }

    // 8. postcondition gate
    if (nextInventory.length !== original.length + 1) {
      return { ok: false, reason: 'next inventory length mismatch' }
    }
    if (insertIndex !== original.length) {
      return { ok: false, reason: 'insert index must be the tail position' }
    }
    for (let i = 0; i < original.length; i++) {
      if (!runeEquals(nextInventory[i], original[i])) {
        return { ok: false, reason: 'existing rune altered during planning' }
      }
    }
    if (!runeEquals(nextInventory[insertIndex], canonical)) {
      return { ok: false, reason: 'appended rune mismatch' }
    }

    return { ok: true, acquiredRune: { ...canonical }, nextInventory, insertIndex }
  } catch {
    return { ok: false, reason: 'rune acquisition planning threw' }
  }
}
