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

  function applyTheme(colors: Theme['colors']) {
    const root = document.documentElement
    root.style.setProperty('--color-primary', colors.primary)
    root.style.setProperty('--color-secondary', colors.secondary)
    root.style.setProperty('--color-accent', colors.accent)
    root.style.setProperty('--color-background', colors.background)
    root.style.setProperty('--color-surface', colors.surface)
    root.style.setProperty('--color-text', colors.text)
    root.style.setProperty('--color-crit', colors.crit)
    root.style.setProperty('--color-heal', colors.heal)
    root.style.setProperty('--color-gold', colors.gold)
    root.style.setProperty('--color-diamond', colors.diamond)
  }

  // 初始化应用主题
  applyTheme(currentTheme.value.colors)

  return { currentThemeId, currentTheme, ownedThemes, unlockTheme, setTheme, applyTheme }
})
