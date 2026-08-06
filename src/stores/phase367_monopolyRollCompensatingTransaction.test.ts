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
import { useMonopolyStore } from './monopolyStore'
import { PERMANENT_POOL_ID } from '../data/gachaPools'
import type { MonopolyRewardType, MonopolyTile } from '../data/monopoly'
import type { BuildTarget } from '../types/navigation'

/**
 * Phase 3.67 — Monopoly 掷骰奖励补偿事务。
 *
 * - rollDice() 收口为：单次时间戳 → 纯候选 refresh/掷骰/tile/Boss → 预算校验 → 内存+raw 快照 →
 *   内存提交 → 固定持久化顺序（Probability → Gacha → LuckyWheel → Player main → Monopoly 最后）；
 * - 任一步失败：内存完整回滚 + 已写 raw 逆序补偿；补偿自身失败抛
 *   'monopoly persistence rollback failed'。
 */

const MONOPOLY_KEY = 'nz_monopoly_v1'
const PROBABILITY_KEY = 'nz_probability_v1'
const GACHA_KEY = 'nz_gacha_v1'
const LUCKY_WHEEL_KEY = 'nz_lucky_wheel_v1'
const MAIN_KEY = 'lollipop_adventure_save'
const monday = Date.UTC(2026, 3, 20)

function localWeekId(timestamp: number): string {
  const date = new Date(timestamp)
  const day = date.getDay() || 7
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() - day + 1)
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const localDay = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${localDay}`
}

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
  useMonopolyStore()
}

function setBoard(tile: MonopolyTile) {
  const monopoly = useMonopolyStore()
  monopoly.state.weekId = localWeekId(monday)
  monopoly.state.board = [{ id: 'start', index: 0, type: 'start', name: '起点' }, tile]
  monopoly.state.position = 0
  monopoly.state.diceRemaining = 3
  return monopoly
}

function rewardTile(type: MonopolyRewardType, id: string, value: number, buildTarget?: BuildTarget): MonopolyTile {
  return {
    id: `tile_${id}`,
    index: 1,
    type: 'reward',
    name: id,
    reward: { id, rarity: 'epic', name: id, description: '', type, value, ...(buildTarget ? { buildTarget } : {}) }
  }
}

function bossTile(rewards: MonopolyRewardType[], requiredPower = 1): MonopolyTile {
  return {
    id: 'boss_tile',
    index: 1,
    type: 'boss',
    name: 'Boss格',
    boss: {
      name: 'Boss',
      requiredPower,
      rewards: rewards.map((type, i) => ({
        id: `boss_${type}_${i}`,
        rarity: 'epic',
        name: `Boss_${type}`,
        description: '',
        type,
        value: type === 'pity' ? 3 : 1
      }))
    }
  }
}

function setHighPower() {
  const player = usePlayerStore()
  player.player.stats.attack = 1_000_000
  player.player.stats.maxHp = 1_000_000
  player.player.currentHp = 1_000_000
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

describe('Phase 3.67 — 资格门与异常零副作用', () => {
  it('非法或抛错 timestamp：零副作用', () => {
    const monopoly = setBoard(rewardTile('gold', 'gold_1500', 1500))
    const player = usePlayerStore()
    const prob = useProbabilityStore()
    const randomSpy = vi.spyOn(Math, 'random')
    const { setItemSpy, removeSpy } = spyStorage()
    expect(monopoly.rollDice({ now: 0 })).toBeNull() // 非法 timestamp
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
      monopoly.rollDice()
    } catch (e) {
      thrown = e
    }
    expect((thrown as Error).message).toBe('time boom')
    expect(randomSpy2).not.toHaveBeenCalled()
    expect(s2).not.toHaveBeenCalled()
    expect(r2).not.toHaveBeenCalled()
    expect(player.player.gold).toBe(0)
    expect(prob.state.outcomes.length).toBe(0)
  })

  it('RNG 抛错：异常上送、零副作用', () => {
    const monopoly = setBoard(rewardTile('gold', 'gold_1500', 1500))
    const player = usePlayerStore()
    const prob = useProbabilityStore()
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem')
    const { setItemSpy, removeSpy } = spyStorage()
    let thrown: unknown
    try {
      monopoly.rollDice({ rng: () => {
        throw new Error('rng boom')
      }, now: monday })
    } catch (e) {
      thrown = e
    }
    expect((thrown as Error).message).toBe('rng boom')
    expect(getItemSpy).not.toHaveBeenCalled()
    expect(setItemSpy).not.toHaveBeenCalled()
    expect(removeSpy).not.toHaveBeenCalled()
    expect(player.player.gold).toBe(0)
    expect(prob.state.outcomes.length).toBe(0)
    expect(monopoly.state.diceRemaining).toBe(3)
  })

  it('无骰子资格拒绝：零副作用', () => {
    const monopoly = setBoard(rewardTile('gold', 'gold_1500', 1500))
    monopoly.state.diceRemaining = 0
    const randomSpy = vi.spyOn(Math, 'random')
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem')
    const { setItemSpy, removeSpy } = spyStorage()
    expect(monopoly.rollDice({ now: monday })).toBeNull()
    expect(randomSpy).not.toHaveBeenCalled()
    expect(getItemSpy).not.toHaveBeenCalled()
    expect(setItemSpy).not.toHaveBeenCalled()
    expect(removeSpy).not.toHaveBeenCalled()
    expect(monopoly.state.position).toBe(0)
  })
})

describe('Phase 3.67 — 普通成功', () => {
  it('普通无奖励格成功：只移动 + 消耗骰子 + 只保存 Monopoly', () => {
    const monopoly = setBoard({ id: 'empty', index: 1, type: 'start', name: '空' })
    const { setItemSpy } = spyStorage()
    const record = monopoly.rollDice({ rng: () => 0, now: monday })
    expect(record).not.toBeNull()
    expect(monopoly.state.position).toBe(1)
    expect(monopoly.state.diceRemaining).toBe(2)
    expect(monopoly.state.history.length).toBe(1)
    const keys = setItemSpy.mock.calls.map(c => c[0]).filter(k => [PROBABILITY_KEY, GACHA_KEY, LUCKY_WHEEL_KEY, MAIN_KEY, MONOPOLY_KEY].includes(k))
    expect(keys).toEqual([MONOPOLY_KEY]) // 仅 Monopoly
  })

  it('gold 成功：Player gold +1500、Probability outcome、保存顺序 Probability → main → Monopoly', () => {
    const monopoly = setBoard(rewardTile('gold', 'gold_1500', 1500))
    const player = usePlayerStore()
    const prob = useProbabilityStore()
    const { setItemSpy } = spyStorage()
    const record = monopoly.rollDice({ rng: () => 0, now: monday })
    expect(record?.rewardNames).toEqual(['gold_1500'])
    expect(player.player.gold).toBe(1500)
    expect(prob.state.outcomes.length).toBe(1)
    expect(prob.state.outcomes[0].gameId).toBe('monopoly')
    const keys = setItemSpy.mock.calls.map(c => c[0]).filter(k => [PROBABILITY_KEY, GACHA_KEY, LUCKY_WHEEL_KEY, MAIN_KEY, MONOPOLY_KEY].includes(k))
    expect(keys).toEqual([PROBABILITY_KEY, MAIN_KEY, MONOPOLY_KEY])
  })

  it('pity 成功：Gacha 保底 +1、保存顺序 Probability → Gacha → Monopoly', () => {
    const monopoly = setBoard(rewardTile('pity', 'pity_1', 1))
    const gacha = useGachaStore()
    const prob = useProbabilityStore()
    const { setItemSpy } = spyStorage()
    const record = monopoly.rollDice({ rng: () => 0, now: monday })
    expect(record?.rewardNames).toEqual(['pity_1'])
    expect(gacha.state.pityCounters[PERMANENT_POOL_ID]).toBe(1)
    expect(prob.state.outcomes.length).toBe(1)
    const keys = setItemSpy.mock.calls.map(c => c[0]).filter(k => [PROBABILITY_KEY, GACHA_KEY, LUCKY_WHEEL_KEY, MAIN_KEY, MONOPOLY_KEY].includes(k))
    expect(keys).toEqual([PROBABILITY_KEY, GACHA_KEY, MONOPOLY_KEY])
  })

  it('rarePlus 成功：Probability pending modifier 入队、无其他 Store 变更', () => {
    const monopoly = setBoard(rewardTile('rarePlus', 'rare_plus_5', 5))
    const prob = useProbabilityStore()
    const player = usePlayerStore()
    const gacha = useGachaStore()
    const { setItemSpy } = spyStorage()
    const record = monopoly.rollDice({ rng: () => 0, now: monday })
    expect(record?.rewardNames).toEqual(['rare_plus_5'])
    expect(prob.state.pendingModifiers.some(m => m.id.startsWith('rare_plus_bonus:'))).toBe(true)
    expect(player.player.gold).toBe(0)
    expect(gacha.state.pityCounters[PERMANENT_POOL_ID]).toBeUndefined()
    const keys = setItemSpy.mock.calls.map(c => c[0]).filter(k => [PROBABILITY_KEY, GACHA_KEY, LUCKY_WHEEL_KEY, MAIN_KEY, MONOPOLY_KEY].includes(k))
    expect(keys).toEqual([PROBABILITY_KEY, MONOPOLY_KEY])
  })

  it('buildToken 成功：LuckyWheel token +1、保存顺序 Probability → LuckyWheel → Monopoly', () => {
    const monopoly = setBoard(rewardTile('buildToken', 'token_speed', 1, 'speedSkill'))
    const lw = useLuckyWheelStore()
    const { setItemSpy } = spyStorage()
    const record = monopoly.rollDice({ rng: () => 0, now: monday })
    expect(record?.rewardNames).toEqual(['token_speed'])
    expect(lw.state.buildTokens['speedSkill']).toBe(1)
    const keys = setItemSpy.mock.calls.map(c => c[0]).filter(k => [PROBABILITY_KEY, GACHA_KEY, LUCKY_WHEEL_KEY, MAIN_KEY, MONOPOLY_KEY].includes(k))
    expect(keys).toEqual([PROBABILITY_KEY, LUCKY_WHEEL_KEY, MONOPOLY_KEY])
  })
})

describe('Phase 3.67 — Boss 格', () => {
  it('Boss 失败：只提交 Monopoly，无 outcome、无奖励', () => {
    const monopoly = setBoard(bossTile(['gachaTicket'])) // requiredPower 1
    const player = usePlayerStore()
    // 零攻击 + 无技能 + HP 1：确定性打不过 Boss（0 伤害 → 超时 → killed=false）
    player.player.stats.attack = 0
    player.player.stats.defense = 0
    player.player.stats.maxHp = 1
    player.player.stats.speed = 0
    player.player.maxHp = 1
    player.player.currentHp = 1
    player.player.skills = []
    const prob = useProbabilityStore()
    const { setItemSpy } = spyStorage()
    const record = monopoly.rollDice({ rng: () => 0, now: monday })
    expect(record?.bossPassed).toBe(false)
    expect(record?.rewardNames).toEqual([])
    expect(player.player.gachaTickets).toBe(0)
    expect(prob.state.outcomes.length).toBe(0)
    expect(monopoly.state.diceRemaining).toBe(2)
    const keys = setItemSpy.mock.calls.map(c => c[0]).filter(k => [PROBABILITY_KEY, GACHA_KEY, LUCKY_WHEEL_KEY, MAIN_KEY, MONOPOLY_KEY].includes(k))
    expect(keys).toEqual([MONOPOLY_KEY]) // 仅 Monopoly
  })

  it('Boss 多奖励成功：每参与 Store 仅保存一次', () => {
    const monopoly = setBoard(bossTile(['gachaTicket', 'pity']))
    setHighPower()
    const player = usePlayerStore()
    const gacha = useGachaStore()
    const prob = useProbabilityStore()
    const { setItemSpy } = spyStorage()
    const record = monopoly.rollDice({ rng: () => 0, now: monday })
    expect(record?.bossPassed).toBe(true)
    expect(player.player.gachaTickets).toBe(1)
    expect(gacha.state.pityCounters[PERMANENT_POOL_ID]).toBe(3)
    expect(prob.state.outcomes.length).toBe(2)
    const keys = setItemSpy.mock.calls.map(c => c[0]).filter(k => [PROBABILITY_KEY, GACHA_KEY, LUCKY_WHEEL_KEY, MAIN_KEY, MONOPOLY_KEY].includes(k))
    expect(keys).toEqual([PROBABILITY_KEY, GACHA_KEY, MAIN_KEY, MONOPOLY_KEY])
    for (const key of [PROBABILITY_KEY, GACHA_KEY, MAIN_KEY, MONOPOLY_KEY]) {
      expect(setItemSpy.mock.calls.filter(c => c[0] === key).length).toBe(1) // 每 Store 仅一次
    }
  })
})

describe('Phase 3.67 — Probability batch 预算拒绝', () => {
  it('预算拒绝：三字段不变、零写盘、返回 null', () => {
    const monopoly = setBoard(rewardTile('gachaTicket', 'ticket_1', 1)) // EV 4 / FP 1
    const prob = useProbabilityStore()
    const base = new Date(monday)
    base.setHours(0, 0, 0, 0)
    const fmt = (d: Date) => `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}-${`${d.getDate()}`.padStart(2, '0')}`
    const dailyKey = `day:${fmt(base)}`
    const weekStart = new Date(base)
    const dow = weekStart.getDay() || 7
    weekStart.setDate(weekStart.getDate() - dow + 1)
    const weeklyKey = `week:${fmt(weekStart)}`
    prob.state.budgetUsage.monopoly = {
      periodKey: `${dailyKey}|${weeklyKey}`,
      dailyPeriodKey: dailyKey,
      weeklyPeriodKey: weeklyKey,
      expectedValue: 34, // 35 - 4 < 4 → 超预算
      legendaryRateBonus: 0,
      pityGain: 0,
      freePulls: 0,
      jackpots: 0
    }
    const prevOutcomes = [...prob.state.outcomes]
    const prevBudget = JSON.parse(JSON.stringify(prob.state.budgetUsage))
    const prevModifiers = [...prob.state.pendingModifiers]
    const { setItemSpy, removeSpy } = spyStorage()
    expect(monopoly.rollDice({ rng: () => 0, now: monday })).toBeNull()
    expect(prob.state.outcomes).toEqual(prevOutcomes)
    expect(prob.state.budgetUsage).toEqual(prevBudget)
    expect(prob.state.pendingModifiers).toEqual(prevModifiers)
    expect(setItemSpy).not.toHaveBeenCalled()
    expect(removeSpy).not.toHaveBeenCalled()
    expect(monopoly.state.diceRemaining).toBe(3)
  })
})

describe('Phase 3.67 — 失败注入与逆序补偿', () => {
  it('Probability 保存失败：内存回滚、其余不写、返回 null', () => {
    const monopoly = setBoard(rewardTile('gold', 'gold_1500', 1500))
    const player = usePlayerStore()
    const originalSetItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (key === PROBABILITY_KEY) throw new Error('prob disk full')
      return originalSetItem.call(this, key, value)
    })
    expect(monopoly.rollDice({ rng: () => 0, now: monday })).toBeNull()
    expect(player.player.gold).toBe(0) // 回滚
    expect(monopoly.state.diceRemaining).toBe(3)
    expect(monopoly.state.history.length).toBe(0)
    expect(useProbabilityStore().state.outcomes.length).toBe(0)
  })

  it('Gacha 保存失败（pity）：内存回滚、Probability raw 恢复', () => {
    const monopoly = setBoard(rewardTile('pity', 'pity_1', 1))
    const gacha = useGachaStore()
    const prevProbRaw = JSON.stringify({ outcomes: [], pendingModifiers: [], budgetUsage: {} })
    localStorage.setItem(PROBABILITY_KEY, prevProbRaw)
    const originalSetItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (key === GACHA_KEY) throw new Error('gacha disk full')
      return originalSetItem.call(this, key, value)
    })
    expect(monopoly.rollDice({ rng: () => 0, now: monday })).toBeNull()
    expect(gacha.state.pityCounters[PERMANENT_POOL_ID]).toBeUndefined()
    expect(monopoly.state.diceRemaining).toBe(3)
    expect(localStorage.getItem(PROBABILITY_KEY)).toBe(prevProbRaw) // Probability raw 恢复
  })

  it('LuckyWheel 保存失败（buildToken）：内存回滚、Probability raw 恢复', () => {
    const monopoly = setBoard(rewardTile('buildToken', 'token_speed', 1, 'speedSkill'))
    const lw = useLuckyWheelStore()
    const prevProbRaw = JSON.stringify({ outcomes: [], pendingModifiers: [], budgetUsage: {} })
    const prevLwRaw = JSON.stringify({ lastDailyFree: 0, buildTokens: {}, history: [] })
    localStorage.setItem(PROBABILITY_KEY, prevProbRaw)
    localStorage.setItem(LUCKY_WHEEL_KEY, prevLwRaw)
    const originalSetItem = Storage.prototype.setItem
    let lwWriteDone = false
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (key === LUCKY_WHEEL_KEY && !lwWriteDone) {
        lwWriteDone = true
        throw new Error('lw disk full') // 仅前向写入失败，补偿恢复放行
      }
      return originalSetItem.call(this, key, value)
    })
    expect(monopoly.rollDice({ rng: () => 0, now: monday })).toBeNull()
    expect(lw.state.buildTokens['speedSkill']).toBeUndefined()
    expect(monopoly.state.diceRemaining).toBe(3)
    expect(localStorage.getItem(PROBABILITY_KEY)).toBe(prevProbRaw)
    expect(localStorage.getItem(LUCKY_WHEEL_KEY)).toBe(prevLwRaw)
  })

  it('Player saveGame false：内存回滚、逆序补偿', () => {
    const monopoly = setBoard(rewardTile('gold', 'gold_1500', 1500))
    const player = usePlayerStore()
    const prob = useProbabilityStore()
    const prevProbRaw = JSON.stringify({ outcomes: [], pendingModifiers: [], budgetUsage: {} })
    localStorage.setItem(PROBABILITY_KEY, prevProbRaw)
    const { setItemSpy } = spyStorage()
    vi.spyOn(player, 'saveGame').mockReturnValue(false)
    expect(monopoly.rollDice({ rng: () => 0, now: monday })).toBeNull()
    expect(player.player.gold).toBe(0)
    expect(monopoly.state.diceRemaining).toBe(3)
    expect(prob.state.outcomes.length).toBe(0)
    expect(localStorage.getItem(PROBABILITY_KEY)).toBe(prevProbRaw)
    const keys = setItemSpy.mock.calls.map(c => c[0]).filter(k => [PROBABILITY_KEY, MAIN_KEY, MONOPOLY_KEY].includes(k))
    expect(keys).toEqual([PROBABILITY_KEY, PROBABILITY_KEY]) // 前向写 + 补偿恢复
  })

  it('最终 Monopoly 保存失败：前序奖励 raw 全部逆序恢复', () => {
    const monopoly = setBoard(rewardTile('gold', 'gold_1500', 1500))
    const player = usePlayerStore()
    const prob = useProbabilityStore()
    const prevProbRaw = JSON.stringify({ outcomes: [], pendingModifiers: [], budgetUsage: {} })
    localStorage.setItem(PROBABILITY_KEY, prevProbRaw)
    player.saveGame() // 播种默认主存档 raw
    const prevMainRaw = localStorage.getItem(MAIN_KEY)
    const keys: string[] = []
    const originalSetItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      keys.push(key)
      if (key === MONOPOLY_KEY) throw new Error('monopoly disk full')
      return originalSetItem.call(this, key, value)
    })
    expect(monopoly.rollDice({ rng: () => 0, now: monday })).toBeNull()
    expect(player.player.gold).toBe(0) // 内存回滚
    expect(monopoly.state.diceRemaining).toBe(3)
    expect(monopoly.state.history.length).toBe(0)
    expect(prob.state.outcomes.length).toBe(0)
    expect(localStorage.getItem(PROBABILITY_KEY)).toBe(prevProbRaw)
    expect(localStorage.getItem(MAIN_KEY)).toBe(prevMainRaw) // main raw 恢复
    // 前向 Probability → main；补偿逆序 main → Probability（Monopoly 前向写入已失败）
    expect(keys.filter(k => k !== MONOPOLY_KEY)).toEqual([PROBABILITY_KEY, MAIN_KEY, MAIN_KEY, PROBABILITY_KEY])
  })
})

describe('Phase 3.67 — 补偿自身失败与重载', () => {
  it('补偿自身失败仍继续其余恢复，最终抛固定错误', () => {
    const monopoly = setBoard(rewardTile('gold', 'gold_1500', 1500))
    const player = usePlayerStore()
    const prevProbRaw = JSON.stringify({ outcomes: [], pendingModifiers: [], budgetUsage: {} })
    localStorage.setItem(PROBABILITY_KEY, prevProbRaw)
    player.saveGame()
    let mainWriteDone = false
    let mainWrites = 0
    const originalSetItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (key === MONOPOLY_KEY && !mainWriteDone) {
        mainWriteDone = true
        throw new Error('monopoly disk full')
      }
      if (key === MAIN_KEY) {
        mainWrites += 1
        if (mainWrites === 2) throw new Error('main restore boom') // 补偿阶段第一个恢复失败
      }
      return originalSetItem.call(this, key, value)
    })
    let thrown: unknown
    try {
      monopoly.rollDice({ rng: () => 0, now: monday })
    } catch (e) {
      thrown = e
    }
    expect((thrown as Error).message).toBe('monopoly persistence rollback failed')
    expect(player.player.gold).toBe(0) // 内存保持回滚
    expect(monopoly.state.diceRemaining).toBe(3)
    expect(localStorage.getItem(PROBABILITY_KEY)).toBe(prevProbRaw) // 第二个恢复仍被尝试并成功
  })

  it('最终失败后重新构造 Store：骰子可用、奖励未到账、无 outcome', () => {
    const monopoly = setBoard(rewardTile('gold', 'gold_1500', 1500))
    const player = usePlayerStore()
    const prevProbRaw = JSON.stringify({ outcomes: [], pendingModifiers: [], budgetUsage: {} })
    localStorage.setItem(PROBABILITY_KEY, prevProbRaw)
    player.saveGame()
    const originalSetItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (key === MONOPOLY_KEY) throw new Error('monopoly disk full')
      return originalSetItem.call(this, key, value)
    })
    expect(monopoly.rollDice({ rng: () => 0, now: monday })).toBeNull()
    expect(player.player.gold).toBe(0)
    vi.restoreAllMocks() // 恢复 storage，避免 fresh Store 构造的 refresh() 写入失败
    // fresh Pinia 重载：读取恢复后的 raw
    setActivePinia(createPinia())
    localStorage.setItem(PROBABILITY_KEY, prevProbRaw)
    warmupStores()
    const freshMonopoly = useMonopolyStore()
    const freshPlayer = usePlayerStore()
    expect(freshMonopoly.state.diceRemaining).toBeGreaterThan(0) // 骰子可用
    expect(freshPlayer.player.gold).toBe(0) // 奖励未到账
    expect(useProbabilityStore().state.outcomes.length).toBe(0) // 无 outcome
  })

  it('成功后再次调用：只执行下一次合法 roll，不重复上一次结算', () => {
    const monopoly = useMonopolyStore()
    monopoly.state.weekId = localWeekId(monday)
    monopoly.state.board = [
      { id: 'start', index: 0, type: 'start', name: '起点' },
      rewardTile('gold', 'gold_1500', 1500),
      rewardTile('gold', 'gold_1500_2', 1500)
    ]
    monopoly.state.position = 0
    monopoly.state.diceRemaining = 3
    const player = usePlayerStore()
    const prob = useProbabilityStore()
    const first = monopoly.rollDice({ rng: () => 0, now: monday }) // → 位置 1（gold）
    expect(first?.rewardNames).toEqual(['gold_1500'])
    expect(monopoly.state.diceRemaining).toBe(2)
    const second = monopoly.rollDice({ rng: () => 0, now: monday }) // → 位置 2（gold）
    expect(second?.rewardNames).toEqual(['gold_1500_2'])
    expect(monopoly.state.diceRemaining).toBe(1)
    expect(monopoly.state.history.length).toBe(2)
    expect(player.player.gold).toBe(3000) // 两次独立结算各一次
    expect(prob.state.outcomes.length).toBe(2)
  })
})
