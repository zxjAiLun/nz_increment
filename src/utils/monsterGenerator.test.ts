import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { generateMonster, getNextMonsterLevel, getPhaseProgress } from './monsterGenerator'
import { MONSTER, CRIT } from './constants'

describe('monsterGenerator.ts - 怪物生成测试', () => {

  describe('generateMonster - 难度值对应属性', () => {
    beforeEach(() => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5)
    })
    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('difficultyValue=0 生成基础怪物', () => {
      const monster = generateMonster(0, 1)
      expect(monster.level).toBe(1)
      expect(monster.phase).toBe(1)
      expect(monster.isBoss).toBe(false)
    })

    it('高难度怪物属性更高', () => {
      const low = generateMonster(10, 1)
      const high = generateMonster(100, 1)
      expect(high.attack).toBeGreaterThan(low.attack)
      expect(high.maxHp).toBeGreaterThan(low.maxHp)
      expect(high.defense).toBeGreaterThan(low.defense)
    })

    it('BOSS 怪物生命值是普通怪物 5 倍', () => {
      const normal = generateMonster(10, 10) // level 10 = boss
      const baseHp = 10 * Math.pow(1.15, 10 / 10) * 100
      expect(normal.isBoss).toBe(true)
      expect(normal.maxHp).toBe(Math.floor(baseHp * 5))
    })

    it('BOSS 怪物攻击力是普通怪物 1.5 倍', () => {
      const normal = generateMonster(10, 10)
      const baseAtk = 10 * Math.pow(1.15, 10 / 10) * 10
      expect(normal.attack).toBe(Math.floor(baseAtk * 1.5))
    })

    it('BOSS 怪物防御力是普通怪物 1.2 倍', () => {
      const normal = generateMonster(10, 10)
      const baseDef = 10 * Math.pow(1.15, 10 / 10) * MONSTER.DEFENSE_MULTIPLIER
      expect(normal.defense).toBe(Math.floor(baseDef * 1.2))
    })

    it('金币奖励随难度增长', () => {
      const low = generateMonster(10, 1)
      const high = generateMonster(100, 1)
      expect(high.goldReward).toBeGreaterThan(low.goldReward)
    })

    it('经验奖励随难度增长', () => {
      const low = generateMonster(10, 1)
      const high = generateMonster(100, 1)
      expect(high.expReward).toBeGreaterThan(low.expReward)
    })
  })

  describe('generateMonster - 防御力计算', () => {
    beforeEach(() => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5)
    })
    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('防御力 = baseValue × 1.5', () => {
      const baseValue = 10 * Math.pow(1.15, 50 / 10) // difficulty=50
      const monster = generateMonster(50, 6)
      const expectedDef = Math.floor(baseValue * MONSTER.DEFENSE_MULTIPLIER)
      expect(monster.defense).toBe(expectedDef)
    })

    it('非 BOSS 防御力不加成', () => {
      const monster = generateMonster(20, 2) // not a boss (level 2)
      const baseValue = 10 * Math.pow(1.15, 20 / 10)
      expect(monster.defense).toBe(Math.floor(baseValue * MONSTER.DEFENSE_MULTIPLIER))
    })
  })

  describe('generateMonster - 暴击属性', () => {
    beforeEach(() => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5)
    })
    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('暴击率上限 50', () => {
      const monster = generateMonster(10000, 1)
      expect(monster.critRate).toBeLessThanOrEqual(CRIT.RATE_MAX)
    })

    it('暴击伤害随难度增长', () => {
      const low = generateMonster(10, 1)
      const high = generateMonster(1000, 1)
      expect(high.critDamage).toBeGreaterThan(low.critDamage)
    })

    it('BOSS 暴击伤害更高', () => {
      const normal = generateMonster(10, 10)
      const baseCritDmg = CRIT.BASE_DAMAGE + 10 * CRIT.DAMAGE_GROWTH
      expect(normal.critDamage).toBe(Math.floor(baseCritDmg * 1.5))
    })
  })

  describe('generateMonster - 技能系统', () => {
    beforeEach(() => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5)
    })
    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('高难度怪物可获得更多技能', () => {
      const lowSkillCount = generateMonster(0, 1).skills.length
      const highSkillCount = generateMonster(1000, 1).skills.length
      expect(highSkillCount).toBeGreaterThanOrEqual(lowSkillCount)
    })

    it('技能数量最多 4 个', () => {
      const monster = generateMonster(10000, 1)
      expect(monster.skills.length).toBeLessThanOrEqual(4)
    })
  })

  describe('generateMonster - 阶段计算', () => {
    beforeEach(() => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5)
    })
    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('phase 随 difficultyValue 提升', () => {
      const phase1 = generateMonster(0, 1)
      const phase7 = generateMonster(3000, 1)
      expect(phase7.phase).toBeGreaterThan(phase1.phase)
    })

    it('phase 最高为 7', () => {
      const monster = generateMonster(10000, 1)
      expect(monster.phase).toBeLessThanOrEqual(7)
    })
  })

  describe('generateMonster - 随机性', () => {
    it('相同难度生成相同名称类型（固定 random 序列）', () => {
      let callCount = 0
      const fixed = [0.1, 0.9] // will pick name index
      vi.spyOn(Math, 'random').mockImplementation(() => {
        const v = fixed[callCount % fixed.length]
        callCount++
        return v
      })
      const m1 = generateMonster(10, 1)
      vi.restoreAllMocks()

      callCount = 0
      vi.spyOn(Math, 'random').mockImplementation(() => {
        const v = fixed[callCount % fixed.length]
        callCount++
        return v
      })
      const m2 = generateMonster(10, 1)
      vi.restoreAllMocks()

      expect(m1.name).toBe(m2.name)
    })
  })

  describe('getNextMonsterLevel', () => {
    it('返回难度值/10 + 1', () => {
      const next = getNextMonsterLevel({ id: '1', name: 'x', level: 1, phase: 1, difficultyValue: 0 } as any, 50)
      expect(next).toBe(6)
    })
  })

  describe('getPhaseProgress', () => {
    it('返回 0-1 之间的进度', () => {
      const progress = getPhaseProgress(250)
      expect(progress).toBe(0.5)
    })

    it('进度上限为 1', () => {
      const progress = getPhaseProgress(750) // 750%500=250, 250/500=0.5 -> min(0.5,1)=0.5; try 1200
      const progress2 = getPhaseProgress(1200) // 1200%500=200, 200/500=0.4
      expect(progress).toBeLessThanOrEqual(1)
      expect(progress2).toBeLessThanOrEqual(1)
    })

    it('500 倍数时进度为 0', () => {
      const progress = getPhaseProgress(1000) // 1000%500=0 -> progress=0
      expect(progress).toBe(0)
    })
  })

  describe('generateMonster - 掉落率', () => {
    beforeEach(() => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5)
    })
    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('普通怪物钻石掉落率极低', () => {
      const monster = generateMonster(10, 5)
      expect(monster.diamondDropChance).toBeLessThan(0.1)
    })

    it('BOSS 钻石掉落率为 0.5', () => {
      const boss = generateMonster(10, 10)
      expect(boss.diamondDropChance).toBe(0.5)
    })

    it('装备掉落率固定为 0.3', () => {
      const monster = generateMonster(50, 5)
      expect(monster.equipmentDropChance).toBe(0.3)
    })
  })

})
