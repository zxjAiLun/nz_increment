import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { useBattlePassStore } from './battlePassStore'

const BATTLE_PASS_KEY = 'nz_battle_pass'

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

describe('Phase 3.83 Live BattlePass generic claim 失败隔离（无隐式重试）', () => {
  // free generic success（level 5 material）
  it('free generic success：material item 同步持久化并返回精确 item', async () => {
    const bp = useBattlePassStore()
    bp.currentLevel = 5
    await nextTick() // flush setup watcher
    const result = bp.claimLevelReward(5, 'free')
    expect(result).toEqual({ type: 'material', amount: 5 })
    expect(bp.claimedFreeLevels).toEqual([5])
    expect(bp.claimedPremiumLevels).toEqual([])
    const saved = JSON.parse(localStorage.getItem(BATTLE_PASS_KEY)!)
    expect(saved.claimedFreeLevels).toEqual([5])
  })

  // free one-shot failure：attempts == 1 / marker 恢复 / identity 不变 / raw 不变
  it('free one-shot 写失败 → null / 总尝试 1 次 / marker 恢复且数组 identity 不变 / raw 不变', async () => {
    const bp = useBattlePassStore()
    bp.currentLevel = 5
    await nextTick() // flush setup watcher（含 setPremium/level 变化触发的写盘）
    const livePrev = localStorage.getItem(BATTLE_PASS_KEY)
    const freeArr = bp.claimedFreeLevels // 捕获数组引用（identity）
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    let attempts = 0
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k: string, v: string) => {
      if (k === BATTLE_PASS_KEY) {
        attempts++
        if (attempts === 1) throw new Error('live bp write broken') // 只失败第一次，第二次若发生会成功
      }
      return origSetItem(k, v)
    })
    expect(bp.claimLevelReward(5, 'free')).toBeNull()
    await nextTick()
    expect(attempts).toBe(1) // 无 watcher 隐式重试 / 延迟写
    expect(bp.claimedFreeLevels).toEqual([]) // marker 精确恢复
    expect(bp.claimedFreeLevels).toBe(freeArr) // 数组 identity 不变
    expect(bp.claimedPremiumLevels).toEqual([])
    expect(localStorage.getItem(BATTLE_PASS_KEY)).toBe(livePrev) // disk raw 未变
    expect(setItemSpy.mock.calls.filter(c => c[0] === BATTLE_PASS_KEY).length).toBe(1)
  })

  // free failure → retry success
  it('free failure → retry success：最终恰好一个 marker / item 恰好一次', async () => {
    const bp = useBattlePassStore()
    bp.currentLevel = 5
    await nextTick()

    const failingSet = vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k: string) => {
      if (k === BATTLE_PASS_KEY) throw new Error('live bp write broken')
      return origSetItem(k, localStorage.getItem(k) ?? '')
    })
    expect(bp.claimLevelReward(5, 'free')).toBeNull()
    await nextTick()
    expect(bp.claimedFreeLevels).toEqual([])

    failingSet.mockRestore()
    expect(bp.claimLevelReward(5, 'free')).toEqual({ type: 'material', amount: 5 })
    expect(bp.claimedFreeLevels).toEqual([5])
    expect(bp.claimedFreeLevels.filter(l => l === 5).length).toBe(1)
  })

  // premium generic success（level 5 passiveShard）
  it('premium generic success：passiveShard item 同步持久化并返回精确 item', async () => {
    const bp = useBattlePassStore()
    bp.currentLevel = 5
    bp.setPremium(true)
    await nextTick() // flush setup watcher
    const result = bp.claimLevelReward(5, 'premium')
    expect(result).toEqual({ type: 'passiveShard', amount: 2 })
    expect(bp.claimedPremiumLevels).toEqual([5])
    expect(bp.claimedFreeLevels).toEqual([])
    const saved = JSON.parse(localStorage.getItem(BATTLE_PASS_KEY)!)
    expect(saved.claimedPremiumLevels).toEqual([5])
  })

  // premium one-shot failure：attempts == 1 / marker 恢复 / identity 不变 / raw 不变
  it('premium one-shot 写失败 → null / 总尝试 1 次 / marker 恢复且数组 identity 不变 / raw 不变', async () => {
    const bp = useBattlePassStore()
    bp.currentLevel = 5
    bp.setPremium(true)
    await nextTick() // flush setup watcher
    const livePrev = localStorage.getItem(BATTLE_PASS_KEY)
    const premArr = bp.claimedPremiumLevels // 捕获数组引用（identity）
    let attempts = 0
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k: string, v: string) => {
      if (k === BATTLE_PASS_KEY) {
        attempts++
        if (attempts === 1) throw new Error('live bp write broken')
      }
      return origSetItem(k, v)
    })
    expect(bp.claimLevelReward(5, 'premium')).toBeNull()
    await nextTick()
    expect(attempts).toBe(1) // 无 watcher 隐式重试 / 延迟写
    expect(bp.claimedPremiumLevels).toEqual([]) // marker 精确恢复
    expect(bp.claimedPremiumLevels).toBe(premArr) // 数组 identity 不变
    expect(bp.claimedFreeLevels).toEqual([])
    expect(localStorage.getItem(BATTLE_PASS_KEY)).toBe(livePrev) // disk raw 未变
  })

  // premium failure → retry success
  it('premium failure → retry success：最终恰好一个 marker / item 恰好一次', async () => {
    const bp = useBattlePassStore()
    bp.currentLevel = 5
    bp.setPremium(true)
    await nextTick()

    const failingSet = vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k: string) => {
      if (k === BATTLE_PASS_KEY) throw new Error('live bp write broken')
      return origSetItem(k, localStorage.getItem(k) ?? '')
    })
    expect(bp.claimLevelReward(5, 'premium')).toBeNull()
    await nextTick()
    expect(bp.claimedPremiumLevels).toEqual([])

    failingSet.mockRestore()
    expect(bp.claimLevelReward(5, 'premium')).toEqual({ type: 'passiveShard', amount: 2 })
    expect(bp.claimedPremiumLevels).toEqual([5])
    expect(bp.claimedPremiumLevels.filter(l => l === 5).length).toBe(1)
    expect(bp.claimedFreeLevels).toEqual([])
  })
})
