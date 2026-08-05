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
import { PERMANENT_POOL_ID } from '../data/gachaPools'
import type { ChanceGameOutcome } from '../systems/probability/chanceGame'

/**
 * Phase 3.65 — Lucky Wheel 每日转盘补偿事务。
 *
 * - spinDaily() 收口为：资格门 → 单次时间戳 → RNG/reward 候选 → 内存快照 → 内存提交 →
 *   固定顺序持久化（probability → luckyWheel → gacha[pity] → main[ticket]）；
 * - 任一步失败：内存完整回滚 + 已写 raw 逆序补偿；补偿自身失败抛
 *   'lucky wheel persistence rollback failed'。
 */

const LUCKY_WHEEL_KEY = 'nz_lucky_wheel_v1'
const PROBABILITY_KEY = 'nz_probability_v1'
const GACHA_KEY = 'nz_gacha_v1'
const MAIN_KEY = 'lollipop_adventure_save'

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
}

function makeRng(sequence: number[]) {
  let i = 0
  return () => sequence[i++] ?? 0.5
}

function spyStorage() {
  const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
  const removeSpy = vi.spyOn(Storage.prototype, 'removeItem')
  return { setItemSpy, removeSpy }
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

describe('Phase 3.65 — 资格门与异常零副作用', () => {
  it('每日重复领取：零 RNG、零时间源、零 storage、零 mutation', () => {
    const wheel = useLuckyWheelStore()
    wheel.state.lastDailyFree = new Date().setHours(0, 0, 0, 0)
    const randomSpy = vi.spyOn(Math, 'random')
    const dateNowSpy = vi.spyOn(Date, 'now')
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem')
    const { setItemSpy, removeSpy } = spyStorage()
    const saveGameSpy = vi.spyOn(usePlayerStore(), 'saveGame')
    const historyLen = wheel.state.history.length
    expect(wheel.spinDaily()).toBeNull()
    expect(randomSpy).not.toHaveBeenCalled()
    expect(dateNowSpy).not.toHaveBeenCalled()
    expect(getItemSpy).not.toHaveBeenCalled()
    expect(setItemSpy).not.toHaveBeenCalled()
    expect(removeSpy).not.toHaveBeenCalled()
    expect(saveGameSpy).not.toHaveBeenCalled()
    expect(wheel.state.history.length).toBe(historyLen)
  })

  it('Date.now 非法或抛错：零副作用', () => {
    const wheel = useLuckyWheelStore()
    const playerStore = usePlayerStore()
    // Date.now 非法 → null
    vi.spyOn(Date, 'now').mockReturnValue(0)
    const randomSpy = vi.spyOn(Math, 'random')
    const { setItemSpy, removeSpy } = spyStorage()
    expect(wheel.spinDaily()).toBeNull()
    expect(randomSpy).not.toHaveBeenCalled()
    expect(setItemSpy).not.toHaveBeenCalled()
    expect(removeSpy).not.toHaveBeenCalled()
    // Date.now throw → 原样上送
    vi.restoreAllMocks()
    vi.spyOn(Date, 'now').mockImplementation(() => {
      throw new Error('time boom')
    })
    const randomSpy2 = vi.spyOn(Math, 'random')
    const { setItemSpy: s2, removeSpy: r2 } = spyStorage()
    let thrown: unknown
    try {
      wheel.spinDaily()
    } catch (e) {
      thrown = e
    }
    expect((thrown as Error).message).toBe('time boom')
    expect(randomSpy2).not.toHaveBeenCalled()
    expect(s2).not.toHaveBeenCalled()
    expect(r2).not.toHaveBeenCalled()
    expect(playerStore.player.gachaTickets).toBe(0)
  })

  it('RNG 抛错：异常上送、零副作用、零保存', () => {
    const wheel = useLuckyWheelStore()
    const playerStore = usePlayerStore()
    const gacha = useGachaStore()
    const prob = useProbabilityStore()
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem')
    const { setItemSpy, removeSpy } = spyStorage()
    const saveGameSpy = vi.spyOn(playerStore, 'saveGame')
    let thrown: unknown
    try {
      wheel.spinDaily({ rng: () => {
        throw new Error('rng boom')
      } })
    } catch (e) {
      thrown = e
    }
    expect((thrown as Error).message).toBe('rng boom')
    expect(getItemSpy).not.toHaveBeenCalled()
    expect(setItemSpy).not.toHaveBeenCalled()
    expect(removeSpy).not.toHaveBeenCalled()
    expect(saveGameSpy).not.toHaveBeenCalled()
    expect(gacha.state.pityCounters[PERMANENT_POOL_ID]).toBeUndefined()
    expect(prob.state.outcomes.length).toBe(0)
    expect(wheel.state.history.length).toBe(0)
  })
})

describe('Phase 3.65 — 四类奖励成功', () => {
  it('pity 成功：Gacha 保底 +1、Probability outcome/modifier 记录、wheel history + marker', () => {
    const wheel = useLuckyWheelStore()
    const gacha = useGachaStore()
    const prob = useProbabilityStore()
    const { setItemSpy } = spyStorage()
    const saveGameSpy = vi.spyOn(usePlayerStore(), 'saveGame')
    const record = wheel.spinDaily({ rng: makeRng([0.5]) }) // pity_plus_1 (common)
    expect(record?.reward.type).toBe('pity')
    expect(gacha.state.pityCounters[PERMANENT_POOL_ID]).toBe(1)
    expect(prob.state.outcomes.length).toBe(1)
    expect(prob.state.outcomes[0].gameId).toBe('luckyWheel')
    expect(wheel.state.history.length).toBe(1)
    expect(wheel.state.history[0].timestamp).toBe(wheel.state.lastDailyFree) // 同一时间戳
    expect(saveGameSpy).not.toHaveBeenCalled()
    const keys = setItemSpy.mock.calls.map(c => c[0]).filter(k => [PROBABILITY_KEY, LUCKY_WHEEL_KEY, GACHA_KEY].includes(k))
    expect(keys).toEqual([PROBABILITY_KEY, LUCKY_WHEEL_KEY, GACHA_KEY]) // probability → luckyWheel → gacha
  })

  it('rare+ 成功：Probability pending modifier 入队、无 Gacha/Player/token 变更', () => {
    const wheel = useLuckyWheelStore()
    const prob = useProbabilityStore()
    const gacha = useGachaStore()
    const playerStore = usePlayerStore()
    const { setItemSpy } = spyStorage()
    const record = wheel.spinDaily({ rng: makeRng([0.2, 0.6]) }) // rare_plus_5 (rare)
    expect(record?.reward.type).toBe('rarePlus')
    expect(prob.state.pendingModifiers.some(m => m.id.startsWith('rare_plus_bonus:'))).toBe(true)
    expect(gacha.state.pityCounters[PERMANENT_POOL_ID]).toBeUndefined()
    expect(playerStore.player.gachaTickets).toBe(0)
    expect(wheel.state.buildTokens).toEqual({})
    const keys = setItemSpy.mock.calls.map(c => c[0]).filter(k => [PROBABILITY_KEY, LUCKY_WHEEL_KEY, GACHA_KEY, MAIN_KEY].includes(k))
    expect(keys).toEqual([PROBABILITY_KEY, LUCKY_WHEEL_KEY])
  })

  it('gachaTicket 成功：Player 券 +1、main save 最后', () => {
    const wheel = useLuckyWheelStore()
    const playerStore = usePlayerStore()
    const { setItemSpy } = spyStorage()
    const saveGameSpy = vi.spyOn(playerStore, 'saveGame')
    const record = wheel.spinDaily({ rng: makeRng([0.05, 0.1]) }) // gacha_ticket_1 (epic)
    expect(record?.reward.type).toBe('gachaTicket')
    expect(playerStore.player.gachaTickets).toBe(1)
    expect(saveGameSpy).toHaveBeenCalledTimes(1)
    const keys = setItemSpy.mock.calls.map(c => c[0]).filter(k => [PROBABILITY_KEY, LUCKY_WHEEL_KEY, MAIN_KEY].includes(k))
    expect(keys).toEqual([PROBABILITY_KEY, LUCKY_WHEEL_KEY, MAIN_KEY]) // main 最后
  })

  it('buildToken 成功：wheel buildTokens +1', () => {
    const wheel = useLuckyWheelStore()
    const record = wheel.spinDaily({ rng: makeRng([0.005]) }) // token_speed_skill (legendary)
    expect(record?.reward.type).toBe('buildToken')
    expect(wheel.state.buildTokens['speedSkill']).toBe(1)
    expect(wheel.state.history.length).toBe(1)
  })

  it('ticket 成功：单次时间源，record/marker/saveGame checkpoint 同值', () => {
    const fixedNow = 1785859200000
    vi.spyOn(Date, 'now').mockReturnValue(fixedNow)
    const wheel = useLuckyWheelStore()
    const playerStore = usePlayerStore()
    const saveGameSpy = vi.spyOn(playerStore, 'saveGame')
    const record = wheel.spinDaily({ rng: makeRng([0.05, 0.1]) }) // gacha_ticket_1
    expect(record?.reward.type).toBe('gachaTicket')
    expect(vi.mocked(Date.now)).toHaveBeenCalledTimes(1) // 单次有效时间源
    expect(saveGameSpy).toHaveBeenCalledWith(fixedNow) // saveGame 收到同一事务时间戳
    expect(record?.timestamp).toBe(fixedNow)
    expect(wheel.state.lastDailyFree).toBe(fixedNow) // daily marker 同值
  })
})

describe('Phase 3.65 — 失败注入与完整回滚', () => {
  it('Probability 保存失败：内存回滚、其余不写、raw 不变、返回 null', () => {
    const wheel = useLuckyWheelStore()
    const gacha = useGachaStore()
    const prob = useProbabilityStore()
    const originalSetItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (key === PROBABILITY_KEY) throw new Error('prob disk full')
      return originalSetItem.call(this, key, value)
    })
    const saveGameSpy = vi.spyOn(usePlayerStore(), 'saveGame')
    expect(wheel.spinDaily({ rng: makeRng([0.5]) })).toBeNull()
    expect(gacha.state.pityCounters[PERMANENT_POOL_ID]).toBeUndefined() // 回滚
    expect(wheel.state.history.length).toBe(0)
    expect(wheel.state.lastDailyFree).toBe(0)
    expect(prob.state.outcomes.length).toBe(0) // 回滚
    expect(saveGameSpy).not.toHaveBeenCalled()
  })

  it('LuckyWheel 保存失败：内存回滚、Probability raw 恢复', () => {
    const wheel = useLuckyWheelStore()
    const gacha = useGachaStore()
    const prevProbRaw = JSON.stringify({ outcomes: [], pendingModifiers: [], budgetUsage: {} })
    localStorage.setItem(PROBABILITY_KEY, prevProbRaw)
    const originalSetItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (key === LUCKY_WHEEL_KEY) throw new Error('lw disk full')
      return originalSetItem.call(this, key, value)
    })
    expect(wheel.spinDaily({ rng: makeRng([0.5]) })).toBeNull()
    expect(gacha.state.pityCounters[PERMANENT_POOL_ID]).toBeUndefined()
    expect(wheel.state.history.length).toBe(0)
    expect(wheel.state.lastDailyFree).toBe(0)
    expect(localStorage.getItem(PROBABILITY_KEY)).toBe(prevProbRaw) // Probability raw 恢复
  })

  it('pity/Gacha 保存失败：内存回滚、逆序补偿 Probability → LuckyWheel', () => {
    const wheel = useLuckyWheelStore()
    const prevProbRaw = JSON.stringify({ outcomes: [], pendingModifiers: [], budgetUsage: {} })
    const prevLwRaw = JSON.stringify({ lastDailyFree: 0, buildTokens: {}, history: [] })
    localStorage.setItem(PROBABILITY_KEY, prevProbRaw)
    localStorage.setItem(LUCKY_WHEEL_KEY, prevLwRaw)
    const originalSetItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (key === GACHA_KEY) throw new Error('gacha disk full')
      return originalSetItem.call(this, key, value)
    })
    expect(wheel.spinDaily({ rng: makeRng([0.5]) })).toBeNull()
    expect(useGachaStore().state.pityCounters[PERMANENT_POOL_ID]).toBeUndefined()
    expect(wheel.state.history.length).toBe(0)
    expect(localStorage.getItem(PROBABILITY_KEY)).toBe(prevProbRaw)
    expect(localStorage.getItem(LUCKY_WHEEL_KEY)).toBe(prevLwRaw)
  })

  it('ticket/Player saveGame 返回 false：内存回滚、逆序补偿', () => {
    const wheel = useLuckyWheelStore()
    const playerStore = usePlayerStore()
    const prob = useProbabilityStore()
    const prevProbRaw = JSON.stringify({ outcomes: [], pendingModifiers: [], budgetUsage: {} })
    const prevLwRaw = JSON.stringify({ lastDailyFree: 0, buildTokens: {}, history: [] })
    localStorage.setItem(PROBABILITY_KEY, prevProbRaw)
    localStorage.setItem(LUCKY_WHEEL_KEY, prevLwRaw)
    const { setItemSpy } = spyStorage()
    vi.spyOn(playerStore, 'saveGame').mockReturnValue(false)
    expect(wheel.spinDaily({ rng: makeRng([0.05, 0.1]) })).toBeNull() // ticket
    expect(playerStore.player.gachaTickets).toBe(0) // 回滚
    expect(wheel.state.history.length).toBe(0)
    expect(prob.state.outcomes.length).toBe(0)
    expect(localStorage.getItem(PROBABILITY_KEY)).toBe(prevProbRaw)
    expect(localStorage.getItem(LUCKY_WHEEL_KEY)).toBe(prevLwRaw)
    // 前向 Probability → LuckyWheel → main；补偿逆序 LuckyWheel → Probability
    const keys = setItemSpy.mock.calls.map(c => c[0]).filter(k => [PROBABILITY_KEY, LUCKY_WHEEL_KEY].includes(k))
    expect(keys).toEqual([PROBABILITY_KEY, LUCKY_WHEEL_KEY, LUCKY_WHEEL_KEY, PROBABILITY_KEY])
  })

  it('ticket/Player saveGame 抛异常：内存回滚、逆序补偿', () => {
    const wheel = useLuckyWheelStore()
    const playerStore = usePlayerStore()
    vi.spyOn(playerStore, 'saveGame').mockImplementation(() => {
      throw new Error('main boom')
    })
    expect(wheel.spinDaily({ rng: makeRng([0.05, 0.1]) })).toBeNull()
    expect(playerStore.player.gachaTickets).toBe(0)
    expect(wheel.state.history.length).toBe(0)
    expect(wheel.state.lastDailyFree).toBe(0)
    expect(useProbabilityStore().state.outcomes.length).toBe(0)
  })

  it('ticket saveGame 失败：无第二次 Date.now、内存回滚', () => {
    const fixedNow = 1785859200000
    vi.spyOn(Date, 'now').mockReturnValue(fixedNow)
    const wheel = useLuckyWheelStore()
    const playerStore = usePlayerStore()
    vi.spyOn(playerStore, 'saveGame').mockReturnValue(false)
    expect(wheel.spinDaily({ rng: makeRng([0.05, 0.1]) })).toBeNull()
    expect(vi.mocked(Date.now)).toHaveBeenCalledTimes(1) // 无第二次时间源
    expect(playerStore.player.gachaTickets).toBe(0)
    expect(wheel.state.history.length).toBe(0)
    expect(wheel.state.lastDailyFree).toBe(0)
  })
})

describe('Phase 3.65 — 补偿自身失败', () => {
  it('第一个恢复失败仍继续第二个恢复，最终抛固定错误、内存保持回滚', () => {
    const wheel = useLuckyWheelStore()
    const gacha = useGachaStore()
    const prevProbRaw = JSON.stringify({ outcomes: [], pendingModifiers: [], budgetUsage: {} })
    const prevLwRaw = JSON.stringify({ lastDailyFree: 0, buildTokens: {}, history: [] })
    localStorage.setItem(PROBABILITY_KEY, prevProbRaw)
    localStorage.setItem(LUCKY_WHEEL_KEY, prevLwRaw)
    let gachaWriteDone = false
    let lwWrites = 0
    const originalSetItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (key === GACHA_KEY && !gachaWriteDone) {
        gachaWriteDone = true
        throw new Error('gacha disk full')
      }
      if (key === LUCKY_WHEEL_KEY) {
        lwWrites += 1
        if (lwWrites === 2) throw new Error('lw restore boom') // 补偿阶段第一个恢复失败
      }
      return originalSetItem.call(this, key, value)
    })
    let thrown: unknown
    try {
      wheel.spinDaily({ rng: makeRng([0.5]) })
    } catch (e) {
      thrown = e
    }
    expect((thrown as Error).message).toBe('lucky wheel persistence rollback failed')
    expect(gacha.state.pityCounters[PERMANENT_POOL_ID]).toBeUndefined() // 内存保持回滚
    expect(wheel.state.history.length).toBe(0)
    expect(localStorage.getItem(PROBABILITY_KEY)).toBe(prevProbRaw) // 第二个恢复仍被尝试并成功
  })
})

describe('Phase 3.65 — 同日二次结算', () => {
  it('成功后同日第二次 spinDaily 返回 null 且零副作用', () => {
    const wheel = useLuckyWheelStore()
    const playerStore = usePlayerStore()
    expect(wheel.spinDaily({ rng: makeRng([0.5]) })).not.toBeNull()
    const randomSpy = vi.spyOn(Math, 'random')
    const { setItemSpy, removeSpy } = spyStorage()
    const saveGameSpy = vi.spyOn(playerStore, 'saveGame')
    const historyLen = wheel.state.history.length
    expect(wheel.spinDaily()).toBeNull()
    expect(randomSpy).not.toHaveBeenCalled()
    expect(setItemSpy).not.toHaveBeenCalled()
    expect(removeSpy).not.toHaveBeenCalled()
    expect(saveGameSpy).not.toHaveBeenCalled()
    expect(wheel.state.history.length).toBe(historyLen)
  })
})

describe('Phase 3.65 Repair 1 — 预算拒绝零 mutation', () => {
  it('超预算 outcome：applyChanceOutcomeInMemory 返回 false 后三字段完全不变、零写盘', () => {
    const prob = useProbabilityStore()
    const overBudgetOutcome: ChanceGameOutcome = {
      gameId: 'luckyWheel',
      seed: 'over',
      source: 'event',
      label: 'over budget',
      expectedValueCost: 999 // 远超 luckyWheel expectedValueBudget=10
    }
    const prevOutcomes = [...prob.state.outcomes]
    const prevBudgetUsage = JSON.parse(JSON.stringify(prob.state.budgetUsage)) as typeof prob.state.budgetUsage
    const prevModifiers = [...prob.state.pendingModifiers]
    const { setItemSpy, removeSpy } = spyStorage()
    expect(prob.applyChanceOutcomeInMemory(overBudgetOutcome)).toBe(false)
    expect(prob.state.outcomes).toEqual(prevOutcomes)
    expect(prob.state.budgetUsage).toEqual(prevBudgetUsage) // getBudgetUsage 创建的 usage 已恢复
    expect(prob.state.pendingModifiers).toEqual(prevModifiers)
    expect(setItemSpy).not.toHaveBeenCalled()
    expect(removeSpy).not.toHaveBeenCalled()
  })
})
