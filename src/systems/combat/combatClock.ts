/**
 * 战斗时钟共享原语
 *
 * 线上运行时（gameStore）与平衡模拟器（battleSimulator）都必须复用这里的数学，
 * 才能保证「相同战斗时间内行动次数一致」「gauge 不丢失」「狂暴按战斗时间触发」。
 *
 * 所有时间单位：
 * - gauge 推进：deltaSeconds（秒）
 * - buff 剩余：remainingMs（毫秒）或 remaining（秒），由调用方约定
 * - 狂暴：combatElapsedMs（毫秒）
 */
import { GAUGE_MAX } from '../../utils/constants'

export interface GaugeAdvance {
  /** 推进后剩余槽位，恒在 [0, gaugeMax) */
  remainingGauge: number
  /** 本次推进可触发的行动次数（不会因截断而丢失） */
  readyActions: number
}

/**
 * 推进行动槽。与「Math.min(GAUGE_MAX, gauge + gain)」不同，这里把超过 GAUGE_MAX 的部分
 * 折算成可触发的行动次数，避免高速度 / 高倍速下丢失行动。
 *
 * 速度→槽位速率：每秒获得 `speed` 点槽位（GAUGE_MAX=100），即约 `speed` 次行动/秒。
 * 这与线上旧的 updateGauges（speed * (deltaMs/100) * GAUGE_TICK_RATE/100）以及模拟器
 * （speed * GAUGE_TICK_RATE/100 每 SIM_TICK_SECONDS）在数学上完全等价。
 *
 * @param currentGauge 当前槽位
 * @param speed        速度
 * @param deltaSeconds 本帧战斗时间（秒，已乘过 gameSpeed）
 */
export function advanceGauge(
  currentGauge: number,
  speed: number,
  deltaSeconds: number,
  gaugeMax: number = GAUGE_MAX
): GaugeAdvance {
  const gain = speed * deltaSeconds
  const total = currentGauge + gain
  const readyActions = Math.floor(total / gaugeMax)
  const remainingGauge = total - readyActions * gaugeMax
  return { remainingGauge, readyActions }
}

/**
 * 按 delta 推进一组战斗 Buff，返回尚未到期的 Buff。
 * @param buffs        当前 Buff 列表（每项需有 remaining 字段，单位自定：秒或毫秒）
 * @param delta        时间增量，单位须与 remaining 一致
 */
export function tickBattleBuffs<T extends { remaining: number }>(buffs: T[], delta: number): T[] {
  return buffs
    .map(b => ({ ...b, remaining: b.remaining - delta }))
    .filter(b => b.remaining > 0)
}

/**
 * 狂暴是否触发：统一以战斗经过时间判定，不再使用 Date.now()。
 * @param combatElapsedMs 战斗经过时间（毫秒）
 * @param enrageAfterMs   狂暴触发阈值（毫秒）
 */
export function shouldEnrage(combatElapsedMs: number, enrageAfterMs: number): boolean {
  return combatElapsedMs >= enrageAfterMs
}
