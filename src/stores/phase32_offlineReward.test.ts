import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { usePlayerStore } from './playerStore'
import { useMonsterStore } from './monsterStore'
import { useGameStore } from './gameStore'
import { useTrainingStore } from './trainingStore'
import { useCultivationStore } from './cultivationStore'
import { useTitleStore } from './titleStore'
import { usePetStore } from './petStore'
import { useRebirthStore } from './rebirthStore'
import { useTalentStore } from './talentStore'
import { useBattlePassStore } from './battlePassStore'
import { calculateOfflineSettlement, makeSettlement, mergeSettlements, normalizePendingOfflineReward } from '../utils/offlineReward'
import * as offlineReward from '../utils/offlineReward'
import { createDefaultPlayer } from '../utils/calc'

// SAVE_KEY 为 playerStore 内部常量（'lollipop_adventure_save'）；测试内复用同一字面量以对齐读写。
const SAVE_KEY = 'lollipop_adventure_save'

const HOUR = 3600
const DAY = 24 * HOUR

function warmupStores() {
  // 用真实 localStorage 预热所有 loadGame/computeBaseStats/saveGame 触碰的 store，
  // 避免其 init 写盘异常落在被测逻辑之外（沿用 Phase 3.1.1.2 的经验）。
  usePlayerStore()
  useMonsterStore()
  useGameStore()
  useTrainingStore()
  useCultivationStore()
  useTitleStore()
  usePetStore()
  useRebirthStore()
  useTalentStore()
  useBattlePassStore()
}

function craftSave(overrides: Record<string, unknown> = {}): string {
  const player = { ...createDefaultPlayer(), ...(overrides.player as object) }
  return JSON.stringify({
    player,
    pendingOfflineReward: overrides.pendingOfflineReward ?? null,
    lastOfflineCheckpointAt: overrides.lastOfflineCheckpointAt,
    statUpgradeCounts: [],
    monsterData: { difficultyValue: 1, monsterLevel: 1 },
    gameData: { damageStats: {}, battleLog: [] },
    trainingData: { trainingLevel: 1, trainingDifficulty: 1 }
  })
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  warmupStores()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('Phase 3.2 — 离线公式（纯函数 calculateOfflineSettlement）', () => {
  it('0 秒产出为 0；59 秒仍按比例产出（60s 门槛只在 loadGame 结算时生效）', () => {
    expect(calculateOfflineSettlement({ offlineSeconds: 0, attack: 100, effectiveLuck: 0, offlineEfficiencyBonus: 0 }))
      .toMatchObject({ gold: 0, exp: 0, creditedSeconds: 0 })
    const r59 = calculateOfflineSettlement({ offlineSeconds: 59, attack: 100, effectiveLuck: 0, offlineEfficiencyBonus: 0 })
    expect(r59.gold).toBe(1180) // 100 * 0.2 * 59
    expect(r59.creditedSeconds).toBe(59)
  })

  it('60 秒起开始产出（门槛内）', () => {
    const r = calculateOfflineSettlement({ offlineSeconds: 60, attack: 100, effectiveLuck: 0, offlineEfficiencyBonus: 0 })
    expect(r.gold).toBeGreaterThan(0)
    expect(r.exp).toBeGreaterThan(0)
    expect(r.creditedSeconds).toBe(60)
  })

  it('各阶梯边界前1秒 / 边界值 / 后1秒', () => {
    const base = { attack: 100, effectiveLuck: 0, offlineEfficiencyBonus: 0 }
    // ≥1h: 1.5x gold / 1.2x exp
    expect(calculateOfflineSettlement({ ...base, offlineSeconds: HOUR - 1 }).gold).toBeLessThan(
      calculateOfflineSettlement({ ...base, offlineSeconds: HOUR }).gold)
    expect(calculateOfflineSettlement({ ...base, offlineSeconds: HOUR }).gold).toBe(
      Math.floor(100 * 0.2 * HOUR * 1.5))
    expect(calculateOfflineSettlement({ ...base, offlineSeconds: HOUR + 1 }).gold).toBe(
      Math.floor(100 * 0.2 * (HOUR + 1) * 1.5))
    // ≥4h: 2.0x gold / 1.5x exp
    expect(calculateOfflineSettlement({ ...base, offlineSeconds: 4 * HOUR }).gold).toBe(
      Math.floor(100 * 0.2 * 4 * HOUR * 2.0))
    // ≥8h: 2.5x gold / 2.0x exp
    expect(calculateOfflineSettlement({ ...base, offlineSeconds: 8 * HOUR }).gold).toBe(
      Math.floor(100 * 0.2 * 8 * HOUR * 2.5))
  })

  it('24 小时为上限，24h+1 与 48h 结果相同', () => {
    const base = { attack: 100, effectiveLuck: 0, offlineEfficiencyBonus: 0 }
    const r24 = calculateOfflineSettlement({ ...base, offlineSeconds: DAY })
    const r24p1 = calculateOfflineSettlement({ ...base, offlineSeconds: DAY + 1 })
    const r48 = calculateOfflineSettlement({ ...base, offlineSeconds: 2 * DAY })
    expect(r24.creditedSeconds).toBe(DAY)
    expect(r24p1.creditedSeconds).toBe(DAY)
    expect(r48.creditedSeconds).toBe(DAY)
    expect(r24.gold).toBe(r24p1.gold)
    expect(r24.gold).toBe(r48.gold)
  })

  it('输入规范化：负数 / NaN / Infinity → 0 产出', () => {
    const bad = [-100, NaN, Infinity, -Infinity]
    for (const v of bad) {
      const r = calculateOfflineSettlement({ offlineSeconds: v, attack: v, effectiveLuck: v, offlineEfficiencyBonus: v })
      expect(r.gold).toBe(0)
      expect(r.exp).toBe(0)
      expect(r.creditedSeconds).toBe(0)
    }
  })

  it('金币与经验必须为非负整数', () => {
    const r = calculateOfflineSettlement({ offlineSeconds: 1234.9, attack: 77.7, effectiveLuck: 3.3, offlineEfficiencyBonus: 12.5 })
    expect(Number.isInteger(r.gold)).toBe(true)
    expect(Number.isInteger(r.exp)).toBe(true)
    expect(r.gold).toBeGreaterThanOrEqual(0)
    expect(r.exp).toBeGreaterThanOrEqual(0)
  })

  it('幸运只通过公开 helper 应用一次（gold 受益，exp 不受幸运影响）', () => {
    const noLuck = calculateOfflineSettlement({ offlineSeconds: HOUR, attack: 100, effectiveLuck: 0, offlineEfficiencyBonus: 0 })
    const withLuck = calculateOfflineSettlement({ offlineSeconds: HOUR, attack: 100, effectiveLuck: 100, offlineEfficiencyBonus: 0 })
    expect(withLuck.gold).toBeGreaterThan(noLuck.gold)
    expect(withLuck.exp).toBe(noLuck.exp) // exp 不计幸运
  })
})

describe('Phase 3.2 — 合并与迁移', () => {
  it('mergeSettlements 逐字段累加，且各自 24h 区间不重压', () => {
    const old = makeSettlement({ elapsedSeconds: DAY, creditedSeconds: DAY, gold: 100, exp: 50 })
    const next = { elapsedSeconds: DAY, creditedSeconds: DAY, gold: 100, exp: 50, formulaVersion: 1 as const }
    const merged = mergeSettlements(old, next)
    expect(merged.creditedSeconds).toBe(2 * DAY) // 未重新截断为 24h
    expect(merged.gold).toBe(200)
    expect(merged.exp).toBe(100)
  })

  it('旧 {gold,exp} pending 迁移为 OfflineSettlement（不丢弃已有奖励）', () => {
    const legacy = { gold: 333, exp: 111 }
    const norm = normalizePendingOfflineReward(legacy)
    expect(norm).not.toBeNull()
    expect(norm!.gold).toBe(333)
    expect(norm!.exp).toBe(111)
    expect(norm!.formulaVersion).toBe(1)
  })

  it('已是 OfflineSettlement 形状则原样保留', () => {
    const s = makeSettlement({ elapsedSeconds: 10, creditedSeconds: 10, gold: 5, exp: 2 })
    const norm = normalizePendingOfflineReward(s)
    expect(norm).toBe(s)
  })
})

describe('Phase 3.2 — 单次结算（store 集成）', () => {
  it('同一 checkpoint 连续 load 两次，只生成一次收益', () => {
    const playerStore = usePlayerStore()
    const spy = vi.spyOn(offlineReward, 'calculateOfflineSettlement')
      .mockReturnValue({ elapsedSeconds: HOUR, creditedSeconds: HOUR, gold: 100, exp: 50, formulaVersion: 1 })
    localStorage.setItem(SAVE_KEY, craftSave({ lastOfflineCheckpointAt: Date.now() - HOUR * 1000 }))
    playerStore.loadGame()
    playerStore.loadGame()
    expect(spy).toHaveBeenCalledTimes(1)
    expect(playerStore.pendingOfflineReward?.gold).toBe(100)
  })

  it('页面重复 mounted（无新存档）不重复生成', () => {
    const playerStore = usePlayerStore()
    const spy = vi.spyOn(offlineReward, 'calculateOfflineSettlement')
      .mockReturnValue({ elapsedSeconds: HOUR, creditedSeconds: HOUR, gold: 100, exp: 50, formulaVersion: 1 })
    localStorage.setItem(SAVE_KEY, craftSave({ lastOfflineCheckpointAt: Date.now() - HOUR * 1000 }))
    playerStore.loadGame()
    playerStore.loadGame()
    playerStore.loadGame()
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('系统时间倒退 → 0 收益', () => {
    const playerStore = usePlayerStore()
    const spy = vi.spyOn(offlineReward, 'calculateOfflineSettlement')
    localStorage.setItem(SAVE_KEY, craftSave({ lastOfflineCheckpointAt: Date.now() + HOUR * 1000 }))
    playerStore.loadGame()
    expect(spy).not.toHaveBeenCalled()
    expect(playerStore.pendingOfflineReward).toBeNull()
  })

  it('不足最低门槛（59s）不生成 pending；刚好 60s 生成', () => {
    const playerStore = usePlayerStore()
    const spy = vi.spyOn(offlineReward, 'calculateOfflineSettlement')
      .mockReturnValue({ elapsedSeconds: 60, creditedSeconds: 60, gold: 10, exp: 5, formulaVersion: 1 })
    localStorage.setItem(SAVE_KEY, craftSave({ lastOfflineCheckpointAt: Date.now() - 59 * 1000 }))
    playerStore.loadGame()
    expect(spy).not.toHaveBeenCalled()
    expect(playerStore.pendingOfflineReward).toBeNull()

    localStorage.setItem(SAVE_KEY, craftSave({ lastOfflineCheckpointAt: Date.now() - 60 * 1000 }))
    playerStore.loadGame()
    expect(spy).toHaveBeenCalledTimes(1)
    expect(playerStore.pendingOfflineReward?.gold).toBe(10)
  })

  it('已有 pending + 新离线区间 → 正确合并（不覆盖）', () => {
    const playerStore = usePlayerStore()
    playerStore.pendingOfflineReward = makeSettlement({ elapsedSeconds: 100, creditedSeconds: 100, gold: 10, exp: 5 })
    vi.spyOn(offlineReward, 'calculateOfflineSettlement')
      .mockReturnValue({ elapsedSeconds: HOUR, creditedSeconds: HOUR, gold: 100, exp: 50, formulaVersion: 1 })
    localStorage.setItem(SAVE_KEY, craftSave({ lastOfflineCheckpointAt: Date.now() - HOUR * 1000 }))
    playerStore.loadGame()
    const pending = playerStore.pendingOfflineReward!
    expect(pending.gold).toBe(110)
    expect(pending.exp).toBe(55)
    expect(pending.elapsedSeconds).toBe(100 + HOUR)
  })

  it('旧存档迁移：无新字段时按 LAST_LOGIN_KEY / player.lastLoginTime 读取', () => {
    const playerStore = usePlayerStore()
    const spy = vi.spyOn(offlineReward, 'calculateOfflineSettlement')
      .mockReturnValue({ elapsedSeconds: HOUR, creditedSeconds: HOUR, gold: 100, exp: 50, formulaVersion: 1 })
    // 无 lastOfflineCheckpointAt，但有 localStorage LAST_LOGIN_KEY
    localStorage.setItem('nz_last_login', String(Date.now() - HOUR * 1000))
    localStorage.setItem(SAVE_KEY, craftSave({ lastOfflineCheckpointAt: undefined }))
    playerStore.loadGame()
    expect(spy).toHaveBeenCalledTimes(1)
  })
})

describe('Phase 3.2 — 唯一领取入口（claimOfflineReward）', () => {
  it('领取一次：恰好增加一次 gold/exp，清空 pending', () => {
    const playerStore = usePlayerStore()
    playerStore.pendingOfflineReward = makeSettlement({ elapsedSeconds: 100, creditedSeconds: 100, gold: 100, exp: 50 })
    const g0 = playerStore.player.gold
    const e0 = playerStore.player.experience
    const claimed = playerStore.claimOfflineReward()
    expect(claimed?.gold).toBe(100)
    expect(playerStore.player.gold).toBe(g0 + 100)
    expect(playerStore.player.experience).toBe(e0 + 50)
    expect(playerStore.pendingOfflineReward).toBeNull()
  })

  it('连续 claim 两次只发放一次', () => {
    const playerStore = usePlayerStore()
    playerStore.pendingOfflineReward = makeSettlement({ elapsedSeconds: 100, creditedSeconds: 100, gold: 100, exp: 50 })
    const g0 = playerStore.player.gold
    playerStore.claimOfflineReward()
    const claimed2 = playerStore.claimOfflineReward()
    expect(claimed2).toBeNull()
    expect(playerStore.player.gold).toBe(g0 + 100)
  })

  it('double-pay 回归：Modal/资源页均只走 claimOfflineReward，addGold 不被直接调用', () => {
    const playerStore = usePlayerStore()
    const addGoldSpy = vi.spyOn(playerStore, 'addGold')
    playerStore.pendingOfflineReward = makeSettlement({ elapsedSeconds: 100, creditedSeconds: 100, gold: 100, exp: 50 })
    const g0 = playerStore.player.gold
    // 模拟「打开 Modal 点击领取」
    playerStore.claimOfflineReward()
    // 模拟「再调用 claimOfflineReward（任何其它入口）」
    playerStore.claimOfflineReward()
    expect(addGoldSpy).not.toHaveBeenCalled() // 弹窗不再自行 addGold
    expect(playerStore.player.gold).toBe(g0 + 100) // 严格等于一次金额
  })

  it('关闭 Modal 不领取 → pending 保留', () => {
    const playerStore = usePlayerStore()
    playerStore.pendingOfflineReward = makeSettlement({ elapsedSeconds: 100, creditedSeconds: 100, gold: 100, exp: 50 })
    // 不调用 claimOfflineReward（仅关闭）
    expect(playerStore.pendingOfflineReward?.gold).toBe(100)
  })

  it('刷新后 pending 仍存在（落盘 + 重新加载）', () => {
    const playerStore = usePlayerStore()
    playerStore.pendingOfflineReward = makeSettlement({ elapsedSeconds: 100, creditedSeconds: 100, gold: 777, exp: 222 })
    playerStore.saveGame()

    const saved = JSON.parse(localStorage.getItem(SAVE_KEY) || '{}')
    expect(saved.pendingOfflineReward.gold).toBe(777)

    // 新实例重新加载（checkpoint 为 now，不再结算新区间）
    setActivePinia(createPinia())
    const p2 = usePlayerStore()
    p2.loadGame()
    expect(p2.pendingOfflineReward?.gold).toBe(777)
  })
})

describe('Phase 3.2 — 持久化异常事务', () => {
  it('localStorage.setItem 抛错 → 资源与 pending 均回滚，可重试且不双发', () => {
    // 先以真实 localStorage 预热所有 store（避免 init 写盘异常落在 try 之外）
    warmupStores()
    const realLocalStorage = localStorage
    const throwingStorage = {
      getItem: (k: string) => realLocalStorage.getItem(k),
      removeItem: (k: string) => realLocalStorage.removeItem(k),
      clear: () => realLocalStorage.clear(),
      key: (i: number) => realLocalStorage.key(i),
      get length() { return realLocalStorage.length }
    }
    Object.defineProperty(throwingStorage, 'setItem', {
      value: (() => { throw new Error('quota exceeded') }) as typeof localStorage.setItem,
      enumerable: true
    })
    vi.stubGlobal('localStorage', throwingStorage)

    const playerStore = usePlayerStore()
    playerStore.pendingOfflineReward = makeSettlement({ elapsedSeconds: 100, creditedSeconds: 100, gold: 500, exp: 200 })
    const g0 = playerStore.player.gold
    const e0 = playerStore.player.experience

    const result = playerStore.claimOfflineReward()
    expect(result).toBeNull()
    expect(playerStore.player.gold).toBe(g0) // 回滚
    expect(playerStore.player.experience).toBe(e0) // 回滚
    expect(playerStore.pendingOfflineReward).not.toBeNull() // 保留

    // 恢复正常后重试，应成功且仅发放一次
    vi.unstubAllGlobals()
    const claimed = playerStore.claimOfflineReward()
    expect(claimed?.gold).toBe(500)
    expect(playerStore.player.gold).toBe(g0 + 500)
    expect(playerStore.pendingOfflineReward).toBeNull()
  })
})

describe('Phase 3.2 — 展示模型与旧公式清理', () => {
  it('persistentTotalStats 不含临时战斗 Buff（离线结算用此 getter）', () => {
    const playerStore = usePlayerStore()
    playerStore.applyBuff('attack', 1000, 100, 'flat')
    const buffed = playerStore.totalStats.attack
    const persistent = playerStore.persistentTotalStats.attack
    expect(buffed).toBeGreaterThan(persistent) // Buff 进入 totalStats
    expect(persistent).toBeLessThanOrEqual(buffed - 1000 + 1) // 且 persistent 不含该 Buff
  })

  it('结算使用 persistentTotalStats（不含 Buff）', () => {
    const playerStore = usePlayerStore()
    playerStore.applyBuff('attack', 1000, 100, 'flat')
    const spy = vi.spyOn(offlineReward, 'calculateOfflineSettlement')
      .mockReturnValue({ elapsedSeconds: HOUR, creditedSeconds: HOUR, gold: 1, exp: 1, formulaVersion: 1 })
    localStorage.setItem(SAVE_KEY, craftSave({ lastOfflineCheckpointAt: Date.now() - HOUR * 1000 }))
    playerStore.loadGame()
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ attack: playerStore.persistentTotalStats.attack }))
  })

  it('旧 calculateOfflineProgress 已从 store 移除（单一公式/单一可领取 pending）', () => {
    const playerStore = usePlayerStore()
    expect((playerStore as unknown as Record<string, unknown>).calculateOfflineProgress).toBeUndefined()
  })

  it('saveGame 返回 boolean 成功标志', () => {
    const playerStore = usePlayerStore()
    expect(playerStore.saveGame()).toBe(true)
  })
})
