import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { generateEquipment, generateRandomRarity } from './equipmentGenerator'
import { RARITY_MULTIPLIER } from '../types'

describe('equipmentGenerator.ts - 装备生成测试', () => {

  describe('generateEquipment - 属性范围', () => {
    beforeEach(() => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5)
    })
    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('生成装备具有有效 id 和名称', () => {
      const eq = generateEquipment('head', 'common', 1)
      expect(eq.id.length).toBeGreaterThan(0)
      expect(eq.name.length).toBeGreaterThan(0)
    })

    it('装备稀有度正确', () => {
      const eq = generateEquipment('head', 'epic', 1)
      expect(eq.rarity).toBe('epic')
    })

    it('装备槽位正确', () => {
      const eq = generateEquipment('chest', 'legend', 5)
      expect(eq.slot).toBe('chest')
    })

    it('装备等级匹配难度值', () => {
      const eq = generateEquipment('hand', 'common', 100)
      expect(eq.level).toBe(100)
    })

    it('装备属性数量在稀有度对应范围内', () => {
      const statCountByRarity: Record<string, [number, number]> = {
        common: [1, 1],
        good: [1, 2],
        fine: [2, 2],
        epic: [2, 3],
        legend: [3, 3],
        myth: [3, 4],
        ancient: [4, 4],
        eternal: [4, 5]
      }
      for (const [rarity, [min, max]] of Object.entries(statCountByRarity)) {
        vi.spyOn(Math, 'random').mockReturnValue(0.5)
        const eq = generateEquipment('head', rarity as any, 1)
        expect(eq.stats.length).toBeGreaterThanOrEqual(min)
        expect(eq.stats.length).toBeLessThanOrEqual(max)
      }
    })
  })

  describe('generateEquipment - 稀有度倍率', () => {
    beforeEach(() => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5)
    })
    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('common 装备稀有度倍率为 1', () => {
      const eq = generateEquipment('head', 'common', 1)
      expect(RARITY_MULTIPLIER['common']).toBe(1)
    })

    it('epic 装备稀有度倍率高于 common', () => {
      expect(RARITY_MULTIPLIER['epic']).toBeGreaterThan(RARITY_MULTIPLIER['common'])
    })

    it('eternal 装备稀有度倍率最高', () => {
      const maxMultiplier = Math.max(...Object.values(RARITY_MULTIPLIER))
      expect(RARITY_MULTIPLIER['eternal']).toBe(maxMultiplier)
    })
  })

  describe('generateRandomRarity - 随机稀有度', () => {
    beforeEach(() => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5)
    })
    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('rarityBonus=0 时 roll=50 返回 fine', () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5) // 0.5 * 100 = 50
      const rarity = generateRandomRarity(0)
      // 30<=50<65 => fine
      expect(rarity).toBe('fine')
    })

    it('rarityBonus>0 提高稀有度概率', () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.29) // 29, without bonus < 30 (common)
      const rarityNoBonus = generateRandomRarity(0)
      const rarityWithBonus = generateRandomRarity(10) // adjustedRoll = 29 + 20 = 49
      // Without bonus: 29 < 30 => common
      // With bonus: 49 >= 30, < 50 => good
      expect(rarityNoBonus).toBe('common')
      expect(rarityWithBonus).toBe('good')
    })

    it('roll=99 返回 eternal', () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.99)
      const rarity = generateRandomRarity(0)
      expect(rarity).toBe('eternal')
    })

    it('roll=0 返回 common', () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.0)
      const rarity = generateRandomRarity(0)
      expect(rarity).toBe('common')
    })
  })

  describe('generateEquipment - 随机种子确定性', () => {
    it('相同 random 值生成相同装备属性', () => {
      // Mock all Math.random calls for a fixed sequence
      let callCount = 0
      const fixedSequence = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.1, 0.2, 0.3]
      vi.spyOn(Math, 'random').mockImplementation(() => {
        const val = fixedSequence[callCount % fixedSequence.length]
        callCount++
        return val
      })

      const eq1 = generateEquipment('head', 'epic', 10)
      vi.restoreAllMocks()

      callCount = 0
      vi.spyOn(Math, 'random').mockImplementation(() => {
        const val = fixedSequence[callCount % fixedSequence.length]
        callCount++
        return val
      })
      const eq2 = generateEquipment('head', 'epic', 10)

      expect(eq1.stats.length).toBe(eq2.stats.length)
      vi.restoreAllMocks()
    })
  })

  describe('generateEquipment - 所有槽位可生成', () => {
    beforeEach(() => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5)
    })
    afterEach(() => {
      vi.restoreAllMocks()
    })

    const slots = ['head', 'neck', 'shoulder', 'chest', 'back', 'hand', 'waist', 'legs', 'leftHand', 'rightHand', 'ringLeft', 'ringRight'] as const

    slots.forEach(slot => {
      it(`槽位 ${slot} 可正常生成装备`, () => {
        const eq = generateEquipment(slot, 'common', 1)
        expect(eq.slot).toBe(slot)
        expect(eq.stats.length).toBeGreaterThan(0)
      })
    })
  })

})
