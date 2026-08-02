import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
// @ts-ignore —— 测试运行于 Node，无需在应用 tsconfig 中引入 @types/node 全局类型
import { readFileSync } from 'node:fs'
// @ts-ignore
import { resolve } from 'node:path'
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
import { useCollectionStore } from './collectionStore'
import { GO_BACK_LEVELS, GO_BACK_DIAMOND_COST } from './gameStore'
// @ts-ignore
declare const process: { cwd(): string }

const SAVE_KEY = 'lollipop_adventure_save'

/**
 * Phase 3.33 — 返回 10 层钻石购买（跨 Store 原子事务）。
 *
 * 事务本体：gameStore.tryPurchaseGoBackLevels —— 前置校验 → 快照 → 扣 50 钻 →
 * 怪物进度返回 10 层 → 满血 → 恰好一次 saveGame → 成功返回；任何校验失败、异常、
 * rng 抛错、存档失败都必须完整回滚 diamond / currentHp / difficultyValue /
 * monsterLevel / currentMonster（原引用）/ currentEncounterId，且磁盘不变。
 *
 * 危险与失败用例均使用真实可变化的初始状态，证明断言发生在「候选修改后成功回滚」，
 * 而非事务在修改前偶然退出。
 */

function warmupStores() {
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
  useCollectionStore()
}

/** 主存档 setItem 抛错（模拟写盘失败），读取委托真实 storage。 */
function installThrowingStorage() {
  const realStorage = localStorage
  const throwingStorage = {
    get length() {
      return realStorage.length
    },
    clear: () => realStorage.clear(),
    getItem: (k: string) => realStorage.getItem(k),
    key: (i: number) => realStorage.key(i),
    removeItem: (k: string) => realStorage.removeItem(k),
    setItem: (_k: string, _v: string) => {
      throw new Error('quota exceeded')
    }
  }
  vi.stubGlobal('localStorage', throwingStorage)
}

/** 快照被测事务相关的全部状态。 */
function snapshotState() {
  const playerStore = usePlayerStore()
  const monsterStore = useMonsterStore()
  return {
    diamond: playerStore.player.diamond,
    currentHp: playerStore.player.currentHp,
    maxHp: playerStore.player.maxHp,
    difficultyValue: monsterStore.difficultyValue,
    monsterLevel: monsterStore.monsterLevel,
    currentMonster: monsterStore.currentMonster,
    currentEncounterId: monsterStore.currentEncounterId
  }
}

/** 设置一个真实可变化的初始状态：100 钻、半血、难度/等级 20、真实怪物。 */
function seedValidState() {
  const playerStore = usePlayerStore()
  const monsterStore = useMonsterStore()
  playerStore.player.diamond = 100
  playerStore.player.currentHp = 40
  playerStore.player.maxHp = 100
  monsterStore.setProgress(20, 20) // 真实生成 currentMonster，encounterId +1
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

describe('Phase 3.33 — tryPurchaseGoBackLevels 正常事务', () => {
  it('正常购买：100→50 钻、difficulty 20→10、monsterLevel 20→10、满血、换怪、encounterId+1、saveGame 恰一次', () => {
    seedValidState()
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    const gameStore = useGameStore()

    const oldMonster = monsterStore.currentMonster
    const encBefore = monsterStore.currentEncounterId
    const saveSpy = vi.spyOn(playerStore, 'saveGame')

    const res = gameStore.tryPurchaseGoBackLevels(() => 0.5)

    expect(res).toMatchObject({ ok: true, levels: GO_BACK_LEVELS, cost: GO_BACK_DIAMOND_COST })
    expect(playerStore.player.diamond).toBe(50)
    expect(monsterStore.difficultyValue).toBe(10)
    expect(monsterStore.monsterLevel).toBe(10)
    expect(playerStore.player.currentHp).toBe(100) // 满血 = maxHp
    expect(monsterStore.currentMonster).not.toBe(oldMonster) // 换怪
    expect(monsterStore.currentEncounterId).toBe(encBefore + 1) // encounterId 恰好 +1
    expect(saveSpy).toHaveBeenCalledTimes(1)
    expect(res).toMatchObject({ difficultyValue: 10, monsterLevel: 10 })
  })

  it('difficulty < 10 时钳制到 0；monsterLevel < 10 时钳制到 1', () => {
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    const gameStore = useGameStore()
    playerStore.player.diamond = 100
    playerStore.player.currentHp = 50
    playerStore.player.maxHp = 100
    monsterStore.setProgress(5, 5)
    vi.spyOn(playerStore, 'saveGame')

    const res = gameStore.tryPurchaseGoBackLevels(() => 0.5)

    expect(res.ok).toBe(true)
    expect(monsterStore.difficultyValue).toBe(0)
    expect(monsterStore.monsterLevel).toBe(1)
    expect(res).toMatchObject({ difficultyValue: 0, monsterLevel: 1 })
  })

  it('恰好 50 钻允许成功并变为 0', () => {
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    const gameStore = useGameStore()
    playerStore.player.diamond = 50
    playerStore.player.currentHp = 40
    playerStore.player.maxHp = 100
    monsterStore.setProgress(20, 20)
    vi.spyOn(playerStore, 'saveGame')

    const res = gameStore.tryPurchaseGoBackLevels(() => 0.5)

    expect(res.ok).toBe(true)
    expect(playerStore.player.diamond).toBe(0)
  })
})

describe('Phase 3.33 — 前置校验 fail-closed', () => {
  it('不足 50 钻：零修改、rng 未调用、saveGame 未调用', () => {
    seedValidState()
    const playerStore = usePlayerStore()
    const gameStore = useGameStore()
    playerStore.player.diamond = 49
    const before = snapshotState()
    const saveSpy = vi.spyOn(playerStore, 'saveGame')
    const rng = vi.fn(() => 0.5)

    const res = gameStore.tryPurchaseGoBackLevels(rng)

    expect(res).toEqual({ ok: false, reason: 'insufficient diamond', cost: 0 })
    expect(rng).not.toHaveBeenCalled()
    expect(saveSpy).not.toHaveBeenCalled()
    expect(snapshotState()).toEqual(before)
  })

  it('diamond 为 NaN / Infinity / 负数 / 小数 → fail-closed', () => {
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    const gameStore = useGameStore()
    monsterStore.setProgress(20, 20)
    for (const bad of [NaN, Infinity, -1, 10.5]) {
      playerStore.player.diamond = bad as number
      playerStore.player.currentHp = 40
      playerStore.player.maxHp = 100
      const before = snapshotState()
      const saveSpy = vi.spyOn(playerStore, 'saveGame')
      const res = gameStore.tryPurchaseGoBackLevels(() => 0.5)
      expect(res.ok).toBe(false)
      expect(res.cost).toBe(0)
      expect(saveSpy).not.toHaveBeenCalled()
      expect(snapshotState()).toEqual(before)
      saveSpy.mockRestore()
    }
  })

  it('HP / maxHp 损坏 → fail-closed', () => {
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    const gameStore = useGameStore()
    monsterStore.setProgress(20, 20)
    playerStore.player.diamond = 100
    const cases = [
      { currentHp: NaN, maxHp: 100 },
      { currentHp: -1, maxHp: 100 },
      { currentHp: 40, maxHp: NaN },
      { currentHp: 40, maxHp: 0 },
      { currentHp: 40, maxHp: -10 }
    ]
    for (const hp of cases) {
      playerStore.player.currentHp = hp.currentHp
      playerStore.player.maxHp = hp.maxHp
      const before = snapshotState()
      const saveSpy = vi.spyOn(playerStore, 'saveGame')
      const res = gameStore.tryPurchaseGoBackLevels(() => 0.5)
      expect(res.ok).toBe(false)
      expect(res.cost).toBe(0)
      expect(saveSpy).not.toHaveBeenCalled()
      expect(snapshotState()).toEqual(before)
      saveSpy.mockRestore()
    }
  })

  it('怪物进度损坏或 currentMonster 缺失 → fail-closed', () => {
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    const gameStore = useGameStore()
    playerStore.player.diamond = 100
    playerStore.player.currentHp = 40
    playerStore.player.maxHp = 100
    const cases: Array<{ difficulty: number; level: number; monster: boolean }> = [
      { difficulty: NaN, level: 1, monster: true },
      { difficulty: -1, level: 1, monster: true },
      { difficulty: 20, level: 0, monster: true },
      { difficulty: 20, level: NaN, monster: true },
      { difficulty: 20, level: 1, monster: false }
    ]
    for (const c of cases) {
      monsterStore.setProgress(20, 1)
      monsterStore.difficultyValue = c.difficulty
      monsterStore.monsterLevel = c.level
      if (!c.monster) monsterStore.currentMonster = null
      const before = snapshotState()
      const saveSpy = vi.spyOn(playerStore, 'saveGame')
      const res = gameStore.tryPurchaseGoBackLevels(() => 0.5)
      expect(res.ok).toBe(false)
      expect(res.cost).toBe(0)
      expect(saveSpy).not.toHaveBeenCalled()
      expect(snapshotState()).toEqual(before)
      saveSpy.mockRestore()
    }
  })

  it('rng 非函数 → fail-closed，零修改', () => {
    seedValidState()
    const playerStore = usePlayerStore()
    const gameStore = useGameStore()
    const before = snapshotState()
    const saveSpy = vi.spyOn(playerStore, 'saveGame')

    const res = gameStore.tryPurchaseGoBackLevels(42 as unknown as () => number)

    expect(res).toEqual({ ok: false, reason: 'rng must be a function', cost: 0 })
    expect(saveSpy).not.toHaveBeenCalled()
    expect(snapshotState()).toEqual(before)
  })
})

describe('Phase 3.33 — 异常与保存失败完整回滚', () => {
  it('rng 抛异常：钻石/HP/进度/怪物引用/encounterId 全部恢复，saveGame 未调用', () => {
    seedValidState()
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    const gameStore = useGameStore()
    const before = snapshotState()
    const saveSpy = vi.spyOn(playerStore, 'saveGame')

    const res = gameStore.tryPurchaseGoBackLevels(() => {
      throw new Error('rng boom')
    })

    expect(res.ok).toBe(false)
    expect(res.cost).toBe(0)
    expect(saveSpy).not.toHaveBeenCalled()
    // 必须恢复原引用（不换新对象）
    expect(monsterStore.currentMonster).toBe(before.currentMonster)
    expect(snapshotState()).toEqual(before)
  })

  it('saveGame 返回 false：所有状态完整恢复，返回 ok:false/cost:0，不重试保存', () => {
    seedValidState()
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    const gameStore = useGameStore()
    const before = snapshotState()
    const saveSpy = vi.spyOn(playerStore, 'saveGame').mockReturnValue(false)

    const res = gameStore.tryPurchaseGoBackLevels(() => 0.5)

    expect(res).toEqual({ ok: false, reason: 'save failed', cost: 0 })
    expect(saveSpy).toHaveBeenCalledTimes(1) // 恰好一次，失败后不重试
    expect(monsterStore.currentMonster).toBe(before.currentMonster)
    expect(snapshotState()).toEqual(before)
  })

  it('saveGame 直接抛异常：与返回 false 相同地完整回滚', () => {
    seedValidState()
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    const gameStore = useGameStore()
    const before = snapshotState()
    const saveSpy = vi
      .spyOn(playerStore, 'saveGame')
      .mockImplementation(() => {
        throw new Error('disk full')
      })

    const res = gameStore.tryPurchaseGoBackLevels(() => 0.5)

    expect(res.ok).toBe(false)
    expect(res.cost).toBe(0)
    expect(saveSpy).toHaveBeenCalledTimes(1)
    expect(monsterStore.currentMonster).toBe(before.currentMonster)
    expect(snapshotState()).toEqual(before)
  })

  it('写盘失败（localStorage setItem 抛错）：磁盘内容不变，状态完整恢复', () => {
    seedValidState()
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    const gameStore = useGameStore()

    playerStore.saveGame() // 先正常落盘一份基线
    const diskBefore = localStorage.getItem(SAVE_KEY)
    const before = snapshotState()

    installThrowingStorage()
    const res = gameStore.tryPurchaseGoBackLevels(() => 0.5)
    vi.unstubAllGlobals()

    expect(res.ok).toBe(false)
    expect(res.cost).toBe(0)
    expect(localStorage.getItem(SAVE_KEY)).toBe(diskBefore) // 磁盘不变
    expect(monsterStore.currentMonster).toBe(before.currentMonster)
    expect(snapshotState()).toEqual(before)
  })
})

describe('Phase 3.33 — 架构护栏', () => {
  const ROOT = process.cwd()

  it('App.vue handler 只委托 gameStore.tryPurchaseGoBackLevels', () => {
    const app = readFileSync(resolve(ROOT, 'src/App.vue'), 'utf8')
    const m = app.match(/function goBackLevels\(\)\s*\{[^}]*\}/)
    expect(m).toBeTruthy()
    expect(m![0]).toContain('gameStore.tryPurchaseGoBackLevels()')
    // 不得直接修改 diamond / currentHp、调 monsterStore.goBackLevels / revive / saveGame
    expect(m![0]).not.toMatch(/diamond\s*-=/)
    expect(m![0]).not.toMatch(/currentHp\s*=/)
    expect(m![0]).not.toMatch(/monsterStore\.goBackLevels/)
    expect(m![0]).not.toMatch(/playerStore\.revive/)
    expect(m![0]).not.toMatch(/saveGame/)
  })

  it('ShopTab 使用 GO_BACK_DIAMOND_COST 统一价格，无硬编码 50', () => {
    const shop = readFileSync(resolve(ROOT, 'src/components/ShopTab.vue'), 'utf8')
    expect(shop).toContain("import { GO_BACK_DIAMOND_COST } from '../stores/gameStore'")
    expect(shop).toContain('playerStore.player.diamond < GO_BACK_DIAMOND_COST')
    expect(shop).toContain('{{ GO_BACK_DIAMOND_COST }}💎')
    expect(shop).not.toMatch(/diamond\s*<\s*50/)
    expect(shop).not.toMatch(/>\s*50💎\s*</)
  })

  it('gameStore 导出权威价格与层数常量', () => {
    expect(GO_BACK_LEVELS).toBe(10)
    expect(GO_BACK_DIAMOND_COST).toBe(50)
  })
})
