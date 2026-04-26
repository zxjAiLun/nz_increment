import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { PERMANENT_POOL_ID } from '../data/gachaPools'
import { useGachaStore } from './gachaStore'
import { usePinballStore } from './pinballStore'

const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value }),
    removeItem: vi.fn((key: string) => { delete store[key] }),
    clear: vi.fn(() => { store = {} })
  }
})()

describe('pinballStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorageMock.clear()
    vi.stubGlobal('localStorage', localStorageMock)
    vi.restoreAllMocks()
    vi.stubGlobal('localStorage', localStorageMock)
  })

  it('produces the same score and tokens for the same seed', () => {
    const first = usePinballStore().playEvent({ seed: 2026 })

    setActivePinia(createPinia())
    localStorageMock.clear()
    vi.stubGlobal('localStorage', localStorageMock)
    const second = usePinballStore().playEvent({ seed: 2026 })

    expect(first.score).toBe(second.score)
    expect(first.tokensGained).toBe(second.tokensGained)
    expect(first.rolls).toEqual(second.rolls)
  })

  it('converts score to tokens without granting gacha rewards directly', () => {
    const pinball = usePinballStore()
    const gacha = useGachaStore()

    const record = pinball.playEvent({ rng: () => 0.99 })

    expect(record.tokensGained).toBe(3)
    expect(pinball.state.tokens).toBe(3)
    expect(gacha.state.history).toHaveLength(0)
  })

  it('converts tokens into a displayable event modifier', () => {
    const pinball = usePinballStore()
    const gacha = useGachaStore()
    pinball.playEvent({ rng: () => 0.99 })

    const conversion = pinball.convertTokensToModifier(PERMANENT_POOL_ID, 2)
    const audit = gacha.getProbabilityAudit(PERMANENT_POOL_ID, 9)

    expect(conversion?.rarePlusBonus).toBe(2)
    expect(pinball.state.tokens).toBe(1)
    expect(audit?.modifiers).toContainEqual(expect.objectContaining({
      id: 'pinball_event_modifier',
      active: true
    }))
  })
})
