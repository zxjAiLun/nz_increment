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
import { useSigninStore } from './signinStore'

/**
 * Phase 3.61 — nz_signin 原子规范化持久化水合。
 *
 * - signinStore.load() 改为 raw → JSON.parse → 顶层对象校验 → 逐字段 fail-closed 规范化 →
 *   应用既有 UTC 跨日规则 → 完整构造 candidate → 最后一次提交全部四个 ref。
 * - 任何损坏/缺失/异常输入：默认 candidate、零异常逃出 Store 初始化、零部分提交、零写回。
 * - 测试通过「预先设置 nz_signin raw → fresh Pinia → 首次 useSigninStore()」触发真实初始化。
 */

const SIGNIN_KEY = 'nz_signin'
const TODAY = new Date().toISOString().split('T')[0]
const YESTERDAY = new Date(Date.now() - 86400000).toISOString().split('T')[0]
const TOMORROW = new Date(Date.now() + 86400000).toISOString().split('T')[0]

function warmNonSigninStores() {
  usePlayerStore()
  useMonsterStore()
  useGameStore()
  useTrainingStore()
  useATBStore()
  useRebirthStore()
  useThemeStore()
}

function seedSigninRaw(raw: string | null) {
  if (raw === null) localStorage.removeItem(SIGNIN_KEY)
  else localStorage.setItem(SIGNIN_KEY, raw)
}

/** 触发真实 Store 初始化水合。 */
function createStore() {
  setActivePinia(createPinia())
  warmNonSigninStores()
  return useSigninStore()
}

function hydrate(raw: string | null) {
  seedSigninRaw(raw)
  return createStore()
}

/** 先就绪非 signin store，再安装针对 signin 水合的 spy。 */
function hydrateTracked(raw: string | null) {
  seedSigninRaw(raw)
  setActivePinia(createPinia())
  warmNonSigninStores()
  const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
  const removeSpy = vi.spyOn(Storage.prototype, 'removeItem')
  const saveGameSpy = vi.spyOn(usePlayerStore(), 'saveGame')
  const store = useSigninStore()
  return { store, setItemSpy, removeSpy, saveGameSpy }
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('Phase 3.61 — 无存档及读取失败', () => {
  it('无 key：四字段全默认、零写盘、零 Player save', () => {
    const { store, setItemSpy, removeSpy, saveGameSpy } = hydrateTracked(null)
    expect(store.todaySigned).toBe(false)
    expect(store.consecutiveDays).toBe(0)
    expect(store.lastSigninDate).toBeNull()
    expect(store.totalSignins).toBe(0)
    expect(setItemSpy).not.toHaveBeenCalled()
    expect(removeSpy).not.toHaveBeenCalled()
    expect(saveGameSpy).not.toHaveBeenCalled()
  })

  it('空字符串：默认状态', () => {
    const store = hydrate('')
    expect(store.todaySigned).toBe(false)
    expect(store.consecutiveDays).toBe(0)
    expect(store.lastSigninDate).toBeNull()
    expect(store.totalSignins).toBe(0)
  })

  it('getItem 抛错：默认状态、Store 初始化不向外抛、零写盘', () => {
    seedSigninRaw('{"todaySigned": true, "consecutiveDays": 5, "totalSignins": 3}')
    setActivePinia(createPinia())
    warmNonSigninStores()
    const originalGetItem = Storage.prototype.getItem
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key: string) {
      if (key === SIGNIN_KEY) throw new Error('read boom')
      return originalGetItem.call(this, key)
    })
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    const store = createStore()
    expect(store.todaySigned).toBe(false)
    expect(store.consecutiveDays).toBe(0)
    expect(store.lastSigninDate).toBeNull()
    expect(store.totalSignins).toBe(0)
    expect(setItemSpy).not.toHaveBeenCalled()
  })
})

describe('Phase 3.61 — JSON 解析与顶层边界', () => {
  it('malformed JSON / null / [] / string / number / boolean 全部默认且零写回', () => {
    const raws = ['{invalid', 'null', '[]', '"string"', '0', '1', 'true', 'false']
    for (const raw of raws) {
      vi.restoreAllMocks() // 清除上一轮 spy，避免 wrap 链记录 seed 写入
      const { store, setItemSpy, removeSpy } = hydrateTracked(raw)
      expect(store.todaySigned).toBe(false)
      expect(store.consecutiveDays).toBe(0)
      expect(store.lastSigninDate).toBeNull()
      expect(store.totalSignins).toBe(0)
      expect(setItemSpy).not.toHaveBeenCalled()
      expect(removeSpy).not.toHaveBeenCalled()
    }
  })
})

describe('Phase 3.61 — todaySigned 仅接受精确 boolean', () => {
  it('true/false 精确保留', () => {
    expect(hydrate(JSON.stringify({ todaySigned: true, lastSigninDate: TODAY })).todaySigned).toBe(true)
    expect(hydrate(JSON.stringify({ todaySigned: false, lastSigninDate: TODAY })).todaySigned).toBe(false)
  })

  it('1/0/"true"/"false"/null/{}/[] 一律归一为 false', () => {
    for (const bad of [1, 0, 'true', 'false', 'yes', null, {}, []]) {
      const store = hydrate(JSON.stringify({ todaySigned: bad, lastSigninDate: TODAY }))
      expect(store.todaySigned).toBe(false)
    }
  })
})

describe('Phase 3.61 — 两个计数器规范化', () => {
  const counterCases: Array<[unknown, number]> = [
    [0, 0],
    [1, 1],
    [42, 42],
    [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
    [-1, 0],
    [1.5, 0],
    ['5', 0],
    [true, 0],
    [null, 0],
    [{}, 0],
    [[], 0],
    [9007199254740992, 0]
  ]

  for (const [input, expected] of counterCases) {
    it(`consecutiveDays ${String(input)} → ${expected}`, () => {
      expect(hydrate(JSON.stringify({ consecutiveDays: input })).consecutiveDays).toBe(expected)
    })
    it(`totalSignins ${String(input)} → ${expected}`, () => {
      expect(hydrate(JSON.stringify({ totalSignins: input })).totalSignins).toBe(expected)
    })
  }
})

describe('Phase 3.61 — 日期规范化', () => {
  const dateCases: Array<[unknown, string | null]> = [
    [TODAY, TODAY],
    [YESTERDAY, YESTERDAY],
    [TOMORROW, TOMORROW],
    ['2024-02-29', '2024-02-29'],
    ['2025-02-29', null], // 非闰年
    ['2026-02-30', null], // 不存在日期
    ['2026-8-5', null], // 非补零
    [' 2026-08-05', null], // 前导空白，不 trim
    ['2026-08-05T00:00:00Z', null], // 完整 timestamp
    ['', null],
    [123, null],
    [{}, null],
    [[], null],
    [null, null]
  ]

  for (const [input, expected] of dateCases) {
    it(`lastSigninDate ${JSON.stringify(input)} → ${JSON.stringify(expected)}`, () => {
      expect(hydrate(JSON.stringify({ lastSigninDate: input })).lastSigninDate).toBe(expected)
    })
  }
})

describe('Phase 3.61 — 跨日规则（仅重置 todaySigned）', () => {
  it('todaySigned=true + 今天 → true', () => {
    const store = hydrate(JSON.stringify({ todaySigned: true, consecutiveDays: 3, lastSigninDate: TODAY, totalSignins: 5 }))
    expect(store.todaySigned).toBe(true)
    expect(store.consecutiveDays).toBe(3)
    expect(store.totalSignins).toBe(5)
    expect(store.lastSigninDate).toBe(TODAY)
  })

  it('todaySigned=false + 今天 → false', () => {
    expect(hydrate(JSON.stringify({ todaySigned: false, lastSigninDate: TODAY })).todaySigned).toBe(false)
  })

  it('todaySigned=true + 昨天 → false，合法过去日期保留', () => {
    const store = hydrate(JSON.stringify({ todaySigned: true, consecutiveDays: 3, lastSigninDate: YESTERDAY, totalSignins: 5 }))
    expect(store.todaySigned).toBe(false)
    expect(store.consecutiveDays).toBe(3)
    expect(store.totalSignins).toBe(5)
    expect(store.lastSigninDate).toBe(YESTERDAY) // 合法过去日期不重写为今天
  })

  it('todaySigned=true + 合法未来日期 → false，未来日期保留', () => {
    const store = hydrate(JSON.stringify({ todaySigned: true, lastSigninDate: TOMORROW }))
    expect(store.todaySigned).toBe(false)
    expect(store.lastSigninDate).toBe(TOMORROW)
  })

  it('todaySigned=true + 非法日期 → false，日期归一为 null', () => {
    const store = hydrate(JSON.stringify({ todaySigned: true, lastSigninDate: '2026-02-30' }))
    expect(store.todaySigned).toBe(false)
    expect(store.lastSigninDate).toBeNull()
  })

  it('todaySigned=true + null → false，日期为 null', () => {
    const store = hydrate(JSON.stringify({ todaySigned: true, lastSigninDate: null }))
    expect(store.todaySigned).toBe(false)
    expect(store.lastSigninDate).toBeNull()
  })
})

describe('Phase 3.61 — 字段独立规范化', () => {
  it('混合对象：每个字段独立规范化、extra 忽略', () => {
    const store = hydrate(JSON.stringify({ todaySigned: true, consecutiveDays: -1, lastSigninDate: TODAY, totalSignins: 12, extra: 'ignored' }))
    expect(store.todaySigned).toBe(true)
    expect(store.consecutiveDays).toBe(0)
    expect(store.lastSigninDate).toBe(TODAY)
    expect(store.totalSignins).toBe(12)
  })

  it('日期非法只影响日期与 todaySigned，合法计数器保留', () => {
    const store = hydrate(JSON.stringify({ todaySigned: true, consecutiveDays: 5, lastSigninDate: 'bad', totalSignins: 3 }))
    expect(store.todaySigned).toBe(false)
    expect(store.consecutiveDays).toBe(5)
    expect(store.lastSigninDate).toBeNull()
    expect(store.totalSignins).toBe(3)
  })
})

describe('Phase 3.61 — 原子性故障注入', () => {
  it('第二个计数规范化真实 throw：全默认、零部分提交、零 set/remove、raw 未变化', () => {
    const raw = JSON.stringify({ todaySigned: true, consecutiveDays: 5, lastSigninDate: TODAY, totalSignins: 3 })
    seedSigninRaw(raw)
    setActivePinia(createPinia())
    warmNonSigninStores()
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
    expect(calls).toBe(2) // 第一个计数字段（consecutiveDays）成功，第二个（totalSignins）真实抛错
    expect(store.todaySigned).toBe(false)
    expect(store.consecutiveDays).toBe(0)
    expect(store.lastSigninDate).toBeNull()
    expect(store.totalSignins).toBe(0)
    expect(setItemSpy).not.toHaveBeenCalled()
    expect(removeSpy).not.toHaveBeenCalled()
    expect(localStorage.getItem(SIGNIN_KEY)).toBe(raw)
  })

  it('UTC today 计算 throw：全默认、零异常逃出、零写盘', () => {
    const raw = JSON.stringify({ todaySigned: true, consecutiveDays: 5, lastSigninDate: TODAY, totalSignins: 3 })
    seedSigninRaw(raw)
    setActivePinia(createPinia())
    warmNonSigninStores()
    vi.spyOn(Date.prototype, 'toISOString').mockImplementation(() => {
      throw new Error('date boom')
    })
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    const store = createStore()
    expect(store.todaySigned).toBe(false)
    expect(store.consecutiveDays).toBe(0)
    expect(store.lastSigninDate).toBeNull()
    expect(store.totalSignins).toBe(0)
    expect(setItemSpy).not.toHaveBeenCalled()
  })
})

describe('Phase 3.61 — raw 逐字节保留', () => {
  it('合法完整对象、部分损坏、malformed JSON、顶层非法均逐字节不变', () => {
    const raws = [
      JSON.stringify({ todaySigned: true, consecutiveDays: 5, lastSigninDate: TODAY, totalSignins: 3 }),
      JSON.stringify({ todaySigned: true, consecutiveDays: -1, lastSigninDate: 'bad', totalSignins: 3, extra: 'x' }),
      '{broken json',
      'null'
    ]
    for (const raw of raws) {
      seedSigninRaw(raw)
      createStore()
      expect(localStorage.getItem(SIGNIN_KEY)).toBe(raw)
    }
  })
})

describe('Phase 3.61 — Phase 3.60 集成回归', () => {
  it('同日 todaySigned=true 水合后：canSignin false、signin 返回 already signed、零写盘', () => {
    const { store, setItemSpy } = hydrateTracked(JSON.stringify({ todaySigned: true, consecutiveDays: 1, lastSigninDate: TODAY, totalSignins: 1 }))
    expect(store.canSignin()).toBe(false)
    expect(store.signin()).toEqual({ ok: false, reason: 'already signed' })
    expect(store.consecutiveDays).toBe(1)
    expect(store.totalSignins).toBe(1)
    expect(setItemSpy).not.toHaveBeenCalled()
  })

  it('旧日 todaySigned=true 水合后：todaySigned=false、canSignin true', () => {
    const store = hydrate(JSON.stringify({ todaySigned: true, consecutiveDays: 1, lastSigninDate: YESTERDAY, totalSignins: 1 }))
    expect(store.todaySigned).toBe(false)
    expect(store.canSignin()).toBe(true)
    expect(store.consecutiveDays).toBe(1)
    expect(store.lastSigninDate).toBe(YESTERDAY)
  })
})
