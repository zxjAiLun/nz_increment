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

  it('uses per-stat costGrowth (attack=1.1) — first 3 prices: 10, 11, 12', () => {
    const playerStore = usePlayerStore()
    playerStore.player.gold = 10_000

    expect(playerStore.getUpgradeCost('attack')).toBe(10)
    expect(playerStore.upgradeStat('attack', 10)).toBe(true)
    expect(playerStore.getUpgradeCost('attack')).toBe(11) // floor(10*1.1^1)

    expect(playerStore.upgradeStat('attack', 11)).toBe(true)
    expect(playerStore.getUpgradeCost('attack')).toBe(12) // floor(10*1.1^2)

    // 10th upgrade: floor(10*1.1^10) = 25
    for (let i = 0; i < 8; i++) {
      const cost = playerStore.getUpgradeCost('attack')
      expect(playerStore.upgradeStat('attack', cost)).toBe(true)
    }
    expect(playerStore.getUpgradeCost('attack')).toBe(Math.floor(10 * Math.pow(1.1, 10)))
  })

  it('consumes configured cost and grants effectPerLevel (attack=+2)', () => {
    const playerStore = usePlayerStore()
    const initialAttack = playerStore.player.stats.attack
    playerStore.player.gold = 100

    // 第一次购买 cost=10, 获得 attack+2
    expect(playerStore.getPointsForGold('attack')).toBe(2)
    expect(playerStore.upgradeStat('attack', 10)).toBe(true)

    expect(playerStore.player.gold).toBe(90)
    expect(playerStore.player.stats.attack).toBe(initialAttack + 2)
  })

  it('rejects underpaying the current upgrade cost', () => {
    const playerStore = usePlayerStore()
    playerStore.player.gold = 100

    expect(playerStore.upgradeStat('attack', 9)).toBe(false)
    expect(playerStore.player.gold).toBe(100)
  })
})

describe('playerStore attribute upgrades — Phase 2.1 table-driven', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorageMock.clear()
    vi.stubGlobal('localStorage', localStorageMock)
  })

  // Only basic-category stats are unlocked by default (phase 1).
  // Penetration is 'advanced' (phase 3); use a helper to unlock it when needed.
  function unlockUpToPhase3(store: ReturnType<typeof usePlayerStore>) {
    store.player.unlockedPhases = [1, 2, 3]
  }

  const P2_BASIC_CASES = [
    { stat: 'attack' as const,     label: '攻击',   baseCost: 10, growth: 1.1, effectPerLevel: 2,  firstCost: 10 },
    { stat: 'defense' as const,    label: '防御',   baseCost: 10, growth: 1.1, effectPerLevel: 2,  firstCost: 10 },
    { stat: 'maxHp' as const,      label: '生命',   baseCost: 10, growth: 1.1, effectPerLevel: 20, firstCost: 10 },
    { stat: 'speed' as const,      label: '速度',   baseCost: 10, growth: 1.1, effectPerLevel: 1,  firstCost: 10 },
  ]

  it.each(P2_BASIC_CASES)('first purchase: $label cost=$firstCost effect=+$effectPerLevel', ({ stat, firstCost, effectPerLevel }) => {
    const store = usePlayerStore()
    const initial = store.player.stats[stat]
    store.player.gold = firstCost

    expect(store.getUpgradeCost(stat)).toBe(firstCost)
    expect(store.getPointsForGold(stat)).toBe(effectPerLevel)
    expect(store.canUpgradeStat(stat)).toBe(true)
    expect(store.upgradeStat(stat, firstCost)).toBe(true)

    expect(store.player.gold).toBe(0)
    expect(store.player.stats[stat]).toBe(initial + effectPerLevel)
  })

  it('penetration: first 3 costs use growth=1.15 (50, 57, 66)', () => {
    const store = usePlayerStore()
    unlockUpToPhase3(store)
    store.player.gold = 10_000

    expect(store.getUpgradeCost('penetration')).toBe(50)
    expect(store.upgradeStat('penetration', 50)).toBe(true)
    expect(store.getUpgradeCost('penetration')).toBe(Math.floor(50 * 1.15 ** 1)) // 57

    expect(store.upgradeStat('penetration', store.getUpgradeCost('penetration'))).toBe(true)
    expect(store.getUpgradeCost('penetration')).toBe(Math.floor(50 * 1.15 ** 2)) // 66
  })

  it('HP upgrade: maxHp +20 and currentHp +20 simultaneously', () => {
    const store = usePlayerStore()
    store.player.currentHp -= 10
    const oldMax = store.player.maxHp
    const oldCur = store.player.currentHp
    store.player.gold = 10

    expect(store.upgradeStat('maxHp', 10)).toBe(true)
    expect(store.player.maxHp).toBe(oldMax + 20)
    expect(store.player.currentHp).toBe(oldCur + 20)

    // Second upgrade: after setting currentHp < maxHp, both increase by 20
    store.player.gold = 12
    store.player.currentHp = store.player.maxHp - 5
    const prevMax = store.player.maxHp
    const prevCur = store.player.currentHp
    expect(store.upgradeStat('maxHp', 12)).toBe(true)
    expect(store.player.maxHp).toBe(prevMax + 20)
    expect(store.player.currentHp).toBe(prevCur + 20)
  })

  it('rejects invalid stat, returns false atomically (no mutation)', () => {
    const store = usePlayerStore()
    const goldBefore = store.player.gold

    // 'luck' is a valid StatType but not in ATTRIBUTE_UPGRADES
    expect(store.upgradeStat('luck', 999)).toBe(false)
    expect(store.player.gold).toBe(goldBefore)
  })

  it('rejects insufficient gold on player (gold < cost)', () => {
    const store = usePlayerStore()
    store.player.gold = 0

    expect(store.upgradeStat('attack', 10)).toBe(false)
    // default attack is 10; no change
    expect(store.player.stats.attack).toBe(10)
  })

  it('rejects insufficient goldAmount parameter (goldAmount < cost)', () => {
    const store = usePlayerStore()
    store.player.gold = 100

    expect(store.upgradeStat('attack', 5)).toBe(false)
    expect(store.player.gold).toBe(100)
  })

  it('unconfigured stat (luck) returns Infinity cost, 0 effect, canUpgradeStat false', () => {
    const store = usePlayerStore()
    // 'luck' is a valid StatType but not in ATTRIBUTE_UPGRADES
    expect(store.getUpgradeCost('luck')).toBe(Infinity)
    expect(store.getPointsForGold('luck')).toBe(0)
    expect(store.canUpgradeStat('luck')).toBe(false)
  })

  it('save/load round-trip: preserves statUpgradeCounts', () => {
    const store = usePlayerStore()
    store.player.gold = 10_000
    store.upgradeStat('attack', 10)   // lv0→1
    store.upgradeStat('attack', 11)   // lv1→2
    store.upgradeStat('defense', 10)  // lv0→1
    store.upgradeStat('maxHp', 10)    // lv0→1

    // Simulate reload: re-create store (new Pinia) → loadGame reads localStorage
    const saved = localStorageMock.getItem('lollipop_adventure_save')
    expect(saved).not.toBeNull()

    localStorageMock.clear()
    localStorageMock.setItem('lollipop_adventure_save', saved!)

    setActivePinia(createPinia())
    const store2 = usePlayerStore()
    store2.loadGame()
    expect(store2.statUpgradeCounts.get('attack')).toBe(2)
    expect(store2.statUpgradeCounts.get('defense')).toBe(1)
    expect(store2.statUpgradeCounts.get('maxHp')).toBe(1)
    // speed: never purchased → should be 0 (not in save)
    expect(store2.statUpgradeCounts.get('speed')).toBeUndefined()

    // Verify cost consistency after reload
    expect(store2.getUpgradeCost('attack')).toBe(Math.floor(10 * 1.1 ** 2)) // 12
    expect(store2.getUpgradeCost('speed')).toBe(10) // lv0
  })

  it('load migration: old save without statUpgradeCounts initializes Map empty', () => {
    const oldSave = JSON.stringify({
      player: { gold: 500, stats: { attack: 30 }, maxHp: 100 },
    })
    localStorageMock.setItem('lollipop_adventure_save', oldSave)

    setActivePinia(createPinia())
    const store = usePlayerStore()
    store.loadGame()
    expect(store.statUpgradeCounts.size).toBe(0)
    expect(store.getUpgradeCost('attack')).toBe(10) // lv0
  })

  it('load migration: malformed entries (negative, NaN, unknown stat) are sanitized', () => {
    const malformed = JSON.stringify({
      player: { gold: 500, stats: { attack: 30, defense: 22 }, maxHp: 100 },
      statUpgradeCounts: [
        ['attack', 3],
        ['defense', -1],
        ['speed', 'abc'],
        ['luck', 99],
      ],
    })
    localStorageMock.setItem('lollipop_adventure_save', malformed)

    setActivePinia(createPinia())
    const store = usePlayerStore()
    store.loadGame()
    // attack=3 is valid and kept
    expect(store.statUpgradeCounts.get('attack')).toBe(3)
    // defense=-1 sanitized to 0
    expect(store.statUpgradeCounts.get('defense')).toBe(0)
    // speed='abc' → NaN → 0
    expect(store.statUpgradeCounts.get('speed')).toBe(0)
    // 'luck' is not a known stat → filtered out
    expect(store.statUpgradeCounts.has('luck')).toBe(false)
  })

  it('statUpgradeCounts is read-only exported; initial state is empty Map', () => {
    const store = usePlayerStore()
    expect(store.statUpgradeCounts.size).toBe(0)
  })

  it('getUpgradeCost, getPointsForGold, canUpgradeStat are consistent after multiple upgrades', () => {
    const store = usePlayerStore()
    store.player.gold = 10_000

    const stat = 'speed'
    const initial = store.player.stats[stat]

    for (let i = 0; i < 5; i++) {
      const cost = store.getUpgradeCost(stat)
      expect(store.canUpgradeStat(stat)).toBe(true)
      expect(store.getPointsForGold(stat)).toBe(1) // speed effectPerLevel=1

      expect(store.upgradeStat(stat, cost)).toBe(true)
    }

    // After 5 upgrades: stat = initial + 5, count=5, next cost = floor(10*1.1^5) = 16
    expect(store.player.stats[stat]).toBe(initial + 5)
    expect(store.statUpgradeCounts.get(stat)).toBe(5)
    expect(store.getUpgradeCost(stat)).toBe(Math.floor(10 * 1.1 ** 5)) // 16

    // After draining gold to 0, canUpgradeStat returns false
    store.player.gold = 0
    expect(store.canUpgradeStat(stat)).toBe(false)
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
