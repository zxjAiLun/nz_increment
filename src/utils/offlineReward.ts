/**
 * Phase 3.2 — 离线收益唯一结算模块
 *
 * 设计目标（来自定稿 spec）：
 * - 只有一个离线计算公式（攻击基准 + 时长阶梯倍率 + 24h 上限）。
 * - 旧的「扁平每分钟 / 8 小时上限」公式（calculateOfflineProgress）与
 *   旧的 calculateOfflineReward 全部删除，公式只此一份。
 * - 结算（Model A）与展示（Model B）共享同一份不可变快照 OfflineSettlement；
 *   展示端不得自行计算或发放资源。
 * - 输入必须规范化（NaN / Infinity / 负数 → 0），金币/经验必须为非负整数。
 *
 * 幸运只通过 Phase 3.1 的公开 helper calculateLuckEffects 应用一次。
 */
import { calculateLuckEffects } from './luck'
import { parsePositiveTimestamp } from './timestamp'

export const OFFLINE_FORMULA_VERSION = 1 as const
export const MAX_OFFLINE_SECONDS = 24 * 60 * 60 // 24 小时上限
export const MIN_OFFLINE_SECONDS = 60 // 最低离线门槛（秒）

export interface OfflineSettlementInput {
  offlineSeconds: number
  attack: number
  effectiveLuck: number
  offlineEfficiencyBonus: number
}

export interface OfflineSettlement {
  id: string
  createdAt: number
  /** 原始离线秒数（未截断，用于展示与合并累加） */
  elapsedSeconds: number
  /** 计入收益的实际秒数（已 floor 并截断到 24h） */
  creditedSeconds: number
  gold: number
  exp: number
  formulaVersion: typeof OFFLINE_FORMULA_VERSION
}

/** 把任意输入收敛为「非负有限数」；NaN / Infinity / 负数 → 0 */
function safePositive(v: number): number {
  return Number.isFinite(v) && v > 0 ? v : 0
}

function generateSettlementId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  return `off_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

/**
 * 唯一离线结算纯函数。
 * 公式：基础产出 = attack × 0.2 × creditedSeconds；最终 = 基础 × 当前时长阶梯倍率。
 * 保留既有阶梯：1.0 / 1.5 / 2.0 / 2.5（对应 ≥0 / ≥1h / ≥4h / ≥8h）。
 * creditedSeconds 已 floor 并截断到 MAX_OFFLINE_SECONDS，保证整数结果与 24h 上限。
 */
export function calculateOfflineSettlement(
  input: OfflineSettlementInput
): Omit<OfflineSettlement, 'id' | 'createdAt'> {
  const rawSeconds = safePositive(input.offlineSeconds)
  const creditedSeconds = Math.min(Math.floor(rawSeconds), MAX_OFFLINE_SECONDS)
  const attack = safePositive(input.attack)
  const efficiency = safePositive(input.offlineEfficiencyBonus)
  const luck = safePositive(input.effectiveLuck)

  // 幸运只在结算内通过公开 helper 应用一次（gold 受益；exp 不计幸运）。
  const luckEffects = calculateLuckEffects(luck)
  const baseGoldPerSecond = attack * 0.2 * (1 + efficiency / 100) * (1 + luckEffects.goldBonusRate)
  const baseExpPerSecond = attack * 0.1

  let goldMultiplier = 1
  let expMultiplier = 1
  if (creditedSeconds >= 3600) {
    goldMultiplier = 1.5
    expMultiplier = 1.2
  }
  if (creditedSeconds >= 4 * 3600) {
    goldMultiplier = 2.0
    expMultiplier = 1.5
  }
  if (creditedSeconds >= 8 * 3600) {
    goldMultiplier = 2.5
    expMultiplier = 2.0
  }

  const gold = Math.max(0, Math.floor(baseGoldPerSecond * creditedSeconds * goldMultiplier))
  const exp = Math.max(0, Math.floor(baseExpPerSecond * creditedSeconds * expMultiplier))

  return {
    elapsedSeconds: Math.floor(rawSeconds),
    creditedSeconds,
    gold,
    exp,
    formulaVersion: OFFLINE_FORMULA_VERSION
  }
}

export function makeSettlement(
  partial: Omit<OfflineSettlement, 'id' | 'createdAt' | 'formulaVersion'>
): OfflineSettlement {
  return {
    id: generateSettlementId(),
    createdAt: Date.now(),
    formulaVersion: OFFLINE_FORMULA_VERSION,
    ...partial
  }
}

/**
 * 合并已有 pending 与新的离线区间：
 * gold / exp / elapsed / credited 逐项累加；
 * 每个独立区间在 calculateOfflineSettlement 内已各自截断 24h，此处不再重压。
 */
export function mergeSettlements(
  oldSettlement: OfflineSettlement,
  next: Omit<OfflineSettlement, 'id' | 'createdAt'>
): OfflineSettlement {
  return {
    id: generateSettlementId(),
    createdAt: Date.now(),
    elapsedSeconds: oldSettlement.elapsedSeconds + next.elapsedSeconds,
    creditedSeconds: oldSettlement.creditedSeconds + next.creditedSeconds,
    gold: oldSettlement.gold + next.gold,
    exp: oldSettlement.exp + next.exp,
    formulaVersion: OFFLINE_FORMULA_VERSION
  }
}

/**
 * 把旧存档中的 pending（仅 { gold, exp }）或已有 OfflineSettlement 规范化为新形状。
 * 旧 {gold,exp} 无法还原离线秒数，按 elapsed/credited = 0 处理，且绝删除玩家已有奖励。
 */
/**
 * 把任意来源（旧 {gold,exp} / 已有 OfflineSettlement / 损坏数据）规范化为合法 OfflineSettlement。
 * Phase 3.2.1：无论是否已有 formulaVersion，都强制规范化所有数值字段：
 * - gold / exp / elapsedSeconds / creditedSeconds：NaN / Infinity / 负数一律归零，floor 为非负整数；
 * - 绝不允许 Infinity 进入玩家金币/经验；
 * - 缺失或非法 id / createdAt 补合法值；
 * - 合法旧 pending 的金额保持不变（只做净化，不改数值）。
 */
export function normalizePendingOfflineReward(raw: unknown): OfflineSettlement | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>

  const coerceNonNegInt = (v: unknown): number => {
    const n = Number(v)
    if (!Number.isFinite(n) || n < 0) return 0
    return Math.floor(n)
  }

  const gold = coerceNonNegInt(r.gold)
  const exp = coerceNonNegInt(r.exp)
  const elapsedSeconds = coerceNonNegInt(r.elapsedSeconds)
  const creditedSeconds = coerceNonNegInt(r.creditedSeconds)

  const id = typeof r.id === 'string' && r.id.trim().length > 0 ? r.id : generateSettlementId()
  // Phase 3.2.2：createdAt 复用「正向时间戳」语义——null / '' / 空白 / 0 / 负数 / NaN / Infinity
  // 一律视为非法并补为当前时间，与「缺失或非法 createdAt 时补合法值」约束对齐。
  const createdAt = parsePositiveTimestamp(r.createdAt) ?? Date.now()

  return {
    id,
    createdAt,
    elapsedSeconds,
    creditedSeconds,
    gold,
    exp,
    formulaVersion: OFFLINE_FORMULA_VERSION
  }
}
