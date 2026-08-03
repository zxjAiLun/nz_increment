import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { THEMES } from '../data/themes'


const THEME_KEY = 'nz_theme'
// Phase 3.35：nz_owned_themes 降级为只读 legacy migration key——只在本 Store 初始化时
// 安全读取一次（供旧存档迁移），任何购买 / unlockTheme / 生产路径都不再写入它。
// 主题所有权的唯一权威持久化位置是主存档 saveGame 的 themeData.ownedThemes。
const OWNED_KEY = 'nz_owned_themes'

/**
 * 规范化主题所有权 ID 列表（Phase 3.35 纯函数）。
 * - 只接受字符串 ID；跳过非字符串；
 * - 只保留 THEMES 中真实存在的 ID；
 * - 去重（保留首次出现顺序）；
 * - 始终包含 'default'（缺失时置于首位，保证输出顺序确定）；
 * - 损坏输入不抛异常，输出确定顺序。
 */
export function normalizeOwnedThemeIds(raw: unknown): string[] {
  const validIds = new Set(THEMES.map(t => t.id))
  const seen = new Set<string>()
  const out: string[] = []
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item !== 'string') continue
      if (!validIds.has(item)) continue
      if (seen.has(item)) continue
      seen.add(item)
      out.push(item)
    }
  }
  if (!seen.has('default')) {
    out.unshift('default')
  }
  return out
}

/** 安全读取 legacy key：损坏 JSON 回退到 ['default']，不抛异常。 */
function readLegacyOwnedThemes(): string[] {
  const saved = localStorage.getItem(OWNED_KEY)
  if (!saved) return ['default']
  try {
    return normalizeOwnedThemeIds(JSON.parse(saved))
  } catch {
    return ['default']
  }
}

export const useThemeStore = defineStore('theme', () => {
  const ownedThemes = ref<string[]>(readLegacyOwnedThemes())
  const currentThemeId = ref(localStorage.getItem(THEME_KEY) || 'default')

  const currentTheme = computed(() =>
    THEMES.find(t => t.id === currentThemeId.value) || THEMES[0]
  )

  /**
   * Phase 3.35：替换主题所有权响应式状态（纯内存操作，不写 localStorage）。
   * 规范化保证 canonical（无未知 / 无重复 / 含 default）。持久化由主存档事务负责。
   */
  function replaceOwnedThemes(themeIds: readonly string[]): void {
    ownedThemes.value = normalizeOwnedThemeIds(themeIds)
  }

  /** 非持久化内存解锁（Phase 3.35 起不再写 legacy key；权威购买走 tryPurchaseTheme）。 */
  function unlockTheme(themeId: string): boolean {
    const theme = THEMES.find(t => t.id === themeId)
    if (!theme || ownedThemes.value.includes(themeId)) return false
    ownedThemes.value = normalizeOwnedThemeIds([...ownedThemes.value, themeId])
    return true
  }

  function setTheme(themeId: string) {
    if (!ownedThemes.value.includes(themeId)) return
    currentThemeId.value = themeId
    localStorage.setItem(THEME_KEY, themeId)
    applyTheme(THEMES.find(t => t.id === themeId)!.colors)
  }

  function applyTheme(colors: any) {
    const root = document.documentElement
    const mappings: [string, string][] = [
      ['--color-primary', colors.primary],
      ['--color-secondary', colors.secondary],
      ['--color-accent', colors.accent],
      ['--color-background', colors.background],
      ['--color-surface', colors.surface],
      ['--color-text', colors.text],
      ['--color-crit', colors.crit],
      ['--color-heal', colors.heal],
      ['--color-gold', colors.gold],
      ['--color-diamond', colors.diamond],
      ['--color-primary-light', colors.primaryLight],
      ['--color-primary-dark', colors.primaryDark],
      ['--color-secondary-light', colors.secondaryLight],
      ['--color-secondary-dark', colors.secondaryDark],
      ['--color-accent-light', colors.accentLight],
      ['--color-accent-dark', colors.accentDark],
      ['--color-gold-light', colors.goldLight],
      ['--color-gold-dark', colors.goldDark],
      ['--color-diamond-light', colors.diamondLight],
      ['--color-diamond-dark', colors.diamondDark],
      ['--color-info', colors.info],
      ['--color-success', colors.success],
      ['--color-warning', colors.warning],
      ['--color-danger', colors.danger],
      ['--color-text-primary', colors.textPrimary],
      ['--color-text-secondary', colors.textSecondary],
      ['--color-text-muted', colors.textMuted],
      ['--color-text-disabled', colors.textDisabled],
      ['--color-bg-panel', colors.bgPanel],
      ['--color-bg-card', colors.bgCard],
      ['--color-bg-input', colors.bgInput],
      ['--color-bg-dark', colors.bgDark],
      ['--color-rarity-common', colors.rarityCommon],
      ['--color-rarity-fine', colors.rarityFine],
      ['--color-rarity-good', colors.rarityGood],
      ['--color-rarity-epic', colors.rarityEpic],
      ['--color-rarity-legend', colors.rarityLegend],
      ['--color-rarity-myth', colors.rarityMyth],
      ['--color-rarity-eternal', colors.rarityEternal],
      ['--color-rarity-ancient', colors.rarityAncient],
    ]
    for (const [varName, value] of mappings) {
      if (value) root.style.setProperty(varName, value)
    }
  }

  // 初始化应用主题
  applyTheme(currentTheme.value.colors)

  return { currentThemeId, currentTheme, ownedThemes, unlockTheme, setTheme, applyTheme, replaceOwnedThemes }
})
