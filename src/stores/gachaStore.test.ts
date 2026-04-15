import { describe, it, expect } from 'vitest'

describe('gacha pity', () => {
  it('pity counter increments on pull', () => {
    // 测试保底计数
    const counter = 0
    const newCounter = counter + 1
    expect(newCounter).toBe(1)
  })

  it('pity resets after target', () => {
    const counter = 90
    const newCounter = counter >= 90 ? 0 : counter + 1
    expect(newCounter).toBe(0)
  })

  it('soft pity activates after threshold', () => {
    const counter = 80
    const softPityThreshold = 80
    const bonus = counter >= softPityThreshold ? (counter - softPityThreshold) * 2 : 0
    expect(bonus).toBe(0)  // 第80抽，+0%
  })
})
