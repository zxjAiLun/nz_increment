import { describe, it, expect } from 'vitest'
import {
  getReactionType,
  calculateReactionDamage,
  applyElementalAttack,
  triggerElementalReaction,
  tickElementalDuration,
} from './elementalReactions'
import type { ElementalStatus } from '../types'

describe('elementalReactions', () => {
  describe('getReactionType', () => {
    it('fire + wind = burn', () => {
      expect(getReactionType('fire', 'wind')).toBe('burn')
      expect(getReactionType('wind', 'fire')).toBe('burn')
    })

    it('water + fire = evaporate', () => {
      expect(getReactionType('water', 'fire')).toBe('evaporate')
      expect(getReactionType('fire', 'water')).toBe('evaporate')
    })

    it('wind + water = shocked', () => {
      expect(getReactionType('wind', 'water')).toBe('shocked')
      expect(getReactionType('water', 'wind')).toBe('shocked')
    })

    it('dark + fire = melt', () => {
      expect(getReactionType('dark', 'fire')).toBe('melt')
      expect(getReactionType('fire', 'dark')).toBe('melt')
    })

    it('none element returns null', () => {
      expect(getReactionType('none', 'fire')).toBeNull()
      expect(getReactionType('fire', 'none')).toBeNull()
    })

    it('same element returns null (no reaction)', () => {
      expect(getReactionType('fire', 'fire')).toBeNull()
      expect(getReactionType('water', 'water')).toBeNull()
    })
  })

  describe('calculateReactionDamage', () => {
    it('burn reaction with 100 attack = 30 damage', () => {
      const result = { type: 'burn' as const, name: '灼烧', description: '', extraDamage: 0.3 }
      expect(calculateReactionDamage(100, result)).toBe(30)
    })

    it('evaporate reaction with 200 attack = 160 damage', () => {
      const result = { type: 'evaporate' as const, name: '蒸发', description: '', extraDamage: 0.8 }
      expect(calculateReactionDamage(200, result)).toBe(160)
    })

    it('frozen reaction (stun) = 0 damage', () => {
      const result = { type: 'frozen' as const, name: '冻结', description: '', extraDamage: 0 }
      expect(calculateReactionDamage(100, result)).toBe(0)
    })
  })

  describe('applyElementalAttack', () => {
    it('adds element stacks to empty status', () => {
      const status = { elemental: [] as ElementalStatus[] }
      const result = applyElementalAttack(status, 'fire', 2)
      expect(result).toHaveLength(1)
      expect(result[0].element).toBe('fire')
      expect(result[0].stacks).toBe(2)
      expect(result[0].duration).toBe(2)
    })

    it('stacks up to max 4', () => {
      const status = { elemental: [{ element: 'fire' as const, stacks: 3, duration: 2, reaction: null }] }
      const result = applyElementalAttack(status, 'fire', 2)
      expect(result[0].stacks).toBe(4) // capped at 4
    })

    it('refreshes duration if element already exists', () => {
      const status = { elemental: [{ element: 'fire' as const, stacks: 1, duration: 1, reaction: null }] }
      const result = applyElementalAttack(status, 'fire', 1)
      expect(result[0].stacks).toBe(2)
      expect(result[0].duration).toBe(2)
    })

    it('does nothing for none element', () => {
      const status = { elemental: [] as ElementalStatus[] }
      const result = applyElementalAttack(status, 'none', 1)
      expect(result).toHaveLength(0)
    })
  })

  describe('tickElementalDuration', () => {
    it('reduces duration by 1 each tick', () => {
      const status = { elemental: [{ element: 'fire' as const, stacks: 2, duration: 2, reaction: null }] }
      tickElementalDuration(status)
      expect(status.elemental[0].duration).toBe(1)
    })

    it('clears stacks when duration reaches 0', () => {
      const status = { elemental: [{ element: 'fire' as const, stacks: 2, duration: 1, reaction: null }] }
      tickElementalDuration(status)
      expect(status.elemental[0].stacks).toBe(0)
    })

    it('does not affect zero stacks', () => {
      const status = { elemental: [{ element: 'fire' as const, stacks: 0, duration: 2, reaction: null }] }
      tickElementalDuration(status)
      expect(status.elemental[0].duration).toBe(2) // duration only ticks for stacks > 0
    })
  })

  describe('triggerElementalReaction', () => {
    it('triggers reaction when target has elemental status', () => {
      const targetStatus = {
        elemental: [{ element: 'wind' as const, stacks: 2, duration: 2, reaction: null }]
      }
      const result = triggerElementalReaction('fire', targetStatus)
      expect(result).not.toBeNull()
      expect(result!.type).toBe('burn')
      expect(result!.extraDamage).toBe(0.3)
    })

    it('returns null when target has no elemental status', () => {
      const targetStatus = { elemental: [] as ElementalStatus[] }
      const result = triggerElementalReaction('fire', targetStatus)
      expect(result).toBeNull()
    })

    it('returns null when attacker is none element', () => {
      const targetStatus = {
        elemental: [{ element: 'wind' as const, stacks: 2, duration: 2, reaction: null }]
      }
      const result = triggerElementalReaction('none', targetStatus)
      expect(result).toBeNull()
    })
  })
})
