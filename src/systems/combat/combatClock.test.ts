import { describe, expect, it } from 'vitest'
import { advanceGauge, advanceCombatTimeline, shouldEnrage } from './combatClock'
import { GAUGE_MAX } from '../../utils/constants'

const FRAME_RATES = [30, 60, 144]
const GAME_SPEEDS = [0.5, 1, 2, 4]
const PLAYER_SPEEDS = [10, 135, 1000, 10000]
const TOTAL_SECONDS = 10

/** 把 realSeconds 拆成指定帧率的若干帧，用 advanceGauge 累加，返回 { totalActions, finalGauge } */
function simulate(speed: number, gameSpeed: number, frameRate: number, totalSeconds: number) {
  const frameMs = 1000 / frameRate
  const frames = Math.round((totalSeconds * 1000) / frameMs)
  let gauge = 0
  let totalActions = 0
  for (let i = 0; i < frames; i++) {
    const effectiveMs = frameMs * gameSpeed
    const r = advanceGauge(gauge, speed, effectiveMs / 1000)
    gauge = r.remainingGauge
    totalActions += r.readyActions
  }
  return { totalActions, finalGauge: gauge }
}

describe('combatClock.advanceGauge - 与帧率 / 倍速无关（浮点边界修复后严格相等）', () => {
  it('相同战斗时间内行动次数与帧率无关（覆盖 30/60/144Hz × gameSpeed × speed）', () => {
    for (const speed of PLAYER_SPEEDS) {
      for (const gameSpeed of GAME_SPEEDS) {
        const expected = Math.floor((speed * gameSpeed * TOTAL_SECONDS) / GAUGE_MAX)
        const counts = FRAME_RATES.map(fr => simulate(speed, gameSpeed, fr, TOTAL_SECONDS).totalActions)
        // A2.1 浮点边界修复后：所有帧率必须给出【完全相同】的行动次数（不再容忍 ±1）。
        const min = Math.min(...counts)
        const max = Math.max(...counts)
        expect(max - min).toBe(0)
        for (const c of counts) {
          expect(c).toBe(expected)
        }
      }
    }
  })

  it('gauge 不丢失：高速度 / 高倍速下离散累积 == 解析值', () => {
    for (const speed of PLAYER_SPEEDS) {
      for (const gameSpeed of GAME_SPEEDS) {
        const { totalActions, finalGauge } = simulate(speed, gameSpeed, 144, TOTAL_SECONDS)
        // 已解析的行动对应的槽位 + 剩余槽位 == 理论总增益（不丢失）
        const totalGain = speed * gameSpeed * TOTAL_SECONDS
        const processed = totalActions * GAUGE_MAX
        expect(processed + finalGauge).toBeCloseTo(totalGain, 0)
        expect(finalGauge).toBeGreaterThanOrEqual(0)
        expect(finalGauge).toBeLessThan(GAUGE_MAX)
      }
    }
  })

  it('12s / speed=50 → 恰好 6 次行动（浮点边界 99.99999999999916 必须被恢复）', () => {
    // 构造一个「差一丝到阈值」的槽位，验证 epsilon 把它恢复为已就绪。
    const nearThreshold = GAUGE_MAX - 8.3e-14
    const r = advanceGauge(nearThreshold, 50, 0) // 无新增，但应判定为已就绪
    expect(r.readyActions).toBe(1)
    expect(r.remainingGauge).toBe(0)

    // 12s 内累计：50 * 12 = 600 槽位 → 恰好 6 次。逐帧累加不得丢失。
    let gauge = 0
    let actions = 0
    for (let i = 0; i < 120; i++) {
      const step = advanceGauge(gauge, 50, 0.1) // 0.1s tick，每 tick +5 槽位
      gauge = step.remainingGauge
      actions += step.readyActions
    }
    expect(actions).toBe(6)
  })

  it('高速度单帧溢出：一帧增加 280 → readyActions=3, remaining=0（不截断丢失）', () => {
    const r = advanceGauge(20, 1000, 0.28) // gain = 1000 * 0.28 = 280
    expect(r.readyActions).toBe(3)
    expect(r.remainingGauge).toBe(0)
  })

  it('gameSpeed 线性缩放行动次数（同帧率下 2x 约等于两倍行动）', () => {
    const base = simulate(100, 1, 60, TOTAL_SECONDS).totalActions
    const double = simulate(100, 2, 60, TOTAL_SECONDS).totalActions
    expect(double).toBe(base * 2)
  })

  it('暂停（不推进 deltaTime）不产生任何行动', () => {
    const r = advanceGauge(0, 10000, 0)
    expect(r.readyActions).toBe(0)
    expect(r.remainingGauge).toBe(0)
  })
})

describe('combatClock.advanceCombatTimeline - 双角色调度原语', () => {
  it('事件顺序由真实时间到 GAUGE_MAX 决定，同刻平局怪物优先', () => {
    // 双方速度相同、同时起步：事件应严格交替，且平局时怪物先（保持 A2 前线上行为）。
    const r = advanceCombatTimeline({
      playerGauge: 0, monsterGauge: 0,
      playerSpeed: 100, monsterSpeed: 100,
      deltaSeconds: 1 // 1s → 各 1 次
    })
    expect(r.events).toEqual(['monster', 'player'])
  })

  it('更快的一方更早行动（由时间决定，而非队列优先级）', () => {
    const r = advanceCombatTimeline({
      playerGauge: 0, monsterGauge: 0,
      playerSpeed: 200, monsterSpeed: 100,
      deltaSeconds: 1 // 玩家 0.5s/1.0s 满（2 次），怪物 1.0s 满（1 次）；1.0s 同刻平局怪物优先
    })
    expect(r.events).toEqual(['player', 'monster', 'player'])
  })

  it('极端速度 30/60/144Hz × gameSpeed 行动次数完全一致（无帧率依赖，调度原语本身）', () => {
    // 用 maxEvents=Infinity（不截断）验证「调度原语」与帧率无关：
    // 相同战斗时间内产生的 combat-time 事件序列在 30/60/144Hz 下完全一致。
    const playerSpeed = 10000
    const monsterSpeed = 10000
    const gameSpeed = 4
    const totalSeconds = 10
    for (const fr of FRAME_RATES) {
      const frameMs = 1000 / fr
      const frames = Math.round((totalSeconds * 1000) / frameMs)
      const baseDelta = (frameMs / 1000) * gameSpeed
      let pG = 0, mG = 0, pActions = 0, mActions = 0
      for (let i = 0; i < frames; i++) {
        const r = advanceCombatTimeline({
          playerGauge: pG, monsterGauge: mG,
          playerSpeed, monsterSpeed,
          deltaSeconds: baseDelta, // 不截断：调度原语是帧率无关的
          maxEvents: Infinity
        })
        pActions += r.events.filter(e => e === 'player').length
        mActions += r.events.filter(e => e === 'monster').length
        pG = r.playerGauge
        mG = r.monsterGauge
      }
      // 10s 内每方应有 10000*4*10/100 = 4000 次，且三档帧率严格相等。
      expect(pActions).toBe(4000)
      expect(mActions).toBe(4000)
    }
  })

  it('30Hz / gameSpeed=4 / 双方=10000：单帧 cap 不饿死怪物（交错而非玩家独占）', () => {
    // 复现 Review 中的 P0 死法：30Hz + 高倍速 + 极速 → 单帧溢出 20 cap。
    // 旧模型：玩家优先 → 怪物每帧只处理 7 次、积压无限增长。
    // 新模型：cap 通过「先处理已排好的时间序」实现，怪物与玩家严格交替（平局怪物优先），
    // 故怪物绝不被饿死——每帧怪物事件数 == 玩家事件数（同速平局交替）。
    // 注：此极端组合下「每帧事件数(26) > cap(20)」会使战斗整体进入慢动作（双方同比例受限），
    // 这是 20 cap 的性能上限，非饥饿；正常 60Hz 玩法不会触发。
    const playerSpeed = 10000, monsterSpeed = 10000, gameSpeed = 4, totalSeconds = 10
    const fr = 30
    const frameMs = 1000 / fr
    const frames = Math.round((totalSeconds * 1000) / frameMs)
    const baseDelta = (frameMs / 1000) * gameSpeed
    let pG = 0, mG = 0, carry = 0, pActions = 0, mActions = 0, cappedFrames = 0
    for (let i = 0; i < frames; i++) {
      const r = advanceCombatTimeline({
        playerGauge: pG, monsterGauge: mG,
        playerSpeed, monsterSpeed,
        deltaSeconds: baseDelta + carry,
        maxEvents: 20
      })
      if (r.unconsumedSeconds > 0) cappedFrames++
      // 交错序列中怪物事件数必须 >= 玩家事件数（平局怪物优先）
      const m = r.events.filter(e => e === 'monster').length
      const p = r.events.filter(e => e === 'player').length
      expect(m).toBeGreaterThanOrEqual(p)
      pActions += p
      mActions += m
      pG = r.playerGauge
      mG = r.monsterGauge
      carry = r.unconsumedSeconds
    }
    // 怪物未被饿死：双方严格相等（同速平局交替，各占一半）。
    expect(pActions).toBe(mActions)
    expect(pActions).toBeGreaterThan(0)
    // 说明：在 30Hz 下确实触发了 cap（需要跨帧保留），但怪物与玩家同比例受限，无永久积压。
    expect(cappedFrames).toBeGreaterThan(0)
  })

  it('equal-speed 长跑无饥饿：任意时刻怪物累计行动数 >= 玩家累计（平局怪物优先）', () => {
    let pG = 0, mG = 0
    let pCum = 0, mCum = 0
    for (let i = 0; i < 1000; i++) {
      const r = advanceCombatTimeline({
        playerGauge: pG, monsterGauge: mG,
        playerSpeed: 50, monsterSpeed: 50,
        deltaSeconds: 0.1
      })
      for (const e of r.events) {
        if (e === 'player') pCum++
        else mCum++
      }
      pG = r.playerGauge
      mG = r.monsterGauge
      expect(mCum).toBeGreaterThanOrEqual(pCum)
    }
  })

  it('单帧溢出（>cap）跨帧顺序 == 一次性无 cap 处理（pending 队列在「新 delta 之前」先处理旧事件）', () => {
    // 运行时 / 模拟器实际采用：每帧用 advanceCombatTimeline(maxEvents=Infinity) 取「完整有序事件序列」，
    // 再把每帧的溢出事件放入 pending 队列，下一帧「先排空 pending 再处理新事件」——这样跨帧顺序与
    // 一次性无 cap 处理完全一致，且 cap 只限制「每帧处理条数」（性能），不丢失 / 不重排事件。
    const uncapped = advanceCombatTimeline({
      playerGauge: 0, monsterGauge: 0,
      playerSpeed: 10000, monsterSpeed: 10000,
      deltaSeconds: 0.5, maxEvents: Infinity
    })
    // 模拟 pending 队列分发：每帧取完整事件序列，先排空 pending，再取新事件，每帧最多处理 20 条。
    const CAP = 20
    const queue: Array<'player' | 'monster'> = []
    let pG = 0, mG = 0
    let dispatched: Array<'player' | 'monster'> = []
    for (let i = 0; i < 10; i++) {
      const r = advanceCombatTimeline({
        playerGauge: pG, monsterGauge: mG,
        playerSpeed: 10000, monsterSpeed: 10000,
        deltaSeconds: 0.05, maxEvents: Infinity
      })
      // 旧事件（pending）优先于新事件
      const batch = [...queue, ...r.events]
      const take = batch.slice(0, CAP)
      const rest = batch.slice(CAP)
      dispatched.push(...take)
      queue.length = 0
      queue.push(...rest)
      pG = r.playerGauge
      mG = r.monsterGauge
    }
    expect(dispatched).toEqual(uncapped.events)
    expect(queue.length).toBe(0)
  })

  it('玩家击杀后新怪物：遗留的待处理事件不应错误命中新怪物（cap 携带的只是时间序，不跨怪物）', () => {
    // 该约束由调用方（gameLoop / simulator）在击杀后清空 pendingTimeline 保证；
    // 这里验证时间轴本身不「记忆」跨段事件：同一输入两次调用结果可复现。
    const input = { playerGauge: 0, monsterGauge: 0, playerSpeed: 100, monsterSpeed: 100, deltaSeconds: 1 }
    const a = advanceCombatTimeline(input)
    const b = advanceCombatTimeline(input)
    expect(a).toEqual(b)
  })

  it('速度 0 的一方永不行动', () => {
    const r = advanceCombatTimeline({
      playerGauge: 0, monsterGauge: 0,
      playerSpeed: 0, monsterSpeed: 100,
      deltaSeconds: 10
    })
    expect(r.events).toEqual(['monster', 'monster', 'monster', 'monster', 'monster', 'monster', 'monster', 'monster', 'monster', 'monster'])
    expect(r.playerGauge).toBe(0)
  })
})

describe('combatClock.shouldEnrage - 统一战斗时间', () => {
  it('战斗经过时间达到阈值即触发', () => {
    expect(shouldEnrage(30_000, 30_000)).toBe(true)
    expect(shouldEnrage(29_999, 30_000)).toBe(false)
    expect(shouldEnrage(0, 0)).toBe(true)
  })

  it('gameSpeed 加速狂暴：4x 下现实 7.5 秒即达 30 秒战斗时间', () => {
    // 现实 7.5s * 4 = 30s 战斗时间
    const combatElapsedMs = 7.5 * 1000 * 4
    expect(shouldEnrage(combatElapsedMs, 30_000)).toBe(true)
  })
})
