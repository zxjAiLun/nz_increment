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
        rarityBonus: { rare: 5 }
      }
    })

    expect(store.latestOutcome?.gameId).toBe('pachinko')
    expect(store.visibleModifiers).toHaveLength(1)
    expect(store.visibleModifiers[0].label).toBe('rare+ +5%')

    store.consumeModifier('m1')
    expect(store.visibleModifiers).toHaveLength(0)
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
})
