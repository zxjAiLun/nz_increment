import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { useBattlePassStore } from './battlePassStore'
import { usePlayerStore } from './playerStore'
import { BATTLE_PASS_REWARDS } from '../data/battlePassRewards'
import * as monsterStoreModule from './monsterStore'

const SAVE_KEY = 'lollipop_adventure_save'
const BATTLE_PASS_KEY = 'nz_battle_pass'
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

describe('Phase 3.81 Live BattlePass premium diamond 跨存储补偿事务', () => {
  function diamondStore(diamond = 100) {
    const ps = usePlayerStore()
    ps.player.diamond = diamond
    const bp = useBattlePassStore()
    bp.setPremium(true)
    return { ps, bp }
  }

  // 1+2. level 1 premium diamond success：exact +10
  it('success：level 1 premium diamond → {type:diamond,amount:10} / diamond 精确 +10 / checkpoint == now', () => {
    const { ps, bp } = diamondStore()
    const result = bp.claimPremiumDiamondReward(1, { now: NOW })
    expect(result).toEqual({ type: 'diamond', amount: 10 })
    expect(ps.player.diamond).toBe(110)
    expect(ps.lastOfflineCheckpointAt).toBe(NOW)
  })

  // 3. marker 只进 premium track
  it('marker 只进 claimedPremiumLevels，claimedFreeLevels 不变', () => {
    const { bp } = diamondStore()
    expect(bp.claimPremiumDiamondReward(1, { now: NOW })).toEqual({ type: 'diamond', amount: 10 })
    expect(bp.claimedPremiumLevels).toEqual([1])
    expect(bp.claimedFreeLevels).toEqual([])
  })

  // 4. fresh reload 同时有 diamond + marker
  it('fresh reload：player diamond 与 premium marker 均恢复', () => {
    const { bp } = diamondStore()
    expect(bp.claimPremiumDiamondReward(1, { now: NOW })).toEqual({ type: 'diamond', amount: 10 })

    setActivePinia(createPinia())
    const ps2 = usePlayerStore()
    ps2.loadGame()
    const bp2 = useBattlePassStore()
    expect(ps2.player.diamond).toBe(110)
    expect(bp2.claimedPremiumLevels).toEqual([1])
    expect(bp2.claimedFreeLevels).toEqual([])
  })

  // 5. not premium
  it('未购买 premium：→ null / 零写盘 / 零 mutation / 不读 Date.now', () => {
    const ps = usePlayerStore()
    ps.player.diamond = 100
    const bp = useBattlePassStore()
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    const dateSpy = vi.spyOn(Date, 'now')
    expect(bp.claimPremiumDiamondReward(1, { now: NOW })).toBeNull()
    expect(ps.player.diamond).toBe(100)
    expect(bp.claimedPremiumLevels).toEqual([])
    expect(setItemSpy).not.toHaveBeenCalled()
    expect(dateSpy).not.toHaveBeenCalled()
  })

  // 6. insufficient level
  it('level 不足：currentLevel=1 领 level 10 → null / 零写盘', () => {
    const { ps, bp } = diamondStore()
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    expect(bp.claimPremiumDiamondReward(10, { now: NOW })).toBeNull()
    expect(ps.player.diamond).toBe(100)
    expect(bp.claimedPremiumLevels).toEqual([])
    expect(setItemSpy).not.toHaveBeenCalled()
  })

  // 7. already claimed
  it('已领取：再次 claim → null / diamond 不再增加 / marker 不重复', () => {
    const { ps, bp } = diamondStore()
    expect(bp.claimPremiumDiamondReward(1, { now: NOW })).toEqual({ type: 'diamond', amount: 10 })
    const prevDiamond = ps.player.diamond
    expect(bp.claimPremiumDiamondReward(1, { now: NOW })).toBeNull()
    expect(ps.player.diamond).toBe(prevDiamond)
    expect(bp.claimedPremiumLevels.filter(l => l === 1).length).toBe(1)
  })

  // 8. non-diamond premium 专用 API → null
  it('non-diamond premium（level 5 passiveShard）走专用 API → null / 零写盘', () => {
    const { ps, bp } = diamondStore()
    bp.currentLevel = 5
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    expect(bp.claimPremiumDiamondReward(5, { now: NOW })).toBeNull()
    expect(ps.player.diamond).toBe(100)
    expect(bp.claimedPremiumLevels).toEqual([])
    expect(setItemSpy).not.toHaveBeenCalled()
  })

  // 9. corrupted amount
  it('损坏 amount（非正安全整数）→ fail closed / 无 marker / 零写盘', () => {
    const { ps, bp } = diamondStore()
    const entry = BATTLE_PASS_REWARDS.find(r => r.level === 1)!
    const origPremium = entry.premium
    ;(entry as { premium?: unknown }).premium = { type: 'diamond', amount: NaN }
    try {
      const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
      expect(bp.claimPremiumDiamondReward(1, { now: NOW })).toBeNull()
      expect(ps.player.diamond).toBe(100)
      expect(bp.claimedPremiumLevels).toEqual([])
      expect(setItemSpy).not.toHaveBeenCalled()
    } finally {
      ;(entry as { premium?: unknown }).premium = origPremium
    }
  })

  // 10. invalid current diamond
  it('player.diamond 为 NaN / Infinity / 字符串 → null / 零 mutation / 零写盘', () => {
    const { ps, bp } = diamondStore()
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    ;(ps.player as { diamond: number }).diamond = NaN as unknown as number
    expect(bp.claimPremiumDiamondReward(1, { now: NOW })).toBeNull()
    ;(ps.player as { diamond: number }).diamond = Infinity
    expect(bp.claimPremiumDiamondReward(1, { now: NOW })).toBeNull()
    ;(ps.player as { diamond: unknown }).diamond = '100' as unknown as number
    expect(bp.claimPremiumDiamondReward(1, { now: NOW })).toBeNull()
    expect(bp.claimedPremiumLevels).toEqual([])
    expect(setItemSpy).not.toHaveBeenCalled()
  })

  // 11. overflow
  it('diamond overflow：MAX_SAFE +10 溢出 → null / 零 mutation / 零写盘', () => {
    const { ps, bp } = diamondStore()
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    ;(ps.player as { diamond: number }).diamond = Number.MAX_SAFE_INTEGER
    expect(bp.claimPremiumDiamondReward(1, { now: NOW })).toBeNull()
    expect(bp.claimedPremiumLevels).toEqual([])
    expect(setItemSpy).not.toHaveBeenCalled()
  })

  // 12. explicit now 不读 clock
  it('explicit valid now：checkpoint == now，不读 Date.now', () => {
    const { ps, bp } = diamondStore()
    vi.spyOn(Date, 'now').mockReturnValue(999)
    expect(bp.claimPremiumDiamondReward(1, { now: NOW })).toEqual({ type: 'diamond', amount: 10 })
    expect(ps.lastOfflineCheckpointAt).toBe(NOW)
  })

  // 13. default Date.now
  it('default clock：无 options 用 Date.now 作为事务时间戳', () => {
    const { ps, bp } = diamondStore()
    vi.spyOn(Date, 'now').mockReturnValue(NOW)
    expect(bp.claimPremiumDiamondReward(1)).toEqual({ type: 'diamond', amount: 10 })
    expect(ps.player.diamond).toBe(110)
    expect(ps.lastOfflineCheckpointAt).toBe(NOW)
  })

  // 14. clock throw
  it('Date.now 抛错 → null / 零写盘 / 零 mutation', () => {
    const { ps, bp } = diamondStore()
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    vi.spyOn(Date, 'now').mockImplementation(() => { throw new Error('clock broken') })
    expect(bp.claimPremiumDiamondReward(1)).toBeNull()
    expect(ps.player.diamond).toBe(100)
    expect(bp.claimedPremiumLevels).toEqual([])
    expect(setItemSpy).not.toHaveBeenCalled()
  })

  // 15. invalid timestamps
  it('invalid now：0 / -1 / 小数 / NaN / Infinity / >MAX_SAFE 均 → null / 零写盘', () => {
    const { ps, bp } = diamondStore()
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    for (const bad of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(bp.claimPremiumDiamondReward(1, { now: bad as number })).toBeNull()
    }
    expect(ps.player.diamond).toBe(100)
    expect(bp.claimedPremiumLevels).toEqual([])
    expect(setItemSpy).not.toHaveBeenCalled()
  })

  // 16. Main raw get failure
  it('SAVE_KEY getItem 抛错 → null / 零 mutation / 零写盘', () => {
    const { ps, bp } = diamondStore()
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation((k: string) => {
      if (k === SAVE_KEY) throw new Error('read broken')
      return Storage.prototype.getItem.call(localStorage, k)
    })
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    expect(bp.claimPremiumDiamondReward(1, { now: NOW })).toBeNull()
    expect(ps.player.diamond).toBe(100)
    expect(bp.claimedPremiumLevels).toEqual([])
    expect(setItemSpy).not.toHaveBeenCalled()
  })

  // 17. BattlePass raw get failure
  it('nz_battle_pass getItem 抛错 → null / 零 mutation / 零写盘', () => {
    const { ps, bp } = diamondStore()
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation((k: string) => {
      if (k === BATTLE_PASS_KEY) throw new Error('read broken')
      return Storage.prototype.getItem.call(localStorage, k)
    })
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    expect(bp.claimPremiumDiamondReward(1, { now: NOW })).toBeNull()
    expect(ps.player.diamond).toBe(100)
    expect(bp.claimedPremiumLevels).toEqual([])
    expect(setItemSpy).not.toHaveBeenCalled()
  })

  // 18+20. Main save false → 内存恢复 + BattlePass 0 写
  it('Main 写盘失败（setItem(SAVE_KEY) 抛）→ null / 精确恢复 / BattlePass 0 写', () => {
    const { ps, bp } = diamondStore()
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k: string) => {
      if (k === SAVE_KEY) throw new Error('main write broken')
      return origSetItem(k, localStorage.getItem(k) ?? '')
    })
    expect(bp.claimPremiumDiamondReward(1, { now: NOW })).toBeNull()
    expect(ps.player.diamond).toBe(100)
    expect(bp.claimedPremiumLevels).toEqual([])
    expect(ps.lastOfflineCheckpointAt).not.toBe(NOW)
    const bpWrites = setItemSpy.mock.calls.filter(c => c[0] === BATTLE_PASS_KEY).length
    expect(bpWrites).toBe(0)
  })

  // 19. Main save direct throw → 内存恢复 + BattlePass 0 写
  it('Main saveGame 直接抛异常 → null / 精确恢复 / BattlePass 0 写', () => {
    const { ps, bp } = diamondStore()
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    const removeSpy = vi.spyOn(Storage.prototype, 'removeItem')
    const monsterSpy = vi.spyOn(monsterStoreModule, 'useMonsterStore').mockImplementation(() => {
      throw new Error('injected saveGame failure')
    })
    expect(bp.claimPremiumDiamondReward(1, { now: NOW })).toBeNull()
    expect(ps.player.diamond).toBe(100)
    expect(bp.claimedPremiumLevels).toEqual([])
    expect(ps.lastOfflineCheckpointAt).not.toBe(NOW)
    const bpWrites = setItemSpy.mock.calls.filter(c => c[0] === BATTLE_PASS_KEY).length
    const bpRemoves = removeSpy.mock.calls.filter(c => c[0] === BATTLE_PASS_KEY).length
    expect(bpWrites).toBe(0)
    expect(bpRemoves).toBe(0)
    monsterSpy.mockRestore()
  })

  // 21. BattlePass write failure → 精确恢复内存
  it('BattlePass setItem 抛错 → null / 精确恢复内存（diamond/checkpoint/markers）', () => {
    const { ps, bp } = diamondStore()
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k: string) => {
      if (k === BATTLE_PASS_KEY) throw new Error('bp write broken')
      return origSetItem(k, localStorage.getItem(k) ?? '')
    })
    expect(bp.claimPremiumDiamondReward(1, { now: NOW })).toBeNull()
    expect(ps.player.diamond).toBe(100)
    expect(bp.claimedPremiumLevels).toEqual([])
    expect(ps.lastOfflineCheckpointAt).not.toBe(NOW)
    const mainWrites = setItemSpy.mock.calls.filter(c => c[0] === SAVE_KEY).length
    expect(mainWrites).toBeGreaterThanOrEqual(1)
  })

  // 22. previous Main raw 精确恢复
  it('BattlePass 失败 → 补偿恢复已写 Main raw（diamond 未落盘）', () => {
    const { ps, bp } = diamondStore()
    ps.saveGame(NOW - 1)
    const mainPrev = localStorage.getItem(SAVE_KEY)!
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k: string) => {
      if (k === BATTLE_PASS_KEY) throw new Error('bp write broken')
      return origSetItem(k, localStorage.getItem(k) ?? '')
    })
    bp.claimPremiumDiamondReward(1, { now: NOW })
    expect(localStorage.getItem(SAVE_KEY)).toBe(mainPrev)
  })

  // 23. previous Main null → removeItem
  it('previous Main raw == null → compensation 走 removeItem', () => {
    const { bp } = diamondStore()
    const removeSpy = vi.spyOn(Storage.prototype, 'removeItem')
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k: string) => {
      if (k === BATTLE_PASS_KEY) throw new Error('bp write broken')
      return origSetItem(k, localStorage.getItem(k) ?? '')
    })
    bp.claimPremiumDiamondReward(1, { now: NOW })
    const removeCall = removeSpy.mock.calls.find(c => c[0] === SAVE_KEY)
    expect(removeCall).toBeDefined()
  })

  // 24. compensation failure fixed error
  it('compensation 失败 → 抛固定错误且内存精确恢复', () => {
    const { ps, bp } = diamondStore()
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('compensation broken')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k: string) => {
      if (k === BATTLE_PASS_KEY) throw new Error('bp write broken')
      return origSetItem(k, localStorage.getItem(k) ?? '')
    })
    expect(() => bp.claimPremiumDiamondReward(1, { now: NOW }))
      .toThrow('live battle pass premium diamond claim persistence rollback failed')
    expect(ps.player.diamond).toBe(100)
    expect(bp.claimedPremiumLevels).toEqual([])
  })

  // 25. failure → retry exactly once
  it('failure → retry success：最终只发一次（diamond +10 / marker 恰好一个）', () => {
    const { ps, bp } = diamondStore()

    const failingSet = vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k: string) => {
      if (k === BATTLE_PASS_KEY) throw new Error('bp write broken')
      return origSetItem(k, localStorage.getItem(k) ?? '')
    })
    expect(bp.claimPremiumDiamondReward(1, { now: NOW })).toBeNull()
    expect(ps.player.diamond).toBe(100)
    expect(bp.claimedPremiumLevels).toEqual([])

    failingSet.mockRestore()
    expect(bp.claimPremiumDiamondReward(1, { now: NOW })).toEqual({ type: 'diamond', amount: 10 })
    expect(ps.player.diamond).toBe(110)
    expect(bp.claimedPremiumLevels).toEqual([1])
  })

  // 26. repeat success → null / zero writes
  it('成功后再 claim → null / 零写盘 / 资源不变', async () => {
    const { ps, bp } = diamondStore()
    expect(bp.claimPremiumDiamondReward(1, { now: NOW })).toEqual({ type: 'diamond', amount: 10 })
    await nextTick() // 等首次 claim 的 watch 落盘
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    expect(bp.claimPremiumDiamondReward(1, { now: NOW })).toBeNull()
    expect(ps.player.diamond).toBe(110)
    expect(setItemSpy).not.toHaveBeenCalled()
  })

  // 27. claimedFreeLevels 在 success/failure 都不变
  it('claimedFreeLevels 在 success 与 failure 路径均不变', () => {
    // success 路径
    const { bp } = diamondStore()
    expect(bp.claimPremiumDiamondReward(1, { now: NOW })).toEqual({ type: 'diamond', amount: 10 })
    expect(bp.claimedFreeLevels).toEqual([])
    // failure 路径（BP 写失败）
    setActivePinia(createPinia())
    localStorage.clear() // 清掉 success 路径遗留的 Main/BP raw，避免新 store 初始化即含 marker
    const bp2Store = diamondStore(200)
    const bp2 = bp2Store.bp
    const ps2 = bp2Store.ps
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k: string) => {
      if (k === BATTLE_PASS_KEY) throw new Error('bp write broken')
      return origSetItem(k, localStorage.getItem(k) ?? '')
    })
    expect(bp2.claimPremiumDiamondReward(1, { now: NOW })).toBeNull()
    expect(ps2.player.diamond).toBe(200)
    expect(bp2.claimedFreeLevels).toEqual([])
    expect(bp2.claimedPremiumLevels).toEqual([])
  })

  // 28. new sidecar format 无 legacy claimedLevels
  it('成功保存格式不含 claimedLevels（只有两轨）', async () => {
    const { bp } = diamondStore()
    bp.claimPremiumDiamondReward(1, { now: NOW })
    await nextTick() // 等 watch 落盘（与 claim 内显式保存同格式）
    const raw = localStorage.getItem(BATTLE_PASS_KEY)!
    const saved = JSON.parse(raw)
    expect(saved).not.toHaveProperty('claimedLevels')
    expect(saved.claimedFreeLevels).toEqual([])
    expect(saved.claimedPremiumLevels).toEqual([1])
  })
})
