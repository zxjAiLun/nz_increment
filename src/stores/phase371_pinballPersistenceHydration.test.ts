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
import { useLuckyWheelStore } from './luckyWheelStore'
import { usePachinkoStore } from './pachinkoStore'
import { usePinballStore } from './pinballStore'
import { PINBALL_SCORE_BANDS } from '../data/pinball'

/**
 * Phase 3.71 — Pinball 持久化 hydration 与启动容错。
 *
 * - load() 改为 raw → parse → 逐字段 fail-closed 规范化 → 完整 candidate → 一次性提交；
 * - tokens 仅非负安全整数；plays/conversions 逐条过滤且最多 20 条；
 * - play 用 canonical scoreBand 重建；conversion 仅保留符合当前兑换合同的记录；
 * - 任何 getItem/parse/normalization 异常 → 默认状态、不抛错、零写盘，公开 action 仍可运行。
 */

const PINBALL_KEY = 'nz_pinball_v1'
const monday = Date.UTC(2026, 3, 20)

const VALID_PLAY = {
  timestamp: 1785859200000,
  score: 250,
  tokensGained: 2,
  rolls: [0.5, 0.6, 0.7],
  scoreBand: PINBALL_SCORE_BANDS[1] // combo
}

const VALID_CONVERSION = {
  timestamp: 1785859200000,
  poolId: 'permanent_abyss',
  tokensSpent: 3,
  rarePlusBonus: 3
}

function warmNonPinballStores() {
  usePlayerStore()
  useMonsterStore()
  useGameStore()
  useTrainingStore()
  useATBStore()
  useRebirthStore()
  useThemeStore()
  useProbabilityStore()
  useGachaStore()
  useLuckyWheelStore()
  usePachinkoStore()
}

function seedRaw(raw: string | null) {
  if (raw === null) localStorage.removeItem(PINBALL_KEY)
  else localStorage.setItem(PINBALL_KEY, raw)
}

function createStore() {
  setActivePinia(createPinia())
  return usePinballStore()
}

function hydrate(raw: string | null) {
  seedRaw(raw)
  return createStore()
}

function hydrateTracked(raw: string | null) {
  seedRaw(raw)
  setActivePinia(createPinia())
  warmNonPinballStores()
  const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
  const removeSpy = vi.spyOn(Storage.prototype, 'removeItem')
  const store = usePinballStore()
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

describe('Phase 3.71 — 无存档与启动容错', () => {
  it('key 缺失：默认值、零写盘', () => {
    const { store, setItemSpy, removeSpy } = hydrateTracked(null)
    expect(store.state.tokens).toBe(0)
    expect(store.state.plays).toEqual([])
    expect(store.state.conversions).toEqual([])
    expect(setItemSpy).not.toHaveBeenCalled()
    expect(removeSpy).not.toHaveBeenCalled()
  })

  it('getItem 抛错：Store 创建不抛、默认状态', () => {
    seedRaw('{"tokens": 5}')
    setActivePinia(createPinia())
    warmNonPinballStores()
    const originalGetItem = Storage.prototype.getItem
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key: string) {
      if (key === PINBALL_KEY) throw new Error('read boom')
      return originalGetItem.call(this, key)
    })
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    const store = createStore()
    expect(store.state.tokens).toBe(0)
    expect(store.state.plays).toEqual([])
    expect(store.state.conversions).toEqual([])
    expect(setItemSpy).not.toHaveBeenCalled()
  })

  it('malformed JSON：Store 创建不抛、默认状态', () => {
    const store = hydrate('{broken json')
    expect(store.state.tokens).toBe(0)
    expect(store.state.plays).toEqual([])
    expect(store.state.conversions).toEqual([])
  })

  it('root 为 null/数组/字符串/数字：回退默认', () => {
    for (const raw of ['null', '[]', '"str"', '5']) {
      const store = hydrate(raw)
      expect(store.state.tokens).toBe(0)
      expect(store.state.plays).toEqual([])
      expect(store.state.conversions).toEqual([])
    }
  })
})

describe('Phase 3.71 — tokens 与容器类型', () => {
  it('tokens 各类非法值回退为 0；合法非负安全整数保留', () => {
    for (const bad of [-1, 1.5, '5', true, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(hydrate(JSON.stringify({ tokens: bad })).state.tokens).toBe(0)
    }
    expect(hydrate(JSON.stringify({ tokens: 5 })).state.tokens).toBe(5)
    expect(hydrate(JSON.stringify({ tokens: 0 })).state.tokens).toBe(0)
  })

  it('非数组 plays/conversions 回退为空；plays:{} 不再导致 unshift 崩溃', () => {
    const store = hydrate(JSON.stringify({ tokens: 3, plays: {}, conversions: 'bad' }))
    expect(store.state.plays).toEqual([])
    expect(store.state.conversions).toEqual([])
    expect(() => store.state.plays.unshift(VALID_PLAY as never)).not.toThrow() // 安全消费
  })

  it('plays/conversions 含 [null] 时嵌套记录不进入公开 state', () => {
    const store = hydrate(JSON.stringify({ tokens: 3, plays: [null], conversions: [null] }))
    expect(store.state.plays).toEqual([])
    expect(store.state.conversions).toEqual([])
  })
})

describe('Phase 3.71 — play record 校验', () => {
  it('合法完整 payload 保留；plays 混合合法与 null/primitive 只保留合法项', () => {
    const store = hydrate(JSON.stringify({
      tokens: 7,
      plays: [VALID_PLAY, null, 'str', 5, {}],
      conversions: [VALID_CONVERSION]
    }))
    expect(store.state.tokens).toBe(7)
    expect(store.state.plays.length).toBe(1)
    expect(store.state.plays[0].timestamp).toBe(VALID_PLAY.timestamp)
    expect(store.state.conversions.length).toBe(1)
  })

  it('非法 timestamp / score / tokensGained → 丢弃', () => {
    const bads = [
      { ...VALID_PLAY, timestamp: -1 },
      { ...VALID_PLAY, timestamp: 1.5 },
      { ...VALID_PLAY, score: -1 },
      { ...VALID_PLAY, score: NaN },
      { ...VALID_PLAY, score: 1.5 },
      { ...VALID_PLAY, tokensGained: -1 },
      { ...VALID_PLAY, tokensGained: 1.5 }
    ]
    for (const bad of bads) {
      const store = hydrate(JSON.stringify({ plays: [bad] }))
      expect(store.state.plays.length).toBe(0)
    }
  })

  it('rolls 非数组/长度错误/越界/非有限值 → 丢弃', () => {
    const bads = [
      { ...VALID_PLAY, rolls: 'x' },
      { ...VALID_PLAY, rolls: [0.5, 0.6] },
      { ...VALID_PLAY, rolls: [0.5, 0.6, 0.7, 0.8] },
      { ...VALID_PLAY, rolls: [1.5, 0.6, 0.7] },
      { ...VALID_PLAY, rolls: [-0.1, 0.6, 0.7] },
      { ...VALID_PLAY, rolls: [0.5, NaN, 0.7] }
    ]
    for (const bad of bads) {
      const store = hydrate(JSON.stringify({ plays: [bad] }))
      expect(store.state.plays.length).toBe(0)
    }
  })

  it('scoreBand 缺失/primitive/未知 id → 丢弃；raw 篡改 → canonical band', () => {
    expect(hydrate(JSON.stringify({ plays: [{ ...VALID_PLAY, scoreBand: undefined }] })).state.plays.length).toBe(0)
    expect(hydrate(JSON.stringify({ plays: [{ ...VALID_PLAY, scoreBand: 'x' }] })).state.plays.length).toBe(0)
    expect(hydrate(JSON.stringify({ plays: [{ ...VALID_PLAY, scoreBand: { id: 'nonexistent' } }] })).state.plays.length).toBe(0)
    // raw 篡改 name/minScore/tokens → canonical band 重建
    const store = hydrate(JSON.stringify({
      plays: [{ ...VALID_PLAY, scoreBand: { id: 'steady', name: 'HACKED', minScore: 999, tokens: 99 } }]
    }))
    expect(store.state.plays.length).toBe(1)
    expect(store.state.plays[0].scoreBand).toEqual(PINBALL_SCORE_BANDS[0]) // canonical steady
    expect(store.state.plays[0].scoreBand.name).not.toBe('HACKED')
  })
})

describe('Phase 3.71 — conversion record 校验', () => {
  it('非法 timestamp/poolId/tokensSpent → 丢弃', () => {
    const bads = [
      { ...VALID_CONVERSION, timestamp: 0 },
      { ...VALID_CONVERSION, poolId: '' },
      { ...VALID_CONVERSION, poolId: 5 },
      { ...VALID_CONVERSION, tokensSpent: 0 },
      { ...VALID_CONVERSION, tokensSpent: 11 },
      { ...VALID_CONVERSION, tokensSpent: 1.5 },
      { ...VALID_CONVERSION, rarePlusBonus: -1 }
    ]
    for (const bad of bads) {
      const store = hydrate(JSON.stringify({ conversions: [bad] }))
      expect(store.state.conversions.length).toBe(0)
    }
  })

  it('rarePlusBonus 与 tokensSpent 不匹配时丢弃，不在 load 时静默改写', () => {
    const store = hydrate(JSON.stringify({ conversions: [{ ...VALID_CONVERSION, rarePlusBonus: 5 }] }))
    expect(store.state.conversions.length).toBe(0) // 3 tokens → 应为 3，写 5 → 丢弃
    const store2 = hydrate(JSON.stringify({ conversions: [VALID_CONVERSION] }))
    expect(store2.state.conversions.length).toBe(1)
    expect(store2.state.conversions[0].rarePlusBonus).toBe(3)
  })
})

describe('Phase 3.71 — 上限与 raw 隔离', () => {
  it('plays/conversions hydration 上限均为 20', () => {
    const plays = Array.from({ length: 25 }, (_, i) => ({ ...VALID_PLAY, timestamp: 1000 + i }))
    const conversions = Array.from({ length: 25 }, (_, i) => ({ ...VALID_CONVERSION, timestamp: 1000 + i }))
    const store = hydrate(JSON.stringify({ plays, conversions }))
    expect(store.state.plays.length).toBe(20)
    expect(store.state.conversions.length).toBe(20)
    expect(store.state.plays[0].timestamp).toBe(1000) // 顺序保持
  })

  it('hydration 后修改 state 不修改原 raw 对象', () => {
    const raw = JSON.stringify({ tokens: 3, plays: [VALID_PLAY], conversions: [VALID_CONVERSION] })
    const store = hydrate(raw)
    store.state.tokens = 100
    store.state.plays.push({ ...VALID_PLAY, timestamp: 999 } as never)
    expect(localStorage.getItem(PINBALL_KEY)).toBe(raw) // 原 raw 逐字节不变
  })
})

describe('Phase 3.71 — 公开 action 与消费者回归', () => {
  it('malformed raw 后公开 playEvent 可成功', () => {
    const store = hydrate('{broken json')
    expect(store.state.tokens).toBe(0)
    const record = store.playEvent({ seed: 2026, now: monday })
    expect(record).not.toBeNull()
    expect(store.state.plays.length).toBe(1)
    expect(store.state.tokens).toBe(record?.tokensGained ?? 0)
  })

  it('malformed raw 后设置合法 tokens，公开 convertTokensToModifier 可成功', () => {
    const store = hydrate('{broken json')
    store.state.tokens = 5
    const record = store.convertTokensToModifier(undefined, 3, { now: monday })
    expect(record?.tokensSpent).toBe(3)
    expect(store.state.tokens).toBe(2)
    expect(store.state.conversions.length).toBe(1)
  })

  it('malformed raw 下 PinballPanel 所需字段可直接消费不抛错', () => {
    const store = hydrate('{broken json')
    // PinballPanel 直接读取 tokens、最近 play、最近 conversion
    const tokens = store.state.tokens
    const lastPlay = store.state.plays[0]
    const lastConversion = store.state.conversions[0]
    expect(tokens).toBe(0)
    expect(lastPlay).toBeUndefined()
    expect(lastConversion).toBeUndefined()
    expect(store.state.plays).toEqual([])
    expect(store.state.conversions).toEqual([])
  })
})
