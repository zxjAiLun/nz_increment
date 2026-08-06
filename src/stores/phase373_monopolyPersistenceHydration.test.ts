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
import {
  MONOPOLY_BOARD_SIZE,
  DAILY_MONOPOLY_DICE
} from '../data/monopoly'

// getWeekId / generateWeeklyBoard 均为 store 内部实现，测试内联等价逻辑。
function getWeekId(timestamp: number): string {
  const date = new Date(timestamp)
  const day = date.getDay() || 7
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() - day + 1)
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const localDay = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${localDay}`
}

// canonical board 通过真实 store hydration 取得（store 内部 generateWeeklyBoard 重建）。
function canonicalBoardFor(week: string) {
  const store = hydrate(JSON.stringify({ weekId: week, history: [] }))
  return store.state.board
}

/**
 * Phase 3.73 — Monopoly 持久化 hydration 与启动刷新容错。
 *
 * - load() 将 nz_monopoly_v1 视为不可信输入：raw → parse → 逐字段 fail-closed 规范化 → 完整 candidate → 一次性提交；
 * - weekId 经 getWeekId 往返一致校验；position/diceRemaining/lastDiceRefresh 范围校验；
 * - board/boardAudits 始终按 generateWeeklyBoard(validatedWeekId) canonical 重建，忽略 raw（防伪造 tile/reward/boss/audit）；
 * - history 过滤 / 保序 / 上限 30，单条 move record 跨字段一致性校验 + canonical tile/奖励重建；不一致整条丢弃；
 * - refresh() 仅当周重置或每日骰子刷新真正改变状态时才写盘；启动刷新保存失败不阻断 Store 创建；
 * - 任何 getItem/parse/normalization 异常 → 默认 candidate、不抛错、零写盘，公开 action（rollDice）仍可运行。
 */

const MONOPOLY_KEY = 'nz_monopoly_v1'
const monday = Date.UTC(2026, 3, 20)
// 使用当前真实周：store 启动 refresh(startupTimestamp) 不会因周重置清空已加载 history。
const weekId = getWeekId(Date.now())
const canonical = canonicalBoardFor(weekId)

function warmNonMonopolyStores() {
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
  if (raw === null) localStorage.removeItem(MONOPOLY_KEY)
  else localStorage.setItem(MONOPOLY_KEY, raw)
}

function createStore() {
  setActivePinia(createPinia())
  return useMonopolyStore()
}

function hydrate(raw: string | null) {
  seedRaw(raw)
  return createStore()
}

function hydrateTracked(raw: string | null) {
  seedRaw(raw)
  setActivePinia(createPinia())
  warmNonMonopolyStores()
  const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
  const removeSpy = vi.spyOn(Storage.prototype, 'removeItem')
  const store = useMonopolyStore()
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

// 工具：构造一条与 canonical board 一致的合法 reward record。
function validRewardRecord(to: number, timestamp = 1785859200000): unknown {
  const tile = canonical[to]
  return {
    timestamp,
    weekId,
    from: (to - 1 + MONOPOLY_BOARD_SIZE) % MONOPOLY_BOARD_SIZE,
    roll: 1,
    to,
    tile,
    rewardNames: tile.reward ? [tile.reward.name] : [],
    playerPower: 100
  }
}

function validBossRecord(index: number, bossPassed: boolean, timestamp = 1785859200000): unknown {
  const tile = canonical[index]
  const boss = tile.boss!
  return {
    timestamp,
    weekId,
    from: (index - 2 + MONOPOLY_BOARD_SIZE) % MONOPOLY_BOARD_SIZE,
    roll: 2,
    to: index,
    tile,
    rewardNames: bossPassed ? boss.rewards.map(r => r.name) : [],
    bossPassed,
    requiredPower: boss.requiredPower,
    playerPower: 200
  }
}

describe('Phase 3.73 — Monopoly hydration fail-closed', () => {
  it('key 缺失 → 默认 candidate 不抛错', () => {
    const store = hydrate(null)
    expect(store.state.weekId).toBe(getWeekId(Date.now()))
    expect(store.state.board.length).toBe(MONOPOLY_BOARD_SIZE)
    expect(store.state.history).toEqual([])
  })

  it('getItem 抛错 → 默认 candidate，store 创建成功', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage broken')
    })
    const store = createStore()
    expect(store.state.board.length).toBe(MONOPOLY_BOARD_SIZE)
    expect(store.state.history).toEqual([])
  })

  it('malformed JSON → 默认 candidate', () => {
    const store = hydrate('{not valid json')
    expect(store.state.board.length).toBe(MONOPOLY_BOARD_SIZE)
    expect(store.state.history).toEqual([])
  })

  it('root 非纯对象（数组）→ 默认 candidate', () => {
    const store = hydrate('[1,2,3]')
    expect(store.state.weekId).toBe(getWeekId(Date.now()))
    expect(store.state.history).toEqual([])
  })

  it('非法 weekId → 回退到启动周 canonical board', () => {
    const store = hydrate(JSON.stringify({ weekId: '2099-13-45', position: 0 }))
    expect(store.state.weekId).toBe(getWeekId(Date.now()))
    expect(store.state.board.length).toBe(MONOPOLY_BOARD_SIZE)
  })

  it('合法 weekId → 接受并重建对应 canonical board', () => {
    const store = hydrate(JSON.stringify({ weekId, position: 0 }))
    expect(store.state.weekId).toBe(weekId)
    expect(store.state.board.length).toBe(MONOPOLY_BOARD_SIZE)
  })

  it('position 越界 → 回退 0', () => {
    const store = hydrate(JSON.stringify({ weekId, position: 999 }))
    expect(store.state.position).toBe(0)
  })

  it('position 负数 → 回退 0', () => {
    const store = hydrate(JSON.stringify({ weekId, position: -3 }))
    expect(store.state.position).toBe(0)
  })

  it('diceRemaining 越界 → 回退 DAILY', () => {
    const store = hydrate(JSON.stringify({ weekId, diceRemaining: 99 }))
    expect(store.state.diceRemaining).toBe(DAILY_MONOPOLY_DICE)
  })

  it('lastDiceRefresh 负数 → 回退合法非负安全整数（启动刷新后归为今日）', () => {
    const store = hydrate(JSON.stringify({ weekId, lastDiceRefresh: -5 }))
    // 非法值被规范化丢弃；启动 refresh 因 stale 触发每日骰子恢复，置为今日 dateKey。
    expect(Number.isSafeInteger(store.state.lastDiceRefresh)).toBe(true)
    expect(store.state.lastDiceRefresh).toBeGreaterThanOrEqual(0)
    expect(store.state.diceRemaining).toBe(DAILY_MONOPOLY_DICE)
  })

  it('raw board 为 null/对象/伪造数组 → 一律忽略，用 canonical board', () => {
    const forged = [{ id: 'evil', index: 0, type: 'reward', name: 'x', reward: { id: 'gold_1500', rarity: 'common', name: '金币补给', description: '', type: 'gold', value: 999999 } }]
    const store = hydrate(JSON.stringify({ weekId, board: null, boardAudits: {}, history: [] }))
    expect(store.state.board.length).toBe(MONOPOLY_BOARD_SIZE)
    expect(store.state.board[0].id).toBe('start')

    const store2 = hydrate(JSON.stringify({ weekId, board: { length: 1 }, history: [] }))
    expect(store2.state.board.length).toBe(MONOPOLY_BOARD_SIZE)

    const store3 = hydrate(JSON.stringify({ weekId, board: forged, history: [] }))
    expect(store3.state.board.length).toBe(MONOPOLY_BOARD_SIZE)
    expect(store3.state.board[0].id).toBe('start')
  })

  it('raw board 伪造 boss 永不进入状态（canonical 重建）', () => {
    const forgedBoss = {
      weekId,
      board: [{ id: 'start', index: 0, type: 'start', name: '起点' }, { id: 'boss_1', index: 1, type: 'boss', name: 'Boss格', boss: { name: 'Hacked', requiredPower: 1, rewards: [] } }],
      boardAudits: {},
      history: []
    }
    const store = hydrate(JSON.stringify(forgedBoss))
    const index1 = store.state.board[1]
    expect(index1.type).toBe('reward') // canonical 重建为合法 reward 格
    expect(index1.boss).toBeUndefined()
  })

  it('raw boardAudits 为 null/对象/恶意 → 一律忽略，用 canonical audits', () => {
    const maliciousAudits = { 1: { normalizedRates: { common: 'bad' } } }
    const store = hydrate(JSON.stringify({ weekId, boardAudits: null, history: [] }))
    expect(Object.keys(store.state.boardAudits).length).toBeGreaterThan(0)

    const store2 = hydrate(JSON.stringify({ weekId, boardAudits: { 1: 'x' }, history: [] }))
    expect(store2.state.boardAudits[3]).toBeDefined()

    const store3 = hydrate(JSON.stringify({ weekId, boardAudits: maliciousAudits, history: [] }))
    expect(store3.state.boardAudits[3]).toBeDefined()
  })

  it('canonical board 长度 / 索引 / boss 位置正确', () => {
    const store = hydrate(null)
    expect(store.state.board.length).toBe(MONOPOLY_BOARD_SIZE)
    expect(store.state.board[0].type).toBe('start')
    expect(store.state.board[7].type).toBe('boss')
    expect(store.state.board[15].type).toBe('boss')
    expect(store.state.board[7].boss!.requiredPower).toBe(900)
    expect(store.state.board[15].boss!.requiredPower).toBe(1800)
  })

  it('history 非数组 → 默认 []', () => {
    const store = hydrate(JSON.stringify({ weekId, history: {} }))
    expect(store.state.history).toEqual([])
  })

  it('history 含 null / 原始值 → 过滤掉', () => {
    const store = hydrate(JSON.stringify({ weekId, history: [null, 'junk', 42] }))
    expect(store.state.history).toEqual([])
  })

  it('合法 reward record 保留且 canonical tile 重建', () => {
    const rec = validRewardRecord(3)
    const store = hydrate(JSON.stringify({ weekId, history: [rec] }))
    expect(store.state.history.length).toBe(1)
    expect(store.state.history[0].tile.id).toBe(canonical[3].id)
    if (canonical[3].reward) {
      expect(store.state.history[0].rewardNames).toEqual([canonical[3].reward.name])
    }
  })

  it('history record 字段非法 → 丢弃', () => {
    const rec = validRewardRecord(3)
    const bad = { ...(rec as Record<string, unknown>), timestamp: -1 }
    const store = hydrate(JSON.stringify({ weekId, history: [bad, rec] }))
    expect(store.state.history.length).toBe(1)
    expect(store.state.history[0].tile.index).toBe(3)
  })

  it('to !== (from+roll)%size → 丢弃', () => {
    const rec = validRewardRecord(3) as Record<string, unknown>
    rec.from = 0
    rec.roll = 1
    rec.to = 5 // 1 != 5
    const store = hydrate(JSON.stringify({ weekId, history: [rec] }))
    expect(store.state.history).toEqual([])
  })

  it('raw tile 缺失/primitive → 整条丢弃（不再接管）', () => {
    const rec = validRewardRecord(3) as Record<string, unknown>
    rec.tile = null
    const store = hydrate(JSON.stringify({ weekId, history: [rec] }))
    expect(store.state.history).toEqual([])
  })

  it('rewardNames 与 canonical tile 不一致 → 丢弃', () => {
    const rec = validRewardRecord(3) as Record<string, unknown>
    rec.rewardNames = ['错的名字']
    const store = hydrate(JSON.stringify({ weekId, history: [rec] }))
    expect(store.state.history).toEqual([])
  })

  it('合法 boss-win / boss-fail record 保留；字段非法丢弃', () => {
    const win = validBossRecord(7, true)
    const fail = validBossRecord(15, false)
    const bad = validBossRecord(7, true) as Record<string, unknown>
    bad.requiredPower = 12345 // 与 canonical 不符
    const store = hydrate(JSON.stringify({ weekId, history: [win, fail, bad] }))
    expect(store.state.history.length).toBe(2)
    expect(store.state.history[0].bossPassed).toBe(true)
    expect(store.state.history[1].bossPassed).toBe(false)
    expect(store.state.history[1].rewardNames).toEqual([])
  })

  it('history 超过 30 条 → 仅保留前 30 且保序', () => {
    const records: unknown[] = []
    for (let i = 0; i < 35; i++) records.push(validRewardRecord(3, 1785859200000 + i))
    const store = hydrate(JSON.stringify({ weekId, history: records }))
    expect(store.state.history.length).toBe(30)
    expect(store.state.history[0].timestamp).toBe(1785859200000)
  })

  it('no-change 启动刷新零写盘（key 缺失默认状态即当前周当天）', () => {
    const { store, setItemSpy } = hydrateTracked(null)
    void store
    const monopolyWrites = setItemSpy.mock.calls.filter(c => c[0] === MONOPOLY_KEY)
    expect(monopolyWrites.length).toBe(0)
  })

  it('启动刷新保存失败不阻断 store 创建，内存刷新保留，raw 不变', () => {
    const realRaw = JSON.stringify({ weekId, position: 3, diceRemaining: 0, lastDiceRefresh: 0, history: [] })
    seedRaw(realRaw)
    setActivePinia(createPinia())
    warmNonMonopolyStores()
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key: string) => {
      if (key === MONOPOLY_KEY) throw new Error('write blocked')
      localStorage.setItem(key, localStorage.getItem(key) ?? '')
    })
    const store = useMonopolyStore()
    expect(store).toBeDefined()
    expect(store.state.board.length).toBe(MONOPOLY_BOARD_SIZE)
    // raw 未被补偿删除/改写
    expect(localStorage.getItem(MONOPOLY_KEY)).toBe(realRaw)
    setItemSpy.mockRestore()
  })

  it('损坏 raw 下 rollDice 仍成功（事务不依赖未可信 raw）', () => {
    const store = hydrate('{broken')
    const result = store.rollDice({ rng: () => 0, now: monday })
    expect(result).not.toBeNull()
    expect(store.state.position).toBe(1)
  })

  it('消费者安全：history[0].tile.type 始终存在', () => {
    const rec = validRewardRecord(4)
    const store = hydrate(JSON.stringify({ weekId, history: [rec] }))
    const latest = store.state.history[0]
    expect(latest).not.toBeNull()
    expect(typeof latest.tile.type).toBe('string')
  })
})

describe('Phase 3.73 Repair 1 — 启动时钟容错', () => {
  it('Date.now() 抛错：Store 创建不抛', () => {
    vi.spyOn(Date, 'now').mockImplementation(() => { throw new Error('clock broken') })
    const store = createStore()
    expect(store).toBeDefined()
    expect(store.state.board.length).toBe(MONOPOLY_BOARD_SIZE)
  })

  it('时间源抛错时 getItem/setItem/removeItem 均零调用', () => {
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem')
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    const removeSpy = vi.spyOn(Storage.prototype, 'removeItem')
    vi.spyOn(Date, 'now').mockImplementation(() => { throw new Error('clock broken') })
    createStore()
    expect(getItemSpy).not.toHaveBeenCalled()
    expect(setItemSpy).not.toHaveBeenCalled()
    expect(removeSpy).not.toHaveBeenCalled()
  })

  const illegalValues: Array<[string, number]> = [
    ['0', 0],
    ['负数', -1],
    ['小数', 1.5],
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['超安全整数', Number.MAX_SAFE_INTEGER + 1]
  ]

  it.each(illegalValues)('Date.now 返回 %s → 安全 fallback weekId / 20 格 board / 可消费 audits', (_label, value) => {
    vi.spyOn(Date, 'now').mockReturnValue(value)
    const store = createStore()
    expect(typeof store.state.weekId).toBe('string')
    expect(store.state.weekId.length).toBeGreaterThan(0)
    expect(store.state.board.length).toBe(MONOPOLY_BOARD_SIZE)
    expect(Object.keys(store.state.boardAudits).length).toBeGreaterThan(0)
  })

  it('合法启动路径 Date.now() 恰好调用一次', () => {
    const spy = vi.spyOn(Date, 'now')
    createStore()
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('非法启动时间后，公开 rollDice({ now, rng }) 使用显式合法 now 仍可成功', () => {
    vi.spyOn(Date, 'now').mockReturnValue(0)
    const store = createStore()
    expect(store.state.board.length).toBe(MONOPOLY_BOARD_SIZE)
    vi.restoreAllMocks() // 恢复真实时钟，避免 rollDice 内部依赖 store 受影响
    const result = store.rollDice({ rng: () => 0, now: monday })
    expect(result).not.toBeNull()
    expect(store.state.position).toBe(1)
  })
})

describe('Phase 3.73 Repair 1 — history 字段收紧', () => {
  it('history 缺失 playerPower → 丢弃', () => {
    const rec = validRewardRecord(3) as Record<string, unknown>
    delete rec.playerPower
    const store = hydrate(JSON.stringify({ weekId, history: [rec] }))
    expect(store.state.history).toEqual([])
  })

  it('history 的 playerPower 非法（负数/字符串/小数）→ 丢弃', () => {
    const neg = validRewardRecord(3) as Record<string, unknown>
    neg.playerPower = -5
    const str = validRewardRecord(3) as Record<string, unknown>
    str.playerPower = 'x'
    const frac = validRewardRecord(3) as Record<string, unknown>
    frac.playerPower = 1.5
    const store = hydrate(JSON.stringify({ weekId, history: [neg, str, frac] }))
    expect(store.state.history).toEqual([])
  })

  it('raw tile 缺失 / primitive / 未知 id / 与 to 不一致 → 丢弃', () => {
    const missing = validRewardRecord(3) as Record<string, unknown>
    missing.tile = null
    const primitive = validRewardRecord(3) as Record<string, unknown>
    primitive.tile = 5
    const unknownId = validRewardRecord(3) as Record<string, unknown>
    unknownId.tile = { id: 'unknown_tile' }
    const mismatch = validRewardRecord(3) as Record<string, unknown>
    mismatch.tile = { id: canonical[5].id } // to=3 但 id 属 index 5
    const store = hydrate(JSON.stringify({ weekId, history: [missing, primitive, unknownId, mismatch] }))
    expect(store.state.history).toEqual([])
  })

  it('合法 raw tile 最终被 canonical tile 替换（不保留 raw 字段）', () => {
    const forged = validRewardRecord(3) as Record<string, unknown>
    forged.tile = { id: canonical[3].id, type: 'reward', name: 'HACKED', reward: { id: 'gold_1500', rarity: 'common', name: 'HACKED', description: '', type: 'gold', value: 999999 } }
    const store = hydrate(JSON.stringify({ weekId, history: [forged] }))
    expect(store.state.history.length).toBe(1)
    expect(store.state.history[0].tile.id).toBe(canonical[3].id)
    expect(store.state.history[0].tile.name).toBe(canonical[3].reward!.name)
    expect(store.state.history[0].tile.name).not.toBe('HACKED')
  })

  it('非 Boss raw 注入字符串 bossPassed/requiredPower → normalized record 不含这两个字段', () => {
    const rec = validRewardRecord(3) as Record<string, unknown>
    rec.bossPassed = 'yes'
    rec.requiredPower = 'forged'
    const store = hydrate(JSON.stringify({ weekId, history: [rec] }))
    expect(store.state.history.length).toBe(1)
    const record = store.state.history[0]
    expect('bossPassed' in record).toBe(false)
    expect('requiredPower' in record).toBe(false)
    expect(record.playerPower).toBe(100)
  })

  it('Boss 合法记录仍保留正确的 bossPassed/requiredPower', () => {
    const win = validBossRecord(7, true)
    const fail = validBossRecord(15, false)
    const store = hydrate(JSON.stringify({ weekId, history: [win, fail] }))
    expect(store.state.history.length).toBe(2)
    expect(store.state.history[0].bossPassed).toBe(true)
    expect(store.state.history[0].requiredPower).toBe(canonical[7].boss!.requiredPower)
    expect(store.state.history[1].bossPassed).toBe(false)
    expect(store.state.history[1].requiredPower).toBe(canonical[15].boss!.requiredPower)
  })
})

describe('Phase 3.73 — Monopoly 条件刷新写盘', () => {
  it('周重置触发单次写盘', () => {
    const store = createStore()
    const spy = vi.spyOn(Storage.prototype, 'setItem')
    store.refresh(monday)
    const writes = spy.mock.calls.filter(c => c[0] === MONOPOLY_KEY)
    expect(writes.length).toBe(1)
    expect(store.state.weekId).toBe(getWeekId(monday))
  })

  it('同日同周刷新零写盘', () => {
    const store = createStore()
    store.refresh(monday)
    const spy = vi.spyOn(Storage.prototype, 'setItem')
    store.refresh(monday + 1000)
    const writes = spy.mock.calls.filter(c => c[0] === MONOPOLY_KEY)
    expect(writes.length).toBe(0)
  })

  it('跨天（同周）刷新仅恢复骰子并写盘一次', () => {
    const store = createStore()
    store.refresh(monday)
    store.state.diceRemaining = 0
    store.state.lastDiceRefresh = 0
    const spy = vi.spyOn(Storage.prototype, 'setItem')
    store.refresh(monday + 24 * 60 * 60 * 1000)
    const writes = spy.mock.calls.filter(c => c[0] === MONOPOLY_KEY)
    expect(writes.length).toBe(1)
    expect(store.state.diceRemaining).toBe(DAILY_MONOPOLY_DICE)
  })
})
