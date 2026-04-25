import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useGachaStore } from './gachaStore'
import { usePlayerStore } from './playerStore'
import { PERMANENT_POOL_ID } from '../data/gachaPools'

const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value }),
    removeItem: vi.fn((key: string) => { delete store[key] }),
    clear: vi.fn(() => { store = {} })
  }
})()

describe('gachaStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorageMock.clear()
    vi.stubGlobal('localStorage', localStorageMock)
    vi.restoreAllMocks()
    vi.stubGlobal('localStorage', localStorageMock)
  })

  it('paid pull costs diamonds and increments pity', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99)
    const playerStore = usePlayerStore()
    const gachaStore = useGachaStore()
    playerStore.player.diamond = 280

    const result = gachaStore.pull(PERMANENT_POOL_ID, 1)

    expect(result).toHaveLength(1)
    expect(playerStore.player.diamond).toBe(0)
    expect(gachaStore.state.pityCounters[PERMANENT_POOL_ID]).toBe(1)
    expect(gachaStore.state.history).toHaveLength(1)
  })

  it('daily free pull does not cost diamonds but still records pity and history', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99)
    const playerStore = usePlayerStore()
    const gachaStore = useGachaStore()
    playerStore.player.diamond = 0

    const result = gachaStore.claimDailyFree(PERMANENT_POOL_ID)

    expect(result).not.toBeNull()
    expect(playerStore.player.diamond).toBe(0)
    expect(gachaStore.state.pityCounters[PERMANENT_POOL_ID]).toBe(1)
    expect(gachaStore.state.history).toHaveLength(1)
  })

  it('resets pity whenever a legendary reward is pulled', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const playerStore = usePlayerStore()
    const gachaStore = useGachaStore()
    playerStore.player.diamond = 280
    gachaStore.state.pityCounters[PERMANENT_POOL_ID] = 12

    const result = gachaStore.pull(PERMANENT_POOL_ID, 1)

    expect(result[0].rarity).toBe('legendary')
    expect(gachaStore.state.pityCounters[PERMANENT_POOL_ID]).toBe(0)
  })

  it('hard pity marks history and resets pity', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99)
    const playerStore = usePlayerStore()
    const gachaStore = useGachaStore()
    playerStore.player.diamond = 280
    gachaStore.state.pityCounters[PERMANENT_POOL_ID] = 89

    const result = gachaStore.pull(PERMANENT_POOL_ID, 1)

    expect(result[0].rarity).toBe('legendary')
    expect(gachaStore.state.history[0].isPity).toBe(true)
    expect(gachaStore.state.pityCounters[PERMANENT_POOL_ID]).toBe(0)
  })
})
