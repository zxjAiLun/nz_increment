import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { THEMES } from '../data/themes'


const THEME_KEY = 'nz_theme'
// Phase 3.35：nz_owned_themes 降级为只读 legacy migration key——只在本 Store 初始化时
// 安全读取一次（供旧存档迁移），任何购买 / 生产路径都不再写入它。
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

/**
 * 纯授权解析函数（Phase 3.36）：从「原始当前主题 ID」+「已拥有主题」解析出真正
 * 可用的主题 ID。ownedThemes 先经 normalizeOwnedThemeIds 规范化，且只接受：
 *   - 非空精确字符串（不 trim、不接受纯空白）；
 *   - 存在于 THEMES；
 *   - 存在于 canonical ownedThemes。
 * 任一条件不满足均返回 'default'；任何输入（含 null/undefined/数字/对象）都不抛异常。
 * 未知、未拥有或仅存在于 nz_theme 的主题一律不得视为已授权。
 */
export function resolveAuthorizedThemeId(
  rawThemeId: unknown,
  ownedThemeIds: readonly string[]
): string {
  const canonicalOwned = normalizeOwnedThemeIds(ownedThemeIds)
  if (typeof rawThemeId !== 'string' || rawThemeId.length === 0) {
    return 'default'
  }
  const theme = THEMES.find(t => t.id === rawThemeId)
  if (!theme) return 'default'
  if (!canonicalOwned.includes(rawThemeId)) return 'default'
  return rawThemeId
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

  /**
   * Phase 3.36：当前主题与所有权对账。以 resolveAuthorizedThemeId 得出最终 ID：
   *   - 当前 ID 未授权（未拥有 / 未知 / 损坏 / 空白）→ currentThemeId 收敛到 default，
   *     应用 default 完整颜色，并尝试把 nz_theme 修复为 default；
   *   - 当前 ID 已授权 → 保持该 ID，并重新应用其颜色，保证 CSS 与响应式状态一致。
   * localStorage.setItem 抛错不得阻止内存与 CSS 收敛；不写主存档、不写 legacy key。
   * 返回本次是否发生变更及最终 ID。
   */
  function reconcileCurrentTheme(): { changed: boolean; themeId: string } {
    const authorized = resolveAuthorizedThemeId(currentThemeId.value, ownedThemes.value)
    const changed = authorized !== currentThemeId.value
    currentThemeId.value = authorized
    applyTheme((THEMES.find(t => t.id === authorized) || THEMES[0]).colors)
    try {
      localStorage.setItem(THEME_KEY, authorized)
    } catch {
      // 写盘失败不阻止内存与 CSS 收敛
    }
    return { changed, themeId: authorized }
  }

  /**
   * Phase 3.36：设置当前主题（显示偏好）。严格校验：
   *   - 主题必须真实存在；
   *   - 主题必须已经拥有；
   *   - 非空字符串但带额外空白不得被 trim 后接受；
   * 校验失败返回 false，零状态修改、零 CSS 修改、零写盘；合法选择写入 nz_theme、
   * 更新 currentThemeId 并应用主题，返回 true。nz_theme 写入失败返回 false，并保持
   * 原 currentThemeId 与原 CSS。不通过 setTheme 修改 ownedThemes。
   */
  function setTheme(themeId: string): boolean {
    if (typeof themeId !== 'string' || themeId.length === 0) return false
    const theme = THEMES.find(t => t.id === themeId)
    if (!theme) return false
    if (!ownedThemes.value.includes(themeId)) return false
    try {
      localStorage.setItem(THEME_KEY, themeId)
    } catch {
      return false
    }
    currentThemeId.value = themeId
    applyTheme(theme.colors)
    return true
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

  // 初始化应用当前主题。主存档所有权水合后的授权对账由 playerStore.loadGame 在
  // replaceOwnedThemes 之后调用 reconcileCurrentTheme 完成（此处不能提前对账——主存档
  // 尚未加载，legacy 所有权不代表权威所有权）。
  applyTheme(currentTheme.value.colors)

  return { currentThemeId, currentTheme, ownedThemes, setTheme, applyTheme, replaceOwnedThemes, reconcileCurrentTheme }
})
