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
 *
 * getBaseRuneDropChance 对一切 malformed 输入严格 fail-closed：
 *   - 不读取 RNG、不修改输入、不对字段做 Boolean(...) 强转或 truthy 判断；
 *   - null / undefined / primitive（string/number/boolean/symbol/function）/ array / Proxy /
 *     抛异常的 getter / 非布尔字段，全部返回 0；
 *   - 字段使用严格 === 布尔判断，每个必要字段至多读取一次；
 *   - training 优先为控制流短路（命中即返回，绝不读取 isBoss）。
 */

/** 锁定掉率（冻结，禁止调整）。 */
export const RUNE_DROP_CONFIG = Object.freeze({
  normalChance: 0.01,
  bossChance: 0.10,
  trainingChance: 0
} as const)

/**
 * 计算基础 Rune 掉率（纯函数、不抛异常、fail-closed）。
 *
 * 语义（training 优先且短路）：
 *   - isTrainingMode === true                                   → 0（练功房；不读取 isBoss）
 *   - isTrainingMode 为 false / undefined，且 isBoss === true    → 0.10（Boss）
 *   - isTrainingMode 为 false / undefined，且 isBoss === false  → 0.01（普通）
 *   - 其余一切 malformed 状态                                    → 0
 *
 * 约束：字段严格 === 布尔判断（不 trusty、不 Boolean 强转）；每个必要字段至多读取一次；
 * 抛异常的 getter / Proxy / 任意非法输入返回 0（catch 兜底）。
 */
export function getBaseRuneDropChance(input: {
  isBoss: unknown
  isTrainingMode?: unknown
}): number {
  try {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return 0
    }

    const training = input.isTrainingMode

    if (training === true) {
      return RUNE_DROP_CONFIG.trainingChance
    }

    // training 存在但不是 true、也不是 false / undefined（malformed）→ fail-closed
    if (training !== undefined && training !== false) {
      return 0
    }

    const boss = input.isBoss

    if (boss === true) {
      return RUNE_DROP_CONFIG.bossChance
    }

    if (boss === false) {
      return RUNE_DROP_CONFIG.normalChance
    }

    return 0
  } catch {
    return 0
  }
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
