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
import { PACHINKO_MODIFIERS } from '../data/pachinko'

/**
 * Phase 3.72 — Pachinko 持久化 hydration 与启动容错。
 *
 * - load() 改为 raw → parse → 逐字段 fail-closed 规范化 → 完整 candidate → 一次性提交；
 * - record 的 modifier 按 id 从当前 PACHINKO_MODIFIERS 重建 canonical object；
 * - audit 满足与 LuckyWheel 一致的嵌套结构合同，且 selectedRewardId/selectedRarity 与 canonical modifier 一致；
 * - 任何 getItem/parse/normalization 异常 → 默认 { history: [] }、不抛错、零写盘，公开 action 仍可运行。
 */

const PACHINKO_KEY = 'nz_pachinko_v1'
const monday = Date.UTC(2026, 3, 20)

const VALID_AUDIT = {
  roll: 50,
  normalizedRates: { legendary: 2, epic: 10, rare: 30, common: 58 },
  selectedRarity: 'common',
  selectedRewardId: 'ten_pull_rare_plus_2',
  modifiers: [],
  steps: []
}

const VALID_RECORD = {
  timestamp: 1785859200000,
  poolId: 'permanent_abyss',
  modifier: PACHINKO_MODIFIERS[0], // ten_pull_rare_plus_2 / common
  audit: VALID_AUDIT
}

function warmNonPachinkoStores() {
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
}

function seedRaw(raw: string | null) {
  if (raw === null) localStorage.removeItem(PACHINKO_KEY)
  else localStorage.setItem(PACHINKO_KEY, raw)
}

function createStore() {
  setActivePinia(createPinia())
  return usePachinkoStore()
}

function hydrate(raw: string | null) {
  seedRaw(raw)
  return createStore()
}

function hydrateTracked(raw: string | null) {
  seedRaw(raw)
  setActivePinia(createPinia())
  warmNonPachinkoStores()
  const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
  const removeSpy = vi.spyOn(Storage.prototype, 'removeItem')
  const store = usePachinkoStore()
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

describe('Phase 3.72 — 无存档与启动容错', () => {
  it('key 缺失：默认值、零写盘', () => {
    const { store, setItemSpy, removeSpy } = hydrateTracked(null)
    expect(store.state.history).toEqual([])
    expect(setItemSpy).not.toHaveBeenCalled()
    expect(removeSpy).not.toHaveBeenCalled()
  })

  it('getItem 抛错：Store 创建不抛、默认状态', () => {
    seedRaw('{"history": [{"timestamp": 1}]}')
    setActivePinia(createPinia())
    warmNonPachinkoStores()
    const originalGetItem = Storage.prototype.getItem
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key: string) {
      if (key === PACHINKO_KEY) throw new Error('read boom')
      return originalGetItem.call(this, key)
    })
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    const store = createStore()
    expect(store.state.history).toEqual([])
    expect(setItemSpy).not.toHaveBeenCalled()
  })

  it('malformed JSON：Store 创建不抛、默认状态', () => {
    const store = hydrate('{broken json')
    expect(store.state.history).toEqual([])
  })

  it('root 为 null/数组/字符串/数字：回退默认', () => {
    for (const raw of ['null', '[]', '"str"', '5']) {
      const store = hydrate(raw)
      expect(store.state.history).toEqual([])
    }
  })
})

describe('Phase 3.72 — history 容器与 record 校验', () => {
  it('合法完整 payload 保留', () => {
    const store = hydrate(JSON.stringify({ history: [VALID_RECORD] }))
    expect(store.state.history.length).toBe(1)
    expect(store.state.history[0].timestamp).toBe(VALID_RECORD.timestamp)
    expect(store.state.history[0].poolId).toBe('permanent_abyss')
  })

  it('history 非数组时回退为空；history:{} 后 playShot 不因 unshift 崩溃', () => {
    for (const bad of ['null', '"str"', '5']) {
      const store = hydrate(JSON.stringify({ history: JSON.parse(bad) }))
      expect(store.state.history).toEqual([])
    }
    const store = hydrate(JSON.stringify({ history: {} }))
    expect(store.state.history).toEqual([])
    const record = store.playShot(undefined, { seed: 42, now: monday })
    expect(record).not.toBeNull()
    expect(store.state.history.length).toBe(1)
  })

  it('history 含 [null] 与 primitive entries 被过滤', () => {
    const store = hydrate(JSON.stringify({ history: [VALID_RECORD, null, 'str', 5, {}] }))
    expect(store.state.history.length).toBe(1)
    expect(store.state.history[0].timestamp).toBe(VALID_RECORD.timestamp)
  })

  it('非法 timestamp / poolId → 丢弃', () => {
    const bads = [
      { ...VALID_RECORD, timestamp: 0 },
      { ...VALID_RECORD, timestamp: 1.5 },
      { ...VALID_RECORD, poolId: '' },
      { ...VALID_RECORD, poolId: 5 }
    ]
    for (const bad of bads) {
      const store = hydrate(JSON.stringify({ history: [bad] }))
      expect(store.state.history.length).toBe(0)
    }
  })

  it('modifier 缺失/primitive/未知 id → 丢弃', () => {
    const bads = [
      { ...VALID_RECORD, modifier: undefined },
      { ...VALID_RECORD, modifier: 'x' },
      { ...VALID_RECORD, modifier: { id: 'unknown_modifier' } }
    ]
    for (const bad of bads) {
      const store = hydrate(JSON.stringify({ history: [bad] }))
      expect(store.state.history.length).toBe(0)
    }
  })

  it('modifier raw 文案/rarity/bonus 被篡改时使用 canonical modifier', () => {
    const store = hydrate(JSON.stringify({
      history: [{
        ...VALID_RECORD,
        modifier: { id: 'ten_pull_rare_plus_2', name: 'HACKED', description: 'x', rarity: 'legendary', rarePlusBonus: 999 }
      }]
    }))
    expect(store.state.history.length).toBe(1)
    expect(store.state.history[0].modifier).toEqual(PACHINKO_MODIFIERS[0]) // canonical
    expect(store.state.history[0].modifier.name).not.toBe('HACKED')
    expect(store.state.history[0].modifier.rarePlusBonus).toBe(2) // canonical bonus，非 999
  })
})

describe('Phase 3.72 — nested audit 校验', () => {
  it('audit 缺失或 primitive → 丢弃', () => {
    const bads = [
      { ...VALID_RECORD, audit: undefined },
      { ...VALID_RECORD, audit: 'x' },
      { ...VALID_RECORD, audit: 5 }
    ]
    for (const bad of bads) {
      const store = hydrate(JSON.stringify({ history: [bad] }))
      expect(store.state.history.length).toBe(0)
    }
  })

  it('audit roll/normalizedRates/selected 字段非法 → 丢弃', () => {
    const bads = [
      { ...VALID_RECORD, audit: { ...VALID_AUDIT, roll: 'x' } },
      { ...VALID_RECORD, audit: { ...VALID_AUDIT, roll: NaN } },
      { ...VALID_RECORD, audit: { ...VALID_AUDIT, normalizedRates: null } },
      { ...VALID_RECORD, audit: { ...VALID_AUDIT, normalizedRates: { common: 'broken' } } },
      { ...VALID_RECORD, audit: { ...VALID_AUDIT, selectedRarity: 5 } },
      { ...VALID_RECORD, audit: { ...VALID_AUDIT, selectedRewardId: 5 } },
      { ...VALID_RECORD, audit: { ...VALID_AUDIT, modifiers: null } },
      { ...VALID_RECORD, audit: { ...VALID_AUDIT, steps: null } }
    ]
    for (const bad of bads) {
      const store = hydrate(JSON.stringify({ history: [bad] }))
      expect(store.state.history.length).toBe(0)
    }
  })

  it('audit.modifiers 含 [null] / 缺字段 / active 非 boolean → 丢弃', () => {
    const bads = [
      { ...VALID_RECORD, audit: { ...VALID_AUDIT, modifiers: [null] } },
      { ...VALID_RECORD, audit: { ...VALID_AUDIT, modifiers: ['str'] } },
      { ...VALID_RECORD, audit: { ...VALID_AUDIT, modifiers: [{ id: 'm1' }] } },
      { ...VALID_RECORD, audit: { ...VALID_AUDIT, modifiers: [{ id: 'm1', label: 'x', description: 'y', active: 'yes' }] } }
    ]
    for (const bad of bads) {
      const store = hydrate(JSON.stringify({ history: [bad] }))
      expect(store.state.history.length).toBe(0)
    }
  })

  it('audit.steps 含 [null] / step rates 非法 / 可选 modifier 损坏 → 丢弃', () => {
    const bads = [
      { ...VALID_RECORD, audit: { ...VALID_AUDIT, steps: [null] } },
      { ...VALID_RECORD, audit: { ...VALID_AUDIT, steps: ['str'] } },
      { ...VALID_RECORD, audit: { ...VALID_AUDIT, steps: [{ label: 'x', rates: { common: 'broken' } }] } },
      { ...VALID_RECORD, audit: { ...VALID_AUDIT, steps: [{ label: 'x', rates: { common: NaN } }] } },
      { ...VALID_RECORD, audit: { ...VALID_AUDIT, steps: [{ label: 'x', rates: { common: Infinity } }] } },
      { ...VALID_RECORD, audit: { ...VALID_AUDIT, steps: [{ label: 'x', rates: { common: 1 }, modifier: { id: 'm1' } }] } }
    ]
    for (const bad of bads) {
      const store = hydrate(JSON.stringify({ history: [bad] }))
      expect(store.state.history.length).toBe(0)
    }
  })

  it('audit seed 非有限值 → 丢弃；合法完整 nested audit 保留', () => {
    const store = hydrate(JSON.stringify({
      history: [{
        ...VALID_RECORD,
        audit: { ...VALID_AUDIT, seed: Infinity }
      }]
    }))
    expect(store.state.history.length).toBe(0)
    const fullAudit = {
      ...VALID_AUDIT,
      seed: 42,
      modifiers: [{ id: 'm1', label: '加成', description: '描述', active: true }],
      steps: [
        { label: '基础概率', rates: { legendary: 2, epic: 10, rare: 30, common: 58 } },
        { label: '加成后', rates: { legendary: 3, epic: 10, rare: 30, common: 57 }, modifier: { id: 'm1', label: '加成', description: '描述', active: true } }
      ]
    }
    const store2 = hydrate(JSON.stringify({ history: [{ ...VALID_RECORD, audit: fullAudit }] }))
    expect(store2.state.history.length).toBe(1)
  })
})

describe('Phase 3.72 — 跨字段一致性、上限与启动回归', () => {
  it('selectedRewardId 与 modifier id 不一致 → 丢弃', () => {
    const store = hydrate(JSON.stringify({
      history: [{ ...VALID_RECORD, audit: { ...VALID_AUDIT, selectedRewardId: 'ten_pull_rare_plus_4' } }]
    }))
    expect(store.state.history.length).toBe(0)
  })

  it('selectedRarity 与 modifier rarity 不一致 → 丢弃', () => {
    const store = hydrate(JSON.stringify({
      history: [{ ...VALID_RECORD, audit: { ...VALID_AUDIT, selectedRarity: 'legendary' } }]
    }))
    expect(store.state.history.length).toBe(0)
  })

  it('history hydration 上限为 20 且保序', () => {
    const records = Array.from({ length: 25 }, (_, i) => ({
      ...VALID_RECORD,
      timestamp: 1000 + i,
      modifier: PACHINKO_MODIFIERS[i % PACHINKO_MODIFIERS.length],
      audit: {
        ...VALID_AUDIT,
        selectedRewardId: PACHINKO_MODIFIERS[i % PACHINKO_MODIFIERS.length].id,
        selectedRarity: PACHINKO_MODIFIERS[i % PACHINKO_MODIFIERS.length].rarity
      }
    }))
    const store = hydrate(JSON.stringify({ history: records }))
    expect(store.state.history.length).toBe(20)
    expect(store.state.history[0].timestamp).toBe(1000) // 顺序保持
  })

  it('malformed raw 后公开 playShot 与 getPreviewAudit 仍可成功', () => {
    const store = hydrate('{broken json')
    expect(store.state.history).toEqual([])
    const audit = store.getPreviewAudit(42)
    expect(audit).toBeDefined()
    expect(audit.selectedRewardId).toBeTruthy()
    const record = store.playShot(undefined, { seed: 42, now: monday })
    expect(record).not.toBeNull()
    expect(store.state.history.length).toBe(1)
  })

  it('malformed raw 下 PachinkoPanel 所需最近 record/modifier/audit 字段可安全消费', () => {
    const store = hydrate('{broken json')
    const latest = store.state.history[0]
    const latestModifier = latest?.modifier
    const latestAudit = latest?.audit
    expect(latest).toBeUndefined()
    expect(latestModifier).toBeUndefined()
    expect(latestAudit).toBeUndefined()
    expect(store.state.history).toEqual([])
  })
})
