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

describe('Phase 3.84 Live BattlePass free material 补偿事务', () => {
  function materialStore(materials = 0) {
    const ps = usePlayerStore()
    ps.player.materials = materials
    const bp = useBattlePassStore()
    bp.currentLevel = 5
    return { ps, bp }
  }

  // 1+2. free material success：exact amount（level 5 = 5）
  it('success：level 5 free material → {type:material,amount:5} / materials 精确 +5 / checkpoint == now', () => {
    const { ps, bp } = materialStore()
    const result = bp.claimFreeMaterialReward(5, { now: NOW })
    expect(result).toEqual({ type: 'material', amount: 5 })
    expect(ps.player.materials).toBe(5)
    expect(ps.lastOfflineCheckpointAt).toBe(NOW)
  })

  // 3. free marker only
  it('marker 只进 claimedFreeLevels，claimedPremiumLevels 不变', () => {
    const { bp } = materialStore()
    expect(bp.claimFreeMaterialReward(5, { now: NOW })).toEqual({ type: 'material', amount: 5 })
    expect(bp.claimedFreeLevels).toEqual([5])
    expect(bp.claimedPremiumLevels).toEqual([])
  })

  // 4. non-premium works
  it('non-premium 可领取 free material（与 isPremium 无关）', () => {
    const { ps, bp } = materialStore()
    expect(bp.claimFreeMaterialReward(5, { now: NOW })).toEqual({ type: 'material', amount: 5 })
    expect(ps.player.materials).toBe(5)
  })

  // 5. fresh reload Main material + marker
  it('fresh reload：Main materials 与 free marker 均恢复', () => {
    const { bp } = materialStore()
    expect(bp.claimFreeMaterialReward(5, { now: NOW })).toEqual({ type: 'material', amount: 5 })

    setActivePinia(createPinia())
    const ps2 = usePlayerStore()
    ps2.loadGame()
    const bp2 = useBattlePassStore()
    expect(ps2.player.materials).toBe(5)
    expect(bp2.claimedFreeLevels).toEqual([5])
    expect(bp2.claimedPremiumLevels).toEqual([])
  })

  // 6. insufficient level
  it('level 不足：currentLevel=1 领 level 5 → null / 零写盘', () => {
    const ps = usePlayerStore()
    ps.player.materials = 0
    const bp = useBattlePassStore()
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    expect(bp.claimFreeMaterialReward(5, { now: NOW })).toBeNull()
    expect(ps.player.materials).toBe(0)
    expect(bp.claimedFreeLevels).toEqual([])
    expect(setItemSpy).not.toHaveBeenCalled()
  })

  // 7. already claimed
  it('已领取：再次 claim → null / materials 不增 / marker 不重复', () => {
    const { ps, bp } = materialStore()
    expect(bp.claimFreeMaterialReward(5, { now: NOW })).toEqual({ type: 'material', amount: 5 })
    const prev = ps.player.materials
    expect(bp.claimFreeMaterialReward(5, { now: NOW })).toBeNull()
    expect(ps.player.materials).toBe(prev)
    expect(bp.claimedFreeLevels.filter(l => l === 5).length).toBe(1)
  })

  // 8. non-material 专用 API → null
  it('non-material free（level 1 gold）走专用 API → null / 零写盘', () => {
    const { ps, bp } = materialStore()
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    expect(bp.claimFreeMaterialReward(1, { now: NOW })).toBeNull()
    expect(ps.player.materials).toBe(0)
    expect(bp.claimedFreeLevels).toEqual([])
    expect(setItemSpy).not.toHaveBeenCalled()
  })

  // 9. malformed amount
  it('损坏 amount（非正安全整数）→ fail closed / 无 marker / 零写盘', () => {
    const { ps, bp } = materialStore()
    const entry = BATTLE_PASS_REWARDS.find(r => r.level === 5)!
    const origFree = entry.free
    ;(entry as { free?: unknown }).free = { type: 'material', amount: NaN }
    try {
      const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
      expect(bp.claimFreeMaterialReward(5, { now: NOW })).toBeNull()
      expect(ps.player.materials).toBe(0)
      expect(bp.claimedFreeLevels).toEqual([])
      expect(setItemSpy).not.toHaveBeenCalled()
    } finally {
      ;(entry as { free?: unknown }).free = origFree
    }
  })

  // 10. malformed current materials
  it('player.materials 为 NaN / Infinity / 字符串 → null / 零 mutation / 零写盘', () => {
    const { ps, bp } = materialStore()
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    ;(ps.player as { materials: number }).materials = NaN as unknown as number
    expect(bp.claimFreeMaterialReward(5, { now: NOW })).toBeNull()
    ;(ps.player as { materials: number }).materials = Infinity
    expect(bp.claimFreeMaterialReward(5, { now: NOW })).toBeNull()
    ;(ps.player as { materials: unknown }).materials = '5' as unknown as number
    expect(bp.claimFreeMaterialReward(5, { now: NOW })).toBeNull()
    expect(bp.claimedFreeLevels).toEqual([])
    expect(setItemSpy).not.toHaveBeenCalled()
  })

  // 11. negative current materials
  it('player.materials 为负 → null / 零写盘', () => {
    const { ps, bp } = materialStore()
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    ;(ps.player as { materials: number }).materials = -1
    expect(bp.claimFreeMaterialReward(5, { now: NOW })).toBeNull()
    expect(bp.claimedFreeLevels).toEqual([])
    expect(setItemSpy).not.toHaveBeenCalled()
  })

  // 12. overflow
  it('materials overflow：MAX_SAFE +5 溢出 → null / 零 mutation / 零写盘', () => {
    const { ps, bp } = materialStore()
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    ;(ps.player as { materials: number }).materials = Number.MAX_SAFE_INTEGER
    expect(bp.claimFreeMaterialReward(5, { now: NOW })).toBeNull()
    expect(bp.claimedFreeLevels).toEqual([])
    expect(setItemSpy).not.toHaveBeenCalled()
  })

  // 13. explicit now 不读 clock
  it('explicit valid now：checkpoint == now，不读 Date.now', () => {
    const { ps, bp } = materialStore()
    vi.spyOn(Date, 'now').mockReturnValue(999)
    expect(bp.claimFreeMaterialReward(5, { now: NOW })).toEqual({ type: 'material', amount: 5 })
    expect(ps.lastOfflineCheckpointAt).toBe(NOW)
  })

  // 14. default clock
  it('default clock：无 options 用 Date.now 作为事务时间戳', () => {
    const { ps, bp } = materialStore()
    vi.spyOn(Date, 'now').mockReturnValue(NOW)
    expect(bp.claimFreeMaterialReward(5)).toEqual({ type: 'material', amount: 5 })
    expect(ps.player.materials).toBe(5)
    expect(ps.lastOfflineCheckpointAt).toBe(NOW)
  })

  // 15. clock throw
  it('Date.now 抛错 → null / 零写盘 / 零 mutation', () => {
    const { ps, bp } = materialStore()
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    vi.spyOn(Date, 'now').mockImplementation(() => { throw new Error('clock broken') })
    expect(bp.claimFreeMaterialReward(5)).toBeNull()
    expect(ps.player.materials).toBe(0)
    expect(bp.claimedFreeLevels).toEqual([])
    expect(setItemSpy).not.toHaveBeenCalled()
  })

  // 16. invalid timestamps
  it('invalid now：0 / -1 / 小数 / NaN / Infinity / >MAX_SAFE 均 → null / 零写盘', () => {
    const { ps, bp } = materialStore()
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    for (const bad of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(bp.claimFreeMaterialReward(5, { now: bad as number })).toBeNull()
    }
    expect(ps.player.materials).toBe(0)
    expect(bp.claimedFreeLevels).toEqual([])
    expect(setItemSpy).not.toHaveBeenCalled()
  })

  // 17. Main raw get failure
  it('SAVE_KEY getItem 抛错 → null / 零 mutation / 零写盘', () => {
    const { ps, bp } = materialStore()
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation((k: string) => {
      if (k === SAVE_KEY) throw new Error('read broken')
      return Storage.prototype.getItem.call(localStorage, k)
    })
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    expect(bp.claimFreeMaterialReward(5, { now: NOW })).toBeNull()
    expect(ps.player.materials).toBe(0)
    expect(bp.claimedFreeLevels).toEqual([])
    expect(setItemSpy).not.toHaveBeenCalled()
  })

  // 18. live raw get failure
  it('nz_battle_pass getItem 抛错 → null / 零 mutation / 零写盘', () => {
    const { ps, bp } = materialStore()
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation((k: string) => {
      if (k === BATTLE_PASS_KEY) throw new Error('read broken')
      return Storage.prototype.getItem.call(localStorage, k)
    })
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    expect(bp.claimFreeMaterialReward(5, { now: NOW })).toBeNull()
    expect(ps.player.materials).toBe(0)
    expect(bp.claimedFreeLevels).toEqual([])
    expect(setItemSpy).not.toHaveBeenCalled()
  })

  // 19+21+22. Main save false → 内存恢复 + live 0 写（含 nextTick 后）
  it('Main 写盘失败（setItem(SAVE_KEY) 抛）→ null / 精确恢复 / live BP 0 写（含 nextTick 后）', async () => {
    const { ps, bp } = materialStore()
    await nextTick() // flush setup watcher
    const freeArr = bp.claimedFreeLevels
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    const removeSpy = vi.spyOn(Storage.prototype, 'removeItem')
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k: string) => {
      if (k === SAVE_KEY) throw new Error('main write broken')
      return origSetItem(k, localStorage.getItem(k) ?? '')
    })
    expect(bp.claimFreeMaterialReward(5, { now: NOW })).toBeNull()
    await nextTick()
    expect(ps.player.materials).toBe(0)
    expect(bp.claimedFreeLevels).toEqual([])
    expect(bp.claimedFreeLevels).toBe(freeArr) // array identity 不变
    expect(ps.lastOfflineCheckpointAt).not.toBe(NOW)
    const liveWrites = setItemSpy.mock.calls.filter(c => c[0] === BATTLE_PASS_KEY).length
    const liveRemoves = removeSpy.mock.calls.filter(c => c[0] === BATTLE_PASS_KEY).length
    expect(liveWrites).toBe(0)
    expect(liveRemoves).toBe(0)
  })

  // 20. Main save direct throw
  it('Main saveGame 直接抛异常 → null / 精确恢复 / live BP 0 写（含 nextTick 后）', async () => {
    const { ps, bp } = materialStore()
    await nextTick()
    const freeArr = bp.claimedFreeLevels
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    const removeSpy = vi.spyOn(Storage.prototype, 'removeItem')
    const monsterSpy = vi.spyOn(monsterStoreModule, 'useMonsterStore').mockImplementation(() => {
      throw new Error('injected saveGame failure')
    })
    expect(bp.claimFreeMaterialReward(5, { now: NOW })).toBeNull()
    await nextTick()
    expect(ps.player.materials).toBe(0)
    expect(bp.claimedFreeLevels).toEqual([])
    expect(bp.claimedFreeLevels).toBe(freeArr)
    expect(ps.lastOfflineCheckpointAt).not.toBe(NOW)
    const liveWrites = setItemSpy.mock.calls.filter(c => c[0] === BATTLE_PASS_KEY).length
    const liveRemoves = removeSpy.mock.calls.filter(c => c[0] === BATTLE_PASS_KEY).length
    expect(liveWrites).toBe(0)
    expect(liveRemoves).toBe(0)
    monsterSpy.mockRestore()
  })

  // 23+24+25+26. live BP one-shot failure
  it('live BP 一次写失败 → null / 总尝试恰好 1 次 / Main raw 精确恢复 / null → removeItem / identity 不变', async () => {
    const { ps, bp } = materialStore()
    await nextTick() // flush setup watcher
    const mainPrev = localStorage.getItem(SAVE_KEY)
    const livePrev = localStorage.getItem(BATTLE_PASS_KEY)
    const freeArr = bp.claimedFreeLevels
    let liveAttempts = 0
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k: string, v: string) => {
      if (k === BATTLE_PASS_KEY) {
        liveAttempts++
        if (liveAttempts === 1) throw new Error('live bp write broken') // 只失败第一次，后续若被调用会成功
      }
      return origSetItem(k, v)
    })
    expect(bp.claimFreeMaterialReward(5, { now: NOW })).toBeNull()
    await nextTick()
    expect(liveAttempts).toBe(1) // 无 watcher 隐式重试 / 延迟写
    expect(ps.player.materials).toBe(0)
    expect(bp.claimedFreeLevels).toEqual([])
    expect(bp.claimedFreeLevels).toBe(freeArr) // array identity 不变
    expect(ps.lastOfflineCheckpointAt).not.toBe(NOW)
    expect(localStorage.getItem(SAVE_KEY)).toBe(mainPrev) // Main raw 精确恢复
    expect(localStorage.getItem(BATTLE_PASS_KEY)).toBe(livePrev) // live raw 未变
  })

  // 26（独立路径）. previous Main null → removeItem
  it('previous Main raw == null → live 失败补偿走 removeItem(SAVE_KEY)', () => {
    const { bp } = materialStore()
    const removeSpy = vi.spyOn(Storage.prototype, 'removeItem')
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k: string) => {
      if (k === BATTLE_PASS_KEY) throw new Error('live bp write broken')
      return origSetItem(k, localStorage.getItem(k) ?? '')
    })
    bp.claimFreeMaterialReward(5, { now: NOW })
    const removeCall = removeSpy.mock.calls.find(c => c[0] === SAVE_KEY)
    expect(removeCall).toBeDefined()
  })

  // 27. compensation failure fixed error
  it('compensation 失败 → 抛固定错误且内存精确恢复', () => {
    const { ps, bp } = materialStore()
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('compensation broken')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k: string) => {
      if (k === BATTLE_PASS_KEY) throw new Error('live bp write broken')
      return origSetItem(k, localStorage.getItem(k) ?? '')
    })
    expect(() => bp.claimFreeMaterialReward(5, { now: NOW }))
      .toThrow('live battle pass free material claim persistence rollback failed')
    expect(ps.player.materials).toBe(0)
    expect(bp.claimedFreeLevels).toEqual([])
  })

  // 28. failure → retry exactly once
  it('failure → retry success：最终 material 恰发一次 / marker 恰好一个', async () => {
    const { ps, bp } = materialStore()
    await nextTick()

    const failingSet = vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k: string) => {
      if (k === BATTLE_PASS_KEY) throw new Error('live bp write broken')
      return origSetItem(k, localStorage.getItem(k) ?? '')
    })
    expect(bp.claimFreeMaterialReward(5, { now: NOW })).toBeNull()
    await nextTick()
    expect(ps.player.materials).toBe(0)
    expect(bp.claimedFreeLevels).toEqual([])

    failingSet.mockRestore()
    expect(bp.claimFreeMaterialReward(5, { now: NOW })).toEqual({ type: 'material', amount: 5 })
    expect(ps.player.materials).toBe(5)
    expect(bp.claimedFreeLevels).toEqual([5])
  })

  // 29. success → repeat zero writes
  it('成功后再 claim → null / 零写盘 / 资源不变', async () => {
    const { ps, bp } = materialStore()
    expect(bp.claimFreeMaterialReward(5, { now: NOW })).toEqual({ type: 'material', amount: 5 })
    await nextTick() // 等首次 claim 的 watch 落盘
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    expect(bp.claimFreeMaterialReward(5, { now: NOW })).toBeNull()
    expect(ps.player.materials).toBe(5)
    expect(setItemSpy).not.toHaveBeenCalled()
  })

  // 30. claimedPremiumLevels success/failure 均不变
  it('claimedPremiumLevels 在 success 与 failure 路径均不变', async () => {
    // success 路径
    const { bp } = materialStore()
    expect(bp.claimFreeMaterialReward(5, { now: NOW })).toEqual({ type: 'material', amount: 5 })
    expect(bp.claimedPremiumLevels).toEqual([])
    // failure 路径（live BP 写失败）
    setActivePinia(createPinia())
    localStorage.clear()
    const ps2 = usePlayerStore()
    ps2.player.materials = 10
    const bp2 = useBattlePassStore()
    bp2.currentLevel = 5
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k: string) => {
      if (k === BATTLE_PASS_KEY) throw new Error('live bp write broken')
      return origSetItem(k, localStorage.getItem(k) ?? '')
    })
    expect(bp2.claimFreeMaterialReward(5, { now: NOW })).toBeNull()
    await nextTick()
    expect(ps2.player.materials).toBe(10)
    expect(bp2.claimedFreeLevels).toEqual([])
    expect(bp2.claimedPremiumLevels).toEqual([])
  })

  // 31. claimedFreeLevels identity failure 后不变（在 19/20/23 已断言，此处补 success 路径 identity 保持）
  it('claimedFreeLevels identity 在 success 路径保持（push 原地）', () => {
    const { bp } = materialStore()
    const freeArr = bp.claimedFreeLevels
    expect(bp.claimFreeMaterialReward(5, { now: NOW })).toEqual({ type: 'material', amount: 5 })
    expect(bp.claimedFreeLevels).toBe(freeArr)
  })

  // 32. saved live format 无 claimedLevels
  it('成功保存格式不含 claimedLevels（只有两轨）', async () => {
    const { bp } = materialStore()
    bp.claimFreeMaterialReward(5, { now: NOW })
    await nextTick()
    const raw = localStorage.getItem(BATTLE_PASS_KEY)!
    const saved = JSON.parse(raw)
    expect(saved).not.toHaveProperty('claimedLevels')
    expect(saved.claimedFreeLevels).toEqual([5])
    expect(saved.claimedPremiumLevels).toEqual([])
  })
})
