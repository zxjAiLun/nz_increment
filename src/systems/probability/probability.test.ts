import { describe, expect, it } from 'vitest'
import { PityResolver, RewardResolver, SeededRng, normalizeRates, type ProbabilityModifier } from './probability'

const rewards = [
  { id: 'common_1', rarity: 'common' },
  { id: 'rare_1', rarity: 'rare' },
  { id: 'epic_1', rarity: 'epic' },
  { id: 'legendary_1', rarity: 'legendary' }
]

const rates = { common: 60, rare: 30, epic: 9, legendary: 1 }
const rarityOrder = ['legendary', 'epic', 'rare', 'common']

describe('probability system', () => {
  it('SeededRng returns the same sequence for the same seed', () => {
    const a = new SeededRng(123)
    const b = new SeededRng(123)

    expect([a.next(), a.next(), a.next()]).toEqual([b.next(), b.next(), b.next()])
  })

  it('RewardResolver returns the same result for the same seed', () => {
    const makeResult = () => {
      const rng = new SeededRng(42)
      return new RewardResolver(rewards, rates, rarityOrder).resolve({
        rng: rng.fn(),
        context: { pullNumber: 1 },
        seed: 42
      })
    }

    const first = makeResult()
    const second = makeResult()

    expect(first.reward.id).toBe(second.reward.id)
    expect(first.audit.roll).toBe(second.audit.roll)
    expect(first.audit.seed).toBe(42)
  })

  it('normalizes probability totals to 100 after modifiers', () => {
    const modifier: ProbabilityModifier = {
      id: 'bonus',
      label: '测试加成',
      description: '传说概率增加到需要归一化',
      apply: current => ({ ...current, legendary: current.legendary + 25 })
    }
    const rng = new SeededRng(7)
    const result = new RewardResolver(rewards, rates, rarityOrder).resolve({
      rng: rng.fn(),
      context: { pullNumber: 1 },
      modifiers: [modifier]
    })

    const total = Object.values(result.audit.normalizedRates).reduce((sum, value) => sum + value, 0)
    expect(total).toBeCloseTo(100, 8)
    expect(normalizeRates({ common: 1, rare: 1, epic: 1, legendary: 1 }).common).toBe(25)
  })

  it('records every modifier in the audit display list', () => {
    const modifier: ProbabilityModifier = {
      id: 'visible_modifier',
      label: '可展示加成',
      description: '所有 modifier 都需要可展示',
      apply: current => current
    }
    const rng = new SeededRng(1)
    const result = new RewardResolver(rewards, rates, rarityOrder).resolve({
      rng: rng.fn(),
      context: { pullNumber: 1 },
      modifiers: [modifier]
    })

    expect(result.audit.modifiers).toContainEqual(expect.objectContaining({
      id: 'visible_modifier',
      label: '可展示加成',
      description: '所有 modifier 都需要可展示',
      active: true
    }))
  })

  it('PityResolver hard pity can be tested deterministically', () => {
    const pity = new PityResolver(90, 80)
    const rng = new SeededRng(999)
    const result = new RewardResolver(rewards, rates, rarityOrder).resolve({
      rng: rng.fn(),
      context: { pullNumber: 90 },
      modifiers: pity.getModifiers(90)
    })

    expect(result.reward.rarity).toBe('legendary')
    expect(result.audit.modifiers).toContainEqual(expect.objectContaining({
      id: 'hard_pity',
      active: true
    }))
  })
})
