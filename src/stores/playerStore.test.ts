import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { usePlayerStore } from './playerStore'

const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value }),
    removeItem: vi.fn((key: string) => { delete store[key] }),
    clear: vi.fn(() => { store = {} }),
    get length() { return Object.keys(store).length },
    key: vi.fn((index: number) => Object.keys(store)[index] ?? null)
  }
})()

describe('playerStore stat upgrades', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorageMock.clear()
    vi.stubGlobal('localStorage', localStorageMock)
  })

  it('uses a smooth 1.18 cost curve instead of powers of ten', () => {
    const playerStore = usePlayerStore()
    playerStore.player.gold = 10_000

    expect(playerStore.getUpgradeCost('attack')).toBe(10)

    expect(playerStore.upgradeStat('attack', 10)).toBe(true)
    expect(playerStore.getUpgradeCost('attack')).toBe(11)

    for (let i = 0; i < 9; i++) {
      const cost = playerStore.getUpgradeCost('attack')
      expect(playerStore.upgradeStat('attack', cost)).toBe(true)
    }

    expect(playerStore.getUpgradeCost('attack')).toBe(Math.floor(10 * Math.pow(1.18, 10)))
    expect(playerStore.getUpgradeCost('attack')).toBeLessThan(100)
  })

  it('consumes only the configured cost and grants one point', () => {
    const playerStore = usePlayerStore()
    const initialAttack = playerStore.player.stats.attack
    playerStore.player.gold = 100

    expect(playerStore.getPointsForGold('attack')).toBe(1)
    expect(playerStore.upgradeStat('attack', 100)).toBe(true)

    expect(playerStore.player.gold).toBe(90)
    expect(playerStore.player.stats.attack).toBe(initialAttack + 1)
  })

  it('rejects underpaying the current upgrade cost', () => {
    const playerStore = usePlayerStore()
    playerStore.player.gold = 100

    expect(playerStore.upgradeStat('attack', 9)).toBe(false)
    expect(playerStore.player.gold).toBe(100)
  })
})

describe('playerStore 战斗 Buff（Task 1：战斗时间模型）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorageMock.clear()
    vi.stubGlobal('localStorage', localStorageMock)
  })

  it('applyBuff 以 remainingMs 记录，不再依赖 Date.now()', () => {
    const playerStore = usePlayerStore()
    playerStore.applyBuff('attack', 100, 5)
    const buff = playerStore.activeBuffs.get('attack')!
    expect(buff).toBeDefined()
    expect(buff.value).toBe(100)
    expect(buff.remainingMs).toBe(5000)
    expect('endTime' in buff).toBe(false)
  })

  it('updateActiveBuffs 按战斗毫秒递减，到期从 Map 移除并退出 totalStats', () => {
    const playerStore = usePlayerStore()
    playerStore.applyBuff('attack', 100, 5)
    // 施加后 totalStats.attack 应被放大
    const boosted = playerStore.totalStats.attack
    expect(boosted).toBeGreaterThan(playerStore.player.stats.attack)

    // 推进 3 秒战斗时间：仍未到期
    playerStore.updateActiveBuffs(3000)
    expect(playerStore.activeBuffs.has('attack')).toBe(true)
    expect(playerStore.totalStats.attack).toBe(boosted)

    // 再推进 2 秒：恰好到期，移除
    playerStore.updateActiveBuffs(2000)
    expect(playerStore.activeBuffs.has('attack')).toBe(false)
    expect(playerStore.totalStats.attack).toBe(playerStore.player.stats.attack)
  })

  it('gameSpeed=2 时 Buff 以两倍速度递减（4 秒战斗 = 2 秒有效窗口后到期）', () => {
    const playerStore = usePlayerStore()
    playerStore.applyBuff('attack', 50, 5)
    // 模拟 gameSpeed=2：每帧 effectiveDelta = 2000ms
    playerStore.updateActiveBuffs(2000)
    playerStore.updateActiveBuffs(2000)
    // 累计 4 秒有效战斗时间 → 剩余 1 秒 → 未到期
    expect(playerStore.activeBuffs.has('attack')).toBe(true)
    // 再推进 2 秒有效战斗（含已不足的 1 秒）→ 到期
    playerStore.updateActiveBuffs(2000)
    expect(playerStore.activeBuffs.has('attack')).toBe(false)
  })

  it('重复施加同属性 Buff 刷新（覆盖）value 与剩余时间，不叠加', () => {
    const playerStore = usePlayerStore()
    playerStore.applyBuff('attack', 100, 5)
    playerStore.applyBuff('attack', 100, 5) // 再次施加，应刷新到 5 秒
    expect(playerStore.activeBuffs.size).toBe(1)
    expect(playerStore.activeBuffs.get('attack')!.remainingMs).toBe(5000)
  })

  it('暂停期间（不调用 updateActiveBuffs）Buff 不递减', () => {
    const playerStore = usePlayerStore()
    playerStore.applyBuff('defense', 30, 5)
    // 不调用 updateActiveBuffs，remainingMs 不变
    expect(playerStore.activeBuffs.get('defense')!.remainingMs).toBe(5000)
  })
})
