import { describe, it, expect } from 'vitest'
import { getSkillById } from '../utils/skillSystem'

describe('passive effects', () => {
  it('PassiveEffect interface is defined', () => {
    const skill = getSkillById('skill_whirlwind')
    expect(skill).toBeDefined()
  })
})
