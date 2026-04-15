import { describe, it, expect } from 'vitest'
import { PASSIVE_SKILLS } from '../types'

describe('PASSIVE_SKILLS', () => {
  it('has 8 passive skills', () => {
    expect(PASSIVE_SKILLS.length).toBe(8)
  })

  it('each skill has unlockCondition', () => {
    for (const skill of PASSIVE_SKILLS) {
      expect(typeof skill.unlockCondition).toBe('number')
      expect(skill.unlockCondition).toBeGreaterThan(0)
    }
  })

  it('each skill has effects array', () => {
    for (const skill of PASSIVE_SKILLS) {
      expect(Array.isArray(skill.effects)).toBe(true)
      expect(skill.effects.length).toBeGreaterThan(0)
    }
  })

  it('iron_wall requires difficulty 100', () => {
    const ironWall = PASSIVE_SKILLS.find(s => s.id === 'iron_wall')
    expect(ironWall?.unlockCondition).toBe(100)
  })
})
