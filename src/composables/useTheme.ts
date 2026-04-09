import { ref, onMounted } from 'vue'

export type ThemeName = 
  | 'pixel' 
  | 'cyberpunk' 
  | 'original' 
  | 'dark-elegant' 
  | 'neon' 
  | 'minimal' 
  | 'sci-fi' 
  | 'fantasy' 
  | 'retro' 
  | 'glass'

const THEME_STORAGE_KEY = 'nz_theme_v1'
const THEME_BASE_PATH = '/src/styles/themes/'
const THEME_FILE_EXTENSION = '.css'

const themeLinkId = 'theme-stylesheet-link'

function loadThemeStylesheet(theme: ThemeName): void {
  let linkEl = document.getElementById(themeLinkId) as HTMLLinkElement | null
  
  if (!linkEl) {
    linkEl = document.createElement('link')
    linkEl.id = themeLinkId
    linkEl.rel = 'stylesheet'
    document.head.appendChild(linkEl)
  }
  
  linkEl.href = `${THEME_BASE_PATH}theme-${theme}${THEME_FILE_EXTENSION}`
}

export function useTheme() {
  const currentTheme = ref<ThemeName>('original')
  
  function setTheme(theme: ThemeName) {
    currentTheme.value = theme
    localStorage.setItem(THEME_STORAGE_KEY, theme)
    document.documentElement.setAttribute('data-theme', theme)
    loadThemeStylesheet(theme)
  }
  
  function initTheme() {
    const saved = localStorage.getItem(THEME_STORAGE_KEY) as ThemeName | null
    if (saved && isValidTheme(saved)) {
      setTheme(saved)
    } else {
      setTheme('original')
    }
  }
  
  function isValidTheme(theme: string): theme is ThemeName {
    const validThemes: ThemeName[] = [
      'pixel', 'cyberpunk', 'original', 'dark-elegant', 
      'neon', 'minimal', 'sci-fi', 'fantasy', 'retro', 'glass'
    ]
    return validThemes.includes(theme as ThemeName)
  }
  
  function getAvailableThemes(): { id: ThemeName; name: string; description: string }[] {
    return [
      { id: 'original', name: 'Original', description: 'Default visual style' },
      { id: 'pixel', name: 'Pixel', description: 'Retro 8-bit Game Boy style' },
      { id: 'cyberpunk', name: 'Cyberpunk', description: 'Neon glow and scanlines' },
      { id: 'dark-elegant', name: 'Dark Elegant', description: 'Dark with gold accents' },
      { id: 'neon', name: 'Neon', description: 'Bright pink/purple gradient' },
      { id: 'minimal', name: 'Minimal', description: 'Pure black and white' },
      { id: 'sci-fi', name: 'Sci-Fi', description: 'HUD style with grid' },
      { id: 'fantasy', name: 'Fantasy', description: 'RPG parchment style' },
      { id: 'retro', name: 'Retro', description: '90s Windows/Mac style' },
      { id: 'glass', name: 'Glass', description: 'Glassmorphism blur effect' },
    ]
  }
  
  onMounted(() => {
    initTheme()
  })
  
  return {
    currentTheme,
    setTheme,
    initTheme,
    getAvailableThemes,
  }
}
