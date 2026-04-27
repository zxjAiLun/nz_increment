<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { usePlayerStore } from './stores/playerStore'
import { useMonsterStore } from './stores/monsterStore'
import { useGameStore } from './stores/gameStore'
import { useSkillStore } from './stores/skillStore'
import { useTrainingStore } from './stores/trainingStore'
import { useRebirthStore } from './stores/rebirthStore'
import { useI18nStore } from './stores/i18nStore'
import { useNavigationStore } from './stores/navigationStore'
import { LOCALES } from './i18n'
import type { EquipmentSlot } from './types'
import BattleHUD from './components/BattleHUD.vue'
import PlayerStatusBar from './components/PlayerStatusBar.vue'
import OverlayContainer from './components/OverlayContainer.vue'
import TabsContainer from './components/TabsContainer.vue'
import PauseOverlay from './components/PauseOverlay.vue'
import RebirthModal from './components/RebirthModal.vue'
import OfflineRewardModal from './components/OfflineRewardModal.vue'
import { useGameLoop } from './composables/useGameLoop'

const playerStore = usePlayerStore()
const monsterStore = useMonsterStore()
const gameStore = useGameStore()
const skillStore = useSkillStore()
const trainingStore = useTrainingStore()
const rebirthStore = useRebirthStore()
const navigationStore = useNavigationStore()
const i18n = useI18nStore()
const battleMode = ref<'main' | 'training'>('main')
const showRebirthModal = ref(false)
const showRebirthShop = ref(false)
const showEquipConfirm = ref(false)
const equipConfirmSlot = ref<EquipmentSlot | null>(null)
const equipConfirmNewScore = ref(0)
const equipConfirmOldScore = ref(0)
const showResetConfirm = ref(false)
const showOfflineModal = ref(false)
const offlineData = ref({ gold: 0, exp: 0, minutes: 0 })
const screenShaking = ref(false)
const isDebugMode = ref(false)
const debugLog = ref<any[]>([])
const debugStats = ref({ totalDamage: 0, critCount: 0, killCount: 0, damageByType: {} as Record<string, number>, startTime: Date.now() })
let onlineTimeCounter = 0, autoSaveCounter = 0, timeIntervalId: number | null = null

function confirmEquip() { if (equipConfirmSlot.value) playerStore.equipNewEquipment(playerStore.pendingEquipment!); showEquipConfirm.value = false; equipConfirmSlot.value = null }
function cancelEquip() { showEquipConfirm.value = false; equipConfirmSlot.value = null; playerStore.pendingEquipment = null }
function useSkill(slotIndex: number) { const skill = skillStore.getPlayerSkills()[slotIndex]; if (!skill || skill.currentCooldown > 0 || !gameStore.canPlayerAct) return; skillStore.useSkill(slotIndex); gameStore.processPlayerAttack(slotIndex) }
function switchBattleMode(mode: 'main' | 'training') { battleMode.value = mode; if (mode === 'main') gameStore.resumeBattle() }
function goBackLevels() { if (playerStore.player.diamond >= 50) { playerStore.player.diamond -= 50; monsterStore.goBackLevels(10); playerStore.revive() } }
function openRebirthModal() { showRebirthModal.value = true; showRebirthShop.value = false }
function openRebirthShop() { showRebirthShop.value = true; showRebirthModal.value = false }
function closeRebirthModal() { showRebirthModal.value = false; showRebirthShop.value = false }
function performRebirth() { const result = rebirthStore.performRebirth(); closeRebirthModal(); alert(`转生成功！获得 ${result.pointsEarned} 转生点数！`) }
function toggleDebugMode() { isDebugMode.value = !isDebugMode.value; if (isDebugMode.value) debugStats.value = { totalDamage: 0, critCount: 0, killCount: 0, damageByType: {}, startTime: Date.now() }; debugLog.value = [] }
function exportDebugLog() { const blob = new Blob([JSON.stringify({ exportTime: new Date().toISOString(), stats: debugStats.value, logs: debugLog.value }, null, 2)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `damage-log-${Date.now()}.json`; a.click(); URL.revokeObjectURL(a.href); alert('日志已导出!') }
function resetDebugStats() { debugStats.value = { totalDamage: 0, critCount: 0, killCount: 0, damageByType: {}, startTime: Date.now() }; debugLog.value = [] }
function openMenu() { navigationStore.openMenu('settings') }

function gameLoop(deltaTime: number) {
  if (gameStore.isPaused) return
  const effectiveDelta = deltaTime * gameStore.gameSpeed
  gameStore.updateSkillCooldowns(effectiveDelta)
  gameStore.updateGauges(effectiveDelta)
  if (gameStore.canMonsterAct) gameStore.processMonsterAttack()
  if (gameStore.canPlayerAct) { const nextSkill = skillStore.getNextReadySkill(); gameStore.processPlayerAttack(nextSkill ? nextSkill.index : null) }
}
const { start: startGameLoop, stop: stopGameLoop } = useGameLoop(gameLoop)

function tickTime() {
  if (gameStore.isPaused) return
  onlineTimeCounter++; autoSaveCounter++
  if (onlineTimeCounter >= 1) { playerStore.updateOnlineTime(1); const expGain = playerStore.getExpPerSecond(); if (expGain > 0) playerStore.addExperience(expGain); onlineTimeCounter = 0 }
  if (autoSaveCounter >= 30) { playerStore.saveGame(); autoSaveCounter = 0 }
}

onMounted(() => {
  ;(window as any).gameVM = { playerStore, monsterStore, gameStore, skillStore, trainingStore, rebirthStore }
  navigationStore.initialize()
  playerStore.loadGame()
  if (playerStore.player.currentHp <= 0) playerStore.player.currentHp = playerStore.player.maxHp
  if (!monsterStore.currentMonster) monsterStore.initMonster()

  const offline = playerStore.calculateOfflineProgress()
  if (offline.minutes >= 1) {
    showOfflineModal.value = true
    offlineData.value = offline
  }
  window.addEventListener('beforeunload', playerStore.recordLogout)

  startGameLoop()
  timeIntervalId = window.setInterval(tickTime, 1000)
})

onUnmounted(() => { stopGameLoop(); if (timeIntervalId) clearInterval(timeIntervalId); playerStore.saveGame() })
</script>

<template>
  <div class="game-container" :class="{ 'screen-shake': screenShaking }">
    <OverlayContainer
      :damage-popups="gameStore.damagePopups"
      :show-equip-confirm="showEquipConfirm"
      :equip-confirm-new-score="equipConfirmNewScore"
      :equip-confirm-old-score="equipConfirmOldScore"
      :show-reset-confirm="showResetConfirm"
      @remove-popup="(id) => gameStore.removeDamagePopup(id)"
      @confirm-equip="confirmEquip"
      @cancel-equip="cancelEquip"
      @confirm-reset="playerStore.resetGame(); showResetConfirm = false"
      @cancel-reset="showResetConfirm = false"
    />

    <div class="app-chrome">
      <div class="ambient ambient-one"></div>
      <div class="ambient ambient-two"></div>

      <section class="top-shell ui-panel">
        <PlayerStatusBar @open-rebirth-shop="openRebirthShop" @open-rebirth-modal="openRebirthModal" />
        <div class="global-actions">
          <select v-model="i18n.currentLocale" @change="i18n.setLocale(i18n.currentLocale)" aria-label="语言">
            <option v-for="loc in LOCALES" :key="loc.code" :value="loc.code">{{ loc.name }}</option>
          </select>
          <button class="menu-btn ui-btn" @click="openMenu">菜单</button>
        </div>
      </section>

      <main class="game-workbench">
        <aside class="battle-rail ui-panel">
          <BattleHUD :battle-mode="battleMode" @switch-mode="switchBattleMode" />
        </aside>

        <section class="content-workspace ui-panel">
          <TabsContainer
            :battle-mode="battleMode"
            :is-debug-mode="isDebugMode"
            :debug-stats="debugStats"
            :debug-log="debugLog"
            @use-skill="useSkill"
            @go-back-levels="goBackLevels"
            @confirm-reset="showResetConfirm = true"
            @toggle-debug-mode="toggleDebugMode"
            @export-debug-log="exportDebugLog"
            @reset-debug-stats="resetDebugStats"
            @switch-battle-mode="switchBattleMode"
          />
        </section>
      </main>
    </div>

    <PauseOverlay />
    <RebirthModal :show-rebirth-modal="showRebirthModal" :show-rebirth-shop="showRebirthShop" @close="closeRebirthModal" @perform-rebirth="performRebirth" @open-rebirth-shop="openRebirthShop" @open-rebirth-modal="openRebirthModal" />
    <OfflineRewardModal v-if="showOfflineModal" :offline-data="offlineData" @close="showOfflineModal = false" />
  </div>
</template>

<style scoped>
@import './styles/design-system.css';

.game-container {
  min-height: 100vh;
  background:
    radial-gradient(circle at 12% 10%, rgba(69, 230, 208, 0.16), transparent 28rem),
    radial-gradient(circle at 85% 0%, rgba(143, 122, 255, 0.14), transparent 24rem),
    linear-gradient(180deg, #080b14 0%, #060811 100%);
  color: var(--color-text-primary);
  font-family: var(--font-family);
  position: relative;
  overflow: hidden;
}

.app-chrome {
  position: relative;
  z-index: 1;
  min-height: 100vh;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
  padding: 0.9rem;
}

.ambient {
  position: fixed;
  pointer-events: none;
  border-radius: 999px;
  filter: blur(50px);
  opacity: 0.5;
}

.ambient-one {
  width: 19rem;
  height: 19rem;
  left: -6rem;
  bottom: 8rem;
  background: rgba(255, 79, 123, 0.15);
}

.ambient-two {
  width: 17rem;
  height: 17rem;
  right: -5rem;
  top: 8rem;
  background: rgba(69, 230, 208, 0.14);
}

.top-shell {
  position: relative;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 1rem;
  align-items: start;
  padding: 0;
  overflow: hidden;
}

.global-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.8rem;
}

.global-actions select {
  min-width: 8rem;
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius-md);
  padding: 0.5rem 0.7rem;
  background: var(--color-bg-input);
  color: var(--color-text-primary);
  outline: none;
}

.global-actions select:focus {
  border-color: var(--color-secondary);
  box-shadow: 0 0 0 3px var(--color-focus-ring);
}

.menu-btn {
  white-space: nowrap;
}

.game-workbench {
  min-height: 0;
  min-width: 0;
  width: 100%;
  max-width: 100%;
  flex: 1;
  display: grid;
  grid-template-columns: minmax(20rem, 25rem) minmax(0, 1fr);
  gap: 0.9rem;
}

.battle-rail,
.content-workspace {
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.battle-rail {
  display: flex;
  flex-direction: column;
}

.content-workspace {
  display: flex;
  flex-direction: column;
}

.screen-shake { animation: shake 0.3s ease-out; }

@media (max-width: 1180px) {
  .game-workbench {
    grid-template-columns: 1fr;
  }

  .battle-rail {
    max-height: none;
  }
}

@media (max-width: 760px) {
  .game-container {
    min-height: 100dvh;
    overflow-y: auto;
  }

  .app-chrome {
    min-height: 100dvh;
    padding: 0.55rem;
    padding-bottom: calc(var(--mobile-bottom-nav-height) + 0.75rem + env(safe-area-inset-bottom));
    gap: 0.55rem;
  }

  .top-shell {
    grid-template-columns: 1fr;
  }

  .global-actions {
    justify-content: space-between;
    padding-top: 0;
  }

  .game-workbench {
    gap: 0.55rem;
    min-width: 0;
  }

  .content-workspace,
  .battle-rail,
  .top-shell {
    border-radius: var(--border-radius-lg);
  }
}
</style>
