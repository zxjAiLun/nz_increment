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
  calculateElementalAdvantage,
  calculateRecyclePrice,
  calculateOfflineReward,
  createDefaultPlayer,
  calculateTotalStats,
  calculateDefenseK,
  calculateArmorReduction
} from './calc'
import { generateMonster } from './monsterGenerator'

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
      massCollapse: 0, dimensionTear: 0,
      fireResist: 0, waterResist: 0, windResist: 0, darkResist: 0,
      damageReduction: 0, attackSpeed: 0, cooldownReduction: 0, skillDamageBonus: 0, lifesteal: 5
    },
    gold: 0, diamond: 0,
    equipment: {},
    skills: [null, null, null, null, null],
    unlockedPhases: [1],
    totalKillCount: 0, totalComboCount: 0, maxComboCount: 0,
    totalOnlineTime: 0, totalOfflineTime: 0,
    lastLoginTime: Date.now(), offlineEfficiencyBonus: 0,
    speedKillCount: 0, trainingKillCount: 0,
    checkInStreak: 0, lastCheckInTime: 0,
    equipmentTickets: 0, materials: 0, gachaTickets: 0,
    passiveShards: 0, avatarFrames: 0, ownedAvatarFrames: [], setPieces: 0
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
    isBoss: false, isTrainingMode: false, trainingDifficulty: null, skills: [],
    // T21.1 标记状态
    status: { marks: [], elemental: [] },
    // T65 元素属性
    element: 'none'
  }
  return { ...base, ...overrides }
}

describe('calc.ts - 伤害公式测试', () => {

  describe('动态防御K值', () => {
    it('difficulty 0 保持原基础K值', () => {
      expect(calculateDefenseK(0)).toBe(200)
    })

    it('随难度提升提高K值并降低同防御减伤', () => {
      expect(calculateDefenseK(100)).toBeCloseTo(550)
      expect(calculateArmorReduction(200, 0)).toBeCloseTo(0.5)
      expect(calculateArmorReduction(200, 100)).toBeCloseTo(200 / 750)
    })

    it('负数防御和负数难度会被安全钳制', () => {
      expect(calculateDefenseK(-100)).toBe(200)
      expect(calculateArmorReduction(-10, 100)).toBe(0)
    })
  })

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
      const monster = makeMonster({ accuracy: 0, dodge: 100 })
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

    it('初始玩家可以击败首个怪物', () => {
      const player = createDefaultPlayer()
      const stats = calculateTotalStats(player)
      const monster = generateMonster(0, 1)

      let playerRolls = 0
      vi.spyOn(Math, 'random').mockImplementation(() => {
        playerRolls++
        return playerRolls % 2 === 1 ? 0.01 : 0.99
      })
      const playerDamage = calculatePlayerDamage(player, stats, monster)

      vi.restoreAllMocks()

      let monsterRolls = 0
      vi.spyOn(Math, 'random').mockImplementation(() => {
        monsterRolls++
        return monsterRolls % 2 === 1 ? 0.01 : 0.99
      })
      const monsterDamage = calculateMonsterDamage(monster, player, stats)

      const turnsToKillMonster = Math.ceil(monster.maxHp / playerDamage)
      const turnsToKillPlayer = Math.ceil(player.maxHp / monsterDamage)

      expect(playerDamage).toBeGreaterThan(0)
      expect(monsterDamage).toBeGreaterThan(0)
      expect(turnsToKillMonster).toBeLessThan(turnsToKillPlayer)
      expect(turnsToKillMonster).toBeLessThanOrEqual(12)
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
        level: 1, stats: [{ type: 'attack', value: 20, isPercent: false }], isLocked: false, affixes: [], refiningSlots: [], refiningLevel: 0, runeSlots: []
      }
      const score = calculateEquipmentScore(eq)
      expect(score).toBeGreaterThan(0)
      // attack=20, baseValue=10, rarity=epic(3.2x) => floor((20/10)*3.2) = 6
      expect(score).toBe(6)
    })
  })

  describe('calculateRecyclePrice', () => {
    it('回收价格基于评分和稀有度', () => {
      const eq: Equipment = {
        id: 'test-eq', slot: 'head', name: 'TestEquip', rarity: 'common',
        level: 1, stats: [{ type: 'attack', value: 10, isPercent: false }], isLocked: false, affixes: [], refiningSlots: [], refiningLevel: 0, runeSlots: []
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

  // T65 元素系统测试
  describe('calculateElementalAdvantage - 元素克制', () => {
    it('fire 克制 wind', () => {
      const mult = calculateElementalAdvantage('fire', 'wind', 0)
      expect(mult).toBe(1.5)
    })

    it('wind 克制 water', () => {
      const mult = calculateElementalAdvantage('wind', 'water', 0)
      expect(mult).toBe(1.5)
    })

    it('water 克制 fire', () => {
      const mult = calculateElementalAdvantage('water', 'fire', 0)
      expect(mult).toBe(1.5)
    })

    it('dark 无克制关系', () => {
      expect(calculateElementalAdvantage('dark', 'fire', 0)).toBe(1.0)
      expect(calculateElementalAdvantage('dark', 'wind', 0)).toBe(1.0)
      expect(calculateElementalAdvantage('dark', 'water', 0)).toBe(1.0)
    })

    it('无属性怪物无克制', () => {
      expect(calculateElementalAdvantage('none', 'fire', 0)).toBe(1.0)
      expect(calculateElementalAdvantage('none', 'water', 0)).toBe(1.0)
    })

    it('抗性降低克制效果', () => {
      // fire vs wind: 1.5 base, with 50 resist: max(1.0, 1.5 - 0.5) = 1.0
      const mult = calculateElementalAdvantage('fire', 'wind', 50)
      expect(mult).toBe(1.0)
    })

    it('被克制时抗性减少惩罚', () => {
      // wind vs fire (被克制): 0.67 base, with 33 resist: min(1.0, 0.67 + 0.33) = 1.0
      const mult = calculateElementalAdvantage('wind', 'fire', 33)
      expect(mult).toBe(1.0)
    })

    it('无克制关系时抗性无影响', () => {
      expect(calculateElementalAdvantage('water', 'wind', 100)).toBe(1.0)
    })
  })

  // T65 连击加成测试
  describe('calculatePlayerDamage - 连击加成', () => {
    // Mock Math.random globally to control hit/crit rolls
    let randomMock: ReturnType<typeof vi.fn>

    beforeEach(() => {
      randomMock = vi.fn().mockReturnValue(0.5)
      vi.stubGlobal('Math_random', randomMock)
    })

    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('comboBonus=50 时伤害增加 50%（无暴击，无防御）', () => {
      // Patch Math.random in the calc module
      const originalRandom = Math.random
      Math.random = () => 0.5 // always hit, never crit (critChance=5, 0.5*100=50<5=false)
      try {
        const player = makePlayer({ stats: { ...makePlayer().stats, attack: 100, critRate: 0 } })
        const stats = calculateTotalStats(player)
        const monster = makeMonster({ defense: 0, critRate: 0, critResist: 0, accuracy: 0, dodge: 0, element: 'none' })
        const noCombo = calculatePlayerDamage(player, stats, monster, true, 0, 0, 0, 0)
        const withCombo = calculatePlayerDamage(player, stats, monster, true, 0, 0, 0, 50)
        expect(withCombo).toBe(Math.floor(noCombo * 1.5))
      } finally {
        Math.random = originalRandom
      }
    })

    it('comboBonus=10 时伤害增加 10%（无暴击，无防御）', () => {
      const originalRandom = Math.random
      Math.random = () => 0.5
      try {
        const player = makePlayer({ stats: { ...makePlayer().stats, attack: 100, critRate: 0 } })
        const stats = calculateTotalStats(player)
        const monster = makeMonster({ defense: 0, critRate: 0, critResist: 0, accuracy: 0, dodge: 0, element: 'none' })
        const noCombo = calculatePlayerDamage(player, stats, monster, true, 0, 0, 0, 0)
        const withCombo = calculatePlayerDamage(player, stats, monster, true, 0, 0, 0, 10)
        expect(withCombo).toBe(Math.floor(noCombo * 1.1))
      } finally {
        Math.random = originalRandom
      }
    })

    it('comboBonus=0 时无额外加成', () => {
      const originalRandom = Math.random
      Math.random = () => 0.5
      try {
        const player = makePlayer()
        const stats = calculateTotalStats(player)
        const monster = makeMonster({ defense: 0, critRate: 0, critResist: 0 })
        const noCombo = calculatePlayerDamage(player, stats, monster, true, 0, 0, 0, 0)
        const alsoNoCombo = calculatePlayerDamage(player, stats, monster, true, 0, 0, 0, 0)
        expect(noCombo).toBe(alsoNoCombo)
      } finally {
        Math.random = originalRandom
      }
    })
  })

})
