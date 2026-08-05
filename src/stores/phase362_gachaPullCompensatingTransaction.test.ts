// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { usePlayerStore } from './playerStore'
import { useMonsterStore } from './monsterStore'
import { useGameStore } from './gameStore'
import { useTrainingStore } from './trainingStore'
import { useATBStore } from './atbStore'
import { useRebirthStore } from './rebirthStore'
import { useThemeStore } from './themeStore'
import { useNavigationStore } from './navigationStore'
import { useGachaStore } from './gachaStore'
import { useProbabilityStore } from './probabilityStore'
import { PERMANENT_POOL_ID } from '../data/gachaPools'
import App from '../App.vue'
import type { ComponentPublicInstance } from 'vue'

/**
 * Phase 3.62 — 所有抽卡模式（单抽/十连/抽卡券/显式 free/每日免费）收口为同步补偿事务。
 *
 * - pull()/claimDailyFree() 公共签名保持；普通失败返回 [] / null；
 * - 权威资格门在任何 mutation/RNG/raw 读取前拒绝；
 * - 候选完整构造后引用替换提交；任一步失败 → 内存回滚 → 严格逆序补偿已写入 key；
 * - 补偿自身失败抛 'gacha persistence rollback failed'；
 * - GachaTab → TabsContainer → App fail-stop 链路。
 */

const GACHA_KEY = 'nz_gacha_v1'
const PROBABILITY_KEY = 'nz_probability_v1'
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
}

function seedPlayer(diamond: number, tickets = 0) {
  const playerStore = usePlayerStore()
  playerStore.player.diamond = diamond
  playerStore.player.gachaTickets = tickets
  return playerStore
}

function addModifier(id: string, appliesTo: 'singlePull' | 'tenPull' = 'tenPull', appliesToCost: 'freeOnly' | 'paidOnly' = 'paidOnly') {
  const prob = useProbabilityStore()
  prob.addPendingModifier(PERMANENT_POOL_ID, {
    id,
    source: 'pachinko',
    label: id,
    appliesTo,
    appliesToCost,
    rarePlusBonus: 6
  } as never)
  return prob
}

/** 直接推入 pendingModifiers（不写盘），供需要精确控制旧 Probability raw 的失败测试。 */
function pushModifierNoSave(id: string, appliesTo: 'singlePull' | 'tenPull' = 'tenPull', appliesToCost: 'freeOnly' | 'paidOnly' = 'paidOnly') {
  const prob = useProbabilityStore()
  prob.state.pendingModifiers.unshift({
    id,
    source: 'pachinko',
    label: id,
    appliesTo,
    appliesToCost,
    rarePlusBonus: 6,
    poolId: PERMANENT_POOL_ID
  } as never)
  return prob
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

describe('Phase 3.62 — 权威资格门零副作用', () => {
  function assertZeroSideEffects(getItemSpy: ReturnType<typeof vi.spyOn>, setItemSpy: ReturnType<typeof vi.spyOn>, removeSpy: ReturnType<typeof vi.spyOn>, saveGameSpy: ReturnType<typeof vi.spyOn>, randomSpy: ReturnType<typeof vi.spyOn>) {
    expect(randomSpy).not.toHaveBeenCalled()
    expect(getItemSpy).not.toHaveBeenCalled()
    expect(setItemSpy).not.toHaveBeenCalled()
    expect(removeSpy).not.toHaveBeenCalled()
    expect(saveGameSpy).not.toHaveBeenCalled()
  }

  it('未知 pool / 非法 count / 非法 free / 非法 rng / 非法 seed → 普通失败零副作用', () => {
    const playerStore = seedPlayer(10000)
    const gacha = useGachaStore()
    const randomSpy = vi.spyOn(Math, 'random')
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem')
    const { setItemSpy, removeSpy } = spyStorage()
    const saveGameSpy = vi.spyOn(playerStore, 'saveGame')

    expect(gacha.pull('nonexistent', 1)).toEqual([])
    expect(gacha.pull(PERMANENT_POOL_ID, 5 as never)).toEqual([])
    expect(gacha.pull(PERMANENT_POOL_ID, 1, { free: 'yes' as never })).toEqual([])
    expect(gacha.pull(PERMANENT_POOL_ID, 1, { rng: 5 as never })).toEqual([])
    expect(gacha.pull(PERMANENT_POOL_ID, 1, { seed: 1.5 })).toEqual([])

    assertZeroSideEffects(getItemSpy, setItemSpy, removeSpy, saveGameSpy, randomSpy)
    expect(playerStore.player.diamond).toBe(10000)
  })

  it('Player diamond/tickets 非法、资源不足、pity 非法、容器非法、pendingModifiers 非法 → invalid state 零副作用', () => {
    const playerStore = usePlayerStore()
    const gacha = useGachaStore()
    const prob = useProbabilityStore()
    const randomSpy = vi.spyOn(Math, 'random')
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem')
    const { setItemSpy, removeSpy } = spyStorage()
    const saveGameSpy = vi.spyOn(playerStore, 'saveGame')

    // diamond 非法
    playerStore.player.diamond = -1
    expect(gacha.pull(PERMANENT_POOL_ID, 1)).toEqual([])
    playerStore.player.diamond = 10000
    // tickets 非法
    playerStore.player.gachaTickets = -1
    expect(gacha.pull(PERMANENT_POOL_ID, 1)).toEqual([])
    playerStore.player.gachaTickets = 0
    // 资源不足
    playerStore.player.diamond = 100
    expect(gacha.pull(PERMANENT_POOL_ID, 1)).toEqual([])
    playerStore.player.diamond = 10000
    // pity 非法
    gacha.state.pityCounters[PERMANENT_POOL_ID] = -1
    expect(gacha.pull(PERMANENT_POOL_ID, 1)).toEqual([])
    delete gacha.state.pityCounters[PERMANENT_POOL_ID]
    // Gacha 容器非法
    gacha.state.history = 'bad' as never
    expect(gacha.pull(PERMANENT_POOL_ID, 1)).toEqual([])
    gacha.state.history = []
    // pendingModifiers 非法
    prob.state.pendingModifiers = 'bad' as never
    expect(gacha.pull(PERMANENT_POOL_ID, 1)).toEqual([])

    assertZeroSideEffects(getItemSpy, setItemSpy, removeSpy, saveGameSpy, randomSpy)
  })

  it('每日 marker 非法 / 每日已经领取 → 零 RNG、零 raw、零写盘', () => {
    const playerStore = seedPlayer(10000)
    const gacha = useGachaStore()
    const randomSpy = vi.spyOn(Math, 'random')
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem')
    const { setItemSpy, removeSpy } = spyStorage()
    const saveGameSpy = vi.spyOn(playerStore, 'saveGame')

    gacha.state.lastDailyFree[PERMANENT_POOL_ID] = -1
    expect(gacha.claimDailyFree(PERMANENT_POOL_ID)).toBeNull()
    gacha.state.lastDailyFree[PERMANENT_POOL_ID] = 'bad' as never
    expect(gacha.claimDailyFree(PERMANENT_POOL_ID)).toBeNull()
    delete gacha.state.lastDailyFree[PERMANENT_POOL_ID]

    // 今日已领取
    const today = new Date().setHours(0, 0, 0, 0)
    gacha.state.lastDailyFree[PERMANENT_POOL_ID] = today
    expect(gacha.claimDailyFree(PERMANENT_POOL_ID)).toBeNull()

    assertZeroSideEffects(getItemSpy, setItemSpy, removeSpy, saveGameSpy, randomSpy)
  })
})

describe('Phase 3.62 — 非免费成功矩阵', () => {
  it('纯钻石单抽：钻石精确 -280、Gacha 写一次、主存档一次且最后、返回 rewards', () => {
    const playerStore = seedPlayer(1000)
    const gacha = useGachaStore()
    const { setItemSpy } = spyStorage()
    const saveGameSpy = vi.spyOn(playerStore, 'saveGame')
    const result = gacha.pull(PERMANENT_POOL_ID, 1, { seed: 7 })
    expect(result.length).toBe(1)
    expect(playerStore.player.diamond).toBe(720)
    expect(gacha.state.pityCounters[PERMANENT_POOL_ID]).toBe(1)
    expect(gacha.state.history.length).toBe(1)
    expect(saveGameSpy).toHaveBeenCalledTimes(1)
    const keys = setItemSpy.mock.calls.map(c => c[0]).filter(k => [GACHA_KEY, MAIN_KEY].includes(k))
    expect(keys).toEqual([GACHA_KEY, MAIN_KEY])
  })

  it('纯抽卡券单抽：券 -1、钻石不变', () => {
    const playerStore = seedPlayer(1000, 1)
    const gacha = useGachaStore()
    const result = gacha.pull(PERMANENT_POOL_ID, 1, { seed: 8 })
    expect(result.length).toBe(1)
    expect(playerStore.player.gachaTickets).toBe(0)
    expect(playerStore.player.diamond).toBe(1000)
  })

  it('混合券与钻石十连：先扣券再扣钻石', () => {
    const playerStore = seedPlayer(10000, 3)
    const gacha = useGachaStore()
    const result = gacha.pull(PERMANENT_POOL_ID, 10, { seed: 9 })
    expect(result.length).toBe(10)
    expect(playerStore.player.gachaTickets).toBe(0)
    expect(playerStore.player.diamond).toBe(10000 - 7 * 280)
  })

  it('有适用 modifier：Probability 消耗并写一次，写入顺序 Probability → Gacha → 主存档', () => {
    seedPlayer(10000)
    addModifier('pachinko_ten_pull_modifier')
    const prob = useProbabilityStore()
    const gacha = useGachaStore()
    const { setItemSpy } = spyStorage()
    const result = gacha.pull(PERMANENT_POOL_ID, 10, { seed: 10 })
    expect(result.length).toBe(10)
    expect(prob.state.pendingModifiers.some(m => m.id === 'pachinko_ten_pull_modifier')).toBe(false)
    const keys = setItemSpy.mock.calls.map(c => c[0]).filter(k => [PROBABILITY_KEY, GACHA_KEY, MAIN_KEY].includes(k))
    expect(keys).toEqual([PROBABILITY_KEY, GACHA_KEY, MAIN_KEY])
  })

  it('无适用 modifier：不写 nz_probability_v1', () => {
    seedPlayer(10000)
    const gacha = useGachaStore()
    const { setItemSpy } = spyStorage()
    gacha.pull(PERMANENT_POOL_ID, 1, { seed: 11 })
    expect(setItemSpy.mock.calls.filter(c => c[0] === PROBABILITY_KEY).length).toBe(0)
  })

  it('成功 Gacha payload 实际内容正确（JSON.parse）', () => {
    seedPlayer(1000)
    const gacha = useGachaStore()
    const { setItemSpy } = spyStorage()
    gacha.pull(PERMANENT_POOL_ID, 1, { seed: 12 })
    const gachaSets = setItemSpy.mock.calls.filter(c => c[0] === GACHA_KEY)
    expect(gachaSets.length).toBe(1)
    const payload = JSON.parse(gachaSets[0][1])
    expect(payload.pityCounters[PERMANENT_POOL_ID]).toBe(1)
    expect(payload.history.length).toBe(1)
    expect(payload.history[0].poolId).toBe(PERMANENT_POOL_ID)
    const mainSets = setItemSpy.mock.calls.filter(c => c[0] === MAIN_KEY)
    const mainPayload = JSON.parse(mainSets[0][1])
    expect(mainPayload.player.diamond).toBe(720)
  })
})

describe('Phase 3.62 — 每日免费成功', () => {
  it('免费领取：零资源变化、零 saveGame、保底/历史/每日 marker 单次 Gacha payload 同时提交', () => {
    const playerStore = seedPlayer(10000)
    const gacha = useGachaStore()
    const { setItemSpy } = spyStorage()
    const saveGameSpy = vi.spyOn(playerStore, 'saveGame')
    const reward = gacha.claimDailyFree(PERMANENT_POOL_ID)
    expect(reward).not.toBeNull()
    expect(playerStore.player.diamond).toBe(10000)
    expect(playerStore.player.gachaTickets).toBe(0)
    expect(saveGameSpy).not.toHaveBeenCalled()
    const gachaSets = setItemSpy.mock.calls.filter(c => c[0] === GACHA_KEY)
    expect(gachaSets.length).toBe(1)
    const payload = JSON.parse(gachaSets[0][1])
    expect(payload.pityCounters[PERMANENT_POOL_ID]).toBe(1)
    expect(payload.history.length).toBe(1)
    expect(payload.lastDailyFree[PERMANENT_POOL_ID]).toBeDefined()
    expect(setItemSpy.mock.calls.filter(c => c[0] === PROBABILITY_KEY).length).toBe(0)
  })

  it('同日第二次调用：返回 null、零 RNG、零 raw 读取、零写盘、零 mutation', () => {
    const playerStore = seedPlayer(10000)
    const gacha = useGachaStore()
    gacha.claimDailyFree(PERMANENT_POOL_ID) // 领取一次
    const randomSpy = vi.spyOn(Math, 'random')
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem')
    const { setItemSpy, removeSpy } = spyStorage()
    const saveGameSpy = vi.spyOn(playerStore, 'saveGame')
    const diamondBefore = playerStore.player.diamond
    const historyLenBefore = gacha.state.history.length
    expect(gacha.claimDailyFree(PERMANENT_POOL_ID)).toBeNull()
    expect(randomSpy).not.toHaveBeenCalled()
    expect(getItemSpy).not.toHaveBeenCalled()
    expect(setItemSpy).not.toHaveBeenCalled()
    expect(removeSpy).not.toHaveBeenCalled()
    expect(saveGameSpy).not.toHaveBeenCalled()
    expect(playerStore.player.diamond).toBe(diamondBefore)
    expect(gacha.state.history.length).toBe(historyLenBefore)
  })
})

describe('Phase 3.62 — 失败注入与完整回滚', () => {
  it('Probability 保存失败：内存回滚、Gacha/主存档不写、raw 不变、返回 []', () => {
    const playerStore = seedPlayer(10000)
    pushModifierNoSave('pachinko_ten_pull_modifier')
    const gacha = useGachaStore()
    const prob = useProbabilityStore()
    const originalSetItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (key === PROBABILITY_KEY) throw new Error('prob disk full')
      return originalSetItem.call(this, key, value)
    })
    const saveGameSpy = vi.spyOn(playerStore, 'saveGame')
    expect(gacha.pull(PERMANENT_POOL_ID, 10, { seed: 13 })).toEqual([])
    expect(playerStore.player.diamond).toBe(10000) // 回滚
    expect(gacha.state.history.length).toBe(0)
    expect(gacha.state.pityCounters[PERMANENT_POOL_ID]).toBeUndefined()
    expect(prob.state.pendingModifiers.some(m => m.id === 'pachinko_ten_pull_modifier')).toBe(true) // 未被消耗
    expect(saveGameSpy).not.toHaveBeenCalled()
    expect(localStorage.getItem(GACHA_KEY)).toBeNull()
  })

  it('Gacha 保存失败（Probability 已写）：内存回滚、Probability raw 恢复、主存档不写', () => {
    const playerStore = seedPlayer(10000)
    const prevProbRaw = JSON.stringify({ pendingModifiers: [], outcomes: [], budgetUsage: {} })
    localStorage.setItem(PROBABILITY_KEY, prevProbRaw)
    pushModifierNoSave('pachinko_ten_pull_modifier')
    const gacha = useGachaStore()
    const prob = useProbabilityStore()
    const originalSetItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (key === GACHA_KEY) throw new Error('gacha disk full')
      return originalSetItem.call(this, key, value)
    })
    const saveGameSpy = vi.spyOn(playerStore, 'saveGame')
    expect(gacha.pull(PERMANENT_POOL_ID, 10, { seed: 14 })).toEqual([])
    expect(playerStore.player.diamond).toBe(10000)
    expect(gacha.state.history.length).toBe(0)
    expect(prob.state.pendingModifiers.some(m => m.id === 'pachinko_ten_pull_modifier')).toBe(true)
    expect(saveGameSpy).not.toHaveBeenCalled()
    expect(localStorage.getItem(PROBABILITY_KEY)).toBe(prevProbRaw) // Probability raw 恢复
  })

  it('主存档返回 false：完整回滚、严格逆序恢复 Gacha → Probability、返回普通失败', () => {
    const playerStore = seedPlayer(10000)
    const prevGachaRaw = JSON.stringify({ pityCounters: {}, lastDailyFree: {}, history: [] })
    const prevProbRaw = JSON.stringify({ pendingModifiers: [], outcomes: [], budgetUsage: {} })
    localStorage.setItem(GACHA_KEY, prevGachaRaw)
    localStorage.setItem(PROBABILITY_KEY, prevProbRaw)
    pushModifierNoSave('pachinko_ten_pull_modifier')
    const gacha = useGachaStore()
    const prob = useProbabilityStore()
    const { setItemSpy } = spyStorage()
    vi.spyOn(playerStore, 'saveGame').mockReturnValue(false)
    expect(gacha.pull(PERMANENT_POOL_ID, 10, { seed: 15 })).toEqual([])
    expect(playerStore.player.diamond).toBe(10000)
    expect(gacha.state.history.length).toBe(0)
    expect(gacha.state.pityCounters[PERMANENT_POOL_ID]).toBeUndefined()
    expect(prob.state.pendingModifiers.some(m => m.id === 'pachinko_ten_pull_modifier')).toBe(true)
    expect(localStorage.getItem(GACHA_KEY)).toBe(prevGachaRaw)
    expect(localStorage.getItem(PROBABILITY_KEY)).toBe(prevProbRaw)
    // 前向 Probability → Gacha；补偿逆序 Gacha → Probability
    const keys = setItemSpy.mock.calls.map(c => c[0]).filter(k => [PROBABILITY_KEY, GACHA_KEY].includes(k))
    expect(keys).toEqual([PROBABILITY_KEY, GACHA_KEY, GACHA_KEY, PROBABILITY_KEY])
  })

  it('主存档抛异常：完整回滚、Gacha → Probability 逆序恢复、公共 API 返回普通失败', () => {
    const playerStore = seedPlayer(10000)
    const prevGachaRaw = JSON.stringify({ pityCounters: {}, lastDailyFree: {}, history: [] })
    localStorage.setItem(GACHA_KEY, prevGachaRaw)
    pushModifierNoSave('pachinko_ten_pull_modifier')
    const gacha = useGachaStore()
    vi.spyOn(playerStore, 'saveGame').mockImplementation(() => {
      throw new Error('main boom')
    })
    expect(gacha.pull(PERMANENT_POOL_ID, 10, { seed: 16 })).toEqual([])
    expect(playerStore.player.diamond).toBe(10000)
    expect(gacha.state.history.length).toBe(0)
    expect(localStorage.getItem(GACHA_KEY)).toBe(prevGachaRaw)
  })

  it('null raw 补偿：主存档失败后 remove 顺序为 Gacha → Probability', () => {
    const playerStore = seedPlayer(10000)
    pushModifierNoSave('pachinko_ten_pull_modifier')
    const gacha = useGachaStore()
    const { removeSpy } = spyStorage()
    vi.spyOn(playerStore, 'saveGame').mockReturnValue(false)
    expect(gacha.pull(PERMANENT_POOL_ID, 10, { seed: 17 })).toEqual([])
    const removed = removeSpy.mock.calls.map(c => c[0]).filter(k => [GACHA_KEY, PROBABILITY_KEY].includes(k))
    expect(removed).toEqual([GACHA_KEY, PROBABILITY_KEY]) // 逆序
  })
})

describe('Phase 3.62 — 补偿自身失败', () => {
  it('第一个恢复失败仍继续第二个恢复，最终抛 gacha persistence rollback failed、内存保持回滚', () => {
    const playerStore = seedPlayer(10000)
    const prevGachaRaw = JSON.stringify({ pityCounters: {}, lastDailyFree: {}, history: [] })
    const prevProbRaw = JSON.stringify({ pendingModifiers: [], outcomes: [], budgetUsage: {} })
    localStorage.setItem(GACHA_KEY, prevGachaRaw)
    localStorage.setItem(PROBABILITY_KEY, prevProbRaw)
    pushModifierNoSave('pachinko_ten_pull_modifier')
    const gacha = useGachaStore()
    let mainFailed = false
    vi.spyOn(playerStore, 'saveGame').mockImplementation(() => {
      mainFailed = true
      return false
    })
    const originalSetItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (key === GACHA_KEY && mainFailed) throw new Error('gacha restore boom')
      return originalSetItem.call(this, key, value)
    })
    let thrown: unknown
    try {
      gacha.pull(PERMANENT_POOL_ID, 10, { seed: 18 })
    } catch (e) {
      thrown = e
    }
    expect((thrown as Error).message).toBe('gacha persistence rollback failed')
    expect(playerStore.player.diamond).toBe(10000) // 内存保持回滚
    expect(gacha.state.history.length).toBe(0)
    expect(localStorage.getItem(PROBABILITY_KEY)).toBe(prevProbRaw) // 第二个恢复仍被尝试并成功
  })
})

describe('Phase 3.62 — 每日免费重复领取故障回归（fresh Pinia 重载）', () => {
  it('Gacha 持久化失败后重载：无新保底/历史/marker、modifier 未消耗、无半成功状态', () => {
    const playerStore = seedPlayer(10000)
    addModifier('free_pull_modifier', 'singlePull', 'freeOnly')
    const gacha = useGachaStore()
    const originalSetItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (key === GACHA_KEY) throw new Error('gacha disk full')
      return originalSetItem.call(this, key, value)
    })
    expect(gacha.claimDailyFree(PERMANENT_POOL_ID)).toBeNull()
    expect(playerStore.player.diamond).toBe(10000)

    // fresh Pinia 重载：不 clear localStorage，读取补偿恢复后的磁盘状态
    setActivePinia(createPinia())
    warmupStores()
    const freshGacha = useGachaStore()
    const freshProb = useProbabilityStore()
    expect(freshGacha.state.pityCounters[PERMANENT_POOL_ID]).toBeUndefined() // 无新保底
    expect(freshGacha.state.history.length).toBe(0) // 无新历史
    expect(freshGacha.state.lastDailyFree[PERMANENT_POOL_ID]).toBeUndefined() // 无 marker
    expect(freshProb.state.pendingModifiers.some(m => m.id === 'free_pull_modifier')).toBe(true) // modifier 未消耗
  })
})

describe('Phase 3.62 — RNG/候选异常', () => {
  it('RNG 第 2 次调用抛错：异常上送、零内存修改、零 raw 读取/写入、零 Player save', () => {
    const playerStore = seedPlayer(10000)
    const gacha = useGachaStore()
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem')
    const { setItemSpy, removeSpy } = spyStorage()
    const saveGameSpy = vi.spyOn(playerStore, 'saveGame')
    let rngCalls = 0
    const throwingRng = () => {
      rngCalls += 1
      if (rngCalls === 2) throw new Error('rng boom')
      return 0.5
    }
    let thrown: unknown
    try {
      gacha.pull(PERMANENT_POOL_ID, 10, { rng: throwingRng })
    } catch (e) {
      thrown = e
    }
    expect((thrown as Error).message).toBe('rng boom')
    expect(rngCalls).toBe(2)
    expect(playerStore.player.diamond).toBe(10000)
    expect(gacha.state.history.length).toBe(0)
    expect(gacha.state.pityCounters[PERMANENT_POOL_ID]).toBeUndefined()
    expect(getItemSpy).not.toHaveBeenCalled()
    expect(setItemSpy).not.toHaveBeenCalled()
    expect(removeSpy).not.toHaveBeenCalled()
    expect(saveGameSpy).not.toHaveBeenCalled()
  })
})

describe('Phase 3.62 — GachaTab → TabsContainer → App fail-stop', () => {
  type AppVm = ComponentPublicInstance & {
    runtimeStartupStatus?: 'initializing' | 'ready' | 'blocked' | 'faulted'
    runtimeStartupError?: string
  }

  function spyCleanup() {
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1)
    const cancelSpy = vi.spyOn(window, 'cancelAnimationFrame')
    const intervalSpy = vi.spyOn(window, 'setInterval')
    const clearSpy = vi.spyOn(window, 'clearInterval')
    const addSpy = vi.spyOn(window, 'addEventListener')
    const removeSpy = vi.spyOn(window, 'removeEventListener')
    return { rafSpy, cancelSpy, intervalSpy, clearSpy, addSpy, removeSpy }
  }

  function mountReadyApp() {
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    const gameStore = useGameStore()
    playerStore.player.currentHp = 100
    playerStore.player.maxHp = 100
    playerStore.player.diamond = 10000
    monsterStore.setProgress(50, 50)
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    const wrapper = mount(App, {
      global: {
        stubs: {
          BattleHUD: true,
          PlayerStatusBar: true,
          OverlayContainer: true,
          PauseOverlay: true,
          OfflineRewardModal: { template: '<div class="offline-reward-stub"></div>' }
        }
      }
    })
    return { wrapper, playerStore }
  }

  async function gotoGachaTab() {
    const nav = useNavigationStore()
    nav.selectPrimary('resources')
    nav.selectSecondary('shopGacha')
    await flushPromises()
    await vi.dynamicImportSettled()
    await nextTick()
  }

  /** 绕过 disabled UX 层真实分发 click，真实执行 doPull 内的权威 guard。 */
  async function forceClickPastDisabled(button: { attributes(): Record<string, string>; element: HTMLElement; trigger(event: string): Promise<void> }) {
    expect(button.attributes()).toHaveProperty('disabled')
    button.element.removeAttribute('disabled')
    await button.trigger('click')
  }

  it('ready + 成功：正常扣钻石、results 展示、App 保持 ready、零 fault', async () => {
    const { wrapper, playerStore } = mountReadyApp()
    const vm = wrapper.vm as unknown as AppVm
    await nextTick()
    await gotoGachaTab()
    await wrapper.get('.single-btn').trigger('click')
    await nextTick()
    expect(playerStore.player.diamond).toBe(10000 - 280)
    expect(vm.runtimeStartupStatus).toBe('ready')
    expect(vm.runtimeStartupError).toBe('')
    wrapper.unmount()
  })

  it('普通失败（资源不足）：零 fault、App 保持 ready', async () => {
    const { wrapper, playerStore } = mountReadyApp()
    const vm = wrapper.vm as unknown as AppVm
    await nextTick()
    playerStore.player.diamond = 0
    await gotoGachaTab()
    await wrapper.get('.single-btn').trigger('click')
    await nextTick()
    expect(vm.runtimeStartupStatus).toBe('ready')
    expect(vm.runtimeStartupError).toBe('')
    wrapper.unmount()
  })

  it('���偿失败：fault 一次、App 进入 faulted、reason 精确、cleanup 单次', async () => {
    const { cancelSpy, intervalSpy, clearSpy, removeSpy } = spyCleanup()
    const { wrapper, playerStore } = mountReadyApp()
    const vm = wrapper.vm as unknown as AppVm
    await nextTick()
    expect(vm.runtimeStartupStatus).toBe('ready')
    // 旧 Gacha raw 非 null（恢复走 setItem），main save 失败后 Gacha 恢复抛错
    localStorage.setItem(GACHA_KEY, JSON.stringify({ pityCounters: {}, lastDailyFree: {}, history: [] }))
    let mainFailed = false
    vi.spyOn(playerStore, 'saveGame').mockImplementation(() => {
      mainFailed = true
      return false
    })
    const originalSetItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (key === GACHA_KEY && mainFailed) throw new Error('gacha restore boom')
      return originalSetItem.call(this, key, value)
    })
    await gotoGachaTab()
    await wrapper.get('.single-btn').trigger('click')
    await nextTick()
    expect(vm.runtimeStartupStatus).toBe('faulted')
    expect(vm.runtimeStartupError).toBe('gacha interaction failed: gacha persistence rollback failed')
    const runtimeSetIdx = intervalSpy.mock.calls.findIndex(c => c[1] === 1000)
    const runtimeIntervalId = intervalSpy.mock.results[runtimeSetIdx].value
    expect(cancelSpy.mock.calls.filter(c => c[0] === 1).length).toBe(1)
    expect(clearSpy.mock.calls.filter(c => c[0] === runtimeIntervalId).length).toBe(1)
    expect(removeSpy.mock.calls.filter(c => c[0] === 'beforeunload').length).toBe(1)
    wrapper.unmount()
  })

  it('faulted 后绕过 disabled 真实 click：零 Store action、零写盘、零新 fault', async () => {
    const { wrapper, playerStore } = mountReadyApp()
    const vm = wrapper.vm as unknown as AppVm
    await nextTick()
    localStorage.setItem(GACHA_KEY, JSON.stringify({ pityCounters: {}, lastDailyFree: {}, history: [] }))
    let mainFailed = false
    vi.spyOn(playerStore, 'saveGame').mockImplementation(() => {
      mainFailed = true
      return false
    })
    const originalSetItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (key === GACHA_KEY && mainFailed) throw new Error('gacha restore boom')
      return originalSetItem.call(this, key, value)
    })
    await gotoGachaTab()
    await wrapper.get('.single-btn').trigger('click')
    await nextTick()
    expect(vm.runtimeStartupStatus).toBe('faulted')
    // 记录计数与状态
    const gacha = useGachaStore()
    const pullSpy = vi.spyOn(gacha, 'pull')
    const randomSpy = vi.spyOn(Math, 'random')
    const saveGameSpy = vi.mocked(playerStore.saveGame)
    const setItemSpy = vi.mocked(Storage.prototype.setItem)
    const callsAfter = { pull: pullSpy.mock.calls.length, save: saveGameSpy.mock.calls.length, set: setItemSpy.mock.calls.length }
    const diamondAfter = playerStore.player.diamond
    const historyLenAfter = gacha.state.history.length
    // 绕过 disabled 真实 click
    await forceClickPastDisabled(wrapper.get('.single-btn'))
    await nextTick()
    expect(pullSpy.mock.calls.length).toBe(callsAfter.pull) // 零 Store action
    expect(randomSpy).not.toHaveBeenCalled() // 零 RNG
    expect(saveGameSpy.mock.calls.length).toBe(callsAfter.save) // 零 main save
    expect(setItemSpy.mock.calls.length).toBe(callsAfter.set) // 零写盘
    expect(playerStore.player.diamond).toBe(diamondAfter)
    expect(gacha.state.history.length).toBe(historyLenAfter)
    expect(vm.runtimeStartupError).toBe('gacha interaction failed: gacha persistence rollback failed') // 零新 fault
    wrapper.unmount()
  })
})
