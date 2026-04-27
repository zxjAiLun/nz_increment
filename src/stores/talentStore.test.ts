import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useTalentStore } from './talentStore'

const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value }),
    removeItem: vi.fn((key: string) => { delete store[key] }),
    clear: vi.fn(() => { store = {} })
  }
})()

describe('talentStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorageMock.clear()
    vi.stubGlobal('localStorage', localStorageMock)
  })

  it('upgrades multi-level nodes and aggregates stat bonuses', () => {
    const talent = useTalentStore()

    expect(talent.upgradeTalent('survival_regen')).toBe(true)
    expect(talent.upgradeTalent('survival_regen')).toBe(true)

    expect(talent.talentPoints).toBe(8)
    expect(talent.getLevel('survival_regen')).toBe(2)
    expect(talent.getStatBonuses()).toContainEqual({
      stat: 'hpRegenPercent',
      value: 0.2,
      type: 'flat'
    })
  })

  it('requires prerequisites before higher tier talents can be upgraded', () => {
    const talent = useTalentStore()

    expect(talent.canUnlock('survival_recovery')).toBe(false)
    expect(talent.upgradeTalent('survival_recovery')).toBe(false)

    expect(talent.upgradeTalent('survival_regen')).toBe(true)
    expect(talent.canUnlock('survival_recovery')).toBe(true)
  })

  it('grants boss talent points only once per boss key', () => {
    const talent = useTalentStore()

    expect(talent.grantBossTalentPoint('boss-level-10')).toBe(true)
    expect(talent.grantBossTalentPoint('boss-level-10')).toBe(false)
    expect(talent.talentPoints).toBe(11)
  })

  it('aggregates special bonuses across invested levels', () => {
    const talent = useTalentStore()

    talent.upgradeTalent('treasure_gold')
    talent.upgradeTalent('treasure_gold')
    talent.upgradeTalent('treasure_drop')

    expect(talent.getSpecialBonuses()).toMatchObject({
      goldBonusPercent: 8,
      equipmentDropBonusPercent: 2
    })
  })
})
