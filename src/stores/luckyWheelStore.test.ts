import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { PERMANENT_POOL_ID } from '../data/gachaPools'
import { useGachaStore } from './gachaStore'
import { useLuckyWheelStore } from './luckyWheelStore'
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

describe('luckyWheelStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorageMock.clear()
    vi.stubGlobal('localStorage', localStorageMock)
    vi.restoreAllMocks()
    vi.stubGlobal('localStorage', localStorageMock)
  })

  it('uses RewardResolver deterministically for the same seed', () => {
    const firstWheel = useLuckyWheelStore()
    const first = firstWheel.spinDaily({ seed: 2026 })

    setActivePinia(createPinia())
    localStorageMock.clear()
    const secondWheel = useLuckyWheelStore()
    const second = secondWheel.spinDaily({ seed: 2026 })

    expect(first?.reward.id).toBe(second?.reward.id)
    expect(first?.audit.roll).toBe(second?.audit.roll)
    expect(first?.audit.selectedRewardId).toBe(second?.audit.selectedRewardId)
  })

  it('allows only one free spin per day', () => {
    const wheel = useLuckyWheelStore()

    expect(wheel.spinDaily({ seed: 1 })).not.toBeNull()
    expect(wheel.canSpinDaily()).toBe(false)
    expect(wheel.spinDaily({ seed: 2 })).toBeNull()
  })

  it('applies pity rewards to permanent pool without granting legendary directly', () => {
    const wheel = useLuckyWheelStore()
    const gacha = useGachaStore()
    gacha.state.pityCounters[PERMANENT_POOL_ID] = 10

    const result = wheel.spinDaily({ rng: () => 0.99 })

    expect(result?.reward.id).toBe('pity_plus_1')
    expect(result?.reward.rarity).not.toBe('legendary')
    expect(gacha.state.pityCounters[PERMANENT_POOL_ID]).toBe(11)
  })

  it('rare+ wheel reward creates a displayable gacha modifier', () => {
    const wheel = useLuckyWheelStore()
    const gacha = useGachaStore()
    const probability = useProbabilityStore()

    const rolls = [0.2, 0.7]
    const result = wheel.spinDaily({ rng: () => rolls.shift() ?? 0.7 })
    const audit = gacha.getProbabilityAudit(PERMANENT_POOL_ID, 42)

    expect(result?.reward.id).toBe('rare_plus_5')
    expect(probability.visibleModifiers).toContainEqual(expect.objectContaining({
      appliesTo: 'nextPull',
      rarePlusBonus: 5
    }))
    expect(audit?.modifiers).toContainEqual(expect.objectContaining({
      id: expect.stringContaining('rare_plus_bonus'),
      label: result?.reward.name,
      active: true
    }))
  })

  it('ticket and build-token rewards update player and wheel state', () => {
    const player = usePlayerStore()
    const ticketWheel = useLuckyWheelStore()
    ticketWheel.spinDaily({ rng: () => 0.05 })

    expect(player.player.gachaTickets).toBe(1)

    setActivePinia(createPinia())
    localStorageMock.clear()
    vi.stubGlobal('localStorage', localStorageMock)
    const tokenWheel = useLuckyWheelStore()
    tokenWheel.spinDaily({ rng: () => 0 })

    expect(tokenWheel.state.buildTokens.speedSkill).toBe(1)
  })

  it('consumes build token to activate a build focus buff', () => {
    const wheel = useLuckyWheelStore()
    const player = usePlayerStore()
    wheel.addBuildToken('speedSkill', 1)

    const focus = wheel.activateBuildTokenFocus('speedSkill')

    expect(focus?.stat).toBe('speed')
    expect(wheel.state.buildTokens.speedSkill).toBe(0)
    expect(player.getActiveBuffs()).toContainEqual(expect.objectContaining({
      stat: 'speed',
      value: 10
    }))
  })

  it('does not activate build focus without a matching token', () => {
    const wheel = useLuckyWheelStore()

    expect(wheel.activateBuildTokenFocus('critBurst')).toBeNull()
    expect(wheel.state.buildTokens.critBurst || 0).toBe(0)
  })

  it('does not apply wheel reward when probability budget is exceeded', () => {
    const probability = useProbabilityStore()
    const wheel = useLuckyWheelStore()
    const gacha = useGachaStore()
    probability.recordOutcome({
      gameId: 'luckyWheel',
      seed: 'budget-fill',
      source: 'pity',
      label: 'pity cap',
      expectedValueCost: 3,
      modifier: { id: 'pity-cap', source: 'pity', label: 'pity +3', pityBonus: 3 }
    })

    const result = wheel.spinDaily({ rng: () => 0.99 })

    expect(result).toBeNull()
    expect(gacha.state.pityCounters[PERMANENT_POOL_ID] || 0).toBe(0)
    expect(wheel.canSpinDaily()).toBe(true)
  })
})
