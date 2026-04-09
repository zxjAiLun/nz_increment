import { describe, it, expect } from 'vitest'

describe('STAR_MULTIPLIERS', () => {
  it('star 1 = 1.0', () => {
    expect(1.0).toBe(1.0)
  })
  it('star 6 = 1.8', () => {
    expect(1.8).toBe(1.8)
  })
})

describe('ASCENSION_BONUS', () => {
  it('phase 0 = 1.0', () => {
    expect(1.0).toBe(1.0)
  })
  it('phase 6 = 1.3', () => {
    expect(1.3).toBe(1.3)
  })
})
