import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Player, Monster, Equipment } from '../types'
import {
  calculatePlayerDamage,
  calculateMonsterDamage,
  calculateHealing,
  calculateLifesteal,
  calculateLuckEffects,
  calculateLuckPenetrationBonus,
  calculateEquipmentScore,
  calculateRecyclePrice,
  calculateOfflineReward,
  createDefaultPlayer,
  calculateTotalStats
} from './calc'
import { RARITY_MULTIPLIER } from '../types'

// Mock player factory
function makePlayer(overrides: Partial<Player> = {}): Player {
  const base: Player = {
    id: 'test-player',
    name: 'TestPlayer',
    level: 1,
    experience: 0,
    currentHp: 100,
    maxHp: 100,
    stats: {
      size: 1, attack: 10, defense: 5, maxHp: 100, speed: 10,
      critRate: 5, critDamage: 150, penetration: 0, dodge: 0,
      accuracy: 0, critResist: 0, combo: 100,
      damageBonusI: 0, damageBonusII: 0, damageBonusIII: 0,
      luck: 10, gravityRange: 0, gravityStrength: 0,
      voidDamage: 0, trueDamage: 0, timeWarp: 0,
      massCollapse: 0, dimensionTear: 0
    },
    gold: 0, diamond: 0,
    equipment: {},
    skills: [null, null, null, null, null],
    unlockedPhases: [1],
    totalKillCount: 0, totalComboCount: 0, maxComboCount: 0,
    totalOnlineTime: 0, totalOfflineTime: 0,
    lastLoginTime: Date.now(), offlineEfficiencyBonus: 0
  }
  return { ...base, ...overrides }
}

// Mock monster factory
function makeMonster(overrides: Partial<Monster> = {}): Monster {
  const base: Monster = {
    id: 'test-monster', name: 'TestMonster', level: 1, phase: 1,
    maxHp: 1000, currentHp: 1000,
    attack: 10, defense: 5, speed: 10,
    critRate: 5, critDamage: 150, critResist: 0, penetration: 0,
    accuracy: 0, dodge: 0,
    goldReward: 10, expReward: 5,
    equipmentDropChance: 0.3, diamondDropChance: 0.01,
    isBoss: false, isTrainingMode: false, trainingDifficulty: null, skills: []
  }
  return { ...base, ...overrides }
}

describe('calc.ts - 伤害公式测试', () => {

  describe('calculatePlayerDamage - 命中判定', () => {
    beforeEach(() => {
      // Mock random to always hit (0 < hitChance)
      vi.spyOn(Math, 'random').mockReturnValue(0.01)
    })
    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('miss 时伤害为 0', () => {
      // force miss: random returns > hitChance
      vi.spyOn(Math, 'random').mockReturnValue(0.99)
      const player = makePlayer()
      const stats = calculateTotalStats(player)
      const monster = makeMonster({ accuracy: 100, dodge: 0 })
      const damage = calculatePlayerDamage(player, stats, monster)
      expect(damage).toBe(0)
    })
  })

  describe('calculatePlayerDamage - 基础伤害计算', () => {
    beforeEach(() => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5)
    })
    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('基础伤害等于玩家攻击力', () => {
      const player = makePlayer({ stats: { ...makePlayer().stats, attack: 100 } })
      const stats = calculateTotalStats(player)
      const monster = makeMonster({ defense: 0, critResist: 0 })
      const damage = calculatePlayerDamage(player, stats, monster)
      expect(damage).toBeGreaterThan(0)
      // No crit, no bonuses: damage ≈ attack
      expect(damage).toBeLessThanOrEqual(100)
    })
  })

  describe('calculatePlayerDamage - 暴击伤害计算', () => {
    beforeEach(() => {
      // First call: hit check (random <= hitChance)
      // Second call: crit check (random < critChance)
      let callCount = 0
      vi.spyOn(Math, 'random').mockImplementation(() => {
        callCount++
        // hit: call 1 with 0.5, crit: call 2 with 0.1
        return callCount === 1 ? 0.1 : 0.05
      })
    })
    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('暴击时伤害翻倍', () => {
      const player = makePlayer({ stats: { ...makePlayer().stats, attack: 100, critRate: 100, critDamage: 200, critResist: 0 } })
      const stats = calculateTotalStats(player)
      const monster = makeMonster({ critResist: 0, defense: 0 })
      const damage = calculatePlayerDamage(player, stats, monster)
      // crit multiplier = max(1.2, 200/100 - 0*0.2) = 2.0
      // damage = 100 * 2.0 = 200
      expect(damage).toBe(200)
    })
  })

  describe('calculatePlayerDamage - 护甲减伤计算', () => {
    beforeEach(() => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5)
    })
    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('高防御怪物减少玩家伤害', () => {
      const player = makePlayer({ stats: { ...makePlayer().stats, attack: 100 } })
      const stats = calculateTotalStats(player)
      const lowDef = makeMonster({ defense: 0, critResist: 0 })
      const highDef = makeMonster({ defense: 200, critResist: 0 })
      const dmgLow = calculatePlayerDamage(player, stats, lowDef)
      const dmgHigh = calculatePlayerDamage(player, stats, highDef)
      expect(dmgHigh).toBeLessThan(dmgLow)
    })

    it('最小伤害不低于攻击力 10%', () => {
      const player = makePlayer({ stats: { ...makePlayer().stats, attack: 100 } })
      const stats = calculateTotalStats(player)
      const monster = makeMonster({ defense: 10000, critResist: 0 })
      const damage = calculatePlayerDamage(player, stats, monster)
      expect(damage).toBeGreaterThanOrEqual(10) // 100 * 0.1
    })
  })

  describe('calculatePlayerDamage - 真实伤害', () => {
    beforeEach(() => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5)
    })
    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('ignoreDefense=true 绕过护甲减伤', () => {
      const player = makePlayer({ stats: { ...makePlayer().stats, attack: 100 } })
      const stats = calculateTotalStats(player)
      const monster = makeMonster({ defense: 500, critResist: 0 })
      const dmgIgnore = calculatePlayerDamage(player, stats, monster, true)
      const dmgNormal = calculatePlayerDamage(player, stats, monster, false)
      expect(dmgIgnore).toBeGreaterThan(dmgNormal)
    })

    it('真实伤害叠加到最终伤害', () => {
      const player = makePlayer({ stats: { ...makePlayer().stats, attack: 10, trueDamage: 50 } })
      const stats = calculateTotalStats(player)
      const monster = makeMonster({ defense: 0, critResist: 0 })
      const damage = calculatePlayerDamage(player, stats, monster)
      expect(damage).toBeGreaterThanOrEqual(50) // at least trueDamage
    })
  })

  describe('calculatePlayerDamage - 虚空伤害', () => {
    beforeEach(() => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5)
    })
    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('虚空伤害叠加到最终伤害', () => {
      const player = makePlayer({ stats: { ...makePlayer().stats, attack: 10, voidDamage: 30 } })
      const stats = calculateTotalStats(player)
      const monster = makeMonster({ defense: 0, critResist: 0 })
      const damage = calculatePlayerDamage(player, stats, monster)
      expect(damage).toBeGreaterThanOrEqual(30)
    })
  })

  describe('溢出保护', () => {
    beforeEach(() => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5)
    })
    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('极大数值攻击不会溢出 Infinity', () => {
      const player = makePlayer({ stats: { ...makePlayer().stats, attack: 1e12 } })
      const stats = calculateTotalStats(player)
      const monster = makeMonster({ defense: 0, critResist: 0 })
      const damage = calculatePlayerDamage(player, stats, monster)
      expect(Number.isFinite(damage)).toBe(true)
      expect(damage).toBeLessThan(1e15)
    })
  })

  describe('calculateMonsterDamage - 怪物对玩家伤害', () => {
    beforeEach(() => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5)
    })
    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('怪物 miss 时伤害为 0', () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.99)
      const monster = makeMonster({ accuracy: 0, attack: 100 })
      const player = makePlayer({ stats: { ...makePlayer().stats, dodge: 0 } })
      const stats = calculateTotalStats(player)
      const damage = calculateMonsterDamage(monster, player, stats)
      expect(damage).toBe(0)
    })

    it('高防御玩家减少怪物伤害', () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5)
      const monster = makeMonster({ attack: 100, penetration: 0 })
      const lowDef = makePlayer({ stats: { ...makePlayer().stats, defense: 0 } })
      const highDef = makePlayer({ stats: { ...makePlayer().stats, defense: 500 } })
      const statsLow = calculateTotalStats(lowDef)
      const statsHigh = calculateTotalStats(highDef)
      const dmgLow = calculateMonsterDamage(monster, lowDef, statsLow)
      const dmgHigh = calculateMonsterDamage(monster, highDef, statsHigh)
      expect(dmgHigh).toBeLessThan(dmgLow)
    })
  })

  describe('calculateHealing', () => {
    it('治疗量基于最大生命值', () => {
      const player = makePlayer({ stats: { ...makePlayer().stats, maxHp: 200 } })
      const stats = calculateTotalStats(player)
      const heal = calculateHealing(player, stats, 50)
      expect(heal).toBe(100) // 200 * 50%
    })
  })

  describe('calculateLifesteal', () => {
    it('吸血基于伤害和吸血率', () => {
      const ls = calculateLifesteal(100, 30)
      expect(ls).toBe(30)
    })
  })

  describe('calculateLuckEffects', () => {
    it('幸运值影响金币、装备、钻石和暴击加成', () => {
      const effects = calculateLuckEffects(10)
      expect(effects.goldBonus).toBeCloseTo(0.2)
      expect(effects.equipmentDropBonus).toBeCloseTo(0.08)
      expect(effects.diamondDropChance).toBeCloseTo(0.002)
      expect(effects.critBonus).toBeCloseTo(0.8)
    })
  })

  describe('calculateLuckPenetrationBonus', () => {
    it('幸运值提供穿透加成', () => {
      const bonus = calculateLuckPenetrationBonus(10)
      expect(bonus).toBe(1) // floor(10 * 0.1)
    })
  })

  describe('calculateEquipmentScore', () => {
    it('装备评分基于属性值和稀有度倍率', () => {
      const eq: Equipment = {
        id: 'test-eq', slot: 'head', name: 'TestEquip', rarity: 'epic',
        level: 1, stats: [{ type: 'attack', value: 20, isPercent: false }], isLocked: false
      }
      const score = calculateEquipmentScore(eq)
      expect(score).toBeGreaterThan(0)
      // attack=20, baseValue=10, rarity=epic(8x) => (20/10)*8 = 16
      expect(score).toBe(16)
    })
  })

  describe('calculateRecyclePrice', () => {
    it('回收价格基于评分和稀有度', () => {
      const eq: Equipment = {
        id: 'test-eq', slot: 'head', name: 'TestEquip', rarity: 'common',
        level: 1, stats: [{ type: 'attack', value: 10, isPercent: false }], isLocked: false
      }
      const price = calculateRecyclePrice(eq)
      expect(price).toBe(10) // score=1 * 10 * 1
    })
  })

  describe('calculateOfflineReward', () => {
    it('离线奖励基于攻击力和在线时长', () => {
      const player = makePlayer({ stats: { ...makePlayer().stats, attack: 100, luck: 0 } })
      const reward = calculateOfflineReward(player, 3600) // 1 hour
      expect(reward.gold).toBeGreaterThan(0)
      expect(reward.exp).toBeGreaterThan(0)
    })

    it('超过 24 小时取上限', () => {
      const player = makePlayer({ stats: { ...makePlayer().stats, attack: 100, luck: 0 } })
      const reward24h = calculateOfflineReward(player, 86400)
      const reward48h = calculateOfflineReward(player, 172800)
      expect(reward24h.gold).toBe(reward48h.gold)
    })
  })

  describe('createDefaultPlayer', () => {
    it('生成默认玩家属性正确', () => {
      const player = createDefaultPlayer()
      expect(player.name).toBe('棒棒糖')
      expect(player.level).toBe(1)
      expect(player.stats.attack).toBe(10)
    })
  })

  describe('calculateTotalStats', () => {
    beforeEach(() => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5)
    })
    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('精度上限为 80', () => {
      const player = makePlayer({ stats: { ...makePlayer().stats, accuracy: 200 } })
      const stats = calculateTotalStats(player)
      expect(stats.accuracy).toBe(80)
    })
  })

})
