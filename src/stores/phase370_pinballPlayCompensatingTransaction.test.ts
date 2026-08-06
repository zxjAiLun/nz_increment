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
 * Phase 3.70 — Pinball 游玩结算补偿事务。
 *
 * - playEvent() 收口为：单次时间戳 → RNG/rolls/score/band/outcome/record 候选 →
 *   Probability 无写盘提交 → Pinball tokens/plays 内存提交 → Probability 保存 → Pinball 保存；
 * - 任一步失败：内存完整回滚 + 已写 raw 逆序补偿；补偿自身失败抛
 *   'pinball play persistence rollback failed'。
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
    expectedValue: 20, // 上限 20，任何游玩 tokensGained >= 1 都超预算
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

describe('Phase 3.70 — 资格门与 RNG 候选', () => {
  it('非法 timestamp：零副作用', () => {
    const pinball = usePinballStore()
    const prob = useProbabilityStore()
    const randomSpy = vi.spyOn(Math, 'random')
    const { setItemSpy, removeSpy } = spyStorage()
    expect(pinball.playEvent({ now: 0 })).toBeNull()
    expect(randomSpy).not.toHaveBeenCalled()
    expect(setItemSpy).not.toHaveBeenCalled()
    expect(removeSpy).not.toHaveBeenCalled()
    expect(pinball.state.tokens).toBe(0)
    expect(pinball.state.plays.length).toBe(0)
    expect(prob.state.outcomes.length).toBe(0)
  })

  it('Date.now 抛错：异常上送、零副作用', () => {
    const pinball = usePinballStore()
    const prob = useProbabilityStore()
    vi.spyOn(Date, 'now').mockImplementation(() => {
      throw new Error('time boom')
    })
    const randomSpy = vi.spyOn(Math, 'random')
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem')
    const { setItemSpy, removeSpy } = spyStorage()
    let thrown: unknown
    try {
      pinball.playEvent()
    } catch (e) {
      thrown = e
    }
    expect((thrown as Error).message).toBe('time boom')
    expect(randomSpy).not.toHaveBeenCalled()
    expect(getItemSpy).not.toHaveBeenCalled()
    expect(setItemSpy).not.toHaveBeenCalled()
    expect(removeSpy).not.toHaveBeenCalled()
    expect(pinball.state.plays.length).toBe(0)
    expect(prob.state.outcomes.length).toBe(0)
  })

  it('第一次 RNG 抛错：异常上送、零副作用', () => {
    const pinball = usePinballStore()
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem')
    const { setItemSpy, removeSpy } = spyStorage()
    let thrown: unknown
    try {
      pinball.playEvent({ rng: () => {
        throw new Error('rng boom')
      }, now: monday })
    } catch (e) {
      thrown = e
    }
    expect((thrown as Error).message).toBe('rng boom')
    expect(getItemSpy).not.toHaveBeenCalled()
    expect(setItemSpy).not.toHaveBeenCalled()
    expect(removeSpy).not.toHaveBeenCalled()
    expect(pinball.state.plays.length).toBe(0)
  })

  it('第二次 RNG 抛错：异常上送、零副作用（前一次已生成的 roll 不残留）', () => {
    const pinball = usePinballStore()
    const prob = useProbabilityStore()
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem')
    const { setItemSpy, removeSpy } = spyStorage()
    let calls = 0
    let thrown: unknown
    try {
      pinball.playEvent({ rng: () => {
        calls += 1
        if (calls === 2) throw new Error('rng boom')
        return 0.5
      }, now: monday })
    } catch (e) {
      thrown = e
    }
    expect((thrown as Error).message).toBe('rng boom')
    expect(calls).toBe(2)
    expect(getItemSpy).not.toHaveBeenCalled()
    expect(setItemSpy).not.toHaveBeenCalled()
    expect(removeSpy).not.toHaveBeenCalled()
    expect(pinball.state.plays.length).toBe(0)
    expect(prob.state.outcomes.length).toBe(0)
  })
})

describe('Phase 3.70 — 单次时间戳与成功语义', () => {
  it('无显式 now：Date.now 恰好一次；record timestamp 与 outcome seed 同值', () => {
    const fixedNow = 1785859200000
    vi.spyOn(Date, 'now').mockReturnValue(fixedNow)
    const pinball = usePinballStore()
    const prob = useProbabilityStore()
    const record = pinball.playEvent({ rng: () => 0.5 })
    expect(record).not.toBeNull()
    expect(vi.mocked(Date.now)).toHaveBeenCalledTimes(1)
    expect(record?.timestamp).toBe(fixedNow)
    expect(prob.state.outcomes[0].seed).toBe(String(fixedNow))
  })

  it('显式 seed 保持确定性；record timestamp 用单次事务时间', () => {
    const a = usePinballStore().playEvent({ seed: 2026, now: monday })
    setActivePinia(createPinia())
    warmupStores()
    const b = usePinballStore().playEvent({ seed: 2026, now: monday })
    expect(a?.score).toBe(b?.score)
    expect(a?.rolls).toEqual(b?.rolls)
    expect(b?.timestamp).toBe(monday)
    expect(useProbabilityStore().state.outcomes[0].seed).toBe('2026') // 显式 seed 作为 outcome seed
  })

  it('自定义 RNG 优先于 seeded RNG；成功路径 RNG 恰好三次', () => {
    const pinball = usePinballStore()
    let calls = 0
    const rng = () => {
      calls += 1
      return 0.7
    }
    const record = pinball.playEvent({ seed: 42, rng, now: monday })
    expect(record).not.toBeNull()
    expect(calls).toBe(3)
    expect(record?.rolls).toEqual([0.7, 0.7, 0.7])
  })

  it('成功 score、band、tokens 与旧合同一致', () => {
    const pinball = usePinballStore()
    const record = pinball.playEvent({ seed: 2026, now: monday })
    expect(record).not.toBeNull()
    const band = [...PINBALL_SCORE_BANDS].sort((x, y) => y.minScore - x.minScore).find(b => (record?.score ?? 0) >= b.minScore)
    expect(band).toBeDefined()
    expect(record?.tokensGained).toBe(band?.tokens)
    expect(pinball.state.tokens).toBe(band?.tokens)
  })

  it('成功顺序 Probability → Pinball，每 key 恰好一次', () => {
    const pinball = usePinballStore()
    const prob = useProbabilityStore()
    const { setItemSpy } = spyStorage()
    pinball.playEvent({ seed: 2026, now: monday })
    expect(prob.state.outcomes.length).toBe(1)
    expect(pinball.state.plays.length).toBe(1)
    const keys = setItemSpy.mock.calls.map(c => c[0]).filter(k => [PROBABILITY_KEY, PINBALL_KEY].includes(k))
    expect(keys).toEqual([PROBABILITY_KEY, PINBALL_KEY])
    expect(setItemSpy.mock.calls.filter(c => c[0] === PROBABILITY_KEY).length).toBe(1)
    expect(setItemSpy.mock.calls.filter(c => c[0] === PINBALL_KEY).length).toBe(1)
  })

  it('plays 达到 20 条后：新记录置顶、总数保持 20', () => {
    const pinball = usePinballStore()
    pinball.state.plays = Array.from({ length: 20 }, (_, i) => ({
      timestamp: 1000 + i,
      score: 1,
      tokensGained: 1,
      rolls: [0.5, 0.5, 0.5],
      scoreBand: PINBALL_SCORE_BANDS[0]
    }))
    const record = pinball.playEvent({ seed: 2026, now: monday })
    expect(record).not.toBeNull()
    expect(pinball.state.plays.length).toBe(20)
    expect(pinball.state.plays[0].timestamp).toBe(monday) // 新记录置顶
  })
})

describe('Phase 3.70 — 预算拒绝与失败注入', () => {
  it('预算拒绝：五类内存状态完全不变、零写盘', () => {
    const pinball = usePinballStore()
    const prob = useProbabilityStore()
    seedPinballBudgetNearLimit()
    const prevOutcomes = [...prob.state.outcomes]
    const prevBudget = JSON.parse(JSON.stringify(prob.state.budgetUsage))
    const prevModifiers = [...prob.state.pendingModifiers]
    const prevTokens = pinball.state.tokens
    const prevPlays = [...pinball.state.plays]
    const { setItemSpy, removeSpy } = spyStorage()
    expect(pinball.playEvent({ seed: 2026, now: monday })).toBeNull()
    expect(prob.state.outcomes).toEqual(prevOutcomes)
    expect(prob.state.budgetUsage).toEqual(prevBudget)
    expect(prob.state.pendingModifiers).toEqual(prevModifiers)
    expect(pinball.state.tokens).toBe(prevTokens)
    expect(pinball.state.plays).toEqual(prevPlays)
    expect(setItemSpy).not.toHaveBeenCalled()
    expect(removeSpy).not.toHaveBeenCalled()
  })

  it('raw getItem 抛错：返回 null、零内存 mutation、零写盘', () => {
    const pinball = usePinballStore()
    const prob = useProbabilityStore()
    const originalGetItem = Storage.prototype.getItem
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key: string) {
      if (key === PINBALL_KEY) throw new Error('read boom')
      return originalGetItem.call(this, key)
    })
    const { setItemSpy, removeSpy } = spyStorage()
    expect(pinball.playEvent({ seed: 2026, now: monday })).toBeNull()
    expect(pinball.state.tokens).toBe(0)
    expect(pinball.state.plays.length).toBe(0)
    expect(prob.state.outcomes.length).toBe(0)
    expect(setItemSpy).not.toHaveBeenCalled()
    expect(removeSpy).not.toHaveBeenCalled()
  })

  it('Probability 保存失败：两 Store 内存回滚、Pinball 不写', () => {
    const pinball = usePinballStore()
    const prob = useProbabilityStore()
    const originalSetItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (key === PROBABILITY_KEY) throw new Error('prob disk full')
      return originalSetItem.call(this, key, value)
    })
    expect(pinball.playEvent({ seed: 2026, now: monday })).toBeNull()
    expect(pinball.state.tokens).toBe(0)
    expect(pinball.state.plays.length).toBe(0)
    expect(prob.state.outcomes.length).toBe(0)
    expect(localStorage.getItem(PINBALL_KEY)).toBeNull()
  })

  it('Pinball 保存失败：两 Store 内存回滚、Probability raw 恢复', () => {
    const pinball = usePinballStore()
    const prob = useProbabilityStore()
    const prevProbRaw = JSON.stringify({ outcomes: [], pendingModifiers: [], budgetUsage: {} })
    localStorage.setItem(PROBABILITY_KEY, prevProbRaw)
    const originalSetItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (key === PINBALL_KEY) throw new Error('pinball disk full')
      return originalSetItem.call(this, key, value)
    })
    expect(pinball.playEvent({ seed: 2026, now: monday })).toBeNull()
    expect(pinball.state.tokens).toBe(0)
    expect(pinball.state.plays.length).toBe(0)
    expect(prob.state.outcomes.length).toBe(0)
    expect(localStorage.getItem(PROBABILITY_KEY)).toBe(prevProbRaw)
  })

  it('原 Probability key 不存在时，Pinball 保存失败补偿使用 removeItem', () => {
    const pinball = usePinballStore()
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
    expect(pinball.playEvent({ seed: 2026, now: monday })).toBeNull()
    expect(removed).toContain(PROBABILITY_KEY)
  })

  it('补偿失败仍继续其余恢复，最终抛固定错误', () => {
    const pinball = usePinballStore()
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
      pinball.playEvent({ seed: 2026, now: monday })
    } catch (e) {
      thrown = e
    }
    expect((thrown as Error).message).toBe('pinball play persistence rollback failed')
    expect(pinball.state.tokens).toBe(0)
    expect(pinball.state.plays.length).toBe(0)
    expect(useProbabilityStore().state.outcomes.length).toBe(0)
  })
})

describe('Phase 3.70 — fresh Pinia 重载与失败后重试', () => {
  it('成功后重载：tokens、play、outcome、budget 均恢复', () => {
    const pinball = usePinballStore()
    const record = pinball.playEvent({ seed: 2026, now: monday })
    expect(record).not.toBeNull()
    const tokensAfter = pinball.state.tokens
    // fresh Pinia 重载
    setActivePinia(createPinia())
    warmupStores()
    const freshProb = useProbabilityStore()
    const freshPinball = usePinballStore()
    expect(freshPinball.state.tokens).toBe(tokensAfter)
    expect(freshPinball.state.plays.length).toBe(1)
    expect(freshProb.state.outcomes.length).toBe(1)
    expect(freshProb.state.budgetUsage['pinball']).toBeDefined()
  })

  it('Pinball 保存失败后重载：tokens/play/outcome/budget 均保持游玩前', () => {
    const pinball = usePinballStore()
    pinball.state.tokens = 5
    localStorage.setItem(PINBALL_KEY, JSON.stringify({ tokens: 5, conversions: [], plays: [] }))
    const originalSetItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (key === PINBALL_KEY) throw new Error('pinball disk full')
      return originalSetItem.call(this, key, value)
    })
    expect(pinball.playEvent({ seed: 2026, now: monday })).toBeNull()
    vi.restoreAllMocks()
    // fresh Pinia 重载
    setActivePinia(createPinia())
    warmupStores()
    const freshProb = useProbabilityStore()
    const freshPinball = usePinballStore()
    expect(freshPinball.state.tokens).toBe(5)
    expect(freshPinball.state.plays.length).toBe(0)
    expect(freshProb.state.outcomes.length).toBe(0)
  })

  it('失败后再次成功只结算一次，不携带失败残留', () => {
    const pinball = usePinballStore()
    let pinballWriteDone = false
    const originalSetItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (key === PINBALL_KEY && !pinballWriteDone) {
        pinballWriteDone = true
        throw new Error('pinball disk full')
      }
      return originalSetItem.call(this, key, value)
    })
    expect(pinball.playEvent({ seed: 2026, now: monday })).toBeNull() // 第一次失败
    vi.restoreAllMocks()
    const second = pinball.playEvent({ seed: 2027, now: monday }) // 第二次成功
    expect(second).not.toBeNull()
    expect(pinball.state.plays.length).toBe(1) // 只结算一次，无失败残留
    expect(pinball.state.tokens).toBe(second?.tokensGained ?? 0)
    expect(useProbabilityStore().state.outcomes.length).toBe(1)
  })
})
