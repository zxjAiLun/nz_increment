import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import {
  LEGACY_TAB_MIGRATION_MAP,
  MAINLINE_UNLOCK_STAGES,
  PRIMARY_TABS,
  SECONDARY_PAGES,
  type MainlineUnlockStage,
  type NavRoute,
  type PrimaryTabId,
  type SecondaryPageConfig,
  type SecondaryPageId
} from '../types/navigation'
import { useMonsterStore } from './monsterStore'

export type MenuPageId = 'replay' | 'share' | 'appearance' | 'settings' | 'community'
export type CommunityPageId = 'leaderboard' | 'master' | 'friend' | 'guild' | 'guildWar' | 'arena'

const NAV_KEY = 'nz_nav_route_v2'
const MENU_PAGE_KEY = 'nz_menu_page_v2'
const COMMUNITY_PAGE_KEY = 'nz_menu_community_page_v2'
const LEGACY_KEYS = ['nz_current_tab', 'currentTab', 'lollipop_current_tab'] as const

const LEGACY_MENU_TARGET_MAP: Partial<Record<string, { page: MenuPageId; community?: CommunityPageId }>> = {
  leaderboard: { page: 'community', community: 'leaderboard' },
  master: { page: 'community', community: 'master' },
  replay: { page: 'replay' },
  share: { page: 'share' },
  skillskin: { page: 'appearance' },
  settings: { page: 'settings' }
}

export const useNavigationStore = defineStore('navigation', () => {
  const route = ref<NavRoute>({ primary: 'adventure', secondary: 'main', source: 'primary' })
  const isMenuOpen = ref(false)
  const menuPage = ref<MenuPageId>('settings')
  const communityPage = ref<CommunityPageId>('leaderboard')

  const monsterStore = useMonsterStore()
  const currentDifficulty = computed(() => monsterStore.difficultyValue)
  const primaryTabs = computed(() => PRIMARY_TABS.filter(tab => isPrimaryUnlocked(tab.id)))
  const secondaryPages = computed(() => getUnlockedSecondaryPages(route.value.primary))
  const nextUnlockStage = computed<MainlineUnlockStage | null>(() => {
    return MAINLINE_UNLOCK_STAGES.find(stage => stage.minDifficulty > currentDifficulty.value) || null
  })
  const currentUnlockStage = computed<MainlineUnlockStage>(() => {
    return [...MAINLINE_UNLOCK_STAGES]
      .reverse()
      .find(stage => stage.minDifficulty <= currentDifficulty.value) || MAINLINE_UNLOCK_STAGES[0]
  })

  function isPageUnlocked(page: SecondaryPageConfig): boolean {
    return currentDifficulty.value >= (page.minDifficulty ?? 0)
  }

  function getUnlockedSecondaryPages(primary: PrimaryTabId): SecondaryPageConfig[] {
    return SECONDARY_PAGES[primary].filter(isPageUnlocked)
  }

  function isPrimaryUnlocked(primary: PrimaryTabId): boolean {
    return getUnlockedSecondaryPages(primary).length > 0
  }

  function getDefaultSecondary(primary: PrimaryTabId): SecondaryPageId {
    const configured = PRIMARY_TABS.find(t => t.id === primary)?.defaultSecondary
    const unlockedPages = getUnlockedSecondaryPages(primary)
    if (configured && unlockedPages.some(page => page.id === configured)) return configured
    return unlockedPages[0]?.id ?? 'main'
  }

  function isValidSecondaryForPrimary(primary: PrimaryTabId, secondary: SecondaryPageId): boolean {
    if (secondary === 'menu') return true
    return getUnlockedSecondaryPages(primary).some(page => page.id === secondary)
  }

  function normalizePrimary(primary: PrimaryTabId): PrimaryTabId {
    if (isPrimaryUnlocked(primary)) return primary
    return primaryTabs.value[0]?.id ?? 'adventure'
  }

  function persist() {
    localStorage.setItem(NAV_KEY, JSON.stringify(route.value))
    localStorage.setItem(MENU_PAGE_KEY, menuPage.value)
    localStorage.setItem(COMMUNITY_PAGE_KEY, communityPage.value)
  }

  function setRoute(next: NavRoute) {
    const primary = normalizePrimary(next.primary)
    const normalized: NavRoute = {
      primary,
      secondary: isValidSecondaryForPrimary(primary, next.secondary)
        ? next.secondary
        : getDefaultSecondary(primary),
      source: next.source || 'primary'
    }
    route.value = normalized
    persist()
  }

  function selectPrimary(primary: PrimaryTabId) {
    if (!isPrimaryUnlocked(primary)) return
    setRoute({ primary, secondary: getDefaultSecondary(primary), source: 'primary' })
  }

  function selectSecondary(secondary: SecondaryPageId) {
    if (secondary === 'menu') {
      openMenu()
      return
    }
    if (!isValidSecondaryForPrimary(route.value.primary, secondary)) return
    setRoute({ primary: route.value.primary, secondary, source: 'primary' })
  }

  watch(currentDifficulty, () => {
    if (!isPrimaryUnlocked(route.value.primary) || !isValidSecondaryForPrimary(route.value.primary, route.value.secondary)) {
      setRoute(route.value)
    }
  })

  function openMenu(page?: MenuPageId) {
    isMenuOpen.value = true
    if (page) menuPage.value = page
    persist()
  }

  function closeMenu() {
    isMenuOpen.value = false
  }

  function setMenuPage(page: MenuPageId) {
    menuPage.value = page
    persist()
  }

  function setCommunityPage(page: CommunityPageId) {
    communityPage.value = page
    persist()
  }

  function migrateLegacyTab(tabId: string) {
    const mapped = LEGACY_TAB_MIGRATION_MAP[tabId]
    if (mapped) {
      if (mapped.secondary === 'menu') {
        setRoute({
          primary: mapped.primary,
          secondary: getDefaultSecondary(mapped.primary),
          source: 'menu'
        })
      } else {
        setRoute(mapped)
      }
      const menuTarget = LEGACY_MENU_TARGET_MAP[tabId]
      if (menuTarget) {
        menuPage.value = menuTarget.page
        if (menuTarget.community) communityPage.value = menuTarget.community
        isMenuOpen.value = true
        persist()
      }
    }
  }

  function loadSavedRoute() {
    const saved = localStorage.getItem(NAV_KEY)
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as NavRoute
        setRoute(parsed)
      } catch {
        setRoute({ primary: 'adventure', secondary: 'main', source: 'primary' })
      }
    }

    const savedMenuPage = localStorage.getItem(MENU_PAGE_KEY) as MenuPageId | null
    if (savedMenuPage) menuPage.value = savedMenuPage
    const savedCommunityPage = localStorage.getItem(COMMUNITY_PAGE_KEY) as CommunityPageId | null
    if (savedCommunityPage) communityPage.value = savedCommunityPage
  }

  function migrateFromLegacyIfNeeded() {
    if (localStorage.getItem(NAV_KEY)) return
    let legacyTab: string | null = null
    for (const key of LEGACY_KEYS) {
      const value = localStorage.getItem(key)
      if (value) {
        legacyTab = value
        break
      }
    }
    if (legacyTab) {
      migrateLegacyTab(legacyTab)
      return
    }
    setRoute({ primary: 'adventure', secondary: 'main', source: 'primary' })
  }

  function initialize() {
    loadSavedRoute()
    migrateFromLegacyIfNeeded()
  }

  return {
    route,
    primaryTabs,
    secondaryPages,
    currentDifficulty,
    currentUnlockStage,
    nextUnlockStage,
    isMenuOpen,
    menuPage,
    communityPage,
    initialize,
    setRoute,
    selectPrimary,
    selectSecondary,
    openMenu,
    closeMenu,
    setMenuPage,
    setCommunityPage,
    migrateLegacyTab,
    isPrimaryUnlocked,
    isValidSecondaryForPrimary
  }
})
