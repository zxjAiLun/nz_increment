/**
 * 符文经验升级 —— 唯一纯模块（Phase 3.7）
 *
 * 本文件是“符文获得经验 / 多级升级 / statValue 成长 / 进度校验 / 展示”的唯一事实来源，
 * 取代旧 runeStore 中直接修改内存 `rune.exp += expAmount` 且“无主存档事务、无输入校验、
 * 无保存失败回滚”的裸实现。
 *
 * 设计约束：
 *   - 所有函数纯函数、不调用 RNG、不抛异常（malformed 一律返回失败结果）。
 *   - 经验表、升级成长公式、进度校验、纯规划、展示 helper 全部集中于此；runeStore 仅委托。
 *   - 真实装备加成仍由 equipmentRunes.ts 的 getPlayerEquipmentRuneBonuses /
 *     getRuneEffectiveValue 计算，本模块不触碰属性公式（0.05）或拓扑。
 *   - 升级事务只经 playerStore 的 tryAddRuneExperience 原子事务，且只调用本文件的 plan* 纯规划。
 */

import type { Rune } from '../stores/runeStore'
import { validateRune } from './equipmentRunes'

/** 符文满级 */
export const RUNE_MAX_LEVEL = 50

/** 经验表基数（项目既有公式，不得重平衡） */
export const RUNE_EXP_BASE = 20

/** 经验表成长系数 */
export const RUNE_EXP_GROWTH = 1.1

/** 每级 statValue 成长系数：floor(statValue × 1.1) */
export const RUNE_STAT_GROWTH = 1.1

/**
 * 经验表（只读）：
 *   table[0] = 0
 *   table[level] = table[level - 1] + floor(RUNE_EXP_BASE × RUNE_EXP_GROWTH^level)
 * 从等级 L 升至 L + 1 所需经验 = table[L]（累积阈值，非单级增量）。
 * 固定：table[1] = 22, table[2] = 46。
 */
export const RUNE_EXP_TABLE: number[] = (() => {
  const table: number[] = [0]
  for (let level = 1; level <= RUNE_MAX_LEVEL; level++) {
    table[level] = table[level - 1] + Math.floor(RUNE_EXP_BASE * Math.pow(RUNE_EXP_GROWTH, level))
  }
  return table
})()

/**
 * 查询从 level 升至下一级所需经验（= table[level]）。
 *   - level 1..49 → 有限正整数
 *   - level 50（满级）→ null
 *   - 非法 level → null
 * 不抛异常、不调用 RNG。
 */
export function getRuneExpRequiredForNextLevel(level: number): number | null {
  if (typeof level !== 'number' || !Number.isFinite(level) || !Number.isInteger(level)) return null
  if (level < 1 || level >= RUNE_MAX_LEVEL) return null
  return RUNE_EXP_TABLE[level] ?? null
}

/** 符文进度状态校验结果 */
export type RuneProgressionValidationResult =
  | { ok: true }
  | { ok: false; reason: string }

/**
 * 校验符文进度状态（canonical 约束），复用 validateRune 先确保结构合法。
 *   - 非满级（level < 50）：保存态必须是完全结算后的 canonical 状态，
 *     exp 必须 < 当前等级升级阈值（table[level]），不得保留“足够升级却未升级”的经验。
 *   - 满级（level === 50）：继续允许既有模型中的有限非负整数 exp（大额经验达满级后留余量）。
 * 任意 malformed 返回失败，不抛异常。本阶段不修改 validateRune 通用结构校验职责。
 */
export function validateRuneProgressionState(raw: unknown): RuneProgressionValidationResult {
  const v = validateRune(raw)
  if (!v.ok) return { ok: false, reason: v.reason }
  const rune = v.rune
  if (rune.level < RUNE_MAX_LEVEL) {
    const threshold = getRuneExpRequiredForNextLevel(rune.level)
    if (threshold === null) return { ok: false, reason: 'missing exp threshold for non-max level' }
    if (rune.exp >= threshold) {
      return { ok: false, reason: 'rune exp must be canonical (< threshold) for non-max level' }
    }
  }
  // level === 50：exp 已由 validateRune 保证为有限非负整数，无需进一步约束。
  return { ok: true }
}

/** 符文经验规划结果（判别联合） */
export type RuneExperiencePlan =
  | {
      ok: true
      nextRune: Rune
      expAdded: number
      levelsGained: number
    }
  | {
      ok: false
      reason: string
    }

/**
 * 纯规划：给定一枚 Rune 与经验增量，计算升级后的新 Rune。
 * 不修改任何输入、不抛异常、不调用 RNG。
 *
 * 严格执行顺序：
 *   校验 Rune 结构 → 校验 Rune 进度状态 → 校验 expAmount → 校验尚未满级
 *   → 计算候选总经验 → 有界升级循环（最多 49 次）→ 校验每个派生 statValue
 *   → 校验最终候选 Rune → 校验最终进度状态 → 复验 id/type/rarity 不变 → 返回成功计划。
 *
 * expAmount 必须：typeof number / 有限 / 整数 / > 0。以下全部拒绝：
 *   0 / 负数 / 小数 / NaN / Infinity / 字符串 / null / undefined / 对象。
 */
export function planRuneExperienceGain(rune: unknown, expAmount: unknown): RuneExperiencePlan {
  // 1. 校验 Rune 结构
  const rv = validateRune(rune)
  if (!rv.ok) return { ok: false, reason: rv.reason }

  // 2. 校验 Rune 进度状态（canonical）
  const pv = validateRuneProgressionState(rv.rune)
  if (!pv.ok) return { ok: false, reason: pv.reason }

  // 3. 校验 expAmount
  if (
    typeof expAmount !== 'number' ||
    !Number.isFinite(expAmount) ||
    !Number.isInteger(expAmount) ||
    expAmount <= 0
  ) {
    return { ok: false, reason: 'expAmount must be a positive finite integer' }
  }

  // 4. 校验尚未满级
  if (rv.rune.level >= RUNE_MAX_LEVEL) {
    return { ok: false, reason: 'rune already at max level' }
  }

  // 5. 计算候选总经验
  const candidateTotalExp = rv.rune.exp + expAmount
  if (
    !Number.isFinite(candidateTotalExp) ||
    !Number.isInteger(candidateTotalExp) ||
    candidateTotalExp < 0
  ) {
    return { ok: false, reason: 'candidate total exp is non-finite, non-integer, or negative' }
  }

  // 6. 有界升级循环（最多 RUNE_MAX_LEVEL - 1 = 49 次）
  let nextLevel = rv.rune.level
  let nextExp = candidateTotalExp
  let nextStatValue = rv.rune.statValue
  let levelsGained = 0

  while (nextLevel < RUNE_MAX_LEVEL) {
    const required = getRuneExpRequiredForNextLevel(nextLevel)
    if (required === null || nextExp < required) break
    nextExp -= required
    nextLevel += 1
    levelsGained += 1
    nextStatValue = Math.floor(nextStatValue * RUNE_STAT_GROWTH)
    // 7. 校验每个派生 statValue（有限非负整数）
    if (!Number.isFinite(nextStatValue) || !Number.isInteger(nextStatValue) || nextStatValue < 0) {
      return { ok: false, reason: 'derived statValue overflow or invalid' }
    }
  }

  // 8. 构造新 Rune 并校验最终候选
  const candidate: Rune = {
    id: rv.rune.id,
    type: rv.rune.type,
    rarity: rv.rune.rarity,
    level: nextLevel,
    exp: nextExp,
    statValue: nextStatValue
  }

  const fv = validateRune(candidate)
  if (!fv.ok) return { ok: false, reason: fv.reason }
  const fpv = validateRuneProgressionState(candidate)
  if (!fpv.ok) return { ok: false, reason: fpv.reason }

  // 明确验证 id / type / rarity 完全不变
  if (
    candidate.id !== rv.rune.id ||
    candidate.type !== rv.rune.type ||
    candidate.rarity !== rv.rune.rarity
  ) {
    return { ok: false, reason: 'immutable rune fields changed during planning' }
  }

  return { ok: true, nextRune: candidate, expAdded: expAmount, levelsGained }
}

/** 符文经验进度展示结构（只读） */
export interface RuneExperienceProgress {
  level: number
  currentExp: number
  requiredExp: number | null
  percent: number
  isMax: boolean
}

/**
 * 只读展示 helper：返回符文经验进度。非法 Rune 返回 null（不抛异常）。
 *   - 非满级：currentExp = rune.exp，requiredExp = table[level]，percent ∈ [0,100]
 *   - 满级：requiredExp = null，percent = 100，isMax = true
 */
export function getRuneExperienceProgress(rune: unknown): RuneExperienceProgress | null {
  const v = validateRune(rune)
  if (!v.ok) return null
  const r = v.rune
  if (r.level >= RUNE_MAX_LEVEL) {
    return { level: r.level, currentExp: r.exp, requiredExp: null, percent: 100, isMax: true }
  }
  const required = getRuneExpRequiredForNextLevel(r.level)
  if (required === null) return null
  const rawPercent = required > 0 ? (r.exp / required) * 100 : 0
  const percent = Math.max(0, Math.min(100, rawPercent))
  return {
    level: r.level,
    currentExp: r.exp,
    requiredExp: required,
    percent,
    isMax: false
  }
}
