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

/**
 * Phase 3.69 — Pinball token 兑换补偿事务。
 *
 * - convertTokensToModifier() 收口为：tokensSpent 候选 → 单次时间戳 → outcome/record 候选 →
 *   Probability 无写盘提交 → Pinball tokens/conversions 内存提交 → Probability 保存 → Pinball 保存；
 * - 任一步失败：内存完整回滚 + 已写 raw 逆序补偿；补偿自身失败抛
 *   'pinball conversion persistence rollback failed'。
 */

const PINBALL_KEY = 'nz_pinball_v1'
const PROBABILITY_KEY = 'nz_probability_v1'
const monday = Date.UTC(2026, 3, 20)

function warmupStores() {
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
  usePinballStore()
}

function spyStorage() {
  const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
  const removeSpy = vi.spyOn(Storage.prototype, 'removeItem')
  return { setItemSpy, removeSpy }
}

function seedPinballBudgetNearLimit() {
  const prob = useProbabilityStore()
  const base = new Date(monday)
  base.setHours(0, 0, 0, 0)
  const fmt = (d: Date) => `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}-${`${d.getDate()}`.padStart(2, '0')}`
  const dailyKey = `day:${fmt(base)}`
  const weekStart = new Date(base)
  const dow = weekStart.getDay() || 7
  weekStart.setDate(weekStart.getDate() - dow + 1)
  const weeklyKey = `week:${fmt(weekStart)}`
  prob.state.budgetUsage.pinball = {
    periodKey: `${dailyKey}|${weeklyKey}`,
    dailyPeriodKey: dailyKey,
    weeklyPeriodKey: weeklyKey,
    expectedValue: 20, // 上限 20，任何兑换 rarePlusBonus >= 1 都超预算
    legendaryRateBonus: 0,
    pityGain: 0,
    freePulls: 0,
    jackpots: 0
  }
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

describe('Phase 3.69 — token 候选与资格门', () => {
  it('无可兑换 token：返回 null，不读取时间或 storage', () => {
    const pinball = usePinballStore()
    pinball.state.tokens = 0
    const dateNowSpy = vi.spyOn(Date, 'now')
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem')
    const { setItemSpy, removeSpy } = spyStorage()
    expect(pinball.convertTokensToModifier(undefined, 5)).toBeNull()
    expect(dateNowSpy).not.toHaveBeenCalled()
    expect(getItemSpy).not.toHaveBeenCalled()
    expect(setItemSpy).not.toHaveBeenCalled()
    expect(removeSpy).not.toHaveBeenCalled()
  })

  it('请求值负数/零/小于 1 的小数：floor/clamp 后为 0 → null；10.9 → 夹取 10', () => {
    const pinball = usePinballStore()
    pinball.state.tokens = 10
    expect(pinball.convertTokensToModifier(undefined, -1)).toBeNull()
    expect(pinball.convertTokensToModifier(undefined, 0)).toBeNull()
    expect(pinball.convertTokensToModifier(undefined, 0.5)).toBeNull()
    const record = pinball.convertTokensToModifier(undefined, 10.9, { now: monday })
    expect(record?.tokensSpent).toBe(10) // floor 后夹取到 MAX_CONVERT_TOKENS
    expect(pinball.state.tokens).toBe(0)
  })

  it('非法 timestamp：零副作用', () => {
    const pinball = usePinballStore()
    pinball.state.tokens = 10
    const randomSpy = vi.spyOn(Math, 'random')
    const { setItemSpy, removeSpy } = spyStorage()
    expect(pinball.convertTokensToModifier(undefined, 5, { now: 0 })).toBeNull()
    expect(randomSpy).not.toHaveBeenCalled()
    expect(setItemSpy).not.toHaveBeenCalled()
    expect(removeSpy).not.toHaveBeenCalled()
    expect(pinball.state.tokens).toBe(10)
  })

  it('Date.now 抛错：异常上送、零副作用', () => {
    const pinball = usePinballStore()
    pinball.state.tokens = 10
    vi.spyOn(Date, 'now').mockImplementation(() => {
      throw new Error('time boom')
    })
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem')
    const { setItemSpy, removeSpy } = spyStorage()
    let thrown: unknown
    try {
      pinball.convertTokensToModifier(undefined, 5)
    } catch (e) {
      thrown = e
    }
    expect((thrown as Error).message).toBe('time boom')
    expect(getItemSpy).not.toHaveBeenCalled()
    expect(setItemSpy).not.toHaveBeenCalled()
    expect(removeSpy).not.toHaveBeenCalled()
    expect(pinball.state.tokens).toBe(10)
    expect(pinball.state.conversions.length).toBe(0)
  })
})

describe('Phase 3.69 — 单次时间戳与成功语义', () => {
  it('无显式 now：Date.now 恰好一次；record timestamp、outcome seed、modifier id 同值', () => {
    const fixedNow = 1785859200000
    vi.spyOn(Date, 'now').mockReturnValue(fixedNow)
    const pinball = usePinballStore()
    pinball.state.tokens = 10
    const prob = useProbabilityStore()
    const record = pinball.convertTokensToModifier(undefined, 6)
    expect(record).not.toBeNull()
    expect(vi.mocked(Date.now)).toHaveBeenCalledTimes(1)
    expect(record?.timestamp).toBe(fixedNow)
    expect(prob.state.outcomes.length).toBe(1)
    expect(prob.state.outcomes[0].seed).toBe(String(fixedNow))
    expect(prob.state.outcomes[0].modifier?.id).toContain(`pinball_event_modifier:${fixedNow}:`)
    expect(prob.state.pendingModifiers.some(m => m.id.startsWith('pinball_event_modifier:'))).toBe(true)
  })

  it('成功顺序 Probability → Pinball，每 key 恰好一次；tokens 扣除一次、conversion 一条', () => {
    const pinball = usePinballStore()
    pinball.state.tokens = 10
    const prob = useProbabilityStore()
    const { setItemSpy } = spyStorage()
    const record = pinball.convertTokensToModifier(undefined, 6, { now: monday })
    expect(record?.tokensSpent).toBe(6)
    expect(pinball.state.tokens).toBe(4) // 恰好扣除一次
    expect(pinball.state.conversions.length).toBe(1)
    expect(prob.state.outcomes.length).toBe(1)
    expect(prob.state.pendingModifiers.length).toBe(1)
    const keys = setItemSpy.mock.calls.map(c => c[0]).filter(k => [PROBABILITY_KEY, PINBALL_KEY].includes(k))
    expect(keys).toEqual([PROBABILITY_KEY, PINBALL_KEY])
    expect(setItemSpy.mock.calls.filter(c => c[0] === PROBABILITY_KEY).length).toBe(1)
    expect(setItemSpy.mock.calls.filter(c => c[0] === PINBALL_KEY).length).toBe(1)
  })

  it('conversions 达到 20 条后：新记录置顶、总数保持 20', () => {
    const pinball = usePinballStore()
    pinball.state.tokens = 10
    pinball.state.conversions = Array.from({ length: 20 }, (_, i) => ({
      timestamp: 1000 + i,
      poolId: 'permanent_abyss',
      tokensSpent: 1,
      rarePlusBonus: 1
    }))
    const record = pinball.convertTokensToModifier(undefined, 1, { now: monday })
    expect(record).not.toBeNull()
    expect(pinball.state.conversions.length).toBe(20)
    expect(pinball.state.conversions[0].timestamp).toBe(monday) // 新记录置顶
  })
})

describe('Phase 3.69 — 预算拒绝与失败注入', () => {
  it('预算拒绝：五类内存状态完全不变、零写盘', () => {
    const pinball = usePinballStore()
    pinball.state.tokens = 10
    const prob = useProbabilityStore()
    seedPinballBudgetNearLimit()
    const prevOutcomes = [...prob.state.outcomes]
    const prevBudget = JSON.parse(JSON.stringify(prob.state.budgetUsage))
    const prevModifiers = [...prob.state.pendingModifiers]
    const prevTokens = pinball.state.tokens
    const prevConversions = [...pinball.state.conversions]
    const { setItemSpy, removeSpy } = spyStorage()
    expect(pinball.convertTokensToModifier(undefined, 5, { now: monday })).toBeNull()
    expect(prob.state.outcomes).toEqual(prevOutcomes)
    expect(prob.state.budgetUsage).toEqual(prevBudget)
    expect(prob.state.pendingModifiers).toEqual(prevModifiers)
    expect(pinball.state.tokens).toBe(prevTokens)
    expect(pinball.state.conversions).toEqual(prevConversions)
    expect(setItemSpy).not.toHaveBeenCalled()
    expect(removeSpy).not.toHaveBeenCalled()
  })

  it('raw getItem 抛错：返回 null、零内存 mutation、零写盘', () => {
    const pinball = usePinballStore()
    pinball.state.tokens = 10
    const prob = useProbabilityStore()
    const originalGetItem = Storage.prototype.getItem
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key: string) {
      if (key === PROBABILITY_KEY) throw new Error('read boom')
      return originalGetItem.call(this, key)
    })
    const { setItemSpy, removeSpy } = spyStorage()
    expect(pinball.convertTokensToModifier(undefined, 5, { now: monday })).toBeNull()
    expect(pinball.state.tokens).toBe(10)
    expect(pinball.state.conversions.length).toBe(0)
    expect(prob.state.outcomes.length).toBe(0)
    expect(setItemSpy).not.toHaveBeenCalled()
    expect(removeSpy).not.toHaveBeenCalled()
  })

  it('Probability 保存失败：两 Store 内存回滚、Pinball 不写', () => {
    const pinball = usePinballStore()
    pinball.state.tokens = 10
    const prob = useProbabilityStore()
    const originalSetItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (key === PROBABILITY_KEY) throw new Error('prob disk full')
      return originalSetItem.call(this, key, value)
    })
    expect(pinball.convertTokensToModifier(undefined, 5, { now: monday })).toBeNull()
    expect(pinball.state.tokens).toBe(10)
    expect(pinball.state.conversions.length).toBe(0)
    expect(prob.state.outcomes.length).toBe(0)
    expect(prob.state.pendingModifiers.length).toBe(0)
    expect(localStorage.getItem(PINBALL_KEY)).toBeNull() // Pinball 未写
  })

  it('Pinball 保存失败：两 Store 内存回滚、Probability raw 恢复', () => {
    const pinball = usePinballStore()
    pinball.state.tokens = 10
    const prob = useProbabilityStore()
    const prevProbRaw = JSON.stringify({ outcomes: [], pendingModifiers: [], budgetUsage: {} })
    localStorage.setItem(PROBABILITY_KEY, prevProbRaw)
    const originalSetItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (key === PINBALL_KEY) throw new Error('pinball disk full')
      return originalSetItem.call(this, key, value)
    })
    expect(pinball.convertTokensToModifier(undefined, 5, { now: monday })).toBeNull()
    expect(pinball.state.tokens).toBe(10)
    expect(pinball.state.conversions.length).toBe(0)
    expect(prob.state.outcomes.length).toBe(0)
    expect(prob.state.pendingModifiers.length).toBe(0)
    expect(localStorage.getItem(PROBABILITY_KEY)).toBe(prevProbRaw) // Probability raw 恢复
  })

  it('原 Probability key 不存在时，Pinball 保存失败补偿使用 removeItem', () => {
    const pinball = usePinballStore()
    pinball.state.tokens = 10
    expect(localStorage.getItem(PROBABILITY_KEY)).toBeNull()
    const removed: string[] = []
    const originalSetItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (key === PINBALL_KEY) throw new Error('pinball disk full')
      return originalSetItem.call(this, key, value)
    })
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (this: Storage, key: string) {
      removed.push(key)
    })
    expect(pinball.convertTokensToModifier(undefined, 5, { now: monday })).toBeNull()
    expect(removed).toContain(PROBABILITY_KEY)
  })

  it('补偿失败仍继续其余恢复，最终抛固定错误', () => {
    const pinball = usePinballStore()
    pinball.state.tokens = 10
    const prevProbRaw = JSON.stringify({ outcomes: [], pendingModifiers: [], budgetUsage: {} })
    localStorage.setItem(PROBABILITY_KEY, prevProbRaw)
    let pinballWriteDone = false
    let probWrites = 0
    const originalSetItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (key === PINBALL_KEY && !pinballWriteDone) {
        pinballWriteDone = true
        throw new Error('pinball disk full')
      }
      if (key === PROBABILITY_KEY) {
        probWrites += 1
        if (probWrites === 2) throw new Error('prob restore boom')
      }
      return originalSetItem.call(this, key, value)
    })
    let thrown: unknown
    try {
      pinball.convertTokensToModifier(undefined, 5, { now: monday })
    } catch (e) {
      thrown = e
    }
    expect((thrown as Error).message).toBe('pinball conversion persistence rollback failed')
    expect(pinball.state.tokens).toBe(10) // 内存保持回滚
    expect(pinball.state.conversions.length).toBe(0)
    expect(useProbabilityStore().state.outcomes.length).toBe(0)
  })
})

describe('Phase 3.69 — fresh Pinia 重载与重复兑换防护', () => {
  it('成功后重载：tokens、conversion、outcome、modifier、budget 均恢复', () => {
    const pinball = usePinballStore()
    pinball.state.tokens = 10
    const prob = useProbabilityStore()
    pinball.convertTokensToModifier(undefined, 6, { now: monday })
    expect(pinball.state.tokens).toBe(4)
    expect(prob.state.outcomes.length).toBe(1)
    // fresh Pinia 重载
    setActivePinia(createPinia())
    warmupStores()
    const freshProb = useProbabilityStore()
    const freshPinball = usePinballStore()
    expect(freshPinball.state.tokens).toBe(4) // 扣除后的 tokens 恢复
    expect(freshPinball.state.conversions.length).toBe(1)
    expect(freshProb.state.outcomes.length).toBe(1)
    expect(freshProb.state.pendingModifiers.some(m => m.id.startsWith('pinball_event_modifier:'))).toBe(true)
    expect(freshProb.state.budgetUsage['pinball']).toBeDefined()
  })

  it('Pinball 保存失败后重载：tokens/conversion/outcome/modifier 均保持兑换前', () => {
    const pinball = usePinballStore()
    pinball.state.tokens = 10
    localStorage.setItem(PINBALL_KEY, JSON.stringify({ tokens: 10, conversions: [] })) // 播种兑换前 raw
    const originalSetItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (key === PINBALL_KEY) throw new Error('pinball disk full')
      return originalSetItem.call(this, key, value)
    })
    expect(pinball.convertTokensToModifier(undefined, 6, { now: monday })).toBeNull()
    vi.restoreAllMocks()
    // fresh Pinia 重载
    setActivePinia(createPinia())
    warmupStores()
    const freshProb = useProbabilityStore()
    const freshPinball = usePinballStore()
    expect(freshPinball.state.tokens).toBe(10) // 兑换前 tokens
    expect(freshPinball.state.conversions.length).toBe(0)
    expect(freshProb.state.outcomes.length).toBe(0)
    expect(freshProb.state.pendingModifiers.length).toBe(0)
  })

  it('成功兑换后再次调用只能用剩余 tokens，不能重复使用已消费部分', () => {
    const pinball = usePinballStore()
    pinball.state.tokens = 10
    const first = pinball.convertTokensToModifier(undefined, 6, { now: monday })
    expect(first?.tokensSpent).toBe(6)
    expect(pinball.state.tokens).toBe(4)
    const second = pinball.convertTokensToModifier(undefined, 6, { now: monday })
    expect(second?.tokensSpent).toBe(4) // 只剩 4，不能复用已消费的 6
    expect(pinball.state.tokens).toBe(0)
    expect(pinball.state.conversions.length).toBe(2)
  })
})
