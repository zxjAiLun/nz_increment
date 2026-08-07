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

describe('Phase 3.78 BattlePass 免费纯 Diamond 奖励领取补偿事务', () => {
  // 1. diamond-only success（bp_2 = diamond:1）
  it('diamond-only success：diamond 精确 +1 / freeRewards 恰好含 bp_2 / checkpoint == now', () => {
    const ps = usePlayerStore()
    ps.player.diamond = 100
    ps.battlePass.level = 2
    const result = ps.claimBattlePassReward(2, { now: NOW })
    expect(result).toEqual({ diamond: 1 })
    expect(ps.player.diamond).toBe(101)
    expect(ps.battlePass.freeRewards).toEqual(['bp_2'])
    expect(ps.lastOfflineCheckpointAt).toBe(NOW)
  })

  // 2. fresh reload 同时保留 marker + diamond
  it('fresh reload：diamond 奖励与 claim marker 均存在', () => {
    const ps = usePlayerStore()
    ps.player.diamond = 100
    ps.battlePass.level = 2
    expect(ps.claimBattlePassReward(2, { now: NOW })).toEqual({ diamond: 1 })

    setActivePinia(createPinia())
    const ps2 = usePlayerStore()
    ps2.loadGame()
    const bpRaw = localStorage.getItem(BATTLEPASS_KEY)
    if (bpRaw) ps2.battlePass = JSON.parse(bpRaw)
    expect(ps2.player.diamond).toBe(101)
    expect(ps2.battlePass.freeRewards).toContain('bp_2')
  })

  // 3. already claimed
  it('已领取：再次 claim → null / 资源不再增加', () => {
    const ps = usePlayerStore()
    ps.player.diamond = 100
    ps.battlePass.level = 2
    expect(ps.claimBattlePassReward(2, { now: NOW })).toEqual({ diamond: 1 })
    const prevDiamond = ps.player.diamond
    expect(ps.claimBattlePassReward(2, { now: NOW })).toBeNull()
    expect(ps.player.diamond).toBe(prevDiamond)
    expect(ps.battlePass.freeRewards.filter(id => id === 'bp_2').length).toBe(1)
  })

  // 4. level 不足
  it('level 不足：battlePass.level < 2 → null / 零写盘', () => {
    const ps = usePlayerStore()
    ps.player.diamond = 100
    ps.battlePass.level = 1
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    expect(ps.claimBattlePassReward(2, { now: NOW })).toBeNull()
    expect(ps.player.diamond).toBe(100)
    expect(ps.battlePass.freeRewards).toEqual([])
    expect(setItemSpy).not.toHaveBeenCalled()
  })

  // 5. explicit now 不调用 Date.now（事务时间戳 == now）
  it('explicit valid now：checkpoint == now，不读 Date.now', () => {
    const ps = usePlayerStore()
    ps.player.diamond = 100
    ps.battlePass.level = 2
    vi.spyOn(Date, 'now').mockReturnValue(999)
    expect(ps.claimBattlePassReward(2, { now: NOW })).toEqual({ diamond: 1 })
    expect(ps.lastOfflineCheckpointAt).toBe(NOW)
  })

  // 6. clock failure
  it('Date.now 抛错 → null / 零写盘 / 零 mutation', () => {
    const ps = usePlayerStore()
    ps.player.diamond = 100
    ps.battlePass.level = 2
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    vi.spyOn(Date, 'now').mockImplementation(() => { throw new Error('clock broken') })
    expect(ps.claimBattlePassReward(2)).toBeNull()
    expect(ps.player.diamond).toBe(100)
    expect(ps.battlePass.freeRewards).toEqual([])
    expect(setItemSpy).not.toHaveBeenCalled()
  })

  // 7. invalid timestamp
  it('invalid now：0 / -1 / 小数 / NaN / Infinity / >MAX_SAFE 均 → null / 零写盘', () => {
    const ps = usePlayerStore()
    ps.player.diamond = 100
    ps.battlePass.level = 2
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    for (const bad of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(ps.claimBattlePassReward(2, { now: bad as number })).toBeNull()
    }
    expect(ps.player.diamond).toBe(100)
    expect(ps.battlePass.freeRewards).toEqual([])
    expect(setItemSpy).not.toHaveBeenCalled()
  })

  // 8. malformed / overflow diamond
  it('player.diamond 为 NaN / Infinity / 字符串 / 溢出 → null / 零 mutation / 零写盘', () => {
    const ps = usePlayerStore()
    ps.battlePass.level = 2
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    ;(ps.player as { diamond: number }).diamond = NaN as unknown as number
    expect(ps.claimBattlePassReward(2, { now: NOW })).toBeNull()
    ;(ps.player as { diamond: number }).diamond = Infinity
    expect(ps.claimBattlePassReward(2, { now: NOW })).toBeNull()
    ;(ps.player as { diamond: unknown }).diamond = '100' as unknown as number
    expect(ps.claimBattlePassReward(2, { now: NOW })).toBeNull()
    ;(ps.player as { diamond: number }).diamond = Number.MAX_SAFE_INTEGER
    // bp_2 +1 → MAX_SAFE+1 溢出
    expect(ps.claimBattlePassReward(2, { now: NOW })).toBeNull()
    expect(ps.battlePass.freeRewards).toEqual([])
    expect(setItemSpy).not.toHaveBeenCalled()
  })

  it('损坏的 diamond-only reward（diamond 非正安全整数）→ fail closed / 无 claim marker', () => {
    const ps = usePlayerStore()
    ps.player.diamond = 100
    ps.battlePass.level = 2
    const entry = BATTLE_PASS_REWARDS.find(r => r.id === 'bp_2')!
    const orig = entry.reward
    ;(entry as { reward: { diamond: unknown } }).reward = { diamond: NaN }
    try {
      const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
      expect(ps.claimBattlePassReward(2, { now: NOW })).toBeNull()
      expect(ps.battlePass.freeRewards).toEqual([])
      expect(ps.player.diamond).toBe(100)
      expect(setItemSpy).not.toHaveBeenCalled()
    } finally {
      entry.reward = orig
    }
  })

  // 9. Main raw get failure
  it('SAVE_KEY getItem 抛错 → null / 零 mutation / 零写盘', () => {
    const ps = usePlayerStore()
    ps.player.diamond = 100
    ps.battlePass.level = 2
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation((k: string) => {
      if (k === SAVE_KEY) throw new Error('read broken')
      return Storage.prototype.getItem.call(localStorage, k)
    })
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    expect(ps.claimBattlePassReward(2, { now: NOW })).toBeNull()
    expect(ps.player.diamond).toBe(100)
    expect(ps.battlePass.freeRewards).toEqual([])
    expect(setItemSpy).not.toHaveBeenCalled()
  })

  // 10. BP raw get failure
  it('BATTLEPASS_KEY getItem 抛错 → null / 零 mutation / 零写盘', () => {
    const ps = usePlayerStore()
    ps.player.diamond = 100
    ps.battlePass.level = 2
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation((k: string) => {
      if (k === BATTLEPASS_KEY) throw new Error('read broken')
      return Storage.prototype.getItem.call(localStorage, k)
    })
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    expect(ps.claimBattlePassReward(2, { now: NOW })).toBeNull()
    expect(ps.player.diamond).toBe(100)
    expect(ps.battlePass.freeRewards).toEqual([])
    expect(setItemSpy).not.toHaveBeenCalled()
  })

  // 11. Main false → 内存恢复 + BattlePass 0 写
  it('Main 写盘失败（setItem(SAVE_KEY) 抛）→ null / 精确恢复 / BattlePass 0 写', () => {
    const ps = usePlayerStore()
    ps.player.diamond = 100
    ps.battlePass.level = 2
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k: string) => {
      if (k === SAVE_KEY) throw new Error('main write broken')
      return origSetItem(k, localStorage.getItem(k) ?? '')
    })
    expect(ps.claimBattlePassReward(2, { now: NOW })).toBeNull()
    expect(ps.player.diamond).toBe(100)
    expect(ps.battlePass.freeRewards).toEqual([])
    expect(ps.lastOfflineCheckpointAt).not.toBe(NOW)
    const bpWrites = setItemSpy.mock.calls.filter(c => c[0] === BATTLEPASS_KEY).length
    expect(bpWrites).toBe(0)
  })

  // 12. Main direct throw → 内存恢复 + BattlePass 0 写
  it('Main saveGame 直接抛异常 → null / 精确恢复 / BattlePass 0 写', () => {
    const ps = usePlayerStore()
    ps.player.diamond = 100
    ps.battlePass.level = 2
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    const removeSpy = vi.spyOn(Storage.prototype, 'removeItem')
    const monsterSpy = vi.spyOn(monsterStoreModule, 'useMonsterStore').mockImplementation(() => {
      throw new Error('injected saveGame failure')
    })
    expect(ps.claimBattlePassReward(2, { now: NOW })).toBeNull()
    expect(ps.player.diamond).toBe(100)
    expect(ps.battlePass.freeRewards).toEqual([])
    expect(ps.lastOfflineCheckpointAt).not.toBe(NOW)
    const bpWrites = setItemSpy.mock.calls.filter(c => c[0] === BATTLEPASS_KEY).length
    const bpRemoves = removeSpy.mock.calls.filter(c => c[0] === BATTLEPASS_KEY).length
    expect(bpWrites).toBe(0)
    expect(bpRemoves).toBe(0)
    monsterSpy.mockRestore()
  })

  // 13. BP write failure → 内存恢复 + 恢复 Main raw
  it('BattlePass setItem 抛错 → null / 精确恢复内存', () => {
    const ps = usePlayerStore()
    ps.player.diamond = 100
    ps.battlePass.level = 2
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k: string) => {
      if (k === BATTLEPASS_KEY) throw new Error('bp write broken')
      return origSetItem(k, localStorage.getItem(k) ?? '')
    })
    expect(ps.claimBattlePassReward(2, { now: NOW })).toBeNull()
    expect(ps.player.diamond).toBe(100)
    expect(ps.battlePass.freeRewards).toEqual([])
    const mainWrites = setItemSpy.mock.calls.filter(c => c[0] === SAVE_KEY).length
    expect(mainWrites).toBeGreaterThanOrEqual(1)
  })

  // 14. previous Main raw compensation
  it('BattlePass 失败 → 补偿恢复已写 Main raw（diamond 未落盘）', () => {
    const ps = usePlayerStore()
    ps.player.diamond = 100
    ps.battlePass.level = 2
    ps.saveGame(NOW - 1)
    const mainPrev = localStorage.getItem(SAVE_KEY)!
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k: string) => {
      if (k === BATTLEPASS_KEY) throw new Error('bp write broken')
      return origSetItem(k, localStorage.getItem(k) ?? '')
    })
    ps.claimBattlePassReward(2, { now: NOW })
    expect(localStorage.getItem(SAVE_KEY)).toBe(mainPrev)
  })

  // 15. previous Main null → removeItem
  it('previous Main raw == null → compensation 走 removeItem', () => {
    const ps = usePlayerStore()
    ps.player.diamond = 100
    ps.battlePass.level = 2
    const removeSpy = vi.spyOn(Storage.prototype, 'removeItem')
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k: string) => {
      if (k === BATTLEPASS_KEY) throw new Error('bp write broken')
      return origSetItem(k, localStorage.getItem(k) ?? '')
    })
    ps.claimBattlePassReward(2, { now: NOW })
    const removeCall = removeSpy.mock.calls.find(c => c[0] === SAVE_KEY)
    expect(removeCall).toBeDefined()
  })

  // 16. compensation fixed error
  it('compensation 中 setItem/removeItem 失败仍继续并抛固定错误', () => {
    const ps = usePlayerStore()
    ps.player.diamond = 100
    ps.battlePass.level = 2
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('compensation broken')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k: string) => {
      if (k === BATTLEPASS_KEY) throw new Error('bp write broken')
      return origSetItem(k, localStorage.getItem(k) ?? '')
    })
    expect(() => ps.claimBattlePassReward(2, { now: NOW }))
      .toThrow('battle pass free claim persistence rollback failed')
    expect(ps.player.diamond).toBe(100)
    expect(ps.battlePass.freeRewards).toEqual([])
  })

  // 17. failure → retry exactly once
  it('failure → retry success：最终只发一次（diamond +1 / marker 恰好一个）', () => {
    const ps = usePlayerStore()
    ps.player.diamond = 100
    ps.battlePass.level = 2

    const failingSet = vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k: string) => {
      if (k === BATTLEPASS_KEY) throw new Error('bp write broken')
      return origSetItem(k, localStorage.getItem(k) ?? '')
    })
    expect(ps.claimBattlePassReward(2, { now: NOW })).toBeNull()
    expect(ps.player.diamond).toBe(100)
    expect(ps.battlePass.freeRewards).toEqual([])

    failingSet.mockRestore()
    expect(ps.claimBattlePassReward(2, { now: NOW })).toEqual({ diamond: 1 })
    expect(ps.player.diamond).toBe(101)
    expect(ps.battlePass.freeRewards).toEqual(['bp_2'])
  })

  // 18. 非 diamond-only free reward 仍走旧路径
  it('非 diamond-only free reward（bp_1 gold）仍走旧路径', () => {
    const ps = usePlayerStore()
    ps.player.diamond = 100
    ps.player.gold = 50
    ps.battlePass.level = 1
    const result = ps.claimBattlePassReward(1, { now: NOW })
    expect(result).toEqual({ gold: 100 })
    expect(ps.player.gold).toBe(150)
    expect(ps.player.diamond).toBe(100)
    expect(ps.battlePass.freeRewards).toContain('bp_1')
    // 旧路径会写 BP key
    const bpRaw = localStorage.getItem(BATTLEPASS_KEY)
    expect(bpRaw).not.toBeNull()
  })

  it('混合奖励（bp_5 gold+diamond）仍走旧路径', () => {
    const ps = usePlayerStore()
    ps.player.diamond = 100
    ps.player.gold = 0
    ps.battlePass.level = 5
    const result = ps.claimBattlePassReward(5, { now: NOW })
    expect(result).toEqual({ gold: 500, diamond: 2 })
    expect(ps.player.gold).toBe(500)
    expect(ps.player.diamond).toBe(102)
    expect(ps.battlePass.freeRewards).toContain('bp_5')
  })

  // 19. premium 路径不受影响
  it('premium 路径不受影响（bp_p1 diamond 经旧 premium claim 发放）', () => {
    const ps = usePlayerStore()
    ps.player.diamond = 100
    ps.battlePass.level = 1
    ps.battlePass.purchased = true
    const result = ps.claimBattlePassPremiumReward(1)
    expect(result).toEqual({ diamond: 5 })
    expect(ps.player.diamond).toBe(105)
    expect(ps.battlePass.premiumRewards).toContain('bp_p1')
    expect(ps.battlePass.freeRewards).toEqual([])
  })

  // 20. 奖励表运行时等价：紧凑表示构造出的 BATTLE_PASS_REWARDS 与显式期望完全一致。
  it('BATTLE_PASS_REWARDS runtime 等价：length 44 / 30 free + 14 premium / 顺序与内容逐项一致', () => {
    const expected: [string, number, 'free' | 'premium', Record<string, number>][] = [
      // free（30）
      ['bp_1', 1, 'free', { gold: 100 }],
      ['bp_2', 2, 'free', { diamond: 1 }],
      ['bp_3', 3, 'free', { gold: 300 }],
      ['bp_4', 4, 'free', { exp: 200 }],
      ['bp_5', 5, 'free', { gold: 500, diamond: 2 }],
      ['bp_6', 6, 'free', { gold: 200 }],
      ['bp_7', 7, 'free', { exp: 500 }],
      ['bp_8', 8, 'free', { diamond: 3 }],
      ['bp_9', 9, 'free', { gold: 800 }],
      ['bp_10', 10, 'free', { gold: 1000, equipmentTicket: 1 }],
      ['bp_11', 11, 'free', { exp: 1000 }],
      ['bp_12', 12, 'free', { gold: 500 }],
      ['bp_13', 13, 'free', { diamond: 5 }],
      ['bp_14', 14, 'free', { gold: 1500 }],
      ['bp_15', 15, 'free', { exp: 2000, legendaryEquipment: 1 }],
      ['bp_16', 16, 'free', { gold: 1000 }],
      ['bp_17', 17, 'free', { exp: 1500 }],
      ['bp_18', 18, 'free', { diamond: 8 }],
      ['bp_19', 19, 'free', { gold: 2000 }],
      ['bp_20', 20, 'free', { gold: 3000, equipmentTicket: 2 }],
      ['bp_21', 21, 'free', { exp: 3000 }],
      ['bp_22', 22, 'free', { gold: 2000 }],
      ['bp_23', 23, 'free', { diamond: 10 }],
      ['bp_24', 24, 'free', { exp: 5000 }],
      ['bp_25', 25, 'free', { gold: 5000, legendaryEquipment: 1 }],
      ['bp_26', 26, 'free', { gold: 3000 }],
      ['bp_27', 27, 'free', { exp: 5000 }],
      ['bp_28', 28, 'free', { diamond: 15 }],
      ['bp_29', 29, 'free', { gold: 8000 }],
      ['bp_30', 30, 'free', { exp: 10000, gold: 10000 }],
      // premium（14）
      ['bp_p1', 1, 'premium', { diamond: 5 }],
      ['bp_p2', 2, 'premium', { gold: 500 }],
      ['bp_p3', 3, 'premium', { diamond: 10 }],
      ['bp_p4', 4, 'premium', { exp: 1000 }],
      ['bp_p5', 5, 'premium', { legendaryEquipment: 1 }],
      ['bp_p6', 6, 'premium', { diamond: 20 }],
      ['bp_p7', 7, 'premium', { gold: 3000 }],
      ['bp_p8', 8, 'premium', { passive: 1 }],
      ['bp_p9', 9, 'premium', { diamond: 30 }],
      ['bp_p10', 10, 'premium', { legendaryEquipment: 1 }],
      ['bp_p15', 15, 'premium', { gold: 10000 }],
      ['bp_p20', 20, 'premium', { legendaryEquipment: 1, diamond: 50 }],
      ['bp_p25', 25, 'premium', { exp: 20000, gold: 20000 }],
      ['bp_p30', 30, 'premium', { legendaryEquipment: 1, diamond: 100 }],
    ]
    expect(BATTLE_PASS_REWARDS).toHaveLength(44)
    expect(BATTLE_PASS_REWARDS.filter(r => r.type === 'free')).toHaveLength(30)
    expect(BATTLE_PASS_REWARDS.filter(r => r.type === 'premium')).toHaveLength(14)
    expect(
      BATTLE_PASS_REWARDS.map(x => [x.id, x.level, x.type, x.reward])
    ).toEqual(expected)
  })
})
