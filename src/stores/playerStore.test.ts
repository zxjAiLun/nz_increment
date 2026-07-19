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
    const ps = usePlayerStore()
    ps.player.gold = 10_000

    expect(ps.getUpgradeCost('attack')).toBe(10)
    expect(ps.tryUpgradeStat('attack')).toBe(true)
    expect(ps.getUpgradeCost('attack')).toBe(11) // floor(10*1.1^1)

    expect(ps.tryUpgradeStat('attack')).toBe(true)
    expect(ps.getUpgradeCost('attack')).toBe(12) // floor(10*1.1^2)

    // 10th upgrade: floor(10*1.1^10) = 25
    for (let i = 0; i < 8; i++) {
      expect(ps.tryUpgradeStat('attack')).toBe(true)
    }
    expect(ps.getUpgradeCost('attack')).toBe(Math.floor(10 * Math.pow(1.1, 10)))
  })

  it('consumes configured cost and grants effectPerLevel (attack=+2)', () => {
    const ps = usePlayerStore()
    const initialAttack = ps.player.stats.attack
    ps.player.gold = 100

    expect(ps.getPointsForGold('attack')).toBe(2)
    // tryUpgradeStat internally computes cost=10, deducts 10
    expect(ps.tryUpgradeStat('attack')).toBe(true)

    expect(ps.player.gold).toBe(90)
    expect(ps.player.stats.attack).toBe(initialAttack + 2)
  })

  it('rejects when gold < internal cost (9 vs 10)', () => {
    const ps = usePlayerStore()
    ps.player.gold = 9  // < 10

    expect(ps.tryUpgradeStat('attack')).toBe(false)
    expect(ps.player.gold).toBe(9)
  })
})

describe('playerStore attribute upgrades — Phase 2.1.1', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorageMock.clear()
    vi.stubGlobal('localStorage', localStorageMock)
  })

  function unlockUpToPhase3(store: ReturnType<typeof usePlayerStore>) {
    store.player.unlockedPhases = [1, 2, 3]
  }

  // ── 五项属性：前三档价格、第一次效果、精确金币、差 1、count 递增、保存重载 ──

  const ALL_UPGRADEABLE = [
    { stat: 'attack' as const,     label: '攻击',      baseCost: 10, growth: 1.1,  first3: [10, 11, 12], effect: 2 },
    { stat: 'defense' as const,    label: '防御',      baseCost: 10, growth: 1.1,  first3: [10, 11, 12], effect: 2 },
    { stat: 'maxHp' as const,      label: '生命',      baseCost: 10, growth: 1.1,  first3: [10, 11, 12], effect: 20 },
    { stat: 'speed' as const,      label: '速度',      baseCost: 10, growth: 1.1,  first3: [10, 11, 12], effect: 1 },
    { stat: 'penetration' as const,label: '穿透',      baseCost: 50, growth: 1.15, first3: [50, 57, 66], effect: 5 },
  ]

  it.each(ALL_UPGRADEABLE)('$label: first 3 costs are $first3, first effect = +$effect', ({ stat, first3, effect, baseCost, growth }) => {
    const store = usePlayerStore()
    if (stat === 'penetration') unlockUpToPhase3(store)
    const initial = store.player.stats[stat]
    store.player.gold = 10_000

    // 第 1 次购买
    expect(store.getUpgradeCost(stat)).toBe(first3[0])
    expect(store.getPointsForGold(stat)).toBe(effect)
    expect(store.canUpgradeStat(stat)).toBe(true)
    expect(store.tryUpgradeStat(stat)).toBe(true)
    expect(store.player.stats[stat]).toBe(initial + effect)
    expect(store.player.gold).toBe(10_000 - first3[0])

    // 第 2 次购买
    expect(store.getUpgradeCost(stat)).toBe(first3[1])
    expect(store.tryUpgradeStat(stat)).toBe(true)
    expect(store.player.stats[stat]).toBe(initial + effect * 2)
    expect(store.statUpgradeCounts.get(stat)).toBe(2)

    // 第 3 次购买
    expect(store.getUpgradeCost(stat)).toBe(first3[2])
    expect(store.tryUpgradeStat(stat)).toBe(true)

    // 保存重载后价格一致
    store.saveGame()
    const saved = localStorageMock.getItem('lollipop_adventure_save')
    localStorageMock.clear()
    localStorageMock.setItem('lollipop_adventure_save', saved!)
    setActivePinia(createPinia())
    const store2 = usePlayerStore()
    store2.loadGame()
    if (stat === 'penetration') unlockUpToPhase3(store2)
    expect(store2.getUpgradeCost(stat)).toBe(Math.floor(baseCost * growth ** 3))
    expect(store2.statUpgradeCounts.get(stat)).toBe(3)
  })

  it('attack: exact gold works, gold-1 fails', () => {
    const store = usePlayerStore()
    store.player.gold = 10  // exact cost
    expect(store.tryUpgradeStat('attack')).toBe(true)
    expect(store.player.gold).toBe(0)

    store.player.gold = 10  // now count=1, cost=11, gold=10 < 11
    expect(store.tryUpgradeStat('attack')).toBe(false)
    expect(store.player.gold).toBe(10)
  })

  // ── HP 外部加成回归 ──

  it('HP with +100% buff: buying upgrade does not clamp to base-only maxHp', () => {
    const store = usePlayerStore()
    store.player.currentHp = 180
    // Apply a +100% buff → totalStats will show effective maxHp = base * 2 = 200
    store.applyBuff('maxHp', 100, 10)
    const effectiveMaxBefore = store.totalStats.maxHp
    expect(effectiveMaxBefore).toBe(200)
    expect(store.player.maxHp).toBe(200)

    store.player.gold = 10
    expect(store.tryUpgradeStat('maxHp')).toBe(true)

    // base maxHp = 120, effective = 120 * (1 + 100/100) = 240
    expect(store.player.stats.maxHp).toBe(120)
    expect(store.totalStats.maxHp).toBe(240)
    expect(store.player.maxHp).toBe(240)
    // currentHp = min(240, 180 + 20) = 200
    expect(store.player.currentHp).toBe(200)
  })

  it('HP with external pet maxHp: preserves currentHp correctly', () => {
    const store = usePlayerStore()
    store.player.stats.maxHp = 100
    store.player.currentHp = 150
    store.player.gold = 10

    // Simulate a pet bonus by directly setting player.maxHp (as totalStats would)
    // Then the upgrade reads totalStats.value.maxHp which uses stats + pet
    // But we can't easily add a pet in a unit test. Instead, use the buff approach again.
    // This test validates the mechanics: after upgrade, maxHp = totalStats recomputed value
    // Without external sources, effective = base = 120, current = min(120, 150+20) = 170
    // Wait — we need external source. Use buff:
    store.applyBuff('maxHp', 50, 10) // +50% → effective = 100 * 1.5 = 150
    expect(store.totalStats.maxHp).toBe(150)

    expect(store.tryUpgradeStat('maxHp')).toBe(true)
    // base=120, effective=120*1.5=180, current=min(180, 150+20)=170
    expect(store.player.stats.maxHp).toBe(120)
    expect(store.player.maxHp).toBe(180)
    expect(store.player.currentHp).toBe(170)
  })

  // ── isStatUpgradeable ──

  it('isStatUpgradeable: only 5 configured stats return true', () => {
    const store = usePlayerStore()
    for (const { stat } of ALL_UPGRADEABLE) {
      expect(store.isStatUpgradeable(stat)).toBe(true)
    }
    expect(store.isStatUpgradeable('luck')).toBe(false)
    expect(store.isStatUpgradeable('critRate')).toBe(false)
    expect(store.isStatUpgradeable('dodge')).toBe(false)
  })

  // ── tryUpgradeStat API: 无参数，内部算价 ──

  it('tryUpgradeStat computes cost internally, cannot be underpaid', () => {
    const store = usePlayerStore()
    store.player.gold = 9  // < 10, should fail
    expect(store.tryUpgradeStat('attack')).toBe(false)
    expect(store.player.gold).toBe(9)
    expect(store.statUpgradeCounts.get('attack')).toBeUndefined()

    store.player.gold = 10
    expect(store.tryUpgradeStat('attack')).toBe(true)
    expect(store.player.gold).toBe(0)
  })

  it('tryUpgradeStat: unconfigured stat returns false atomically', () => {
    const store = usePlayerStore()
    const g = store.player.gold
    expect(store.tryUpgradeStat('luck')).toBe(false)
    expect(store.player.gold).toBe(g)
  })

  // ── 有限值校验 ──

  it('finite validation: rejects malformed player.gold', () => {
    const store = usePlayerStore()
    store.player.gold = NaN
    expect(store.tryUpgradeStat('attack')).toBe(false)

    store.player.gold = Infinity
    expect(store.tryUpgradeStat('attack')).toBe(false)

    store.player.gold = -1
    expect(store.tryUpgradeStat('attack')).toBe(false)
  })

  it('finite validation: rejects malformed player.stats value', () => {
    const store = usePlayerStore()
    store.player.gold = 100
    // @ts-expect-error — setting string value
    store.player.stats.attack = '10'
    expect(store.tryUpgradeStat('attack')).toBe(false)

    store.player.stats.attack = NaN
    expect(store.tryUpgradeStat('attack')).toBe(false)
  })

  it('load: malformed player stats (string, null) are accepted by load but rejected on purchase', () => {
    const malformed = JSON.stringify({
      player: { gold: 100, stats: { attack: '10', maxHp: null }, maxHp: 100 },
    })
    localStorageMock.setItem('lollipop_adventure_save', malformed)
    setActivePinia(createPinia())
    const store = usePlayerStore()
    store.loadGame()

    // Saved string '10' stays as-is; purchase should reject it
    expect(store.tryUpgradeStat('attack')).toBe(false)
    expect(store.player.gold).toBe(100)
  })

  // ── 转生/重置清空 ──

  it('resetGame clears statUpgradeCounts', () => {
    const store = usePlayerStore()
    store.player.gold = 100
    store.tryUpgradeStat('attack')
    store.tryUpgradeStat('defense')
    expect(store.statUpgradeCounts.size).toBe(2)

    store.resetGame()
    expect(store.statUpgradeCounts.size).toBe(0)
    expect(store.getUpgradeCost('attack')).toBe(10)
    expect(store.player.stats.attack).toBe(10)
  })

  it('resetForRebirth clears statUpgradeCounts and resets stats to default', () => {
    const store = usePlayerStore()
    store.player.gold = 100
    store.tryUpgradeStat('attack')
    store.tryUpgradeStat('attack') // count=2
    store.tryUpgradeStat('speed')

    expect(store.player.stats.attack).toBe(14) // 10 + 2*2
    expect(store.statUpgradeCounts.get('attack')).toBe(2)

    store.resetForRebirth()
    expect(store.statUpgradeCounts.size).toBe(0)
    expect(store.player.stats.attack).toBe(10)
    expect(store.getUpgradeCost('attack')).toBe(10)
    expect(store.getUpgradeCost('speed')).toBe(10)
  })

  // ── 旧 API 别名 ──

  it('old upgradeStat(stat, _goldAmount) alias delegates to tryUpgradeStat', () => {
    const store = usePlayerStore()
    store.player.gold = 10
    // The old alias ignores goldAmount; cost is internal
    expect(store.upgradeStat('attack', 999)).toBe(true)
    expect(store.player.gold).toBe(0)
    expect(store.player.stats.attack).toBe(12)
  })

  // ── 存档迁移 ──

  it('save/load round-trip: preserves statUpgradeCounts', () => {
    const store = usePlayerStore()
    store.player.gold = 10_000
    store.tryUpgradeStat('attack')
    store.tryUpgradeStat('attack')
    store.tryUpgradeStat('defense')
    store.tryUpgradeStat('maxHp')

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
    expect(store2.getUpgradeCost('attack')).toBe(Math.floor(10 * 1.1 ** 2))
    expect(store2.getUpgradeCost('speed')).toBe(10)
  })

  it('load migration: old save without statUpgradeCounts initializes Map empty', () => {
    const oldSave = JSON.stringify({ player: { gold: 500, stats: { attack: 30 }, maxHp: 100 } })
    localStorageMock.setItem('lollipop_adventure_save', oldSave)
    setActivePinia(createPinia())
    const store = usePlayerStore()
    store.loadGame()
    expect(store.statUpgradeCounts.size).toBe(0)
    expect(store.getUpgradeCost('attack')).toBe(10)
  })

  it('load migration: malformed entries sanitized', () => {
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
    expect(store.statUpgradeCounts.get('attack')).toBe(3)
    expect(store.statUpgradeCounts.get('defense')).toBe(0)
    expect(store.statUpgradeCounts.get('speed')).toBe(0)
    expect(store.statUpgradeCounts.has('luck')).toBe(false)
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
