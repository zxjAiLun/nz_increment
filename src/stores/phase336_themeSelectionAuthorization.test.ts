import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
// @ts-ignore —— 测试运行于 Node，无需在应用 tsconfig 中引入 @types/node 全局类型
import { readFileSync } from 'node:fs'
// @ts-ignore
import { resolve } from 'node:path'
import { usePlayerStore } from './playerStore'
import { useThemeStore, resolveAuthorizedThemeId } from './themeStore'
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
 * Phase 3.36 — 当前主题选择受主存档所有权授权。
 *
 * 主题访问权限唯一权威 = themeData.ownedThemes；nz_theme 只是显示偏好，不能授予所有权。
 * - resolveAuthorizedThemeId：纯授权解析（规范化 owned → 非空精确字符串 → 存在于 THEMES →
 *   存在于 canonical owned），任一失败回退 default，不抛异常；
 * - reconcileCurrentTheme：对账入口，未授权收敛 default 并应用正确 CSS，nz_theme 修复写盘
 *   失败不阻塞内存/CSS；
 * - setTheme：返回 boolean，严格校验存在/已拥有/不 trim，写盘失败返回 false 且状态与 CSS 不变；
 * - unlockTheme 旁路解锁已删除；所有权新增只走 tryPurchaseTheme / replaceOwnedThemes。
 */

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

/** 构造一个含指定 themeData 的主存档 JSON。 */
function craftSave(themeData: unknown, playerOverrides: Record<string, unknown> = {}): string {
  const player = { ...createDefaultPlayer(), ...playerOverrides }
  return JSON.stringify({
    player,
    pendingOfflineReward: null,
    lastOfflineCheckpointAt: Date.now(),
    statUpgradeCounts: [],
    monsterData: { difficultyValue: 1, monsterLevel: 1 },
    gameData: { damageStats: {}, battleLog: [] },
    trainingData: { trainingLevel: 1, trainingDifficulty: 1 },
    runeData: { inventory: [] },
    themeData
  })
}

function cssVar(name: string): string | null {
  return document.documentElement.style.getPropertyValue(name) || null
}

/** 安装一个 nz_theme 写入抛错的 storage（读取委托真实实现）。 */
function installThemeWriteThrowingStorage() {
  const realStorage = localStorage
  const throwingStorage = {
    get length() {
      return realStorage.length
    },
    clear: () => realStorage.clear(),
    getItem: (k: string) => realStorage.getItem(k),
    key: (i: number) => realStorage.key(i),
    removeItem: (k: string) => realStorage.removeItem(k),
    setItem: (k: string, _v: string) => {
      if (k === THEME_KEY) throw new Error('theme write failed')
      realStorage.setItem(k, _v)
    }
  }
  vi.stubGlobal('localStorage', throwingStorage)
  return realStorage
}

function applyDefaultCssVars() {
  // 清空 style，让断言能分辨「default 已应用」（default 主色 #4a9eff）
  for (const key of Array.from(document.documentElement.style)) {
    document.documentElement.style.removeProperty(key)
  }
  document.documentElement.style.setProperty('--color-primary', '#4a9eff')
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  // 每次重置 CSS，避免跨用例污染 default 判断
  applyDefaultCssVars()
  warmupStores()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('Phase 3.36 — loadGame 水合后的主题授权对账', () => {
  it('主存档只拥有 default、nz_theme=flame → currentThemeId/currentTheme/CSS 为 default，nz_theme 修复为 default', () => {
    localStorage.setItem(THEME_KEY, 'flame')
    localStorage.setItem(SAVE_KEY, craftSave({ ownedThemes: ['default'] }))
    setActivePinia(createPinia())
    warmupStores()
    const playerStore = usePlayerStore()
    const themeStore = useThemeStore()

    playerStore.loadGame()

    expect(themeStore.currentThemeId).toBe('default')
    expect(themeStore.currentTheme.id).toBe('default')
    expect(cssVar('--color-primary')).toBe('#4a9eff') // default 主色
    expect(localStorage.getItem(THEME_KEY)).toBe('default') // nz_theme 已修复
  })

  it('主存档拥有 ice、nz_theme=ice → 保持 ice，CSS 应用 ice', () => {
    localStorage.setItem(THEME_KEY, 'ice')
    localStorage.setItem(SAVE_KEY, craftSave({ ownedThemes: ['default', 'ice'] }))
    setActivePinia(createPinia())
    warmupStores()
    const playerStore = usePlayerStore()
    const themeStore = useThemeStore()

    playerStore.loadGame()

    expect(themeStore.currentThemeId).toBe('ice')
    expect(themeStore.currentTheme.id).toBe('ice')
    expect(cssVar('--color-primary')).toBe('#00bfff') // ice 主色
    expect(localStorage.getItem(THEME_KEY)).toBe('ice')
  })

  it('nz_theme 为未知 ID、空字符串、纯空白或损坏值 → 全部回退 default', () => {
    const themeStore = useThemeStore()
    themeStore.replaceOwnedThemes(['default'])
    for (const bad of ['bogus', '', '   ', '{corrupt']) {
      themeStore.currentThemeId = bad as string
      const res = themeStore.reconcileCurrentTheme()
      expect(res.changed).toBe(true)
      expect(res.themeId).toBe('default')
      expect(themeStore.currentThemeId).toBe('default')
      expect(themeStore.currentTheme.id).toBe('default')
      expect(cssVar('--color-primary')).toBe('#4a9eff')
      expect(localStorage.getItem(THEME_KEY)).toBe('default')
      themeStore.currentThemeId = 'default'
      localStorage.setItem(THEME_KEY, 'default')
    }
  })

  it('legacy 声称拥有 flame 但主存档只拥有 default → 主存档优先，flame 不得激活', () => {
    localStorage.setItem(OWNED_KEY, JSON.stringify(['flame']))
    localStorage.setItem(THEME_KEY, 'flame')
    localStorage.setItem(SAVE_KEY, craftSave({ ownedThemes: ['default'] }))
    setActivePinia(createPinia())
    warmupStores()
    const playerStore = usePlayerStore()
    const themeStore = useThemeStore()

    playerStore.loadGame()

    expect(themeStore.ownedThemes).toEqual(['default']) // 主存档所有权优先
    expect(themeStore.currentThemeId).toBe('default')
    expect(themeStore.currentTheme.id).toBe('default')
    expect(cssVar('--color-primary')).toBe('#4a9eff')
    expect(localStorage.getItem(THEME_KEY)).toBe('default')
  })

  it('replaceOwnedThemes 后调用 reconcile：当前主题被拥有时保持，被移除时回退 default', () => {
    const themeStore = useThemeStore()
    themeStore.replaceOwnedThemes(['default', 'ice'])
    themeStore.currentThemeId = 'ice'
    const keep = themeStore.reconcileCurrentTheme()
    expect(keep).toEqual({ changed: false, themeId: 'ice' })
    expect(themeStore.currentThemeId).toBe('ice')

    // 所有权收缩：ice 被移除
    themeStore.replaceOwnedThemes(['default'])
    const fallback = themeStore.reconcileCurrentTheme()
    expect(fallback.changed).toBe(true)
    expect(fallback.themeId).toBe('default')
    expect(themeStore.currentThemeId).toBe('default')
    expect(cssVar('--color-primary')).toBe('#4a9eff')
    expect(localStorage.getItem(THEME_KEY)).toBe('default')
  })

  it('reconcile 修复 nz_theme 写入失败：不抛异常，内存与 CSS 仍为 default', () => {
    const themeStore = useThemeStore()
    themeStore.replaceOwnedThemes(['default'])
    themeStore.currentThemeId = 'flame'
    installThemeWriteThrowingStorage()

    let threw = false
    let res: { changed: boolean; themeId: string } | undefined
    try {
      res = themeStore.reconcileCurrentTheme()
    } catch {
      threw = true
    }

    expect(threw).toBe(false)
    expect(res).toEqual({ changed: true, themeId: 'default' })
    expect(themeStore.currentThemeId).toBe('default')
    expect(cssVar('--color-primary')).toBe('#4a9eff')
  })
})

describe('Phase 3.36 Repair 1 — 无主存档 / 损坏主存档的启动授权对账', () => {
  it('无主存档、无 legacy 所有权、nz_theme=flame → 全部收敛 default 并修复 nz_theme', () => {
    // SAVE_KEY 不存在、nz_owned_themes 不存在、nz_theme=flame
    localStorage.setItem(THEME_KEY, 'flame')
    setActivePinia(createPinia())
    warmupStores()
    const playerStore = usePlayerStore()
    const themeStore = useThemeStore()

    expect(localStorage.getItem(SAVE_KEY)).toBeNull() // 前提：无主存档
    playerStore.loadGame()

    expect(themeStore.ownedThemes).toEqual(['default'])
    expect(themeStore.currentThemeId).toBe('default')
    expect(themeStore.currentTheme.id).toBe('default')
    expect(cssVar('--color-primary')).toBe('#4a9eff') // default 主色
    expect(localStorage.getItem(THEME_KEY)).toBe('default') // nz_theme 已修复
  })

  it('无主存档、legacy 真正拥有 flame、nz_theme=flame → 保持 flame（合法 legacy 迁移）', () => {
    localStorage.setItem(OWNED_KEY, JSON.stringify(['flame']))
    localStorage.setItem(THEME_KEY, 'flame')
    setActivePinia(createPinia())
    warmupStores()
    const playerStore = usePlayerStore()
    const themeStore = useThemeStore()

    expect(localStorage.getItem(SAVE_KEY)).toBeNull()
    playerStore.loadGame()

    expect(themeStore.ownedThemes).toEqual(['default', 'flame']) // canonical legacy
    expect(themeStore.currentThemeId).toBe('flame')
    expect(themeStore.currentTheme.id).toBe('flame')
    expect(cssVar('--color-primary')).toBe('#ff4500') // flame 主色
    expect(localStorage.getItem(THEME_KEY)).toBe('flame')
  })

  it('无主存档、legacy 只拥有 default、nz_theme=unknown → 完整回退 default', () => {
    localStorage.setItem(OWNED_KEY, JSON.stringify(['default']))
    localStorage.setItem(THEME_KEY, 'unknown')
    setActivePinia(createPinia())
    warmupStores()
    const playerStore = usePlayerStore()
    const themeStore = useThemeStore()

    expect(localStorage.getItem(SAVE_KEY)).toBeNull()
    playerStore.loadGame()

    expect(themeStore.ownedThemes).toEqual(['default'])
    expect(themeStore.currentThemeId).toBe('default')
    expect(themeStore.currentTheme.id).toBe('default')
    expect(cssVar('--color-primary')).toBe('#4a9eff')
    expect(localStorage.getItem(THEME_KEY)).toBe('default')
  })

  it('主存档 JSON 损坏、legacy 声称拥有 flame、nz_theme=flame → fail-closed 为 default，陈旧 legacy 不得生效', () => {
    localStorage.setItem(SAVE_KEY, '{corrupt json')
    localStorage.setItem(OWNED_KEY, JSON.stringify(['flame']))
    localStorage.setItem(THEME_KEY, 'flame')
    setActivePinia(createPinia())
    warmupStores()
    const playerStore = usePlayerStore()
    const themeStore = useThemeStore()

    expect(() => playerStore.loadGame()).not.toThrow()

    // 玩家回退默认状态
    expect(playerStore.player.diamond).toBe(0)
    // 主题 fail-closed：损坏主存档不信任 legacy
    expect(themeStore.ownedThemes).toEqual(['default'])
    expect(themeStore.ownedThemes).not.toContain('flame')
    expect(themeStore.currentThemeId).toBe('default')
    expect(themeStore.currentTheme.id).toBe('default')
    expect(cssVar('--color-primary')).toBe('#4a9eff')
    expect(localStorage.getItem(THEME_KEY)).toBe('default') // nz_theme 已修复
  })

  it('loadGame 过程中非 JSON 解析异常：catch 后主题同样 fail-closed 为 default 并完成对账', () => {
    // 合法 JSON 存档，但在后续水合阶段注入异常（monsterData.setProgress 抛错模拟）
    const save = JSON.parse(craftSave({ ownedThemes: ['default', 'flame'] }))
    save.themeData = { ownedThemes: ['default', 'flame'] }
    localStorage.setItem(SAVE_KEY, JSON.stringify(save))
    localStorage.setItem(OWNED_KEY, JSON.stringify(['flame']))
    localStorage.setItem(THEME_KEY, 'flame')
    setActivePinia(createPinia())
    warmupStores()
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    const themeStore = useThemeStore()

    // 让 monsterStore.setProgress 在 loadGame 期间抛异常 → 进入 catch
    const spy = vi.spyOn(monsterStore, 'setProgress').mockImplementation(() => {
      throw new Error('monster progress failed')
    })

    expect(() => playerStore.loadGame()).not.toThrow()

    expect(playerStore.player.diamond).toBe(0) // 玩家回退默认状态
    expect(themeStore.ownedThemes).toEqual(['default']) // fail-closed，不信任 legacy
    expect(themeStore.ownedThemes).not.toContain('flame')
    expect(themeStore.currentThemeId).toBe('default')
    expect(themeStore.currentTheme.id).toBe('default')
    expect(cssVar('--color-primary')).toBe('#4a9eff')
    expect(localStorage.getItem(THEME_KEY)).toBe('default')
    spy.mockRestore()
  })
})

describe('Phase 3.36 — setTheme 严格校验', () => {
  it('选择已拥有主题成功：返回 true，currentThemeId/CSS/nz_theme 一致', () => {
    const themeStore = useThemeStore()
    themeStore.replaceOwnedThemes(['default', 'flame'])

    const ok = themeStore.setTheme('flame')

    expect(ok).toBe(true)
    expect(themeStore.currentThemeId).toBe('flame')
    expect(themeStore.currentTheme.id).toBe('flame')
    expect(cssVar('--color-primary')).toBe('#ff4500') // flame 主色
    expect(localStorage.getItem(THEME_KEY)).toBe('flame')
  })

  it('选择未拥有、未知、空白污染 ID → 返回 false，状态/CSS/存储均不变', () => {
    const themeStore = useThemeStore()
    themeStore.replaceOwnedThemes(['default'])
    themeStore.currentThemeId = 'default'
    localStorage.setItem(THEME_KEY, 'default')
    cssVar('--color-primary') // ensure css set

    for (const bad of ['flame', 'bogus', ' flame', '', '   ']) {
      const ok = themeStore.setTheme(bad)
      expect(ok).toBe(false)
      expect(themeStore.currentThemeId).toBe('default')
      expect(themeStore.currentTheme.id).toBe('default')
      expect(cssVar('--color-primary')).toBe('#4a9eff')
      expect(localStorage.getItem(THEME_KEY)).toBe('default')
    }
  })

  it('setTheme 写 nz_theme 抛异常：返回 false，currentThemeId 与 CSS 保持原值', () => {
    const themeStore = useThemeStore()
    themeStore.replaceOwnedThemes(['default', 'flame'])
    themeStore.currentThemeId = 'default'
    cssVar('--color-primary') // ensure css set
    installThemeWriteThrowingStorage()

    const ok = themeStore.setTheme('flame')

    expect(ok).toBe(false)
    expect(themeStore.currentThemeId).toBe('default')
    expect(cssVar('--color-primary')).toBe('#4a9eff')
  })
})

describe('Phase 3.36 — resolveAuthorizedThemeId 纯函数矩阵', () => {
  it('授权/未授权/损坏输入矩阵', () => {
    const owned = ['default', 'flame']
    expect(resolveAuthorizedThemeId('flame', owned)).toBe('flame')
    expect(resolveAuthorizedThemeId('default', owned)).toBe('default')
    expect(resolveAuthorizedThemeId('ice', owned)).toBe('default') // 未拥有
    expect(resolveAuthorizedThemeId('bogus', owned)).toBe('default') // 未知
    expect(resolveAuthorizedThemeId('', owned)).toBe('default')
    expect(resolveAuthorizedThemeId('   ', owned)).toBe('default') // 纯空白不 trim
    expect(resolveAuthorizedThemeId(' flame', owned)).toBe('default') // 带空白不 trim 后接受
    expect(resolveAuthorizedThemeId(null, owned)).toBe('default')
    expect(resolveAuthorizedThemeId(undefined, owned)).toBe('default')
    expect(resolveAuthorizedThemeId(42, owned)).toBe('default')
    expect(resolveAuthorizedThemeId({}, owned)).toBe('default')
    // owned 损坏也能安全处理
    expect(resolveAuthorizedThemeId('flame', [42 as unknown as string, 'flame', 'flame'])).toBe('flame')
    expect(resolveAuthorizedThemeId('flame', ['bogus'])).toBe('default')
  })
})

describe('Phase 3.36 — 架构护栏', () => {
  const ROOT = process.cwd()

  it('themeStore 不再定义或导出 unlockTheme', () => {
    const src = readFileSync(resolve(ROOT, 'src/stores/themeStore.ts'), 'utf8')
    expect(src).not.toMatch(/unlockTheme/)
  })

  it('ThemeShop 不调用 unlockTheme（只允许注释提及历史词）', () => {
    const src = readFileSync(resolve(ROOT, 'src/components/ThemeShop.vue'), 'utf8')
    // 不允许实际调用（`unlockTheme(` 或 `.unlockTheme`），注释中的历史说明文字除外。
    expect(src).not.toMatch(/unlockTheme\s*\(/)
    expect(src).not.toMatch(/\.unlockTheme/)
  })

  it('loadGame 的所有退出分支都完成主题对账（reconcile 不在 if(saved) 内、catch fail-closed、no-save 规范化 legacy）', () => {
    const src = readFileSync(resolve(ROOT, 'src/stores/playerStore.ts'), 'utf8')
    // 提取 loadGame 函数体
    const m = src.match(/function loadGame\(\)\s*\{[\s\S]*?\n  \}/)
    expect(m).toBeTruthy()
    const body = m![0]

    // 1) loadGame 一开始就取得 themeStore（保证无存档分支也能对账）
    expect(body).toMatch(/const themeStore = useThemeStore\(\)/)
    // 2) reconcileCurrentTheme 必须在函数末尾（位于 if(saved) 之外，所有分支都执行）
    expect(body).toMatch(/\n\s*themeStore\.reconcileCurrentTheme\(\)\s*\n\s*\}/)
    // 3) no-save 分支存在：else 分支规范化 legacy ownedThemes
    expect(body).toMatch(/else\s*\{[\s\S]*?themeStore\.replaceOwnedThemes\(\s*normalizeOwnedThemeIds\(\s*themeStore\.ownedThemes\s*\)\s*\)/)
    // 4) catch 分支主题 fail-closed 为 ['default']
    expect(body).toMatch(/catch[\s\S]*?themeStore\.replaceOwnedThemes\(\['default'\]\)/)
    // 5) 同一份 loadGame 体内 reconcileCurrentTheme 只出现一次（且位于末尾）
    const reconcileCount = (body.match(/themeStore\.reconcileCurrentTheme\(\)/g) || []).length
    expect(reconcileCount).toBe(1)
  })
})
