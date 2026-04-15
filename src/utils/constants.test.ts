import { describe, it, expect } from 'vitest'
import {
  CRIT,
  GAUGE_MAX,
  DAMAGE_OVERFLOW_MAX,
  DEFENSE_DIVISOR,
  HIT,
  SPEED,
  LIFESTEAL,
  GAME,
  COLORS,
} from './constants'

describe('constants', () => {
  describe('CRIT', () => {
    it('CRIT.BASE_RATE should be 5', () => {
      expect(CRIT.BASE_RATE).toBe(5)
    })
    it('CRIT.BASE_DAMAGE should be 150', () => {
      expect(CRIT.BASE_DAMAGE).toBe(150)
    })
    it('CRIT.DAMAGE_RATIO should be 2.0', () => {
      expect(CRIT.DAMAGE_RATIO).toBe(2.0)
    })
  })

  describe('GAUGE_MAX', () => {
    it('GAUGE_MAX should be 100', () => {
      expect(GAUGE_MAX).toBe(100)
    })
  })

  describe('DAMAGE_OVERFLOW_MAX', () => {
    it('DAMAGE_OVERFLOW_MAX should be 1e15', () => {
      expect(DAMAGE_OVERFLOW_MAX).toBe(1e15)
    })
  })

  describe('DEFENSE_DIVISOR', () => {
    it('DEFENSE_DIVISOR should be 200', () => {
      expect(DEFENSE_DIVISOR).toBe(200)
    })
  })

  describe('HIT', () => {
    it('HIT.MIN_CHANCE should be 0.05', () => {
      expect(HIT.MIN_CHANCE).toBe(0.05)
    })
    it('HIT.MAX_CHANCE should be 0.95', () => {
      expect(HIT.MAX_CHANCE).toBe(0.95)
    })
    it('HIT.ACCURACY_MAX should be 80', () => {
      expect(HIT.ACCURACY_MAX).toBe(80)
    })
  })

  describe('SPEED', () => {
    it('SPEED.DOUBLE_TURN_RATIO should be 2.0', () => {
      expect(SPEED.DOUBLE_TURN_RATIO).toBe(2.0)
    })
    it('SPEED.DAMAGE_BONUS_RATIO should be 0.5', () => {
      expect(SPEED.DAMAGE_BONUS_RATIO).toBe(0.5)
    })
    it('SPEED.INITIAL_BONUS_MAX_RATIO should be 0.5', () => {
      expect(SPEED.INITIAL_BONUS_MAX_RATIO).toBe(0.5)
    })
  })

  describe('LIFESTEAL', () => {
    it('LIFESTEAL.BASE_RATE should be 0', () => {
      expect(LIFESTEAL.BASE_RATE).toBe(0)
    })
  })

  describe('GAME', () => {
    it('GAME.TICK_INTERVAL should be 100', () => {
      expect(GAME.TICK_INTERVAL).toBe(100)
    })
    it('GAME.TICK_RATE should be 16', () => {
      expect(GAME.TICK_RATE).toBe(16)
    })
    it('GAME.SAVE_INTERVAL should be 30000', () => {
      expect(GAME.SAVE_INTERVAL).toBe(30000)
    })
    it('GAME.GAUGE_TICK_RATE should be 10', () => {
      expect(GAME.GAUGE_TICK_RATE).toBe(10)
    })
  })

  describe('COLORS', () => {
    it('COLORS.PRIMARY should be #4a9eff', () => {
      expect(COLORS.PRIMARY).toBe('#4a9eff')
    })
    it('COLORS.GOLD should be #ffd700', () => {
      expect(COLORS.GOLD).toBe('#ffd700')
    })
    it('COLORS.DIAMOND should be #00bcd4', () => {
      expect(COLORS.DIAMOND).toBe('#00bcd4')
    })
  })
})
