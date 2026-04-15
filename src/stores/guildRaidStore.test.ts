import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useGuildRaidStore } from './guildRaidStore'

describe('GuildRaidStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('should load raid data', () => {
    const store = useGuildRaidStore()
    store.load()
    
    expect(store.raids).toBeDefined()
    expect(store.raids.length).toBeGreaterThan(0)
  })

  it('should challenge a raid', () => {
    const store = useGuildRaidStore()
    store.load()
    
    const result = store.challengeRaid('raid_1', 'player1', 'TestPlayer', 10000)
    
    expect(result).toBe(true)
  })

  it('should track player damage records', () => {
    const store = useGuildRaidStore()
    store.load()
    
    store.challengeRaid('raid_1', 'player1', 'TestPlayer', 10000)
    
    const records = store.getRaidRankings('raid_1')
    expect(records.length).toBeGreaterThan(0)
    expect(records[0].playerName).toBe('TestPlayer')
  })

  it('should get remaining attempts', () => {
    const store = useGuildRaidStore()
    store.load()
    
    const remaining = store.getRemainingAttempts('raid_1')
    expect(remaining).toBeGreaterThanOrEqual(0)
  })

  it('should update season stats on damage', () => {
    const store = useGuildRaidStore()
    store.load()
    
    const initialTotal = store.raidSeason.totalDamage
    store.updateSeasonStats('player1', 'TestPlayer', 50000)
    
    expect(store.raidSeason.totalDamage).toBe(initialTotal + 50000)
    expect(store.raidSeason.topPlayer).toBe('TestPlayer')
  })

  it('should claim season rewards', () => {
    const store = useGuildRaidStore()
    store.load()
    
    store.updateSeasonStats('player1', 'TestPlayer', 100000)
    const rewards = store.claimSeasonRewards('player1')
    
    expect(rewards).toBeDefined()
  })

  it('should get weekly ranking rewards', () => {
    const store = useGuildRaidStore()
    store.load()
    
    // Add some damage records
    store.challengeRaid('raid_1', 'player1', 'Player1', 50000)
    store.challengeRaid('raid_1', 'player2', 'Player2', 30000)
    
    const rankings = store.getWeeklyRankingRewards('raid_1')
    expect(rankings).toBeDefined()
  })
})
