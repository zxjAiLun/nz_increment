/**
 * Rune 单材料吞噬强化纯规划模块（Phase 3.11）
 *
 * 玩法语义：消耗一枚「全新未镶嵌」的 Rune 作为材料，把材料稀有度对应的固定经验
 * 一次性注入另一枚目标 Rune。材料被永久消耗，目标按既有经验公式升级。
 *
 * 本模块只做纯规划：不修改任何输入、不写盘、不调用 RNG、不抛异常（fail-closed）。
 * 原子事务（材料删除 + 目标替换 + saveGame 一次）由 playerStore.tryFeedRune 执行。
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
import {
  validateRuneInventory,
  validatePlayerRuneReferenceTopology
} from './equipmentRunes'
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
    const exp = RUNE_FEED_EXP_BY_RARITY[rune.rarity]
    if (typeof exp !== 'number' || !Number.isFinite(exp) || exp <= 0) return null
    return exp
  } catch {
    return null
  }
}

/** 吞噬规划输入。inventory / equipmentBySlot 接受 unknown（fail-closed 边界）。 */
export interface PlanRuneFeedingInput {
  targetRuneId: unknown
  materialRuneId: unknown
  inventory: unknown
  equipmentBySlot: unknown
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
    }
  | {
      ok: false
      reason: string
    }

/**
 * 纯规划：给定目标 Rune ID、材料 Rune ID、raw inventory 与玩家装备，
 * 计算一次吞噬强化的完整计划。
 *
 * 严格执行顺序：
 *   1. targetRuneId / materialRuneId 必须为 trim 后非空字符串
 *   2. 拒绝相同 canonical ID（自吞）
 *   3. validateRuneInventory 恰一次 → canonical snapshot（raw 仅此一次读取）
 *   4. validatePlayerRuneReferenceTopology(equipmentBySlot, canonical inventory)
 *      （复用已 canonical 化的数组，杜绝时变 Proxy 两次读取不一致）
 *   5. 按 canonical ID 找 target / material 的唯一 index（找不到 → 失败）
 *   6. 校验 target progression 合法且未满级（< RUNE_MAX_LEVEL）
 *   7. 校验 material 为全新状态：level === 1 且 exp === 0
 *   8. 校验 material 没有任何 topology reference（已镶嵌 / 悬空引用一律拒绝）
 *   9. getRuneFeedExperience(material) → 固定经验（null → 失败）
 *  10. planRuneExperienceGain(target, exp) → nextTargetRune
 *  11. 后置校验：nextTargetRune id/type/rarity 与 target 一致、progression 合法
 *
 * 任何一步失败 / 异常 → { ok: false }，零修改、零写盘、无 RNG。
 */
export function planRuneFeeding(input: PlanRuneFeedingInput): RuneFeedingPlan {
  try {
    // 1. ID 必须为 trim 后非空字符串
    if (typeof input.targetRuneId !== 'string') {
      return { ok: false, reason: 'targetRuneId must be a string' }
    }
    if (typeof input.materialRuneId !== 'string') {
      return { ok: false, reason: 'materialRuneId must be a string' }
    }
    const targetId = input.targetRuneId.trim()
    const materialId = input.materialRuneId.trim()
    if (targetId.length === 0) return { ok: false, reason: 'targetRuneId must be non-empty after trim' }
    if (materialId.length === 0) return { ok: false, reason: 'materialRuneId must be non-empty after trim' }

    // 2. 拒绝自吞
    if (targetId === materialId) return { ok: false, reason: 'target and material must be different runes' }

    // 3. raw inventory 单次 canonical 快照
    const inv = validateRuneInventory(input.inventory)
    if (!inv.ok) return { ok: false, reason: `rune inventory invalid: ${inv.reason}` }

    // 4. 全局引用拓扑（必须传 canonical inventory，不再二次读取 raw）
    const topo = validatePlayerRuneReferenceTopology(input.equipmentBySlot, inv.inventory)
    if (!topo.ok) return { ok: false, reason: `rune reference topology invalid: ${topo.reason}` }

    // 5. canonical ID → 唯一 index（validateRuneInventory 已保证 ID 唯一）
    const targetIndex = inv.inventory.findIndex(r => r.id === targetId)
    if (targetIndex < 0) return { ok: false, reason: 'target rune not found in inventory' }
    const materialIndex = inv.inventory.findIndex(r => r.id === materialId)
    if (materialIndex < 0) return { ok: false, reason: 'material rune not found in inventory' }

    const targetRune = inv.inventory[targetIndex]
    const materialRune = inv.inventory[materialIndex]

    // 6. target progression 合法且未满级
    const targetProg = validateRuneProgressionState(targetRune)
    if (!targetProg.ok) return { ok: false, reason: `target progression invalid: ${targetProg.reason}` }
    if (targetRune.level >= RUNE_MAX_LEVEL) return { ok: false, reason: 'target rune already at max level' }

    // 7. material 必须是全新状态
    if (materialRune.level !== 1) return { ok: false, reason: 'material rune must be level 1' }
    if (materialRune.exp !== 0) return { ok: false, reason: 'material rune must have zero exp' }

    // 8. material 不得被任何装备孔引用
    const materialRefs = topo.references.get(materialRune.id)
    if (materialRefs && materialRefs.length > 0) {
      return { ok: false, reason: 'material rune is embedded in equipment' }
    }

    // 9. 固定吞噬经验
    const feedExp = getRuneFeedExperience(materialRune)
    if (feedExp === null) return { ok: false, reason: 'material rune not eligible for feeding' }

    // 10. 唯一升级公式来源
    const expPlan = planRuneExperienceGain(targetRune, feedExp)
    if (!expPlan.ok) return { ok: false, reason: `experience planning failed: ${expPlan.reason}` }

    // 11. 后置校验：nextTargetRune 身份不变、progression 合法
    const next = expPlan.nextRune
    if (next.id !== targetRune.id || next.type !== targetRune.type || next.rarity !== targetRune.rarity) {
      return { ok: false, reason: 'next target rune identity changed' }
    }
    const nextProg = validateRuneProgressionState(next)
    if (!nextProg.ok) return { ok: false, reason: 'next target rune progression invalid' }

    return {
      ok: true,
      targetIndex,
      materialIndex,
      targetRune,
      materialRune,
      nextTargetRune: next,
      expAdded: expPlan.expAdded,
      levelsGained: expPlan.levelsGained
    }
  } catch {
    return { ok: false, reason: 'rune feeding planning threw' }
  }
}
