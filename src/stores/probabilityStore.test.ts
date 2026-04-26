import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useProbabilityStore } from './probabilityStore'

const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value }),
    removeItem: vi.fn((key: string) => { delete store[key] }),
    clear: vi.fn(() => { store = {} })
  }
})()

describe('probabilityStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorageMock.clear()
    vi.stubGlobal('localStorage', localStorageMock)
  })

  it('records chance game outcomes and exposes pending modifiers', () => {
    const store = useProbabilityStore()

    store.recordOutcome({
      gameId: 'pachinko',
      seed: 'seed-1',
      source: 'pachinko',
      label: '幸运槽',
      modifier: {
        id: 'm1',
        source: 'pachinko',
        label: 'rare+ +5%',
        poolId: 'permanent',
        appliesTo: 'tenPull',
        rarePlusBonus: 5
      }
    })

    expect(store.latestOutcome?.gameId).toBe('pachinko')
    expect(store.visibleModifiers).toHaveLength(1)
    expect(store.visibleModifiers[0].label).toBe('rare+ +5%')

    store.consumeModifier('m1')
    expect(store.visibleModifiers).toHaveLength(0)
  })

  it('peeks and consumes applicable modifiers by pool and pull intent', () => {
    const store = useProbabilityStore()
    store.addPendingModifier('permanent', {
      id: 'next',
      source: 'event',
      label: 'next pull',
      appliesTo: 'nextPull',
      rarePlusBonus: 5
    })
    store.addPendingModifier('permanent', {
      id: 'ten',
      source: 'pachinko',
      label: 'ten pull',
      appliesTo: 'tenPull',
      rarePlusBonus: 6
    })

    expect(store.getApplicableModifiers('permanent', { count: 1, costType: 'diamond' }).map(modifier => modifier.id)).toEqual(['next'])
    expect(store.getApplicableModifiers('permanent', { count: 10, costType: 'diamond' }).map(modifier => modifier.id)).toEqual(['ten', 'next'])

    const consumed = store.consumeApplicableModifiers('permanent', { count: 10, costType: 'diamond' })
    expect(consumed.map(modifier => modifier.id)).toEqual(['ten', 'next'])
    expect(store.visibleModifiers).toHaveLength(0)
  })

  it('filters paid-only modifiers out of free pull intents', () => {
    const store = useProbabilityStore()
    store.addPendingModifier('permanent', {
      id: 'paid',
      source: 'event',
      label: 'paid only',
      appliesTo: 'anyPull',
      appliesToCost: 'paidOnly',
      rarePlusBonus: 5
    })

    expect(store.getApplicableModifiers('permanent', { count: 1, costType: 'free' })).toHaveLength(0)
    expect(store.getApplicableModifiers('permanent', { count: 1, costType: 'ticket' }).map(modifier => modifier.id)).toEqual(['paid'])
    expect(store.getApplicableModifiers('permanent', { count: 1, costType: 'diamond' }).map(modifier => modifier.id)).toEqual(['paid'])
  })

  it('rejects chance game outcomes that exceed configured budgets', () => {
    const store = useProbabilityStore()

    const accepted = store.recordOutcome({
      gameId: 'pachinko',
      seed: 'jackpot-1',
      source: 'pachinko',
      label: 'jackpot',
      expectedValueCost: 3,
      jackpot: true,
      modifier: {
        id: 'legendary_bonus_1',
        source: 'pachinko',
        label: 'legendary +3%',
        rarityBonus: { legendary: 3 }
      }
    })
    const rejected = store.recordOutcome({
      gameId: 'pachinko',
      seed: 'jackpot-2',
      source: 'pachinko',
      label: 'jackpot again',
      expectedValueCost: 3,
      jackpot: true,
      modifier: {
        id: 'legendary_bonus_2',
        source: 'pachinko',
        label: 'legendary +1%',
        rarityBonus: { legendary: 1 }
      }
    })

    expect(accepted).toBe(true)
    expect(rejected).toBe(false)
    expect(store.getOutcomesByGame('pachinko')).toHaveLength(1)
    expect(store.getBudgetUsage('pachinko').jackpots).toBe(1)
  })

  it('budget exceeded outcomes do not add pending modifiers', () => {
    const store = useProbabilityStore()
    store.recordOutcome({
      gameId: 'pachinko',
      seed: 'first',
      source: 'pachinko',
      label: 'first jackpot',
      expectedValueCost: 8,
      jackpot: true,
      modifier: {
        id: 'accepted',
        source: 'pachinko',
        label: 'accepted',
        poolId: 'permanent',
        appliesTo: 'tenPull',
        rarePlusBonus: 8
      }
    })

    const rejected = store.recordOutcome({
      gameId: 'pachinko',
      seed: 'second',
      source: 'pachinko',
      label: 'over budget',
      expectedValueCost: 8,
      modifier: {
        id: 'rejected',
        source: 'pachinko',
        label: 'rejected',
        poolId: 'permanent',
        appliesTo: 'tenPull',
        rarePlusBonus: 8
      }
    })

    expect(rejected).toBe(false)
    expect(store.visibleModifiers.map(modifier => modifier.id)).toEqual(['accepted'])
  })

  it('applyChanceOutcome does not call reward callback when budget is exhausted', () => {
    const store = useProbabilityStore()
    const applyReward = vi.fn()
    store.recordOutcome({
      gameId: 'pachinko',
      seed: 'first',
      source: 'pachinko',
      label: 'first jackpot',
      expectedValueCost: 8,
      jackpot: true
    })

    const result = store.applyChanceOutcome({
      gameId: 'pachinko',
      seed: 'second',
      source: 'pachinko',
      label: 'blocked reward',
      expectedValueCost: 8
    }, applyReward)

    expect(result).toBeNull()
    expect(applyReward).not.toHaveBeenCalled()
    expect(store.getOutcomesByGame('pachinko')).toHaveLength(1)
  })
})
