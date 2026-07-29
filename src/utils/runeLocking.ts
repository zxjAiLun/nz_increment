/**
 * 符文锁定 —— 唯一纯规划模块（Phase 3.12；Phase 3.15 扩展手动批量锁定/解锁）
 *
 * 本文件是"Rune 锁定 / 解锁状态切换规划"的唯一事实来源。
 *
 * 设计约束（与 equipmentRunes.ts / runeExperience.ts / runeFeeding.ts 同一纪律）：
 *   - 纯函数：不修改任何输入、不写盘、不调用 RNG、不读取装备拓扑、不抛异常
 *     （malformed 一律返回失败结果）。
 *   - 锁定与拓扑无关：锁定/解锁不改变 Rune 的镶嵌绑定，本规划器不得触碰 runeSlots。
 *   - 生产切换只经 playerStore 的原子事务 trySetRunesLocked（批量核心），单 Rune
 *     trySetRuneLocked 为其一元委托；两者最终只调用本文件的规划器。
 *   - 锁定语义（3.12 §11）：仅保护"作为吞噬材料被消耗"这一破坏性路径；不影响镶嵌 /
 *     移除 / 作为强化目标 / 属性生效 / 掉率 / 生成概率 / 经验需求。
 *   - Phase 3.15 §10 收口：planRuneLockChange 与 planRuneBatchLockChange 共享同一个
 *     内部 canonical 规划核心（inventory 校验 / 目标查找 / 字段复制 / 幂等判断 /
 *     nextRune 校验 / 后置条件只实现一次），禁止两套独立实现。
 *   - 仍然禁止：一键全锁 / 一键全解 / 按筛选结果隐式批处理 / 自动锁定 / 锁定排序。
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

export interface PlanRuneBatchLockChangeInput {
  inventory: unknown
  runeIds: unknown
  isLocked: unknown
}

export type RuneBatchLockChangePlan =
  | {
      ok: true
      isLocked: boolean
      selectedIndices: readonly number[]
      selectedRunes: readonly CanonicalRune[]
      nextRunes: readonly CanonicalRune[]
      selectedRuneIds: readonly string[]
      changedIndices: readonly number[]
      changedRuneIds: readonly string[]
      unchangedRuneIds: readonly string[]
      selectedCount: number
      changedCount: number
      unchangedCount: number
    }
  | {
      ok: false
      reason: string
    }

// ---------------------------------------------------------------------------
// 内部 canonical 规划核心（Phase 3.15 §10）：
// planRuneLockChange 与 planRuneBatchLockChange 的唯一共享实现。
// 前置条件：canonicalIds 已由调用方完成字符串 / trim / 去重校验；isLocked 已是严格 boolean。
// 职责（只实现一次）：
//   validateRuneInventory 恰好一次 → 按 canonical ID 定位（不存在 → 失败）
//   → 按 inventoryIndex 升序稳定排序（§6：调用方 ID 顺序不影响计划）
//   → 幂等判断（当前状态 === 目标 → unchanged）
//   → changed 目标构造 nextRune（仅 isLocked 变化）→ validateRune → 字段后置对拍。
// ---------------------------------------------------------------------------
interface LockChangeCoreSuccess {
  ok: true
  canonicalInventory: readonly CanonicalRune[]
  /** 按 inventoryIndex 严格升序 */
  selectedIndices: number[]
  /** 与 selectedIndices 同序（canonical 深拷贝） */
  selectedRunes: CanonicalRune[]
  /** 与 selectedIndices 同序；changed 位置为新状态，unchanged 位置为原状态拷贝 */
  nextRunes: CanonicalRune[]
  /** 与 selectedIndices 同序：该位置是否发生实际切换 */
  changedFlags: boolean[]
}

type LockChangeCoreResult = LockChangeCoreSuccess | { ok: false; reason: string }

function planLockChangeCore(
  inventory: unknown,
  canonicalIds: readonly string[],
  isLocked: boolean
): LockChangeCoreResult {
  // inventory 校验恰好一次（canonical 化：每枚 Rune 的 isLocked 均为显式 boolean）
  const inv = validateRuneInventory(inventory)
  if (!inv.ok) return { ok: false, reason: `inventory invalid: ${inv.reason}` }

  // 按 canonical ID 定位（validateRuneInventory 已保证 ID 唯一）
  const indexById = new Map<string, number>()
  for (let i = 0; i < inv.inventory.length; i++) {
    indexById.set(inv.inventory[i].id, i)
  }
  const rawIndices: number[] = []
  for (const id of canonicalIds) {
    const idx = indexById.get(id)
    if (idx === undefined) {
      return { ok: false, reason: 'rune not found in inventory' }
    }
    rawIndices.push(idx)
  }

  // §6 稳定排序：输出顺序只由 canonical inventoryIndex 决定，与调用方 ID 顺序无关
  const selectedIndices = rawIndices.slice().sort((a, b) => a - b)
  // 调用方 canonical ID 已去重且 inventory ID 唯一 → index 必然互异；防御性再确认
  for (let i = 1; i < selectedIndices.length; i++) {
    if (selectedIndices[i] <= selectedIndices[i - 1]) {
      return { ok: false, reason: 'selected indices not strictly increasing' }
    }
  }

  const selectedRunes: CanonicalRune[] = []
  const nextRunes: CanonicalRune[] = []
  const changedFlags: boolean[] = []

  for (const idx of selectedIndices) {
    const target = inv.inventory[idx]

    // 幂等分支（§7）：已处于目标状态 → unchanged（targetRune 与 nextRune 等值拷贝）
    if (target.isLocked === isLocked) {
      selectedRunes.push({ ...target })
      nextRunes.push({ ...target })
      changedFlags.push(false)
      continue
    }

    // 构造 nextRune：仅 isLocked 变化，其余字段逐一复制
    const candidate: CanonicalRune = {
      id: target.id,
      type: target.type,
      rarity: target.rarity,
      level: target.level,
      exp: target.exp,
      statValue: target.statValue,
      isLocked
    }
    const nv = validateRune(candidate)
    if (!nv.ok) return { ok: false, reason: `next rune invalid: ${nv.reason}` }

    // 后置校验（§8）：除 isLocked 外其余字段完全不变
    if (
      nv.rune.id !== target.id ||
      nv.rune.type !== target.type ||
      nv.rune.rarity !== target.rarity ||
      nv.rune.level !== target.level ||
      nv.rune.exp !== target.exp ||
      nv.rune.statValue !== target.statValue ||
      nv.rune.isLocked !== isLocked
    ) {
      return { ok: false, reason: 'rune fields altered during lock planning' }
    }

    selectedRunes.push({ ...target })
    nextRunes.push(nv.rune)
    changedFlags.push(true)
  }

  return {
    ok: true,
    canonicalInventory: inv.inventory,
    selectedIndices,
    selectedRunes,
    nextRunes,
    changedFlags
  }
}

/**
 * 纯规划（Phase 3.12 单 Rune API；Phase 3.15 §10 收口为共享核心的一元投影）：
 * 把 inventory 中 canonical ID 匹配的 Rune 切换到目标锁定状态。
 *
 * 严格执行顺序（与 3.12 完全一致，reason 不回归）：
 *   1. runeId 必须是字符串且 trim 后非空（canonical 化只作用于目标 ID，不改 inventory）
 *   2. isLocked 必须是严格 boolean（拒绝 truthy/falsy 猜测）
 *   3. 共享核心：validateRuneInventory 恰好一次 → 查找 → 幂等 / nextRune / 后置对拍
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

    // 3. 共享核心（一元）
    const core = planLockChangeCore(inventory, [targetId], isLocked)
    if (!core.ok) return { ok: false, reason: core.reason }

    return {
      ok: true,
      changed: core.changedFlags[0],
      targetIndex: core.selectedIndices[0],
      targetRune: core.selectedRunes[0],
      nextRune: core.nextRunes[0]
    }
  } catch {
    return { ok: false, reason: 'rune lock planning threw' }
  }
}

/**
 * 纯批量规划（Phase 3.15）：把 inventory 中若干 canonical ID 匹配的 Rune
 * 一次性规划到同一目标锁定状态。
 *
 * 输入安全边界（§3/§4）：
 *   - runeIds 必须是非空稠密数组；length 稳定读取一次、每个 raw index 至多读取一次，
 *     读取后立即形成 canonical ID snapshot，后续不再触碰 raw runeIds；
 *   - 每项为字符串、trim 后非空、canonical 去重（"r1" 与 " r1 " 视为重复）；
 *   - isLocked 严格 boolean。
 *
 * canonical 边界（§5）：validateRuneInventory 恰好一次（经共享核心），整体规划，
 * 禁止逐 ID 调用单 Rune planner 重复校验 inventory。
 *
 * 稳定输出（§6）：所有输出数组按 canonical inventoryIndex 升序；调用方 ID 顺序无关。
 * 幂等语义（§7）：目标态已满足 → unchanged；允许 changed/unchanged 混合；全幂等仍 ok:true。
 * 输出数组全部复制并冻结（§9）。纯函数：不修改输入、不写盘、无 RNG、不读装备、
 * 不抛异常（整体 try/catch fail-closed，不返回部分计划）。
 */
export function planRuneBatchLockChange(
  input: PlanRuneBatchLockChangeInput
): RuneBatchLockChangePlan {
  try {
    if (!input || typeof input !== 'object') {
      return { ok: false, reason: 'input must be a non-null object' }
    }
    const { inventory, runeIds, isLocked } = input

    // —— §3 runeIds 输入安全边界 ——
    if (!Array.isArray(runeIds)) {
      return { ok: false, reason: 'runeIds must be an array' }
    }
    // 稳定读取 length 恰好一次
    const len = runeIds.length
    if (!Number.isInteger(len) || len < 1) {
      return { ok: false, reason: 'runeIds must contain at least one id' }
    }
    // 每个 raw index 至多读取一次 → 立即形成 canonical ID snapshot
    const canonicalIds: string[] = []
    const seen = new Set<string>()
    for (let i = 0; i < len; i++) {
      // sparse hole 检查不触发 index get（getOwnPropertyDescriptor 路径）
      if (!Object.prototype.hasOwnProperty.call(runeIds, i)) {
        return { ok: false, reason: 'runeIds must not contain sparse holes' }
      }
      const raw: unknown = runeIds[i] // 唯一一次 index 读取
      if (typeof raw !== 'string') {
        return { ok: false, reason: 'runeIds items must be strings' }
      }
      const id = raw.trim()
      if (id.length === 0) {
        return { ok: false, reason: 'runeIds items must be non-empty after trim' }
      }
      if (seen.has(id)) {
        return { ok: false, reason: 'runeIds contain duplicate canonical id' }
      }
      seen.add(id)
      canonicalIds.push(id)
    }

    // —— §4 isLocked 严格 boolean ——
    if (isLocked !== true && isLocked !== false) {
      return { ok: false, reason: 'isLocked must be a boolean' }
    }

    // —— §5 共享核心：validateRuneInventory 恰好一次的整体规划 ——
    const core = planLockChangeCore(inventory, canonicalIds, isLocked)
    if (!core.ok) return { ok: false, reason: core.reason }

    // —— §7 changed / unchanged 分类（同为 inventoryIndex 升序） ——
    const changedIndices: number[] = []
    const changedRuneIds: string[] = []
    const unchangedRuneIds: string[] = []
    const selectedRuneIds: string[] = []
    for (let i = 0; i < core.selectedIndices.length; i++) {
      selectedRuneIds.push(core.selectedRunes[i].id)
      if (core.changedFlags[i]) {
        changedIndices.push(core.selectedIndices[i])
        changedRuneIds.push(core.selectedRunes[i].id)
      } else {
        unchangedRuneIds.push(core.selectedRunes[i].id)
      }
    }

    // —— §9 后置条件（fail-closed，不返回部分计划） ——
    const selectedCount = core.selectedIndices.length
    const changedCount = changedIndices.length
    const unchangedCount = unchangedRuneIds.length
    if (
      selectedCount !== canonicalIds.length ||
      selectedCount !== core.selectedRunes.length ||
      selectedCount !== core.nextRunes.length ||
      selectedCount !== selectedRuneIds.length ||
      changedCount !== changedRuneIds.length ||
      changedCount + unchangedCount !== selectedCount
    ) {
      return { ok: false, reason: 'plan postcondition violated' }
    }
    for (let i = 1; i < changedIndices.length; i++) {
      if (changedIndices[i] <= changedIndices[i - 1]) {
        return { ok: false, reason: 'plan postcondition violated' }
      }
    }
    const selectedIndexSet = new Set(core.selectedIndices)
    for (const idx of changedIndices) {
      if (!selectedIndexSet.has(idx)) {
        return { ok: false, reason: 'plan postcondition violated' }
      }
    }
    for (let i = 0; i < selectedCount; i++) {
      if (
        core.selectedRunes[i].id !== inventoryIdAt(core, i) ||
        core.nextRunes[i].id !== core.selectedRunes[i].id ||
        core.nextRunes[i].isLocked !== (core.changedFlags[i] ? isLocked : core.selectedRunes[i].isLocked)
      ) {
        return { ok: false, reason: 'plan postcondition violated' }
      }
    }

    return {
      ok: true,
      isLocked,
      selectedIndices: Object.freeze(core.selectedIndices.slice()),
      selectedRunes: Object.freeze(core.selectedRunes.slice()),
      nextRunes: Object.freeze(core.nextRunes.slice()),
      selectedRuneIds: Object.freeze(selectedRuneIds.slice()),
      changedIndices: Object.freeze(changedIndices.slice()),
      changedRuneIds: Object.freeze(changedRuneIds.slice()),
      unchangedRuneIds: Object.freeze(unchangedRuneIds.slice()),
      selectedCount,
      changedCount,
      unchangedCount
    }
  } catch {
    return { ok: false, reason: 'rune batch lock planning threw' }
  }
}

/** §9 后置对拍辅助：selectedRunes[i] 必须与 canonicalInventory[selectedIndices[i]] 同身份。 */
function inventoryIdAt(core: LockChangeCoreSuccess, i: number): string {
  const idx = core.selectedIndices[i]
  const rune = core.canonicalInventory[idx]
  return rune ? rune.id : ''
}
