import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import {
  LEGACY_TAB_MIGRATION_MAP,
  PRIMARY_TABS,
  SECONDARY_PAGES,
  type NavRoute,
  type PrimaryTabId,
  type SecondaryPageId
} from '../types/navigation'

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

  const primaryTabs = computed(() => PRIMARY_TABS)
  const secondaryPages = computed(() => SECONDARY_PAGES[route.value.primary])

  function getDefaultSecondary(primary: PrimaryTabId): SecondaryPageId {
    return PRIMARY_TABS.find(t => t.id === primary)?.defaultSecondary ?? 'main'
  }

  function isValidSecondaryForPrimary(primary: PrimaryTabId, secondary: SecondaryPageId): boolean {
    if (secondary === 'menu') return true
    return SECONDARY_PAGES[primary].some(page => page.id === secondary)
  }

  function persist() {
    localStorage.setItem(NAV_KEY, JSON.stringify(route.value))
    localStorage.setItem(MENU_PAGE_KEY, menuPage.value)
    localStorage.setItem(COMMUNITY_PAGE_KEY, communityPage.value)
  }

  function setRoute(next: NavRoute) {
    const normalized: NavRoute = {
      primary: next.primary,
      secondary: isValidSecondaryForPrimary(next.primary, next.secondary)
        ? next.secondary
        : getDefaultSecondary(next.primary),
      source: next.source || 'primary'
    }
    route.value = normalized
    persist()
  }

  function selectPrimary(primary: PrimaryTabId) {
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
    migrateLegacyTab
  }
})
