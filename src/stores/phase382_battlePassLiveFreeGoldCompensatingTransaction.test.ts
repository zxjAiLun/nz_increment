import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { useBattlePassStore } from './battlePassStore'
import { usePlayerStore } from './playerStore'
import { BATTLE_PASS_REWARDS } from '../data/battlePassRewards'
import * as monsterStoreModule from './monsterStore'

const SAVE_KEY = 'lollipop_adventure_save'
const LEGACY_BATTLEPASS_KEY = 'nz_battlepass_v1'
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

describe('Phase 3.82 Live BattlePass free gold 三存储补偿事务', () => {
  function goldStore(gold = 0) {
    const ps = usePlayerStore()
    ps.player.gold = gold
    const bp = useBattlePassStore()
    return { ps, bp }
  }

  // 1+2+3. level 1 free gold success：exact +100 / legacy BP EXP +10
  it('success：level 1 free gold → {type:gold,amount:100} / gold 精确 +100 / legacy BP EXP +10 / checkpoint == now', () => {
    const { ps, bp } = goldStore()
    const result = bp.claimFreeGoldReward(1, { now: NOW })
    expect(result).toEqual({ type: 'gold', amount: 100 })
    expect(ps.player.gold).toBe(100)
    expect(ps.battlePass.exp).toBe(10)
    expect(ps.battlePass.level).toBe(0)
    expect(ps.lastOfflineCheckpointAt).toBe(NOW)
  })

  // 4. free marker only
  it('marker 只进 claimedFreeLevels，claimedPremiumLevels 不变', () => {
    const { bp } = goldStore()
    expect(bp.claimFreeGoldReward(1, { now: NOW })).toEqual({ type: 'gold', amount: 100 })
    expect(bp.claimedFreeLevels).toEqual([1])
    expect(bp.claimedPremiumLevels).toEqual([])
  })

  // 5. fresh reload 三份状态
  it('fresh reload：Main gold / legacy BP EXP / live free marker 全部恢复', () => {
    const { bp } = goldStore()
    expect(bp.claimFreeGoldReward(1, { now: NOW })).toEqual({ type: 'gold', amount: 100 })

    setActivePinia(createPinia())
    const ps2 = usePlayerStore()
    ps2.loadGame()
    const bp2 = useBattlePassStore()
    expect(ps2.player.gold).toBe(100)
    // legacy BP 从 nz_battlepass_v1 恢复（playerStore 启动时加载）
    expect(ps2.battlePass.exp).toBe(10)
    expect(bp2.claimedFreeLevels).toEqual([1])
    expect(bp2.claimedPremiumLevels).toEqual([])
  })

  // 6. non-premium 可以领取
  it('non-premium 可领取 free gold（与 isPremium 无关）', () => {
    const { ps, bp } = goldStore()
    expect(bp.claimFreeGoldReward(1, { now: NOW })).toEqual({ type: 'gold', amount: 100 })
    expect(ps.player.gold).toBe(100)
  })

  // 7. insufficient level
  it('level 不足：currentLevel=1 领 level 5 → null / 零写盘', () => {
    const { ps, bp } = goldStore()
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    expect(bp.claimFreeGoldReward(5, { now: NOW })).toBeNull()
    expect(ps.player.gold).toBe(0)
    expect(bp.claimedFreeLevels).toEqual([])
    expect(setItemSpy).not.toHaveBeenCalled()
  })

  // 8. already claimed
  it('已领取：再次 claim → null / gold 不增 / legacy EXP 不增 / marker 不重复', () => {
    const { ps, bp } = goldStore()
    expect(bp.claimFreeGoldReward(1, { now: NOW })).toEqual({ type: 'gold', amount: 100 })
    const prevGold = ps.player.gold
    const prevExp = ps.battlePass.exp
    expect(bp.claimFreeGoldReward(1, { now: NOW })).toBeNull()
    expect(ps.player.gold).toBe(prevGold)
    expect(ps.battlePass.exp).toBe(prevExp)
    expect(bp.claimedFreeLevels.filter(l => l === 1).length).toBe(1)
  })

  // 9. non-gold free 专用 API fail closed
  it('non-gold free（level 5 material）走专用 API → null / 零写盘', () => {
    const { ps, bp } = goldStore()
    bp.currentLevel = 5
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    expect(bp.claimFreeGoldReward(5, { now: NOW })).toBeNull()
    expect(ps.player.gold).toBe(0)
    expect(bp.claimedFreeLevels).toEqual([])
    expect(setItemSpy).not.toHaveBeenCalled()
  })

  // 10. malformed reward amount
  it('损坏 amount（非正安全整数）→ fail closed / 无 marker / 零写盘', () => {
    const { ps, bp } = goldStore()
    const entry = BATTLE_PASS_REWARDS.find(r => r.level === 1)!
    const origFree = entry.free
    ;(entry as { free?: unknown }).free = { type: 'gold', amount: NaN }
    try {
      const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
      expect(bp.claimFreeGoldReward(1, { now: NOW })).toBeNull()
      expect(ps.player.gold).toBe(0)
      expect(bp.claimedFreeLevels).toEqual([])
      expect(setItemSpy).not.toHaveBeenCalled()
    } finally {
      ;(entry as { free?: unknown }).free = origFree
    }
  })

  // 11. malformed player gold
  it('player.gold 为 NaN / Infinity / 字符串 / 负数 → null / 零 mutation / 零写盘', () => {
    const { ps, bp } = goldStore()
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    ;(ps.player as { gold: number }).gold = NaN as unknown as number
    expect(bp.claimFreeGoldReward(1, { now: NOW })).toBeNull()
    ;(ps.player as { gold: number }).gold = Infinity
    expect(bp.claimFreeGoldReward(1, { now: NOW })).toBeNull()
    ;(ps.player as { gold: unknown }).gold = '100' as unknown as number
    expect(bp.claimFreeGoldReward(1, { now: NOW })).toBeNull()
    ;(ps.player as { gold: number }).gold = -1
    expect(bp.claimFreeGoldReward(1, { now: NOW })).toBeNull()
    expect(bp.claimedFreeLevels).toEqual([])
    expect(setItemSpy).not.toHaveBeenCalled()
  })

  // 12. gold overflow
  it('gold overflow：MAX_SAFE +100 溢出 → null / 零 mutation / 零写盘', () => {
    const { ps, bp } = goldStore()
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    ;(ps.player as { gold: number }).gold = Number.MAX_SAFE_INTEGER
    expect(bp.claimFreeGoldReward(1, { now: NOW })).toBeNull()
    expect(bp.claimedFreeLevels).toEqual([])
    expect(setItemSpy).not.toHaveBeenCalled()
  })

  // 13. malformed legacy BP level
  it('legacy BP level 非非负 safe integer → null / 零写盘', () => {
    const { ps, bp } = goldStore()
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    ;(ps.battlePass as { level: number }).level = NaN
    expect(bp.claimFreeGoldReward(1, { now: NOW })).toBeNull()
    ;(ps.battlePass as { level: number }).level = -1
    expect(bp.claimFreeGoldReward(1, { now: NOW })).toBeNull()
    expect(ps.player.gold).toBe(0)
    expect(bp.claimedFreeLevels).toEqual([])
    expect(setItemSpy).not.toHaveBeenCalled()
  })

  // 14. malformed legacy BP exp
  it('legacy BP exp 非非负 safe integer → null / 零写盘', () => {
    const { ps, bp } = goldStore()
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    ;(ps.battlePass as { exp: number }).exp = NaN
    expect(bp.claimFreeGoldReward(1, { now: NOW })).toBeNull()
    ;(ps.battlePass as { exp: number }).exp = -1
    expect(bp.claimFreeGoldReward(1, { now: NOW })).toBeNull()
    expect(ps.player.gold).toBe(0)
    expect(bp.claimedFreeLevels).toEqual([])
    expect(setItemSpy).not.toHaveBeenCalled()
  })

  // 15. explicit now 不读 clock
  it('explicit valid now：checkpoint == now，不读 Date.now', () => {
    const { ps, bp } = goldStore()
    vi.spyOn(Date, 'now').mockReturnValue(999)
    expect(bp.claimFreeGoldReward(1, { now: NOW })).toEqual({ type: 'gold', amount: 100 })
    expect(ps.lastOfflineCheckpointAt).toBe(NOW)
  })

  // 16. default clock
  it('default clock：无 options 用 Date.now 作为事务时间戳', () => {
    const { ps, bp } = goldStore()
    vi.spyOn(Date, 'now').mockReturnValue(NOW)
    expect(bp.claimFreeGoldReward(1)).toEqual({ type: 'gold', amount: 100 })
    expect(ps.player.gold).toBe(100)
    expect(ps.lastOfflineCheckpointAt).toBe(NOW)
  })

  // 17. clock throw
  it('Date.now 抛错 → null / 零写盘 / 零 mutation', () => {
    const { ps, bp } = goldStore()
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    vi.spyOn(Date, 'now').mockImplementation(() => { throw new Error('clock broken') })
    expect(bp.claimFreeGoldReward(1)).toBeNull()
    expect(ps.player.gold).toBe(0)
    expect(bp.claimedFreeLevels).toEqual([])
    expect(setItemSpy).not.toHaveBeenCalled()
  })

  // 18. invalid timestamps
  it('invalid now：0 / -1 / 小数 / NaN / Infinity / >MAX_SAFE 均 → null / 零写盘', () => {
    const { ps, bp } = goldStore()
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    for (const bad of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(bp.claimFreeGoldReward(1, { now: bad as number })).toBeNull()
    }
    expect(ps.player.gold).toBe(0)
    expect(bp.claimedFreeLevels).toEqual([])
    expect(setItemSpy).not.toHaveBeenCalled()
  })

  // 19. legacy raw get failure
  it('nz_battlepass_v1 getItem 抛错 → null / 零 mutation / 零写盘', () => {
    const { ps, bp } = goldStore()
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation((k: string) => {
      if (k === LEGACY_BATTLEPASS_KEY) throw new Error('read broken')
      return Storage.prototype.getItem.call(localStorage, k)
    })
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    expect(bp.claimFreeGoldReward(1, { now: NOW })).toBeNull()
    expect(ps.player.gold).toBe(0)
    expect(bp.claimedFreeLevels).toEqual([])
    expect(setItemSpy).not.toHaveBeenCalled()
  })

  // 20. Main raw get failure
  it('SAVE_KEY getItem 抛错 → null / 零 mutation / 零写盘', () => {
    const { ps, bp } = goldStore()
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation((k: string) => {
      if (k === SAVE_KEY) throw new Error('read broken')
      return Storage.prototype.getItem.call(localStorage, k)
    })
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    expect(bp.claimFreeGoldReward(1, { now: NOW })).toBeNull()
    expect(ps.player.gold).toBe(0)
    expect(bp.claimedFreeLevels).toEqual([])
    expect(setItemSpy).not.toHaveBeenCalled()
  })

  // 21. live BP raw get failure
  it('nz_battle_pass getItem 抛错 → null / 零 mutation / 零写盘', () => {
    const { ps, bp } = goldStore()
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation((k: string) => {
      if (k === BATTLE_PASS_KEY) throw new Error('read broken')
      return Storage.prototype.getItem.call(localStorage, k)
    })
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    expect(bp.claimFreeGoldReward(1, { now: NOW })).toBeNull()
    expect(ps.player.gold).toBe(0)
    expect(bp.claimedFreeLevels).toEqual([])
    expect(setItemSpy).not.toHaveBeenCalled()
  })

  // 22+23. legacy BP write failure → 恢复 + nextTick 后 Main/live 零写
  it('legacy BP setItem 抛错 → null / 精确恢复 / nextTick 后 Main 与 live BP 均零写', async () => {
    const { ps, bp } = goldStore()
    await nextTick() // flush setup watcher
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    const removeSpy = vi.spyOn(Storage.prototype, 'removeItem')
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k: string) => {
      if (k === LEGACY_BATTLEPASS_KEY) throw new Error('legacy bp write broken')
      return origSetItem(k, localStorage.getItem(k) ?? '')
    })
    expect(bp.claimFreeGoldReward(1, { now: NOW })).toBeNull()
    await nextTick()
    expect(ps.player.gold).toBe(0)
    expect(ps.battlePass.exp).toBe(0)
    expect(bp.claimedFreeLevels).toEqual([])
    expect(ps.lastOfflineCheckpointAt).not.toBe(NOW)
    const mainWrites = setItemSpy.mock.calls.filter(c => c[0] === SAVE_KEY).length
    const liveWrites = setItemSpy.mock.calls.filter(c => c[0] === BATTLE_PASS_KEY).length
    const liveRemoves = removeSpy.mock.calls.filter(c => c[0] === BATTLE_PASS_KEY).length
    expect(mainWrites).toBe(0)
    expect(liveWrites).toBe(0)
    expect(liveRemoves).toBe(0)
  })

  // 24. Main false
  it('Main 写盘失败（setItem(SAVE_KEY) 抛）→ null / 精确恢复 / legacy raw 补偿', async () => {
    const { ps, bp } = goldStore()
    await nextTick()
    ps.battlePass.level = 3
    ps.saveBattlePassData() // 预置 legacy raw（非 null），供补偿还原
    const legacyPrev = localStorage.getItem(LEGACY_BATTLEPASS_KEY)!
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k: string) => {
      if (k === SAVE_KEY) throw new Error('main write broken')
      return origSetItem(k, localStorage.getItem(k) ?? '')
    })
    expect(bp.claimFreeGoldReward(1, { now: NOW })).toBeNull()
    await nextTick()
    expect(ps.player.gold).toBe(0)
    expect(ps.battlePass.exp).toBe(0)
    expect(ps.battlePass.level).toBe(3)
    expect(bp.claimedFreeLevels).toEqual([])
    expect(ps.lastOfflineCheckpointAt).not.toBe(NOW)
    // 26. legacy raw 已精确补偿
    expect(localStorage.getItem(LEGACY_BATTLEPASS_KEY)).toBe(legacyPrev)
    const liveWrites = setItemSpy.mock.calls.filter(c => c[0] === BATTLE_PASS_KEY).length
    expect(liveWrites).toBe(0)
  })

  // 25. Main direct throw
  it('Main saveGame 直接抛异常 → null / 精确恢复 / legacy raw 补偿', async () => {
    const { ps, bp } = goldStore()
    await nextTick()
    ps.battlePass.level = 3
    ps.saveBattlePassData()
    const legacyPrev = localStorage.getItem(LEGACY_BATTLEPASS_KEY)!
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    const removeSpy = vi.spyOn(Storage.prototype, 'removeItem')
    const monsterSpy = vi.spyOn(monsterStoreModule, 'useMonsterStore').mockImplementation(() => {
      throw new Error('injected saveGame failure')
    })
    expect(bp.claimFreeGoldReward(1, { now: NOW })).toBeNull()
    await nextTick()
    expect(ps.player.gold).toBe(0)
    expect(ps.battlePass.exp).toBe(0)
    expect(ps.battlePass.level).toBe(3)
    expect(bp.claimedFreeLevels).toEqual([])
    expect(localStorage.getItem(LEGACY_BATTLEPASS_KEY)).toBe(legacyPrev)
    const liveWrites = setItemSpy.mock.calls.filter(c => c[0] === BATTLE_PASS_KEY).length
    const liveRemoves = removeSpy.mock.calls.filter(c => c[0] === BATTLE_PASS_KEY).length
    expect(liveWrites).toBe(0)
    expect(liveRemoves).toBe(0)
    monsterSpy.mockRestore()
  })

  // 28+29. live BP one-shot write failure
  it('live BP 一次写失败 → null / 精确恢复 / 总尝试恰好 1 次 / 三份 raw 均回事务前', async () => {
    const { ps, bp } = goldStore()
    await nextTick() // flush setup watcher
    const mainPrev = localStorage.getItem(SAVE_KEY)
    const legacyPrev = localStorage.getItem(LEGACY_BATTLEPASS_KEY)
    const livePrev = localStorage.getItem(BATTLE_PASS_KEY)
    let liveAttempts = 0
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k: string, v: string) => {
      if (k === BATTLE_PASS_KEY) {
        liveAttempts++
        if (liveAttempts === 1) throw new Error('live bp write broken') // 只失败第一次，后续若被调用会成功
      }
      return origSetItem(k, v)
    })
    expect(bp.claimFreeGoldReward(1, { now: NOW })).toBeNull()
    await nextTick()
    expect(ps.player.gold).toBe(0)
    expect(ps.battlePass.exp).toBe(0)
    expect(bp.claimedFreeLevels).toEqual([])
    expect(ps.lastOfflineCheckpointAt).not.toBe(NOW)
    // 无 watcher 隐式重试 / 延迟写
    expect(liveAttempts).toBe(1)
    // 30. Main raw exact restore；31. legacy raw exact restore；live raw 未变
    expect(localStorage.getItem(SAVE_KEY)).toBe(mainPrev)
    expect(localStorage.getItem(LEGACY_BATTLEPASS_KEY)).toBe(legacyPrev)
    expect(localStorage.getItem(BATTLE_PASS_KEY)).toBe(livePrev)
  })

  // 32. null previous Main → removeItem（live BP 失败补偿时）
  it('previous Main raw == null → live 失败补偿走 removeItem(SAVE_KEY)', () => {
    const { bp } = goldStore()
    const removeSpy = vi.spyOn(Storage.prototype, 'removeItem')
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k: string) => {
      if (k === BATTLE_PASS_KEY) throw new Error('live bp write broken')
      return origSetItem(k, localStorage.getItem(k) ?? '')
    })
    bp.claimFreeGoldReward(1, { now: NOW })
    const removeCall = removeSpy.mock.calls.find(c => c[0] === SAVE_KEY)
    expect(removeCall).toBeDefined()
  })

  // 33. null previous legacy → removeItem（live BP 失败补偿时）
  it('previous legacy raw == null → live 失败补偿走 removeItem(nz_battlepass_v1)', () => {
    const { bp } = goldStore()
    const removeSpy = vi.spyOn(Storage.prototype, 'removeItem')
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k: string) => {
      if (k === BATTLE_PASS_KEY) throw new Error('live bp write broken')
      return origSetItem(k, localStorage.getItem(k) ?? '')
    })
    bp.claimFreeGoldReward(1, { now: NOW })
    const removeCall = removeSpy.mock.calls.find(c => c[0] === LEGACY_BATTLEPASS_KEY)
    expect(removeCall).toBeDefined()
  })

  // 34. compensation failure fixed error
  it('compensation 失败 → 抛固定错误且内存精确恢复', () => {
    const { ps, bp } = goldStore()
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('compensation broken')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k: string) => {
      if (k === BATTLE_PASS_KEY) throw new Error('live bp write broken')
      return origSetItem(k, localStorage.getItem(k) ?? '')
    })
    expect(() => bp.claimFreeGoldReward(1, { now: NOW }))
      .toThrow('live battle pass free gold claim persistence rollback failed')
    expect(ps.player.gold).toBe(0)
    expect(ps.battlePass.exp).toBe(0)
    expect(bp.claimedFreeLevels).toEqual([])
  })

  // 35. failure → retry exactly once
  it('failure → retry success：最终只发一次（gold +100 / legacy EXP +10 / marker 恰好一个）', async () => {
    const { ps, bp } = goldStore()
    await nextTick()

    const failingSet = vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k: string) => {
      if (k === BATTLE_PASS_KEY) throw new Error('live bp write broken')
      return origSetItem(k, localStorage.getItem(k) ?? '')
    })
    expect(bp.claimFreeGoldReward(1, { now: NOW })).toBeNull()
    await nextTick()
    expect(ps.player.gold).toBe(0)
    expect(bp.claimedFreeLevels).toEqual([])

    failingSet.mockRestore()
    expect(bp.claimFreeGoldReward(1, { now: NOW })).toEqual({ type: 'gold', amount: 100 })
    expect(ps.player.gold).toBe(100)
    expect(ps.battlePass.exp).toBe(10)
    expect(bp.claimedFreeLevels).toEqual([1])
  })

  // 36. success → repeat zero writes
  it('成功后再 claim → null / 零写盘 / 资源不变', async () => {
    const { ps, bp } = goldStore()
    expect(bp.claimFreeGoldReward(1, { now: NOW })).toEqual({ type: 'gold', amount: 100 })
    await nextTick() // 等首次 claim 的 watch 落盘
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    expect(bp.claimFreeGoldReward(1, { now: NOW })).toBeNull()
    expect(ps.player.gold).toBe(100)
    expect(ps.battlePass.exp).toBe(10)
    expect(setItemSpy).not.toHaveBeenCalled()
  })

  // 37. claimedPremiumLevels success/failure 均不变
  it('claimedPremiumLevels 在 success 与 failure 路径均不变', async () => {
    // success 路径
    const { bp } = goldStore()
    expect(bp.claimFreeGoldReward(1, { now: NOW })).toEqual({ type: 'gold', amount: 100 })
    expect(bp.claimedPremiumLevels).toEqual([])
    // failure 路径（live BP 写失败）
    setActivePinia(createPinia())
    localStorage.clear() // 清掉 success 路径遗留 raw，避免新 store 初始化含 marker
    const ps2 = usePlayerStore()
    ps2.player.gold = 200
    const bp2 = useBattlePassStore()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k: string) => {
      if (k === BATTLE_PASS_KEY) throw new Error('live bp write broken')
      return origSetItem(k, localStorage.getItem(k) ?? '')
    })
    expect(bp2.claimFreeGoldReward(1, { now: NOW })).toBeNull()
    await nextTick()
    expect(ps2.player.gold).toBe(200)
    expect(bp2.claimedFreeLevels).toEqual([])
    expect(bp2.claimedPremiumLevels).toEqual([])
  })

  // 38. legacy BP level-up 行为保持
  it('触发 legacy BP level-up：exp 995 +10 → level 1 / exp 5，且与升级算法一致', () => {
    const { ps, bp } = goldStore()
    ps.battlePass.exp = 995
    expect(bp.claimFreeGoldReward(1, { now: NOW })).toEqual({ type: 'gold', amount: 100 })
    expect(ps.player.gold).toBe(100)
    expect(ps.battlePass.exp).toBe(5)
    expect(ps.battlePass.level).toBe(1)
  })

  // 39. new live format 不产生 claimedLevels
  it('成功保存格式不含 claimedLevels（只有两轨）', async () => {
    const { bp } = goldStore()
    bp.claimFreeGoldReward(1, { now: NOW })
    await nextTick()
    const raw = localStorage.getItem(BATTLE_PASS_KEY)!
    const saved = JSON.parse(raw)
    expect(saved).not.toHaveProperty('claimedLevels')
    expect(saved.claimedFreeLevels).toEqual([1])
    expect(saved.claimedPremiumLevels).toEqual([])
  })
})
