/**
 * Rune 吞噬强化纯规划模块（Phase 3.11 单材料；Phase 3.13 批量核心）
 *
 * 玩法语义：消耗一枚或多枚「全新未镶嵌未锁定」的 Rune 作为材料，把材料稀有度对应的
 * 固定经验精确求和后一次性注入一枚目标 Rune。材料被永久消耗，目标按既有经验公式升级。
 *
 * 本模块只做纯规划：不修改任何输入、不写盘、不调用 RNG、不抛异常（fail-closed）。
 * 原子事务（材料删除 + 目标替换 + saveGame 一次）由 playerStore.tryFeedRunes 执行；
 * 单材料 planRuneFeeding / tryFeedRune 均收口为批量核心的一元投影（§10/§12，禁止两套实现）。
 *
 * 权威派生全部复用既有 leaf 模块（禁止第二套实现）：
 *   - equipmentRunes.ts:
 *       validateRuneInventory（raw inventory 单次 canonical 快照）
 *       validatePlayerRuneReferenceTopology（全局引用拓扑；输入必须传 canonical inventory）
 *   - runeExperience.ts:
 *       validateRuneProgressionState（目标/材料 progression 合法性）
 *       planRuneExperienceGain（唯一升级公式来源：经验表 / 有界升级循环 / statValue 成长）
 *       RUNE_MAX_LEVEL
 *
 * 禁止在本模块复制经验表、升级循环或 statValue 公式。
 */

import type { Rune, RuneRarity } from '../stores/runeStore'
import type { EquipmentSlot } from '../types'
import { EQUIPMENT_SLOTS } from '../types'
import {
  validateRuneInventory,
  validatePlayerRuneReferenceTopology
} from './equipmentRunes'
import type { EquipmentRuneSlotRef } from './equipmentRunes'
import {
  validateRuneProgressionState,
  planRuneExperienceGain,
  RUNE_MAX_LEVEL
} from './runeExperience'

/**
 * 材料稀有度 → 固定吞噬经验（Phase 3.11 冻结配置，禁改）。
 * 无 RNG、无类型/数值/等级/难度修正：common=5 / rare=15 / epic=45 / legend=135。
 */
export const RUNE_FEED_EXP_BY_RARITY = Object.freeze({
  common: 5,
  rare: 15,
  epic: 45,
  legend: 135
} as const satisfies Record<RuneRarity, number>)

/**
 * 查询一枚材料 Rune 可提供的吞噬经验（只读纯函数，fail-closed）。
 *
 *   - 材料必须通过 validateRuneProgressionState（结构 + progression 合法）
 *   - 材料必须是「全新」状态：level === 1 且 exp === 0
 *   - 材料不得处于锁定状态（Phase 3.12：isLocked === true → null，锁定保护破坏性消耗）
 *   - 满足则返回 RUNE_FEED_EXP_BY_RARITY[rarity]；任何不满足 / 异常 → null
 *
 * 注意：本函数不校验镶嵌状态（拓扑校验需要装备信息，由 planRuneFeeding 负责）。
 */
export function getRuneFeedExperience(material: unknown): number | null {
  try {
    const prog = validateRuneProgressionState(material)
    if (!prog.ok) return null
    const rune = material as Rune
    if (rune.level !== 1) return null
    if (rune.exp !== 0) return null
    // Phase 3.12：锁定 Rune 不能作为吞噬材料（progression 校验已保证 isLocked 只可能为
    // undefined / true / false；undefined 与 false 均为 canonical 未锁定）
    if (rune.isLocked === true) return null
    const exp = RUNE_FEED_EXP_BY_RARITY[rune.rarity]
    if (typeof exp !== 'number' || !Number.isFinite(exp) || exp <= 0) return null
    return exp
  } catch {
    return null
  }
}

/**
 * 确定性拓扑引用条目（Phase 3.11.1）。
 * 用于把 planner 所见的全局镶嵌拓扑固化为可比较的快照：
 * 事务在应用前重新读取拓扑并与该快照逐项比较，任何引用新增 / 消失 / 位置变化都视为 stale plan。
 */
export interface RuneFeedingTopologyReference {
  /** canonical rune ID */
  runeId: string
  equipmentSlot: EquipmentSlot
  runeSlotIndex: number
}

/**
 * 把 validatePlayerRuneReferenceTopology 成功结果的 references Map 展平为确定性快照。
 *
 *   - 排序协议：先按 EQUIPMENT_SLOTS 声明顺序、再按 runeSlotIndex 升序
 *     （合法拓扑中同一 (slot, index) 至多一个引用，排序全序、无并列，不依赖 Map 插入顺序）
 *   - 只保存 canonical runeId 与位置标量，不保存任何 Equipment 对象引用
 *   - 纯函数：不修改输入、不抛异常语义之外的行为（输入来自已验证 Map，无需 fail-closed 包装）
 */
export function buildRuneTopologySnapshot(
  references: ReadonlyMap<string, readonly EquipmentRuneSlotRef[]>
): readonly RuneFeedingTopologyReference[] {
  const flat: RuneFeedingTopologyReference[] = []
  for (const [runeId, refs] of references) {
    for (const ref of refs) {
      flat.push({ runeId, equipmentSlot: ref.slot, runeSlotIndex: ref.index })
    }
  }
  const slotOrder = new Map<EquipmentSlot, number>()
  for (let i = 0; i < EQUIPMENT_SLOTS.length; i++) slotOrder.set(EQUIPMENT_SLOTS[i], i)
  flat.sort((a, b) => {
    const sa = slotOrder.get(a.equipmentSlot) ?? EQUIPMENT_SLOTS.length
    const sb = slotOrder.get(b.equipmentSlot) ?? EQUIPMENT_SLOTS.length
    if (sa !== sb) return sa - sb
    return a.runeSlotIndex - b.runeSlotIndex
  })
  return Object.freeze(flat)
}

/**
 * 比较两份拓扑快照是否完全一致（相同引用集合、相同 slot、相同 index、无增删、无位置变化）。
 * 两份快照都必须由 buildRuneTopologySnapshot 生成（已按同一确定性协议排序），故可逐项比较。
 * fail-closed：任何结构异常 → false。
 */
export function sameRuneTopologySnapshot(
  a: readonly RuneFeedingTopologyReference[],
  b: readonly RuneFeedingTopologyReference[]
): boolean {
  try {
    if (!Array.isArray(a) || !Array.isArray(b)) return false
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
      const x = a[i]
      const y = b[i]
      if (!x || !y) return false
      if (x.runeId !== y.runeId) return false
      if (x.equipmentSlot !== y.equipmentSlot) return false
      if (x.runeSlotIndex !== y.runeSlotIndex) return false
    }
    return true
  } catch {
    return false
  }
}

/** 单材料吞噬规划输入。inventory / equipmentBySlot 接受 unknown（fail-closed 边界）。 */
export interface PlanRuneFeedingInput {
  targetRuneId: unknown
  materialRuneId: unknown
  inventory: unknown
  equipmentBySlot: unknown
}

/** 批量吞噬规划输入（Phase 3.13）。materialRuneIds 同样接受 unknown（fail-closed 边界）。 */
export interface PlanRuneBatchFeedingInput {
  targetRuneId: unknown
  materialRuneIds: unknown
  inventory: unknown
  equipmentBySlot: unknown
}

/** 批量吞噬规划结果（判别联合，Phase 3.13）。 */
export type RuneBatchFeedingPlan =
  | {
      ok: true
      /** canonical inventory 中目标 Rune 的 index */
      targetIndex: number
      /** 材料在 canonical inventory 中的 index，严格升序（与输入顺序无关） */
      materialIndices: readonly number[]
      /** 事务前的 canonical 目标 Rune */
      targetRune: Rune
      /** 被消耗的 canonical 材料 Rune（与 materialIndices 同序） */
      materialRunes: readonly Rune[]
      /** 被消耗材料的 canonical ID（与 materialIndices 同序） */
      consumedRuneIds: readonly string[]
      /** 升级后的目标 Rune（planRuneExperienceGain 恰一次的产物） */
      nextTargetRune: Rune
      /** 实际注入经验（= 所有材料稀有度固定经验的精确整数和） */
      expAdded: number
      /** 目标升级数 */
      levelsGained: number
      /** planner 所见全局镶嵌拓扑的确定性快照（事务应用前一致性门比较用） */
      topologySnapshot: readonly RuneFeedingTopologyReference[]
    }
  | {
      ok: false
      reason: string
    }

/**
 * 批量吞噬纯规划核心（Phase 3.13 §2-§9）。单材料 planRuneFeeding 收口至此（§10）。
 *
 * 严格执行顺序：
 *   1. targetRuneId 必须为 trim 后非空字符串
 *   2. materialRuneIds 安全快照（§3）：必须为数组、长度 ≥ 1；对每个 index 恰好读取一次，
 *      逐项要求 string / trim 非空 / 不等于目标 canonical ID / canonical ID 无重复；
 *      快照建立后不再读取原数组（稀疏 hole 读出 undefined → 非 string → 整体拒绝；
 *      getter / Proxy 抛异常 → 外层 try/catch fail-closed）
 *   3. validateRuneInventory(inventory) 恰一次 → canonical snapshot（raw 仅此一次读取）
 *   4. validatePlayerRuneReferenceTopology(equipmentBySlot, canonical inventory)
 *   5. 按 canonical ID 解析目标与全部材料的唯一 index（任一找不到 → 整体失败）；
 *      materialIndices 按 inventoryIndex 升序排序，materialRunes / consumedRuneIds 同序
 *      （["m3","m1","m2"] 与 ["m1","m2","m3"] 等价，产出完全一致）
 *   6. 目标 progression 合法且未满级（< RUNE_MAX_LEVEL）；锁定目标允许
 *   7. 每个材料：level === 1、exp === 0、isLocked !== true、无任何 topology reference、
 *      getRuneFeedExperience(material) !== null；任一不满足 → 整体失败（禁止跳过继续）
 *   8. expAdded = 各材料固定经验的精确整数和（校验有限正整数），
 *      planRuneExperienceGain(target, expAdded) 恰好调用一次（禁止逐材料循环注入）
 *   9. 后置校验：nextTargetRune 身份不变（id/type/rarity/isLocked，锁定目标保持锁定）、
 *      progression 合法、materialIndices 严格升序且不含 targetIndex、三数组等长、
 *      consumedRuneIds 无重复、expAdded 与 expPlan 一致；输出数组为冻结副本
 *
 * 任何一步失败 / 异常 → { ok: false }，零修改、零写盘、无 RNG。
 */
export function planRuneBatchFeeding(input: PlanRuneBatchFeedingInput): RuneBatchFeedingPlan {
  try {
    // 1. targetRuneId 必须为 trim 后非空字符串
    if (typeof input.targetRuneId !== 'string') {
      return { ok: false, reason: 'targetRuneId must be a string' }
    }
    const targetId = input.targetRuneId.trim()
    if (targetId.length === 0) return { ok: false, reason: 'targetRuneId must be non-empty after trim' }

    // 2. materialRuneIds 安全快照：每个 index 恰好读取一次，之后不再触碰原数组
    const rawIds = input.materialRuneIds
    if (!Array.isArray(rawIds)) return { ok: false, reason: 'materialRuneIds must be an array' }
    const idCount = rawIds.length
    if (!Number.isInteger(idCount) || idCount < 1) {
      return { ok: false, reason: 'materialRuneIds must contain at least one id' }
    }
    const materialIds: string[] = []
    const seenIds = new Set<string>()
    for (let i = 0; i < idCount; i++) {
      const raw: unknown = rawIds[i]
      if (typeof raw !== 'string') return { ok: false, reason: 'material rune id must be a string' }
      const id = raw.trim()
      if (id.length === 0) return { ok: false, reason: 'material rune id must be non-empty after trim' }
      if (id === targetId) return { ok: false, reason: 'target and material must be different runes' }
      if (seenIds.has(id)) return { ok: false, reason: 'materialRuneIds contains duplicate canonical id' }
      seenIds.add(id)
      materialIds.push(id)
    }

    // 3. raw inventory 单次 canonical 快照
    const inv = validateRuneInventory(input.inventory)
    if (!inv.ok) return { ok: false, reason: `rune inventory invalid: ${inv.reason}` }

    // 4. 全局引用拓扑（必须传 canonical inventory，杜绝时变 Proxy 二次读取）
    const topo = validatePlayerRuneReferenceTopology(input.equipmentBySlot, inv.inventory)
    if (!topo.ok) return { ok: false, reason: `rune reference topology invalid: ${topo.reason}` }

    // 5. canonical ID → 唯一 index；materialIndices 按 inventoryIndex 升序
    const targetIndex = inv.inventory.findIndex(r => r.id === targetId)
    if (targetIndex < 0) return { ok: false, reason: 'target rune not found in inventory' }
    const foundIndices: number[] = []
    for (const id of materialIds) {
      const idx = inv.inventory.findIndex(r => r.id === id)
      if (idx < 0) return { ok: false, reason: 'material rune not found in inventory' }
      foundIndices.push(idx)
    }
    foundIndices.sort((a, b) => a - b)
    const materialIndices = foundIndices
    const materialRunes = materialIndices.map(i => inv.inventory[i])
    const consumedRuneIds = materialRunes.map(r => r.id)

    const targetRune = inv.inventory[targetIndex]

    // 6. target progression 合法且未满级（锁定目标允许）
    const targetProg = validateRuneProgressionState(targetRune)
    if (!targetProg.ok) return { ok: false, reason: `target progression invalid: ${targetProg.reason}` }
    if (targetRune.level >= RUNE_MAX_LEVEL) return { ok: false, reason: 'target rune already at max level' }

    // 7. 逐材料资格校验（任一不满足 → 整体失败，禁止跳过继续）+ 固定经验精确整数和
    let expSum = 0
    for (const material of materialRunes) {
      if (material.level !== 1) return { ok: false, reason: 'material rune must be level 1' }
      if (material.exp !== 0) return { ok: false, reason: 'material rune must have zero exp' }
      // Phase 3.12 锁定保护：锁定 Rune 不能作为吞噬材料（canonical isLocked 为显式 boolean）
      if (material.isLocked) return { ok: false, reason: 'material rune is locked' }
      const refs = topo.references.get(material.id)
      if (refs && refs.length > 0) {
        return { ok: false, reason: 'material rune is embedded in equipment' }
      }
      const feedExp = getRuneFeedExperience(material)
      if (feedExp === null) return { ok: false, reason: 'material rune not eligible for feeding' }
      expSum += feedExp
    }

    // 8. 总经验必须为有限正整数；唯一升级公式来源恰好调用一次（禁止逐材料循环注入）
    if (!Number.isInteger(expSum) || !Number.isFinite(expSum) || expSum <= 0) {
      return { ok: false, reason: 'total feed experience invalid' }
    }
    const expPlan = planRuneExperienceGain(targetRune, expSum)
    if (!expPlan.ok) return { ok: false, reason: `experience planning failed: ${expPlan.reason}` }
    if (expPlan.expAdded !== expSum) return { ok: false, reason: 'planned experience does not match material sum' }

    // 9. 后置校验：身份不变（含锁定状态：锁定目标保持锁定、未锁定不得被顺带加锁）、progression 合法
    const next = expPlan.nextRune
    if (next.id !== targetRune.id || next.type !== targetRune.type || next.rarity !== targetRune.rarity) {
      return { ok: false, reason: 'next target rune identity changed' }
    }
    if (next.isLocked !== targetRune.isLocked) {
      return { ok: false, reason: 'next target rune lock state changed' }
    }
    const nextProg = validateRuneProgressionState(next)
    if (!nextProg.ok) return { ok: false, reason: 'next target rune progression invalid' }

    // 9.5. 结构不变量：严格升序、不含 targetIndex、三数组等长、consumed ID 无重复
    if (
      materialIndices.length !== materialIds.length ||
      materialRunes.length !== materialIndices.length ||
      consumedRuneIds.length !== materialIndices.length
    ) {
      return { ok: false, reason: 'material plan arrays length mismatch' }
    }
    for (let i = 0; i < materialIndices.length; i++) {
      const idx = materialIndices[i]
      if (!Number.isInteger(idx) || idx < 0 || idx >= inv.inventory.length) {
        return { ok: false, reason: 'material index out of range' }
      }
      if (idx === targetIndex) return { ok: false, reason: 'material index equals target index' }
      if (i > 0 && idx <= materialIndices[i - 1]) {
        return { ok: false, reason: 'material indices not strictly ascending' }
      }
    }
    if (new Set(consumedRuneIds).size !== consumedRuneIds.length) {
      return { ok: false, reason: 'consumed rune ids not unique' }
    }

    return {
      ok: true,
      targetIndex,
      materialIndices: Object.freeze(materialIndices.slice()),
      targetRune,
      materialRunes: Object.freeze(materialRunes.slice()),
      consumedRuneIds: Object.freeze(consumedRuneIds.slice()),
      nextTargetRune: next,
      expAdded: expPlan.expAdded,
      levelsGained: expPlan.levelsGained,
      topologySnapshot: buildRuneTopologySnapshot(topo.references)
    }
  } catch {
    return { ok: false, reason: 'rune batch feeding planning threw' }
  }
}

/** 吞噬规划结果（判别联合）。 */
export type RuneFeedingPlan =
  | {
      ok: true
      /** canonical inventory 中目标 Rune 的 index */
      targetIndex: number
      /** canonical inventory 中材料 Rune 的 index */
      materialIndex: number
      /** 事务前的 canonical 目标 Rune */
      targetRune: Rune
      /** 被消耗的 canonical 材料 Rune */
      materialRune: Rune
      /** 升级后的目标 Rune（planRuneExperienceGain 产物） */
      nextTargetRune: Rune
      /** 实际注入经验（= 材料稀有度固定经验） */
      expAdded: number
      /** 目标升级数 */
      levelsGained: number
      /**
       * planner 所见全局镶嵌拓扑的确定性快照（Phase 3.11.1）。
       * 事务必须在应用前重新读取拓扑并与本快照完全一致，否则视为 stale plan 拒绝。
       */
      topologySnapshot: readonly RuneFeedingTopologyReference[]
    }
  | {
      ok: false
      reason: string
    }

/**
 * 单材料吞噬纯规划（Phase 3.11 原 API，Phase 3.13 §10 收口为共享批量核心的投影）。
 *
 * 实现：materialRuneId 基础校验后以 [materialRuneId] 调用 planRuneBatchFeeding，
 * 再把批量计划（恰一个材料）投影回原 RuneFeedingPlan 形状。
 * 语义与 Phase 3.11/3.12 完全一致：同样的校验顺序、同样的 fail-closed 边界、
 * 同样的锁定材料权威拒绝（'material rune is locked'）与已镶嵌拒绝（含 'embedded'）。
 * 禁止在此保留第二套独立单材料实现。
 */
export function planRuneFeeding(input: PlanRuneFeedingInput): RuneFeedingPlan {
  try {
    // materialRuneId 基础校验（保持原 API 的入参语义：单个 ID 而非数组）
    if (typeof input.materialRuneId !== 'string') {
      return { ok: false, reason: 'materialRuneId must be a string' }
    }
    if (input.materialRuneId.trim().length === 0) {
      return { ok: false, reason: 'materialRuneId must be non-empty after trim' }
    }

    // 共享批量规划核心（§10：单材料 = 批量的一个特例）
    const plan = planRuneBatchFeeding({
      targetRuneId: input.targetRuneId,
      materialRuneIds: [input.materialRuneId],
      inventory: input.inventory,
      equipmentBySlot: input.equipmentBySlot
    })
    if (!plan.ok) return { ok: false, reason: plan.reason }

    // 投影回原 RuneFeedingPlan：批量计划必须恰好一个材料
    if (
      plan.materialIndices.length !== 1 ||
      plan.materialRunes.length !== 1 ||
      plan.consumedRuneIds.length !== 1
    ) {
      return { ok: false, reason: 'single-material projection expects exactly one material' }
    }

    return {
      ok: true,
      targetIndex: plan.targetIndex,
      materialIndex: plan.materialIndices[0],
      targetRune: plan.targetRune,
      materialRune: plan.materialRunes[0],
      nextTargetRune: plan.nextTargetRune,
      expAdded: plan.expAdded,
      levelsGained: plan.levelsGained,
      topologySnapshot: plan.topologySnapshot
    }
  } catch {
    return { ok: false, reason: 'rune feeding planning threw' }
  }
}
