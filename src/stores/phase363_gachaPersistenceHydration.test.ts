// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { usePlayerStore } from './playerStore'
import { useMonsterStore } from './monsterStore'
import { useGameStore } from './gameStore'
import { useTrainingStore } from './trainingStore'
import { useATBStore } from './atbStore'
import { useRebirthStore } from './rebirthStore'
import { useThemeStore } from './themeStore'
import { useProbabilityStore } from './probabilityStore'
import { useGachaStore } from './gachaStore'
import { GACHA_POOLS, PERMANENT_POOL_ID, LIMITED_POOL_ID } from '../data/gachaPools'

/**
 * Phase 3.63 — Gacha 持久化安全 hydration。
 *
 * - gachaStore.load() 改为 raw → parse → 逐字段 fail-closed 规范化 → 完整 candidate →
 *   最后一次一次性提交三个 state 字段。
 * - pityCounters/lastDailyFree 仅保留已知 pool 且值合法；history 仅保留可经 canonical
 *   pool reward 重建的记录；任何异常 → 三字段全默认、零写回。
 */

const GACHA_KEY = 'nz_gacha_v1'
const CANONICAL_REWARD = GACHA_POOLS[PERMANENT_POOL_ID].rewards[0] // skill_book_1

function warmNonGachaStores() {
  usePlayerStore()
  useMonsterStore()
  useGameStore()
  useTrainingStore()
  useATBStore()
  useRebirthStore()
  useThemeStore()
  useProbabilityStore()
}

function seedGachaRaw(raw: string | null) {
  if (raw === null) localStorage.removeItem(GACHA_KEY)
  else localStorage.setItem(GACHA_KEY, raw)
}

/** 触发真实 Store 初始化水合。 */
function createStore() {
  setActivePinia(createPinia())
  return useGachaStore()
}

function hydrate(raw: string | null) {
  seedGachaRaw(raw)
  return createStore()
}

function hydrateTracked(raw: string | null) {
  seedGachaRaw(raw)
  setActivePinia(createPinia())
  warmNonGachaStores()
  const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
  const removeSpy = vi.spyOn(Storage.prototype, 'removeItem')
  const store = useGachaStore()
  return { store, setItemSpy, removeSpy }
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('Phase 3.63 — 无存档与读取失败', () => {
  it('无 raw：三字段全默认、零写盘', () => {
    const { store, setItemSpy, removeSpy } = hydrateTracked(null)
    expect(store.state.pityCounters).toEqual({})
    expect(store.state.lastDailyFree).toEqual({})
    expect(store.state.history).toEqual([])
    expect(setItemSpy).not.toHaveBeenCalled()
    expect(removeSpy).not.toHaveBeenCalled()
  })

  it('getItem 抛错：默认状态、Store 构造不抛、零写盘', () => {
    seedGachaRaw('{"pityCounters":{"' + PERMANENT_POOL_ID + '":5}}')
    setActivePinia(createPinia())
    warmNonGachaStores()
    const originalGetItem = Storage.prototype.getItem
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key: string) {
      if (key === GACHA_KEY) throw new Error('read boom')
      return originalGetItem.call(this, key)
    })
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    const store = createStore()
    expect(store.state.pityCounters).toEqual({})
    expect(store.state.lastDailyFree).toEqual({})
    expect(store.state.history).toEqual([])
    expect(setItemSpy).not.toHaveBeenCalled()
  })

  it('malformed JSON：默认状态', () => {
    const store = hydrate('{broken json')
    expect(store.state.pityCounters).toEqual({})
    expect(store.state.lastDailyFree).toEqual({})
    expect(store.state.history).toEqual([])
  })
})

describe('Phase 3.63 — 顶层边界与容器类型', () => {
  it('顶层 null/array/string/number/boolean → 默认', () => {
    for (const raw of ['null', '[]', '"str"', '5', 'true']) {
      const store = hydrate(raw)
      expect(store.state.pityCounters).toEqual({})
      expect(store.state.lastDailyFree).toEqual({})
      expect(store.state.history).toEqual([])
    }
  })

  it('pityCounters / lastDailyFree 非对象、history 非数组 → 默认', () => {
    for (const bad of [null, [], 'x']) {
      const store = hydrate(JSON.stringify({ pityCounters: bad, lastDailyFree: bad, history: bad }))
      expect(store.state.pityCounters).toEqual({})
      expect(store.state.lastDailyFree).toEqual({})
      expect(store.state.history).toEqual([])
    }
    // history 为非数组对象
    const store = hydrate(JSON.stringify({ history: {} }))
    expect(store.state.history).toEqual([])
  })
})

describe('Phase 3.63 — pityCounters 规范化', () => {
  it('合法与非法 entry 混合：合法保留、非法丢弃', () => {
    const store = hydrate(JSON.stringify({
      pityCounters: {
        [PERMANENT_POOL_ID]: 5,
        [LIMITED_POOL_ID]: 0,
        unknown_pool: 3,
        [PERMANENT_POOL_ID + '_dup']: undefined,
        '-1': 90
      }
    }))
    // 已知 pool 合法值保留；非法 pool 丢弃
    expect(store.state.pityCounters[PERMANENT_POOL_ID]).toBe(5)
    expect(store.state.pityCounters[LIMITED_POOL_ID]).toBe(0)
    expect(store.state.pityCounters['unknown_pool']).toBeUndefined()
    expect(store.state.pityCounters['-1']).toBeUndefined()
  })

  it('负数/小数/字符串/unsafe/≥ target 均丢弃', () => {
    const target = GACHA_POOLS[PERMANENT_POOL_ID].pity.target
    const store = hydrate(JSON.stringify({
      pityCounters: {
        [PERMANENT_POOL_ID + '_neg']: -1,
        [PERMANENT_POOL_ID + '_dec']: 1.5,
        [PERMANENT_POOL_ID + '_str']: '5',
        [PERMANENT_POOL_ID + '_unsafe']: 9007199254740992,
        [PERMANENT_POOL_ID + '_at']: target,
        [PERMANENT_POOL_ID + '_over']: target + 1
      }
    }))
    // 这些 key 并非已知 pool（带后缀），按池校验也丢弃；另以合法 pool 直接验证边界
    expect(store.state.pityCounters).toEqual({})
  })

  it('合法 pool 边界：pity = target - 1 保留、= target 丢弃', () => {
    const target = GACHA_POOLS[PERMANENT_POOL_ID].pity.target
    const store = hydrate(JSON.stringify({
      pityCounters: { [PERMANENT_POOL_ID]: target - 1 }
    }))
    expect(store.state.pityCounters[PERMANENT_POOL_ID]).toBe(target - 1)
    const store2 = hydrate(JSON.stringify({
      pityCounters: { [PERMANENT_POOL_ID]: target }
    }))
    expect(store2.state.pityCounters[PERMANENT_POOL_ID]).toBeUndefined()
  })
})

describe('Phase 3.63 — lastDailyFree 规范化', () => {
  it('合法与非法 entry 混合', () => {
    const store = hydrate(JSON.stringify({
      lastDailyFree: {
        [PERMANENT_POOL_ID]: 1785859200000,
        unknown_pool: 123,
        [LIMITED_POOL_ID]: 0,
        [PERMANENT_POOL_ID + '_neg']: -1,
        [PERMANENT_POOL_ID + '_dec']: 1.5,
        [PERMANENT_POOL_ID + '_str']: '5'
      }
    }))
    expect(store.state.lastDailyFree[PERMANENT_POOL_ID]).toBe(1785859200000)
    expect(store.state.lastDailyFree['unknown_pool']).toBeUndefined()
    expect(store.state.lastDailyFree[LIMITED_POOL_ID]).toBeUndefined() // 0 非法
    expect(store.state.lastDailyFree[PERMANENT_POOL_ID + '_neg']).toBeUndefined()
    expect(store.state.lastDailyFree[PERMANENT_POOL_ID + '_dec']).toBeUndefined()
    expect(store.state.lastDailyFree[PERMANENT_POOL_ID + '_str']).toBeUndefined()
  })
})

describe('Phase 3.63 — history 规范化与 canonical reward 重建', () => {
  it('损坏记录过滤、合法记录用 canonical reward 重建 result', () => {
    const validTimestamp = 1785859200000
    const store = hydrate(JSON.stringify({
      history: [
        {
          timestamp: validTimestamp,
          poolId: PERMANENT_POOL_ID,
          result: { id: 'skill_book_1', name: 'HACKED', rarity: 'legendary', type: 'gold', value: 999 },
          isPity: false
        },
        { timestamp: validTimestamp, poolId: PERMANENT_POOL_ID, result: { id: 'nonexistent' }, isPity: false }, // 未知 reward
        { timestamp: -1, poolId: PERMANENT_POOL_ID, result: { id: 'skill_book_1' }, isPity: false }, // 非法时间戳
        { timestamp: validTimestamp, poolId: 'unknown_pool', result: { id: 'skill_book_1' }, isPity: false }, // 未知 pool
        { timestamp: validTimestamp, poolId: PERMANENT_POOL_ID, result: null, isPity: false }, // 非对象 result
        { timestamp: validTimestamp, poolId: PERMANENT_POOL_ID, result: { id: 'skill_book_1' }, isPity: 'yes' } // 非法 isPity
      ]
    }))
    expect(store.state.history.length).toBe(1)
    expect(store.state.history[0].result).toEqual(CANONICAL_REWARD) // canonical 重建
    expect(store.state.history[0].result.name).toBe('技能书×1')
  })

  it('明显非法 audit 字段删除、合法 audit 保留', () => {
    const ts = 1785859200000
    const store = hydrate(JSON.stringify({
      history: [
        { timestamp: ts, poolId: PERMANENT_POOL_ID, result: { id: 'skill_book_1' }, isPity: false, audit: 'garbage' },
        { timestamp: ts, poolId: PERMANENT_POOL_ID, result: { id: 'skill_book_1' }, isPity: false, audit: { modifiers: [], targetId: 'x' } }
      ]
    }))
    expect(store.state.history.length).toBe(2)
    expect(store.state.history[0].audit).toBeUndefined() // 字符串 audit 删除
    expect(store.state.history[1].audit).toEqual({ modifiers: [], targetId: 'x' }) // 合法对象保留
  })
})

describe('Phase 3.63 — 原子性与零写回', () => {
  it('normalization 中途真实 throw：三字段全默认、零部分提交、raw 未变化', () => {
    const raw = JSON.stringify({
      pityCounters: { [PERMANENT_POOL_ID]: 5 },
      lastDailyFree: { [PERMANENT_POOL_ID]: 1785859200000 },
      history: []
    })
    seedGachaRaw(raw)
    setActivePinia(createPinia())
    warmNonGachaStores()
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
    const store = createStore()
    expect(calls).toBe(2) // 第一个计数字段（pity）成功，第二个（lastDailyFree）真实抛错
    expect(store.state.pityCounters).toEqual({})
    expect(store.state.lastDailyFree).toEqual({})
    expect(store.state.history).toEqual([])
    expect(setItemSpy).not.toHaveBeenCalled()
    expect(removeSpy).not.toHaveBeenCalled()
    expect(localStorage.getItem(GACHA_KEY)).toBe(raw)
  })

  it('正常 payload 完整恢复', () => {
    const ts = 1785859200000
    const store = hydrate(JSON.stringify({
      pityCounters: { [PERMANENT_POOL_ID]: 3 },
      lastDailyFree: { [LIMITED_POOL_ID]: ts },
      history: [{ timestamp: ts, poolId: PERMANENT_POOL_ID, result: { id: 'gold_1000' }, isPity: true }]
    }))
    expect(store.state.pityCounters[PERMANENT_POOL_ID]).toBe(3)
    expect(store.state.lastDailyFree[LIMITED_POOL_ID]).toBe(ts)
    expect(store.state.history.length).toBe(1)
    expect(store.state.history[0].result.id).toBe('gold_1000')
    expect(store.state.history[0].isPity).toBe(true)
  })

  it('hydration 零写盘（合法/非法/损坏 raw）', () => {
    const raws = [
      JSON.stringify({ pityCounters: { [PERMANENT_POOL_ID]: 5 }, lastDailyFree: {}, history: [] }),
      JSON.stringify({ pityCounters: 'bad', lastDailyFree: null, history: [{ timestamp: -1 }] }),
      '{broken',
      'null'
    ]
    for (const raw of raws) {
      vi.restoreAllMocks() // 清除上一轮 spy，避免 wrap 链记录 seed 写入
      const { setItemSpy, removeSpy } = hydrateTracked(raw)
      expect(setItemSpy).not.toHaveBeenCalled()
      expect(removeSpy).not.toHaveBeenCalled()
    }
  })

  it('fresh Pinia 水合后 Phase 3.62 抽卡事务仍正常', () => {
    setActivePinia(createPinia())
    warmNonGachaStores()
    const playerStore = usePlayerStore()
    playerStore.player.diamond = 10000
    const gacha = useGachaStore()
    const result = gacha.pull(PERMANENT_POOL_ID, 1, { seed: 5 })
    expect(result.length).toBe(1)
    expect(playerStore.player.diamond).toBe(10000 - 280)
    expect(gacha.state.pityCounters[PERMANENT_POOL_ID]).toBe(1)
    expect(gacha.state.history.length).toBe(1)
  })
})
