<script setup lang="ts">
import type { TabItem } from './TabNavigation.vue'
import TabNavigation from './TabNavigation.vue'
import BattleTab from './BattleTab.vue'
import RoleTab from './RoleTab.vue'
import SkillsTab from './SkillsTab.vue'
import ShopTab from './ShopTab.vue'
import SettingsTab from './SettingsTab.vue'
import CultivationTab from './CultivationTab.vue'
import MasterTab from './MasterTab.vue'
import LeaderboardTab from './LeaderboardTab.vue'
import SigninTab from './SigninTab.vue'
import TitleTab from './TitleTab.vue'
import BossRushTab from './BossRushTab.vue'
import SkillSkinTab from './SkillSkinTab.vue'
import PetTab from './PetTab.vue'
import AchievementStoryTab from './AchievementStoryTab.vue'
import WorldBossTab from './WorldBossTab.vue'
import InheritanceTab from './InheritanceTab.vue'
import MerchantTab from './MerchantTab.vue'
import ReplayTab from './ReplayTab.vue'
import ShareTab from './ShareTab.vue'
import DungeonTab from './DungeonTab.vue'
import AdventureTab from './AdventureTab.vue'
import DebugPanel from './DebugPanel.vue'

defineProps<{
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
      <CultivationTab v-else-if="currentTab === 'cultivation'" />
      <SettingsTab
        v-else-if="currentTab === 'settings'"
        @confirm-reset="emit('confirmReset')"
        @toggle-debug-mode="emit('toggleDebugMode')"
        @export-debug-log="emit('exportDebugLog')"
        @reset-debug-stats="emit('resetDebugStats')"
      />
      <MasterTab v-else-if="currentTab === 'master'" />
      <LeaderboardTab v-else-if="currentTab === 'leaderboard'" />
      <SigninTab v-else-if="currentTab === 'signin'" />
      <TitleTab v-else-if="currentTab === 'title'" />
      <BossRushTab v-else-if="currentTab === 'bossrush'" />
      <SkillSkinTab v-else-if="currentTab === 'skillskin'" />
      <PetTab v-else-if="currentTab === 'pet'" />
      <AchievementStoryTab v-else-if="currentTab === 'achievementstory'" />
      <WorldBossTab v-else-if="currentTab === 'worldboss'" />
      <InheritanceTab v-else-if="currentTab === 'inheritance'" />
      <MerchantTab v-else-if="currentTab === 'merchant'" />
      <ReplayTab v-else-if="currentTab === 'replay'" />
      <ShareTab v-else-if="currentTab === 'share'" />
      <DungeonTab v-else-if="currentTab === 'dungeon'" />
      <AdventureTab v-else-if="currentTab === 'adventure'" />

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
