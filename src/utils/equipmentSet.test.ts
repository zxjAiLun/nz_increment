import { describe, it, expect } from 'vitest'
import { EQUIPMENT_SETS } from '../utils/constants'

describe('equipment sets', () => {
  it('EQUIPMENT_SETS covers the five core archetypes plus support variants', () => {
    expect(EQUIPMENT_SETS.length).toBeGreaterThanOrEqual(7)
  })

  it('each set has 2-piece and 4-piece bonuses', () => {
    for (const set of EQUIPMENT_SETS) {
      expect(set.pieces[2]).toBeDefined()
      expect(set.pieces[4]).toBeDefined()
    }
  })

  it('warrior set 2-piece: attack +10%', () => {
    const warrior = EQUIPMENT_SETS.find(s => s.id === 'warrior')!
    expect(warrior.pieces[2][0].stat).toBe('attack')
    expect(warrior.pieces[2][0].value).toBe(10)
  })

  it('has representative sets for lifesteal tank, speed skill, and luck treasure', () => {
    const bloodGuardian = EQUIPMENT_SETS.find(s => s.id === 'blood_guardian')!
    const swift = EQUIPMENT_SETS.find(s => s.id === 'swift')!
    const fortune = EQUIPMENT_SETS.find(s => s.id === 'fortune')!

    expect(bloodGuardian.pieces[2][0].stat).toBe('lifesteal')
    expect(swift.pieces[4][0].stat).toBe('cooldownReduction')
    expect(fortune.pieces[2][0].stat).toBe('luck')
  })
})
