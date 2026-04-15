import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { usePlayerStore } from './playerStore'
import { calculateRecyclePrice } from '../utils/calc'
import type { Equipment } from '../types'

// Mock localStorage for Node.js environment
const mockStorage: Record<string, string> = {}
vi.stubGlobal('localStorage', {
  getItem: vi.fn((key: string) => mockStorage[key] ?? null),
  setItem: vi.fn((key: string, value: string) => { mockStorage[key] = value }),
  removeItem: vi.fn((key: string) => { delete mockStorage[key] }),
  clear: vi.fn(() => { Object.keys(mockStorage).forEach(k => delete mockStorage[k]) }),
  get length() { return Object.keys(mockStorage).length },
  key: vi.fn((i: number) => Object.keys(mockStorage)[i] ?? null)
})

// Helper: create a basic equipment
function makeEquipment(overrides: Partial<Equipment> = {}): Equipment {
  return {
    id: 'test-eq',
    slot: 'head',
    name: 'TestEquip',
    rarity: 'common',
    level: 1,
    stats: [{ type: 'attack', value: 10, isPercent: false }],
    isLocked: false,
    affixes: [],
    refiningSlots: [],
    refiningLevel: 0,
    runeSlots: [],
    ...overrides
  }
}

describe('T66 - Economy System', () => {
  beforeEach(() => {
    Object.keys(mockStorage).forEach(k => delete mockStorage[k])
    vi.clearAllMocks()
    setActivePinia(createPinia())
  })

  describe('calculateRecyclePrice (装备回收优化)', () => {
    it('普通装备评分1时返回基础价格', () => {
      const eq = makeEquipment({ rarity: 'common', stats: [{ type: 'attack', value: 10, isPercent: false }] })
      // score=1, basePrice=10, bonus=min(1/200,0.8)=0.005 → floor(10*1.005)=10
      expect(calculateRecyclePrice(eq)).toBe(10)
    })

    it('评分越高返还比例越高', () => {
      // 相同稀有度下，stats点数多的装备回收价更高
      const lowEq = makeEquipment({ rarity: 'legend', stats: [{ type: 'attack', value: 10, isPercent: false }] })
      const highEq = makeEquipment({ rarity: 'legend', stats: [{ type: 'attack', value: 100, isPercent: false }] })
      const lowPrice = calculateRecyclePrice(lowEq)
      const highPrice = calculateRecyclePrice(highEq)
      // 高评分装备返还价格应该高于低评分（bonus乘数更高）
      expect(highPrice).toBeGreaterThan(lowPrice)
    })

    it('返还价格有bonus加成', () => {
      // 测试bonus机制：用legend(×16)保证基础价格够大，能看出bonus效果
      // score约10: bonus=min(10/200,0.8)=0.05 → ×1.05
      // score约100: bonus=min(100/200,0.8)=0.5 → ×1.5
      const lowEq = makeEquipment({ rarity: 'legend', stats: [{ type: 'attack', value: 10, isPercent: false }] })
      const highEq = makeEquipment({ rarity: 'legend', stats: [{ type: 'attack', value: 100, isPercent: false }] })
      const lowPrice = calculateRecyclePrice(lowEq)
      const highPrice = calculateRecyclePrice(highEq)
      // 高分装备的bonus比例更高，所以增幅更大
      const lowRatio = lowPrice / (10 * 10 * 16)
      const highRatio = highPrice / (100 * 10 * 16)
      expect(highRatio).toBeGreaterThan(lowRatio)
    })

    it('传说装备回收价显著高于普通装备', () => {
      const commonEq = makeEquipment({ rarity: 'common' })
      const legendEq = makeEquipment({ rarity: 'legend' })
      expect(calculateRecyclePrice(legendEq)).toBeGreaterThan(calculateRecyclePrice(commonEq))
    })
  })

  describe('Daily Kill Goals (每日目标奖励)', () => {
    it('getDailyKillProgress 初始返回0进度', () => {
      const store = usePlayerStore()
      const progress = store.getDailyKillProgress()
      expect(progress.current).toBe(0)
      expect(progress.nextTarget).toBe(3)
      expect(progress.claimedCount).toBe(0)
    })

    it('processDailyKillGoal 第3击杀触发奖励', () => {
      const store = usePlayerStore()
      store.processDailyKillGoal()
      store.processDailyKillGoal()
      const thirdKill = store.processDailyKillGoal()
      expect(thirdKill).not.toBeNull()
      expect(thirdKill?.targetIndex).toBe(0)
      expect(thirdKill?.gold).toBe(50)
    })

    it('processDailyKillGoal 第6击杀触发奖励', () => {
      const store = usePlayerStore()
      for (let i = 0; i < 5; i++) store.processDailyKillGoal()
      const sixthKill = store.processDailyKillGoal()
      expect(sixthKill).not.toBeNull()
      expect(sixthKill?.targetIndex).toBe(1)
      expect(sixthKill?.gold).toBe(150)
    })

    it('processDailyKillGoal 第9击杀触发奖励', () => {
      const store = usePlayerStore()
      for (let i = 0; i < 8; i++) store.processDailyKillGoal()
      const ninthKill = store.processDailyKillGoal()
      expect(ninthKill).not.toBeNull()
      expect(ninthKill?.targetIndex).toBe(2)
      expect(ninthKill?.gold).toBe(300)
    })

    it('同一目标不能重复领取', () => {
      const store = usePlayerStore()
      store.processDailyKillGoal()
      store.processDailyKillGoal()
      store.processDailyKillGoal() // target 0 claimed
      const fourth = store.processDailyKillGoal() // 4 - not a target
      const fifth = store.processDailyKillGoal()  // 5 - not a target
      expect(fourth).toBeNull()
      expect(fifth).toBeNull()
    })

    it('getDailyKillProgress 返回下一目标', () => {
      const store = usePlayerStore()
      store.processDailyKillGoal()
      store.processDailyKillGoal()
      const progress = store.getDailyKillProgress()
      expect(progress.current).toBe(2)
      expect(progress.nextTarget).toBe(3)
    })
  })

  describe('First Kill Bonus (首杀奖励)', () => {
    it('isFirstKill 对新怪物模板返回true', () => {
      const store = usePlayerStore()
      const monster = { name: '纸箱怪', level: 1 }
      expect(store.isFirstKill(monster)).toBe(true)
    })

    it('isFirstKill 对已击杀怪物返回false', () => {
      const store = usePlayerStore()
      const monster = { name: '纸箱怪', level: 1 }
      store.processFirstKillReward(monster, 10, 5)
      expect(store.isFirstKill(monster)).toBe(false)
    })

    it('processFirstKillReward 返回双倍奖励', () => {
      const store = usePlayerStore()
      const monster = { name: '纸箱怪', level: 1 }
      const result = store.processFirstKillReward(monster, 100, 50)
      expect(result.extraGold).toBe(100)
      expect(result.extraExp).toBe(50)
    })

    it('processFirstKillReward 非首次击杀返回0', () => {
      const store = usePlayerStore()
      const monster = { name: '纸箱怪', level: 1 }
      store.processFirstKillReward(monster, 100, 50)
      const result = store.processFirstKillReward(monster, 100, 50)
      expect(result.extraGold).toBe(0)
      expect(result.extraExp).toBe(0)
    })

    it('不同怪物模板都有首杀机会', () => {
      const store = usePlayerStore()
      const monster1 = { name: '纸箱怪', level: 1 }
      const monster2 = { name: '垃圾桶精', level: 1 }
      store.processFirstKillReward(monster1, 10, 5)
      const result = store.processFirstKillReward(monster2, 20, 10)
      expect(result.extraGold).toBe(20)
      expect(result.extraExp).toBe(10)
    })

    it('相同模板不同等级怪物都有首杀机会', () => {
      const store = usePlayerStore()
      const monster1 = { name: '纸箱怪', level: 1 }
      const monster2 = { name: '纸箱怪', level: 2 }
      store.processFirstKillReward(monster1, 10, 5)
      const result = store.processFirstKillReward(monster2, 20, 10)
      expect(result.extraGold).toBe(20)
    })
  })

  describe('processKillRewards (综合击杀奖励)', () => {
    it('processKillRewards 对新怪物返回首杀奖励和每日目标', () => {
      const store = usePlayerStore()
      const monster = { name: '新怪物', level: 1 }
      const result = store.processKillRewards(monster, 100, 50)
      expect(result.firstKillBonus).toBe(true)
      expect(result.firstKillGold).toBe(100)
      expect(result.firstKillExp).toBe(50)
    })

    it('processKillRewards 对已击杀怪物不返回首杀奖励', () => {
      const store = usePlayerStore()
      const monster = { name: '已击杀怪物', level: 1 }
      store.processFirstKillReward(monster, 100, 50)
      const result = store.processKillRewards(monster, 100, 50)
      expect(result.firstKillBonus).toBe(false)
      expect(result.firstKillGold).toBe(0)
      expect(result.firstKillExp).toBe(0)
    })
  })

  describe('getMonsterTemplateId', () => {
    it('模板ID格式为 name_lvlevel', () => {
      const store = usePlayerStore()
      const monster = { name: '纸箱怪', level: 5 }
      expect(store.getMonsterTemplateId(monster)).toBe('纸箱怪_lv5')
    })
  })
})
