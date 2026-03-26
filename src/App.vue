<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { usePlayerStore } from './stores/playerStore'
import { useMonsterStore } from './stores/monsterStore'
import { useGameStore } from './stores/gameStore'
import TabNavigation from './components/TabNavigation.vue'
import BattleTab from './components/BattleTab.vue'
import RoleTab from './components/RoleTab.vue'
import ShopTab from './components/ShopTab.vue'
import SettingsTab from './components/SettingsTab.vue'
import ToastContainer from './components/ToastContainer.vue'
import EquipmentDetailModal from './components/EquipmentDetailModal.vue'
import DebugPanel from './components/DebugPanel.vue'
import RebirthModal from './components/RebirthModal.vue'
import KeyboardShortcuts from './components/KeyboardShortcuts.vue'
import { useGameLoop } from './composables/useGameLoop'

const playerStore = usePlayerStore()
const monsterStore = useMonsterStore()
const gameStore = useGameStore()

useGameLoop()

const activeTab = ref('battle')
const showDebugPanel = ref(false)
const showRebirthModal = ref(false)
const rebirthShopMode = ref(false)
const showKeyboardShortcuts = ref(false)
const showEquipmentDetail = ref(false)
const selectedEquipment = ref<any>(null)

const tabs = [
  { id: 'battle', name: '战斗', icon: '⚔️' },
  { id: 'role', name: '角色', icon: '👤' },
  { id: 'shop', name: '商店', icon: '🏪' },
  { id: 'settings', name: '设置', icon: '⚙️' }
]

const keyBindings = [
  { key: 'Space', action: '暂停/继续', handler: () => gameStore.togglePause(), enabled: true },
  { key: 'KeyS', action: '技能面板', handler: () => { activeTab.value = 'role' }, enabled: true },
  { key: 'KeyE', action: '装备面板', handler: () => { activeTab.value = 'role' }, enabled: true },
  { key: 'KeyB', action: '商店', handler: () => { activeTab.value = 'shop' }, enabled: true },
  { key: 'Escape', action: '关闭面板', handler: handleEscape, enabled: true }
]

function handleEscape() {
  if (showRebirthModal.value) { showRebirthModal.value = false; rebirthShopMode.value = false }
  else if (showDebugPanel.value) showDebugPanel.value = false
  else if (showEquipmentDetail.value) showEquipmentDetail.value = false
  else if (showKeyboardShortcuts.value) showKeyboardShortcuts.value = false
}

function showEquipmentDetailModal(equipment: any) {
  selectedEquipment.value = equipment
  showEquipmentDetail.value = true
}

function handleKeyDown(event: KeyboardEvent) {
  const target = event.target as HTMLElement
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return
  if (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)) return
  for (const binding of keyBindings) {
    if (event.code === binding.key) { event.preventDefault(); binding.handler(); break }
  }
}

onMounted(() => window.addEventListener('keydown', handleKeyDown))
onUnmounted(() => window.removeEventListener('keydown', handleKeyDown))
</script>

<template>
  <div class="app-container">
    <header class="app-header">
      <div class="header-stats">
        <div class="stat-item"><span class="stat-label">金币</span><span class="stat-value gold">{{ playerStore.player.gold.toLocaleString() }}</span></div>
        <div class="stat-item"><span class="stat-label">钻石</span><span class="stat-value diamond">{{ playerStore.player.diamond }}</span></div>
        <div class="stat-item"><span class="stat-label">等级</span><span class="stat-value level">{{ playerStore.player.level }}</span></div>
        <div class="stat-item"><span class="stat-label">层数</span><span class="stat-value layer">{{ monsterStore.currentMonster?.level || 1 }}</span></div>
      </div>
      <div class="header-actions">
        <button class="action-btn" @click="showRebirthModal = true">⭐</button>
        <button class="action-btn" @click="showKeyboardShortcuts = true">⌨️</button>
        <button class="action-btn" @click="showDebugPanel = true">🔧</button>
      </div>
    </header>

    <main class="app-main">
      <BattleTab v-if="activeTab === 'battle'" battle-mode="main" @use-skill="(slot) => console.log('Use skill', slot)" />
      <RoleTab v-else-if="activeTab === 'role'" @showEquipmentDetail="showEquipmentDetailModal" />
      <ShopTab v-else-if="activeTab === 'shop'" @openRebirth="showRebirthModal = true" />
      <SettingsTab v-else-if="activeTab === 'settings'" @openDebug="showDebugPanel = true" />
    </main>

    <TabNavigation :tabs="tabs" :active-tab="activeTab" @update:active-tab="(tab) => activeTab = tab" />

    <ToastContainer />
    <EquipmentDetailModal :equipment="selectedEquipment" :visible="showEquipmentDetail" @close="showEquipmentDetail = false" />
    <DebugPanel :visible="showDebugPanel" @close="showDebugPanel = false" @export="() => {}" @reset="() => {}" />
    <RebirthModal :visible="showRebirthModal" :is-shop="rebirthShopMode" @close="showRebirthModal = false" @openShop="rebirthShopMode = true" />
    <KeyboardShortcuts :visible="showKeyboardShortcuts" :bindings="keyBindings" @close="showKeyboardShortcuts = false" />
  </div>
</template>

<style>
@import './styles/design-system.css';

.app-container {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--color-bg-primary);
  color: var(--color-text-primary);
}

.app-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem 1rem;
  background: var(--color-bg-panel);
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  position: sticky;
  top: 0;
  z-index: 100;
}

.header-stats { display: flex; gap: 1rem; }
.stat-item { display: flex; flex-direction: column; align-items: center; padding: 0.25rem 0.75rem; background: rgba(0, 0, 0, 0.3); border-radius: 8px; }
.stat-label { font-size: 0.7rem; color: var(--color-text-muted); }
.stat-value { font-size: 0.9rem; font-weight: bold; }
.stat-value.gold { color: var(--color-gold); }
.stat-value.diamond { color: var(--color-diamond); }
.stat-value.level { color: var(--color-primary); }
.stat-value.layer { color: var(--color-accent); }

.header-actions { display: flex; gap: 0.5rem; }
.action-btn {
  background: var(--color-bg-card);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: var(--color-text-primary);
  padding: 0.5rem 0.75rem;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
}
.action-btn:hover { background: var(--color-primary); color: #000; }

.app-main { flex: 1; padding: 1rem; overflow-y: auto; }

@media (max-width: 640px) {
  .header-stats { flex-wrap: wrap; gap: 0.5rem; }
  .stat-item { padding: 0.25rem 0.5rem; }
  .stat-label { font-size: 0.6rem; }
  .stat-value { font-size: 0.8rem; }
  .action-btn { padding: 0.4rem 0.5rem; font-size: 0.85rem; }
}
</style>
