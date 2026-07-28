/**
 * 符文锁定 —— 唯一纯规划模块（Phase 3.12）
 *
 * 本文件是"Rune 锁定 / 解锁状态切换规划"的唯一事实来源。
 *
 * 设计约束（与 equipmentRunes.ts / runeExperience.ts / runeFeeding.ts 同一纪律）：
 *   - 纯函数：不修改任何输入、不写盘、不调用 RNG、不读取装备拓扑、不抛异常
 *     （malformed 一律返回失败结果）。
 *   - 锁定与拓扑无关：锁定/解锁不改变 Rune 的镶嵌绑定，本规划器不得触碰 runeSlots。
 *   - 生产切换只经 playerStore 的原子事务 trySetRuneLocked，且该事务只调用本文件的
 *     planRuneLockChange 纯规划。
 *   - 锁定语义（§11）：仅保护"作为吞噬材料被消耗"这一破坏性路径；不影响镶嵌 / 移除 /
 *     作为强化目标 / 属性生效 / 掉率 / 生成概率 / 经验需求。
 *   - 批量锁定 / 一键全锁 / 一键全解 / 锁定过滤器等一律不在此实现（禁止范围）。
 */

import type { CanonicalRune } from '../stores/runeStore'
import { validateRune, validateRuneInventory } from './equipmentRunes'

export interface PlanRuneLockChangeInput {
  inventory: unknown
  runeId: unknown
  isLocked: unknown
}

export type RuneLockChangePlan =
  | {
      ok: true
      changed: boolean
      targetIndex: number
      targetRune: CanonicalRune
      nextRune: CanonicalRune
    }
  | { ok: false; reason: string }

/**
 * 纯规划：把 inventory 中 canonical ID 匹配的 Rune 切换到目标锁定状态。
 *
 * 严格执行顺序：
 *   1. runeId 必须是字符串且 trim 后非空（canonical 化只作用于目标 ID，不改 inventory）
 *   2. isLocked 必须是严格 boolean（拒绝 truthy/falsy 猜测）
 *   3. validateRuneInventory 恰好一次（malformed / 重复 ID / getter 抛异常 → fail-closed）
 *   4. 按 canonical ID 查找唯一目标（不存在 → 失败；validateRuneInventory 已保证无重复）
 *   5. 已处于目标状态 → 成功返回 changed:false（幂等分支，targetRune 与 nextRune 等值）
 *   6. 构造 nextRune：仅 isLocked 变化，其余字段逐一复制
 *   7. validateRune(nextRune) 必须通过
 *   8. 后置校验：除 isLocked 外其余字段与目标完全一致
 *
 * 不修改输入、不写盘、无 RNG、不读装备、不抛异常（整体 try/catch fail-closed）。
 */
export function planRuneLockChange(input: PlanRuneLockChangeInput): RuneLockChangePlan {
  try {
    if (!input || typeof input !== 'object') {
      return { ok: false, reason: 'input must be a non-null object' }
    }
    const { inventory, runeId, isLocked } = input

    // 1. runeId：字符串且 trim 后非空
    if (typeof runeId !== 'string') {
      return { ok: false, reason: 'runeId must be a string' }
    }
    const targetId = runeId.trim()
    if (targetId.length === 0) {
      return { ok: false, reason: 'runeId must be non-empty after trim' }
    }

    // 2. isLocked：严格 boolean
    if (isLocked !== true && isLocked !== false) {
      return { ok: false, reason: 'isLocked must be a boolean' }
    }

    // 3. inventory 校验恰好一次（canonical 化：每枚 Rune 的 isLocked 均为显式 boolean）
    const inv = validateRuneInventory(inventory)
    if (!inv.ok) return { ok: false, reason: `inventory invalid: ${inv.reason}` }

    // 4. 按 canonical ID 查找唯一目标（validateRuneInventory 已保证 ID 唯一）
    const targetIndex = inv.inventory.findIndex(r => r.id === targetId)
    if (targetIndex < 0) {
      return { ok: false, reason: 'rune not found in inventory' }
    }
    const targetRune = inv.inventory[targetIndex]

    // 5. 幂等分支：已处于目标状态 → changed:false（调用方零修改、零写盘）
    if (targetRune.isLocked === isLocked) {
      return {
        ok: true,
        changed: false,
        targetIndex,
        targetRune: { ...targetRune },
        nextRune: { ...targetRune }
      }
    }

    // 6. 构造 nextRune：仅 isLocked 变化
    const nextRune: CanonicalRune = {
      id: targetRune.id,
      type: targetRune.type,
      rarity: targetRune.rarity,
      level: targetRune.level,
      exp: targetRune.exp,
      statValue: targetRune.statValue,
      isLocked
    }

    // 7. nextRune 必须通过结构校验
    const nv = validateRune(nextRune)
    if (!nv.ok) return { ok: false, reason: `next rune invalid: ${nv.reason}` }

    // 8. 后置校验：除 isLocked 外其余字段完全不变
    if (
      nv.rune.id !== targetRune.id ||
      nv.rune.type !== targetRune.type ||
      nv.rune.rarity !== targetRune.rarity ||
      nv.rune.level !== targetRune.level ||
      nv.rune.exp !== targetRune.exp ||
      nv.rune.statValue !== targetRune.statValue ||
      nv.rune.isLocked !== isLocked
    ) {
      return { ok: false, reason: 'rune fields altered during lock planning' }
    }

    return {
      ok: true,
      changed: true,
      targetIndex,
      targetRune: { ...targetRune },
      nextRune: nv.rune
    }
  } catch {
    return { ok: false, reason: 'rune lock planning threw' }
  }
}
