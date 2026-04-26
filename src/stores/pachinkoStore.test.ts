import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { PERMANENT_POOL_ID } from '../data/gachaPools'
import { useGachaStore } from './gachaStore'
import { usePachinkoStore } from './pachinkoStore'
import { usePlayerStore } from './playerStore'

const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value }),
    removeItem: vi.fn((key: string) => { delete store[key] }),
    clear: vi.fn(() => { store = {} })
  }
})()

describe('pachinkoStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorageMock.clear()
    vi.stubGlobal('localStorage', localStorageMock)
    vi.restoreAllMocks()
    vi.stubGlobal('localStorage', localStorageMock)
  })

  it('uses seeded RewardResolver deterministically', () => {
    const first = usePachinkoStore().playShot(PERMANENT_POOL_ID, { seed: 2026 })

    setActivePinia(createPinia())
    localStorageMock.clear()
    vi.stubGlobal('localStorage', localStorageMock)
    const second = usePachinkoStore().playShot(PERMANENT_POOL_ID, { seed: 2026 })

    expect(first.modifier.id).toBe(second.modifier.id)
    expect(first.audit.roll).toBe(second.audit.roll)
    expect(first.audit.selectedRewardId).toBe(second.audit.selectedRewardId)
  })

  it('creates only a ten-pull modifier and does not grant high-rarity rewards directly', () => {
    const pachinko = usePachinkoStore()
    const gacha = useGachaStore()
    const player = usePlayerStore()
    player.player.diamond = 2800

    const record = pachinko.playShot(PERMANENT_POOL_ID, { rng: () => 0 })
    const audit = gacha.getProbabilityAudit(PERMANENT_POOL_ID, 7, 10)

    expect(record.modifier.rarity).toBe('legendary')
    expect(gacha.state.pendingTenPullRarePlusBonus[PERMANENT_POOL_ID]).toBe(record.modifier.rarePlusBonus)
    expect(gacha.state.history).toHaveLength(0)
    expect(audit?.modifiers).toContainEqual(expect.objectContaining({
      id: 'pachinko_ten_pull_modifier',
      active: true
    }))
  })
})
