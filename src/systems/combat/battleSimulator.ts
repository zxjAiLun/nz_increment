import type { Monster, Player, PlayerStats } from '../../types'
import { createDefaultPlayer, calculateLifestealCap, calculateLifesteal } from '../../utils/calc'
import { calculateMonsterDamageFromSource, calculatePlayerDamageFromSource, type CombatContext, type DamagePostMultiplier, type DamageSource } from './damage'
import { generateMonster } from '../../utils/monsterGenerator'

export type BalanceBattleType = 'normal' | 'boss' | 'highDefenseBoss' | 'highDodgeBoss'
export type BalanceBuildType = 'balanced' | 'crit' | 'tank' | 'armor' | 'luck'
export type BalanceGuardrailStatus = 'pass' | 'warn' | 'fail'

export type BalanceFailureReason =
  | 'none'
  | 'normal_ttk_too_long'
  | 'boss_win_rate_too_low'
  | 'crit_too_strong_vs_high_defense'
  | 'accuracy_not_required_vs_high_dodge'
  | 'luck_build_best_combat_income'

export type RecommendedStat =
  | 'none'
  | 'attack'
  | 'critRate'
  | 'critDamage'
  | 'speed'
  | 'maxHp'
  | 'defense'
  | 'lifesteal'
  | 'penetration'
  | 'trueDamage'
  | 'voidDamage'
  | 'accuracy'
  | 'luckRewardScaling'
  | 'combatPowerTradeoff'

export interface BalanceGuardrailFinding {
  status: BalanceGuardrailStatus
  reason: BalanceFailureReason
  recommendedStat: RecommendedStat
  message: string
  difficulty?: number
  buildType?: BalanceBuildType
  battleType?: BalanceBattleType
}

export interface BalanceGuardrailSummary {
  status: BalanceGuardrailStatus
  failed: boolean
  failCount: number
  warnCount: number
  findings: BalanceGuardrailFinding[]
}

export interface BalancePointMetrics {
  difficulty: number
  battleType: BalanceBattleType
  buildType: BalanceBuildType
  runs: number
  monsterHp: number
  monsterAttack: number
  monsterDefense: number
  playerDps: number
  winRate: number
  averageTTK: number
  averageTTL: number
  averageRemainingHp: number
  deathRate: number
  goldPerMinute: number
  equipmentPerMinute: number
  guardrailStatus: BalanceGuardrailStatus
  mainFailureReason: BalanceFailureReason
  recommendedStat: RecommendedStat
  playerAccuracy: number
  monsterDodge: number
  estimatedHitChance: number
}

export interface BalanceSimulationReport {
  points: BalancePointMetrics[]
  guardrails: BalanceGuardrailSummary
  failed: boolean
}

interface SimulatedBattleResult {
  killed: boolean
  duration: number
  gold: number
  equipmentDrops: number
  remainingHp: number
  playerDamage: number
}

const SIM_TICK_SECONDS = 0.1
const GAUGE_MAX = 100
const GAUGE_TICK_RATE = 10
const MAX_BATTLE_SECONDS = 240
export const DEFAULT_BALANCE_DIFFICULTIES = [10, 50, 100, 200, 500, 1000]
export const DEFAULT_BALANCE_BUILDS: BalanceBuildType[] = ['balanced', 'crit', 'tank', 'armor', 'luck']
export const DEFAULT_BALANCE_SCENARIOS: BalanceBattleType[] = ['normal', 'boss', 'highDefenseBoss', 'highDodgeBoss']

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function estimateHitChance(attackerAccuracy: number, defenderDodge: number): number {
  return clamp(0.85 + attackerAccuracy * 0.005 - defenderDodge * 0.005, 0.05, 0.95)
}

function createGuardrailSummary(findings: BalanceGuardrailFinding[]): BalanceGuardrailSummary {
  const failCount = findings.filter(finding => finding.status === 'fail').length
  const warnCount = findings.filter(finding => finding.status === 'warn').length
  const status: BalanceGuardrailStatus = failCount > 0 ? 'fail' : warnCount > 0 ? 'warn' : 'pass'
  return {
    status,
    failed: failCount > 0,
    failCount,
    warnCount,
    findings
  }
}

function isFindingMoreSevere(next: BalanceGuardrailStatus, current: BalanceGuardrailStatus): boolean {
  const severity: Record<BalanceGuardrailStatus, number> = { pass: 0, warn: 1, fail: 2 }
  return severity[next] > severity[current]
}

function pointKey(point: Pick<BalancePointMetrics, 'difficulty' | 'buildType' | 'battleType'>): string {
  return `${point.difficulty}:${point.buildType}:${point.battleType}`
}

export function createSeededRng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (1664525 * state + 1013904223) >>> 0
    return state / 0x100000000
  }
}

export function createBalancePlayerStats(difficulty: number, buildType: BalanceBuildType = 'balanced'): PlayerStats {
  const growth = Math.pow(1.75, difficulty / 50)
  const stats: PlayerStats = {
    size: 1,
    attack: Math.floor(28 * growth),
    defense: Math.floor(8 * Math.pow(1.9, difficulty / 50)),
    maxHp: Math.floor(120 * Math.pow(1.95, difficulty / 50)),
    speed: Math.floor(Math.min(95, 34 + Math.sqrt(Math.max(1, difficulty)) * 2)),
    critRate: Math.min(80, 5 + difficulty * 0.05),
    critDamage: Math.min(300, 150 + difficulty * 0.08),
    penetration: Math.floor(4 * growth),
    dodge: Math.min(45, difficulty * 0.03),
    accuracy: Math.min(80, 8 + difficulty * 0.05),
    critResist: Math.min(50, difficulty * 0.02),
    combo: 100,
    damageReduction: 0,
    attackSpeed: 0,
    cooldownReduction: Math.min(40, difficulty * 0.02),
    skillDamageBonus: Math.min(150, difficulty * 0.05),
    damageBonusI: Math.min(120, difficulty * 0.04),
    damageBonusII: Math.min(120, difficulty * 0.02),
    damageBonusIII: Math.min(120, difficulty * 0.01),
    luck: Math.min(500, 10 + difficulty * 0.1),
    lifesteal: Math.min(15, difficulty * 0.01),
    gravityRange: 0,
    gravityStrength: 0,
    voidDamage: Math.floor(growth * 2),
    trueDamage: Math.floor(growth * 2),
    timeWarp: 0,
    massCollapse: 0,
    dimensionTear: 0,
    fireResist: 0,
    waterResist: 0,
    windResist: 0,
    darkResist: 0
  }

  if (buildType === 'crit') {
    stats.attack = Math.floor(stats.attack * 1.18)
    stats.critRate = Math.min(80, stats.critRate + 25)
    stats.critDamage = Math.min(420, stats.critDamage + 90)
    stats.defense = Math.floor(stats.defense * 0.82)
    stats.maxHp = Math.floor(stats.maxHp * 0.9)
  } else if (buildType === 'tank') {
    stats.attack = Math.floor(stats.attack * 0.78)
    stats.defense = Math.floor(stats.defense * 1.6)
    stats.maxHp = Math.floor(stats.maxHp * 1.75)
    stats.lifesteal = Math.min(15, stats.lifesteal + 8)
  } else if (buildType === 'armor') {
    stats.attack = Math.floor(stats.attack * 0.9)
    stats.penetration = Math.floor(stats.penetration * 2.8 + difficulty * 0.15)
    stats.trueDamage = Math.floor(stats.trueDamage * 4 + growth * 5)
    stats.voidDamage = Math.floor(stats.voidDamage * 4 + growth * 5)
  } else if (buildType === 'luck') {
    stats.attack = Math.floor(stats.attack * 0.72)
    stats.defense = Math.floor(stats.defense * 0.82)
    stats.maxHp = Math.floor(stats.maxHp * 0.9)
    stats.speed = Math.floor(stats.speed * 1.08)
    stats.luck = Math.min(800, stats.luck * 3 + 80)
  }

  return stats
}

function createSimPlayer(stats: PlayerStats): Player {
  const player = createDefaultPlayer()
  player.stats = stats
  player.maxHp = stats.maxHp
  player.currentHp = stats.maxHp
  return player
}

function getScenarioLevel(difficulty: number, battleType: BalanceBattleType): number {
  if (battleType === 'normal') return Math.max(1, Math.floor(difficulty / 10) * 10 + 1)
  return Math.max(10, Math.floor(difficulty / 10) * 10 || 10)
}

function generateBalanceMonster(difficulty: number, battleType: BalanceBattleType, rng: () => number): Monster {
  const monster = generateMonster(difficulty, getScenarioLevel(difficulty, battleType), rng)
  if (battleType === 'highDefenseBoss') {
    monster.isBoss = true
    monster.name = `${monster.name} · 高护甲`
    monster.defense = Math.floor(monster.defense * 3.2 + difficulty * 0.8)
    monster.maxHp = Math.floor(monster.maxHp * 1.25)
    monster.currentHp = monster.maxHp
    monster.dodge = Math.max(0, monster.dodge * 0.6)
  } else if (battleType === 'highDodgeBoss') {
    monster.isBoss = true
    monster.name = `${monster.name} · 高闪避`
    monster.dodge = Math.min(85, monster.dodge + 35)
    monster.accuracy = Math.min(100, monster.accuracy + 10)
    monster.maxHp = Math.floor(monster.maxHp * 0.9)
    monster.currentHp = monster.maxHp
  }
  return monster
}

function applyPlayerDamageToMonster(monster: Monster, damage: number): void {
  let remainingDamage = damage

  if (monster.bossState && monster.bossState.shield > 0) {
    const shieldDamage = Math.min(remainingDamage, monster.bossState.shield)
    monster.bossState.shield -= shieldDamage
    remainingDamage -= shieldDamage
  }

  monster.currentHp -= remainingDamage

  const mechanic = monster.bossMechanic
  const state = monster.bossState
  if (
    mechanic?.id === 'lifesteal' &&
    state &&
    !state.healedOnce &&
    monster.currentHp > 0 &&
    monster.currentHp <= monster.maxHp * (mechanic.healThreshold ?? 0)
  ) {
    const healed = Math.floor(monster.maxHp * (mechanic.healPercent ?? 0))
    monster.currentHp = Math.min(monster.maxHp, monster.currentHp + healed)
    state.healedOnce = true
  }
}

export function simulateBattle(
  difficulty: number,
  battleType: BalanceBattleType,
  seed: number,
  buildType: BalanceBuildType = 'balanced'
): SimulatedBattleResult {
  const rng = createSeededRng(seed)
  const stats = createBalancePlayerStats(difficulty, buildType)
  const player = createSimPlayer(stats)
  const monster = generateBalanceMonster(difficulty, battleType, rng)
  let playerHp = stats.maxHp
  let playerGauge = 0
  let monsterGauge = 0
  let elapsed = 0
  let equipmentDrops = 0
  let playerDamage = 0

  while (elapsed < MAX_BATTLE_SECONDS && playerHp > 0 && monster.currentHp > 0) {
    elapsed += SIM_TICK_SECONDS
    playerGauge += stats.speed * GAUGE_TICK_RATE / 100
    monsterGauge += monster.speed * GAUGE_TICK_RATE / 100

    if (playerGauge >= GAUGE_MAX) {
      playerGauge -= GAUGE_MAX
      const context: CombatContext = { difficulty, rng }
      const source: DamageSource = { type: 'basic', name: '模拟普攻', baseMultiplier: 1, hitCount: 1, canCrit: true }
      const damageResult = calculatePlayerDamageFromSource({ player, totalStats: stats, monster, source, context })
      if (damageResult.hit && damageResult.amount > 0) {
        applyPlayerDamageToMonster(monster, damageResult.amount)
        playerDamage += damageResult.amount
        const lifestealRate = calculateLifestealCap(stats.lifesteal)
        if (lifestealRate > 0) playerHp = Math.min(stats.maxHp, playerHp + calculateLifesteal(damageResult.amount, lifestealRate))
      }
    }

    if (monster.currentHp <= 0) break

    if (monsterGauge >= GAUGE_MAX) {
      monsterGauge -= GAUGE_MAX
      const mechanic = monster.bossMechanic
      const state = monster.bossState
      if (mechanic?.id === 'shield' && state) {
        state.turnCounter++
        if (state.turnCounter % (mechanic.shieldIntervalTurns ?? 4) === 0) {
          state.shield += Math.floor(monster.maxHp * (mechanic.shieldPercent ?? 0))
        }
      }

      const context: CombatContext = { difficulty, rng }
      const source: DamageSource = { type: monster.isBoss ? 'boss' : 'basic', name: `${monster.name} 攻击`, baseMultiplier: 1, hitCount: 1, canCrit: true }
      const postMultipliers: DamagePostMultiplier[] = []
      if (
        mechanic?.id === 'enrage' &&
        state &&
        elapsed * 1000 >= (mechanic.enrageAfterMs ?? 30_000)
      ) {
        state.enraged = true
        postMultipliers.push({ label: '狂暴倍率', multiplier: mechanic.enrageAttackMultiplier ?? 2 })
      }
      const damageResult = calculateMonsterDamageFromSource({ monster, player, totalStats: stats, source, context, postMultipliers })
      playerHp -= damageResult.amount
    }
  }

  const killed = monster.currentHp <= 0
  if (killed && rng() < monster.equipmentDropChance) equipmentDrops = 1

  return {
    killed,
    duration: elapsed,
    gold: killed ? monster.goldReward : 0,
    equipmentDrops,
    remainingHp: Math.max(0, playerHp),
    playerDamage
  }
}

function getMonsterSnapshot(difficulty: number, battleType: BalanceBattleType): Monster {
  return generateBalanceMonster(difficulty, battleType, createSeededRng(difficulty * 999 + getScenarioLevel(difficulty, battleType)))
}

export function simulateBalancePoint(
  difficulty: number,
  battleType: BalanceBattleType,
  runs = 1000,
  buildType: BalanceBuildType = 'balanced'
): BalancePointMetrics {
  let totalDuration = 0
  let totalKillDuration = 0
  let killCount = 0
  let totalGold = 0
  let totalEquipmentDrops = 0
  let totalRemainingHp = 0
  let totalPlayerDamage = 0

  for (let i = 0; i < runs; i++) {
    const battleSeed = difficulty * 1_000_000
      + DEFAULT_BALANCE_SCENARIOS.indexOf(battleType) * 100_000
      + DEFAULT_BALANCE_BUILDS.indexOf(buildType) * 10_000
      + i
    const result = simulateBattle(difficulty, battleType, battleSeed, buildType)
    totalDuration += result.duration
    totalRemainingHp += result.remainingHp
    totalPlayerDamage += result.playerDamage
    if (result.killed) {
      killCount++
      totalKillDuration += result.duration
    }
    totalGold += result.gold
    totalEquipmentDrops += result.equipmentDrops
  }

  const minutes = totalDuration / 60
  const monster = getMonsterSnapshot(difficulty, battleType)
  const stats = createBalancePlayerStats(difficulty, buildType)
  return {
    difficulty,
    battleType,
    buildType,
    runs,
    monsterHp: monster.maxHp,
    monsterAttack: monster.attack,
    monsterDefense: monster.defense,
    playerDps: totalDuration > 0 ? totalPlayerDamage / totalDuration : 0,
    winRate: killCount / runs,
    averageTTK: killCount > 0 ? totalKillDuration / killCount : MAX_BATTLE_SECONDS,
    averageTTL: totalDuration / runs,
    averageRemainingHp: totalRemainingHp / runs,
    deathRate: 1 - killCount / runs,
    goldPerMinute: minutes > 0 ? totalGold / minutes : 0,
    equipmentPerMinute: minutes > 0 ? totalEquipmentDrops / minutes : 0,
    guardrailStatus: 'pass',
    mainFailureReason: 'none',
    recommendedStat: 'none',
    playerAccuracy: stats.accuracy,
    monsterDodge: monster.dodge,
    estimatedHitChance: estimateHitChance(stats.accuracy, monster.dodge)
  }
}

export function evaluateBalanceGuardrails(points: BalancePointMetrics[]): BalanceGuardrailSummary {
  const findings: BalanceGuardrailFinding[] = []

  for (const point of points) {
    if (point.battleType === 'normal' && point.averageTTK > 35) {
      findings.push({
        status: point.averageTTK > 45 ? 'fail' : 'warn',
        reason: 'normal_ttk_too_long',
        recommendedStat: 'attack',
        message: '普通怪平均击杀时间过长，基础推进节奏可能卡顿；优先检查攻击、暴击、速度成长。',
        difficulty: point.difficulty,
        buildType: point.buildType,
        battleType: point.battleType
      })
    }

    if (point.battleType === 'boss' && point.winRate < 0.25) {
      findings.push({
        status: 'warn',
        reason: 'boss_win_rate_too_low',
        recommendedStat: 'maxHp',
        message: 'Boss 单点胜率偏低，可能需要检查生命、防御、吸血或 Boss 攻击成长。',
        difficulty: point.difficulty,
        buildType: point.buildType,
        battleType: point.battleType
      })
    }

    if (
      point.battleType === 'highDodgeBoss' &&
      point.difficulty >= 100 &&
      point.estimatedHitChance < 0.7 &&
      point.winRate >= 0.8 &&
      point.averageTTK <= 120
    ) {
      findings.push({
        status: 'fail',
        reason: 'accuracy_not_required_vs_high_dodge',
        recommendedStat: 'accuracy',
        message: '高闪避 Boss 在低命中条件下仍然容易通过，命中属性价值不足。',
        difficulty: point.difficulty,
        buildType: point.buildType,
        battleType: point.battleType
      })
    }
  }

  for (const buildType of DEFAULT_BALANCE_BUILDS) {
    const bossPoints = points.filter(point => point.battleType === 'boss' && point.buildType === buildType)
    const belowSoftFloor = bossPoints.filter(point => point.winRate < 0.35)
    const belowHardFloor = bossPoints.filter(point => point.winRate < 0.2)
    if (belowSoftFloor.length >= 4 || belowHardFloor.length >= 3) {
      for (const point of belowSoftFloor) {
        findings.push({
          status: 'fail',
          reason: 'boss_win_rate_too_low',
          recommendedStat: 'maxHp',
          message: 'Boss 胜率在多个难度段持续偏低，可能需要检查生命、防御、吸血或 Boss 攻击成长。',
          difficulty: point.difficulty,
          buildType,
          battleType: 'boss'
        })
      }
    }
  }

  const difficulties = [...new Set(points.map(point => point.difficulty))]
  for (const difficulty of difficulties) {
    const highDefensePoints = points.filter(point => point.difficulty === difficulty && point.battleType === 'highDefenseBoss')
    const crit = highDefensePoints.find(point => point.buildType === 'crit')
    const armor = highDefensePoints.find(point => point.buildType === 'armor')
    if (difficulty >= 100 && crit && armor && crit.winRate >= 0.9 && crit.averageTTK <= armor.averageTTK * 1.1) {
      findings.push({
        status: 'fail',
        reason: 'crit_too_strong_vs_high_defense',
        recommendedStat: 'penetration',
        message: '高防 Boss 未有效压制暴击流，破甲/真伤构筑优势不明显。',
        difficulty,
        buildType: 'crit',
        battleType: 'highDefenseBoss'
      })
    }
  }

  const luckBestCombatIncomeCells: BalancePointMetrics[] = []
  for (const difficulty of difficulties) {
    for (const battleType of DEFAULT_BALANCE_SCENARIOS) {
      const scenarioPoints = points.filter(point => point.difficulty === difficulty && point.battleType === battleType)
      const luck = scenarioPoints.find(point => point.buildType === 'luck')
      if (!luck || scenarioPoints.length === 0) continue
      const maxGoldPerMinute = Math.max(...scenarioPoints.map(point => point.goldPerMinute))
      const maxWinRate = Math.max(...scenarioPoints.map(point => point.winRate))
      const bestAverageTTK = Math.min(...scenarioPoints.map(point => point.averageTTK))
      if (
        luck.goldPerMinute === maxGoldPerMinute &&
        luck.winRate >= maxWinRate - 0.05 &&
        luck.averageTTK <= bestAverageTTK * 1.15
      ) {
        luckBestCombatIncomeCells.push(luck)
      }
    }
  }

  if (luckBestCombatIncomeCells.length >= 4) {
    const status: BalanceGuardrailStatus = luckBestCombatIncomeCells.length >= 8 ? 'fail' : 'warn'
    for (const point of luckBestCombatIncomeCells) {
      findings.push({
        status,
        reason: 'luck_build_best_combat_income',
        recommendedStat: 'combatPowerTradeoff',
        message: '幸运流在过多场景中同时拥有最高收益和接近最优战斗效率，可能缺少战斗能力代价。',
        difficulty: point.difficulty,
        buildType: 'luck',
        battleType: point.battleType
      })
    }
  }

  return createGuardrailSummary(findings)
}

function applyGuardrailFindings(points: BalancePointMetrics[], findings: BalanceGuardrailFinding[]): void {
  const pointsByKey = new Map(points.map(point => [pointKey(point), point]))
  for (const finding of findings) {
    if (finding.difficulty === undefined || !finding.buildType || !finding.battleType) continue
    const point = pointsByKey.get(pointKey({ difficulty: finding.difficulty, buildType: finding.buildType, battleType: finding.battleType }))
    if (!point) continue
    if (isFindingMoreSevere(finding.status, point.guardrailStatus)) point.guardrailStatus = finding.status
    if (point.mainFailureReason === 'none' || finding.status === 'fail') {
      point.mainFailureReason = finding.reason
      point.recommendedStat = finding.recommendedStat
    }
  }
}

export function simulateBalanceReport(
  difficulties = DEFAULT_BALANCE_DIFFICULTIES,
  runs = 1000,
  buildTypes: BalanceBuildType[] = DEFAULT_BALANCE_BUILDS,
  battleTypes: BalanceBattleType[] = DEFAULT_BALANCE_SCENARIOS
): BalanceSimulationReport {
  const points = difficulties.flatMap(difficulty =>
    buildTypes.flatMap(buildType =>
      battleTypes.map(battleType => simulateBalancePoint(difficulty, battleType, runs, buildType))
    )
  )
  const guardrails = evaluateBalanceGuardrails(points)
  applyGuardrailFindings(points, guardrails.findings)
  return { points, guardrails, failed: guardrails.failed }
}

export function formatBalanceMetricsForLog(metrics: BalancePointMetrics): Record<string, string | number> {
  return {
    difficulty: metrics.difficulty,
    build: metrics.buildType,
    scenario: metrics.battleType,
    runs: metrics.runs,
    monsterHp: metrics.monsterHp,
    monsterAttack: metrics.monsterAttack,
    monsterDefense: metrics.monsterDefense,
    playerDps: Number(metrics.playerDps.toFixed(1)),
    winRate: `${(metrics.winRate * 100).toFixed(1)}%`,
    avgTTK: `${metrics.averageTTK.toFixed(1)}s`,
    avgTTL: `${metrics.averageTTL.toFixed(1)}s`,
    avgRemainingHp: Math.round(metrics.averageRemainingHp),
    deathRate: `${(metrics.deathRate * 100).toFixed(1)}%`,
    goldPerMinute: Math.round(metrics.goldPerMinute),
    equipmentPerMinute: Number(metrics.equipmentPerMinute.toFixed(2)),
    status: metrics.guardrailStatus,
    mainFailureReason: metrics.mainFailureReason,
    recommendedStat: metrics.recommendedStat
  }
}

export function formatBalanceReportMarkdown(report: BalanceSimulationReport): string {
  const summary = report.guardrails
  const header = '| 难度 | 构筑 | 场景 | 状态 | 胜率 | 平均TTK | 平均TTL | 死亡率 | 金币/分钟 | 装备/分钟 | 主要失败原因 | 推荐关注 |'
  const separator = '|---:|---|---|---|---:|---:|---:|---:|---:|---:|---|---|'
  const rows = report.points.map(point => [
    point.difficulty,
    point.buildType,
    point.battleType,
    point.guardrailStatus,
    `${(point.winRate * 100).toFixed(1)}%`,
    `${point.averageTTK.toFixed(1)}s`,
    `${point.averageTTL.toFixed(1)}s`,
    `${(point.deathRate * 100).toFixed(1)}%`,
    Math.round(point.goldPerMinute),
    point.equipmentPerMinute.toFixed(2),
    point.mainFailureReason,
    point.recommendedStat
  ].join(' | ')).map(row => `| ${row} |`)

  const findingHeader = '| 状态 | 原因 | 推荐关注 | 难度 | 构筑 | 场景 | 说明 |'
  const findingSeparator = '|---|---|---|---:|---|---|---|'
  const findingRows = summary.findings.map(finding => [
    finding.status,
    finding.reason,
    finding.recommendedStat,
    finding.difficulty ?? '-',
    finding.buildType ?? '-',
    finding.battleType ?? '-',
    finding.message
  ].join(' | ')).map(row => `| ${row} |`)

  const rawHeader = '| 难度 | 构筑 | 场景 | 怪物HP | 怪物攻击 | 怪物防御 | 玩家DPS |'
  const rawSeparator = '|---:|---|---|---:|---:|---:|---:|'
  const rawRows = report.points.map(point => [
    point.difficulty,
    point.buildType,
    point.battleType,
    point.monsterHp,
    point.monsterAttack,
    point.monsterDefense,
    point.playerDps.toFixed(1)
  ].join(' | ')).map(row => `| ${row} |`)

  return [
    '# Balance Report',
    '',
    `Generated from source formulas. Points: ${report.points.length}`,
    '',
    '## Guardrail Summary',
    '',
    `- Status: ${summary.status}`,
    `- Failed: ${summary.failed}`,
    `- Fails: ${summary.failCount}`,
    `- Warnings: ${summary.warnCount}`,
    '',
    '## Findings',
    '',
    findingHeader,
    findingSeparator,
    ...(findingRows.length > 0 ? findingRows : ['| pass | none | none | - | - | - | No guardrail findings. |']),
    '',
    '## Balance Matrix',
    '',
    header,
    separator,
    ...rows,
    '',
    '## Raw Combat Metrics',
    '',
    rawHeader,
    rawSeparator,
    ...rawRows,
    ''
  ].join('\n')
}
