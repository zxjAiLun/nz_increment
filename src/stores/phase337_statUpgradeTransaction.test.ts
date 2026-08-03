import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
// @ts-ignore —— 测试运行于 Node，无需在应用 tsconfig 中引入 @types/node 全局类型
import { readFileSync } from 'node:fs'
// @ts-ignore
import { resolve } from 'node:path'
import { usePlayerStore } from './playerStore'
import { useThemeStore } from './themeStore'
import { useMonsterStore } from './monsterStore'
import { useGameStore } from './gameStore'
import { useTrainingStore } from './trainingStore'
import { useCultivationStore } from './cultivationStore'
import { useTitleStore } from './titleStore'
import { usePetStore } from './petStore'
import { useRebirthStore } from './rebirthStore'
import { useTalentStore } from './talentStore'
import { useBattlePassStore } from './battlePassStore'
import { useCollectionStore } from './collectionStore'
import { ATTRIBUTE_UPGRADES } from './playerStore'
import type { StatType } from '../types'
// @ts-ignore
declare const process: { cwd(): string }

const SAVE_KEY = 'lollipop_adventure_save'

/**
 * Phase 3.37 — 属性强化（主存档单一原子事务）。
 *
 * 事务本体：playerStore.tryUpgradeStat —— 前置校验 → 快照 → 候选修改（扣金/加属性/计数+1/
 * maxHp 生命语义）→ 恰好一次 saveGame → 成功才返回 true；saveGame 返回 false 或抛异常
 * （以及候选阶段任何异常）→ 完整回滚 gold、stats[stat]、currentHp、player.maxHp 与
 * statUpgradeCounts 精确拓扑，不重试保存、不外抛异常。
 *
 * 注意：saveGame() 是 store 内部闭包调用，普通 vi.spyOn(playerStore,'saveGame') 无法拦截。
 * 保存失败测试沿用项目既有模式：
 *   - installThrowingStorage：setItem 抛错 → saveGame 捕获并返回 false；
 *   - partial-module mock：useThemeStore 在 saveGame 的 saveData 构造阶段抛异常 →
 *     saveGame 直接抛出（该构造位于 saveGame 内部 try 之外）；
 *   - Storage.prototype.setItem 计数验证恰好一次提交。
 */

const themeThrowState = vi.hoisted(() => ({ armed: false, callCount: 0 }))

vi.mock('./themeStore', async importOriginal => {
  const actual = await importOriginal<typeof import('./themeStore')>()
  return {
    ...actual,
    useThemeStore: () => {
      themeThrowState.callCount++
      if (themeThrowState.armed && themeThrowState.callCount === 1) {
        throw new Error('theme store access failed')
      }
      return actual.useThemeStore()
    }
  }
})

function warmupStores() {
  usePlayerStore()
  useThemeStore()
  useMonsterStore()
  useGameStore()
  useTrainingStore()
  useCultivationStore()
  useTitleStore()
  usePetStore()
  useRebirthStore()
  useTalentStore()
  useBattlePassStore()
  useCollectionStore()
}

/** 主存档 setItem 抛错（模拟写盘失败），读取委托真实 storage。 */
function installThrowingStorage() {
  const realStorage = localStorage
  const throwingStorage = {
    get length() {
      return realStorage.length
    },
    clear: () => realStorage.clear(),
    getItem: (k: string) => realStorage.getItem(k),
    key: (i: number) => realStorage.key(i),
    removeItem: (k: string) => realStorage.removeItem(k),
    setItem: (_k: string, _v: string) => {
      throw new Error('quota exceeded')
    }
  }
  vi.stubGlobal('localStorage', throwingStorage)
  return realStorage
}

function attackConfig() {
  return ATTRIBUTE_UPGRADES.find(c => c.key === 'attack')!
}

/** attack 第 N 次价格 = floor(10 * 1.1^N)。 */
function attackCost(purchased: number): number {
  const c = attackConfig()
  return Math.max(1, Math.floor(c.baseCost * Math.pow(c.costGrowth, purchased)))
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  warmupStores()
  themeThrowState.armed = false
  themeThrowState.callCount = 0
})

afterEach(() => {
  themeThrowState.armed = false
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('Phase 3.37 — tryUpgradeStat 正常事务', () => {
  it('attack 第一次强化成功：gold 100→90、attack +2、count 0→1、SAVE_KEY 只写一次、主存档同时含三项', () => {
    const playerStore = usePlayerStore()
    playerStore.player.gold = 100
    const initialAttack = playerStore.player.stats.attack
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')

    const ok = playerStore.tryUpgradeStat('attack')

    expect(ok).toBe(true)
    expect(playerStore.player.gold).toBe(90)
    expect(playerStore.player.stats.attack).toBe(initialAttack + 2)
    expect(playerStore.statUpgradeCounts.get('attack')).toBe(1)
    expect(setItemSpy.mock.calls.filter(c => c[0] === SAVE_KEY).length).toBe(1)
    const disk = JSON.parse(localStorage.getItem(SAVE_KEY) as string)
    expect(disk.player.gold).toBe(90)
    expect(disk.player.stats.attack).toBe(initialAttack + 2)
    expect(disk.statUpgradeCounts).toContainEqual(['attack', 1])
  })

  it('新 Pinia + loadGame 后恢复成功结果', () => {
    const playerStore = usePlayerStore()
    playerStore.player.gold = 100
    const initialAttack = playerStore.player.stats.attack
    expect(playerStore.tryUpgradeStat('attack')).toBe(true)

    setActivePinia(createPinia())
    warmupStores()
    const p2 = usePlayerStore()
    p2.loadGame()

    expect(p2.player.gold).toBe(90)
    expect(p2.player.stats.attack).toBe(initialAttack + 2)
    expect(p2.statUpgradeCounts.get('attack')).toBe(1)
  })

  it('第二次 attack 强化使用成长后价格', () => {
    const playerStore = usePlayerStore()
    playerStore.player.gold = 1000
    expect(playerStore.tryUpgradeStat('attack')).toBe(true)
    expect(playerStore.tryUpgradeStat('attack')).toBe(true)
    // 第二次价格 = floor(10*1.1^1) = 11
    expect(playerStore.player.gold).toBe(1000 - attackCost(0) - attackCost(1))
    expect(playerStore.player.stats.attack).toBe(10 + 4) // 默认 attack=10，两次 +2
  })

  it('gold 恰好等于 cost 时成功并归零', () => {
    const playerStore = usePlayerStore()
    playerStore.player.gold = attackCost(0) // 恰好 10
    expect(playerStore.tryUpgradeStat('attack')).toBe(true)
    expect(playerStore.player.gold).toBe(0)
  })
})

describe('Phase 3.37 — 前置校验 fail-closed', () => {
  it('金币不足：零修改、零写盘', () => {
    const playerStore = usePlayerStore()
    playerStore.player.gold = attackCost(0) - 1
    const beforeGold = playerStore.player.gold
    const beforeAttack = playerStore.player.stats.attack
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')

    const ok = playerStore.tryUpgradeStat('attack')

    expect(ok).toBe(false)
    expect(playerStore.player.gold).toBe(beforeGold)
    expect(playerStore.player.stats.attack).toBe(beforeAttack)
    expect(playerStore.statUpgradeCounts.has('attack')).toBe(false)
    expect(setItemSpy.mock.calls.filter(c => c[0] === SAVE_KEY).length).toBe(0)
  })

  it('未解锁属性（penetration 需 Phase 3）：零修改、零写盘', () => {
    const playerStore = usePlayerStore()
    playerStore.player.gold = 1000
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')

    const ok = playerStore.tryUpgradeStat('penetration')

    expect(ok).toBe(false)
    expect(playerStore.statUpgradeCounts.has('penetration')).toBe(false)
    expect(playerStore.player.gold).toBe(1000)
    expect(setItemSpy.mock.calls.filter(c => c[0] === SAVE_KEY).length).toBe(0)
  })

  it('不支持的 StatType（luck 不在 ATTRIBUTE_UPGRADES）：零修改、零写盘', () => {
    const playerStore = usePlayerStore()
    playerStore.player.gold = 1000
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')

    const ok = playerStore.tryUpgradeStat('luck')

    expect(ok).toBe(false)
    expect(playerStore.player.gold).toBe(1000)
    expect(setItemSpy.mock.calls.filter(c => c[0] === SAVE_KEY).length).toBe(0)
  })

  it('gold 为 NaN、Infinity、负数时拒绝', () => {
    const playerStore = usePlayerStore()
    for (const bad of [NaN, Infinity, -1]) {
      playerStore.player.gold = bad as number
      const beforeAttack = playerStore.player.stats.attack
      const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
      const ok = playerStore.tryUpgradeStat('attack')
      expect(ok).toBe(false)
      expect(playerStore.player.stats.attack).toBe(beforeAttack)
      expect(setItemSpy.mock.calls.filter(c => c[0] === SAVE_KEY).length).toBe(0)
      setItemSpy.mockRestore()
    }
  })

  it('currentCount 为负数、分数、NaN、Infinity 时拒绝', () => {
    const playerStore = usePlayerStore()
    playerStore.player.gold = 1000
    for (const bad of [-1, 1.5, NaN, Infinity]) {
      playerStore.statUpgradeCounts.set('attack', bad as number)
      const beforeAttack = playerStore.player.stats.attack
      const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
      const ok = playerStore.tryUpgradeStat('attack')
      expect(ok).toBe(false)
      expect(playerStore.player.stats.attack).toBe(beforeAttack)
      expect(setItemSpy.mock.calls.filter(c => c[0] === SAVE_KEY).length).toBe(0)
      setItemSpy.mockRestore()
    }
  })

  it('当前属性值为 NaN 或 Infinity 时拒绝', () => {
    const playerStore = usePlayerStore()
    playerStore.player.gold = 1000
    for (const bad of [NaN, Infinity]) {
      playerStore.player.stats.attack = bad as number
      const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
      const ok = playerStore.tryUpgradeStat('attack')
      expect(ok).toBe(false)
      expect(playerStore.player.stats.attack).toBe(bad as number)
      expect(setItemSpy.mock.calls.filter(c => c[0] === SAVE_KEY).length).toBe(0)
      setItemSpy.mockRestore()
    }
  })

  it('currentHp 或 effective maxHp 损坏时拒绝', () => {
    const playerStore = usePlayerStore()
    playerStore.player.gold = 1000
    // currentHp 损坏
    playerStore.player.currentHp = NaN
    expect(playerStore.tryUpgradeStat('attack')).toBe(false)
    playerStore.player.currentHp = -5
    expect(playerStore.tryUpgradeStat('attack')).toBe(false)
    // effective maxHp 损坏：stats.maxHp = Infinity 会传播到 totalStats.maxHp（Infinity 为 truthy，
    // 不像 NaN 会被 calculateTotalStats 的 `|| 100` 回退成默认值）
    playerStore.player.currentHp = 100
    playerStore.player.stats.maxHp = Infinity
    expect(playerStore.tryUpgradeStat('attack')).toBe(false)
  })
})

describe('Phase 3.37 — 保存失败完整回滚', () => {
  it('普通属性保存返回 false（setItem 抛错）：gold/stat/count 完整回滚、磁盘保持原内容', () => {
    const playerStore = usePlayerStore()
    playerStore.player.gold = 100
    const beforeAttack = playerStore.player.stats.attack
    playerStore.saveGame() // 基线落盘
    const diskBefore = localStorage.getItem(SAVE_KEY)

    installThrowingStorage()
    const ok = playerStore.tryUpgradeStat('attack')
    vi.unstubAllGlobals()

    expect(ok).toBe(false)
    expect(playerStore.player.gold).toBe(100)
    expect(playerStore.player.stats.attack).toBe(beforeAttack)
    expect(playerStore.statUpgradeCounts.has('attack')).toBe(false)
    expect(localStorage.getItem(SAVE_KEY)).toBe(diskBefore)
  })

  it('普通属性保存抛异常（saveGame 内部 themeData 构造抛错）：同样完整回滚且不外抛', () => {
    const playerStore = usePlayerStore()
    playerStore.player.gold = 100
    const beforeAttack = playerStore.player.stats.attack
    playerStore.saveGame() // 基线落盘（armed=false 时 useThemeStore 正常）
    const diskBefore = localStorage.getItem(SAVE_KEY)

    themeThrowState.armed = true
    themeThrowState.callCount = 0
    let threw = false
    let ok: boolean | undefined
    try {
      ok = playerStore.tryUpgradeStat('attack')
    } catch {
      threw = true
    }
    themeThrowState.armed = false

    expect(threw).toBe(false)
    expect(ok).toBe(false)
    expect(playerStore.player.gold).toBe(100)
    expect(playerStore.player.stats.attack).toBe(beforeAttack)
    expect(playerStore.statUpgradeCounts.has('attack')).toBe(false)
    expect(localStorage.getItem(SAVE_KEY)).toBe(diskBefore)
  })

  it('真实 localStorage setItem(SAVE_KEY) 抛错：内存完整回滚、磁盘字节不变、无保存重试', () => {
    const playerStore = usePlayerStore()
    playerStore.player.gold = 100
    playerStore.saveGame()
    const diskBefore = localStorage.getItem(SAVE_KEY)
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('disk full')
    })

    const ok = playerStore.tryUpgradeStat('attack')
    // 恰好一次提交尝试（无重试）——须在 mockRestore 前读取调用记录（restore 会清空 calls）
    const saveAttempts = setItemSpy.mock.calls.filter(c => c[0] === SAVE_KEY).length
    setItemSpy.mockRestore()

    expect(ok).toBe(false)
    expect(playerStore.player.gold).toBe(100)
    expect(playerStore.statUpgradeCounts.has('attack')).toBe(false)
    expect(localStorage.getItem(SAVE_KEY)).toBe(diskBefore)
    expect(saveAttempts).toBe(1)
  })

  it('事务前 Map 不含该 stat key：保存失败后仍不含该 key，而不是残留 stat→0', () => {
    const playerStore = usePlayerStore()
    playerStore.player.gold = 100
    expect(playerStore.statUpgradeCounts.has('attack')).toBe(false)
    playerStore.saveGame()

    installThrowingStorage()
    const ok = playerStore.tryUpgradeStat('attack')
    vi.unstubAllGlobals()

    expect(ok).toBe(false)
    expect(playerStore.statUpgradeCounts.has('attack')).toBe(false) // 不残留 attack→0
  })
})

describe('Phase 3.37 — maxHp 强化', () => {
  it('maxHp 强化成功：基础 maxHp +20、currentHp +20 受新上限限制、player.maxHp 与有效上限一致', () => {
    const playerStore = usePlayerStore()
    playerStore.player.gold = 100
    playerStore.player.currentHp = 50
    const beforeMaxHp = playerStore.player.stats.maxHp // 默认 100
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')

    const ok = playerStore.tryUpgradeStat('maxHp')

    expect(ok).toBe(true)
    expect(playerStore.player.stats.maxHp).toBe(beforeMaxHp + 20) // 120
    expect(playerStore.player.maxHp).toBe(playerStore.totalStats.maxHp) // 与有效上限一致
    expect(playerStore.player.currentHp).toBe(Math.min(playerStore.player.maxHp, 50 + 20)) // 70
    expect(playerStore.statUpgradeCounts.get('maxHp')).toBe(1)
    expect(playerStore.player.gold).toBe(90)
    expect(setItemSpy.mock.calls.filter(c => c[0] === SAVE_KEY).length).toBe(1)
  })

  it('maxHp 保存返回 false：gold、基础 maxHp、currentHp、player.maxHp、count 全部精确恢复', () => {
    const playerStore = usePlayerStore()
    playerStore.player.gold = 100
    playerStore.player.currentHp = 50
    const beforeBaseMaxHp = playerStore.player.stats.maxHp
    const beforePlayerMaxHp = playerStore.player.maxHp
    const beforeCurrentHp = playerStore.player.currentHp
    playerStore.saveGame()
    const diskBefore = localStorage.getItem(SAVE_KEY)

    installThrowingStorage()
    const ok = playerStore.tryUpgradeStat('maxHp')
    vi.unstubAllGlobals()

    expect(ok).toBe(false)
    expect(playerStore.player.gold).toBe(100)
    expect(playerStore.player.stats.maxHp).toBe(beforeBaseMaxHp)
    expect(playerStore.player.maxHp).toBe(beforePlayerMaxHp)
    expect(playerStore.player.currentHp).toBe(beforeCurrentHp)
    expect(playerStore.statUpgradeCounts.has('maxHp')).toBe(false)
    expect(localStorage.getItem(SAVE_KEY)).toBe(diskBefore)
  })

  it('maxHp 保存抛异常：同样完整恢复', () => {
    const playerStore = usePlayerStore()
    playerStore.player.gold = 100
    playerStore.player.currentHp = 50
    const beforeBaseMaxHp = playerStore.player.stats.maxHp
    const beforePlayerMaxHp = playerStore.player.maxHp
    const beforeCurrentHp = playerStore.player.currentHp
    playerStore.saveGame()
    const diskBefore = localStorage.getItem(SAVE_KEY)

    themeThrowState.armed = true
    themeThrowState.callCount = 0
    let threw = false
    let ok: boolean | undefined
    try {
      ok = playerStore.tryUpgradeStat('maxHp')
    } catch {
      threw = true
    }
    themeThrowState.armed = false

    expect(threw).toBe(false)
    expect(ok).toBe(false)
    expect(playerStore.player.gold).toBe(100)
    expect(playerStore.player.stats.maxHp).toBe(beforeBaseMaxHp)
    expect(playerStore.player.maxHp).toBe(beforePlayerMaxHp)
    expect(playerStore.player.currentHp).toBe(beforeCurrentHp)
    expect(playerStore.statUpgradeCounts.has('maxHp')).toBe(false)
    expect(localStorage.getItem(SAVE_KEY)).toBe(diskBefore)
  })
})

describe('Phase 3.37 Repair 1 — Map mutation 异常完整回滚', () => {
  /** 将 statUpgradeCounts 当前 Map 实例的 set 替换为指定行为，返回原 set。 */
  function replaceMapSet(
    map: Map<StatType, number>,
    impl: (this: Map<StatType, number>, k: StatType, v: number) => void
  ) {
    const original = map.set
    map.set = impl as typeof map.set
    return original
  }

  it('事务前已有 count，set 在修改前持续抛错：gold/attack/count 恢复、其他 key 保留、saveGame 零调用', () => {
    const playerStore = usePlayerStore()
    playerStore.player.gold = 100
    playerStore.statUpgradeCounts.set('attack', 1)
    playerStore.statUpgradeCounts.set('defense', 5) // 无关 key 必须保留
    const beforeAttack = playerStore.player.stats.attack
    const beforeDefense = playerStore.statUpgradeCounts.get('defense')
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')

    // 故障 set：修改前持续抛错
    const map = playerStore.statUpgradeCounts
    const originalSet = replaceMapSet(map, function () {
      throw new Error('map set failed')
    })

    let threw = false
    let ok: boolean | undefined
    try {
      ok = playerStore.tryUpgradeStat('attack')
    } catch {
      threw = true
    }
    map.set = originalSet

    expect(threw).toBe(false)
    expect(ok).toBe(false)
    expect(playerStore.player.gold).toBe(100)
    expect(playerStore.player.stats.attack).toBe(beforeAttack)
    expect(playerStore.statUpgradeCounts.get('attack')).toBe(1) // 仍为 1
    expect(playerStore.statUpgradeCounts.get('defense')).toBe(beforeDefense) // 无关 key 保留
    expect(setItemSpy.mock.calls.filter(c => c[0] === SAVE_KEY).length).toBe(0)
  })

  it('事务前已有 count，set 先写候选值再抛错：count 从 2 精确恢复为 1、gold/stat/currentHp/maxHp 恢复、故障 Map 不再是权威对象', () => {
    const playerStore = usePlayerStore()
    playerStore.player.gold = 100
    playerStore.statUpgradeCounts.set('attack', 1)
    const beforeAttack = playerStore.player.stats.attack
    const beforeMaxHp = playerStore.player.maxHp
    const beforeCurrentHp = playerStore.player.currentHp
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')

    // 故障 set：先真实写入候选值（count 2），再抛错
    const faultedMap = playerStore.statUpgradeCounts
    const originalSet = replaceMapSet(faultedMap, function (k, v) {
      Map.prototype.set.call(this, k, v)
      throw new Error('set failed after mutation')
    })

    let threw = false
    let ok: boolean | undefined
    try {
      ok = playerStore.tryUpgradeStat('attack')
    } catch {
      threw = true
    }
    faultedMap.set = originalSet

    expect(threw).toBe(false)
    expect(ok).toBe(false)
    expect(playerStore.player.gold).toBe(100)
    expect(playerStore.player.stats.attack).toBe(beforeAttack)
    expect(playerStore.statUpgradeCounts.get('attack')).toBe(1) // 从候选 2 精确恢复为 1
    expect(playerStore.player.maxHp).toBe(beforeMaxHp)
    expect(playerStore.player.currentHp).toBe(beforeCurrentHp)
    // 原故障 Map 不再是恢复后的权威对象：rollback 用 new Map(previousUpgradeCounts) 替换 ref
    expect(playerStore.statUpgradeCounts).not.toBe(faultedMap)
    expect(setItemSpy.mock.calls.filter(c => c[0] === SAVE_KEY).length).toBe(0)
  })

  it('事务前没有目标 key，set 先写后抛：回滚后 has(attack) === false，不残留 attack→1 或 attack→0', () => {
    const playerStore = usePlayerStore()
    playerStore.player.gold = 100
    expect(playerStore.statUpgradeCounts.has('attack')).toBe(false)
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')

    const map = playerStore.statUpgradeCounts
    const originalSet = replaceMapSet(map, function (k, v) {
      Map.prototype.set.call(this, k, v)
      throw new Error('set failed after mutation')
    })

    let threw = false
    let ok: boolean | undefined
    try {
      ok = playerStore.tryUpgradeStat('attack')
    } catch {
      threw = true
    }
    map.set = originalSet

    expect(threw).toBe(false)
    expect(ok).toBe(false)
    expect(playerStore.statUpgradeCounts.has('attack')).toBe(false) // 不残留
    expect(setItemSpy.mock.calls.filter(c => c[0] === SAVE_KEY).length).toBe(0)
  })
})

describe('Phase 3.37 Repair 1 — totalStats 计算异常不外抛', () => {
  it('首次 totalStats 计算抛异常：返回 false、player.maxHp 恢复、gold/attack/currentHp/count 不变、零写盘', () => {
    const playerStore = usePlayerStore()
    const cultivationStore = useCultivationStore()
    playerStore.player.gold = 100
    const beforeMaxHp = playerStore.player.maxHp
    const beforeAttack = playerStore.player.stats.attack
    const beforeCurrentHp = playerStore.player.currentHp
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    // getConstellationBonus 在 computeBaseStats 内执行 → totalStats 首次计算抛异常
    const spy = vi.spyOn(cultivationStore, 'getConstellationBonus').mockImplementation(() => {
      throw new Error('constellation boom')
    })

    let threw = false
    let ok: boolean | undefined
    try {
      ok = playerStore.tryUpgradeStat('attack')
    } catch {
      threw = true
    }
    spy.mockRestore()

    expect(threw).toBe(false)
    expect(ok).toBe(false)
    expect(playerStore.player.maxHp).toBe(beforeMaxHp) // 恢复读取前值
    expect(playerStore.player.gold).toBe(100)
    expect(playerStore.player.stats.attack).toBe(beforeAttack)
    expect(playerStore.player.currentHp).toBe(beforeCurrentHp)
    expect(playerStore.statUpgradeCounts.has('attack')).toBe(false)
    expect(setItemSpy.mock.calls.filter(c => c[0] === SAVE_KEY).length).toBe(0)
  })

  it('maxHp 强化候选重算异常：基础 maxHp/currentHp/player.maxHp/完整 Map 快照全部恢复、零写盘、不外抛', () => {
    const playerStore = usePlayerStore()
    const cultivationStore = useCultivationStore()
    playerStore.player.gold = 100
    playerStore.player.currentHp = 50
    const beforeBaseMaxHp = playerStore.player.stats.maxHp
    const beforePlayerMaxHp = playerStore.player.maxHp
    const beforeCurrentHp = playerStore.player.currentHp
    playerStore.statUpgradeCounts.set('defense', 3) // 无关 key 必须保留
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')

    // 第一次 totalStats 校验成功（getConstellationBonus 正常返回）后，让后续调用抛错
    const spy = vi
      .spyOn(cultivationStore, 'getConstellationBonus')
      .mockImplementationOnce(() => ({})) // 第一次校验正常
      .mockImplementation(() => {
        throw new Error('constellation boom on recompute')
      })

    let threw = false
    let ok: boolean | undefined
    try {
      ok = playerStore.tryUpgradeStat('maxHp')
    } catch {
      threw = true
    }
    spy.mockRestore()

    expect(threw).toBe(false)
    expect(ok).toBe(false)
    expect(playerStore.player.gold).toBe(100)
    expect(playerStore.player.stats.maxHp).toBe(beforeBaseMaxHp)
    expect(playerStore.player.maxHp).toBe(beforePlayerMaxHp)
    expect(playerStore.player.currentHp).toBe(beforeCurrentHp)
    expect(playerStore.statUpgradeCounts.has('maxHp')).toBe(false) // 候选 set 已回滚
    expect(playerStore.statUpgradeCounts.get('defense')).toBe(3) // 无关 key 保留
    expect(setItemSpy.mock.calls.filter(c => c[0] === SAVE_KEY).length).toBe(0)
  })
})

describe('Phase 3.37 — 架构护栏', () => {
  const ROOT = process.cwd()

  it('tryUpgradeStat 必须检查 saveGame 结果，不得出现无条件 saveGame(); return true', () => {
    const src = readFileSync(resolve(ROOT, 'src/stores/playerStore.ts'), 'utf8')
    const m = src.match(/function tryUpgradeStat\(stat: StatType\): boolean\s*\{[\s\S]*?\n  \}/)
    expect(m).toBeTruthy()
    const body = m![0]
    expect(body).toContain('saved = saveGame()')
    expect(body).toMatch(/if \(!saved\)\s*\{/)
    expect(body).not.toMatch(/saveGame\(\)\s*\n\s*return true/)
  })

  it('RoleTab 继续只调用 playerStore.tryUpgradeStat(stat)，不直接改 gold/stats/count/localStorage', () => {
    const src = readFileSync(resolve(ROOT, 'src/components/RoleTab.vue'), 'utf8')
    const m = src.match(/function upgradeStat\(stat: StatType\)\s*\{[\s\S]*?\n\}/)
    expect(m).toBeTruthy()
    const body = m![0]
    expect(body).toContain('playerStore.tryUpgradeStat(stat)')
    expect(body).not.toMatch(/\.gold\s*[-+]=|\.gold\s*=/)
    expect(body).not.toMatch(/stats\[|stats\./)
    expect(body).not.toMatch(/statUpgradeCounts/)
    expect(body).not.toMatch(/localStorage/)
  })
})
