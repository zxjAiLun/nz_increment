import { describe, expect, it } from 'vitest'
import { advanceGauge, shouldEnrage } from './combatClock'
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

describe('combatClock.advanceGauge - 与帧率 / 倍速无关', () => {
  it('相同战斗时间内行动次数与帧率无关（覆盖 30/60/144Hz × gameSpeed × speed）', () => {
    for (const speed of PLAYER_SPEEDS) {
      for (const gameSpeed of GAME_SPEEDS) {
        const expected = Math.floor((speed * gameSpeed * TOTAL_SECONDS) / GAUGE_MAX)
        const counts = FRAME_RATES.map(fr => simulate(speed, gameSpeed, fr, TOTAL_SECONDS).totalActions)
        // 所有帧率必须给出相同行动次数（离散 tick 误差 <= 1 允许边界）
        const min = Math.min(...counts)
        const max = Math.max(...counts)
        expect(max - min).toBeLessThanOrEqual(1)
        // 必须与解析值一致（±1 边界）
        for (const c of counts) {
          expect(Math.abs(c - expected)).toBeLessThanOrEqual(1)
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

  it('高速度单帧溢出：一帧增加 280 → readyActions=3, remaining=0（不截断丢失）', () => {
    const r = advanceGauge(20, 1000, 0.28) // gain = 1000 * 0.28 = 280
    expect(r.readyActions).toBe(3)
    expect(r.remainingGauge).toBe(0)
  })

  it('gameSpeed 线性缩放行动次数（同帧率下 2x 约等于两倍行动）', () => {
    const base = simulate(100, 1, 60, TOTAL_SECONDS).totalActions
    const double = simulate(100, 2, 60, TOTAL_SECONDS).totalActions
    expect(Math.abs(double - base * 2)).toBeLessThanOrEqual(2)
  })

  it('暂停（不推进 deltaTime）不产生任何行动', () => {
    const r = advanceGauge(0, 10000, 0)
    expect(r.readyActions).toBe(0)
    expect(r.remainingGauge).toBe(0)
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
