import { describe, expect, it } from 'vitest'
import type { Monster, Player, PlayerStats } from '../../../types'
import { applyDamageToMonster, calculatePlayerDamageFromSource, type CombatContext, type DamagePostMultiplier, type DamageSource } from '../damage'

function makeRng(values: number[]): () => number {
  let index = 0
  return () => values[index++] ?? values[values.length - 1] ?? 0.99
}

function makeStats(overrides: Partial<PlayerStats> = {}): PlayerStats {
  return {
    size: 1,
    attack: 100,
    defense: 20,
    maxHp: 1000,
    speed: 10,
    critRate: 0,
    critDamage: 200,
    penetration: 0,
    dodge: 0,
    accuracy: 100,
    critResist: 0,
    combo: 100,
    damageReduction: 0,
    attackSpeed: 0,
    cooldownReduction: 0,
    skillDamageBonus: 0,
    damageBonusI: 0,
    damageBonusII: 0,
    damageBonusIII: 0,
    luck: 0,
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

function makePlayer(stats = makeStats()): Player {
  return {
    id: 'p',
    name: 'P',
    level: 1,
    experience: 0,
    currentHp: stats.maxHp,
    maxHp: stats.maxHp,
    stats,
    gold: 0,
    diamond: 0,
    equipment: {},
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

function makeMonster(overrides: Partial<Monster> = {}): Monster {
  return {
    id: 'm',
    name: 'M',
    level: 1,
    phase: 1,
    maxHp: 1000,
    currentHp: 1000,
    attack: 10,
    defense: 0,
    speed: 10,
    critRate: 0,
    critDamage: 150,
    critResist: 0,
    penetration: 0,
    accuracy: 0,
    dodge: 0,
    goldReward: 0,
    expReward: 0,
    equipmentDropChance: 0,
    diamondDropChance: 0,
    isBoss: false,
    isTrainingMode: false,
    trainingDifficulty: null,
    skills: [],
    status: { marks: [], elemental: [] },
    element: 'none',
    ...overrides
  }
}

function run(source: DamageSource, monster = makeMonster(), stats = makeStats(), postMultipliers: DamagePostMultiplier[] = []) {
  const context: CombatContext = { difficulty: 0, rng: makeRng([0.01, 0.99, 0.01, 0.99, 0.01, 0.99]) }
  return calculatePlayerDamageFromSource({ player: makePlayer(stats), totalStats: stats, monster, source, context, postMultipliers })
}

describe('combat damage engine', () => {
  it('applies 3x skill multiplier inside the damage chain', () => {
    const result = run({ type: 'skill', name: '三倍技能', baseMultiplier: 3, hitCount: 1, canCrit: true })

    expect(result.amount).toBe(300)
    expect(result.steps.some(step => step.label === '基础倍率' && step.value.includes('×3'))).toBe(true)
  })

  it('applies 8x total multiplier through 4x times 2 hit skill', () => {
    const result = run({ type: 'skill', name: '八倍技能', baseMultiplier: 4, hitCount: 2, canCrit: true })

    expect(result.amount).toBe(800)
    expect(result.hits).toHaveLength(2)
    expect(result.steps.some(step => step.label === '命中' && step.value.includes('2/2'))).toBe(true)
  })

  it('honors partial and full defense ignore percentages', () => {
    const monster = makeMonster({ defense: 1000 })
    const base = run({ type: 'skill', name: '无穿透', baseMultiplier: 3, defenseIgnorePercent: 0 }, monster).amount
    const half = run({ type: 'skill', name: '半穿透', baseMultiplier: 3, defenseIgnorePercent: 50 }, monster).amount
    const full = run({ type: 'skill', name: '全穿透', baseMultiplier: 3, defenseIgnorePercent: 100 }, monster).amount

    expect(half).toBeGreaterThan(base)
    expect(full).toBeGreaterThan(half)
    expect(full).toBe(300)
  })

  it('treats ignoreDefense as full defense ignore', () => {
    const result = run({ type: 'skill', name: '无视防御', baseMultiplier: 3, ignoreDefense: true, defenseIgnorePercent: 0 }, makeMonster({ defense: 1000 }))

    expect(result.amount).toBe(300)
  })

  it('uses the shared crit chain for detonations', () => {
    const stats = makeStats({ critRate: 100, critDamage: 200 })
    const context: CombatContext = { difficulty: 0, rng: makeRng([0.01, 0.01]) }
    const result = calculatePlayerDamageFromSource({
      player: makePlayer(stats),
      totalStats: stats,
      monster: makeMonster(),
      source: { type: 'detonate', name: '引爆', baseMultiplier: 6, canCrit: true },
      context
    })

    expect(result.amount).toBe(1200)
    expect(result.crit).toBe(true)
    expect(result.steps.some(step => step.label === '来源' && step.value === '引爆')).toBe(true)
  })

  it('can disable crit for dot sources', () => {
    const stats = makeStats({ critRate: 100, critDamage: 300 })
    const result = run({ type: 'dot', name: '流血', baseMultiplier: 1 }, makeMonster(), stats)

    expect(result.crit).toBe(false)
    expect(result.amount).toBe(100)
  })

  it('records post multipliers in damage explanation', () => {
    const result = run(
      { type: 'boss', name: 'Boss攻击', baseMultiplier: 1 },
      makeMonster(),
      makeStats(),
      [{ label: '狂暴倍率', multiplier: 2 }, { label: 'Boss技能倍率', multiplier: 1.5 }]
    )

    expect(result.amount).toBe(300)
    expect(result.postMultipliers).toHaveLength(2)
    expect(result.steps.some(step => step.label === '狂暴倍率')).toBe(true)
    expect(result.steps.some(step => step.label === 'Boss技能倍率')).toBe(true)
  })

  it('applies shield before hp damage', () => {
    const monster = makeMonster({ currentHp: 1000, bossState: { shield: 100, enraged: false, healedOnce: false, turnCounter: 0, spawnedAt: Date.now() } })

    const result = applyDamageToMonster({ monster, damage: 250 })

    expect(result.shieldDamage).toBe(100)
    expect(result.hpDamage).toBe(150)
    expect(monster.currentHp).toBe(850)
  })
})
