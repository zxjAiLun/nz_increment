import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { usePlayerStore } from './playerStore'

const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value }),
    removeItem: vi.fn((key: string) => { delete store[key] }),
    clear: vi.fn(() => { store = {} }),
    get length() { return Object.keys(store).length },
    key: vi.fn((index: number) => Object.keys(store)[index] ?? null)
  }
})()

describe('playerStore stat upgrades', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorageMock.clear()
    vi.stubGlobal('localStorage', localStorageMock)
  })

  it('uses a smooth 1.18 cost curve instead of powers of ten', () => {
    const playerStore = usePlayerStore()
    playerStore.player.gold = 10_000

    expect(playerStore.getUpgradeCost('attack')).toBe(10)

    expect(playerStore.upgradeStat('attack', 10)).toBe(true)
    expect(playerStore.getUpgradeCost('attack')).toBe(11)

    for (let i = 0; i < 9; i++) {
      const cost = playerStore.getUpgradeCost('attack')
      expect(playerStore.upgradeStat('attack', cost)).toBe(true)
    }

    expect(playerStore.getUpgradeCost('attack')).toBe(Math.floor(10 * Math.pow(1.18, 10)))
    expect(playerStore.getUpgradeCost('attack')).toBeLessThan(100)
  })

  it('consumes only the configured cost and grants one point', () => {
    const playerStore = usePlayerStore()
    const initialAttack = playerStore.player.stats.attack
    playerStore.player.gold = 100

    expect(playerStore.getPointsForGold('attack')).toBe(1)
    expect(playerStore.upgradeStat('attack', 100)).toBe(true)

    expect(playerStore.player.gold).toBe(90)
    expect(playerStore.player.stats.attack).toBe(initialAttack + 1)
  })

  it('rejects underpaying the current upgrade cost', () => {
    const playerStore = usePlayerStore()
    playerStore.player.gold = 100

    expect(playerStore.upgradeStat('attack', 9)).toBe(false)
    expect(playerStore.player.gold).toBe(100)
  })
})
