import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { THEMES } from '../data/themes'
import type { Theme } from '../data/themes'

const THEME_KEY = 'nz_theme'
const OWNED_KEY = 'nz_owned_themes'

export const useThemeStore = defineStore('theme', () => {
  const savedOwned = localStorage.getItem(OWNED_KEY)
  const ownedThemes = ref<string[]>(savedOwned ? JSON.parse(savedOwned) : ['default'])
  const currentThemeId = ref(localStorage.getItem(THEME_KEY) || 'default')

  const currentTheme = computed(() =>
    THEMES.find(t => t.id === currentThemeId.value) || THEMES[0]
  )

  function saveOwned() {
    localStorage.setItem(OWNED_KEY, JSON.stringify(ownedThemes.value))
  }

  function unlockTheme(themeId: string): boolean {
    const theme = THEMES.find(t => t.id === themeId)
    if (!theme || ownedThemes.value.includes(themeId)) return false
    ownedThemes.value.push(themeId)
    saveOwned()
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

  return { currentThemeId, currentTheme, ownedThemes, unlockTheme, setTheme, applyTheme }
})
