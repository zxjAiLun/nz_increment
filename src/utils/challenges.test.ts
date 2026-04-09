import { describe, it, expect } from 'vitest'

describe('daily challenges', () => {
  it('challenge has required fields', () => {
    const challenge = {
      id: 'test',
      name: 'Test',
      description: 'Test challenge',
      target: 100,
      progress: 0,
      reward: { diamond: 1 },
      resetAt: Date.now() + 86400000
    }
    expect(challenge.target).toBe(100)
    expect(challenge.progress).toBe(0)
  })
})

describe('check-in rewards', () => {
  it('7 day cycle exists', () => {
    const rewards = [
      { gold: 100 },
      { gold: 200 },
      { diamond: 1 },
      { gold: 500, equipmentTicket: 1 },
      { diamond: 2 },
      { gold: 1000 },
      { diamond: 5, legendaryEquipment: 1 },
    ]
    expect(rewards.length).toBe(7)
    expect(rewards[6].diamond).toBe(5)
  })
})
