import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { usePlayerStore } from './playerStore'
import * as monsterStoreModule from './monsterStore'

const SAVE_KEY = 'lollipop_adventure_save'
const MONTHLY_CARD_KEY = 'nz_monthly_card_v1'
const DAY = 24 * 60 * 60 * 1000
const NOW = 1_700_000_000_000

// 真实 setItem 引用（绕过 spy，避免递归调用 spy 自身）。
const ORIG_SETITEM = Storage.prototype.setItem
function origSetItem(k: string, v: string): void {
  ORIG_SETITEM.call(localStorage, k, v)
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('Phase 3.76 Monthly Card 购买补偿事务', () => {
  // 1. diamond < 30 → false / 零写盘
  it('diamond < 30 → false / 零写盘', () => {
    const ps = usePlayerStore()
    ps.player.diamond = 29
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    const removeSpy = vi.spyOn(Storage.prototype, 'removeItem')
    expect(ps.purchaseMonthlyCard({ now: NOW })).toBe(false)
    expect(ps.player.diamond).toBe(29)
    expect(ps.monthlyCard).toBeNull()
    expect(setItemSpy).not.toHaveBeenCalled()
    expect(removeSpy).not.toHaveBeenCalled()
  })

  // 2. exact 30 → 成功扣 30
  it('diamond 恰好 30 → 成功', () => {
    const ps = usePlayerStore()
    ps.player.diamond = 30
    expect(ps.purchaseMonthlyCard({ now: NOW })).toBe(true)
    expect(ps.player.diamond).toBe(0)
  })

  // 3. explicit now 不调用 Date.now（使用传入 now 作为事务时间戳）
  it('explicit valid now 不调用 Date.now（使用传入 now 作为事务时间戳）', () => {
    const ps = usePlayerStore()
    ps.player.diamond = 30
    vi.spyOn(Date, 'now').mockReturnValue(999)
    expect(ps.purchaseMonthlyCard({ now: NOW })).toBe(true)
    expect(ps.monthlyCard!.purchasedAt).toBe(NOW)
    expect(ps.lastOfflineCheckpointAt).toBe(NOW)
  })

  // 4. default Date.now 恰一次（sentinel 证明事务时间戳只从 Date.now 取一次并贯穿使用）
  it('default Date.now 恰一次：事务时间戳取自 Date.now 且用于 purchasedAt / checkpoint', () => {
    const ps = usePlayerStore()
    ps.player.diamond = 30
    const SENTINEL = 1_600_000_000_000
    const OTHER = 1_234
    let calls = 0
    vi.spyOn(Date, 'now').mockImplementation(() => {
      calls++
      // 第一次（事务时间戳）返回 SENTINEL；其余（store 初始化等）返回 OTHER。
      return calls === 1 ? SENTINEL : OTHER
    })
    expect(ps.purchaseMonthlyCard()).toBe(true)
    // 若 Date.now 被多次用于时间戳，purchasedAt/checkpoint 会被 OTHER 覆盖。
    expect(ps.monthlyCard!.purchasedAt).toBe(SENTINEL)
    expect(ps.lastOfflineCheckpointAt).toBe(SENTINEL)
    expect(calls).toBeGreaterThanOrEqual(1)
  })

  // 5. Date.now 抛错 → false / 零写盘
  it('Date.now 抛错 → false / 零写盘', () => {
    const ps = usePlayerStore()
    ps.player.diamond = 30
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    vi.spyOn(Date, 'now').mockImplementation(() => { throw new Error('clock broken') })
    expect(ps.purchaseMonthlyCard()).toBe(false)
    expect(setItemSpy).not.toHaveBeenCalled()
    expect(ps.player.diamond).toBe(30)
    expect(ps.monthlyCard).toBeNull()
  })

  // 6. invalid timestamps → false / 零写盘
  it('invalid now：0 / -1 / 小数 / NaN / Infinity / >MAX_SAFE 均 → false', () => {
    const ps = usePlayerStore()
    ps.player.diamond = 30
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    for (const bad of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(ps.purchaseMonthlyCard({ now: bad as number })).toBe(false)
    }
    expect(setItemSpy).not.toHaveBeenCalled()
    expect(ps.player.diamond).toBe(30)
    expect(ps.monthlyCard).toBeNull()
  })

  // 7. malformed diamond → false / 不扣款
  it('malformed diamond（NaN/Infinity/字符串）不得扣款且 → false', () => {
    const ps = usePlayerStore()
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    // NaN
    ;(ps.player as { diamond: number }).diamond = NaN as unknown as number
    expect(ps.purchaseMonthlyCard({ now: NOW })).toBe(false)
    // Infinity
    ;(ps.player as { diamond: number }).diamond = Infinity
    expect(ps.purchaseMonthlyCard({ now: NOW })).toBe(false)
    // 字符串
    ;(ps.player as { diamond: unknown }).diamond = '100' as unknown as number
    expect(ps.purchaseMonthlyCard({ now: NOW })).toBe(false)
    expect(setItemSpy).not.toHaveBeenCalled()
    expect(Number.isNaN(ps.player.diamond as number) || !Number.isFinite(ps.player.diamond as number) || typeof ps.player.diamond === 'string').toBe(true)
    expect(ps.monthlyCard).toBeNull()
  })

  // 8. 两 raw getItem failure → candidate 0 次 mutation
  it('两 raw getItem 任一失败 → 零 mutation / 零写盘', () => {
    const ps = usePlayerStore()
    ps.player.diamond = 30
    // SAVE_KEY 读失败
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation((k: string) => {
      if (k === SAVE_KEY) throw new Error('read broken')
      return Storage.prototype.getItem.call(localStorage, k)
    })
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    expect(ps.purchaseMonthlyCard({ now: NOW })).toBe(false)
    expect(ps.player.diamond).toBe(30)
    expect(ps.monthlyCard).toBeNull()
    expect(setItemSpy).not.toHaveBeenCalled()
  })

  // 9. success 精确扣 30
  it('success：diamond 精确 -30', () => {
    const ps = usePlayerStore()
    ps.player.diamond = 130
    expect(ps.purchaseMonthlyCard({ now: NOW })).toBe(true)
    expect(ps.player.diamond).toBe(100)
  })

  // 10. success monthly exact { purchasedAt, lastClaimAt:0 }
  it('success：monthlyCard 精确 { purchasedAt: ts, lastClaimAt: 0 }', () => {
    const ps = usePlayerStore()
    ps.player.diamond = 30
    expect(ps.purchaseMonthlyCard({ now: NOW })).toBe(true)
    expect(ps.monthlyCard).toEqual({ purchasedAt: NOW, lastClaimAt: 0 })
  })

  // 11. Main → Monthly 写序
  it('持久化顺序：Player Main 先于 Monthly 写入', () => {
    const ps = usePlayerStore()
    ps.player.diamond = 30
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    expect(ps.purchaseMonthlyCard({ now: NOW })).toBe(true)
    const mainOrder = setItemSpy.mock.invocationCallOrder[
      setItemSpy.mock.calls.findIndex(c => c[0] === SAVE_KEY)
    ]
    const monthlyOrder = setItemSpy.mock.invocationCallOrder[
      setItemSpy.mock.calls.findIndex(c => c[0] === MONTHLY_CARD_KEY)
    ]
    expect(mainOrder).toBeLessThan(monthlyOrder)
  })

  // 12. checkpoint 同 timestamp
  it('success：lastOfflineCheckpointAt == 事务时间戳', () => {
    const ps = usePlayerStore()
    ps.player.diamond = 30
    expect(ps.purchaseMonthlyCard({ now: NOW })).toBe(true)
    expect(ps.lastOfflineCheckpointAt).toBe(NOW)
  })

  // 13. Main false → 内存恢复 + Monthly 0 写
  it('Main 写盘失败（setItem(SAVE_KEY) 抛）→ false / 精确恢复 / Monthly 0 写', () => {
    const ps = usePlayerStore()
    ps.player.diamond = 30
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k: string) => {
      if (k === SAVE_KEY) throw new Error('main write broken')
      return origSetItem(k, localStorage.getItem(k) ?? '')
    })
    expect(ps.purchaseMonthlyCard({ now: NOW })).toBe(false)
    expect(ps.player.diamond).toBe(30)
    expect(ps.monthlyCard).toBeNull()
    expect(ps.lastOfflineCheckpointAt).not.toBe(NOW)
    const monthlyWrites = setItemSpy.mock.calls.filter(c => c[0] === MONTHLY_CARD_KEY).length
    expect(monthlyWrites).toBe(0)
  })

  // 14. Main direct throw → 内存恢复 + Monthly 0 写
  it('Main saveGame 直接抛异常 → false / 精确恢复内存 / Monthly 0 写', () => {
    const ps = usePlayerStore()
    ps.player.diamond = 30
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    const removeSpy = vi.spyOn(Storage.prototype, 'removeItem')
    // saveGame 在其 try 之前调用 useMonsterStore()；令其抛异常模拟 saveGame 抛错。
    const monsterSpy = vi.spyOn(monsterStoreModule, 'useMonsterStore').mockImplementation(() => {
      throw new Error('injected saveGame failure')
    })
    expect(ps.purchaseMonthlyCard({ now: NOW })).toBe(false)
    expect(ps.player.diamond).toBe(30)
    expect(ps.monthlyCard).toBeNull()
    expect(ps.lastOfflineCheckpointAt).not.toBe(NOW)
    const monthlyWrites = setItemSpy.mock.calls.filter(c => c[0] === MONTHLY_CARD_KEY).length
    const monthlyRemoves = removeSpy.mock.calls.filter(c => c[0] === MONTHLY_CARD_KEY).length
    expect(monthlyWrites).toBe(0)
    expect(monthlyRemoves).toBe(0)
    monsterSpy.mockRestore()
  })

  // 15. Monthly setItem throw → 内存恢复 + 恢复 Main raw
  it('Monthly setItem 抛错 → false / 精确恢复内存', () => {
    const ps = usePlayerStore()
    ps.player.diamond = 30
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k: string) => {
      if (k === MONTHLY_CARD_KEY) throw new Error('monthly write broken')
      return origSetItem(k, localStorage.getItem(k) ?? '')
    })
    expect(ps.purchaseMonthlyCard({ now: NOW })).toBe(false)
    expect(ps.player.diamond).toBe(30)
    expect(ps.monthlyCard).toBeNull()
    const mainWrites = setItemSpy.mock.calls.filter(c => c[0] === SAVE_KEY).length
    expect(mainWrites).toBeGreaterThanOrEqual(1)
  })

  // 16. Monthly failure 恢复 diamond/monthlyCard/checkpoint
  it('Monthly 失败 → 精确恢复 diamond / monthlyCard / checkpoint', () => {
    const ps = usePlayerStore()
    ps.player.diamond = 130
    // 预置一份已有月卡，验证整体回滚
    ps.monthlyCard = { purchasedAt: NOW - 10 * DAY, lastClaimAt: NOW - DAY }
    const prevMonthly = ps.monthlyCard
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k: string) => {
      if (k === MONTHLY_CARD_KEY) throw new Error('monthly write broken')
      return origSetItem(k, localStorage.getItem(k) ?? '')
    })
    expect(ps.purchaseMonthlyCard({ now: NOW })).toBe(false)
    expect(ps.player.diamond).toBe(130)
    // monthlyCard 应恢复为独立副本（不与 candidate 共享引用）
    expect(ps.monthlyCard).toEqual(prevMonthly)
    expect(ps.monthlyCard).not.toBe(prevMonthly)
    expect(ps.lastOfflineCheckpointAt).not.toBe(NOW)
  })

  // 17. Monthly failure 恢复 previous Main raw
  it('Monthly 失败 → 补偿恢复已写 Main raw', () => {
    const ps = usePlayerStore()
    ps.player.diamond = 30
    ps.saveGame(NOW - DAY)
    const mainPrev = localStorage.getItem(SAVE_KEY)!
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k: string) => {
      if (k === MONTHLY_CARD_KEY) throw new Error('monthly write broken')
      return origSetItem(k, localStorage.getItem(k) ?? '')
    })
    ps.purchaseMonthlyCard({ now: NOW })
    expect(localStorage.getItem(SAVE_KEY)).toBe(mainPrev)
  })

  // 18. previous Main null → removeItem
  it('previous Main raw == null → compensation 走 removeItem', () => {
    const ps = usePlayerStore()
    ps.player.diamond = 30
    // 尚无 SAVE_KEY（mainPrev === null）
    const removeSpy = vi.spyOn(Storage.prototype, 'removeItem')
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k: string) => {
      if (k === MONTHLY_CARD_KEY) throw new Error('monthly write broken')
      return origSetItem(k, localStorage.getItem(k) ?? '')
    })
    ps.purchaseMonthlyCard({ now: NOW })
    const removeCall = removeSpy.mock.calls.find(c => c[0] === SAVE_KEY)
    expect(removeCall).toBeDefined()
  })

  // 19. compensation failure 固定错误
  it('compensation 中 setItem/removeItem 失败仍继续并抛固定错误', () => {
    const ps = usePlayerStore()
    ps.player.diamond = 30
    // mainPrev === null → compensation 调 removeItem(SAVE_KEY)；令其抛错。
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('compensation broken')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k: string) => {
      if (k === MONTHLY_CARD_KEY) throw new Error('monthly write broken')
      return origSetItem(k, localStorage.getItem(k) ?? '')
    })
    expect(() => ps.purchaseMonthlyCard({ now: NOW }))
      .toThrow('monthly card purchase persistence rollback failed')
    expect(ps.player.diamond).toBe(30)
    expect(ps.monthlyCard).toBeNull()
  })

  // 20. fresh success：重载后支付与权益均存在
  it('fresh success：重载后 payment 与 monthly entitlement 均存在', () => {
    const ps = usePlayerStore()
    ps.player.diamond = 30
    expect(ps.purchaseMonthlyCard({ now: NOW })).toBe(true)

    setActivePinia(createPinia())
    const ps2 = usePlayerStore()
    ps2.loadGame()
    const mcRaw = localStorage.getItem(MONTHLY_CARD_KEY)
    ps2.monthlyCard = mcRaw ? JSON.parse(mcRaw) : null
    expect(ps2.player.diamond).toBe(0)
    expect(ps2.monthlyCard).toEqual({ purchasedAt: NOW, lastClaimAt: 0 })
  })

  // 21. fresh failure：重载后无月卡、钻石未扣
  it('fresh failure：重载后未落盘（无月卡、钻石未扣）', () => {
    const ps = usePlayerStore()
    ps.player.diamond = 30
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k: string) => {
      if (k === MONTHLY_CARD_KEY) throw new Error('monthly write broken')
      return origSetItem(k, localStorage.getItem(k) ?? '')
    })
    ps.purchaseMonthlyCard({ now: NOW })

    setActivePinia(createPinia())
    const ps2 = usePlayerStore()
    ps2.loadGame()
    const mcRaw = localStorage.getItem(MONTHLY_CARD_KEY)
    ps2.monthlyCard = mcRaw ? JSON.parse(mcRaw) : null
    expect(ps2.monthlyCard).toBeNull()
  })

  // 22. failure → retry success，最终只扣一次 30
  it('failure → retry success：最终恰好扣一次 30（不重复扣）', () => {
    const ps = usePlayerStore()
    ps.player.diamond = 30

    // 第一次：Monthly 写盘失败 → 回滚，diamond 仍为 30
    const failingSet = vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k: string) => {
      if (k === MONTHLY_CARD_KEY) throw new Error('monthly write broken')
      return origSetItem(k, localStorage.getItem(k) ?? '')
    })
    expect(ps.purchaseMonthlyCard({ now: NOW })).toBe(false)
    expect(ps.player.diamond).toBe(30)

    // 恢复 setItem，第二次成功 → 恰好扣 30
    failingSet.mockRestore()
    expect(ps.purchaseMonthlyCard({ now: NOW })).toBe(true)
    expect(ps.player.diamond).toBe(0)
    expect(ps.monthlyCard).toEqual({ purchasedAt: NOW, lastClaimAt: 0 })
  })

  // 23. 已有 monthlyCard 时重新购买：保持原有 replace/reset 语义（再次扣 30、新 timestamp）
  it('已有 monthlyCard 重新购买：再次扣 30 / 新 timestamp 起 30 天 / 不新增产品规则', () => {
    const ps = usePlayerStore()
    ps.player.diamond = 60
    // 先买一张（purchasedAt = NOW - 10*DAY）
    expect(ps.purchaseMonthlyCard({ now: NOW - 10 * DAY })).toBe(true)
    expect(ps.player.diamond).toBe(30)
    expect(ps.monthlyCard).toEqual({ purchasedAt: NOW - 10 * DAY, lastClaimAt: 0 })
    // 再买一张（purchasedAt = NOW）：替换语义，再次扣 30
    expect(ps.purchaseMonthlyCard({ now: NOW })).toBe(true)
    expect(ps.player.diamond).toBe(0)
    expect(ps.monthlyCard).toEqual({ purchasedAt: NOW, lastClaimAt: 0 })
  })

  // 24. 成功路径两 key 各最多一次
  it('成功路径：SAVE_KEY 与 MONTHLY_CARD_KEY 各最多写一次', () => {
    const ps = usePlayerStore()
    ps.player.diamond = 30
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    expect(ps.purchaseMonthlyCard({ now: NOW })).toBe(true)
    const mainWrites = setItemSpy.mock.calls.filter(c => c[0] === SAVE_KEY).length
    const monthlyWrites = setItemSpy.mock.calls.filter(c => c[0] === MONTHLY_CARD_KEY).length
    expect(mainWrites).toBe(1)
    expect(monthlyWrites).toBe(1)
  })
})
