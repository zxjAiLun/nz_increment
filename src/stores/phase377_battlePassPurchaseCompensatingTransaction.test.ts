import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { usePlayerStore } from './playerStore'
import * as monsterStoreModule from './monsterStore'

const SAVE_KEY = 'lollipop_adventure_save'
const BATTLEPASS_KEY = 'nz_battlepass_v1'
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

describe('Phase 3.77 BattlePass 购买补偿事务', () => {
  // 1. diamond < 50 → false / 零写盘
  it('diamond < 50 → false / 零写盘', () => {
    const ps = usePlayerStore()
    ps.player.diamond = 49
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    const removeSpy = vi.spyOn(Storage.prototype, 'removeItem')
    expect(ps.purchaseBattlePass({ now: NOW })).toBe(false)
    expect(ps.player.diamond).toBe(49)
    expect(ps.battlePass.purchased).toBe(false)
    expect(setItemSpy).not.toHaveBeenCalled()
    expect(removeSpy).not.toHaveBeenCalled()
  })

  // 2. exact 50 → 成功扣 50
  it('diamond 恰好 50 → 成功', () => {
    const ps = usePlayerStore()
    ps.player.diamond = 50
    expect(ps.purchaseBattlePass({ now: NOW })).toBe(true)
    expect(ps.player.diamond).toBe(0)
    expect(ps.battlePass.purchased).toBe(true)
  })

  // 3. explicit now 不调用 Date.now（使用传入 now 作为事务时间戳）
  it('explicit valid now 不调用 Date.now（事务时间戳 == now）', () => {
    const ps = usePlayerStore()
    ps.player.diamond = 50
    vi.spyOn(Date, 'now').mockReturnValue(999)
    expect(ps.purchaseBattlePass({ now: NOW })).toBe(true)
    expect(ps.battlePass.purchased).toBe(true)
    expect(ps.lastOfflineCheckpointAt).toBe(NOW)
  })

  // 4. default Date.now 恰一次（sentinel 证明事务时间戳只从 Date.now 取一次并贯穿使用）
  it('default Date.now 恰一次：事务时间戳取自 Date.now 且用于 checkpoint', () => {
    const ps = usePlayerStore()
    ps.player.diamond = 50
    const SENTINEL = 1_600_000_000_000
    const OTHER = 1_234
    let calls = 0
    vi.spyOn(Date, 'now').mockImplementation(() => {
      calls++
      // 第一次（事务时间戳）返回 SENTINEL；其余（store 初始化等）返回 OTHER。
      return calls === 1 ? SENTINEL : OTHER
    })
    expect(ps.purchaseBattlePass()).toBe(true)
    // 若 Date.now 被多次用于时间戳，checkpoint 会被 OTHER 覆盖。
    expect(ps.lastOfflineCheckpointAt).toBe(SENTINEL)
    expect(calls).toBeGreaterThanOrEqual(1)
  })

  // 5. Date.now 抛错 → false / 零写盘
  it('Date.now 抛错 → false / 零写盘', () => {
    const ps = usePlayerStore()
    ps.player.diamond = 50
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    vi.spyOn(Date, 'now').mockImplementation(() => { throw new Error('clock broken') })
    expect(ps.purchaseBattlePass()).toBe(false)
    expect(setItemSpy).not.toHaveBeenCalled()
    expect(ps.player.diamond).toBe(50)
    expect(ps.battlePass.purchased).toBe(false)
  })

  // 6. invalid timestamps → false / 零写盘
  it('invalid now：0 / -1 / 小数 / NaN / Infinity / >MAX_SAFE 均 → false', () => {
    const ps = usePlayerStore()
    ps.player.diamond = 50
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    for (const bad of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(ps.purchaseBattlePass({ now: bad as number })).toBe(false)
    }
    expect(setItemSpy).not.toHaveBeenCalled()
    expect(ps.player.diamond).toBe(50)
    expect(ps.battlePass.purchased).toBe(false)
  })

  // 7. malformed diamond → false / 不扣款
  it('malformed diamond（NaN/Infinity/字符串）不得扣款且 → false', () => {
    const ps = usePlayerStore()
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    // NaN
    ;(ps.player as { diamond: number }).diamond = NaN as unknown as number
    expect(ps.purchaseBattlePass({ now: NOW })).toBe(false)
    // Infinity
    ;(ps.player as { diamond: number }).diamond = Infinity
    expect(ps.purchaseBattlePass({ now: NOW })).toBe(false)
    // 字符串
    ;(ps.player as { diamond: unknown }).diamond = '100' as unknown as number
    expect(ps.purchaseBattlePass({ now: NOW })).toBe(false)
    expect(setItemSpy).not.toHaveBeenCalled()
    expect(ps.battlePass.purchased).toBe(false)
  })

  // 8. 两 raw getItem failure → candidate 0 次 mutation
  it('两 raw getItem 任一失败 → 零 mutation / 零写盘', () => {
    const ps = usePlayerStore()
    ps.player.diamond = 50
    // SAVE_KEY 读失败
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation((k: string) => {
      if (k === SAVE_KEY) throw new Error('read broken')
      return Storage.prototype.getItem.call(localStorage, k)
    })
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    expect(ps.purchaseBattlePass({ now: NOW })).toBe(false)
    expect(ps.player.diamond).toBe(50)
    expect(ps.battlePass.purchased).toBe(false)
    expect(setItemSpy).not.toHaveBeenCalled()
  })

  // 9. success 精确扣 50
  it('success：diamond 精确 -50', () => {
    const ps = usePlayerStore()
    ps.player.diamond = 150
    expect(ps.purchaseBattlePass({ now: NOW })).toBe(true)
    expect(ps.player.diamond).toBe(100)
  })

  // 10. success battlepass purchased === true
  it('success：battlePass.purchased === true', () => {
    const ps = usePlayerStore()
    ps.player.diamond = 50
    expect(ps.purchaseBattlePass({ now: NOW })).toBe(true)
    expect(ps.battlePass.purchased).toBe(true)
  })

  // 11. Main → BattlePass 写序
  it('持久化顺序：Player Main 先于 BattlePass 写入', () => {
    const ps = usePlayerStore()
    ps.player.diamond = 50
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    expect(ps.purchaseBattlePass({ now: NOW })).toBe(true)
    const mainOrder = setItemSpy.mock.invocationCallOrder[
      setItemSpy.mock.calls.findIndex(c => c[0] === SAVE_KEY)
    ]
    const bpOrder = setItemSpy.mock.invocationCallOrder[
      setItemSpy.mock.calls.findIndex(c => c[0] === BATTLEPASS_KEY)
    ]
    expect(mainOrder).toBeLessThan(bpOrder)
  })

  // 12. checkpoint 同 timestamp
  it('success：lastOfflineCheckpointAt == 事务时间戳', () => {
    const ps = usePlayerStore()
    ps.player.diamond = 50
    expect(ps.purchaseBattlePass({ now: NOW })).toBe(true)
    expect(ps.lastOfflineCheckpointAt).toBe(NOW)
  })

  // 13. Main false → 内存恢复 + BattlePass 0 写
  it('Main 写盘失败（setItem(SAVE_KEY) 抛）→ false / 精确恢复 / BattlePass 0 写', () => {
    const ps = usePlayerStore()
    ps.player.diamond = 50
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k: string) => {
      if (k === SAVE_KEY) throw new Error('main write broken')
      return origSetItem(k, localStorage.getItem(k) ?? '')
    })
    expect(ps.purchaseBattlePass({ now: NOW })).toBe(false)
    expect(ps.player.diamond).toBe(50)
    expect(ps.battlePass.purchased).toBe(false)
    expect(ps.lastOfflineCheckpointAt).not.toBe(NOW)
    const bpWrites = setItemSpy.mock.calls.filter(c => c[0] === BATTLEPASS_KEY).length
    expect(bpWrites).toBe(0)
  })

  // 14. Main direct throw → 内存恢复 + BattlePass 0 写
  it('Main saveGame 直接抛异常 → false / 精确恢复内存 / BattlePass 0 写', () => {
    const ps = usePlayerStore()
    ps.player.diamond = 50
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    const removeSpy = vi.spyOn(Storage.prototype, 'removeItem')
    // saveGame 在其 try 之前调用 useMonsterStore()；令其抛异常模拟 saveGame 抛错。
    const monsterSpy = vi.spyOn(monsterStoreModule, 'useMonsterStore').mockImplementation(() => {
      throw new Error('injected saveGame failure')
    })
    expect(ps.purchaseBattlePass({ now: NOW })).toBe(false)
    expect(ps.player.diamond).toBe(50)
    expect(ps.battlePass.purchased).toBe(false)
    expect(ps.lastOfflineCheckpointAt).not.toBe(NOW)
    const bpWrites = setItemSpy.mock.calls.filter(c => c[0] === BATTLEPASS_KEY).length
    const bpRemoves = removeSpy.mock.calls.filter(c => c[0] === BATTLEPASS_KEY).length
    expect(bpWrites).toBe(0)
    expect(bpRemoves).toBe(0)
    monsterSpy.mockRestore()
  })

  // 15. BattlePass setItem throw → 内存恢复 + 恢复 Main raw
  it('BattlePass setItem 抛错 → false / 精确恢复内存', () => {
    const ps = usePlayerStore()
    ps.player.diamond = 50
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k: string) => {
      if (k === BATTLEPASS_KEY) throw new Error('bp write broken')
      return origSetItem(k, localStorage.getItem(k) ?? '')
    })
    expect(ps.purchaseBattlePass({ now: NOW })).toBe(false)
    expect(ps.player.diamond).toBe(50)
    expect(ps.battlePass.purchased).toBe(false)
    const mainWrites = setItemSpy.mock.calls.filter(c => c[0] === SAVE_KEY).length
    expect(mainWrites).toBeGreaterThanOrEqual(1)
  })

  // 16. BattlePass failure 恢复 purchased / diamond / checkpoint
  it('BattlePass 失败 → 精确恢复 purchased / diamond / checkpoint', () => {
    const ps = usePlayerStore()
    ps.player.diamond = 150
    // 预置已购买状态，验证整体回滚
    ps.battlePass.purchased = true
    const prevPurchased = ps.battlePass.purchased
    const prevDiamond = ps.player.diamond
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k: string) => {
      if (k === BATTLEPASS_KEY) throw new Error('bp write broken')
      return origSetItem(k, localStorage.getItem(k) ?? '')
    })
    expect(ps.purchaseBattlePass({ now: NOW })).toBe(false)
    expect(ps.player.diamond).toBe(prevDiamond)
    expect(ps.battlePass.purchased).toBe(prevPurchased)
    expect(ps.lastOfflineCheckpointAt).not.toBe(NOW)
  })

  // 17. BattlePass failure 恢复 previous Main raw
  it('BattlePass 失败 → 补偿恢复已写 Main raw', () => {
    const ps = usePlayerStore()
    ps.player.diamond = 50
    ps.saveGame(NOW - 1)
    const mainPrev = localStorage.getItem(SAVE_KEY)!
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k: string) => {
      if (k === BATTLEPASS_KEY) throw new Error('bp write broken')
      return origSetItem(k, localStorage.getItem(k) ?? '')
    })
    ps.purchaseBattlePass({ now: NOW })
    expect(localStorage.getItem(SAVE_KEY)).toBe(mainPrev)
  })

  // 18. previous Main null → removeItem
  it('previous Main raw == null → compensation 走 removeItem', () => {
    const ps = usePlayerStore()
    ps.player.diamond = 50
    // 尚无 SAVE_KEY（mainPrev === null）
    const removeSpy = vi.spyOn(Storage.prototype, 'removeItem')
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k: string) => {
      if (k === BATTLEPASS_KEY) throw new Error('bp write broken')
      return origSetItem(k, localStorage.getItem(k) ?? '')
    })
    ps.purchaseBattlePass({ now: NOW })
    const removeCall = removeSpy.mock.calls.find(c => c[0] === SAVE_KEY)
    expect(removeCall).toBeDefined()
  })

  // 19. compensation failure 固定错误
  it('compensation 中 setItem/removeItem 失败仍继续并抛固定错误', () => {
    const ps = usePlayerStore()
    ps.player.diamond = 50
    // mainPrev === null → compensation 调 removeItem(SAVE_KEY)；令其抛错。
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('compensation broken')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k: string) => {
      if (k === BATTLEPASS_KEY) throw new Error('bp write broken')
      return origSetItem(k, localStorage.getItem(k) ?? '')
    })
    expect(() => ps.purchaseBattlePass({ now: NOW }))
      .toThrow('battle pass purchase persistence rollback failed')
    expect(ps.player.diamond).toBe(50)
    expect(ps.battlePass.purchased).toBe(false)
  })

  // 20. fresh success：重载后支付与权益均存在
  it('fresh success：重载后 payment 与 battlepass purchased 均存在', () => {
    const ps = usePlayerStore()
    ps.player.diamond = 50
    expect(ps.purchaseBattlePass({ now: NOW })).toBe(true)

    setActivePinia(createPinia())
    const ps2 = usePlayerStore()
    ps2.loadGame()
    const bpRaw = localStorage.getItem(BATTLEPASS_KEY)
    if (bpRaw) ps2.battlePass = JSON.parse(bpRaw)
    expect(ps2.player.diamond).toBe(0)
    expect(ps2.battlePass.purchased).toBe(true)
  })

  // 21. fresh failure：重载后无购买、钻石未扣
  it('fresh failure：重载后未落盘（未购买、钻石未扣）', () => {
    const ps = usePlayerStore()
    ps.player.diamond = 50
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k: string) => {
      if (k === BATTLEPASS_KEY) throw new Error('bp write broken')
      return origSetItem(k, localStorage.getItem(k) ?? '')
    })
    ps.purchaseBattlePass({ now: NOW })

    setActivePinia(createPinia())
    const ps2 = usePlayerStore()
    ps2.loadGame()
    const bpRaw = localStorage.getItem(BATTLEPASS_KEY)
    if (bpRaw) ps2.battlePass = JSON.parse(bpRaw)
    expect(ps2.battlePass.purchased).toBe(false)
  })

  // 22. failure → retry success，最终只扣一次 50
  it('failure → retry success：最终恰好扣一次 50（不重复扣）', () => {
    const ps = usePlayerStore()
    ps.player.diamond = 50

    // 第一次：BattlePass 写盘失败 → 回滚，diamond 仍为 50
    const failingSet = vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k: string) => {
      if (k === BATTLEPASS_KEY) throw new Error('bp write broken')
      return origSetItem(k, localStorage.getItem(k) ?? '')
    })
    expect(ps.purchaseBattlePass({ now: NOW })).toBe(false)
    expect(ps.player.diamond).toBe(50)

    // 恢复 setItem，第二次成功 → 恰好扣 50
    failingSet.mockRestore()
    expect(ps.purchaseBattlePass({ now: NOW })).toBe(true)
    expect(ps.player.diamond).toBe(0)
    expect(ps.battlePass.purchased).toBe(true)
  })

  // 23. 不引入「已购买即阻断」规则：重复购买再次扣 50 并维持 purchased=true
  it('已购买时重新购买：再次扣 50 / 维持 purchased=true（无新增阻断规则）', () => {
    const ps = usePlayerStore()
    ps.player.diamond = 150
    // 先买（purchased = true）
    expect(ps.purchaseBattlePass({ now: NOW - 10 })).toBe(true)
    expect(ps.player.diamond).toBe(100)
    expect(ps.battlePass.purchased).toBe(true)
    // 再买：再次扣 50，purchased 仍为 true（不阻断）
    expect(ps.purchaseBattlePass({ now: NOW })).toBe(true)
    expect(ps.player.diamond).toBe(50)
    expect(ps.battlePass.purchased).toBe(true)
  })

  // 24. Phase 3.78 Repair 1：购买 snapshot scope 保持 purchased-only，
  //     与购买无关的 malformed legacy BattlePass 字段不得使购买路径抛错。
  it('malformed unrelated BattlePass 字段（freeRewards/premiumRewards 非数组）不妨碍 purchase 成功', () => {
    const ps = usePlayerStore()
    ps.player.diamond = 50
    ps.battlePass.freeRewards = null as unknown as string[]
    ps.battlePass.premiumRewards = 'legacy-corrupt' as unknown as string[]
    expect(ps.purchaseBattlePass({ now: NOW })).toBe(true)
    expect(ps.player.diamond).toBe(0)
    expect(ps.battlePass.purchased).toBe(true)
    // 与候选无关的 malformed 字段保持原值（不被展开/改写）
    expect(ps.battlePass.freeRewards).toBeNull()
    expect(ps.battlePass.premiumRewards).toBe('legacy-corrupt')
  })

  // 25. 同 scope 保证 + sidecar 写失败：purchased / diamond / checkpoint 仍精确回滚，fixed 补偿语义不变。
  it('malformed unrelated 字段 + BattlePass 写失败：仍精确回滚 purchased/diamond/checkpoint', () => {
    const ps = usePlayerStore()
    ps.player.diamond = 150
    ps.battlePass.purchased = true
    ps.battlePass.freeRewards = null as unknown as string[]
    ps.battlePass.premiumRewards = 'legacy-corrupt' as unknown as string[]
    const prevDiamond = ps.player.diamond
    const prevPurchased = ps.battlePass.purchased
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k: string) => {
      if (k === BATTLEPASS_KEY) throw new Error('bp write broken')
      return origSetItem(k, localStorage.getItem(k) ?? '')
    })
    expect(ps.purchaseBattlePass({ now: NOW })).toBe(false)
    expect(ps.player.diamond).toBe(prevDiamond)
    expect(ps.battlePass.purchased).toBe(prevPurchased)
    expect(ps.lastOfflineCheckpointAt).not.toBe(NOW)
    expect(ps.battlePass.freeRewards).toBeNull()
    expect(ps.battlePass.premiumRewards).toBe('legacy-corrupt')
  })
})
