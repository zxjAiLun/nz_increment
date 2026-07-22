import type { Equipment } from '../types'
import { EQUIPMENT_SLOTS, STAT_NAMES, RARITY_MULTIPLIER } from '../types'
import { calculateEquipmentScore, calculateRecyclePrice } from './calc'

/**
 * 装备替换决策结果（纯函数 planEquipmentReplacement 的唯一返回值）。
 *
 * 所有装备流转入口（equipItem / autoEquipIfBetter / equipNewEquipment / unequip 的"是否可替换"判断）
 * 必须先取得本决策，再据此执行事务。决策本身不修改任何装备或玩家状态。
 */
export type EquipmentReplacementDecision =
  | { kind: 'equip-empty'; newScore: number; recycleGold: 0 }
  | { kind: 'replace'; oldScore: number; newScore: number; recycleGold: number }
  | { kind: 'blocked-locked'; oldScore: number; newScore: number }
  | { kind: 'not-better'; oldScore: number; newScore: number }
  | { kind: 'invalid'; reason: string }

/**
 * 装备经济校验结果。ok 时回传经过校验的装备对象（可安全写入玩家状态）。
 * 任何 malformed 输入都必须返回 { ok:false }，校验过程不得抛异常。
 */
export type EquipmentValidationResult =
  | { ok: true; equipment: Equipment }
  | { ok: false; reason: string }

// 单一事实来源：不手写第二份 slot / stat / rarity 列表，直接复用项目既有常量。
const EQUIPMENT_SLOT_SET = new Set<string>(EQUIPMENT_SLOTS)
const STAT_TYPE_SET = new Set<string>(Object.keys(STAT_NAMES))
const VALID_RARITIES = new Set<string>(Object.keys(RARITY_MULTIPLIER))

/**
 * 统一装备经济校验（替换与回收共享，禁止维护两套规则）。
 *
 * 至少验证：
 *   - raw 是对象（非 null / 非数组）
 *   - id 是 trim 后非空字符串
 *   - slot 属于 EQUIPMENT_SLOTS
 *   - rarity 属于合法稀有度（RARITY_MULTIPLIER 的 key）
 *   - stats 是数组
 *   - 每个 StatBonus：type 属于合法 StatType、value 是有限非负数、isPercent 是 boolean
 *   - 计算出的 score 是有限非负整数
 *
 * 未知 stat type 不会按默认基础值 10 当成合法装备（STAT_TYPE_SET 严格白名单）。
 * 校验过程不抛异常：任何 malformed object、或 calculateEquipmentScore 抛异常，均返回 { ok:false }。
 */
export function validateEquipmentForEconomy(raw: unknown): EquipmentValidationResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: 'equipment must be a non-null object' }
  }
  const e = raw as Record<string, unknown>

  // id：trim 后非空
  if (typeof e.id !== 'string' || e.id.trim().length === 0) {
    return { ok: false, reason: 'id must be a non-empty string' }
  }
  // slot：必须是合法装备槽位（拒绝 '' / 'not-a-slot' / '__proto__' / 'constructor' 等）
  if (typeof e.slot !== 'string' || !EQUIPMENT_SLOT_SET.has(e.slot)) {
    return { ok: false, reason: 'slot must be a valid EquipmentSlot' }
  }
  // rarity：必须是合法稀有度（单一事实来源，不手写列表）
  if (typeof e.rarity !== 'string' || !VALID_RARITIES.has(e.rarity)) {
    return { ok: false, reason: 'rarity must be a valid Rarity' }
  }
  // stats：必须是数组
  if (!Array.isArray(e.stats)) {
    return { ok: false, reason: 'stats must be an array' }
  }
  // 每个词条：type 白名单、value 有限非负、isPercent 为 boolean
  for (const s of e.stats) {
    if (!s || typeof s !== 'object') {
      return { ok: false, reason: 'each stat must be a non-null object' }
    }
    const stat = s as Record<string, unknown>
    if (typeof stat.type !== 'string' || !STAT_TYPE_SET.has(stat.type)) {
      return { ok: false, reason: 'stat.type must be a valid StatType' }
    }
    if (typeof stat.value !== 'number' || !Number.isFinite(stat.value) || stat.value < 0) {
      return { ok: false, reason: 'stat.value must be a finite non-negative number' }
    }
    if (typeof stat.isPercent !== 'boolean') {
      return { ok: false, reason: 'stat.isPercent must be a boolean' }
    }
  }

  // 计算分数：必须是有限非负整数；计算抛异常也判非法（损坏数据防护）
  let score = 0
  try {
    score = calculateEquipmentScore(e as unknown as Equipment)
  } catch {
    return { ok: false, reason: 'score calculation threw' }
  }
  if (!Number.isFinite(score) || score < 0 || !Number.isInteger(score)) {
    return { ok: false, reason: 'computed score must be a finite non-negative integer' }
  }

  return { ok: true, equipment: e as unknown as Equipment }
}

/**
 * 装备回收规划（原子回收前必须先过经济校验）。
 * 返回 { ok:true, recycleGold } 或 { ok:false, reason }。
 * 替换与回收共享同一套 validateEquipmentForEconomy 规则。
 */
export function planEquipmentRecycle(
  equipment: unknown
): { ok: true; recycleGold: number } | { ok: false; reason: string } {
  const validation = validateEquipmentForEconomy(equipment)
  if (!validation.ok) {
    return { ok: false, reason: validation.reason }
  }
  let recycleGold = 0
  try {
    recycleGold = calculateRecyclePrice(validation.equipment)
  } catch {
    return { ok: false, reason: 'recycle price calculation threw' }
  }
  if (!Number.isFinite(recycleGold) || recycleGold < 0 || !Number.isInteger(recycleGold)) {
    return { ok: false, reason: 'recycle price must be a finite non-negative integer' }
  }
  return { ok: true, recycleGold }
}

/**
 * 计算"新装备是否应替换当前装备"的唯一决策入口。
 *
 * 决策顺序（严格）：
 *   1. 校验 next（非法 → invalid）
 *   2. 校验 threshold（非正/非有限 → invalid）
 *   3. 计算 newScore（抛异常/非有限/负分 → invalid）
 *   4. 空槽位（current === null → equip-empty，回收金币 0）
 *   5. 校验/安全处理 current（损坏 current → invalid，不得抛异常或覆盖）
 *   6. 当前装备锁定（isLocked → blocked-locked，一律拒绝）
 *   7. 计算 oldScore（非有限/负分 → invalid）
 *   8. 阈值判断：仅当 newScore > oldScore * threshold 才替换（相等/较低 → not-better）
 *   9. 仅在"确实替换一个未锁定旧装备"时计算旧装备回收价（非有限/负/非整数 → invalid）
 *
 * 非有限、负分或非法回收价不得进入玩家状态。
 *
 * @param next 待装备的新装备
 * @param current 当前槽位装备（null 表示空槽位）
 * @param threshold 评分阈值倍数（默认 1.0）
 */
export function planEquipmentReplacement(
  next: Equipment,
  current: Equipment | null,
  threshold: number = 1.0
): EquipmentReplacementDecision {
  // 1. 校验 next
  const nextValidation = validateEquipmentForEconomy(next)
  if (!nextValidation.ok) {
    return { kind: 'invalid', reason: nextValidation.reason }
  }
  const validNext = nextValidation.equipment

  // 2. threshold 必须是正有限数
  if (!Number.isFinite(threshold) || threshold <= 0) {
    return { kind: 'invalid', reason: 'threshold must be a positive finite number' }
  }

  // 3. 计算 newScore
  let newScore = 0
  try {
    newScore = calculateEquipmentScore(validNext)
  } catch {
    return { kind: 'invalid', reason: 'next produced a non-finite score' }
  }
  if (!Number.isFinite(newScore) || newScore < 0) {
    return { kind: 'invalid', reason: 'next produced a non-finite or negative score' }
  }

  // 4. 空槽位
  if (current === null) {
    return { kind: 'equip-empty', newScore, recycleGold: 0 }
  }

  // 5. 校验/安全处理 current：损坏的当前装备不得被覆盖或抛异常，返回 invalid
  const curValidation = validateEquipmentForEconomy(current)
  if (!curValidation.ok) {
    return { kind: 'invalid', reason: `current equipment invalid: ${curValidation.reason}` }
  }
  const validCurrent = curValidation.equipment

  // 6. 当前装备锁定 → 一律拒绝（真正不可被破坏）
  if (validCurrent.isLocked) {
    const oldScore = calculateEquipmentScore(validCurrent)
    return { kind: 'blocked-locked', oldScore, newScore }
  }

  // 7. 计算 oldScore
  const oldScore = calculateEquipmentScore(validCurrent)
  if (!Number.isFinite(oldScore) || oldScore < 0) {
    return { kind: 'invalid', reason: 'current produced a non-finite or negative score' }
  }

  // 8. 阈值判断（相等或较低均拒绝；1.05 边界前/等于/超过语义一致）
  if (!(newScore > oldScore * threshold)) {
    return { kind: 'not-better', oldScore, newScore }
  }

  // 9. 仅成功替换时计算旧装备回收价，并拒绝非法回收价
  let recycleGold = 0
  try {
    recycleGold = calculateRecyclePrice(validCurrent)
  } catch {
    return { kind: 'invalid', reason: 'recycle price calculation threw' }
  }
  if (!Number.isFinite(recycleGold) || recycleGold < 0 || !Number.isInteger(recycleGold)) {
    return { kind: 'invalid', reason: 'recycle price is not a valid non-negative integer' }
  }

  return { kind: 'replace', oldScore, newScore, recycleGold }
}
