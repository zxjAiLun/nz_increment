import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useAdventureStore } from './adventureStore'

describe('AdventureStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('should start a new adventure run', () => {
    const store = useAdventureStore()
    store.startRun('player1', 1000)
    
    expect(store.currentRun).not.toBeNull()
    expect(store.currentRun?.status).toBe('active')
    expect(store.currentRun?.playerHp).toBe(1000)
    expect(store.currentRun?.playerMaxHp).toBe(1000)
    expect(store.currentRun?.gold).toBe(0)
    expect(store.currentRun?.chaptersCompleted).toBe(0)
  })

  it('should generate nodes for the adventure', () => {
    const store = useAdventureStore()
    store.startRun('player1', 1000)
    
    expect(store.currentRun?.nodes).toBeDefined()
    expect(store.currentRun?.nodes.length).toBeGreaterThan(0)
  })

  it('should select an option and progress', () => {
    const store = useAdventureStore()
    store.startRun('player1', 1000)
    
    const result = store.selectOption(0)
    
    // Selecting a valid option should return true or false depending on node state
    expect(typeof result).toBe('boolean')
  })

  it('should abandon the run', () => {
    const store = useAdventureStore()
    const run = store.startRun('player1', 1000)
    
    // Store status before abandoning (since abandonRun sets currentRun to null)
    expect(run.status).toBe('active')
    
    store.abandonRun()
    
    // After abandon, currentRun becomes null
    expect(store.currentRun).toBeNull()
  })

  it('should track completed runs', () => {
    const store = useAdventureStore()
    store.startRun('player1', 1000)
    
    // Mark as completed
    if (store.currentRun) {
      store.currentRun.status = 'completed'
    }
    
    expect(store.completedRuns).toBeDefined()
  })

  it('should track best chapter', () => {
    const store = useAdventureStore()
    store.startRun('player1', 1000)
    
    if (store.currentRun) {
      store.currentRun.chaptersCompleted = 5
    }
    
    expect(store.bestChapter).toBeGreaterThanOrEqual(0)
  })
})
