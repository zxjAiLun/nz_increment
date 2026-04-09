import { describe, it, expect } from 'vitest'
import { MONSTER, CRIT } from '../utils/constants'

describe('numerical balance', () => {
  describe('MONSTER.DEFENSE_MULTIPLIER', () => {
    it('should be 1.5 (down from 3)', () => {
      expect(MONSTER.DEFENSE_MULTIPLIER).toBe(1.5)
    })
  })

  describe('CRIT constants', () => {
    it('RATE_GROWTH should be 0.02', () => {
      expect(CRIT.RATE_GROWTH).toBe(0.02)
    })
    it('DAMAGE_GROWTH should be 1.0', () => {
      expect(CRIT.DAMAGE_GROWTH).toBe(1.0)
    })
    it('RATE_MAX should be 50', () => {
      expect(CRIT.RATE_MAX).toBe(50)
    })
  })
})

describe('crit rate calculation', () => {
  it('difficulty 0: critRate = 5%', () => {
    const critRate = Math.min(CRIT.BASE_RATE + 0 * CRIT.RATE_GROWTH, CRIT.RATE_MAX)
    expect(critRate).toBe(5)
  })
  it('difficulty 500: critRate = 15%', () => {
    const critRate = Math.min(CRIT.BASE_RATE + 500 * CRIT.RATE_GROWTH, CRIT.RATE_MAX)
    expect(critRate).toBe(15)
  })
  it('difficulty 2500: critRate = 55%, capped at 50%', () => {
    const critRate = Math.min(CRIT.BASE_RATE + 2500 * CRIT.RATE_GROWTH, CRIT.RATE_MAX)
    expect(critRate).toBe(50)
  })
})

describe('crit damage calculation', () => {
  it('difficulty 0: critDamage = 150', () => {
    const critDamage = CRIT.BASE_DAMAGE + 0 * CRIT.DAMAGE_GROWTH
    expect(critDamage).toBe(150)
  })
  it('difficulty 500: critDamage = 650', () => {
    const critDamage = CRIT.BASE_DAMAGE + 500 * CRIT.DAMAGE_GROWTH
    expect(critDamage).toBe(650)
  })
})
