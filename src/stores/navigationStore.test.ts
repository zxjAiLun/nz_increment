import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useMonsterStore } from './monsterStore'
import { useNavigationStore } from './navigationStore'

const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value }),
    removeItem: vi.fn((key: string) => { delete store[key] }),
    clear: vi.fn(() => { store = {} })
  }
})()

describe('navigationStore mainline unlocks', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorageMock.clear()
    vi.stubGlobal('localStorage', localStorageMock)
  })

  it('starts with only core 0-10 systems visible', () => {
    const nav = useNavigationStore()

    expect(nav.primaryTabs.map(tab => tab.id)).toEqual(['adventure', 'build', 'growth'])
    expect(nav.secondaryPages.map(page => page.id)).toEqual(['main'])
  })

  it('unlocks gacha and cultivation after difficulty 10', () => {
    const monsterStore = useMonsterStore()
    monsterStore.setProgress(10, 1)
    const nav = useNavigationStore()

    expect(nav.primaryTabs.map(tab => tab.id)).toContain('resources')
    nav.selectPrimary('resources')
    expect(nav.secondaryPages.map(page => page.id)).toEqual(['shopGacha'])
    nav.selectPrimary('growth')
    expect(nav.secondaryPages.map(page => page.id)).toContain('cultivation')
  })

  it('unlocks skills and bonus pages at difficulty 20 before auto-build', () => {
    const monsterStore = useMonsterStore()
    monsterStore.setProgress(20, 1)
    const nav = useNavigationStore()

    nav.selectPrimary('build')
    expect(nav.secondaryPages.map(page => page.id)).toEqual(['equipment', 'skills', 'bonus'])
    expect(nav.nextUnlockStage?.minDifficulty).toBe(30)
  })

  it('unlocks auto-build and resource support at difficulty 30', () => {
    const monsterStore = useMonsterStore()
    monsterStore.setProgress(30, 1)
    const nav = useNavigationStore()

    nav.selectPrimary('build')
    expect(nav.secondaryPages.map(page => page.id)).toContain('autoBuild')
    nav.selectPrimary('resources')
    expect(nav.secondaryPages.map(page => page.id)).toContain('signinOffline')
  })

  it('unlocks challenge pages at difficulty 100', () => {
    const monsterStore = useMonsterStore()
    monsterStore.setProgress(100, 1)
    const nav = useNavigationStore()

    expect(nav.primaryTabs.map(tab => tab.id)).toContain('challenge')
    nav.selectPrimary('challenge')
    expect(nav.secondaryPages.map(page => page.id)).toEqual(['dungeon', 'bossRush'])
  })

  it('normalizes locked routes back to the first unlocked page', () => {
    const nav = useNavigationStore()

    nav.setRoute({ primary: 'challenge', secondary: 'bossRush' })

    expect(nav.route.primary).toBe('adventure')
    expect(nav.route.secondary).toBe('main')
  })
})
