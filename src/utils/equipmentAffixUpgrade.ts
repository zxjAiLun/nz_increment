import type { StatType } from '../types'
import { STAT_NAMES } from '../types'
import { validateEquipmentForEconomy } from './equipmentReplacement'

// 单一事实来源：升级成本增长率。禁止在别处复制 1.15（成本公式只此一份）。
export const UPGRADE_GROWTH = 1.15

/**
 * 升级成本：cost = floor(currentValue × 1.15^upgradeLevel)
 * 与既有装备词缀升级系统的数值完全一致（不修改数值）。
 */
export function calculateUpgradeCost(baseValue: number, currentLevel: number): number {
  return Math.floor(baseValue * UPGRADE_GROWTH ** currentLevel)
}

/**
 * 升级后数值：nextValue = currentValue + floor(currentValue × 0.1)
 * 与既有公式一致（不修改数值）。若该公式导致 nextValue <= currentValue，调用方须拒绝购买。
 */
export function calculateUpgradeNextValue(currentValue: number): number {
  return currentValue + Math.floor(currentValue * 0.1)
}

/**
 * 装备词缀升级规划结果（纯函数 planEquipmentAffixUpgrade 的唯一返回值）。
 * ok 时回传完整升级参数（事务据此原子落盘）；ok=false 时仅回传拒绝原因，过程不修改任何状态。
 */
export type EquipmentAffixUpgradePlan =
  | {
      ok: true
      statIndex: number
      affixIndex: number
      stat: StatType
      cost: number
      currentValue: number
      nextValue: number
      currentLevel: number
      nextLevel: number
    }
  | { ok: false; reason: string }

const STAT_TYPE_SET = new Set<string>(Object.keys(STAT_NAMES))

/**
 * 装备词缀升级的纯规划入口（不修改任何状态）。
 *
 * 决策顺序（严格）：
 *   1. 装备通过 validateEquipmentForEconomy（slot / rarity / stats / score）
 *   2. affixes 是数组
 *   3. affixIndex 是合法非负整数且在范围内
 *   4. affix 完整且 stat 为合法 StatType
 *   5. isUpgradeable === true
 *   6. upgradeLevel 是有限非负整数
 *   7. affix.value 是有限非负数
 *   8. 对应 stats 中恰好存在一个同类型词条
 *   9. affix.value === stats.value（双模型一致，否则拒绝）
 *  10. playerGold 是有限非负数
 *  11. cost 是有限正整数
 *  12. playerGold >= cost
 *  13. nextValue 严格大于 currentValue（否则拒绝购买，不扣金币）
 *
 * 任何 malformed 输入都返回 { ok:false }，校验过程不得抛异常。
 *
 * @param equipment 待升级装备（unknown，内部先过经济校验）
 * @param affixIndex 词缀在 equipment.affixes 中的索引
 * @param playerGold 玩家当前金币
 */
export function planEquipmentAffixUpgrade(
  equipment: unknown,
  affixIndex: number,
  playerGold: number
): EquipmentAffixUpgradePlan {
  // 1. 装备经济校验（slot / rarity / stats / score）
  const validation = validateEquipmentForEconomy(equipment)
  if (!validation.ok) {
    return { ok: false, reason: `equipment invalid: ${validation.reason}` }
  }
  const eq = validation.equipment

  // 2. affixes 必须是数组
  if (!Array.isArray(eq.affixes)) {
    return { ok: false, reason: 'affixes must be an array' }
  }

  // 3. affixIndex 合法非负整数且在范围内
  if (!Number.isInteger(affixIndex) || affixIndex < 0) {
    return { ok: false, reason: 'affixIndex must be a non-negative integer' }
  }
  if (affixIndex >= eq.affixes.length) {
    return { ok: false, reason: 'affixIndex out of range' }
  }

  // 4. affix 完整且 stat 为合法 StatType
  const affix = eq.affixes[affixIndex]
  if (!affix || typeof affix !== 'object') {
    return { ok: false, reason: 'affix must be a non-null object' }
  }
  if (typeof affix.stat !== 'string' || !STAT_TYPE_SET.has(affix.stat)) {
    return { ok: false, reason: 'affix.stat must be a valid StatType' }
  }
  const stat = affix.stat

  // 5. 必须是可升级词缀
  if (affix.isUpgradeable !== true) {
    return { ok: false, reason: 'affix is not upgradeable' }
  }

  // 6. upgradeLevel 是有限非负整数
  if (
    typeof affix.upgradeLevel !== 'number' ||
    !Number.isInteger(affix.upgradeLevel) ||
    affix.upgradeLevel < 0 ||
    !Number.isFinite(affix.upgradeLevel)
  ) {
    return { ok: false, reason: 'upgradeLevel must be a finite non-negative integer' }
  }
  const currentLevel = affix.upgradeLevel as number

  // 7. affix.value 是有限非负数
  if (typeof affix.value !== 'number' || !Number.isFinite(affix.value) || affix.value < 0) {
    return { ok: false, reason: 'affix.value must be a finite non-negative number' }
  }
  const currentValue = affix.value as number

  // 8. 对应 stats 中恰好存在一个同类型词条
  if (!Array.isArray(eq.stats)) {
    return { ok: false, reason: 'stats must be an array' }
  }
  const statsArr = eq.stats as unknown as Array<Record<string, unknown>>
  const matchingIndices: number[] = []
  for (let i = 0; i < statsArr.length; i++) {
    const s = statsArr[i]
    if (s && typeof s === 'object' && s.type === stat) matchingIndices.push(i)
  }
  if (matchingIndices.length !== 1) {
    return { ok: false, reason: 'stats must contain exactly one matching stat' }
  }
  const statIndex = matchingIndices[0]
  const matchingStat = statsArr[statIndex]
  const statValue = matchingStat.value

  // 9. affix.value 必须与 stats.value 一致（双模型不得分叉）
  if (typeof statValue !== 'number' || !Number.isFinite(statValue) || statValue < 0) {
    return { ok: false, reason: 'matching stat.value must be a finite non-negative number' }
  }
  if (affix.value !== statValue) {
    return { ok: false, reason: 'affix.value must equal stats.value' }
  }

  // 10. playerGold 是有限非负数
  if (typeof playerGold !== 'number' || !Number.isFinite(playerGold) || playerGold < 0) {
    return { ok: false, reason: 'playerGold must be a finite non-negative number' }
  }

  // 11. cost 是有限正整数
  const cost = calculateUpgradeCost(currentValue, currentLevel)
  if (!Number.isFinite(cost) || !Number.isInteger(cost) || cost <= 0) {
    return { ok: false, reason: 'cost must be a finite positive integer' }
  }

  // 12. 金币足够
  if (playerGold < cost) {
    return { ok: false, reason: 'not enough gold' }
  }

  // 13. nextValue 必须严格大于 currentValue
  const nextValue = calculateUpgradeNextValue(currentValue)
  if (!Number.isFinite(nextValue) || nextValue <= currentValue) {
    return { ok: false, reason: 'nextValue must strictly exceed currentValue' }
  }

  return {
    ok: true,
    statIndex,
    affixIndex,
    stat,
    cost,
    currentValue,
    nextValue,
    currentLevel,
    nextLevel: currentLevel + 1
  }
}
