import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useGachaStore } from './gachaStore'
import { usePlayerStore } from './playerStore'
import { PERMANENT_POOL_ID } from '../data/gachaPools'
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

  it('free pull option does not deduct diamonds even with a positive balance', () => {
    const playerStore = usePlayerStore()
    const gachaStore = useGachaStore()
    playerStore.player.diamond = 280

    const result = gachaStore.pull(PERMANENT_POOL_ID, 1, { free: true, seed: 11 })

    expect(result).toHaveLength(1)
    expect(playerStore.player.diamond).toBe(280)
  })

  it('single pull consumes gacha ticket before diamonds', () => {
    const playerStore = usePlayerStore()
    const gachaStore = useGachaStore()
    playerStore.player.diamond = 280
    playerStore.player.gachaTickets = 1

    const result = gachaStore.pull(PERMANENT_POOL_ID, 1, { seed: 12 })

    expect(result).toHaveLength(1)
    expect(playerStore.player.gachaTickets).toBe(0)
    expect(playerStore.player.diamond).toBe(280)
  })

  it('same seed and same pity state produce the same reward and audit', () => {
    const firstPlayerStore = usePlayerStore()
    const firstStore = useGachaStore()
    firstPlayerStore.player.diamond = 280
    firstStore.state.pityCounters[PERMANENT_POOL_ID] = 10
    const first = firstStore.pull(PERMANENT_POOL_ID, 1, { seed: 2026 })
    const firstAudit = firstStore.state.history[0].audit

    setActivePinia(createPinia())
    localStorageMock.clear()
    const secondPlayerStore = usePlayerStore()
    const secondStore = useGachaStore()
    secondPlayerStore.player.diamond = 280
    secondStore.state.pityCounters[PERMANENT_POOL_ID] = 10
    const second = secondStore.pull(PERMANENT_POOL_ID, 1, { seed: 2026 })
    const secondAudit = secondStore.state.history[0].audit

    expect(first[0].id).toBe(second[0].id)
    expect(firstAudit?.roll).toBe(secondAudit?.roll)
    expect(firstAudit?.selectedRewardId).toBe(secondAudit?.selectedRewardId)
  })

  it('same seed produces identical ten-pull results and audits', () => {
    const firstPlayerStore = usePlayerStore()
    const firstStore = useGachaStore()
    firstPlayerStore.player.diamond = 2800
    firstStore.state.pityCounters[PERMANENT_POOL_ID] = 5
    const first = firstStore.pull(PERMANENT_POOL_ID, 10, { seed: 404 })
    const firstAudits = firstStore.state.history.map(record => record.audit)

    setActivePinia(createPinia())
    localStorageMock.clear()
    vi.stubGlobal('localStorage', localStorageMock)
    const secondPlayerStore = usePlayerStore()
    const secondStore = useGachaStore()
    secondPlayerStore.player.diamond = 2800
    secondStore.state.pityCounters[PERMANENT_POOL_ID] = 5
    const second = secondStore.pull(PERMANENT_POOL_ID, 10, { seed: 404 })
    const secondAudits = secondStore.state.history.map(record => record.audit)

    expect(first.map(reward => reward.id)).toEqual(second.map(reward => reward.id))
    expect(firstAudits.map(audit => audit?.roll)).toEqual(secondAudits.map(audit => audit?.roll))
    expect(firstAudits.map(audit => audit?.selectedRewardId)).toEqual(secondAudits.map(audit => audit?.selectedRewardId))
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
    expect(gachaStore.state.history[0].audit?.modifiers).toContainEqual(expect.objectContaining({
      id: 'hard_pity',
      active: true
    }))
  })

  it('probability audit exposes soft pity modifiers and normalized rates', () => {
    const gachaStore = useGachaStore()
    gachaStore.state.pityCounters[PERMANENT_POOL_ID] = 80

    const audit = gachaStore.getProbabilityAudit(PERMANENT_POOL_ID, 123)
    const total = Object.values(audit?.normalizedRates ?? {}).reduce((sum, value) => sum + value, 0)

    expect(audit?.modifiers).toContainEqual(expect.objectContaining({
      id: 'soft_pity',
      label: '软保底',
      active: true
    }))
    expect(total).toBeCloseTo(100, 8)
  })

  it('抽前 preview 不改变 pity / history', () => {
    const gachaStore = useGachaStore()
    gachaStore.state.pityCounters[PERMANENT_POOL_ID] = 12

    const preview = gachaStore.getProbabilityPreview(PERMANENT_POOL_ID, 10)

    expect(preview).not.toBeNull()
    expect(gachaStore.state.pityCounters[PERMANENT_POOL_ID]).toBe(12)
    expect(gachaStore.state.history).toHaveLength(0)
  })

  it('shows audit from actual pull, not fixed preview seed', () => {
    const playerStore = usePlayerStore()
    const gachaStore = useGachaStore()
    playerStore.player.diamond = 280

    const preview = gachaStore.getProbabilityPreview(PERMANENT_POOL_ID, 10)
    expect(preview?.seed).toBeUndefined()
    expect(Object.values(preview?.normalizedRates ?? {}).reduce((sum, value) => sum + value, 0)).toBeCloseTo(100, 8)
    expect(gachaStore.getLastPullAudit(PERMANENT_POOL_ID)).toBeNull()

    gachaStore.pull(PERMANENT_POOL_ID, 1, { seed: 2027 })
    expect(gachaStore.getLastPullAudit(PERMANENT_POOL_ID)?.seed).toBe(2027)
    expect(gachaStore.getLastPullAudit(PERMANENT_POOL_ID)?.seed).not.toBe(2026)
  })

  it('consumes probability modifier after gacha pull', () => {
    const playerStore = usePlayerStore()
    const gachaStore = useGachaStore()
    const probabilityStore = useProbabilityStore()
    playerStore.player.diamond = 3080

    probabilityStore.addPendingModifier(PERMANENT_POOL_ID, {
      id: 'pachinko_ten_pull_modifier',
      source: 'pachinko',
      label: '幸运投球十连加成',
      appliesTo: 'tenPull',
      rarePlusBonus: 6
    })
    const singleAudit = gachaStore.getProbabilityAudit(PERMANENT_POOL_ID, 1, 1)
    expect(singleAudit?.modifiers.some(modifier => modifier.id === 'pachinko_ten_pull_modifier')).toBe(false)

    const single = gachaStore.pull(PERMANENT_POOL_ID, 1, { seed: 1 })
    expect(single).toHaveLength(1)
    expect(probabilityStore.visibleModifiers.some(modifier => modifier.id === 'pachinko_ten_pull_modifier')).toBe(true)

    const ten = gachaStore.pull(PERMANENT_POOL_ID, 10, { seed: 2 })
    expect(ten).toHaveLength(10)
    expect(gachaStore.state.history[0].audit?.modifiers).toContainEqual(expect.objectContaining({
      id: 'pachinko_ten_pull_modifier',
      active: true
    }))
    expect(probabilityStore.visibleModifiers.some(modifier => modifier.id === 'pachinko_ten_pull_modifier')).toBe(false)
  })

  it('event modifier is displayable and consumed by the next pull', () => {
    const playerStore = usePlayerStore()
    const gachaStore = useGachaStore()
    const probabilityStore = useProbabilityStore()
    playerStore.player.diamond = 280

    probabilityStore.addPendingModifier(PERMANENT_POOL_ID, {
      id: 'pinball_event_modifier',
      source: 'pinball',
      label: '弹球活动加成',
      appliesTo: 'anyPull',
      rarePlusBonus: 3
    })
    const audit = gachaStore.getProbabilityAudit(PERMANENT_POOL_ID, 3)

    expect(audit?.modifiers).toContainEqual(expect.objectContaining({
      id: 'pinball_event_modifier',
      label: '弹球活动加成',
      active: true
    }))

    const result = gachaStore.pull(PERMANENT_POOL_ID, 1, { seed: 3 })
    expect(result).toHaveLength(1)
    expect(probabilityStore.visibleModifiers.some(modifier => modifier.id === 'pinball_event_modifier')).toBe(false)
  })
})
