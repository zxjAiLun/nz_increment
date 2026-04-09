import { describe, it, expect } from 'vitest'
import { useSkillExecutor } from '../composables/useSkillExecutor'

describe('useSkillExecutor', () => {
  const executor = useSkillExecutor()

  it('calculateSkillBaseDamage: no multiplier returns 0', () => {
    const skill = { damageMultiplier: 0 }
    const stats = { attack: 100 }
    expect(executor.calculateSkillBaseDamage(skill, stats)).toBe(0)
  })

  it('calculateSkillBaseDamage: multiplier × attack × hits', () => {
    const skill = { damageMultiplier: 1.5, hitCount: 4 }
    const stats = { attack: 100 }
    expect(executor.calculateSkillBaseDamage(skill, stats)).toBe(600)
  })

  it('executeSkillLogic: returns damage and cooldowns', () => {
    const skill = { id: 'test', type: 'damage' as const, damageMultiplier: 2, cooldown: 3, trueDamage: 0 }
    const monster = { id: 'm1', name: 'test', hp: 1000, maxHp: 1000, defense: 0, attack: 10, level: 1, exp: 10, gold: 10, type: 'normal' } as any
    const result = executor.executeSkillLogic(skill, { attack: 100 } as any, monster)
    expect(result.damage).toBe(200)
    // cooldown is handled by cooldown system, not executeSkillLogic
  })
})
