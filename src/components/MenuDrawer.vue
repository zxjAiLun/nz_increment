<script setup lang="ts">
import { ref } from 'vue'
import { useNavigationStore } from '../stores/navigationStore'
import ReplayTab from './ReplayTab.vue'
import ShareTab from './ShareTab.vue'
import SkillSkinTab from './SkillSkinTab.vue'
import ThemeShop from './ThemeShop.vue'
import SettingsCoreTab from './SettingsCoreTab.vue'
import LeaderboardTab from './LeaderboardTab.vue'
import MasterTab from './MasterTab.vue'
import FriendTab from './FriendTab.vue'
import GuildTab from './GuildTab.vue'
import GuildWarTab from './GuildWarTab.vue'
import ArenaTab from './ArenaTab.vue'
import type { CommunityPageId, MenuPageId } from '../stores/navigationStore'

defineProps<{
  visible: boolean
  isDebugMode: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'confirmReset'): void
  (e: 'toggleDebugMode'): void
  (e: 'exportDebugLog'): void
  (e: 'resetDebugStats'): void
}>()

const nav = useNavigationStore()
const communityCollapsed = ref(true)

const menuItems: Array<{ id: MenuPageId; label: string }> = [
  { id: 'replay', label: '回放中心' },
  { id: 'share', label: '分享导出' },
  { id: 'appearance', label: '外观' },
  { id: 'settings', label: '设置' },
  { id: 'community', label: '社区实验室' }
]

const communityItems: Array<{ id: CommunityPageId; label: string }> = [
  { id: 'leaderboard', label: '排行' },
  { id: 'master', label: '师徒' },
  { id: 'friend', label: '好友' },
  { id: 'guild', label: '公会' },
  { id: 'guildWar', label: '公会战' },
  { id: 'arena', label: '竞技场' }
]

function selectMenu(item: MenuPageId) {
  nav.setMenuPage(item)
  if (item !== 'community') {
    communityCollapsed.value = true
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="menu-overlay" @click.self="emit('close')">
      <aside class="menu-drawer">
        <header class="drawer-header">
          <span>菜单</span>
          <button @click="emit('close')">关闭</button>
        </header>

        <nav class="menu-nav">
          <button
            v-for="item in menuItems"
            :key="item.id"
            :class="{ active: nav.menuPage === item.id }"
            @click="selectMenu(item.id)"
          >
            {{ item.label }}
          </button>
        </nav>

        <div v-if="nav.menuPage === 'community'" class="community-panel">
          <button class="collapse-btn" @click="communityCollapsed = !communityCollapsed">
            {{ communityCollapsed ? '展开社区实验室' : '收起社区实验室' }}
          </button>
          <div v-if="!communityCollapsed" class="community-nav">
            <button
              v-for="item in communityItems"
              :key="item.id"
              :class="{ active: nav.communityPage === item.id }"
              @click="nav.setCommunityPage(item.id)"
            >
              {{ item.label }}
            </button>
          </div>
        </div>

        <main class="drawer-content">
          <ReplayTab v-if="nav.menuPage === 'replay'" />
          <ShareTab v-else-if="nav.menuPage === 'share'" />
          <div v-else-if="nav.menuPage === 'appearance'" class="appearance-stack">
            <SkillSkinTab />
            <ThemeShop />
          </div>
          <SettingsCoreTab
            v-else-if="nav.menuPage === 'settings'"
            :is-debug-mode="isDebugMode"
            @confirm-reset="emit('confirmReset')"
            @toggle-debug-mode="emit('toggleDebugMode')"
            @export-debug-log="emit('exportDebugLog')"
            @reset-debug-stats="emit('resetDebugStats')"
          />
          <template v-else>
            <LeaderboardTab v-if="nav.communityPage === 'leaderboard'" />
            <MasterTab v-else-if="nav.communityPage === 'master'" />
            <FriendTab v-else-if="nav.communityPage === 'friend'" />
            <GuildTab v-else-if="nav.communityPage === 'guild'" />
            <GuildWarTab v-else-if="nav.communityPage === 'guildWar'" />
            <ArenaTab v-else />
          </template>
        </main>
      </aside>
    </div>
  </Teleport>
</template>

<style scoped>
.menu-overlay {
  position: fixed;
  inset: 0;
  z-index: 1200;
  background: rgba(2, 7, 17, 0.68);
  display: flex;
  justify-content: flex-end;
}

.menu-drawer {
  width: min(92vw, 520px);
  height: 100%;
  background: linear-gradient(180deg, var(--color-bg-panel), var(--color-bg-dark));
  border-left: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
}

.drawer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.85rem;
  border-bottom: 1px solid var(--color-border);
  color: var(--color-text-primary);
  font-weight: 700;
}

.drawer-header button {
  border: none;
  border-radius: var(--border-radius-sm);
  padding: 0.35rem 0.65rem;
  background: var(--color-bg-card);
  color: var(--color-text-secondary);
  cursor: pointer;
}

.menu-nav {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 0.35rem;
  padding: 0.65rem;
  border-bottom: 1px solid var(--color-border);
}

.menu-nav button {
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius-sm);
  padding: 0.38rem 0.5rem;
  background: var(--color-bg-card);
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  cursor: pointer;
}

.menu-nav button.active,
.community-nav button.active {
  background: var(--color-primary);
  color: var(--color-bg-dark);
  border-color: var(--color-primary);
}

.community-panel {
  padding: 0 0.65rem 0.45rem;
}

.collapse-btn {
  margin-top: 0.45rem;
  width: 100%;
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius-sm);
  padding: 0.42rem 0.6rem;
  background: var(--color-bg-card);
  color: var(--color-text-secondary);
  cursor: pointer;
}

.community-nav {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.35rem;
  margin-top: 0.45rem;
}

.community-nav button {
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius-sm);
  padding: 0.35rem 0.5rem;
  background: var(--color-bg-dark);
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  cursor: pointer;
}

.drawer-content {
  flex: 1;
  overflow-y: auto;
  padding: 0.8rem;
}

.appearance-stack {
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
}

@media (max-width: 720px) {
  .menu-nav {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .community-nav {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
