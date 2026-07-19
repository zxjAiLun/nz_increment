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

  it('真实溢出（delta=0.5s, speed=10000 → 100 事件 > cap=20）：未消费时间存在且跨帧重放顺序 == 一次性无 cap', () => {
    // 这是 Review 要求的「真正超过 cap」的测试：speed=10000、delta=0.5s → 每方 50 次 = 100 事件，远超 cap=20。
    // 验证：
    //  (a) advanceCombatTimeline 在截断时确实返回 unconsumedSeconds > 0（存在未处理时间）；
    //  (b) 用「每帧最多 20 条 + 携带 unconsumed 到下一帧（在旧 delta 之前重放）」分发，
    //      最终完整序列严格等于一次性 maxEvents=Infinity 解析的结果。
    const uncapped = advanceCombatTimeline({
      playerGauge: 0, monsterGauge: 0,
      playerSpeed: 10000, monsterSpeed: 10000,
      deltaSeconds: 0.5, maxEvents: Infinity
    })
    expect(uncapped.events.length).toBe(100) // 真实溢出：100 > 20

    const CAP = 20
    let pG = 0, mG = 0, carry = 0.5 // 一整段 0.5s 战斗时间，分帧以 20 条上限消费
    let dispatched: Array<'player' | 'monster'> = []
    let sawUnconsumed = false
    for (let i = 0; i < 20; i++) {
      const r = advanceCombatTimeline({
        playerGauge: pG, monsterGauge: mG,
        playerSpeed: 10000, monsterSpeed: 10000,
        deltaSeconds: carry, // 携带上一帧未消费时间（在「新 delta」之前重放，不再叠加新时间）
        maxEvents: CAP
      })
      if (r.unconsumedSeconds > 0) sawUnconsumed = true
      dispatched.push(...r.events)
      pG = r.playerGauge
      mG = r.monsterGauge
      carry = r.unconsumedSeconds
      if (carry <= 0) break
    }
    expect(sawUnconsumed).toBe(true) // 确实触发了 cap 与跨帧携带
    expect(dispatched).toEqual(uncapped.events) // 顺序严格一致，无丢失 / 无重排
  })

  it('30/60/144Hz 在相同「已消费战斗时间」下严格一致（生产 cap=2000 下双方事件数 == 理论值）', () => {
    // 真实溢出场景：speed=10000、gameSpeed=4、总战斗时间 10s → 每方理论 4000 次。
    // 生产运行时单帧安全上限为 MAX_LOGIC_EVENTS_PER_FRAME=2000，远大于任何单帧事件数（极端 26.7/帧），
    // 故「已消费战斗时间」始终追上「经过战斗时间」——三档帧率严格相等且等于理论值。
    // （cap=20 的极端慢放与跨帧携带顺序由上一个用例专门验证。）
    const playerSpeed = 10000, monsterSpeed = 10000, gameSpeed = 4, totalSeconds = 10, CAP = 2000
    const expected = (playerSpeed * gameSpeed * totalSeconds) / 100
    for (const fr of FRAME_RATES) {
      const frameMs = 1000 / fr
      const frames = Math.round((totalSeconds * 1000) / frameMs)
      const baseDelta = (frameMs / 1000) * gameSpeed
      let pG = 0, mG = 0, carry = 0, pActions = 0, mActions = 0
      for (let i = 0; i < frames; i++) {
        const r = advanceCombatTimeline({
          playerGauge: pG, monsterGauge: mG,
          playerSpeed, monsterSpeed,
          deltaSeconds: baseDelta + carry,
          maxEvents: CAP
        })
        pActions += r.events.filter(e => e === 'player').length
        mActions += r.events.filter(e => e === 'monster').length
        pG = r.playerGauge
        mG = r.monsterGauge
        carry = r.unconsumedSeconds
      }
      expect(pActions).toBe(expected)
      expect(mActions).toBe(expected)
    }
  })

  it('玩家击杀后新怪物：遗留的待处理事件不应错误命中新怪物（cap 携带的只是时间序，不跨怪物）', () => {
    // 该约束由调用方（gameLoop / simulator）在击杀后清空 carry 并比对 encounterId 保证；
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
