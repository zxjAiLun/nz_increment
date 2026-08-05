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
import { PERMANENT_POOL_ID } from '../data/gachaPools'

/**
 * Phase 3.64 — Probability 持久化安全 hydration。
 *
 * - load() 改为 raw → parse → 逐字段 fail-closed 规范化 → 完整 candidate → 一次性提交；
 * - outcomes 最多保留 50 条、pendingModifiers 逐条枚举/数值校验、budgetUsage 仅保留已知游戏；
 * - 任何异常 → 三字段全默认、零写回。
 */

const PROBABILITY_KEY = 'nz_probability_v1'

const VALID_OUTCOME = {
  gameId: 'pachinko',
  seed: 'seed-1',
  source: 'pachinko',
  label: 'outcome',
  route: ['a', 'b'],
  score: 10,
  tokens: 5,
  expectedValueCost: 3,
  freePulls: 1,
  jackpot: false
}

const VALID_MODIFIER = {
  id: 'mod-1',
  source: 'pachinko',
  label: 'modifier',
  poolId: PERMANENT_POOL_ID,
  appliesTo: 'tenPull',
  appliesToCost: 'paidOnly',
  rarePlusBonus: 5,
  rarityBonus: { legendary: 2 }
}

const VALID_BUDGET = {
  periodKey: 'day:2026-01-06|week:2026-01-05',
  dailyPeriodKey: 'day:2026-01-06',
  weeklyPeriodKey: 'week:2026-01-05',
  expectedValue: 10,
  legendaryRateBonus: 1,
  pityGain: 2,
  freePulls: 1,
  jackpots: 0
}

function warmNonProbabilityStores() {
  usePlayerStore()
  useMonsterStore()
  useGameStore()
  useTrainingStore()
  useATBStore()
  useRebirthStore()
  useThemeStore()
  useGachaStore()
}

function seedRaw(raw: string | null) {
  if (raw === null) localStorage.removeItem(PROBABILITY_KEY)
  else localStorage.setItem(PROBABILITY_KEY, raw)
}

function createStore() {
  setActivePinia(createPinia())
  return useProbabilityStore()
}

function hydrate(raw: string | null) {
  seedRaw(raw)
  return createStore()
}

function hydrateTracked(raw: string | null) {
  seedRaw(raw)
  setActivePinia(createPinia())
  warmNonProbabilityStores()
  const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
  const removeSpy = vi.spyOn(Storage.prototype, 'removeItem')
  const store = useProbabilityStore()
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

describe('Phase 3.64 — 无存档与读取失败', () => {
  it('无 raw：三字段全默认、零写盘', () => {
    const { store, setItemSpy, removeSpy } = hydrateTracked(null)
    expect(store.state.outcomes).toEqual([])
    expect(store.state.pendingModifiers).toEqual([])
    expect(store.state.budgetUsage).toEqual({})
    expect(setItemSpy).not.toHaveBeenCalled()
    expect(removeSpy).not.toHaveBeenCalled()
  })

  it('getItem 抛错：默认状态、Store 构造不抛、零写盘', () => {
    seedRaw(JSON.stringify({ outcomes: [VALID_OUTCOME] }))
    setActivePinia(createPinia())
    warmNonProbabilityStores()
    const originalGetItem = Storage.prototype.getItem
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key: string) {
      if (key === PROBABILITY_KEY) throw new Error('read boom')
      return originalGetItem.call(this, key)
    })
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    const store = createStore()
    expect(store.state.outcomes).toEqual([])
    expect(store.state.pendingModifiers).toEqual([])
    expect(store.state.budgetUsage).toEqual({})
    expect(setItemSpy).not.toHaveBeenCalled()
  })

  it('malformed JSON：默认状态', () => {
    const store = hydrate('{broken json')
    expect(store.state.outcomes).toEqual([])
    expect(store.state.pendingModifiers).toEqual([])
    expect(store.state.budgetUsage).toEqual({})
  })
})

describe('Phase 3.64 — 顶层与容器类型', () => {
  it('顶层 null/array/string/number/boolean → 默认', () => {
    for (const raw of ['null', '[]', '"str"', '5', 'true']) {
      const store = hydrate(raw)
      expect(store.state.outcomes).toEqual([])
      expect(store.state.pendingModifiers).toEqual([])
      expect(store.state.budgetUsage).toEqual({})
    }
  })

  it('outcomes/pendingModifiers 非数组、budgetUsage 非对象 → 默认', () => {
    for (const bad of [null, {}, 'x']) {
      const store = hydrate(JSON.stringify({ outcomes: bad, pendingModifiers: bad, budgetUsage: bad }))
      expect(store.state.outcomes).toEqual([])
      expect(store.state.pendingModifiers).toEqual([])
      expect(store.state.budgetUsage).toEqual({})
    }
  })
})

describe('Phase 3.64 — outcomes 规范化', () => {
  it('合法/非法混合：非法丢弃、合法保留、最多 50 条', () => {
    const valid55 = Array.from({ length: 55 }, (_, i) => ({ ...VALID_OUTCOME, seed: `seed-${i}` }))
    const store = hydrate(JSON.stringify({
      outcomes: [
        ...valid55,
        { gameId: 'unknown_game', seed: 's', source: 'pachinko', label: 'x' }, // 未知 game
        { gameId: 'pachinko', seed: 5, source: 'pachinko', label: 'x' }, // 非法 seed
        { gameId: 'pachinko', seed: 's', source: 'bad_source', label: 'x' }, // 非法 source
        { gameId: 'pachinko', seed: 's', source: 'pachinko', label: 'x', route: 'not-array' }, // 非法 route
        { gameId: 'pachinko', seed: 's', source: 'pachinko', label: 'x', score: -1 }, // 非法数值
        { gameId: 'pachinko', seed: 's', source: 'pachinko', label: 'x', jackpot: 'yes' }, // 非法 jackpot
        { gameId: 'pachinko', seed: 's', source: 'pachinko', label: 'x', modifier: { id: 'm', source: 'bad', label: 'x' } }, // 非法 modifier
        { gameId: 'pachinko', seed: 's', source: 'pachinko', label: 'x', audit: 'garbage' } // 非法 audit
      ]
    }))
    expect(store.state.outcomes.length).toBe(50) // 前 50 合法保留
    expect(store.state.outcomes[0].gameId).toBe('pachinko')
    expect(store.state.outcomes[0].route).toEqual(['a', 'b'])
  })
})

describe('Phase 3.64 — modifier 枚举与数值过滤', () => {
  it('非法枚举/负数/NaN/非法 rarity → 丢弃', () => {
    const store = hydrate(JSON.stringify({
      pendingModifiers: [
        VALID_MODIFIER,
        { id: '', source: 'pachinko', label: 'x' }, // 空 id
        { id: 'm', source: 'bad', label: 'x' }, // 非法 source
        { id: 'm', source: 'pachinko', label: 'x', appliesTo: 'singlePull' }, // 非法枚举
        { id: 'm', source: 'pachinko', label: 'x', appliesToCost: 'maybe' }, // 非法 cost 枚举
        { id: 'm', source: 'pachinko', label: 'x', rarePlusBonus: -1 }, // 负数值
        { id: 'm', source: 'pachinko', label: 'x', extraRolls: NaN }, // NaN
        { id: 'm', source: 'pachinko', label: 'x', rarityBonus: { legendary: -1 } }, // 负 rarity
        { id: 'm', source: 'pachinko', label: 'x', rarityBonus: { mythic: 5 } }, // 非法 rarity
        { id: 'm', source: 'pachinko', label: 'x', poolId: 5 } // 非法 poolId
      ]
    }))
    expect(store.state.pendingModifiers.length).toBe(1)
    expect(store.state.pendingModifiers[0].id).toBe('mod-1')
    expect(store.state.pendingModifiers[0].rarityBonus).toEqual({ legendary: 2 })
  })
})

describe('Phase 3.64 — budgetUsage 规范化', () => {
  it('已知/未知 game 与数值边界', () => {
    const store = hydrate(JSON.stringify({
      budgetUsage: {
        pachinko: VALID_BUDGET,
        unknown_game: VALID_BUDGET,
        pinball: { ...VALID_BUDGET, expectedValue: -1 },
        monopoly: { ...VALID_BUDGET, freePulls: 1.5 },
        luckyWheel: { ...VALID_BUDGET, periodKey: 5 },
        '': VALID_BUDGET
      }
    }))
    const usageMap = store.state.budgetUsage as Record<string, unknown>
    expect(usageMap['pachinko']).toEqual(VALID_BUDGET)
    expect(usageMap['unknown_game']).toBeUndefined()
    expect(usageMap['pinball']).toBeUndefined() // 负 expectedValue
    expect(usageMap['monopoly']).toBeUndefined() // 非整数 freePulls
    expect(usageMap['luckyWheel']).toBeUndefined() // 非字符串 periodKey
    expect(usageMap['']).toBeUndefined()
  })
})

describe('Phase 3.64 — 原子性与零写回', () => {
  it('normalization 中途真实 throw：三字段全默认、零部分提交、raw 未变化', () => {
    const raw = JSON.stringify({
      outcomes: [{ ...VALID_OUTCOME, freePulls: 1 }],
      pendingModifiers: [VALID_MODIFIER],
      budgetUsage: { pachinko: VALID_BUDGET }
    })
    seedRaw(raw)
    setActivePinia(createPinia())
    warmNonProbabilityStores()
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
    expect(calls).toBe(2) // 第一个计数（outcome.freePulls）成功，第二个（budgetUsage.freePulls）真实抛错
    expect(store.state.outcomes).toEqual([])
    expect(store.state.pendingModifiers).toEqual([])
    expect(store.state.budgetUsage).toEqual({})
    expect(setItemSpy).not.toHaveBeenCalled()
    expect(removeSpy).not.toHaveBeenCalled()
    expect(localStorage.getItem(PROBABILITY_KEY)).toBe(raw)
  })

  it('正常 payload 完整恢复', () => {
    const store = hydrate(JSON.stringify({
      outcomes: [VALID_OUTCOME],
      pendingModifiers: [VALID_MODIFIER],
      budgetUsage: { pachinko: VALID_BUDGET }
    }))
    expect(store.state.outcomes.length).toBe(1)
    expect(store.state.outcomes[0].gameId).toBe('pachinko')
    expect(store.state.pendingModifiers.length).toBe(1)
    expect(store.state.pendingModifiers[0].id).toBe('mod-1')
    expect(store.state.budgetUsage['pachinko']).toEqual(VALID_BUDGET)
  })

  it('hydration 零写盘（合法/非法/损坏 raw）', () => {
    const raws = [
      JSON.stringify({ outcomes: [VALID_OUTCOME], pendingModifiers: [VALID_MODIFIER], budgetUsage: { pachinko: VALID_BUDGET } }),
      JSON.stringify({ outcomes: 'bad', pendingModifiers: [{ id: 'm', source: 'bad', label: 'x' }], budgetUsage: {} }),
      '{broken',
      'null'
    ]
    for (const raw of raws) {
      vi.restoreAllMocks() // 清除上一轮 spy，避免 wrap 链污染
      const { setItemSpy, removeSpy } = hydrateTracked(raw)
      expect(setItemSpy).not.toHaveBeenCalled()
      expect(removeSpy).not.toHaveBeenCalled()
    }
  })

  it('fresh Pinia 水合后 Phase 3.62 有 modifier 抽卡仍正常', () => {
    setActivePinia(createPinia())
    warmNonProbabilityStores()
    const prob = useProbabilityStore()
    prob.addPendingModifier(PERMANENT_POOL_ID, {
      id: 'pachinko_ten_pull_modifier',
      source: 'pachinko',
      label: '十连加成',
      appliesTo: 'tenPull',
      appliesToCost: 'paidOnly',
      rarePlusBonus: 6
    })
    // fresh Pinia 重载：水合持久化的 modifier
    setActivePinia(createPinia())
    warmNonProbabilityStores()
    const playerStore = usePlayerStore()
    playerStore.player.diamond = 10000
    const freshProb = useProbabilityStore()
    const gacha = useGachaStore()
    expect(freshProb.state.pendingModifiers.some(m => m.id === 'pachinko_ten_pull_modifier')).toBe(true)
    const result = gacha.pull(PERMANENT_POOL_ID, 10, { seed: 2 })
    expect(result.length).toBe(10)
    expect(playerStore.player.diamond).toBe(10000 - 2800)
    expect(freshProb.state.pendingModifiers.some(m => m.id === 'pachinko_ten_pull_modifier')).toBe(false) // 被消耗
  })
})
