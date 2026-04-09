import { describe, it, expect } from 'vitest'
import { EQUIPMENT_SETS } from '../utils/constants'

describe('equipment sets', () => {
  it('EQUIPMENT_SETS has 5 sets', () => {
    expect(EQUIPMENT_SETS.length).toBe(5)
  })

  it('each set has 2-piece and 4-piece bonuses', () => {
    for (const set of EQUIPMENT_SETS) {
      expect(set.pieces[2]).toBeDefined()
      expect(set.pieces[4]).toBeDefined()
    }
  })

  it('warrior set 2-piece: attack +10%', () => {
    const warrior = EQUIPMENT_SETS.find(s => s.id === 'warrior')
    expect(warrior.pieces[2][0].stat).toBe('attack')
    expect(warrior.pieces[2][0].value).toBe(10)
  })
})
