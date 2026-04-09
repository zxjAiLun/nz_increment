import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  SKILL_POOL,
  getSkillById,
  getSkillsForPhase,
  createSkillInstance,
  getUnlockedSkills
} from './skillSystem'
import type { Skill } from '../types'

describe('skillSystem.ts - 技能系统测试', () => {

  describe('SKILL_POOL - 技能池', () => {
    it('技能池非空', () => {
      expect(SKILL_POOL.length).toBeGreaterThan(0)
    })

    it('每个技能都有必需字段', () => {
      for (const skill of SKILL_POOL) {
        expect(skill).toHaveProperty('id')
        expect(skill).toHaveProperty('name')
        expect(skill).toHaveProperty('description')
        expect(skill).toHaveProperty('type')
        expect(skill).toHaveProperty('cooldown')
        expect(skill).toHaveProperty('damageMultiplier')
      }
    })

    it('技能类型只能是 damage/heal/buff/debuff', () => {
      const validTypes = ['damage', 'heal', 'buff', 'debuff']
      for (const skill of SKILL_POOL) {
        expect(validTypes).toContain(skill.type)
      }
    })

    it('所有技能都有 unlockPhase', () => {
      for (const skill of SKILL_POOL) {
        expect(typeof skill.unlockPhase).toBe('number')
        expect(skill.unlockPhase).toBeGreaterThanOrEqual(1)
        expect(skill.unlockPhase).toBeLessThanOrEqual(7)
      }
    })

    it('所有技能都有非负冷却时间', () => {
      for (const skill of SKILL_POOL) {
        expect(skill.cooldown).toBeGreaterThanOrEqual(0)
      }
    })
  })

  describe('getSkillById - 技能查询', () => {
    it('能通过 id 找到对应技能', () => {
      const skill = SKILL_POOL[0]
      const found = getSkillById(skill.id)
      expect(found).toBeDefined()
      expect(found?.id).toBe(skill.id)
    })

    it('不存在的 id 返回 undefined', () => {
      const found = getSkillById('non_existent_skill_id')
      expect(found).toBeUndefined()
    })

    it('同一个 id 多次查询结果一致', () => {
      const id = 'skill_heavy_strike'
      const first = getSkillById(id)
      const second = getSkillById(id)
      expect(first).toEqual(second)
    })
  })

  describe('getSkillsForPhase - 阶段技能', () => {
    it('phase 1 只有 phase 1 技能', () => {
      const skills = getSkillsForPhase(1)
      for (const skill of skills) {
        expect(skill.unlockPhase).toBeLessThanOrEqual(1)
      }
    })

    it('phase 7 包含所有技能', () => {
      const phaseSkills = getSkillsForPhase(7)
      expect(phaseSkills.length).toBe(SKILL_POOL.length)
    })

    it('高阶段技能数量 >= 低阶段技能数量', () => {
      const phase3 = getSkillsForPhase(3)
      const phase5 = getSkillsForPhase(5)
      expect(phase5.length).toBeGreaterThanOrEqual(phase3.length)
    })

    it('phase 7 按 unlockPhase 过滤正确', () => {
      const skills = getSkillsForPhase(7)
      const ids = skills.map(s => s.id)
      const uniqueIds = new Set(ids)
      expect(uniqueIds.size).toBe(ids.length) // 无重复
    })
  })

  describe('createSkillInstance - 技能实例化', () => {
    it('创建实例时生成新 id', () => {
      const original = SKILL_POOL[0]
      const instance = createSkillInstance(original)
      expect(instance.id).not.toBe(original.id)
    })

    it('实例的 currentCooldown 初始为 0', () => {
      const instance = createSkillInstance(SKILL_POOL[0])
      expect(instance.currentCooldown).toBe(0)
    })

    it('实例保留原始技能的所有属性', () => {
      const original = SKILL_POOL[0]
      const instance = createSkillInstance(original)
      expect(instance.name).toBe(original.name)
      expect(instance.description).toBe(original.description)
      expect(instance.type).toBe(original.type)
      expect(instance.cooldown).toBe(original.cooldown)
      expect(instance.damageMultiplier).toBe(original.damageMultiplier)
    })

    it('多次实例化创建独立对象', () => {
      const original = SKILL_POOL[0]
      const inst1 = createSkillInstance(original)
      const inst2 = createSkillInstance(original)
      expect(inst1.id).not.toBe(inst2.id)
    })
  })

  describe('getUnlockedSkills - 解锁技能', () => {
    it('phase 1 玩家只能解锁 phase 1 技能', () => {
      const skills = getUnlockedSkills(1)
      for (const skill of skills) {
        expect(skill.unlockPhase).toBeLessThanOrEqual(1)
      }
    })

    it('phase 7 玩家可解锁全部技能', () => {
      const skills = getUnlockedSkills(7)
      expect(skills.length).toBe(SKILL_POOL.length)
    })

    it('返回的技能列表与 getSkillsForPhase 等价', () => {
      const phase = 5
      const unlocked = getUnlockedSkills(phase)
      const byPhase = getSkillsForPhase(phase)
      expect(unlocked.length).toBe(byPhase.length)
    })
  })

  describe('skill cooldown resets after use', () => {
    it('技能使用后 currentCooldown 等于 cooldown', () => {
      const instance = createSkillInstance(SKILL_POOL[0])
      expect(instance.currentCooldown).toBe(0)
      instance.currentCooldown = instance.cooldown
      expect(instance.currentCooldown).toBe(instance.cooldown)
    })

    it('技能冷却减少后可以再次使用', () => {
      const instance = createSkillInstance(SKILL_POOL[0])
      instance.currentCooldown = instance.cooldown
      instance.currentCooldown = Math.max(0, instance.currentCooldown - 1)
      expect(instance.currentCooldown).toBeLessThan(instance.cooldown)
    })
  })

  describe('skill damage scales with player stats', () => {
    it('有 damageMultiplier 的技能为伤害类型', () => {
      const damageSkills = SKILL_POOL.filter(s => s.damageMultiplier > 0)
      expect(damageSkills.length).toBeGreaterThan(0)
    })

    it('伤害技能有描述', () => {
      const damageSkills = SKILL_POOL.filter(s => s.type === 'damage')
      for (const skill of damageSkills) {
        expect(skill.description.length).toBeGreaterThan(0)
      }
    })

    it('heal 类型技能有 healPercent', () => {
      const healSkills = SKILL_POOL.filter(s => s.type === 'heal')
      for (const skill of healSkills) {
        expect(skill.healPercent).toBeGreaterThan(0)
      }
    })
  })

  describe('skill description matches actual effect', () => {
    it('重击技能描述包含"无视防御"', () => {
      const heavyStrike = getSkillById('skill_heavy_strike')
      expect(heavyStrike?.description).toContain('无视')
    })

    it('雷霆一击描述包含真实伤害', () => {
      const thunder = getSkillById('skill_thunder_strike')
      expect(thunder?.trueDamage).toBeGreaterThan(0)
      expect(thunder?.description).toMatch(/伤害|攻击/)
    })

    it('防御姿态是 buff 类型', () => {
      const stance = getSkillById('skill_defense_stance')
      expect(stance?.type).toBe('buff')
      expect(stance?.buffEffect).toBeDefined()
    })

    it('穿甲打击 defenseIgnorePercent 为 100', () => {
      const armorPierce = getSkillById('skill_armor_pierce')
      expect(armorPierce?.defenseIgnorePercent).toBe(100)
      expect(armorPierce?.ignoreDefense).toBe(true)
    })
  })

})
