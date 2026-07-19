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

/**
 * 浮点安全阈值。
 *
 * 槽位累加用浮点，跨帧累积后真实值可能落在 `99.99999999999916` 这种「差一丝到整数倍」的位置，
 * 直接用 `Math.floor(total/gaugeMax)` 会把它判成「未就绪」从而永久丢失一次本应触发的行动
 * （即 P0 浮点边界 bug 的根因）。统一加一个极小 epsilon 把「差一丝到阈值」恢复成「已就绪」，
 * 同时不会给真正未就绪的槽位（如 99.5）误判成就绪（浮点相对误差约 1e-10，远小于该阈值）。
 */
export const GAUGE_EPSILON = 1e-9

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
  // 用统一 epsilon 处理「差一丝到阈值」的浮点边界：恢复本应触发的行动，不误判未就绪槽位。
  const readyActions = Math.floor((total + GAUGE_EPSILON) / gaugeMax)
  let remainingGauge = total - readyActions * gaugeMax
  if (remainingGauge < 0) remainingGauge = 0
  if (remainingGauge >= gaugeMax) remainingGauge = gaugeMax - GAUGE_EPSILON
  return { remainingGauge, readyActions }
}

/**
 * 双角色行动时间轴（纯函数）。
 *
 * 这是 A2.1 的核心调度原语：运行时（gameStore.gameLoop）与平衡模拟器（battleSimulator）
 * 都必须复用返回的同一份 `events` 序列，才能保证「相同战斗时间内双方行动次数一致」「事件顺序
 * 由真实时间到 GAUGE_MAX 的先后决定」「同刻平局时怪物优先（保持 A2 前线上行为，避免给极速
 * 玩家隐藏先手）」。
 *
 * 设计要点：
 * - 事件顺序完全由「真实时间到下一次充满」决定，与帧率 / 倍速 / 调用次数无关
 *   （函数只吃 `deltaSeconds`，不吃「帧」），因此 30/60/144Hz 产生的 combat-time 事件序列一致。
 * - 单一帧内事件数超过 `maxEvents`（运行时 `MAX_ACTIONS_PER_FRAME`）时，剩余时间以
 *   `unconsumedSeconds` 形式回传，由调用方携带到下一帧、在「新 delta 之前」先处理，
 *   从而在不破坏真实时间顺序的前提下限流——不会出现「玩家有积压就永远不让怪物行动」的饥饿。
 * - 平局（精确同刻）按怪物优先，避免两端各自实现「玩家优先」而一致地走进错误模型。
 *
 * @returns events            本帧内按真实时间排序的 'player' | 'monster' 事件序列
 * @returns playerGauge       处理后玩家剩余槽位，恒在 [0, gaugeMax)
 * @returns monsterGauge      处理后怪物剩余槽位，恒在 [0, gaugeMax)
 * @returns unconsumedSeconds 本帧未消耗（被 cap 截断）的战斗时间，由调用方携带到下一帧
 */
export interface CombatTimelineInput {
  playerGauge: number
  monsterGauge: number
  playerSpeed: number
  monsterSpeed: number
  deltaSeconds: number
  maxEvents?: number
  gaugeMax?: number
}

export interface CombatTimelineResult {
  events: Array<'player' | 'monster'>
  playerGauge: number
  monsterGauge: number
  unconsumedSeconds: number
}

export function advanceCombatTimeline(input: CombatTimelineInput): CombatTimelineResult {
  const gaugeMax = input.gaugeMax ?? GAUGE_MAX
  const maxEvents = input.maxEvents ?? Infinity
  const eps = GAUGE_EPSILON

  const pSpeed = Math.max(0, input.playerSpeed)
  const mSpeed = Math.max(0, input.monsterSpeed)
  const pG0 = clampGauge(input.playerGauge, gaugeMax)
  const mG0 = clampGauge(input.monsterGauge, gaugeMax)

  // 完整窗口内的总槽位（与 advanceGauge 同一数学：超过 GAUGE_MAX 折算成行动次数，余数留在 [0,gaugeMax)）。
  // 关键：余数「留在槽位里」而非被帧边界丢弃——这正是 advanceGauge 之所以与帧率无关的原因，
  // 时间轴也用它来保证 30/60/144Hz 产生的 combat-time 事件序列一致。
  const totalP = pG0 + pSpeed * input.deltaSeconds
  const totalM = mG0 + mSpeed * input.deltaSeconds
  const pReady = Math.floor((totalP + eps) / gaugeMax)
  const mReady = Math.floor((totalM + eps) / gaugeMax)

  // 每一侧第 k 次行动发生的「相对本帧起点」战斗时间。
  type TimedEvent = { t: number; side: 'player' | 'monster' }
  const timed: TimedEvent[] = []
  if (pSpeed > 0) {
    for (let k = 1; k <= pReady; k++) timed.push({ t: (k * gaugeMax - pG0) / pSpeed, side: 'player' })
  }
  if (mSpeed > 0) {
    for (let k = 1; k <= mReady; k++) timed.push({ t: (k * gaugeMax - mG0) / mSpeed, side: 'monster' })
  }
  // 按真实时间排序；精确同刻平局 → 怪物优先（保持 A2 前线上行为，避免给极速玩家隐藏先手）。
  timed.sort((a, b) => {
    if (Math.abs(a.t - b.t) <= eps) return a.side === 'monster' ? -1 : 1
    return a.t - b.t
  })

  const emitted = timed.slice(0, maxEvents)
  const events = emitted.map(e => e.side)
  const capped = timed.length > maxEvents
  // 未截断时整窗处理完（tCap = deltaSeconds）；截断时只处理到最后一发的时刻，余下时间回传。
  const tCap = capped && emitted.length > 0 ? emitted[emitted.length - 1].t : input.deltaSeconds
  const unconsumedSeconds = Math.max(0, input.deltaSeconds - tCap)

  // 处理到 tCap 时刻的槽位余数（已扣除已发出的行动）。
  const pEmitted = events.filter(e => e === 'player').length
  const mEmitted = events.filter(e => e === 'monster').length
  const pG = clampGauge(pG0 + pSpeed * tCap - pEmitted * gaugeMax, gaugeMax)
  const mG = clampGauge(mG0 + mSpeed * tCap - mEmitted * gaugeMax, gaugeMax)

  return { events, playerGauge: pG, monsterGauge: mG, unconsumedSeconds }
}

/**
 * 事件驱动循环用：返回「当前槽位 / 速度」下，到达下一次行动所需的毫秒数。
 *
 * 这是 A2.2 的核心原语：运行时不再「先整段推进冷却/Buff/回血/狂暴、再只处理一部分行动」，
 * 而是逐步把【所有战斗系统】一起推进到「下一个行动发生的时刻」，再执行该行动——
 * 这样行动、冷却、Buff、回血、狂暴永远活在同一个战斗时间上，不会出现时钟错位。
 *
 * @param gauge   当前槽位 [0, gaugeMax)
 * @param speed   速度（0 表示永不行动）
 * @param gaugeMax 槽位上限
 * @returns 到达下一次行动的毫秒数；speed<=0 时返回 Infinity
 */
export function nextEventDelayMs(gauge: number, speed: number, gaugeMax: number = GAUGE_MAX): number {
  if (speed <= 0) return Infinity
  const remaining = Math.max(0, gaugeMax - clampGauge(gauge, gaugeMax))
  return (remaining / speed) * 1000
}

function clampGauge(gauge: number, gaugeMax: number): number {
  if (!Number.isFinite(gauge)) return 0
  if (gauge < 0) return 0
  if (gauge >= gaugeMax) return gaugeMax - GAUGE_EPSILON
  return gauge
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
