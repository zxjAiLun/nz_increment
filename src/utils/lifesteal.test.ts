import { describe, it, expect } from 'vitest'
import { calculateSkillLifesteal } from '../utils/calc'

describe('calculateSkillLifesteal', () => {
  it('null skill returns 0', () => {
    expect(calculateSkillLifesteal(null, 1000)).toBe(0)
  })

  it('skill without lifesteal returns 0', () => {
    expect(calculateSkillLifesteal({}, 1000)).toBe(0)
  })

  it('skill with 10% lifesteal on 1000 damage returns 100', () => {
    expect(calculateSkillLifesteal({ lifesteal: 10 }, 1000)).toBe(100)
  })

  it('skill with 0 lifesteal returns 0', () => {
    expect(calculateSkillLifesteal({ lifesteal: 0 }, 1000)).toBe(0)
  })
})
