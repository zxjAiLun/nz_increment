import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { usePlayerStore, BATTLE_PASS_REWARDS } from './playerStore'
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

describe('Phase 3.79 BattlePass Premium 纯 Diamond 奖励领取补偿事务', () => {
  function premiumStore(level: number) {
    const ps = usePlayerStore()
    ps.player.diamond = 100
    ps.battlePass.level = level
    ps.battlePass.purchased = true
    return ps
  }

  // 1. diamond-only success（bp_p1 = diamond:5）
  it('diamond-only success：diamond 精确 +5 / premiumRewards 恰好含 bp_p1 / checkpoint == now', () => {
    const ps = premiumStore(1)
    const result = ps.claimBattlePassPremiumReward(1, { now: NOW })
    expect(result).toEqual({ diamond: 5 })
    expect(ps.player.diamond).toBe(105)
    expect(ps.battlePass.premiumRewards).toEqual(['bp_p1'])
    expect(ps.lastOfflineCheckpointAt).toBe(NOW)
  })

  // 2. fresh reload 同时保留 marker + diamond
  it('fresh reload：diamond 奖励与 premium claim marker 均存在', () => {
    const ps = premiumStore(1)
    expect(ps.claimBattlePassPremiumReward(1, { now: NOW })).toEqual({ diamond: 5 })

    setActivePinia(createPinia())
    const ps2 = usePlayerStore()
    ps2.loadGame()
    const bpRaw = localStorage.getItem(BATTLEPASS_KEY)
    if (bpRaw) ps2.battlePass = JSON.parse(bpRaw)
    expect(ps2.player.diamond).toBe(105)
    expect(ps2.battlePass.premiumRewards).toContain('bp_p1')
  })

  // 3. 未购买 → null / 零写盘 / 零 mutation / 不读 Date.now
  it('未购买：purchased=false → null / 零写盘 / 零 mutation / 不读 Date.now', () => {
    const ps = usePlayerStore()
    ps.player.diamond = 100
    ps.battlePass.level = 1
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    const dateSpy = vi.spyOn(Date, 'now')
    expect(ps.claimBattlePassPremiumReward(1, { now: NOW })).toBeNull()
    expect(ps.player.diamond).toBe(100)
    expect(ps.battlePass.premiumRewards).toEqual([])
    expect(setItemSpy).not.toHaveBeenCalled()
    expect(dateSpy).not.toHaveBeenCalled()
  })

  // 4. level 不足
  it('level 不足：battlePass.level < 1 → null / 零写盘', () => {
    const ps = usePlayerStore()
    ps.player.diamond = 100
    ps.battlePass.level = 0
    ps.battlePass.purchased = true
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    expect(ps.claimBattlePassPremiumReward(1, { now: NOW })).toBeNull()
    expect(ps.player.diamond).toBe(100)
    expect(ps.battlePass.premiumRewards).toEqual([])
    expect(setItemSpy).not.toHaveBeenCalled()
  })

  // 5. already claimed
  it('已领取：再次 claim → null / diamond 不再增加 / marker 不重复', () => {
    const ps = premiumStore(1)
    expect(ps.claimBattlePassPremiumReward(1, { now: NOW })).toEqual({ diamond: 5 })
    const prevDiamond = ps.player.diamond
    expect(ps.claimBattlePassPremiumReward(1, { now: NOW })).toBeNull()
    expect(ps.player.diamond).toBe(prevDiamond)
    expect(ps.battlePass.premiumRewards.filter(id => id === 'bp_p1').length).toBe(1)
  })

  // 6. explicit now 不调用 Date.now（事务时间戳 == now）
  it('explicit valid now：checkpoint == now，不读 Date.now', () => {
    const ps = premiumStore(1)
    vi.spyOn(Date, 'now').mockReturnValue(999)
    expect(ps.claimBattlePassPremiumReward(1, { now: NOW })).toEqual({ diamond: 5 })
    expect(ps.lastOfflineCheckpointAt).toBe(NOW)
  })

  // 7. default clock
  it('default clock：无 options 用 Date.now 作为事务时间戳', () => {
    const ps = premiumStore(1)
    vi.spyOn(Date, 'now').mockReturnValue(NOW)
    expect(ps.claimBattlePassPremiumReward(1)).toEqual({ diamond: 5 })
    expect(ps.player.diamond).toBe(105)
    expect(ps.battlePass.premiumRewards).toEqual(['bp_p1'])
    expect(ps.lastOfflineCheckpointAt).toBe(NOW)
  })

  // 8. clock failure
  it('Date.now 抛错 → null / 零写盘 / 零 mutation', () => {
    const ps = premiumStore(1)
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    vi.spyOn(Date, 'now').mockImplementation(() => { throw new Error('clock broken') })
    expect(ps.claimBattlePassPremiumReward(1)).toBeNull()
    expect(ps.player.diamond).toBe(100)
    expect(ps.battlePass.premiumRewards).toEqual([])
    expect(setItemSpy).not.toHaveBeenCalled()
  })

  // 9. invalid timestamp
  it('invalid now：0 / -1 / 小数 / NaN / Infinity / >MAX_SAFE 均 → null / 零写盘', () => {
    const ps = premiumStore(1)
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    for (const bad of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(ps.claimBattlePassPremiumReward(1, { now: bad as number })).toBeNull()
    }
    expect(ps.player.diamond).toBe(100)
    expect(ps.battlePass.premiumRewards).toEqual([])
    expect(setItemSpy).not.toHaveBeenCalled()
  })

  // 10. malformed player diamond
  it('player.diamond 为 NaN / Infinity / 字符串 → null / 零 mutation / 零写盘', () => {
    const ps = premiumStore(1)
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    ;(ps.player as { diamond: number }).diamond = NaN as unknown as number
    expect(ps.claimBattlePassPremiumReward(1, { now: NOW })).toBeNull()
    ;(ps.player as { diamond: number }).diamond = Infinity
    expect(ps.claimBattlePassPremiumReward(1, { now: NOW })).toBeNull()
    ;(ps.player as { diamond: unknown }).diamond = '100' as unknown as number
    expect(ps.claimBattlePassPremiumReward(1, { now: NOW })).toBeNull()
    expect(ps.battlePass.premiumRewards).toEqual([])
    expect(setItemSpy).not.toHaveBeenCalled()
  })

  // 11. diamond overflow
  it('diamond overflow：MAX_SAFE +5 溢出 → null / 零 mutation / 零写盘', () => {
    const ps = premiumStore(1)
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    ;(ps.player as { diamond: number }).diamond = Number.MAX_SAFE_INTEGER
    // bp_p1 +5 → MAX_SAFE+5 溢出
    expect(ps.claimBattlePassPremiumReward(1, { now: NOW })).toBeNull()
    expect(ps.battlePass.premiumRewards).toEqual([])
    expect(setItemSpy).not.toHaveBeenCalled()
  })

  // 12. corrupted premium diamond reward fail closed
  it('损坏的 diamond-only reward（diamond 非正安全整数）→ fail closed / 无 claim marker', () => {
    const ps = premiumStore(1)
    const entry = BATTLE_PASS_REWARDS.find(r => r.id === 'bp_p1')!
    const orig = entry.reward
    ;(entry as { reward: { diamond: unknown } }).reward = { diamond: NaN }
    try {
      const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
      expect(ps.claimBattlePassPremiumReward(1, { now: NOW })).toBeNull()
      expect(ps.battlePass.premiumRewards).toEqual([])
      expect(ps.player.diamond).toBe(100)
      expect(setItemSpy).not.toHaveBeenCalled()
    } finally {
      entry.reward = orig
    }
  })

  // 13. Main raw get failure
  it('SAVE_KEY getItem 抛错 → null / 零 mutation / 零写盘', () => {
    const ps = premiumStore(1)
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation((k: string) => {
      if (k === SAVE_KEY) throw new Error('read broken')
      return Storage.prototype.getItem.call(localStorage, k)
    })
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    expect(ps.claimBattlePassPremiumReward(1, { now: NOW })).toBeNull()
    expect(ps.player.diamond).toBe(100)
    expect(ps.battlePass.premiumRewards).toEqual([])
    expect(setItemSpy).not.toHaveBeenCalled()
  })

  // 14. BP raw get failure
  it('BATTLEPASS_KEY getItem 抛错 → null / 零 mutation / 零写盘', () => {
    const ps = premiumStore(1)
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation((k: string) => {
      if (k === BATTLEPASS_KEY) throw new Error('read broken')
      return Storage.prototype.getItem.call(localStorage, k)
    })
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    expect(ps.claimBattlePassPremiumReward(1, { now: NOW })).toBeNull()
    expect(ps.player.diamond).toBe(100)
    expect(ps.battlePass.premiumRewards).toEqual([])
    expect(setItemSpy).not.toHaveBeenCalled()
  })

  // 15. Main false → 内存恢复 + BattlePass 0 写
  it('Main 写盘失败（setItem(SAVE_KEY) 抛）→ null / 精确恢复 / BattlePass 0 写', () => {
    const ps = premiumStore(1)
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k: string) => {
      if (k === SAVE_KEY) throw new Error('main write broken')
      return origSetItem(k, localStorage.getItem(k) ?? '')
    })
    expect(ps.claimBattlePassPremiumReward(1, { now: NOW })).toBeNull()
    expect(ps.player.diamond).toBe(100)
    expect(ps.battlePass.premiumRewards).toEqual([])
    expect(ps.lastOfflineCheckpointAt).not.toBe(NOW)
    const bpWrites = setItemSpy.mock.calls.filter(c => c[0] === BATTLEPASS_KEY).length
    expect(bpWrites).toBe(0)
  })

  // 16. Main direct throw → 内存恢复 + BattlePass 0 写
  it('Main saveGame 直接抛异常 → null / 精确恢复 / BattlePass 0 写', () => {
    const ps = premiumStore(1)
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    const removeSpy = vi.spyOn(Storage.prototype, 'removeItem')
    const monsterSpy = vi.spyOn(monsterStoreModule, 'useMonsterStore').mockImplementation(() => {
      throw new Error('injected saveGame failure')
    })
    expect(ps.claimBattlePassPremiumReward(1, { now: NOW })).toBeNull()
    expect(ps.player.diamond).toBe(100)
    expect(ps.battlePass.premiumRewards).toEqual([])
    expect(ps.lastOfflineCheckpointAt).not.toBe(NOW)
    const bpWrites = setItemSpy.mock.calls.filter(c => c[0] === BATTLEPASS_KEY).length
    const bpRemoves = removeSpy.mock.calls.filter(c => c[0] === BATTLEPASS_KEY).length
    expect(bpWrites).toBe(0)
    expect(bpRemoves).toBe(0)
    monsterSpy.mockRestore()
  })

  // 17. BP write failure → 内存恢复 + 恢复 Main raw
  it('BattlePass setItem 抛错 → null / 精确恢复内存', () => {
    const ps = premiumStore(1)
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k: string) => {
      if (k === BATTLEPASS_KEY) throw new Error('bp write broken')
      return origSetItem(k, localStorage.getItem(k) ?? '')
    })
    expect(ps.claimBattlePassPremiumReward(1, { now: NOW })).toBeNull()
    expect(ps.player.diamond).toBe(100)
    expect(ps.battlePass.premiumRewards).toEqual([])
    const mainWrites = setItemSpy.mock.calls.filter(c => c[0] === SAVE_KEY).length
    expect(mainWrites).toBeGreaterThanOrEqual(1)
  })

  // 18. previous Main raw compensation
  it('BattlePass 失败 → 补偿恢复已写 Main raw（diamond 未落盘）', () => {
    const ps = premiumStore(1)
    ps.saveGame(NOW - 1)
    const mainPrev = localStorage.getItem(SAVE_KEY)!
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k: string) => {
      if (k === BATTLEPASS_KEY) throw new Error('bp write broken')
      return origSetItem(k, localStorage.getItem(k) ?? '')
    })
    ps.claimBattlePassPremiumReward(1, { now: NOW })
    expect(localStorage.getItem(SAVE_KEY)).toBe(mainPrev)
  })

  // 19. previous Main null → removeItem
  it('previous Main raw == null → compensation 走 removeItem', () => {
    const ps = premiumStore(1)
    const removeSpy = vi.spyOn(Storage.prototype, 'removeItem')
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k: string) => {
      if (k === BATTLEPASS_KEY) throw new Error('bp write broken')
      return origSetItem(k, localStorage.getItem(k) ?? '')
    })
    ps.claimBattlePassPremiumReward(1, { now: NOW })
    const removeCall = removeSpy.mock.calls.find(c => c[0] === SAVE_KEY)
    expect(removeCall).toBeDefined()
  })

  // 20. compensation fixed error
  it('compensation 中 setItem/removeItem 失败仍继续并抛固定错误', () => {
    const ps = premiumStore(1)
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('compensation broken')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k: string) => {
      if (k === BATTLEPASS_KEY) throw new Error('bp write broken')
      return origSetItem(k, localStorage.getItem(k) ?? '')
    })
    expect(() => ps.claimBattlePassPremiumReward(1, { now: NOW }))
      .toThrow('battle pass premium claim persistence rollback failed')
    expect(ps.player.diamond).toBe(100)
    expect(ps.battlePass.premiumRewards).toEqual([])
  })

  // 21. failure → retry exactly once
  it('failure → retry success：最终只发一次（diamond +5 / marker 恰好一个）', () => {
    const ps = premiumStore(1)

    const failingSet = vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k: string) => {
      if (k === BATTLEPASS_KEY) throw new Error('bp write broken')
      return origSetItem(k, localStorage.getItem(k) ?? '')
    })
    expect(ps.claimBattlePassPremiumReward(1, { now: NOW })).toBeNull()
    expect(ps.player.diamond).toBe(100)
    expect(ps.battlePass.premiumRewards).toEqual([])

    failingSet.mockRestore()
    expect(ps.claimBattlePassPremiumReward(1, { now: NOW })).toEqual({ diamond: 5 })
    expect(ps.player.diamond).toBe(105)
    expect(ps.battlePass.premiumRewards).toEqual(['bp_p1'])
  })

  // 22. mixed premium（bp_p20 legendaryEquipment+diamond）仍走旧路径
  it('混合奖励（bp_p20 legendaryEquipment+diamond）仍走旧路径', () => {
    const ps = premiumStore(20)
    const result = ps.claimBattlePassPremiumReward(20, { now: NOW })
    expect(result).toEqual({ legendaryEquipment: 1, diamond: 50 })
    expect(ps.player.diamond).toBe(150)
    expect(ps.battlePass.premiumRewards).toContain('bp_p20')
    // 旧路径会写 BP key
    const bpRaw = localStorage.getItem(BATTLEPASS_KEY)
    expect(bpRaw).not.toBeNull()
  })

  // 23. non-diamond premium（bp_p2 gold）仍走旧路径
  it('非 diamond-only premium（bp_p2 gold）仍走旧路径', () => {
    const ps = premiumStore(2)
    ps.player.gold = 50
    const result = ps.claimBattlePassPremiumReward(2, { now: NOW })
    expect(result).toEqual({ gold: 500 })
    expect(ps.player.gold).toBe(550)
    expect(ps.player.diamond).toBe(100)
    expect(ps.battlePass.premiumRewards).toContain('bp_p2')
    // 旧路径会写 BP key
    const bpRaw = localStorage.getItem(BATTLEPASS_KEY)
    expect(bpRaw).not.toBeNull()
  })
})
