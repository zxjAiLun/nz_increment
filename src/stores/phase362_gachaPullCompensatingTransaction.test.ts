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
import { GACHA_POOLS, PERMANENT_POOL_ID } from '../data/gachaPools'
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

/** fresh Pinia + 就绪 Player（diamond=10000），返回各 store 引用与所属 pinia。 */
function freshStore() {
  const p = createPinia()
  setActivePinia(p)
  localStorage.clear() // 避免上一轮 ok 事务的磁盘写入污染本轮加载状态
  warmupStores()
  const playerStore = usePlayerStore()
  playerStore.player.diamond = 10000
  return { playerStore, gacha: useGachaStore(), prob: useProbabilityStore(), pinia: p }
}

/** 断言拒绝路径的完整零副作用（含 Date.now 候选与 RNG）。 */
function assertZeroSideEffectsExtended(randomSpy: ReturnType<typeof vi.spyOn>, dateNowSpy: ReturnType<typeof vi.spyOn>, getItemSpy: ReturnType<typeof vi.spyOn>, setItemSpy: ReturnType<typeof vi.spyOn>, removeSpy: ReturnType<typeof vi.spyOn>, saveGameSpy: ReturnType<typeof vi.spyOn>) {
  expect(randomSpy).not.toHaveBeenCalled()
  expect(dateNowSpy).not.toHaveBeenCalled()
  expect(getItemSpy).not.toHaveBeenCalled()
  expect(setItemSpy).not.toHaveBeenCalled()
  expect(removeSpy).not.toHaveBeenCalled()
  expect(saveGameSpy).not.toHaveBeenCalled()
}

let pinia: ReturnType<typeof createPinia>

beforeEach(() => {
  pinia = createPinia()
  setActivePinia(pinia)
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

  it('ready + 成功：真实 App → TabsContainer → GachaTab 正常抽卡、App 保持 ready、零 fault（固定 RNG）', async () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5) // 固定 RNG，成功确定性
    const { wrapper, playerStore } = mountReadyApp()
    const vm = wrapper.vm as unknown as AppVm
    await nextTick()
    await gotoGachaTab()
    await wrapper.get('.single-btn').trigger('click')
    await nextTick()
    expect(playerStore.player.diamond).toBe(10000 - 280)
    expect(randomSpy).toHaveBeenCalled() // 事务实际使用 RNG
    expect(vm.runtimeStartupStatus).toBe('ready')
    expect(vm.runtimeStartupError).toBe('') // 零 fault
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

describe('Phase 3.62 Repair 1 — 每日免费 marker 资格门', () => {
  const today = new Date().setHours(0, 0, 0, 0)
  const yesterday = today - 86400000
  const tomorrow = today + 86400000

  it('marker 矩阵：undefined/昨天 可继续；今天 不可用；非法值 invalid state 零副作用', () => {
    const cases: Array<[unknown, 'ok' | 'unavailable' | 'invalid']> = [
      [undefined, 'ok'],
      [yesterday, 'ok'],
      [today, 'unavailable'],
      [tomorrow, 'unavailable'],
      [0, 'invalid'],
      [-1, 'invalid'],
      [1.5, 'invalid'],
      [NaN, 'invalid'],
      [Infinity, 'invalid'],
      ['1', 'invalid'],
      [true, 'invalid'],
      [null, 'invalid'],
      [{}, 'invalid'],
      [[], 'invalid'],
      [Number.MAX_SAFE_INTEGER + 1, 'invalid']
    ]
    for (const [marker, expected] of cases) {
      vi.restoreAllMocks() // 清除上一轮 spy，避免 wrap 链污染
      const { gacha, playerStore } = freshStore()
      const randomSpy = vi.spyOn(Math, 'random')
      const dateNowSpy = vi.spyOn(Date, 'now')
      const getItemSpy = vi.spyOn(Storage.prototype, 'getItem')
      const { setItemSpy, removeSpy } = spyStorage()
      const saveGameSpy = vi.spyOn(playerStore, 'saveGame')
      if (marker !== undefined) gacha.state.lastDailyFree[PERMANENT_POOL_ID] = marker as never
      const reward = gacha.claimDailyFree(PERMANENT_POOL_ID)
      if (expected === 'ok') {
        expect(reward).not.toBeNull()
      } else {
        expect(reward).toBeNull()
        assertZeroSideEffectsExtended(randomSpy, dateNowSpy, getItemSpy, setItemSpy, removeSpy, saveGameSpy)
        expect(gacha.state.history.length).toBe(0)
        expect(playerStore.player.diamond).toBe(10000)
      }
    }
  })

  it('canClaimDailyFree 与权威 action 的 marker 边界一致（fail-closed）', () => {
    const { gacha } = freshStore()
    gacha.state.lastDailyFree = {}
    expect(gacha.canClaimDailyFree(PERMANENT_POOL_ID)).toBe(true) // 缺失
    gacha.state.lastDailyFree[PERMANENT_POOL_ID] = 0
    expect(gacha.canClaimDailyFree(PERMANENT_POOL_ID)).toBe(false) // 0 fail-closed
    gacha.state.lastDailyFree[PERMANENT_POOL_ID] = -1
    expect(gacha.canClaimDailyFree(PERMANENT_POOL_ID)).toBe(false)
    gacha.state.lastDailyFree[PERMANENT_POOL_ID] = '1' as never
    expect(gacha.canClaimDailyFree(PERMANENT_POOL_ID)).toBe(false)
    gacha.state.lastDailyFree[PERMANENT_POOL_ID] = today
    expect(gacha.canClaimDailyFree(PERMANENT_POOL_ID)).toBe(false) // 今天
    gacha.state.lastDailyFree[PERMANENT_POOL_ID] = yesterday
    expect(gacha.canClaimDailyFree(PERMANENT_POOL_ID)).toBe(true) // 昨天
  })
})

describe('Phase 3.62 Repair 1 — 时间源非法', () => {
  it('Date.now 返回 0/-1/1.5/unsafe：每日免费 invalid state 零副作用（Date.now 被调用一次即本次源）', () => {
    for (const bad of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      vi.restoreAllMocks() // 清除上一轮 spy
      const { gacha, playerStore } = freshStore()
      const randomSpy = vi.spyOn(Math, 'random')
      vi.spyOn(Date, 'now').mockReturnValue(bad)
      const getItemSpy = vi.spyOn(Storage.prototype, 'getItem')
      const { setItemSpy, removeSpy } = spyStorage()
      const saveGameSpy = vi.spyOn(playerStore, 'saveGame')
      expect(gacha.claimDailyFree(PERMANENT_POOL_ID)).toBeNull()
      // Date.now 是本次被测源（恰被调用一次），其余全部零
      expect(randomSpy).not.toHaveBeenCalled()
      expect(vi.mocked(Date.now)).toHaveBeenCalledTimes(1)
      expect(getItemSpy).not.toHaveBeenCalled()
      expect(setItemSpy).not.toHaveBeenCalled()
      expect(removeSpy).not.toHaveBeenCalled()
      expect(saveGameSpy).not.toHaveBeenCalled()
      expect(gacha.state.history.length).toBe(0)
    }
  })

  it('Date.now 返回 0：非免费抽卡返回 [] 零副作用', () => {
    const { gacha, playerStore } = freshStore()
    vi.spyOn(Date, 'now').mockReturnValue(0)
    const randomSpy = vi.spyOn(Math, 'random')
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem')
    const { setItemSpy, removeSpy } = spyStorage()
    const saveGameSpy = vi.spyOn(playerStore, 'saveGame')
    expect(gacha.pull(PERMANENT_POOL_ID, 1)).toEqual([])
    expect(randomSpy).not.toHaveBeenCalled()
    expect(vi.mocked(Date.now)).toHaveBeenCalledTimes(1)
    expect(getItemSpy).not.toHaveBeenCalled()
    expect(setItemSpy).not.toHaveBeenCalled()
    expect(removeSpy).not.toHaveBeenCalled()
    expect(saveGameSpy).not.toHaveBeenCalled()
    expect(gacha.state.history.length).toBe(0)
  })

  it('Date.now 抛异常：原异常上送、零 RNG、零副作用、状态不变', () => {
    const { gacha, playerStore } = freshStore()
    vi.spyOn(Date, 'now').mockImplementation(() => {
      throw new Error('time boom')
    })
    const randomSpy = vi.spyOn(Math, 'random')
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem')
    const { setItemSpy, removeSpy } = spyStorage()
    const saveGameSpy = vi.spyOn(playerStore, 'saveGame')
    let thrown: unknown
    try {
      gacha.pull(PERMANENT_POOL_ID, 1)
    } catch (e) {
      thrown = e
    }
    expect((thrown as Error).message).toBe('time boom')
    expect(randomSpy).not.toHaveBeenCalled() // 零 RNG
    expect(getItemSpy).not.toHaveBeenCalled()
    expect(setItemSpy).not.toHaveBeenCalled()
    expect(removeSpy).not.toHaveBeenCalled()
    expect(saveGameSpy).not.toHaveBeenCalled()
    expect(playerStore.player.diamond).toBe(10000) // 状态不变
    expect(gacha.state.history.length).toBe(0)
    expect(gacha.state.pityCounters[PERMANENT_POOL_ID]).toBeUndefined()
  })
})

describe('Phase 3.62 Repair 1 — 成本溢出', () => {
  it('pool.cost × count 溢出：返回 [] 零副作用，结束后恢复 pool 配置', () => {
    const originalCost = GACHA_POOLS[PERMANENT_POOL_ID].cost
    GACHA_POOLS[PERMANENT_POOL_ID].cost = Number.MAX_SAFE_INTEGER
    try {
      const { gacha, playerStore } = freshStore()
      const randomSpy = vi.spyOn(Math, 'random')
      const getItemSpy = vi.spyOn(Storage.prototype, 'getItem')
      const { setItemSpy, removeSpy } = spyStorage()
      const saveGameSpy = vi.spyOn(playerStore, 'saveGame')
      const dateNowSpy = vi.spyOn(Date, 'now')
      expect(gacha.pull(PERMANENT_POOL_ID, 10)).toEqual([])
      assertZeroSideEffectsExtended(randomSpy, dateNowSpy, getItemSpy, setItemSpy, removeSpy, saveGameSpy)
      expect(playerStore.player.diamond).toBe(10000)
    } finally {
      GACHA_POOLS[PERMANENT_POOL_ID].cost = originalCost
    }
  })
})

describe('Phase 3.62 Repair 1 — Gacha 容器边界', () => {
  it('pityCounters / lastDailyFree / history 为 null/array/primitive：invalid state 零副作用', () => {
    const containers: Array<['pityCounters' | 'lastDailyFree' | 'history', unknown]> = [
      ['pityCounters', null],
      ['pityCounters', []],
      ['pityCounters', 'x'],
      ['lastDailyFree', null],
      ['lastDailyFree', []],
      ['lastDailyFree', 'x'],
      ['history', null],
      ['history', {}],
      ['history', 'x']
    ]
    for (const [field, bad] of containers) {
      vi.restoreAllMocks() // 清除上一轮 spy
      const { gacha, playerStore } = freshStore()
      gacha.state[field] = bad as never
      const randomSpy = vi.spyOn(Math, 'random')
      const getItemSpy = vi.spyOn(Storage.prototype, 'getItem')
      const { setItemSpy, removeSpy } = spyStorage()
      const saveGameSpy = vi.spyOn(playerStore, 'saveGame')
      const dateNowSpy = vi.spyOn(Date, 'now')
      expect(gacha.pull(PERMANENT_POOL_ID, 1)).toEqual([])
      assertZeroSideEffectsExtended(randomSpy, dateNowSpy, getItemSpy, setItemSpy, removeSpy, saveGameSpy)
    }
  })
})

describe('Phase 3.62 Repair 1 — pity 边界', () => {
  it('当前 pity 非法（负数/小数/字符串/unsafe/等于/超过 target）：invalid state 零副作用', () => {
    const target = GACHA_POOLS[PERMANENT_POOL_ID].pity.target
    const badValues = [-1, 1.5, '5', Number.MAX_SAFE_INTEGER, target, target + 1]
    for (const bad of badValues) {
      vi.restoreAllMocks() // 清除上一轮 spy
      const { gacha, playerStore } = freshStore()
      gacha.state.pityCounters[PERMANENT_POOL_ID] = bad as never
      const randomSpy = vi.spyOn(Math, 'random')
      const getItemSpy = vi.spyOn(Storage.prototype, 'getItem')
      const { setItemSpy, removeSpy } = spyStorage()
      const saveGameSpy = vi.spyOn(playerStore, 'saveGame')
      const dateNowSpy = vi.spyOn(Date, 'now')
      expect(gacha.pull(PERMANENT_POOL_ID, 1)).toEqual([])
      assertZeroSideEffectsExtended(randomSpy, dateNowSpy, getItemSpy, setItemSpy, removeSpy, saveGameSpy)
    }
  })

  it('缺失当前 pool key 按 0 处理并允许合法事务', () => {
    const { gacha } = freshStore()
    const result = gacha.pull(PERMANENT_POOL_ID, 1, { seed: 5 })
    expect(result.length).toBe(1)
    expect(gacha.state.pityCounters[PERMANENT_POOL_ID]).toBe(1)
  })
})

describe('Phase 3.62 Repair 1 — Player 数值边界', () => {
  it('diamond/gachaTickets 负数/小数/字符串/unsafe → invalid state 零副作用', () => {
    const badValues = [-1, 1.5, '100', Number.MAX_SAFE_INTEGER + 1]
    for (const field of ['diamond', 'gachaTickets'] as const) {
      for (const bad of badValues) {
        vi.restoreAllMocks() // 清除上一轮 spy
        const { gacha, playerStore } = freshStore()
        playerStore.player[field] = bad as never
        const randomSpy = vi.spyOn(Math, 'random')
        const getItemSpy = vi.spyOn(Storage.prototype, 'getItem')
        const { setItemSpy, removeSpy } = spyStorage()
        const saveGameSpy = vi.spyOn(playerStore, 'saveGame')
        const dateNowSpy = vi.spyOn(Date, 'now')
        expect(gacha.pull(PERMANENT_POOL_ID, 1)).toEqual([])
        assertZeroSideEffectsExtended(randomSpy, dateNowSpy, getItemSpy, setItemSpy, removeSpy, saveGameSpy)
      }
    }
  })

  it('资源不足（diamond < cost）：普通失败零副作用', () => {
    const { gacha, playerStore } = freshStore()
    playerStore.player.diamond = 10
    const randomSpy = vi.spyOn(Math, 'random')
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem')
    const { setItemSpy, removeSpy } = spyStorage()
    const saveGameSpy = vi.spyOn(playerStore, 'saveGame')
    const dateNowSpy = vi.spyOn(Date, 'now')
    expect(gacha.pull(PERMANENT_POOL_ID, 1)).toEqual([])
    assertZeroSideEffectsExtended(randomSpy, dateNowSpy, getItemSpy, setItemSpy, removeSpy, saveGameSpy)
  })
})
