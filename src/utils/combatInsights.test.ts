import { describe, expect, it } from 'vitest'
import type { Equipment, Monster, Player, PlayerStats } from '../types'
import { compareEquipmentImpact, estimateCombatKpis, estimateExpectedPlayerHitDamage, getChallengeDecisionHint, getEquipmentDecisionSummary, getGachaDecisionHint, getMainlineGuidance, recommendStatUpgrades } from './combatInsights'

function makeStats(overrides: Partial<PlayerStats> = {}): PlayerStats {
  return {
    size: 1,
    attack: 100,
    defense: 50,
    maxHp: 1000,
    speed: 50,
    critRate: 10,
    critDamage: 150,
    penetration: 0,
    dodge: 0,
    accuracy: 0,
    critResist: 0,
    combo: 100,
    damageReduction: 0,
    attackSpeed: 0,
    cooldownReduction: 0,
    skillDamageBonus: 0,
    damageBonusI: 0,
    damageBonusII: 0,
    damageBonusIII: 0,
    luck: 10,
    lifesteal: 0,
    gravityRange: 0,
    gravityStrength: 0,
    voidDamage: 0,
    trueDamage: 0,
    timeWarp: 0,
    massCollapse: 0,
    dimensionTear: 0,
    fireResist: 0,
    waterResist: 0,
    windResist: 0,
    darkResist: 0,
    ...overrides
  }
}

function makeMonster(overrides: Partial<Monster> = {}): Monster {
  return {
    id: 'm1',
    name: 'Test Monster',
    level: 1,
    phase: 1,
    maxHp: 1000,
    currentHp: 1000,
    attack: 50,
    defense: 50,
    speed: 40,
    critRate: 5,
    critDamage: 150,
    critResist: 0,
    penetration: 0,
    accuracy: 0,
    dodge: 0,
    goldReward: 10,
    expReward: 5,
    equipmentDropChance: 0.3,
    diamondDropChance: 0.01,
    isBoss: false,
    isTrainingMode: false,
    trainingDifficulty: null,
    skills: [],
    status: { marks: [], elemental: [] },
    element: 'none',
    ...overrides
  }
}

function makePlayer(stats: PlayerStats, equipment: Player['equipment'] = {}): Player {
  return {
    id: 'p1',
    name: 'Player',
    level: 1,
    experience: 0,
    currentHp: stats.maxHp,
    maxHp: stats.maxHp,
    stats,
    gold: 0,
    diamond: 0,
    equipment,
    skills: [null, null, null, null, null],
    unlockedPhases: [1],
    totalKillCount: 0,
    totalComboCount: 0,
    maxComboCount: 0,
    totalOnlineTime: 0,
    totalOfflineTime: 0,
    lastLoginTime: 0,
    offlineEfficiencyBonus: 0,
    speedKillCount: 0,
    trainingKillCount: 0,
    checkInStreak: 0,
    lastCheckInTime: 0,
    equipmentTickets: 0,
    materials: 0,
    gachaTickets: 0,
    passiveShards: 0,
    avatarFrames: 0,
    ownedAvatarFrames: [],
    setPieces: 0
  }
}

function makeEquipment(id: string, attack: number): Equipment {
  return {
    id,
    slot: 'weapon',
    name: id,
    rarity: 'common',
    level: 1,
    stats: [{ type: 'attack', value: attack, isPercent: false }],
    isLocked: false,
    affixes: [],
    refiningSlots: [],
    refiningLevel: 0,
    runeSlots: []
  }
}

describe('combatInsights', () => {
  it('estimates visible combat KPIs from current monster and stats', () => {
    const stats = makeStats({ attack: 120, speed: 50 })
    const player = makePlayer(stats)
    const monster = makeMonster({ currentHp: 600, maxHp: 600 })

    const kpis = estimateCombatKpis(player, stats, monster, 50)

    expect(kpis.difficulty).toBe(50)
    expect(kpis.normalTtkSeconds).toBeGreaterThan(0)
    expect(kpis.survivalSeconds).toBeGreaterThan(0)
    expect(kpis.bossSurvivalRate).toBeGreaterThan(0)
  })

  it('shows accuracy and penetration as better expected damage', () => {
    const monster = makeMonster({ defense: 200, dodge: 50 })
    const low = estimateExpectedPlayerHitDamage(makeStats({ accuracy: 0, penetration: 0 }), monster, 100)
    const high = estimateExpectedPlayerHitDamage(makeStats({ accuracy: 50, penetration: 100 }), monster, 100)

    expect(high).toBeGreaterThan(low)
  })

  it('compares equipment by result metrics rather than raw stat text only', () => {
    const weak = makeEquipment('weak', 5)
    const strong = makeEquipment('strong', 50)
    const player = makePlayer(makeStats(), { weapon: weak })

    const rows = compareEquipmentImpact(player, strong, weak)

    expect(rows.find(row => row.label === 'DPS')?.value).toBeGreaterThan(0)
    expect(rows.find(row => row.label === '暴击流评分')?.value).toBeGreaterThan(0)
  })

  it('turns low boss survival into a concrete mainline recommendation', () => {
    const guidance = getMainlineGuidance(
      { difficulty: 24, normalTtkSeconds: 8, survivalSeconds: 6, bossSurvivalRate: 38 },
      { minDifficulty: 30, title: '30 难度：自动构筑与稳定补给' },
      makeStats()
    )

    expect(guidance.severity).toBe('warning')
    expect(guidance.bottleneck).toContain('Boss 生存率仅 38%')
    expect(guidance.recommendedAction).toContain('生命 / 防御')
    expect(guidance.nextGoal).toContain('难度 30')
    expect(guidance.expectedBenefit).toContain('Boss')
  })

  it('guides early players through the first combat and equipment loop', () => {
    const guidance = getMainlineGuidance(
      { difficulty: 3, normalTtkSeconds: 7, survivalSeconds: 90, bossSurvivalRate: 100 },
      { minDifficulty: 10, title: '10-20 分钟：抽卡与修炼' },
      makeStats()
    )

    expect(guidance.severity).toBe('good')
    expect(guidance.bottleneck).toContain('攻击、掉落、装备')
    expect(guidance.recommendedAction).toContain('新装备')
  })

  it('summarizes equipment decisions as result metrics and build scores', () => {
    const summary = getEquipmentDecisionSummary(makeStats({ attack: 200, critRate: 40, critDamage: 220 }))

    expect(summary.dpsProxy).toBeGreaterThan(0)
    expect(summary.survivalProxy).toBeGreaterThan(0)
    expect(summary.goldPerMinuteProxy).toBeGreaterThan(0)
    expect(summary.topBuildScores).toHaveLength(3)
    expect(summary.topBuildScores[0].percent).toBe(100)
  })

  it('recommends stat upgrades by marginal result gain', () => {
    const recommendations = recommendStatUpgrades(
      makeStats({ attack: 100, maxHp: 1000 }),
      ['attack', 'defense', 'maxHp'],
      () => 100,
      stat => stat === 'maxHp' ? 100 : 10,
      () => true
    )

    expect(recommendations.length).toBe(3)
    expect(recommendations[0].score).toBeGreaterThanOrEqual(recommendations[1].score)
    expect(recommendations[0].reason).toContain('单位金币效率')
  })

  it('explains challenge failures and recommended builds', () => {
    const hint = getChallengeDecisionHint(
      { difficulty: 100, normalTtkSeconds: 10, survivalSeconds: 5, bossSurvivalRate: 30 },
      '暴击流'
    )

    expect(hint.severity).toBe('danger')
    expect(hint.failureReason).toContain('Boss 生存率偏低')
    expect(hint.recommendedBuild).toBe('吸血坦克流')
  })

  it('explains gacha pity, free pull, and archetype impact', () => {
    const hint = getGachaDecisionHint('限定奖池·深渊征服者', { current: 82, target: 90, bonus: true }, true)

    expect(hint.pityText).toContain('软保底')
    expect(hint.freeText).toContain('免费抽可用')
    expect(hint.targetText).toContain('破甲真伤流')
    expect(hint.archetypeBoosts[0].archetype).toBe('破甲真伤流')
  })
})
