import type { Monster, Player, PlayerStats } from '../../types'
import { createDefaultPlayer, calculateMonsterDamageResult, calculatePlayerDamageResult, calculateLifestealCap, calculateLifesteal } from '../../utils/calc'
import { generateMonster } from '../../utils/monsterGenerator'

export type BalanceBattleType = 'normal' | 'boss' | 'highDefenseBoss' | 'highDodgeBoss'
export type BalanceBuildType = 'balanced' | 'crit' | 'tank' | 'armor' | 'luck'

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
}

export interface BalanceSimulationReport {
  points: BalancePointMetrics[]
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
      const damageResult = calculatePlayerDamageResult(player, stats, monster, false, 0, 0, 0, 0, difficulty, rng)
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

      const damageResult = calculateMonsterDamageResult(monster, player, stats, difficulty, rng)
      let incomingDamage = damageResult.amount
      if (
        mechanic?.id === 'enrage' &&
        state &&
        elapsed * 1000 >= (mechanic.enrageAfterMs ?? 30_000)
      ) {
        state.enraged = true
        incomingDamage = Math.floor(incomingDamage * (mechanic.enrageAttackMultiplier ?? 2))
      }
      playerHp -= incomingDamage
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
    equipmentPerMinute: minutes > 0 ? totalEquipmentDrops / minutes : 0
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
  return { points }
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
    equipmentPerMinute: Number(metrics.equipmentPerMinute.toFixed(2))
  }
}

export function formatBalanceReportMarkdown(report: BalanceSimulationReport): string {
  const header = '| 难度 | 构筑 | 场景 | 怪物HP | 怪物攻击 | 怪物防御 | 玩家DPS | 胜率 | TTK | 死亡率 | 金币/分钟 | 装备/分钟 |'
  const separator = '|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|'
  const rows = report.points.map(point => [
    point.difficulty,
    point.buildType,
    point.battleType,
    point.monsterHp,
    point.monsterAttack,
    point.monsterDefense,
    point.playerDps.toFixed(1),
    `${(point.winRate * 100).toFixed(1)}%`,
    `${point.averageTTK.toFixed(1)}s`,
    `${(point.deathRate * 100).toFixed(1)}%`,
    Math.round(point.goldPerMinute),
    point.equipmentPerMinute.toFixed(2)
  ].join(' | ')).map(row => `| ${row} |`)

  return [
    '# Balance Report',
    '',
    `Generated from source formulas. Points: ${report.points.length}`,
    '',
    header,
    separator,
    ...rows,
    ''
  ].join('\n')
}
