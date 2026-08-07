import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { usePlayerStore } from './playerStore'
import * as monsterStoreModule from './monsterStore'

const SAVE_KEY = 'lollipop_adventure_save'
const MONTHLY_CARD_KEY = 'nz_monthly_card_v1'
const DAY = 24 * 60 * 60 * 1000
const MONTHLY_CARD_DURATION = 30 * DAY
const NOW = 1_700_000_000_000

// 真实 setItem 引用（绕过 spy，避免递归调用 spy 自身）。
const ORIG_SETITEM = Storage.prototype.setItem
function origSetItem(k: string, v: string): void {
  ORIG_SETITEM.call(localStorage, k, v)
}

// 设置一张有效月卡：purchasedAt 在过去 10 天，lastClaimAt 给定。
function armCard(
  ps: ReturnType<typeof usePlayerStore>,
  purchasedAt: number,
  lastClaimAt: number,
) {
  ps.monthlyCard = { purchasedAt, lastClaimAt }
}

// 预先写入一份 Player main 存档（diamond 由调用方决定）。
function seedMain(ps: ReturnType<typeof usePlayerStore>, diamond: number) {
  ps.player.diamond = diamond
  ps.saveGame(NOW - DAY)
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('Phase 3.75 Monthly Card 每日领取补偿事务', () => {
  it('无月卡 → null / 零写盘', () => {
    const ps = usePlayerStore()
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    const result = ps.claimMonthlyCardReward({ now: NOW })
    expect(result).toBeNull()
    expect(setItemSpy).not.toHaveBeenCalled()
    expect(ps.player.diamond).toBe(0)
  })

  it('explicit valid now 不调用 Date.now（使用传入 now 作为事务时间戳）', () => {
    const ps = usePlayerStore()
    ps.player.diamond = 0
    armCard(ps, NOW - 10 * DAY, 0)
    // 若 Date.now 被误用作时间戳，则 lastClaimAt / checkpoint 会变成该哨兵值。
    vi.spyOn(Date, 'now').mockReturnValue(999)
    const result = ps.claimMonthlyCardReward({ now: NOW })
    expect(result).toEqual({ gold: 0, diamond: 100 })
    expect(ps.monthlyCard!.lastClaimAt).toBe(NOW)
    expect(ps.lastOfflineCheckpointAt).toBe(NOW)
  })

  it('default Date.now 恰一次', () => {
    const ps = usePlayerStore()
    armCard(ps, NOW - 10 * DAY, 0)
    const dateNowSpy = vi.spyOn(Date, 'now')
    const before = dateNowSpy.mock.calls.length
    ps.claimMonthlyCardReward()
    expect(dateNowSpy.mock.calls.length - before).toBe(1)
  })

  it('Date.now 抛错 → null / 零写盘', () => {
    const ps = usePlayerStore()
    armCard(ps, NOW - 10 * DAY, 0)
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    vi.spyOn(Date, 'now').mockImplementation(() => { throw new Error('clock broken') })
    const result = ps.claimMonthlyCardReward()
    expect(result).toBeNull()
    expect(setItemSpy).not.toHaveBeenCalled()
  })

  it('invalid now：0 / -1 / 小数 / NaN / Infinity / >MAX_SAFE 均 → null', () => {
    const ps = usePlayerStore()
    armCard(ps, NOW - 10 * DAY, 0)
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    for (const bad of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      const r = ps.claimMonthlyCardReward({ now: bad as number })
      expect(r).toBeNull()
    }
    expect(setItemSpy).not.toHaveBeenCalled()
    expect(ps.player.diamond).toBe(0)
  })

  it('已过期 → null / 零写盘', () => {
    const ps = usePlayerStore()
    armCard(ps, NOW - MONTHLY_CARD_DURATION - 1, 0)
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    const result = ps.claimMonthlyCardReward({ now: NOW })
    expect(result).toBeNull()
    expect(setItemSpy).not.toHaveBeenCalled()
  })

  it('今日已领取 → null / 零写盘', () => {
    const ps = usePlayerStore()
    armCard(ps, NOW - 10 * DAY, NOW) // 同一自然日
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    const result = ps.claimMonthlyCardReward({ now: NOW })
    expect(result).toBeNull()
    expect(setItemSpy).not.toHaveBeenCalled()
    expect(ps.player.diamond).toBe(0)
  })

  it('malformed purchasedAt / lastClaimAt 安全拒绝', () => {
    const ps = usePlayerStore()
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    // purchasedAt 损坏
    ps.monthlyCard = { purchasedAt: NaN as unknown as number, lastClaimAt: 0 }
    expect(ps.claimMonthlyCardReward({ now: NOW })).toBeNull()
    // lastClaimAt 损坏
    ps.monthlyCard = { purchasedAt: NOW - 10 * DAY, lastClaimAt: 'x' as unknown as number }
    expect(ps.claimMonthlyCardReward({ now: NOW })).toBeNull()
    expect(setItemSpy).not.toHaveBeenCalled()
  })

  it('成功：diamond 恰好 +100', () => {
    const ps = usePlayerStore()
    ps.player.diamond = 0
    armCard(ps, NOW - 10 * DAY, 0)
    const result = ps.claimMonthlyCardReward({ now: NOW })
    expect(result).toEqual({ gold: 0, diamond: 100 })
    expect(ps.player.diamond).toBe(100)
  })

  it('成功：main checkpoint 使用同一 transactionTimestamp', () => {
    const ps = usePlayerStore()
    ps.player.diamond = 0
    armCard(ps, NOW - 10 * DAY, 0)
    ps.claimMonthlyCardReward({ now: NOW })
    expect(ps.lastOfflineCheckpointAt).toBe(NOW)
  })

  it('成功：写序 Main → Monthly', () => {
    const ps = usePlayerStore()
    ps.player.diamond = 0
    armCard(ps, NOW - 10 * DAY, 0)
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    ps.claimMonthlyCardReward({ now: NOW })
    const mainOrder = setItemSpy.mock.invocationCallOrder[
      setItemSpy.mock.calls.findIndex(c => c[0] === SAVE_KEY)
    ]
    const monthlyOrder = setItemSpy.mock.invocationCallOrder[
      setItemSpy.mock.calls.findIndex(c => c[0] === MONTHLY_CARD_KEY)
    ]
    expect(mainOrder).toBeLessThan(monthlyOrder)
  })

  it('成功：两 key 各至多写一次', () => {
    const ps = usePlayerStore()
    ps.player.diamond = 0
    armCard(ps, NOW - 10 * DAY, 0)
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    ps.claimMonthlyCardReward({ now: NOW })
    const mainWrites = setItemSpy.mock.calls.filter(c => c[0] === SAVE_KEY).length
    const monthlyWrites = setItemSpy.mock.calls.filter(c => c[0] === MONTHLY_CARD_KEY).length
    expect(mainWrites).toBe(1)
    expect(monthlyWrites).toBe(1)
  })

  it('同一天第二次调用：零奖励、零写盘', () => {
    const ps = usePlayerStore()
    ps.player.diamond = 0
    armCard(ps, NOW - 10 * DAY, 0)
    expect(ps.claimMonthlyCardReward({ now: NOW })).toEqual({ gold: 0, diamond: 100 })
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    const second = ps.claimMonthlyCardReward({ now: NOW + 1000 }) // 仍同一自然日
    expect(second).toBeNull()
    expect(ps.player.diamond).toBe(100)
    expect(setItemSpy).not.toHaveBeenCalled()
  })

  it('Main raw getItem 抛错 → null / 零 mutation / 零写盘', () => {
    const ps = usePlayerStore()
    ps.player.diamond = 0
    armCard(ps, NOW - 10 * DAY, 0)
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    const removeSpy = vi.spyOn(Storage.prototype, 'removeItem')
    const orig = Storage.prototype.getItem
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation((k: string) => {
      if (k === SAVE_KEY) throw new Error('boom')
      return orig.call(localStorage, k)
    })
    const result = ps.claimMonthlyCardReward({ now: NOW })
    expect(result).toBeNull()
    expect(ps.player.diamond).toBe(0)
    expect(ps.monthlyCard!.lastClaimAt).toBe(0)
    expect(setItemSpy).not.toHaveBeenCalled()
    expect(removeSpy).not.toHaveBeenCalled()
  })

  it('Monthly raw getItem 抛错 → null / 零 mutation / 零写盘', () => {
    const ps = usePlayerStore()
    ps.player.diamond = 0
    armCard(ps, NOW - 10 * DAY, 0)
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    const removeSpy = vi.spyOn(Storage.prototype, 'removeItem')
    const orig = Storage.prototype.getItem
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation((k: string) => {
      if (k === MONTHLY_CARD_KEY) throw new Error('boom')
      return orig.call(localStorage, k)
    })
    const result = ps.claimMonthlyCardReward({ now: NOW })
    expect(result).toBeNull()
    expect(ps.player.diamond).toBe(0)
    expect(ps.monthlyCard!.lastClaimAt).toBe(0)
    expect(setItemSpy).not.toHaveBeenCalled()
    expect(removeSpy).not.toHaveBeenCalled()
  })

  it('两种 getItem failure 均发生在 candidate 之前', () => {
    const ps = usePlayerStore()
    ps.player.diamond = 0
    armCard(ps, NOW - 10 * DAY, 0)
    const diamondSpy = vi.spyOn(ps, 'applyDiamondRewardInMemory')
    const orig = Storage.prototype.getItem
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation((k: string) => {
      if (k === SAVE_KEY) throw new Error('boom')
      return orig.call(localStorage, k)
    })
    ps.claimMonthlyCardReward({ now: NOW })
    expect(diamondSpy).not.toHaveBeenCalled()
  })

  it('saveGame 返回 false（Main 写盘失败）→ null / 精确恢复内存', () => {
    const ps = usePlayerStore()
    ps.player.diamond = 0
    armCard(ps, NOW - 10 * DAY, 0)
    // saveGame 内部 setItem(SAVE_KEY) 抛错 → 返回 false。
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k: string) => {
      if (k === SAVE_KEY) throw new Error('main write broken')
      return origSetItem(k, localStorage.getItem(k) ?? '')
    })
    const result = ps.claimMonthlyCardReward({ now: NOW })
    expect(result).toBeNull()
    expect(ps.player.diamond).toBe(0)
    expect(ps.monthlyCard!.lastClaimAt).toBe(0)
    expect(ps.lastOfflineCheckpointAt).not.toBe(NOW)
  })

  it('saveGame 失败时 Monthly 不被写入', () => {
    const ps = usePlayerStore()
    ps.player.diamond = 0
    armCard(ps, NOW - 10 * DAY, 0)
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k: string) => {
      if (k === SAVE_KEY) throw new Error('main write broken')
      return origSetItem(k, localStorage.getItem(k) ?? '')
    })
    expect(ps.claimMonthlyCardReward({ now: NOW })).toBeNull()
    const monthlyWrites = setItemSpy.mock.calls.filter(c => c[0] === MONTHLY_CARD_KEY).length
    expect(monthlyWrites).toBe(0)
  })

  it('Monthly setItem 抛错 → null / 精确恢复内存', () => {
    const ps = usePlayerStore()
    ps.player.diamond = 0
    seedMain(ps, 0)
    armCard(ps, NOW - 10 * DAY, 0)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k: string) => {
      if (k === MONTHLY_CARD_KEY) throw new Error('monthly write broken')
      return origSetItem(k, localStorage.getItem(k) ?? '')
    })
    const result = ps.claimMonthlyCardReward({ now: NOW })
    expect(result).toBeNull()
    expect(ps.player.diamond).toBe(0)
    expect(ps.monthlyCard!.lastClaimAt).toBe(0)
    expect(ps.lastOfflineCheckpointAt).toBe(NOW - DAY)
  })

  it('Monthly 失败 → 恢复已写 Main raw', () => {
    const ps = usePlayerStore()
    ps.player.diamond = 0
    seedMain(ps, 0)
    armCard(ps, NOW - 10 * DAY, 0)
    const mainPrev = localStorage.getItem(SAVE_KEY)!
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k: string) => {
      if (k === MONTHLY_CARD_KEY) throw new Error('monthly write broken')
      return origSetItem(k, localStorage.getItem(k) ?? '')
    })
    ps.claimMonthlyCardReward({ now: NOW })
    // SAVE_KEY 必须被补偿回 mainPrev（撤销 diamond+100 的写盘）
    expect(localStorage.getItem(SAVE_KEY)).toBe(mainPrev)
  })

  it('previous Main raw == null → compensation 走 removeItem', () => {
    const ps = usePlayerStore()
    ps.player.diamond = 0
    armCard(ps, NOW - 10 * DAY, 0)
    // 此时尚无 SAVE_KEY（mainPrev === null）
    const removeSpy = vi.spyOn(Storage.prototype, 'removeItem')
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k: string) => {
      if (k === MONTHLY_CARD_KEY) throw new Error('monthly write broken')
      return origSetItem(k, localStorage.getItem(k) ?? '')
    })
    ps.claimMonthlyCardReward({ now: NOW })
    const removeCall = removeSpy.mock.calls.find(c => c[0] === SAVE_KEY)
    expect(removeCall).toBeDefined()
  })

  it('compensation 中 setItem/removeItem 失败仍继续并抛固定错误', () => {
    const ps = usePlayerStore()
    ps.player.diamond = 0
    armCard(ps, NOW - 10 * DAY, 0)
    // mainPrev === null → compensation 调 removeItem(SAVE_KEY)；令其抛错。
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('compensation broken')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k: string) => {
      if (k === MONTHLY_CARD_KEY) throw new Error('monthly write broken')
      return origSetItem(k, localStorage.getItem(k) ?? '')
    })
    expect(() => ps.claimMonthlyCardReward({ now: NOW }))
      .toThrow('monthly card claim persistence rollback failed')
    // 内存已在补偿前回滚
    expect(ps.player.diamond).toBe(0)
    expect(ps.monthlyCard!.lastClaimAt).toBe(0)
  })

  it('所有普通失败精确恢复 diamond / lastClaimAt / checkpoint', () => {
    const ps = usePlayerStore()
    ps.player.diamond = 500
    seedMain(ps, 500)
    armCard(ps, NOW - 10 * DAY, NOW - 3 * DAY)
    // saveGame false 路径（Main 写盘失败 → 返回 false）
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k: string) => {
      if (k === SAVE_KEY) throw new Error('main write broken')
      return origSetItem(k, localStorage.getItem(k) ?? '')
    })
    const result = ps.claimMonthlyCardReward({ now: NOW })
    expect(result).toBeNull()
    expect(ps.player.diamond).toBe(500)
    expect(ps.monthlyCard!.lastClaimAt).toBe(NOW - 3 * DAY)
    expect(ps.lastOfflineCheckpointAt).toBe(NOW - DAY)
  })

  it('fresh success：重载后同时看到 diamond+100 与今日已领取', () => {
    const ps = usePlayerStore()
    ps.player.diamond = 0
    armCard(ps, NOW - 10 * DAY, 0)
    const result = ps.claimMonthlyCardReward({ now: NOW })
    expect(result).toEqual({ gold: 0, diamond: 100 })

    setActivePinia(createPinia())
    const ps2 = usePlayerStore()
    ps2.loadGame()
    const mcRaw = localStorage.getItem(MONTHLY_CARD_KEY)
    ps2.monthlyCard = mcRaw ? JSON.parse(mcRaw) : null
    expect(ps2.player.diamond).toBe(100)
    expect(ps2.monthlyCard!.lastClaimAt).toBe(NOW)
  })

  it('fresh failure：重载后奖励未落盘', () => {
    const ps = usePlayerStore()
    ps.player.diamond = 0
    armCard(ps, NOW - 10 * DAY, 0)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k: string) => {
      if (k === MONTHLY_CARD_KEY) throw new Error('monthly write broken')
      return origSetItem(k, localStorage.getItem(k) ?? '')
    })
    ps.claimMonthlyCardReward({ now: NOW })

    setActivePinia(createPinia())
    const ps2 = usePlayerStore()
    ps2.loadGame()
    const mcRaw = localStorage.getItem(MONTHLY_CARD_KEY)
    ps2.monthlyCard = mcRaw ? JSON.parse(mcRaw) : null
    expect(ps2.player.diamond).toBe(0)
    // 领取失败：月卡从未落盘，重载后无月卡。
    expect(ps2.monthlyCard).toBeNull()
  })

  it('failure → retry success：最终恰好一份 100 diamond（不重复发）', () => {
    const ps = usePlayerStore()
    ps.player.diamond = 0
    armCard(ps, NOW - 10 * DAY, 0)

    // 第一次：Monthly 写盘失败 → 回滚，diamond 仍为 0
    const failingSet = vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k: string) => {
      if (k === MONTHLY_CARD_KEY) throw new Error('monthly write broken')
      return origSetItem(k, localStorage.getItem(k) ?? '')
    })
    expect(ps.claimMonthlyCardReward({ now: NOW })).toBeNull()
    expect(ps.player.diamond).toBe(0)

    // 恢复 setItem，第二次成功 → 恰好 +100
    failingSet.mockRestore()
    const second = ps.claimMonthlyCardReward({ now: NOW })
    expect(second).toEqual({ gold: 0, diamond: 100 })
    expect(ps.player.diamond).toBe(100)
  })

  it('Repair 1 回归：saveGame 直接抛异常 → null / 精确恢复内存 / Monthly 零写盘', () => {
    const ps = usePlayerStore()
    ps.player.diamond = 500
    seedMain(ps, 500)
    armCard(ps, NOW - 10 * DAY, NOW - 3 * DAY)
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    const removeSpy = vi.spyOn(Storage.prototype, 'removeItem')
    // saveGame 在其 try 之前调用 useMonsterStore()；令其抛异常，模拟 saveGame 抛错
    // （非返回 false）。事务必须捕获并回滚，不得传播异常（P1 修复点）。
    const monsterSpy = vi.spyOn(monsterStoreModule, 'useMonsterStore').mockImplementation(() => {
      throw new Error('injected saveGame failure')
    })
    const result = ps.claimMonthlyCardReward({ now: NOW })
    expect(result).toBeNull()
    // 内存精确恢复
    expect(ps.player.diamond).toBe(500)
    expect(ps.monthlyCard!.lastClaimAt).toBe(NOW - 3 * DAY)
    expect(ps.lastOfflineCheckpointAt).toBe(NOW - DAY)
    // 因 Main 写盘未发生（saveGame 抛错前候选已回滚），Monthly 不应被写入或删除
    const monthlyWrites = setItemSpy.mock.calls.filter(c => c[0] === MONTHLY_CARD_KEY).length
    const monthlyRemoves = removeSpy.mock.calls.filter(c => c[0] === MONTHLY_CARD_KEY).length
    expect(monthlyWrites).toBe(0)
    expect(monthlyRemoves).toBe(0)
    monsterSpy.mockRestore()
  })

  it('Repair 1：saveGame 抛异常 → 重试成功，恰好 +100 且 lastClaimAt === 重试时间戳', () => {
    const ps = usePlayerStore()
    ps.player.diamond = 0
    armCard(ps, NOW - 10 * DAY, 0)
    const RETRY = NOW + DAY

    // 第一次：saveGame 抛异常 → 回滚，diamond 仍为 0
    const failingSave = vi.spyOn(monsterStoreModule, 'useMonsterStore').mockImplementation(() => {
      throw new Error('injected saveGame failure')
    })
    expect(ps.claimMonthlyCardReward({ now: NOW })).toBeNull()
    expect(ps.player.diamond).toBe(0)
    expect(ps.monthlyCard!.lastClaimAt).toBe(0)

    // 恢复 saveGame，用不同时间戳重试 → 恰好 +100
    failingSave.mockRestore()
    const second = ps.claimMonthlyCardReward({ now: RETRY })
    expect(second).toEqual({ gold: 0, diamond: 100 })
    expect(ps.player.diamond).toBe(100)
    expect(ps.monthlyCard!.lastClaimAt).toBe(RETRY)
    expect(ps.lastOfflineCheckpointAt).toBe(RETRY)
  })
})


