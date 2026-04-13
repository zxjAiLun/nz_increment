import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useDungeonStore } from './dungeonStore'

describe('dungeonStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('initFloors creates 20 floors with correct initial state', () => {
    const store = useDungeonStore()
    // load() calls initFloors() internally when no saved data
    store.load()
    expect(store.floors).toHaveLength(20)
    expect(store.floors[0].floor).toBe(1)
    expect(store.floors[0].status).toBe('available')
    expect(store.floors[4].bossAppears).toBe(true) // floor 5 is boss
    expect(store.floors[19].bossAppears).toBe(true) // floor 20 is boss
  })

  it('challengeFloor reduces floor health and unlocks next on clear', () => {
    const store = useDungeonStore()
    store.load()
    const floor1 = store.floors[0]
    expect(floor1.status).toBe('available')
    // Deal enough damage to clear floor 1
    const cleared = store.challengeFloor(1, floor1.totalHealth)
    expect(cleared).toBe(true)
    expect(floor1.status).toBe('cleared')
    expect(store.progress.totalCleared).toBe(1)
    expect(store.progress.highestFloor).toBe(1)
    // Next floor should be unlocked
    expect(store.floors[1].status).toBe('available')
  })

  it('challengeFloor blocks locked floors', () => {
    const store = useDungeonStore()
    store.load()
    // Try to challenge floor 5 (should be locked initially)
    store.floors[4].status = 'locked'
    const result = store.challengeFloor(5, 1000)
    expect(result).toBe(false)
  })

  it('resetFloor restores floor health and locks it', () => {
    const store = useDungeonStore()
    store.load()
    store.floors[0].status = 'cleared'
    store.resetFloor(1)
    expect(store.floors[0].currentHealth).toBe(store.floors[0].totalHealth)
    expect(store.floors[0].status).toBe('available')
  })

  it('availableFloors returns only available or current floors', () => {
    const store = useDungeonStore()
    store.load()
    const available = store.availableFloors
    expect(available.length).toBeGreaterThan(0)
    available.forEach(f => {
      expect(f.status === 'available' || f.status === 'current').toBe(true)
    })
  })

  it('claimFloorReward returns null for non-cleared floors', () => {
    const store = useDungeonStore()
    store.load()
    const rewards = store.claimFloorReward(1)
    expect(rewards).toBeNull()
  })

  it('claimFloorReward returns rewards for cleared floors', () => {
    const store = useDungeonStore()
    store.load()
    store.floors[0].status = 'cleared'
    const rewards = store.claimFloorReward(1)
    expect(rewards).not.toBeNull()
    expect(rewards!.length).toBeGreaterThan(0)
  })
})
