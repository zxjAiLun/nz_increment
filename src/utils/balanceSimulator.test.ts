import { describe, expect, it } from 'vitest'
import {
  DEFAULT_BALANCE_BUILDS,
  DEFAULT_BALANCE_DIFFICULTIES,
  DEFAULT_BALANCE_SCENARIOS,
  formatBalanceMetricsForLog,
  formatBalanceReportMarkdown,
  simulateBalanceReport
} from './balanceSimulator'

const RUNS_PER_POINT = 30

describe('TTK / TTL / RPM balance simulation', () => {
  it('simulates the difficulty x build x scenario matrix and reports core balance metrics', () => {
    const report = simulateBalanceReport(DEFAULT_BALANCE_DIFFICULTIES, RUNS_PER_POINT)

    expect(report.points).toHaveLength(
      DEFAULT_BALANCE_DIFFICULTIES.length * DEFAULT_BALANCE_BUILDS.length * DEFAULT_BALANCE_SCENARIOS.length
    )
    for (const point of report.points) {
      expect(point.runs).toBe(RUNS_PER_POINT)
      expect(DEFAULT_BALANCE_BUILDS).toContain(point.buildType)
      expect(DEFAULT_BALANCE_SCENARIOS).toContain(point.battleType)
      expect(Number.isFinite(point.monsterHp)).toBe(true)
      expect(Number.isFinite(point.monsterAttack)).toBe(true)
      expect(Number.isFinite(point.monsterDefense)).toBe(true)
      expect(Number.isFinite(point.playerDps)).toBe(true)
      expect(Number.isFinite(point.averageTTK)).toBe(true)
      expect(Number.isFinite(point.averageTTL)).toBe(true)
      expect(Number.isFinite(point.averageRemainingHp)).toBe(true)
      expect(Number.isFinite(point.goldPerMinute)).toBe(true)
      expect(Number.isFinite(point.equipmentPerMinute)).toBe(true)
      expect(point.monsterHp).toBeGreaterThan(0)
      expect(point.monsterAttack).toBeGreaterThan(0)
      expect(point.monsterDefense).toBeGreaterThanOrEqual(0)
      expect(point.playerDps).toBeGreaterThanOrEqual(0)
      expect(point.averageTTK).toBeGreaterThan(0)
      expect(point.averageTTL).toBeGreaterThan(0)
      expect(point.winRate).toBeGreaterThanOrEqual(0)
      expect(point.winRate).toBeLessThanOrEqual(1)
      expect(point.deathRate).toBeGreaterThanOrEqual(0)
      expect(point.deathRate).toBeLessThanOrEqual(1)
    }
  })

  it('keeps baseline milestone simulations within non-catastrophic bounds', () => {
    const report = simulateBalanceReport(DEFAULT_BALANCE_DIFFICULTIES, RUNS_PER_POINT, ['balanced'], ['normal', 'boss'])

    for (const point of report.points) {
      expect(point.deathRate).toBeLessThan(1)
      expect(point.averageTTK).toBeLessThanOrEqual(240)
      expect(point.goldPerMinute).toBeGreaterThanOrEqual(0)
    }
  })

  it('formats report rows and markdown for generated docs', () => {
    const report = simulateBalanceReport([10], 5, ['balanced'], ['normal'])
    const formatted = formatBalanceMetricsForLog(report.points[0])
    const markdown = formatBalanceReportMarkdown(report)

    expect(formatted).toMatchObject({ difficulty: 10, build: 'balanced', scenario: 'normal', runs: 5 })
    expect(markdown).toContain('难度 | 构筑 | 场景')
    expect(markdown).toContain('金币/分钟')
  })
})
