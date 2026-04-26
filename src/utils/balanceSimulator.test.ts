import { describe, expect, it } from 'vitest'
import {
  DEFAULT_BALANCE_BUILDS,
  DEFAULT_BALANCE_DIFFICULTIES,
  DEFAULT_BALANCE_SCENARIOS,
  evaluateBalanceGuardrails,
  formatBalanceMetricsForLog,
  formatBalanceReportMarkdown,
  simulateBalanceReport,
  type BalanceBattleType,
  type BalanceBuildType,
  type BalancePointMetrics
} from './balanceSimulator'

const RUNS_PER_POINT = 30

function createPoint(overrides: Partial<BalancePointMetrics> = {}): BalancePointMetrics {
  return {
    difficulty: 100,
    battleType: 'normal',
    buildType: 'balanced',
    runs: 10,
    monsterHp: 1000,
    monsterAttack: 100,
    monsterDefense: 50,
    playerDps: 100,
    winRate: 1,
    averageTTK: 10,
    averageTTL: 10,
    averageRemainingHp: 100,
    deathRate: 0,
    goldPerMinute: 100,
    equipmentPerMinute: 1,
    guardrailStatus: 'pass',
    mainFailureReason: 'none',
    recommendedStat: 'none',
    playerAccuracy: 50,
    monsterDodge: 10,
    estimatedHitChance: 0.9,
    skillCastsPerMinute: 0,
    skillDamageShare: 0,
    adjustedGoldPerMinute: 100,
    diamondPerMinute: 0,
    resourcePowerPerMinute: 100,
    thirtyMinutePowerGain: 3000,
    ...overrides
  }
}

function createScenarioPoints(difficulty: number, battleType: BalanceBattleType): BalancePointMetrics[] {
  const goldByBuild: Record<BalanceBuildType, number> = {
    balanced: 100,
    crit: 110,
    tank: 80,
    armor: 90,
    speedSkill: 120,
    luck: 150
  }
  return DEFAULT_BALANCE_BUILDS.map(buildType => createPoint({
    difficulty,
    battleType,
    buildType,
    winRate: buildType === 'luck' ? 0.98 : 1,
    averageTTK: buildType === 'luck' ? 11 : 10,
    goldPerMinute: goldByBuild[buildType],
    adjustedGoldPerMinute: goldByBuild[buildType],
    resourcePowerPerMinute: goldByBuild[buildType]
  }))
}

describe('TTK / TTL / RPM balance simulation', () => {
  it('simulates the difficulty x build x scenario matrix and reports core balance metrics', () => {
    const report = simulateBalanceReport(DEFAULT_BALANCE_DIFFICULTIES, RUNS_PER_POINT)

    expect(report.points).toHaveLength(
      DEFAULT_BALANCE_DIFFICULTIES.length * DEFAULT_BALANCE_BUILDS.length * DEFAULT_BALANCE_SCENARIOS.length
    )
    expect(['pass', 'warn', 'fail']).toContain(report.guardrails.status)
    expect(typeof report.failed).toBe('boolean')

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
      expect(Number.isFinite(point.playerAccuracy)).toBe(true)
      expect(Number.isFinite(point.monsterDodge)).toBe(true)
      expect(Number.isFinite(point.estimatedHitChance)).toBe(true)
      expect(Number.isFinite(point.skillCastsPerMinute)).toBe(true)
      expect(Number.isFinite(point.skillDamageShare)).toBe(true)
      expect(Number.isFinite(point.adjustedGoldPerMinute)).toBe(true)
      expect(Number.isFinite(point.diamondPerMinute)).toBe(true)
      expect(Number.isFinite(point.resourcePowerPerMinute)).toBe(true)
      expect(Number.isFinite(point.thirtyMinutePowerGain)).toBe(true)
      expect(['pass', 'warn', 'fail']).toContain(point.guardrailStatus)
      expect(typeof point.mainFailureReason).toBe('string')
      expect(typeof point.recommendedStat).toBe('string')
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
      expect(point.skillCastsPerMinute).toBeGreaterThanOrEqual(0)
      expect(point.skillDamageShare).toBeGreaterThanOrEqual(0)
      expect(point.skillDamageShare).toBeLessThanOrEqual(1)
      expect(point.resourcePowerPerMinute).toBeGreaterThanOrEqual(0)
    }
  })

  it('includes the speedSkill build with an active skill loop', () => {
    const report = simulateBalanceReport([50], RUNS_PER_POINT, ['speedSkill'], ['normal'])
    const point = report.points[0]

    expect(point.buildType).toBe('speedSkill')
    expect(point.skillCastsPerMinute).toBeGreaterThan(0)
    expect(point.skillDamageShare).toBeGreaterThan(0)
  })

  it('models luck income as adjusted resource growth, not only raw combat gold', () => {
    const report = simulateBalanceReport([50], RUNS_PER_POINT, ['balanced', 'luck'], ['normal'])
    const balanced = report.points.find(point => point.buildType === 'balanced')!
    const luck = report.points.find(point => point.buildType === 'luck')!

    expect(luck.adjustedGoldPerMinute).toBeGreaterThan(balanced.adjustedGoldPerMinute)
    expect(luck.resourcePowerPerMinute).toBeGreaterThanOrEqual(luck.adjustedGoldPerMinute * 0.02)
    expect(luck.thirtyMinutePowerGain).toBeCloseTo(luck.resourcePowerPerMinute * 30, 5)
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
    expect(markdown).toContain('Guardrail Summary')
    expect(markdown).toContain('Findings')
    expect(markdown).toContain('难度 | 构筑 | 场景')
    expect(markdown).toContain('平均TTK')
    expect(markdown).toContain('平均TTL')
    expect(markdown).toContain('金币/分钟')
    expect(markdown).toContain('技能/分钟')
    expect(markdown).toContain('30分钟成长')
    expect(markdown).toContain('主要失败原因')
    expect(markdown).toContain('推荐关注')
    expect(markdown).toContain('Raw Combat Metrics')
  })

  it('flags normal monster TTK that is too long', () => {
    const summary = evaluateBalanceGuardrails([
      createPoint({ battleType: 'normal', averageTTK: 46 })
    ])

    expect(summary.failed).toBe(true)
    expect(summary.findings).toContainEqual(expect.objectContaining({
      status: 'fail',
      reason: 'normal_ttk_too_long',
      recommendedStat: 'attack'
    }))
  })

  it('flags boss win rates that are low across multiple milestones', () => {
    const points = [10, 50, 100, 200].map(difficulty => createPoint({
      difficulty,
      battleType: 'boss',
      buildType: 'tank',
      winRate: 0.3,
      deathRate: 0.7
    }))
    const summary = evaluateBalanceGuardrails(points)

    expect(summary.failed).toBe(true)
    expect(summary.findings).toContainEqual(expect.objectContaining({
      status: 'fail',
      reason: 'boss_win_rate_too_low',
      recommendedStat: 'maxHp',
      buildType: 'tank'
    }))
  })

  it('flags crit builds that bypass high-defense boss checks', () => {
    const summary = evaluateBalanceGuardrails([
      createPoint({ difficulty: 200, battleType: 'highDefenseBoss', buildType: 'crit', winRate: 0.95, averageTTK: 55 }),
      createPoint({ difficulty: 200, battleType: 'highDefenseBoss', buildType: 'armor', winRate: 0.95, averageTTK: 50 })
    ])

    expect(summary.failed).toBe(true)
    expect(summary.findings).toContainEqual(expect.objectContaining({
      status: 'fail',
      reason: 'crit_too_strong_vs_high_defense',
      recommendedStat: 'penetration'
    }))
  })

  it('flags high-dodge bosses that do not require accuracy', () => {
    const summary = evaluateBalanceGuardrails([
      createPoint({
        difficulty: 200,
        battleType: 'highDodgeBoss',
        estimatedHitChance: 0.65,
        winRate: 0.85,
        averageTTK: 80
      })
    ])

    expect(summary.failed).toBe(true)
    expect(summary.findings).toContainEqual(expect.objectContaining({
      status: 'fail',
      reason: 'accuracy_not_required_vs_high_dodge',
      recommendedStat: 'accuracy'
    }))
  })

  it('warns when luck income is outside the intended 10-40 percent premium', () => {
    const summary = evaluateBalanceGuardrails([
      createPoint({ difficulty: 100, battleType: 'normal', buildType: 'balanced', goldPerMinute: 100 }),
      createPoint({ difficulty: 100, battleType: 'normal', buildType: 'luck', goldPerMinute: 180 })
    ])

    expect(summary.status).toBe('warn')
    expect(summary.findings).toContainEqual(expect.objectContaining({
      status: 'warn',
      reason: 'luck_income_out_of_band',
      recommendedStat: 'combatPowerTradeoff',
      buildType: 'luck'
    }))
  })

  it('warns when luck boss performance lacks a combat tradeoff', () => {
    const summary = evaluateBalanceGuardrails([
      createPoint({ difficulty: 100, battleType: 'boss', buildType: 'balanced', winRate: 0.9, averageTTK: 10 }),
      createPoint({ difficulty: 100, battleType: 'boss', buildType: 'crit', winRate: 0.95, averageTTK: 9 }),
      createPoint({ difficulty: 100, battleType: 'boss', buildType: 'luck', winRate: 0.95, averageTTK: 11 })
    ])

    expect(summary.status).toBe('warn')
    expect(summary.findings).toContainEqual(expect.objectContaining({
      status: 'warn',
      reason: 'luck_boss_tradeoff_too_low',
      recommendedStat: 'combatPowerTradeoff',
      buildType: 'luck',
      battleType: 'boss'
    }))
  })

  it('flags luck builds that are also the best combat-income option too often', () => {
    const points = [10, 50, 100, 200].flatMap(difficulty => createScenarioPoints(difficulty, 'normal'))
    const summary = evaluateBalanceGuardrails(points)

    expect(summary.status).toBe('warn')
    expect(summary.findings).toContainEqual(expect.objectContaining({
      status: 'warn',
      reason: 'luck_build_best_combat_income',
      recommendedStat: 'combatPowerTradeoff'
    }))
  })

  it('warns when boss challenge is too low', () => {
    const summary = evaluateBalanceGuardrails([
      createPoint({ difficulty: 100, battleType: 'boss', buildType: 'balanced', winRate: 1, averageTTK: 2.5 })
    ])

    expect(summary.status).toBe('warn')
    expect(summary.findings).toContainEqual(expect.objectContaining({
      status: 'warn',
      reason: 'boss_challenge_too_low',
      recommendedStat: 'defense'
    }))
  })

  it('warns when non-armor builds match armor on high-defense bosses', () => {
    const summary = evaluateBalanceGuardrails([
      createPoint({ difficulty: 200, battleType: 'highDefenseBoss', buildType: 'armor', winRate: 1, averageTTK: 10 }),
      createPoint({ difficulty: 200, battleType: 'highDefenseBoss', buildType: 'balanced', winRate: 1, averageTTK: 11 })
    ])

    expect(summary.status).toBe('warn')
    expect(summary.findings).toContainEqual(expect.objectContaining({
      status: 'warn',
      reason: 'non_armor_too_strong_vs_high_defense',
      recommendedStat: 'penetration'
    }))
  })

  it('warns when speedSkill dominates all boss-like scenarios', () => {
    const points: BalancePointMetrics[] = ['boss', 'highDefenseBoss', 'highDodgeBoss'].flatMap(battleType => [
      createPoint({ difficulty: 200, battleType: battleType as BalanceBattleType, buildType: 'speedSkill', winRate: 1, averageTTK: 4 }),
      createPoint({ difficulty: 200, battleType: battleType as BalanceBattleType, buildType: 'balanced', winRate: 1, averageTTK: 8 }),
      createPoint({ difficulty: 200, battleType: battleType as BalanceBattleType, buildType: 'crit', winRate: 1, averageTTK: battleType === 'highDefenseBoss' ? 10 : 7 }),
      createPoint({ difficulty: 200, battleType: battleType as BalanceBattleType, buildType: 'armor', winRate: 1, averageTTK: 7 })
    ])

    const summary = evaluateBalanceGuardrails(points)

    expect(summary.status).toBe('warn')
    expect(summary.findings).toContainEqual(expect.objectContaining({
      status: 'warn',
      reason: 'speed_skill_dominates_bosses',
      recommendedStat: 'speed'
    }))
  })
})
