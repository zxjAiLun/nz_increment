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

/**
 * Phase 3.68 — Pachinko 射击补偿事务。
 *
 * - playShot() 收口为：单次时间戳 → resolver/outcome/record 候选 → 内存+raw 快照 →
 *   Probability 无写盘提交 → Pachinko history 内存提交 → Probability 保存 → Pachinko 保存；
 * - 任一步失败：内存完整回滚 + 已写 raw 逆序补偿；补偿自身失败抛
 *   'pachinko persistence rollback failed'。
 */

const PACHINKO_KEY = 'nz_pachinko_v1'
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
}

function spyStorage() {
  const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
  const removeSpy = vi.spyOn(Storage.prototype, 'removeItem')
  return { setItemSpy, removeSpy }
}

function seedPachinkoBudgetNearLimit() {
  const prob = useProbabilityStore()
  const base = new Date(monday)
  base.setHours(0, 0, 0, 0)
  const fmt = (d: Date) => `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}-${`${d.getDate()}`.padStart(2, '0')}`
  const dailyKey = `day:${fmt(base)}`
  const weekStart = new Date(base)
  const dow = weekStart.getDay() || 7
  weekStart.setDate(weekStart.getDate() - dow + 1)
  const weeklyKey = `week:${fmt(weekStart)}`
  prob.state.budgetUsage.pachinko = {
    periodKey: `${dailyKey}|${weeklyKey}`,
    dailyPeriodKey: dailyKey,
    weeklyPeriodKey: weeklyKey,
    expectedValue: 12, // 上限 12，任何 rarePlusBonus >= 2 都超预算
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

describe('Phase 3.68 — 资格门与异常零副作用', () => {
  it('非法 timestamp：零副作用', () => {
    const pachinko = usePachinkoStore()
    const prob = useProbabilityStore()
    const randomSpy = vi.spyOn(Math, 'random')
    const { setItemSpy, removeSpy } = spyStorage()
    expect(pachinko.playShot(undefined, { now: 0 })).toBeNull()
    expect(randomSpy).not.toHaveBeenCalled()
    expect(setItemSpy).not.toHaveBeenCalled()
    expect(removeSpy).not.toHaveBeenCalled()
    expect(pachinko.state.history.length).toBe(0)
    expect(prob.state.outcomes.length).toBe(0)
  })

  it('Date.now 抛错：异常上送、零副作用', () => {
    const pachinko = usePachinkoStore()
    const prob = useProbabilityStore()
    vi.spyOn(Date, 'now').mockImplementation(() => {
      throw new Error('time boom')
    })
    const randomSpy = vi.spyOn(Math, 'random')
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem')
    const { setItemSpy, removeSpy } = spyStorage()
    let thrown: unknown
    try {
      pachinko.playShot()
    } catch (e) {
      thrown = e
    }
    expect((thrown as Error).message).toBe('time boom')
    expect(randomSpy).not.toHaveBeenCalled()
    expect(getItemSpy).not.toHaveBeenCalled()
    expect(setItemSpy).not.toHaveBeenCalled()
    expect(removeSpy).not.toHaveBeenCalled()
    expect(pachinko.state.history.length).toBe(0)
    expect(prob.state.outcomes.length).toBe(0)
  })

  it('RNG/resolver 抛错：异常上送、零副作用', () => {
    const pachinko = usePachinkoStore()
    const prob = useProbabilityStore()
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem')
    const { setItemSpy, removeSpy } = spyStorage()
    let thrown: unknown
    try {
      pachinko.playShot(undefined, { rng: () => {
        throw new Error('rng boom')
      }, now: monday })
    } catch (e) {
      thrown = e
    }
    expect((thrown as Error).message).toBe('rng boom')
    expect(getItemSpy).not.toHaveBeenCalled()
    expect(setItemSpy).not.toHaveBeenCalled()
    expect(removeSpy).not.toHaveBeenCalled()
    expect(pachinko.state.history.length).toBe(0)
    expect(prob.state.outcomes.length).toBe(0)
  })
})

describe('Phase 3.68 — 单次时间戳与成功语义', () => {
  it('无显式 seed 成功且 Date.now 恰好一次；record timestamp 与 outcome seed 同值', () => {
    const fixedNow = 1785859200000
    vi.spyOn(Date, 'now').mockReturnValue(fixedNow)
    const pachinko = usePachinkoStore()
    const prob = useProbabilityStore()
    const record = pachinko.playShot()
    expect(record).not.toBeNull()
    expect(vi.mocked(Date.now)).toHaveBeenCalledTimes(1) // 单次时间源
    expect(record?.timestamp).toBe(fixedNow)
    expect(prob.state.outcomes.length).toBe(1)
    expect(prob.state.outcomes[0].seed).toBe(String(fixedNow)) // 无显式 seed → 时间戳
    expect(prob.state.pendingModifiers.some(m => m.id.startsWith('pachinko_ten_pull_modifier:'))).toBe(true)
    expect(pachinko.state.history.length).toBe(1)
  })

  it('显式 seed 成功：outcome seed 用显式 seed，record timestamp 用单次事务时间', () => {
    const fixedNow = 1785859200000
    const pachinko = usePachinkoStore()
    const prob = useProbabilityStore()
    const record = pachinko.playShot(undefined, { seed: 42, now: fixedNow })
    expect(record).not.toBeNull()
    expect(record?.timestamp).toBe(fixedNow)
    expect(prob.state.outcomes[0].seed).toBe('42') // 显式 seed 继续作为 outcome seed
    expect(prob.state.outcomes[0].modifier?.id).toContain('pachinko_ten_pull_modifier:42:')
  })

  it('成功顺序 Probability → Pachinko，每 key 恰好一次', () => {
    const pachinko = usePachinkoStore()
    const { setItemSpy } = spyStorage()
    pachinko.playShot(undefined, { seed: 42, now: monday })
    const keys = setItemSpy.mock.calls.map(c => c[0]).filter(k => [PROBABILITY_KEY, PACHINKO_KEY].includes(k))
    expect(keys).toEqual([PROBABILITY_KEY, PACHINKO_KEY])
    expect(setItemSpy.mock.calls.filter(c => c[0] === PROBABILITY_KEY).length).toBe(1)
    expect(setItemSpy.mock.calls.filter(c => c[0] === PACHINKO_KEY).length).toBe(1)
  })

  it('history 达到 20 条后：新记录在顶部、总数保持 20', () => {
    const pachinko = usePachinkoStore()
    pachinko.state.history = Array.from({ length: 20 }, (_, i) => ({
      timestamp: 1000 + i,
      poolId: 'permanent_abyss',
      modifier: { id: `old_${i}` },
      audit: { roll: 1, normalizedRates: {}, selectedRarity: 'common', selectedRewardId: 'x', modifiers: [], steps: [] }
    } as never))
    const record = pachinko.playShot(undefined, { seed: 42, now: monday })
    expect(record).not.toBeNull()
    expect(pachinko.state.history.length).toBe(20)
    expect(pachinko.state.history[0].modifier.id).not.toBe('old_0') // 新记录在顶部
    expect(pachinko.state.history[0].timestamp).toBe(monday)
  })
})

describe('Phase 3.68 — 预算拒绝与失败注入', () => {
  it('预算拒绝：Probability 三字段与 Pachinko history 完全不变、零写盘', () => {
    const pachinko = usePachinkoStore()
    const prob = useProbabilityStore()
    seedPachinkoBudgetNearLimit()
    const prevOutcomes = [...prob.state.outcomes]
    const prevBudget = JSON.parse(JSON.stringify(prob.state.budgetUsage))
    const prevModifiers = [...prob.state.pendingModifiers]
    const prevHistory = [...pachinko.state.history]
    const { setItemSpy, removeSpy } = spyStorage()
    expect(pachinko.playShot(undefined, { seed: 42, now: monday })).toBeNull()
    expect(prob.state.outcomes).toEqual(prevOutcomes)
    expect(prob.state.budgetUsage).toEqual(prevBudget)
    expect(prob.state.pendingModifiers).toEqual(prevModifiers)
    expect(pachinko.state.history).toEqual(prevHistory)
    expect(setItemSpy).not.toHaveBeenCalled()
    expect(removeSpy).not.toHaveBeenCalled()
  })

  it('raw getItem 抛错：返回 null、零内存 mutation、零写盘', () => {
    const pachinko = usePachinkoStore()
    const prob = useProbabilityStore()
    const originalGetItem = Storage.prototype.getItem
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key: string) {
      if (key === PROBABILITY_KEY) throw new Error('read boom')
      return originalGetItem.call(this, key)
    })
    const { setItemSpy, removeSpy } = spyStorage()
    expect(pachinko.playShot(undefined, { seed: 42, now: monday })).toBeNull()
    expect(prob.state.outcomes.length).toBe(0)
    expect(prob.state.pendingModifiers.length).toBe(0)
    expect(pachinko.state.history.length).toBe(0)
    expect(setItemSpy).not.toHaveBeenCalled()
    expect(removeSpy).not.toHaveBeenCalled()
  })

  it('Probability 保存失败：两 Store 内存回滚、Pachinko 不写', () => {
    const pachinko = usePachinkoStore()
    const prob = useProbabilityStore()
    const originalSetItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (key === PROBABILITY_KEY) throw new Error('prob disk full')
      return originalSetItem.call(this, key, value)
    })
    expect(pachinko.playShot(undefined, { seed: 42, now: monday })).toBeNull()
    expect(prob.state.outcomes.length).toBe(0)
    expect(prob.state.pendingModifiers.length).toBe(0)
    expect(pachinko.state.history.length).toBe(0)
    expect(localStorage.getItem(PACHINKO_KEY)).toBeNull() // Pachinko 未写
  })

  it('Pachinko 保存失败：两 Store 内存回滚、Probability raw 恢复', () => {
    const pachinko = usePachinkoStore()
    const prob = useProbabilityStore()
    const prevProbRaw = JSON.stringify({ outcomes: [], pendingModifiers: [], budgetUsage: {} })
    localStorage.setItem(PROBABILITY_KEY, prevProbRaw)
    const originalSetItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (key === PACHINKO_KEY) throw new Error('pachinko disk full')
      return originalSetItem.call(this, key, value)
    })
    expect(pachinko.playShot(undefined, { seed: 42, now: monday })).toBeNull()
    expect(prob.state.outcomes.length).toBe(0)
    expect(prob.state.pendingModifiers.length).toBe(0)
    expect(pachinko.state.history.length).toBe(0)
    expect(localStorage.getItem(PROBABILITY_KEY)).toBe(prevProbRaw) // Probability raw 恢复
  })

  it('原 Probability key 不存在时，Pachinko 保存失败补偿使用 removeItem', () => {
    const pachinko = usePachinkoStore()
    const prob = useProbabilityStore()
    expect(localStorage.getItem(PROBABILITY_KEY)).toBeNull()
    const removed: string[] = []
    const originalSetItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (key === PACHINKO_KEY) throw new Error('pachinko disk full')
      return originalSetItem.call(this, key, value)
    })
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (this: Storage, key: string) {
      removed.push(key)
    })
    expect(pachinko.playShot(undefined, { seed: 42, now: monday })).toBeNull()
    expect(prob.state.outcomes.length).toBe(0)
    expect(removed).toContain(PROBABILITY_KEY) // 原 key 不存在 → removeItem
  })

  it('补偿失败仍继续其余恢复，最终抛固定错误', () => {
    const pachinko = usePachinkoStore()
    const prevProbRaw = JSON.stringify({ outcomes: [], pendingModifiers: [], budgetUsage: {} })
    localStorage.setItem(PROBABILITY_KEY, prevProbRaw)
    let pachinkoWriteDone = false
    let probWrites = 0
    const originalSetItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (key === PACHINKO_KEY && !pachinkoWriteDone) {
        pachinkoWriteDone = true
        throw new Error('pachinko disk full')
      }
      if (key === PROBABILITY_KEY) {
        probWrites += 1
        if (probWrites === 2) throw new Error('prob restore boom') // 补偿阶段第一个恢复失败
      }
      return originalSetItem.call(this, key, value)
    })
    let thrown: unknown
    try {
      pachinko.playShot(undefined, { seed: 42, now: monday })
    } catch (e) {
      thrown = e
    }
    expect((thrown as Error).message).toBe('pachinko persistence rollback failed')
    expect(pachinko.state.history.length).toBe(0) // 内存保持回滚
    expect(useProbabilityStore().state.outcomes.length).toBe(0)
  })
})

describe('Phase 3.68 — fresh Pinia 重载证据', () => {
  it('成功后重载：Probability outcome、pending modifier、Pachinko history 三者均恢复', () => {
    const pachinko = usePachinkoStore()
    const prob = useProbabilityStore()
    pachinko.playShot(undefined, { seed: 42, now: monday })
    expect(prob.state.outcomes.length).toBe(1)
    expect(pachinko.state.history.length).toBe(1)
    // fresh Pinia 重载
    setActivePinia(createPinia())
    warmupStores()
    const freshProb = useProbabilityStore()
    const freshPachinko = usePachinkoStore()
    expect(freshProb.state.outcomes.length).toBe(1) // outcome 恢复
    expect(freshProb.state.pendingModifiers.some(m => m.id.startsWith('pachinko_ten_pull_modifier:'))).toBe(true)
    expect(freshPachinko.state.history.length).toBe(1) // history 恢复
    expect(freshPachinko.state.history[0].timestamp).toBe(monday)
  })

  it('Pachinko 保存失败后重载：三者均不存在（无半成功）', () => {
    const pachinko = usePachinkoStore()
    const originalSetItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (key === PACHINKO_KEY) throw new Error('pachinko disk full')
      return originalSetItem.call(this, key, value)
    })
    expect(pachinko.playShot(undefined, { seed: 42, now: monday })).toBeNull()
    vi.restoreAllMocks() // 恢复 storage，避免 fresh Store 构造写入失败
    // fresh Pinia 重载
    setActivePinia(createPinia())
    warmupStores()
    const freshProb = useProbabilityStore()
    const freshPachinko = usePachinkoStore()
    expect(freshProb.state.outcomes.length).toBe(0) // 无 outcome
    expect(freshProb.state.pendingModifiers.length).toBe(0) // 无 modifier
    expect(freshPachinko.state.history.length).toBe(0) // 无 history
  })
})
