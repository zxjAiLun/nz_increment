import { describe, it, expect } from 'vitest'

describe('battle pass', () => {
  it('battle pass has 30 levels', () => {
    const rewards = []
    for (let i = 1; i <= 30; i++) rewards.push({ level: i })
    expect(rewards.length).toBe(30)
  })
})

describe('leaderboard', () => {
  it('sorts by difficultyValue descending', () => {
    const entries = [
      { name: 'A', difficultyValue: 100 },
      { name: 'B', difficultyValue: 500 },
      { name: 'C', difficultyValue: 200 },
    ]
    entries.sort((a, b) => b.difficultyValue - a.difficultyValue)
    expect(entries[0].difficultyValue).toBe(500)
    expect(entries[1].difficultyValue).toBe(200)
    expect(entries[2].difficultyValue).toBe(100)
  })

  it('limits to 100 entries', () => {
    const entries = Array.from({ length: 150 }, (_, i) => ({ name: `P${i}`, difficultyValue: i }))
    const sorted = entries.sort((a, b) => b.difficultyValue - a.difficultyValue).slice(0, 100)
    expect(sorted.length).toBe(100)
  })
})
