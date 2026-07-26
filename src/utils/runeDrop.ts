/**
 * 符文掉率 leaf 模块 —— Phase 3.9
 *
 * 本文件是「主线 Rune 掉率」的唯一事实来源（与 Phase 3.8 的符文生成/入库公式分离）。
 * Rune 掉率本轮与 luck 完全独立，不修改 LUCK_CONFIG，不从 equipmentDropChance /
 * diamondDropChance / luck / rarity / difficulty 推导。
 *
 * 锁定的初始保守掉率：
 *   - 普通主线怪：1%
 *   - 主线 Boss：10%
 *   - 练功房：0%
 *
 * 所有函数纯函数、不抛异常、不调用 RNG。
 */

/** 锁定掉率（冻结，禁止调整）。 */
export const RUNE_DROP_CONFIG = Object.freeze({
  normalChance: 0.01,
  bossChance: 0.10,
  trainingChance: 0
} as const)

/** 计算基础 Rune 掉率。training 优先返回 0；非 training Boss 返回 0.10；否则 0.01。 */
export function getBaseRuneDropChance(input: {
  isBoss: unknown
  isTrainingMode?: unknown
}): number {
  if (input.isTrainingMode) return RUNE_DROP_CONFIG.trainingChance
  if (input.isBoss) return RUNE_DROP_CONFIG.bossChance
  return RUNE_DROP_CONFIG.normalChance
}

/**
 * 规范化任意掉率输入为 [0,1] 区间的合法 number：
 *   - 非 number / NaN / 非有限 / 负数 → 0
 *   - > 1 → 1
 *   - 合法值 → 保持
 * 不抛异常。
 */
export function normalizeRuneDropChance(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return 0
  if (raw < 0) return 0
  if (raw > 1) return 1
  return raw
}
