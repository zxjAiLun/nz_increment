// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { usePlayerStore } from './playerStore'
import { useMonsterStore } from './monsterStore'
import { useGameStore } from './gameStore'
import { useTrainingStore } from './trainingStore'
import { useATBStore } from './atbStore'
import { useRebirthStore, REBIRTH_UPGRADES } from './rebirthStore'
import { useThemeStore } from './themeStore'

/**
 * Phase 3.59 — rebirth_data 原子规范化水合。
 *
 * - loadRebirthData() 读取原始字符串 → JSON parse → 顶层对象校验 → 逐字段 fail-closed
 *   规范化 → 完整构造 candidate → 一次性提交全部 Rebirth 状态。
 * - 标量用 Number.isSafeInteger 且 >= 0 校验；upgrades 全量 fail-closed（任一记录非法 →
 *   整份 []）。零写回、零 saveRebirthData、零 Player save。
 * - 测试通过「预先设置 localStorage → fresh Pinia → 首次 useRebirthStore()」触发真实初始化。
 */

function warmupStores() {
  usePlayerStore()
  useMonsterStore()
  useGameStore()
  useTrainingStore()
  useATBStore()
  useRebirthStore()
  useThemeStore()
}

function seedRebirthData(raw: string | null) {
  if (raw === null) {
    localStorage.removeItem('rebirth_data')
  } else {
    localStorage.setItem('rebirth_data', raw)
  }
}

/** 触发真实 Store 初始化水合。 */
function createStore() {
  setActivePinia(createPinia())
  warmupStores()
  return useRebirthStore()
}

function hydrate(raw: string | null) {
  seedRebirthData(raw)
  return createStore()
}

function hydrateTracked(raw: string | null) {
  seedRebirthData(raw)
  const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
  const removeSpy = vi.spyOn(Storage.prototype, 'removeItem')
  const store = createStore()
  return { store, setItemSpy, removeSpy }
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  warmupStores()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('Phase 3.59 — 无存档及读取失败', () => {
  it('无 key：默认状态、零写盘', () => {
    const { store, setItemSpy, removeSpy } = hydrateTracked(null)
    expect(store.rebirthPoints).toBe(0)
    expect(store.totalRebirthCount).toBe(0)
    expect(store.upgrades).toEqual([])
    expect(store.lastRebirthTime).toBe(0)
    expect(setItemSpy).not.toHaveBeenCalled()
    expect(removeSpy).not.toHaveBeenCalled()
  })

  it('空字符串：默认状态', () => {
    const store = hydrate('')
    expect(store.rebirthPoints).toBe(0)
    expect(store.totalRebirthCount).toBe(0)
    expect(store.upgrades).toEqual([])
    expect(store.lastRebirthTime).toBe(0)
  })

  it('malformed JSON：默认状态', () => {
    const store = hydrate('{invalid json')
    expect(store.rebirthPoints).toBe(0)
    expect(store.totalRebirthCount).toBe(0)
    expect(store.upgrades).toEqual([])
    expect(store.lastRebirthTime).toBe(0)
  })

  it('getItem throw：默认状态、原异常不逃出 Store 初始化', () => {
    seedRebirthData('{"rebirthPoints": 5}')
    const originalGetItem = Storage.prototype.getItem
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key: string) {
      if (key === 'rebirth_data') throw new Error('read boom')
      return originalGetItem.call(this, key)
    })
    const store = createStore()
    expect(store.rebirthPoints).toBe(0)
    expect(store.totalRebirthCount).toBe(0)
    expect(store.upgrades).toEqual([])
    expect(store.lastRebirthTime).toBe(0)
  })

  it('各失败分支零 set/remove（含 getItem throw）', () => {
    for (const raw of [null, '', '{invalid', 'null', '[]', '"str"', '5', 'true']) {
      vi.restoreAllMocks() // 清除上一轮 spy，避免 wrap 链记录 seed 写入
      const { setItemSpy, removeSpy } = hydrateTracked(raw)
      expect(setItemSpy).not.toHaveBeenCalled()
      expect(removeSpy).not.toHaveBeenCalled()
    }
  })
})

describe('Phase 3.59 — 顶层非法值', () => {
  it('null / array / string / number / boolean 全部默认', () => {
    const raws = ['null', '[]', '"str"', '5', 'true', 'false']
    for (const raw of raws) {
      const store = hydrate(raw)
      expect(store.rebirthPoints).toBe(0)
      expect(store.totalRebirthCount).toBe(0)
      expect(store.upgrades).toEqual([])
      expect(store.lastRebirthTime).toBe(0)
    }
  })
})

describe('Phase 3.59 — 标量规范化', () => {
  it('合法 0 与合法正安全整数', () => {
    expect(hydrate(JSON.stringify({ rebirthPoints: 0 })).rebirthPoints).toBe(0)
    expect(hydrate(JSON.stringify({ rebirthPoints: 42 })).rebirthPoints).toBe(42)
    expect(hydrate(JSON.stringify({ totalRebirthCount: 3 })).totalRebirthCount).toBe(3)
    expect(hydrate(JSON.stringify({ lastRebirthTime: 123456789 })).lastRebirthTime).toBe(123456789)
  })

  it('负数、小数归零', () => {
    for (const bad of [-5, 5.5, -0.5]) {
      expect(hydrate(JSON.stringify({ rebirthPoints: bad })).rebirthPoints).toBe(0)
    }
  })

  it('数字字符串归零', () => {
    expect(hydrate(JSON.stringify({ rebirthPoints: '5' })).rebirthPoints).toBe(0)
    expect(hydrate(JSON.stringify({ totalRebirthCount: '3' })).totalRebirthCount).toBe(0)
  })

  it('boolean/null/object/array 归零', () => {
    for (const bad of [true, false, null, {}, []]) {
      const store = hydrate(JSON.stringify({ rebirthPoints: bad, totalRebirthCount: bad, lastRebirthTime: bad }))
      expect(store.rebirthPoints).toBe(0)
      expect(store.totalRebirthCount).toBe(0)
      expect(store.lastRebirthTime).toBe(0)
    }
  })

  it('超出 safe integer 归零', () => {
    expect(hydrate(JSON.stringify({ rebirthPoints: 9007199254740992 })).rebirthPoints).toBe(0)
    expect(hydrate(JSON.stringify({ totalRebirthCount: 9007199254740992 })).totalRebirthCount).toBe(0)
    expect(hydrate(JSON.stringify({ lastRebirthTime: 9007199254740992 })).lastRebirthTime).toBe(0)
  })

  it('各标量独立规范化：一个字段损坏不阻止其他合法字段', () => {
    const store = hydrate(JSON.stringify({ rebirthPoints: 5, totalRebirthCount: -1, upgrades: 'garbage', lastRebirthTime: 7 }))
    expect(store.rebirthPoints).toBe(5)
    expect(store.totalRebirthCount).toBe(0)
    expect(store.upgrades).toEqual([])
    expect(store.lastRebirthTime).toBe(7)
  })
})

describe('Phase 3.59 — Upgrades 合法', () => {
  it('空数组合法', () => {
    const store = hydrate(JSON.stringify({ upgrades: [] }))
    expect(store.upgrades).toEqual([])
  })

  it('单条合法记录', () => {
    const store = hydrate(JSON.stringify({ upgrades: [{ upgradeId: 'crit_rate', currentLevel: 5 }] }))
    expect(store.upgrades).toEqual([{ upgradeId: 'crit_rate', currentLevel: 5 }])
  })

  it('多条合法记录', () => {
    const store = hydrate(JSON.stringify({
      upgrades: [
        { upgradeId: 'crit_rate', currentLevel: 5 },
        { upgradeId: 'gold_bonus', currentLevel: 2 }
      ]
    }))
    expect(store.upgrades).toEqual([
      { upgradeId: 'crit_rate', currentLevel: 5 },
      { upgradeId: 'gold_bonus', currentLevel: 2 }
    ])
  })

  it('maxLevel 边界合法（level === maxLevel 允许）', () => {
    const max = REBIRTH_UPGRADES.find(u => u.id === 'skill_unlock')!.maxLevel // 5
    const store = hydrate(JSON.stringify({ upgrades: [{ upgradeId: 'skill_unlock', currentLevel: max }] }))
    expect(store.upgrades).toEqual([{ upgradeId: 'skill_unlock', currentLevel: max }])
  })

  it('输出新数组和新对象（不保存解析对象引用）', () => {
    const rawUpgrades = [{ upgradeId: 'crit_rate', currentLevel: 5 }]
    const store = hydrate(JSON.stringify({ upgrades: rawUpgrades }))
    expect(store.upgrades).not.toBe(rawUpgrades)
    expect(store.upgrades[0]).not.toBe(rawUpgrades[0])
    expect(store.upgrades).toEqual([{ upgradeId: 'crit_rate', currentLevel: 5 }])
  })

  it('额外字段被忽略', () => {
    const store = hydrate(JSON.stringify({ upgrades: [{ upgradeId: 'crit_rate', currentLevel: 5, extra: 'x', foo: 1 }] }))
    expect(store.upgrades).toEqual([{ upgradeId: 'crit_rate', currentLevel: 5 }])
  })

  it('输入顺序保持', () => {
    const store = hydrate(JSON.stringify({
      upgrades: [
        { upgradeId: 'gold_bonus', currentLevel: 1 },
        { upgradeId: 'crit_rate', currentLevel: 2 },
        { upgradeId: 'dodge', currentLevel: 3 }
      ]
    }))
    expect(store.upgrades.map(u => u.upgradeId)).toEqual(['gold_bonus', 'crit_rate', 'dodge'])
  })

  it('rebirthStats 与恢复等级一致', () => {
    const store = hydrate(JSON.stringify({ upgrades: [{ upgradeId: 'crit_rate', currentLevel: 10 }] }))
    expect(store.rebirthStats.critRateBonus).toBe(5) // 0.5 * 10
  })

  it('getUpgradeLevel / getUpgradeCost 正确', () => {
    const store = hydrate(JSON.stringify({ upgrades: [{ upgradeId: 'crit_rate', currentLevel: 10 }] }))
    expect(store.getUpgradeLevel('crit_rate')).toBe(10)
    expect(store.getUpgradeLevel('dodge')).toBe(0)
    expect(store.getUpgradeCost('crit_rate')).toBe(Math.floor(10 * Math.pow(1.15, 10)))
  })
})

describe('Phase 3.59 — Upgrades 非法（整份 []）', () => {
  const cases: Array<[string, unknown]> = [
    ['非数组', 'garbage'],
    ['非数组对象', {}],
    ['null entry', [null]],
    ['array entry', [[]]],
    ['非对象 entry', ['x']],
    ['upgradeId 非字符串', [{ upgradeId: 123, currentLevel: 1 }]],
    ['空 ID', [{ upgradeId: '', currentLevel: 1 }]],
    ['padded ID', [{ upgradeId: ' crit_rate ', currentLevel: 1 }]],
    ['unknown ID', [{ upgradeId: 'nonexistent', currentLevel: 1 }]],
    ['duplicate ID', [
      { upgradeId: 'crit_rate', currentLevel: 1 },
      { upgradeId: 'crit_rate', currentLevel: 2 }
    ]],
    ['currentLevel 0', [{ upgradeId: 'crit_rate', currentLevel: 0 }]],
    ['currentLevel 负数', [{ upgradeId: 'crit_rate', currentLevel: -1 }]],
    ['currentLevel 小数', [{ upgradeId: 'crit_rate', currentLevel: 1.5 }]],
    ['currentLevel 字符串', [{ upgradeId: 'crit_rate', currentLevel: '2' }]],
    ['currentLevel null', [{ upgradeId: 'crit_rate', currentLevel: null }]],
    ['currentLevel 超 maxLevel', [{ upgradeId: 'skill_unlock', currentLevel: 6 }]],
    ['currentLevel 超 safe integer', [{ upgradeId: 'crit_rate', currentLevel: 9007199254740992 }]]
  ]

  for (const [label, upgrades] of cases) {
    it(`任一非法记录 → 整份 upgrades=[]（${label}）`, () => {
      const store = hydrate(JSON.stringify({ upgrades }))
      expect(store.upgrades).toEqual([])
    })
  }
})

describe('Phase 3.59 — 原子提交与回归', () => {
  it('upgrades 验证失败时标量仍按各自规则水合', () => {
    const store = hydrate(JSON.stringify({ rebirthPoints: 5, totalRebirthCount: 2, upgrades: [{ upgradeId: 'bad', currentLevel: 1 }], lastRebirthTime: 7 }))
    expect(store.rebirthPoints).toBe(5)
    expect(store.totalRebirthCount).toBe(2)
    expect(store.upgrades).toEqual([])
    expect(store.lastRebirthTime).toBe(7)
  })

  it('normalization 意外 throw 时不发生部分 ref 提交（getItem/parse 成功、标量规范化真实抛错）', () => {
    const raw = JSON.stringify({
      rebirthPoints: 5,
      totalRebirthCount: 2,
      upgrades: [{ upgradeId: 'crit_rate', currentLevel: 3 }],
      lastRebirthTime: 7
    })
    seedRebirthData(raw)
    // fresh Pinia，直接首次创建 Rebirth Store，避免其他 Store 提前调用被 spy 的全局函数
    setActivePinia(createPinia())
    const originalIsSafeInteger = Number.isSafeInteger
    let calls = 0
    vi.spyOn(Number, 'isSafeInteger').mockImplementation(value => {
      calls += 1
      if (calls === 2) {
        throw new Error('normalize boom')
      }
      return originalIsSafeInteger(value)
    })
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    const removeSpy = vi.spyOn(Storage.prototype, 'removeItem')
    let store: ReturnType<typeof useRebirthStore> | undefined
    expect(() => {
      store = useRebirthStore()
    }).not.toThrow()
    expect(calls).toBe(2) // 第一次标量规范化（rebirthPoints）成功，第二次（totalRebirthCount）真实抛错
    expect(store!.rebirthPoints).toBe(0)
    expect(store!.totalRebirthCount).toBe(0)
    expect(store!.upgrades).toEqual([])
    expect(store!.lastRebirthTime).toBe(0)
    expect(setItemSpy).not.toHaveBeenCalled()
    expect(removeSpy).not.toHaveBeenCalled()
    expect(localStorage.getItem('rebirth_data')).toBe(raw) // 损坏前 raw 未被覆盖
  })

  it('load 不调用 saveRebirthData 或 Player save', () => {
    const { setItemSpy, removeSpy } = hydrateTracked(JSON.stringify({ rebirthPoints: 5, upgrades: [{ upgradeId: 'crit_rate', currentLevel: 2 }] }))
    const playerStore = usePlayerStore()
    const saveSpy = vi.spyOn(playerStore, 'saveGame')
    expect(setItemSpy).not.toHaveBeenCalled()
    expect(removeSpy).not.toHaveBeenCalled()
    expect(saveSpy).not.toHaveBeenCalled()
  })

  it('合法加载后 purchaseUpgrade 正常', () => {
    const store = hydrate(JSON.stringify({ rebirthPoints: 1000, upgrades: [{ upgradeId: 'crit_rate', currentLevel: 2 }] }))
    expect(store.purchaseUpgrade('crit_rate')).toBe(true)
    expect(store.getUpgradeLevel('crit_rate')).toBe(3)
  })

  it('合法加载后 performRebirth 正常', () => {
    const store = hydrate(JSON.stringify({ rebirthPoints: 5, totalRebirthCount: 1, upgrades: [{ upgradeId: 'crit_rate', currentLevel: 2 }] }))
    const monsterStore = useMonsterStore() // 水合后的 fresh pinia store
    monsterStore.difficultyValue = 10
    monsterStore.monsterLevel = 10
    const result = store.performRebirth()
    expect(result).not.toBeNull()
    expect(result!.pointsEarned).toBe(33)
    expect(store.rebirthPoints).toBe(38) // 5 + 33
    expect(store.totalRebirthCount).toBe(2)
    expect(store.getUpgradeLevel('crit_rate')).toBe(2) // upgrades 保持
  })

  it('Phase 3.58 main-save failure 补偿语义在合法水合后不变', () => {
    const store = hydrate(JSON.stringify({ rebirthPoints: 5, totalRebirthCount: 1, upgrades: [{ upgradeId: 'crit_rate', currentLevel: 2 }] }))
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    monsterStore.difficultyValue = 10
    monsterStore.monsterLevel = 10
    vi.spyOn(playerStore, 'saveGame').mockReturnValue(false)
    let thrown: unknown
    try {
      store.performRebirth()
    } catch (e) {
      thrown = e
    }
    expect((thrown as Error).message).toBe('rebirth main save failed')
    expect(store.rebirthPoints).toBe(5) // 回滚到水合值
    expect(store.totalRebirthCount).toBe(1)
    expect(store.getUpgradeLevel('crit_rate')).toBe(2)
  })

  it('load 不修改 Player、Monster', () => {
    // 同一 fresh pinia 上先就绪非 rebirth store 并设置状态，再创建 rebirthStore 触发水合
    setActivePinia(createPinia())
    usePlayerStore()
    useMonsterStore()
    useGameStore()
    useTrainingStore()
    useATBStore()
    useThemeStore()
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    playerStore.player.currentHp = 77
    playerStore.player.gold = 888
    monsterStore.difficultyValue = 55
    const hpBefore = playerStore.player.currentHp
    const goldBefore = playerStore.player.gold
    const diffBefore = monsterStore.difficultyValue
    localStorage.setItem('rebirth_data', JSON.stringify({ rebirthPoints: 5, upgrades: [{ upgradeId: 'crit_rate', currentLevel: 2 }] }))
    const rebirthStore = useRebirthStore() // 触发 loadRebirthData
    expect(rebirthStore.rebirthPoints).toBe(5)
    expect(playerStore.player.currentHp).toBe(hpBefore)
    expect(playerStore.player.gold).toBe(goldBefore)
    expect(monsterStore.difficultyValue).toBe(diffBefore)
  })
})
