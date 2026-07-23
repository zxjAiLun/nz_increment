/**
 * 装备精炼系统——唯一精炼数值与事务规划来源（Phase 3.5）。
 *
 * 本文件是精炼相关数值与规则的**唯一事实来源**：
 *   - 所有常量（MAX_REFINING_LEVEL / MAX_REFINING_SLOTS / 成本基准与成长 / stat 池）只此一份，
 *     禁止在 Store / UI / 测试中复制第二份 15 / 3 / 100 / 1.2 / stat pool。
 *   - 精炼状态校验（validateEquipmentRefiningState）复用 validateEquipmentForEconomy。
 *   - 纯规划（planEquipmentRefinement）不修改任何输入，确定性校验全部通过后才调用 RNG。
 *   - 属性读取（getEquipmentRefiningBonuses）把合法精炼槽位转成 flat StatBonus，
 *     损坏时返回空数组，绝不注入 NaN / Infinity / 负数 / 未知 stat。
 *
 * 生产精炼写入只经 playerStore.tryRefineEquipment。
 */

import type { Equipment, RefiningSlot, StatBonus, StatType } from '../types'
import { validateEquipmentForEconomy } from './equipmentReplacement'

// —— 唯一常量来源 ——
export const MAX_REFINING_LEVEL = 15
export const MAX_REFINING_SLOTS = 3
export const REFINING_COST_BASE = 100
export const REFINING_COST_GROWTH = 1.2

export const REFINING_STAT_POOL = [
  'attack',
  'defense',
  'maxHp',
  'critRate',
  'critDamage',
  'lifesteal'
] as const

export type RefiningStat = (typeof REFINING_STAT_POOL)[number]

const REFINING_STAT_SET = new Set<string>(REFINING_STAT_POOL)

/** 精炼成本：cost = floor(100 × 1.2^refiningLevel)（与既有公式一致，不修改数值）。 */
export function calculateRefiningCost(level: number): number {
  return Math.floor(REFINING_COST_BASE * Math.pow(REFINING_COST_GROWTH, level))
}

/** 默认 RNG（仅在没有注入时使用）；注入用于确定性测试。 */
function defaultRng(): number {
  return Math.random()
}

export type RefiningValidationResult =
  | { ok: true; equipment: Equipment }
  | { ok: false; reason: string }

/**
 * 精炼状态校验：先复用装备经济校验，再校验精炼结构。
 * 任意 malformed 输入返回失败，绝不抛异常、绝不静默修复、绝不只应用一部分。
 */
export function validateEquipmentRefiningState(equipment: unknown): RefiningValidationResult {
  const econ = validateEquipmentForEconomy(equipment)
  if (!econ.ok) return { ok: false, reason: `equipment invalid: ${econ.reason}` }
  const eq = econ.equipment

  // refiningLevel：0..15 的有限整数
  if (
    typeof eq.refiningLevel !== 'number' ||
    !Number.isInteger(eq.refiningLevel) ||
    !Number.isFinite(eq.refiningLevel) ||
    eq.refiningLevel < 0 ||
    eq.refiningLevel > MAX_REFINING_LEVEL
  ) {
    return { ok: false, reason: 'refiningLevel must be an integer in [0, MAX_REFINING_LEVEL]' }
  }

  // refiningSlots：数组且长度 <= 3
  if (!Array.isArray(eq.refiningSlots)) {
    return { ok: false, reason: 'refiningSlots must be an array' }
  }
  if (eq.refiningSlots.length > MAX_REFINING_SLOTS) {
    return { ok: false, reason: 'refiningSlots length exceeds MAX_REFINING_SLOTS' }
  }

  // 每个 slot：对象 + index 唯一并与位置一致 + stat 合法 + value 有限非负整数 + type flat
  const seenIndices = new Set<number>()
  for (let i = 0; i < eq.refiningSlots.length; i++) {
    const slot = eq.refiningSlots[i]
    if (!slot || typeof slot !== 'object') {
      return { ok: false, reason: 'each refining slot must be a non-null object' }
    }
    if (
      typeof slot.index !== 'number' ||
      !Number.isInteger(slot.index) ||
      !Number.isFinite(slot.index) ||
      slot.index < 0
    ) {
      return { ok: false, reason: 'refining slot index must be a finite non-negative integer' }
    }
    if (seenIndices.has(slot.index)) {
      return { ok: false, reason: 'refining slot index must be unique' }
    }
    seenIndices.add(slot.index)
    if (slot.index !== i) {
      return { ok: false, reason: 'refining slot index must match its array position' }
    }
    if (typeof slot.stat !== 'string' || !REFINING_STAT_SET.has(slot.stat)) {
      return { ok: false, reason: 'refining slot stat must belong to REFINING_STAT_POOL' }
    }
    if (
      typeof slot.value !== 'number' ||
      !Number.isInteger(slot.value) ||
      !Number.isFinite(slot.value) ||
      slot.value < 0
    ) {
      return { ok: false, reason: 'refining slot value must be a finite non-negative integer' }
    }
    if (slot.type !== 'flat') {
      return { ok: false, reason: 'refining slot type must be flat' }
    }
  }

  return { ok: true, equipment: eq }
}

export type EquipmentRefiningPlan =
  | {
      ok: true
      cost: number
      currentLevel: number
      nextLevel: number
      nextSlots: RefiningSlot[]
      rngCalls: number
    }
  | {
      ok: false
      reason: string
    }

/**
 * 装备精炼的纯规划入口（不修改任何输入，不在拒绝时扣款或写值）。
 *
 * 严格顺序：
 *   1. 装备经济结构（validateEquipmentForEconomy）
 *   2. 精炼状态（validateEquipmentRefiningState）
 *   3. playerGold 有限非负
 *   4. level < 15
 *   5. 计算并校验 cost 为有限正整数
 *   6. 金币足够
 *   7. 生成 nextSlots（新增槽位：所有确定性校验通过后才调用 RNG 恰好一次；强化：不调用 RNG）
 *   8. 检查本次精炼确实产生状态改善（强化时要求至少一个槽位 nextValue 严格增加）
 *
 * RNG 仅在「新增槽位」且确定性校验全部通过后调用一次；其结果必须为有限且满足 0 <= roll < 1，
 * 否则拒绝（不扣款、不写值、不抛异常）。
 */
export function planEquipmentRefinement(
  equipment: unknown,
  playerGold: number,
  rng: () => number = defaultRng
): EquipmentRefiningPlan {
  // 1. 装备经济结构
  const econ = validateEquipmentForEconomy(equipment)
  if (!econ.ok) return { ok: false, reason: `equipment invalid: ${econ.reason}` }
  const eq = econ.equipment

  // 2. 精炼状态
  const ref = validateEquipmentRefiningState(eq)
  if (!ref.ok) return { ok: false, reason: ref.reason }

  // 3. playerGold 有限非负
  if (typeof playerGold !== 'number' || !Number.isFinite(playerGold) || playerGold < 0) {
    return { ok: false, reason: 'playerGold must be a finite non-negative number' }
  }

  // 4. level < 15
  if (eq.refiningLevel >= MAX_REFINING_LEVEL) {
    return { ok: false, reason: 'refining already at max level' }
  }

  // 5. cost 有限正整数
  const cost = calculateRefiningCost(eq.refiningLevel)
  if (!Number.isFinite(cost) || !Number.isInteger(cost) || cost <= 0) {
    return { ok: false, reason: 'cost must be a finite positive integer' }
  }

  // 6. 金币足够
  if (playerGold < cost) {
    return { ok: false, reason: 'not enough gold' }
  }

  // 7. 生成 nextSlots（不修改输入：基于副本构建）
  const currentSlots = eq.refiningSlots
  const nextSlots: RefiningSlot[] = currentSlots.map(s => ({ ...s }))
  let rngCalls = 0

  if (currentSlots.length < MAX_REFINING_SLOTS) {
    // 新增槽位：确定性校验全部通过后恰好调用 RNG 一次
    const roll = rng()
    rngCalls++
    if (typeof roll !== 'number' || !Number.isFinite(roll) || roll < 0 || roll >= 1) {
      return { ok: false, reason: 'rng must return a finite number in [0, 1)' }
    }
    const poolIndex = Math.min(
      REFINING_STAT_POOL.length - 1,
      Math.floor(roll * REFINING_STAT_POOL.length)
    )
    const stat = REFINING_STAT_POOL[poolIndex]
    const value = Math.floor(eq.level * 0.5) + 1
    nextSlots.push({ index: currentSlots.length, stat, value, type: 'flat' })
    // 8. 新增槽位本身即为状态改善，无需额外判定
  } else {
    // 强化已有槽位：不调用 RNG；每个槽位按 floor(value × 1.1) 计算
    let anyGrowth = false
    for (const slot of nextSlots) {
      const nextValue = Math.floor(slot.value * 1.1)
      if (nextValue > slot.value) anyGrowth = true
      slot.value = nextValue
    }
    // 8. 所有槽位都没有严格增加时拒绝，不收钱换取无变化的精炼
    if (!anyGrowth) {
      return { ok: false, reason: 'no refining slot would strictly improve' }
    }
  }

  return {
    ok: true,
    cost,
    currentLevel: eq.refiningLevel,
    nextLevel: eq.refiningLevel + 1,
    nextSlots,
    rngCalls
  }
}

/**
 * 读取装备的精炼属性加成（纯函数，不修改装备）。
 * 合法时把每个 RefiningSlot 转成对应 flat StatBonus；损坏时返回空数组。
 * 不允许 NaN / Infinity / 负数 / 未知 stat 注入角色属性。
 */
export function getEquipmentRefiningBonuses(equipment: unknown): StatBonus[] {
  const ref = validateEquipmentRefiningState(equipment)
  if (!ref.ok) return []
  const eq = ref.equipment
  const result: StatBonus[] = []
  for (const slot of eq.refiningSlots) {
    const v = slot.value
    if (
      typeof v !== 'number' ||
      !Number.isFinite(v) ||
      !Number.isInteger(v) ||
      v < 0 ||
      !REFINING_STAT_SET.has(slot.stat)
    ) {
      continue
    }
    result.push({ type: slot.stat as StatType, value: v, isPercent: false })
  }
  return result
}
