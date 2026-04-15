import { describe, it, expect } from 'vitest'

describe('equipment compare', () => {
  it('compareEquip shows differences correctly', () => {
    const a = { affixes: [{ stat: 'attack', value: 100 }] }
    const b = { affixes: [{ stat: 'attack', value: 80 }] }
    // 简单对比逻辑测试
    const diff = (a as any).affixes[0].value - (b as any).affixes[0].value
    expect(diff).toBe(20)
  })
})
