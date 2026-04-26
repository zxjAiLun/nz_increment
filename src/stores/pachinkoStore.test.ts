import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { PERMANENT_POOL_ID } from '../data/gachaPools'
import { useGachaStore } from './gachaStore'
import { usePachinkoStore } from './pachinkoStore'
import { usePlayerStore } from './playerStore'
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

    expect(first).not.toBeNull()
    expect(second).not.toBeNull()
    expect(first!.modifier.id).toBe(second!.modifier.id)
    expect(first!.audit.roll).toBe(second!.audit.roll)
    expect(first!.audit.selectedRewardId).toBe(second!.audit.selectedRewardId)
  })

  it('creates only a ten-pull modifier and does not grant high-rarity rewards directly', () => {
    const pachinko = usePachinkoStore()
    const gacha = useGachaStore()
    const probability = useProbabilityStore()
    const player = usePlayerStore()
    player.player.diamond = 2800

    const record = pachinko.playShot(PERMANENT_POOL_ID, { rng: () => 0 })
    const audit = gacha.getProbabilityAudit(PERMANENT_POOL_ID, 7, 10)

    expect(record).not.toBeNull()
    expect(record!.modifier.rarity).toBe('legendary')
    expect(probability.visibleModifiers).toContainEqual(expect.objectContaining({
      appliesTo: 'tenPull',
      rarePlusBonus: record!.modifier.rarePlusBonus
    }))
    expect(gacha.state.history).toHaveLength(0)
    expect(audit?.modifiers).toContainEqual(expect.objectContaining({
      id: expect.stringContaining('pachinko_ten_pull_modifier'),
      active: true
    }))
  })

  it('does not apply pachinko modifier when budget is exhausted', () => {
    const pachinko = usePachinkoStore()
    const probability = useProbabilityStore()
    const gacha = useGachaStore()

    const first = pachinko.playShot(PERMANENT_POOL_ID, { rng: () => 0 })
    const historyBeforeRejected = gacha.state.history.length
    const pityBeforeRejected = gacha.state.pityCounters[PERMANENT_POOL_ID] ?? 0
    const modifierCountBeforeRejected = probability.visibleModifiers.length
    const second = pachinko.playShot(PERMANENT_POOL_ID, { rng: () => 0 })

    expect(first).not.toBeNull()
    expect(second).toBeNull()
    expect(gacha.state.history).toHaveLength(historyBeforeRejected)
    expect(gacha.state.pityCounters[PERMANENT_POOL_ID] ?? 0).toBe(pityBeforeRejected)
    expect(probability.visibleModifiers).toHaveLength(modifierCountBeforeRejected)
    expect(probability.visibleModifiers).toContainEqual(expect.objectContaining({
      appliesTo: 'tenPull',
      rarePlusBonus: first?.modifier.rarePlusBonus
    }))
  })
})
