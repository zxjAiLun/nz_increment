import type { Equipment, Rarity } from '../types'
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

const VALID_RARITIES: ReadonlyArray<Rarity> = [
  'common', 'good', 'fine', 'epic', 'legend', 'myth', 'ancient', 'eternal'
]

function isValidEquipment(eq: unknown): eq is Equipment {
  if (!eq || typeof eq !== 'object') return false
  const e = eq as Equipment
  if (typeof e.id !== 'string' || e.id.length === 0) return false
  if (typeof e.slot !== 'string' || e.slot.length === 0) return false
  if (typeof e.rarity !== 'string' || !VALID_RARITIES.includes(e.rarity as Rarity)) return false
  if (!Array.isArray(e.stats)) return false
  // 至少能安全计算评分（stats 元素需为合法 StatBonus）
  if (!e.stats.every(s => s && typeof s === 'object' && typeof (s as { type?: unknown }).type === 'string')) {
    return false
  }
  return true
}

/**
 * 计算"新装备是否应替换当前装备"的唯一决策入口。
 *
 * 决策顺序（严格）：
 *   1. 校验 next（非法 → invalid）
 *   2. 空槽位（current === null → equip-empty，回收金币 0）
 *   3. 当前装备锁定（isLocked → blocked-locked，一律拒绝）
 *   4. 计算双方分数
 *   5. 阈值判断：仅当 newScore > oldScore * threshold 才替换（相等/较低 → not-better）
 *   6. 仅在"确实替换一个未锁定旧装备"时计算旧装备回收价
 *
 * 默认 threshold = 1.0（newScore 必须严格大于 oldScore）；
 * threshold = 1.05 表示新分数必须严格超过旧分数的 105% 才替换。
 *
 * 非有限、负分或非法回收价不得进入玩家状态：任何此类异常都降级为 invalid。
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
  if (!isValidEquipment(next)) {
    return { kind: 'invalid', reason: 'next is not a valid Equipment' }
  }
  // threshold 必须是正有限数，否则视为非法（避免 NaN/负数导致误判或无限循环）
  if (!Number.isFinite(threshold) || threshold <= 0) {
    return { kind: 'invalid', reason: 'threshold must be a positive finite number' }
  }

  const newScore = calculateEquipmentScore(next)
  if (!Number.isFinite(newScore)) {
    return { kind: 'invalid', reason: 'next produced a non-finite score' }
  }

  // 2. 空槽位
  if (current === null) {
    return { kind: 'equip-empty', newScore, recycleGold: 0 }
  }

  // 3. 当前装备锁定 → 一律拒绝（真正不可被破坏）
  if (current.isLocked) {
    const oldScore = calculateEquipmentScore(current)
    return { kind: 'blocked-locked', oldScore, newScore }
  }

  // 4. 计算分数
  const oldScore = calculateEquipmentScore(current)
  if (!Number.isFinite(oldScore)) {
    return { kind: 'invalid', reason: 'current produced a non-finite score' }
  }

  // 5. 阈值判断（相等或较低均拒绝；1.05 边界前/等于/超过语义一致）
  if (!(newScore > oldScore * threshold)) {
    return { kind: 'not-better', oldScore, newScore }
  }

  // 6. 仅成功替换时计算旧装备回收价，并拒绝非法回收价
  const recycleGold = calculateRecyclePrice(current)
  if (!Number.isFinite(recycleGold) || recycleGold < 0) {
    return { kind: 'invalid', reason: 'recycle price is not a valid non-negative number' }
  }

  return { kind: 'replace', oldScore, newScore, recycleGold }
}
