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
import { LUCKY_WHEEL_REWARDS } from '../data/luckyWheel'
import { formatProbabilityAuditRows } from '../systems/probability/probabilityAudit'

/**
 * Phase 3.66 — Lucky Wheel 持久化安全 hydration。
 *
 * - load() 改为 raw → parse → 逐字段 fail-closed 规范化 → 完整 candidate → 一次性提交；
 * - lastDailyFree 仅正安全整数；buildTokens 仅已知 target 且非负安全整数；
 * - history 最多 20 条，仅保留可经 canonical reward 重建且 audit.selectedRewardId 一致的记录；
 * - 任何异常 → 三字段全默认、零写回。
 */

const LUCKY_WHEEL_KEY = 'nz_lucky_wheel_v1'

const VALID_AUDIT = {
  roll: 50,
  normalizedRates: { legendary: 1, epic: 9, rare: 25, common: 65 },
  selectedRarity: 'common',
  selectedRewardId: 'pity_plus_1',
  modifiers: [],
  steps: []
}

function warmNonLuckyWheelStores() {
  usePlayerStore()
  useMonsterStore()
  useGameStore()
  useTrainingStore()
  useATBStore()
  useRebirthStore()
  useThemeStore()
  useProbabilityStore()
  useGachaStore()
}

function seedRaw(raw: string | null) {
  if (raw === null) localStorage.removeItem(LUCKY_WHEEL_KEY)
  else localStorage.setItem(LUCKY_WHEEL_KEY, raw)
}

function createStore() {
  setActivePinia(createPinia())
  return useLuckyWheelStore()
}

function hydrate(raw: string | null) {
  seedRaw(raw)
  return createStore()
}

function hydrateTracked(raw: string | null) {
  seedRaw(raw)
  setActivePinia(createPinia())
  warmNonLuckyWheelStores()
  const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
  const removeSpy = vi.spyOn(Storage.prototype, 'removeItem')
  const store = useLuckyWheelStore()
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

describe('Phase 3.66 — 无存档与读取失败', () => {
  it('无 raw：三字段全默认、零写盘', () => {
    const { store, setItemSpy, removeSpy } = hydrateTracked(null)
    expect(store.state.lastDailyFree).toBe(0)
    expect(store.state.buildTokens).toEqual({})
    expect(store.state.history).toEqual([])
    expect(setItemSpy).not.toHaveBeenCalled()
    expect(removeSpy).not.toHaveBeenCalled()
  })

  it('getItem 抛错：默认状态、Store 构造不抛、零写盘', () => {
    seedRaw('{"lastDailyFree": 1785859200000, "buildTokens": {"speedSkill": 2}, "history": []}')
    setActivePinia(createPinia())
    warmNonLuckyWheelStores()
    const originalGetItem = Storage.prototype.getItem
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key: string) {
      if (key === LUCKY_WHEEL_KEY) throw new Error('read boom')
      return originalGetItem.call(this, key)
    })
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    const store = createStore()
    expect(store.state.lastDailyFree).toBe(0)
    expect(store.state.buildTokens).toEqual({})
    expect(store.state.history).toEqual([])
    expect(setItemSpy).not.toHaveBeenCalled()
  })

  it('malformed JSON：默认状态', () => {
    const store = hydrate('{broken json')
    expect(store.state.lastDailyFree).toBe(0)
    expect(store.state.buildTokens).toEqual({})
    expect(store.state.history).toEqual([])
  })
})

describe('Phase 3.66 — 顶层与容器类型', () => {
  it('顶层 null/array/string/number/boolean → 默认', () => {
    for (const raw of ['null', '[]', '"str"', '5', 'true']) {
      const store = hydrate(raw)
      expect(store.state.lastDailyFree).toBe(0)
      expect(store.state.buildTokens).toEqual({})
      expect(store.state.history).toEqual([])
    }
  })

  it('三个容器类型错误：lastDailyFree 非正安全整数、buildTokens 非对象、history 非数组', () => {
    for (const bad of [-1, 1.5, '5', NaN, Infinity, 0]) {
      const store = hydrate(JSON.stringify({ lastDailyFree: bad }))
      expect(store.state.lastDailyFree).toBe(0)
    }
    const store = hydrate(JSON.stringify({ buildTokens: null, history: {} }))
    expect(store.state.buildTokens).toEqual({})
    expect(store.state.history).toEqual([])
  })
})

describe('Phase 3.66 — lastDailyFree 与 buildTokens 规范化', () => {
  it('正安全整数保留、非法值归零', () => {
    const store = hydrate(JSON.stringify({ lastDailyFree: 1785859200000 }))
    expect(store.state.lastDailyFree).toBe(1785859200000)
    expect(hydrate(JSON.stringify({ lastDailyFree: 0 })).state.lastDailyFree).toBe(0)
    expect(hydrate(JSON.stringify({ lastDailyFree: -1 })).state.lastDailyFree).toBe(0)
    expect(hydrate(JSON.stringify({ lastDailyFree: Number.MAX_SAFE_INTEGER + 1 })).state.lastDailyFree).toBe(0)
  })

  it('buildTokens 合法与非法 target/count 混合', () => {
    const store = hydrate(JSON.stringify({
      buildTokens: {
        speedSkill: 2,
        luckTreasure: 0,
        unknownTarget: 5,
        critBurst: -1,
        armorTrueDamage: 1.5,
        lifestealTank: '3'
      }
    }))
    expect(store.state.buildTokens['speedSkill']).toBe(2)
    expect(store.state.buildTokens['luckTreasure']).toBe(0)
    const tokensMap = store.state.buildTokens as Record<string, unknown>
    expect(tokensMap['unknownTarget']).toBeUndefined() // 未知 target
    expect(tokensMap['critBurst']).toBeUndefined() // 负数
    expect(tokensMap['armorTrueDamage']).toBeUndefined() // 小数
    expect(tokensMap['lifestealTank']).toBeUndefined() // 字符串
  })
})

describe('Phase 3.66 — history 规范化与 canonical reward 重建', () => {
  it('非数组 → 空；损坏记录过滤、20 条上限', () => {
    expect(hydrate(JSON.stringify({ history: null })).state.history).toEqual([])
    const ts = 1785859200000
    const validEntries = Array.from({ length: 25 }, (_, i) => ({
      timestamp: ts + i,
      reward: { id: 'pity_plus_1', name: 'HACKED', type: 'gold', value: 999 },
      audit: { ...VALID_AUDIT, selectedRewardId: 'pity_plus_1' }
    }))
    const store = hydrate(JSON.stringify({
      history: [
        ...validEntries,
        { timestamp: -1, reward: { id: 'pity_plus_1' }, audit: VALID_AUDIT }, // 非法时间戳
        { timestamp: ts, reward: { id: 'nonexistent' }, audit: VALID_AUDIT }, // 未知 reward
        { timestamp: ts, reward: null, audit: VALID_AUDIT }, // 非对象 reward
        { timestamp: ts, reward: { id: 'pity_plus_1' }, audit: 'garbage' }, // 非法 audit
        { timestamp: ts, reward: { id: 'pity_plus_1' } } // 缺失 audit
      ]
    }))
    expect(store.state.history.length).toBe(20) // 前 20 合法保留
    expect(store.state.history[0].timestamp).toBe(ts) // 顺序保持
  })

  it('canonical reward 重建：不信任持久化副本', () => {
    const store = hydrate(JSON.stringify({
      history: [{
        timestamp: 1785859200000,
        reward: { id: 'pity_plus_1', name: 'HACKED', type: 'gold', value: 999, rarity: 'legendary' },
        audit: { ...VALID_AUDIT, selectedRewardId: 'pity_plus_1' }
      }]
    }))
    expect(store.state.history.length).toBe(1)
    const canonical = LUCKY_WHEEL_REWARDS.find(r => r.id === 'pity_plus_1')!
    expect(store.state.history[0].reward).toEqual(canonical)
    expect(store.state.history[0].reward.name).not.toBe('HACKED')
  })

  it('audit 的 selectedRewardId 与 reward ID 不一致 → 整条丢弃；合法 audit 保留', () => {
    const ts = 1785859200000
    const store = hydrate(JSON.stringify({
      history: [
        { timestamp: ts, reward: { id: 'pity_plus_1' }, audit: { ...VALID_AUDIT, selectedRewardId: 'gacha_ticket_1' } }, // 不匹配
        { timestamp: ts, reward: { id: 'pity_plus_1' }, audit: VALID_AUDIT } // 匹配
      ]
    }))
    expect(store.state.history.length).toBe(1)
    expect(store.state.history[0].audit.selectedRewardId).toBe('pity_plus_1')
  })
})

describe('Phase 3.66 — 原子性与零写回', () => {
  it('normalization 中途真实 throw：三字段全默认、零部分提交、raw 未变化', () => {
    const raw = JSON.stringify({
      lastDailyFree: 1785859200000,
      buildTokens: { speedSkill: 2 },
      history: [{ timestamp: 1785859200000, reward: { id: 'pity_plus_1' }, audit: VALID_AUDIT }]
    })
    seedRaw(raw)
    setActivePinia(createPinia())
    warmNonLuckyWheelStores()
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
    expect(calls).toBe(2) // 第一个字段（lastDailyFree）成功，第二个（buildTokens）真实抛错
    expect(store.state.lastDailyFree).toBe(0)
    expect(store.state.buildTokens).toEqual({})
    expect(store.state.history).toEqual([])
    expect(setItemSpy).not.toHaveBeenCalled()
    expect(removeSpy).not.toHaveBeenCalled()
    expect(localStorage.getItem(LUCKY_WHEEL_KEY)).toBe(raw)
  })

  it('正常 payload 完整恢复', () => {
    const ts = 1785859200000
    const store = hydrate(JSON.stringify({
      lastDailyFree: ts,
      buildTokens: { speedSkill: 2 },
      history: [{ timestamp: ts, reward: { id: 'pity_plus_1' }, audit: VALID_AUDIT }]
    }))
    expect(store.state.lastDailyFree).toBe(ts)
    expect(store.state.buildTokens['speedSkill']).toBe(2)
    expect(store.state.history.length).toBe(1)
    expect(store.state.history[0].reward.id).toBe('pity_plus_1')
  })

  it('hydration 零写盘，随后 Phase 3.65 真实 spin 仍正常', () => {
    const yesterday = new Date().setHours(0, 0, 0, 0) - 86400000
    const raw = JSON.stringify({ lastDailyFree: yesterday, buildTokens: { speedSkill: 2 }, history: [] })
    const { store, setItemSpy, removeSpy } = hydrateTracked(raw)
    expect(store.state.lastDailyFree).toBe(yesterday)
    expect(store.state.buildTokens['speedSkill']).toBe(2)
    expect(setItemSpy).not.toHaveBeenCalled() // hydration 零写盘
    expect(removeSpy).not.toHaveBeenCalled()
    // Phase 3.65 真实 spin 仍正常（旧 marker 允许）
    const record = store.spinDaily({ rng: () => 0.5 }) // pity_plus_1
    expect(record?.reward.type).toBe('pity')
    expect(store.state.history.length).toBe(1)
    expect(store.state.buildTokens['speedSkill']).toBe(2) // 既有 token 保留
  })
})

describe('Phase 3.66 Repair 1 — 嵌套 audit 校验', () => {
  const ts = 1785859200000

  function historyWithAudit(audit: unknown) {
    return JSON.stringify({ history: [{ timestamp: ts, reward: { id: 'pity_plus_1' }, audit }] })
  }

  it('modifiers 含 null/primitive/字段类型错误 → 整条记录丢弃', () => {
    const badAudits = [
      { ...VALID_AUDIT, modifiers: [null] },
      { ...VALID_AUDIT, modifiers: ['str'] },
      { ...VALID_AUDIT, modifiers: [5] },
      { ...VALID_AUDIT, modifiers: [{ id: 'm1' }] }, // 缺 label/description/active
      { ...VALID_AUDIT, modifiers: [{ id: 'm1', label: 'x', description: 'y', active: 'yes' }] } // active 非 boolean
    ]
    for (const audit of badAudits) {
      const store = hydrate(historyWithAudit(audit))
      expect(store.state.history.length).toBe(0)
    }
  })

  it('step 非对象/缺 label/缺 rates/rates 含字符串或 NaN/Infinity → 整条记录丢弃', () => {
    const badAudits = [
      { ...VALID_AUDIT, steps: [null] },
      { ...VALID_AUDIT, steps: ['str'] },
      { ...VALID_AUDIT, steps: [{ rates: { common: 1 } }] }, // 缺 label
      { ...VALID_AUDIT, steps: [{ label: 'x' }] }, // 缺 rates
      { ...VALID_AUDIT, steps: [{ label: 'x', rates: { common: 'broken' } }] },
      { ...VALID_AUDIT, steps: [{ label: 'x', rates: { common: NaN } }] },
      { ...VALID_AUDIT, steps: [{ label: 'x', rates: { common: Infinity } }] }
    ]
    for (const audit of badAudits) {
      const store = hydrate(historyWithAudit(audit))
      expect(store.state.history.length).toBe(0)
    }
  })

  it('step 内 optional modifier 非法 → 整条记录丢弃', () => {
    const store = hydrate(historyWithAudit({
      ...VALID_AUDIT,
      steps: [{ label: 'x', rates: { common: 1 }, modifier: { id: 'm1' } }] // 缺 label/description/active
    }))
    expect(store.state.history.length).toBe(0)
  })

  it('含真实合法 modifier 与 step 的 audit 正常保留', () => {
    const audit = {
      roll: 50,
      normalizedRates: { legendary: 1, epic: 9, rare: 25, common: 65 },
      selectedRarity: 'common',
      selectedRewardId: 'pity_plus_1',
      modifiers: [{ id: 'm1', label: '加成', description: '描述', active: true }],
      steps: [
        { label: '基础概率', rates: { legendary: 1, epic: 9, rare: 25, common: 65 } },
        { label: '加成后', rates: { legendary: 2, epic: 9, rare: 25, common: 64 }, modifier: { id: 'm1', label: '加成', description: '描述', active: true } }
      ]
    }
    const store = hydrate(historyWithAudit(audit))
    expect(store.state.history.length).toBe(1)
    expect(store.state.history[0].audit.modifiers.length).toBe(1)
    expect(store.state.history[0].audit.steps.length).toBe(2)
  })

  it('hydration 后对保留 audit 调用公共格式化器不抛错', () => {
    const audit = {
      roll: 50,
      normalizedRates: { legendary: 1, epic: 9, rare: 25, common: 65 },
      selectedRarity: 'common',
      selectedRewardId: 'pity_plus_1',
      modifiers: [{ id: 'm1', label: '加成', description: '描述', active: true }],
      steps: [{ label: '基础概率', rates: { legendary: 1, epic: 9, rare: 25, common: 65 } }]
    }
    const store = hydrate(historyWithAudit(audit))
    const rows = formatProbabilityAuditRows(store.state.history[0].audit)
    expect(rows.some(r => r.label.includes('基础'))).toBe(true)
    expect(rows.some(r => r.label.includes('最终'))).toBe(true)
    expect(rows.some(r => r.label === '本次roll')).toBe(true)
  })
})
