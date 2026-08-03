import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
// @ts-ignore —— 测试运行于 Node，无需在应用 tsconfig 中引入 @types/node 全局类型
import { readFileSync } from 'node:fs'
// @ts-ignore
import { resolve } from 'node:path'
import { usePlayerStore } from './playerStore'
import { useThemeStore, normalizeOwnedThemeIds } from './themeStore'
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
import { createDefaultPlayer } from '../utils/calc'
// @ts-ignore
declare const process: { cwd(): string }

const SAVE_KEY = 'lollipop_adventure_save'
const OWNED_KEY = 'nz_owned_themes'
const THEME_KEY = 'nz_theme'

/**
 * Phase 3.35 — 主题购买（主存档单一原子事务）。
 *
 * 事务本体：playerStore.tryPurchaseTheme —— 前置校验 → 快照 → 扣钻石 + replaceOwnedThemes →
 * 恰好一次主存档 saveGame → 成功返回；任何校验失败、异常、存档失败都必须完整回滚 diamond 与
 * ownedThemes。nz_owned_themes 只作旧存档迁移来源，不再被任何生产路径写入。
 *
 * themeStore 的 useThemeStore 被部分 mock（真实实现透传）：armed 时第 2 次调用抛异常——
 * 该调用恰好发生在 saveGame 的 saveData 构造阶段（位于 saveGame 内部 try 之外），
 * 用于真实触发「saveGame 直接抛异常」路径（内聚调用无法被 store 方法 spy 拦截）。
 */
const themeThrowState = vi.hoisted(() => ({ armed: false, callCount: 0 }))

vi.mock('./themeStore', async importOriginal => {
  const actual = await importOriginal<typeof import('./themeStore')>()
  return {
    ...actual,
    useThemeStore: () => {
      themeThrowState.callCount++
      if (themeThrowState.armed && themeThrowState.callCount === 2) {
        throw new Error('theme store access failed')
      }
      return actual.useThemeStore()
    }
  }
})

function warmupStores() {
  usePlayerStore()
  useThemeStore()
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

/** 构造一个不带 themeData 的旧主存档 JSON（模拟迁移前存档）。 */
function craftLegacySave(overrides: Record<string, unknown> = {}): string {
  const player = { ...createDefaultPlayer(), ...(overrides.player as object) }
  return JSON.stringify({
    player,
    pendingOfflineReward: null,
    lastOfflineCheckpointAt: Date.now(),
    statUpgradeCounts: [],
    monsterData: { difficultyValue: 1, monsterLevel: 1 },
    gameData: { damageStats: {}, battleLog: [] },
    trainingData: { trainingLevel: 1, trainingDifficulty: 1 },
    runeData: { inventory: [] }
  })
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  warmupStores()
  themeThrowState.armed = false
  themeThrowState.callCount = 0
})

afterEach(() => {
  themeThrowState.armed = false
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('Phase 3.35 — tryPurchaseTheme 正常事务', () => {
  it('购买 flame：100→32 钻、ownedThemes 加入 flame、saveGame 恰一次、主存档同时含 diamond=32 与 flame', () => {
    const playerStore = usePlayerStore()
    const themeStore = useThemeStore()
    playerStore.player.diamond = 100
    themeStore.replaceOwnedThemes(['default'])
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')

    const res = playerStore.tryPurchaseTheme('flame')

    expect(res).toEqual({ ok: true, themeId: 'flame', cost: 68 })
    expect(playerStore.player.diamond).toBe(32)
    expect(themeStore.ownedThemes).toEqual(['default', 'flame'])
    // saveGame 恰好一次 = SAVE_KEY 只被 setItem 写一次
    expect(setItemSpy.mock.calls.filter(c => c[0] === SAVE_KEY).length).toBe(1)
    // 主存档同一 JSON 同时包含 diamond=32 与 flame
    const disk = JSON.parse(localStorage.getItem(SAVE_KEY) as string)
    expect(disk.player.diamond).toBe(32)
    expect(disk.themeData.ownedThemes).toEqual(['default', 'flame'])
  })

  it('重新创建 Pinia 并 loadGame 后，钻石与主题所有权均恢复', () => {
    const playerStore = usePlayerStore()
    const themeStore = useThemeStore()
    playerStore.player.diamond = 100
    themeStore.replaceOwnedThemes(['default'])
    expect(playerStore.tryPurchaseTheme('flame').ok).toBe(true)

    // 重新创建 Pinia（保留 localStorage），loadGame 水合
    setActivePinia(createPinia())
    warmupStores()
    const p2 = usePlayerStore()
    const t2 = useThemeStore()
    p2.loadGame()

    expect(p2.player.diamond).toBe(32)
    expect(t2.ownedThemes).toEqual(['default', 'flame'])
  })

  it('恰好 68 钻购买后变为 0', () => {
    const playerStore = usePlayerStore()
    const themeStore = useThemeStore()
    playerStore.player.diamond = 68
    themeStore.replaceOwnedThemes(['default'])
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')

    const res = playerStore.tryPurchaseTheme('flame')

    expect(res.ok).toBe(true)
    expect(playerStore.player.diamond).toBe(0)
    expect(setItemSpy.mock.calls.filter(c => c[0] === SAVE_KEY).length).toBe(1)
  })
})

describe('Phase 3.35 — 前置校验 fail-closed', () => {
  it('钻石不足：零修改、零写盘', () => {
    const playerStore = usePlayerStore()
    const themeStore = useThemeStore()
    playerStore.player.diamond = 10
    themeStore.replaceOwnedThemes(['default'])
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')

    const res = playerStore.tryPurchaseTheme('flame')

    expect(res).toEqual({ ok: false, reason: 'insufficient diamond', cost: 0 })
    expect(playerStore.player.diamond).toBe(10)
    expect(themeStore.ownedThemes).toEqual(['default'])
    expect(setItemSpy.mock.calls.filter(c => c[0] === SAVE_KEY).length).toBe(0)
  })

  it('未知主题、免费主题、已拥有主题全部 fail-closed', () => {
    const playerStore = usePlayerStore()
    const themeStore = useThemeStore()
    playerStore.player.diamond = 1000
    themeStore.replaceOwnedThemes(['default', 'flame'])
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')

    expect(playerStore.tryPurchaseTheme('nonexistent')).toEqual({ ok: false, reason: 'unknown theme', cost: 0 })
    expect(playerStore.tryPurchaseTheme('')).toEqual({ ok: false, reason: 'invalid theme id', cost: 0 })
    expect(playerStore.tryPurchaseTheme('default')).toEqual({ ok: false, reason: 'theme is free', cost: 0 })
    expect(playerStore.tryPurchaseTheme('flame')).toEqual({ ok: false, reason: 'already owned', cost: 0 })
    expect(playerStore.player.diamond).toBe(1000)
    expect(themeStore.ownedThemes).toEqual(['default', 'flame'])
    expect(setItemSpy.mock.calls.filter(c => c[0] === SAVE_KEY).length).toBe(0)
  })

  it('diamond 为 NaN、Infinity、负数或小数时 fail-closed', () => {
    const playerStore = usePlayerStore()
    const themeStore = useThemeStore()
    themeStore.replaceOwnedThemes(['default'])
    for (const bad of [NaN, Infinity, -1, 10.5]) {
      playerStore.player.diamond = bad as number
      const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
      const res = playerStore.tryPurchaseTheme('flame')
      expect(res.ok).toBe(false)
      expect(res.cost).toBe(0)
      expect(themeStore.ownedThemes).toEqual(['default'])
      expect(setItemSpy.mock.calls.filter(c => c[0] === SAVE_KEY).length).toBe(0)
      setItemSpy.mockRestore()
    }
  })

  it('ownedThemes 含重复、未知 ID、非字符串或缺少 default 时 fail-closed', () => {
    const playerStore = usePlayerStore()
    const themeStore = useThemeStore()
    playerStore.player.diamond = 100
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')

    const badStates: (string[] | (string | number)[])[] = [
      ['default', 'flame', 'flame'], // 重复
      ['default', 'bogus'], // 未知
      ['default', 42 as unknown as string], // 非字符串（cast 模拟损坏存档）
      ['flame'] // 缺少 default
    ]
    for (const bad of badStates) {
      themeStore.ownedThemes = bad as string[]
      const res = playerStore.tryPurchaseTheme('ice')
      expect(res.ok).toBe(false)
      expect(res.cost).toBe(0)
      expect(playerStore.player.diamond).toBe(100)
      expect(setItemSpy.mock.calls.filter(c => c[0] === SAVE_KEY).length).toBe(0)
    }
  })
})

describe('Phase 3.35 — 保存失败完整回滚', () => {
  it('saveGame 返回 false（真实 setItem 抛错）：钻石与完整 ownedThemes 回滚', () => {
    const playerStore = usePlayerStore()
    const themeStore = useThemeStore()
    playerStore.player.diamond = 100
    themeStore.replaceOwnedThemes(['default'])
    playerStore.saveGame() // 先正常落盘基线
    const diskBefore = localStorage.getItem(SAVE_KEY)

    installThrowingStorage()
    const res = playerStore.tryPurchaseTheme('flame')
    vi.unstubAllGlobals()

    expect(res).toEqual({ ok: false, reason: 'save failed', cost: 0 })
    expect(playerStore.player.diamond).toBe(100)
    expect(themeStore.ownedThemes).toEqual(['default'])
    expect(localStorage.getItem(SAVE_KEY)).toBe(diskBefore) // 磁盘不变
  })

  it('saveGame 直接抛异常（themeData 构造抛错）：同样完整回滚', () => {
    const playerStore = usePlayerStore()
    const themeStore = useThemeStore()
    playerStore.player.diamond = 100
    themeStore.replaceOwnedThemes(['default'])
    playerStore.saveGame() // 基线落盘（armed=false 时 useThemeStore 正常）
    const diskBefore = localStorage.getItem(SAVE_KEY)

    themeThrowState.armed = true
    themeThrowState.callCount = 0
    const res = playerStore.tryPurchaseTheme('flame')
    themeThrowState.armed = false

    expect(res.ok).toBe(false)
    expect(res.cost).toBe(0)
    expect(playerStore.player.diamond).toBe(100)
    expect(themeStore.ownedThemes).toEqual(['default'])
    expect(localStorage.getItem(SAVE_KEY)).toBe(diskBefore)
  })
})

describe('Phase 3.35 — legacy 迁移与规范化', () => {
  it('legacy nz_owned_themes 能迁移进入主存档', () => {
    // 旧存档：主存档无 themeData，但 legacy key 有 flame
    localStorage.setItem(OWNED_KEY, JSON.stringify(['flame']))
    localStorage.setItem(SAVE_KEY, craftLegacySave())
    setActivePinia(createPinia())
    warmupStores()
    const playerStore = usePlayerStore()
    const themeStore = useThemeStore()

    playerStore.loadGame() // 缺失 themeData → 用 legacy；末尾 saveGame(now) 迁移

    expect(themeStore.ownedThemes).toContain('flame')
    const disk = JSON.parse(localStorage.getItem(SAVE_KEY) as string)
    expect(disk.themeData.ownedThemes).toContain('flame') // 已写入主存档
  })

  it('legacy JSON 损坏不会令 themeStore 创建或 loadGame 抛异常', () => {
    localStorage.setItem(OWNED_KEY, '{corrupted json')
    localStorage.setItem(SAVE_KEY, craftLegacySave())
    setActivePinia(createPinia())
    let themeStore: ReturnType<typeof useThemeStore>
    expect(() => {
      warmupStores()
      themeStore = useThemeStore()
      const playerStore = usePlayerStore()
      playerStore.loadGame()
      expect(themeStore!.ownedThemes).toEqual(['default'])
    }).not.toThrow()
  })

  it('主存档 themeData 优先于陈旧 legacy key', () => {
    localStorage.setItem(OWNED_KEY, JSON.stringify(['flame']))
    const save = JSON.parse(craftLegacySave())
    save.themeData = { ownedThemes: ['ice'] }
    localStorage.setItem(SAVE_KEY, JSON.stringify(save))
    setActivePinia(createPinia())
    warmupStores()
    const playerStore = usePlayerStore()
    const themeStore = useThemeStore()

    playerStore.loadGame()

    expect(themeStore.ownedThemes).toEqual(['default', 'ice'])
    expect(themeStore.ownedThemes).not.toContain('flame')
  })

  it('normalizeOwnedThemeIds 去除未知、重复 ID并保留 default', () => {
    expect(normalizeOwnedThemeIds(['flame', 'flame', 'bogus', 42, 'ice'])).toEqual(['default', 'flame', 'ice'])
    expect(normalizeOwnedThemeIds(['ice'])).toEqual(['default', 'ice'])
    expect(normalizeOwnedThemeIds(null)).toEqual(['default'])
    expect(normalizeOwnedThemeIds('not array')).toEqual(['default'])
    expect(normalizeOwnedThemeIds([])).toEqual(['default'])
  })

  it('成功购买过程中不写 nz_owned_themes', () => {
    const playerStore = usePlayerStore()
    const themeStore = useThemeStore()
    playerStore.player.diamond = 100
    themeStore.replaceOwnedThemes(['default'])

    expect(playerStore.tryPurchaseTheme('flame').ok).toBe(true)

    expect(localStorage.getItem(OWNED_KEY)).toBeNull() // legacy key 不被写入
    const disk = JSON.parse(localStorage.getItem(SAVE_KEY) as string)
    expect(disk.themeData.ownedThemes).toEqual(['default', 'flame'])
  })
})

describe('Phase 3.35 — 当前主题选择不回归', () => {
  it('setTheme 与 nz_theme 行为不变：已拥有主题可选中并持久化偏好', () => {
    const themeStore = useThemeStore()
    themeStore.replaceOwnedThemes(['default', 'flame'])

    themeStore.setTheme('flame')

    expect(themeStore.currentThemeId).toBe('flame')
    expect(localStorage.getItem(THEME_KEY)).toBe('flame')
  })
})

describe('Phase 3.35 — 架构护栏', () => {
  const ROOT = process.cwd()

  it('ThemeShop handler 只委托 tryPurchaseTheme，不含 spendDiamonds / unlockTheme / localStorage', () => {
    const src = readFileSync(resolve(ROOT, 'src/components/ThemeShop.vue'), 'utf8')
    const m = src.match(/function buyTheme\(themeId: string\)\s*\{[\s\S]*?\n\}/)
    expect(m).toBeTruthy()
    const body = m![0]
    expect(body).toContain('playerStore.tryPurchaseTheme(themeId)')
    expect(body).toContain("alert('钻石不足')")
    expect(body).not.toMatch(/spendDiamonds/)
    expect(body).not.toMatch(/unlockTheme/)
    expect(body).not.toMatch(/localStorage/)
  })

  it('themeStore.unlockTheme 不再写 legacy key；replaceOwnedThemes 为纯内存入口', () => {
    const src = readFileSync(resolve(ROOT, 'src/stores/themeStore.ts'), 'utf8')
    const unlock = src.match(/function unlockTheme\(themeId: string\)(?:: boolean)?\s*\{[\s\S]*?\n  \}/)
    expect(unlock).toBeTruthy()
    expect(unlock![0]).not.toMatch(/localStorage/)
    expect(unlock![0]).not.toMatch(/saveOwned/)

    const replace = src.match(/function replaceOwnedThemes\(themeIds: readonly string\[\]\)(?:: void)?\s*\{[\s\S]*?\n  \}/)
    expect(replace).toBeTruthy()
    expect(replace![0]).not.toMatch(/localStorage/)
  })
})
