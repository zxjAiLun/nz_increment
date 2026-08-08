import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { useBattlePassStore } from './battlePassStore'
import { BATTLE_PASS_REWARDS } from '../data/battlePassRewards'

const BATTLE_PASS_KEY = 'nz_battle_pass'

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('Phase 3.80 Live BattlePass free/premium 领取轨道分离', () => {
  // 1. non-premium level 1 可以领取 free gold 100
  it('non-premium level 1：free claim 返回 {type:gold,amount:100}', () => {
    const bp = useBattlePassStore()
    expect(bp.currentLevel).toBe(1)
    expect(bp.claimLevelReward(1, 'free')).toEqual({ type: 'gold', amount: 100 })
  })

  // 2. non-premium 无法领取 premium
  it('non-premium 无法领取 level 1 premium diamond → null / 无 marker', () => {
    const bp = useBattlePassStore()
    expect(bp.claimLevelReward(1, 'premium')).toBeNull()
    expect(bp.claimedPremiumLevels).toEqual([])
    expect(bp.claimedFreeLevels).toEqual([])
  })

  // 3. free claim 只写 claimedFreeLevels
  it('free claim 只写 claimedFreeLevels，不动 claimedPremiumLevels', () => {
    const bp = useBattlePassStore()
    expect(bp.claimLevelReward(1, 'free')).toEqual({ type: 'gold', amount: 100 })
    expect(bp.claimedFreeLevels).toEqual([1])
    expect(bp.claimedPremiumLevels).toEqual([])
  })

  // 4. premium claim 只写 claimedPremiumLevels
  it('premium claim 只写 claimedPremiumLevels，不动 claimedFreeLevels', () => {
    const bp = useBattlePassStore()
    bp.setPremium(true)
    expect(bp.claimLevelReward(1, 'premium')).toEqual({ type: 'diamond', amount: 10 })
    expect(bp.claimedPremiumLevels).toEqual([1])
    expect(bp.claimedFreeLevels).toEqual([])
  })

  // 5. Premium 用户先 free 后 premium，两次都成功
  it('Premium 用户先 free 后 premium：两次都成功且两轨独立', () => {
    const bp = useBattlePassStore()
    bp.setPremium(true)
    expect(bp.claimLevelReward(1, 'free')).toEqual({ type: 'gold', amount: 100 })
    expect(bp.claimLevelReward(1, 'premium')).toEqual({ type: 'diamond', amount: 10 })
    expect(bp.claimedFreeLevels).toEqual([1])
    expect(bp.claimedPremiumLevels).toEqual([1])
  })

  // 6. Premium 用户先 premium 后 free，两次都成功
  it('Premium 用户先 premium 后 free：两次都成功且两轨独立', () => {
    const bp = useBattlePassStore()
    bp.setPremium(true)
    expect(bp.claimLevelReward(1, 'premium')).toEqual({ type: 'diamond', amount: 10 })
    expect(bp.claimLevelReward(1, 'free')).toEqual({ type: 'gold', amount: 100 })
    expect(bp.claimedPremiumLevels).toEqual([1])
    expect(bp.claimedFreeLevels).toEqual([1])
  })

  // 7. free claim 返回的是 free 轨 item（不携带 premium 内容）
  it('free claim 返回值只代表 free 轨（type/amount 精确匹配 free 奖励）', () => {
    const bp = useBattlePassStore()
    bp.currentLevel = 5
    const item = bp.claimLevelReward(5, 'free')
    expect(item).toEqual({ type: 'material', amount: 5 })
    expect(item).not.toHaveProperty('premium')
  })

  // 8. premium claim 返回的是 premium 轨 item（不携带 free 内容）
  it('premium claim 返回值只代表 premium 轨（type/amount 精确匹配 premium 奖励）', () => {
    const bp = useBattlePassStore()
    bp.setPremium(true)
    bp.currentLevel = 5
    const item = bp.claimLevelReward(5, 'premium')
    expect(item).toEqual({ type: 'passiveShard', amount: 2 })
    expect(item).not.toHaveProperty('free')
  })

  // 9. free repeat → null / marker 不重复
  it('free repeat：再次 claim → null / marker 恰好一个', () => {
    const bp = useBattlePassStore()
    expect(bp.claimLevelReward(1, 'free')).toEqual({ type: 'gold', amount: 100 })
    expect(bp.claimLevelReward(1, 'free')).toBeNull()
    expect(bp.claimedFreeLevels.filter(l => l === 1).length).toBe(1)
  })

  // 10. premium repeat → null / marker 不重复
  it('premium repeat：再次 claim → null / marker 恰好一个', () => {
    const bp = useBattlePassStore()
    bp.setPremium(true)
    expect(bp.claimLevelReward(1, 'premium')).toEqual({ type: 'diamond', amount: 10 })
    expect(bp.claimLevelReward(1, 'premium')).toBeNull()
    expect(bp.claimedPremiumLevels.filter(l => l === 1).length).toBe(1)
  })

  // 11. level insufficient free
  it('level 不足 free：currentLevel=1 领 level 5 free → null', () => {
    const bp = useBattlePassStore()
    expect(bp.claimLevelReward(5, 'free')).toBeNull()
    expect(bp.claimedFreeLevels).toEqual([])
  })

  // 12. level insufficient premium
  it('level 不足 premium：currentLevel=1（isPremium=true）领 level 5 premium → null', () => {
    const bp = useBattlePassStore()
    bp.setPremium(true)
    expect(bp.claimLevelReward(5, 'premium')).toBeNull()
    expect(bp.claimedPremiumLevels).toEqual([])
  })

  // 13. reward row 不存在
  it('reward row 不存在（999 / 3）：free 与 premium 均 → null', () => {
    const bp = useBattlePassStore()
    bp.setPremium(true)
    expect(bp.claimLevelReward(999, 'free')).toBeNull()
    expect(bp.claimLevelReward(3, 'free')).toBeNull()
    expect(bp.claimLevelReward(999, 'premium')).toBeNull()
    expect(bp.claimLevelReward(3, 'premium')).toBeNull()
    expect(bp.claimedFreeLevels).toEqual([])
    expect(bp.claimedPremiumLevels).toEqual([])
  })

  // 14. track reward 不存在时 fail closed
  it('track reward 不存在（row 存在但该轨为空）→ fail closed / 无 marker', () => {
    const bp = useBattlePassStore()
    const row = BATTLE_PASS_REWARDS.find(r => r.level === 1)!
    const origFree = row.free
    ;(row as { free?: unknown }).free = undefined
    try {
      expect(bp.claimLevelReward(1, 'free')).toBeNull()
      expect(bp.claimedFreeLevels).toEqual([])
      expect(bp.claimedPremiumLevels).toEqual([])
    } finally {
      ;(row as { free?: unknown }).free = origFree
    }
  })

  // 15. sidecar save failure → marker 内存回滚 / null
  it('nz_battle_pass setItem 抛错 → null / marker 精确回滚', () => {
    const bp = useBattlePassStore()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage broken')
    })
    expect(bp.claimLevelReward(1, 'free')).toBeNull()
    expect(bp.claimedFreeLevels).toEqual([])
    expect(bp.claimedPremiumLevels).toEqual([])
  })

  // 16. free sidecar success fresh reload 保留 marker
  it('free claim 成功后 fresh reload：claimedFreeLevels 保留 / premium 轨为空', () => {
    const bp = useBattlePassStore()
    expect(bp.claimLevelReward(1, 'free')).toEqual({ type: 'gold', amount: 100 })

    setActivePinia(createPinia())
    const bp2 = useBattlePassStore()
    expect(bp2.claimedFreeLevels).toEqual([1])
    expect(bp2.claimedPremiumLevels).toEqual([])
  })

  // 17. premium sidecar success fresh reload 保留 marker
  it('premium claim 成功后 fresh reload：claimedPremiumLevels 保留 / free 轨为空', () => {
    const bp = useBattlePassStore()
    bp.setPremium(true)
    expect(bp.claimLevelReward(1, 'premium')).toEqual({ type: 'diamond', amount: 10 })

    setActivePinia(createPinia())
    const bp2 = useBattlePassStore()
    expect(bp2.claimedPremiumLevels).toEqual([1])
    expect(bp2.claimedFreeLevels).toEqual([])
  })

  // 18. legacy claimedLevels → 两轨迁移
  it('legacy claimedLevels [1,10] → claimedFreeLevels == claimedPremiumLevels == [1,10]', () => {
    localStorage.setItem(BATTLE_PASS_KEY, JSON.stringify({
      currentLevel: 10,
      totalExp: 0,
      expToNextLevel: 100,
      isPremium: true,
      claimedLevels: [1, 10]
    }))
    const bp = useBattlePassStore()
    expect(bp.claimedFreeLevels).toEqual([1, 10])
    expect(bp.claimedPremiumLevels).toEqual([1, 10])
  })

  // 19. 新字段存在时优先于 legacy claimedLevels
  it('新字段存在时优先：claimedFreeLevels=[2] / claimedPremiumLevels=[3] 不被 legacy [1] 覆盖', () => {
    localStorage.setItem(BATTLE_PASS_KEY, JSON.stringify({
      claimedLevels: [1],
      claimedFreeLevels: [2],
      claimedPremiumLevels: [3]
    }))
    const bp = useBattlePassStore()
    expect(bp.claimedFreeLevels).toEqual([2])
    expect(bp.claimedPremiumLevels).toEqual([3])
  })

  // 20. 新保存结果不再生成 legacy claimedLevels
  it('claim 后新保存格式不含 claimedLevels，含两轨', async () => {
    const bp = useBattlePassStore()
    bp.setPremium(true)
    bp.claimLevelReward(1, 'free')
    bp.claimLevelReward(1, 'premium')
    await nextTick() // 等 watch 落盘（与 claim 内显式保存同格式）
    const raw = localStorage.getItem(BATTLE_PASS_KEY)!
    const saved = JSON.parse(raw)
    expect(saved).not.toHaveProperty('claimedLevels')
    expect(saved.claimedFreeLevels).toEqual([1])
    expect(saved.claimedPremiumLevels).toEqual([1])
  })

  // 21. currentLevel / totalExp / isPremium 原有 persistence 不回归
  it('level/exp/premium 状态持久化不回归：fresh reload 后一致', async () => {
    const bp = useBattlePassStore()
    bp.setPremium(true)
    bp.addExp(100) // level 1 → 2（expToNextLevel 100），totalExp 归 0，expToNextLevel → floor(100×1.15)=114
    await nextTick()
    expect(bp.currentLevel).toBe(2)
    expect(bp.totalExp).toBe(0)
    expect(bp.expToNextLevel).toBe(114)

    setActivePinia(createPinia())
    const bp2 = useBattlePassStore()
    expect(bp2.currentLevel).toBe(2)
    expect(bp2.totalExp).toBe(0)
    expect(bp2.expToNextLevel).toBe(114)
    expect(bp2.isPremium).toBe(true)
  })

  // 22. 当前 11-entry reward table 内容完全不变
  it('BATTLE_PASS_REWARDS 内容不变：11 行，每行 free + premium 与现状逐项一致', () => {
    expect(BATTLE_PASS_REWARDS).toHaveLength(11)
    expect(BATTLE_PASS_REWARDS).toEqual([
      { level: 1, free: { type: 'gold', amount: 100 }, premium: { type: 'diamond', amount: 10 } },
      { level: 5, free: { type: 'material', amount: 5 }, premium: { type: 'passiveShard', amount: 2 } },
      { level: 10, free: { type: 'gachaTicket', amount: 1 }, premium: { type: 'diamond', amount: 30 } },
      { level: 15, free: { type: 'gold', amount: 500 }, premium: { type: 'setPiece', amount: 1 } },
      { level: 20, free: { type: 'material', amount: 10 }, premium: { type: 'diamond', amount: 50 } },
      { level: 25, free: { type: 'gold', amount: 1000 }, premium: { type: 'avatarFrame', amount: 1 } },
      { level: 30, free: { type: 'gachaTicket', amount: 2 }, premium: { type: 'passiveShard', amount: 5 } },
      { level: 35, free: { type: 'gold', amount: 2000 }, premium: { type: 'diamond', amount: 80 } },
      { level: 40, free: { type: 'material', amount: 20 }, premium: { type: 'setPiece', amount: 2 } },
      { level: 45, free: { type: 'gold', amount: 3000 }, premium: { type: 'passiveShard', amount: 8 } },
      { level: 50, free: { type: 'gachaTicket', amount: 5 }, premium: { type: 'setPiece', amount: 5 } }
    ])
  })
})
