import { describe, expect, it } from 'vitest'
import type { PlayerStats } from '../types'
import { calculateBuildArchetypeScores, getDominantBuildArchetype } from './buildArchetypes'

function makeStats(overrides: Partial<PlayerStats> = {}): PlayerStats {
  return {
    size: 1,
    attack: 100,
    defense: 50,
    maxHp: 1000,
    speed: 50,
    critRate: 5,
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

describe('buildArchetypes', () => {
  it('detects crit burst from crit and attack stats', () => {
    const dominant = getDominantBuildArchetype(makeStats({ attack: 300, critRate: 60, critDamage: 280 }))
    expect(dominant.archetype.id).toBe('critBurst')
  })

  it('detects lifesteal tank from hp defense and lifesteal', () => {
    const dominant = getDominantBuildArchetype(makeStats({ maxHp: 8000, defense: 800, lifesteal: 15 }))
    expect(dominant.archetype.id).toBe('lifestealTank')
  })

  it('detects armor true damage from penetration and special damage', () => {
    const dominant = getDominantBuildArchetype(makeStats({ penetration: 500, trueDamage: 300, voidDamage: 300 }))
    expect(dominant.archetype.id).toBe('armorTrueDamage')
  })

  it('returns five sorted archetype scores with top at 100 percent', () => {
    const scores = calculateBuildArchetypeScores(makeStats({ luck: 500 }))
    expect(scores).toHaveLength(5)
    expect(scores[0].percent).toBe(100)
    expect(scores[0].archetype.id).toBe('luckTreasure')
  })
})
