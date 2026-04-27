<script setup lang="ts">
import { computed, watch } from 'vue'
import { useNavigationStore } from '../stores/navigationStore'
import PrimaryNavigation from './PrimaryNavigation.vue'
import SecondaryNavigation from './SecondaryNavigation.vue'
import MenuDrawer from './MenuDrawer.vue'
import BattleTab from './BattleTab.vue'
import RoleTab from './RoleTab.vue'
import SkillsTab from './SkillsTab.vue'
import ShopTab from './ShopTab.vue'
import CultivationTab from './CultivationTab.vue'
import SigninTab from './SigninTab.vue'
import BossRushTab from './BossRushTab.vue'
import PetTab from './PetTab.vue'
import AchievementStoryTab from './AchievementStoryTab.vue'
import WorldBossTab from './WorldBossTab.vue'
import InheritanceTab from './InheritanceTab.vue'
import MerchantTab from './MerchantTab.vue'
import DungeonTab from './DungeonTab.vue'
import AdventureTab from './AdventureTab.vue'
import GachaTab from './GachaTab.vue'
import MonopolyTab from './MonopolyTab.vue'
import SeasonTab from './SeasonTab.vue'
import BattlePassTab from './BattlePassTab.vue'
import AchievementTab from './AchievementTab.vue'
import DebugPanel from './DebugPanel.vue'
import BuildBonusTab from './BuildBonusTab.vue'
import AutoBuildTab from './AutoBuildTab.vue'
import { usePlayerStore } from '../stores/playerStore'
import { getDominantBuildArchetype } from '../data/buildArchetypes'

const props = defineProps<{
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
  (e: 'useSkill', slotIndex: number): void
  (e: 'goBackLevels'): void
  (e: 'confirmReset'): void
  (e: 'toggleDebugMode'): void
  (e: 'exportDebugLog'): void
  (e: 'resetDebugStats'): void
  (e: 'switchBattleMode', mode: 'main' | 'training'): void
}>()

const nav = useNavigationStore()
const playerStore = usePlayerStore()

const dominantBuild = computed(() => getDominantBuildArchetype(playerStore.totalStats))

const buildSummary = computed(() => {
  const dominant = dominantBuild.value
  const activeSkills = playerStore.player.skills.filter(skill => !!skill).slice(0, 3).map(skill => skill!.name)
  const titleName = playerStore.player.name
  return `主角色 ${titleName}，当前偏向「${dominant.archetype.name}」(${dominant.percent}%)：${dominant.archetype.feedback}。已装备 ${activeSkills.length} 个技能（${activeSkills.join(' / ') || '无'}）。取舍：${dominant.archetype.tradeoff}`
})

const buildTags = computed(() => dominantBuild.value.archetype.uiTags)

const offlineData = computed(() => playerStore.pendingOfflineReward)

watch(
  () => nav.route.secondary,
  (secondary) => {
    if (nav.route.primary !== 'adventure') return
    if (secondary === 'main' && props.battleMode !== 'main') {
      emit('switchBattleMode', 'main')
    }
    if (secondary === 'training' && props.battleMode !== 'training') {
      emit('switchBattleMode', 'training')
    }
  },
  { immediate: true }
)

watch(
  () => props.battleMode,
  (mode) => {
    if (nav.route.primary !== 'adventure') return
    if (nav.route.secondary === 'report') return
    const target = mode === 'training' ? 'training' : 'main'
    if (nav.route.secondary !== target) nav.selectSecondary(target)
  }
)
</script>

<template>
  <div class="tabs-container">
    <PrimaryNavigation
      :tabs="nav.primaryTabs"
      :active-tab="nav.route.primary"
      @select="nav.selectPrimary"
    />

    <SecondaryNavigation
      :pages="nav.secondaryPages"
      :active-page="nav.route.secondary"
      @select="nav.selectSecondary"
    />

    <main class="tab-content">
      <template v-if="nav.route.primary === 'adventure'">
        <BattleTab
          v-if="nav.route.secondary === 'main' || nav.route.secondary === 'training'"
          :battle-mode="battleMode"
          view-mode="main"
          :build-summary="buildSummary"
          :build-tags="buildTags"
          @use-skill="(idx) => emit('useSkill', idx)"
        />
        <div v-else class="panel-stack">
          <section class="quick-actions">
            <button @click="nav.openMenu('replay')">打开回放中心</button>
            <button @click="nav.openMenu('share')">打开分享导出</button>
          </section>
          <BattleTab
            :battle-mode="battleMode"
            view-mode="report"
            @use-skill="(idx) => emit('useSkill', idx)"
          />
        </div>
      </template>

      <template v-else-if="nav.route.primary === 'build'">
        <AutoBuildTab v-if="nav.route.secondary === 'autoBuild'" />
        <RoleTab v-else-if="nav.route.secondary === 'equipment'" section="equipment" />
        <SkillsTab v-else-if="nav.route.secondary === 'skills'" />
        <BuildBonusTab v-else />
      </template>

      <template v-else-if="nav.route.primary === 'growth'">
        <RoleTab v-if="nav.route.secondary === 'stats'" section="stats" />
        <CultivationTab v-else-if="nav.route.secondary === 'cultivation'" />
        <PetTab v-else-if="nav.route.secondary === 'pet'" />
        <InheritanceTab v-else />
      </template>

      <template v-else-if="nav.route.primary === 'challenge'">
        <DungeonTab v-if="nav.route.secondary === 'dungeon'" />
        <BossRushTab v-else-if="nav.route.secondary === 'bossRush'" />
        <WorldBossTab v-else-if="nav.route.secondary === 'worldEvent'" />
        <AdventureTab v-else />
      </template>

      <template v-else>
        <div v-if="nav.route.secondary === 'signinOffline'" class="panel-stack">
          <section v-if="offlineData" class="offline-panel">
            <div class="offline-title">离线收益可领取</div>
            <div class="offline-content">
              <span>金币 +{{ offlineData.gold }}</span>
              <span>经验 +{{ offlineData.exp }}</span>
            </div>
            <button class="claim-btn" @click="playerStore.claimOfflineReward()">领取离线收益</button>
          </section>
          <SigninTab />
        </div>
        <div v-else-if="nav.route.secondary === 'shopGacha'" class="panel-stack">
          <GachaTab />
          <ShopTab @go-back-levels="emit('goBackLevels')" />
          <MerchantTab />
        </div>
        <div v-else-if="nav.route.secondary === 'monopoly'" class="panel-stack">
          <MonopolyTab />
        </div>
        <div v-else-if="nav.route.secondary === 'seasonPass'" class="panel-stack">
          <SeasonTab />
          <BattlePassTab />
        </div>
        <div v-else class="panel-stack">
          <AchievementTab />
          <AchievementStoryTab />
        </div>
      </template>

      <DebugPanel
        v-if="isDebugMode"
        :debug-stats="debugStats"
        :debug-log="debugLog"
        @toggle-debug-mode="emit('toggleDebugMode')"
        @export-debug-log="emit('exportDebugLog')"
        @reset-debug-stats="emit('resetDebugStats')"
      />
    </main>

    <MenuDrawer
      :visible="nav.isMenuOpen"
      :is-debug-mode="isDebugMode"
      @close="nav.closeMenu"
      @confirm-reset="emit('confirmReset')"
      @toggle-debug-mode="emit('toggleDebugMode')"
      @export-debug-log="emit('exportDebugLog')"
      @reset-debug-stats="emit('resetDebugStats')"
    />
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

.panel-stack {
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
}

.quick-actions {
  display: flex;
  gap: 0.5rem;
}

.quick-actions button {
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius-sm);
  padding: 0.45rem 0.65rem;
  background: var(--color-bg-panel);
  color: var(--color-text-secondary);
  cursor: pointer;
}

.offline-panel {
  background: linear-gradient(135deg, var(--color-accent-dark), var(--color-accent));
  padding: 0.9rem;
  border-radius: var(--border-radius-md);
  color: #fff;
}

.offline-title {
  font-size: var(--font-size-md);
  font-weight: 700;
}

.offline-content {
  display: flex;
  gap: 1.2rem;
  margin: 0.5rem 0 0.7rem;
  font-size: var(--font-size-sm);
}

.claim-btn {
  border: none;
  border-radius: var(--border-radius-sm);
  padding: 0.45rem 0.7rem;
  background: rgba(255, 255, 255, 0.9);
  color: var(--color-bg-dark);
  font-weight: 700;
  cursor: pointer;
}

@media (max-width: 560px) {
  .tabs-container {
    overflow: visible;
  }

  .tab-content {
    padding: 0.65rem;
    padding-bottom: calc(var(--mobile-bottom-nav-height) + 0.75rem + env(safe-area-inset-bottom));
  }

  .quick-actions {
    flex-direction: column;
  }

  .offline-content {
    flex-direction: column;
    gap: 0.35rem;
  }
}
</style>
