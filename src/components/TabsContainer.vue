<script setup lang="ts">
import type { TabItem } from './TabNavigation.vue'
import TabNavigation from './TabNavigation.vue'
import BattleTab from './BattleTab.vue'
import RoleTab from './RoleTab.vue'
import SkillsTab from './SkillsTab.vue'
import ShopTab from './ShopTab.vue'
import SettingsTab from './SettingsTab.vue'
import DebugPanel from './DebugPanel.vue'

const props = defineProps<{
  tabs: TabItem[]
  currentTab: string
  battleMode: 'main' | 'training'
  isDebugMode: boolean
  debugStats: {
    totalDamage: number
    critCount: number
    killCount: number
    damageByType: Record<string, number>
    startTime: number
  }
  debugLog: Array<{ damage: number; isCrit: boolean; type: string; timestamp?: number }>
}>()

const emit = defineEmits<{
  'update:currentTab': [tab: string]
  'useSkill': [slotIndex: number]
  'goBackLevels': []
  'confirmReset': []
  'toggleDebugMode': []
  'exportDebugLog': []
  'resetDebugStats': []
}>()

function onTabChange(tab: string) {
  emit('update:currentTab', tab)
}
</script>

<template>
  <div class="tabs-container">
    <TabNavigation
      :tabs="tabs"
      :activeTab="currentTab"
      @update:activeTab="onTabChange"
    />

    <main class="tab-content">
      <BattleTab
        v-if="currentTab === 'battle'"
        :battle-mode="battleMode"
        @use-skill="(idx) => emit('useSkill', idx)"
      />
      <RoleTab v-else-if="currentTab === 'role'" />
      <SkillsTab v-else-if="currentTab === 'skills'" />
      <ShopTab
        v-else-if="currentTab === 'shop'"
        @go-back-levels="emit('goBackLevels')"
      />
      <SettingsTab
        v-else-if="currentTab === 'settings'"
        @confirm-reset="emit('confirmReset')"
        @toggle-debug-mode="emit('toggleDebugMode')"
        @export-debug-log="emit('exportDebugLog')"
        @reset-debug-stats="emit('resetDebugStats')"
      />

      <!-- Debug Panel -->
      <DebugPanel
        v-if="isDebugMode"
        :debug-stats="debugStats"
        :debug-log="debugLog"
        @toggle-debug-mode="emit('toggleDebugMode')"
        @export-debug-log="emit('exportDebugLog')"
        @reset-debug-stats="emit('resetDebugStats')"
      />
    </main>
  </div>
</template>

<style scoped>
@import '../styles/design-system.css';

.tabs-container {
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow: hidden;
}

.tab-content {
  flex: 1;
  padding: 0.8rem;
  overflow-y: auto;
}
</style>
