<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { usePlayerStore } from './stores/playerStore'
import { useMonsterStore } from './stores/monsterStore'
import { useGameStore } from './stores/gameStore'
import { useSkillStore } from './stores/skillStore'
import { useTrainingStore } from './stores/trainingStore'
import { useRebirthStore } from './stores/rebirthStore'
import type { TabItem } from './components/TabNavigation.vue'
import type { EquipmentSlot } from './types'
import type { DamagePopupData } from './components/DamagePopup.vue'
import BattleHUD from './components/BattleHUD.vue'
import PlayerStatusBar from './components/PlayerStatusBar.vue'
import OverlayContainer from './components/OverlayContainer.vue'
import TabsContainer from './components/TabsContainer.vue'
import PauseOverlay from './components/PauseOverlay.vue'
import RebirthModal from './components/RebirthModal.vue'
import { useGameLoop } from './composables/useGameLoop'

const playerStore = usePlayerStore()
const monsterStore = useMonsterStore()
const gameStore = useGameStore()
const skillStore = useSkillStore()
const trainingStore = useTrainingStore()
const rebirthStore = useRebirthStore()

const tabs: TabItem[] = [
  { id: 'battle', name: '战斗', icon: '⚔️' },
  { id: 'role', name: '角色', icon: '👤' },
  { id: 'cultivation', name: '养成', icon: '🌟' },
  { id: 'skills', name: '技能', icon: '✨' },
  { id: 'shop', name: '商店', icon: '🛒' },
  { id: 'settings', name: '更多', icon: '⚙️' }
]
const currentTab = ref('battle')
const battleMode = ref<'main' | 'training'>('main')
const showRebirthModal = ref(false)
const showRebirthShop = ref(false)
const showEquipConfirm = ref(false)
const equipConfirmSlot = ref<EquipmentSlot | null>(null)
const equipConfirmNewScore = ref(0)
const equipConfirmOldScore = ref(0)
const showResetConfirm = ref(false)
const damagePopups = ref<DamagePopupData[]>([])
let popupIdCounter = 0
const isDebugMode = ref(false)
const debugLog = ref<any[]>([])
const debugStats = ref({ totalDamage: 0, critCount: 0, killCount: 0, damageByType: {} as Record<string, number>, startTime: Date.now() })
let onlineTimeCounter = 0, autoSaveCounter = 0, timeIntervalId: number | null = null

function addDamagePopup(value: number, type: 'normal' | 'crit' | 'true' | 'void' | 'skill' | 'heal', offsetX = 0, offsetY = 0) {
  damagePopups.value.push({ id: popupIdCounter++, value, type, x: 150 + offsetX + Math.random() * 40 - 20, y: 200 + offsetY + Math.random() * 20 - 10 })
}
function showEquipmentConfirm(slot: EquipmentSlot, newScore: number, oldScore: number) {
  equipConfirmSlot.value = slot; equipConfirmNewScore.value = newScore; equipConfirmOldScore.value = oldScore; showEquipConfirm.value = true
}
function confirmEquip() { if (equipConfirmSlot.value) playerStore.equipNewEquipment(playerStore.pendingEquipment!); showEquipConfirm.value = false; equipConfirmSlot.value = null }
function cancelEquip() { showEquipConfirm.value = false; equipConfirmSlot.value = null; playerStore.pendingEquipment = null }
function useSkill(slotIndex: number) { const skill = skillStore.getPlayerSkills()[slotIndex]; if (!skill || skill.currentCooldown > 0 || !gameStore.canPlayerAct) return; skillStore.useSkill(slotIndex); gameStore.processPlayerAttack(slotIndex) }
function switchBattleMode(mode: 'main' | 'training') { battleMode.value = mode; if (mode === 'main') gameStore.resumeBattle() }
function switchToTrainingMode() { battleMode.value = 'training'; if (!trainingStore.currentTrainingMonster) trainingStore.spawnTrainingMonster() }
function goBackLevels() { if (playerStore.player.diamond >= 50) { playerStore.player.diamond -= 50; monsterStore.goBackLevels(10); playerStore.revive() } }
function openRebirthModal() { showRebirthModal.value = true; showRebirthShop.value = false }
function openRebirthShop() { showRebirthShop.value = true; showRebirthModal.value = false }
function closeRebirthModal() { showRebirthModal.value = false; showRebirthShop.value = false }
function performRebirth() { const result = rebirthStore.performRebirth(); closeRebirthModal(); alert(`转生成功！获得 ${result.pointsEarned} 转生点数！`) }
function toggleDebugMode() { isDebugMode.value = !isDebugMode.value; if (isDebugMode.value) debugStats.value = { totalDamage: 0, critCount: 0, killCount: 0, damageByType: {}, startTime: Date.now() }; debugLog.value = [] }
function exportDebugLog() { const blob = new Blob([JSON.stringify({ exportTime: new Date().toISOString(), stats: debugStats.value, logs: debugLog.value }, null, 2)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `damage-log-${Date.now()}.json`; a.click(); URL.revokeObjectURL(a.href); alert('日志已导出!') }
function resetDebugStats() { debugStats.value = { totalDamage: 0, critCount: 0, killCount: 0, damageByType: {}, startTime: Date.now() }; debugLog.value = [] }

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
  playerStore.loadGame()
  if (playerStore.player.currentHp <= 0) playerStore.player.currentHp = playerStore.player.maxHp
  if (!monsterStore.currentMonster) monsterStore.initMonster()
  startGameLoop()
  timeIntervalId = window.setInterval(tickTime, 1000)
})

onUnmounted(() => { stopGameLoop(); if (timeIntervalId) clearInterval(timeIntervalId); playerStore.saveGame() })
</script>

<template>
  <div class="game-container">
    <OverlayContainer
      :damage-popups="damagePopups"
      :show-equip-confirm="showEquipConfirm"
      :equip-confirm-new-score="equipConfirmNewScore"
      :equip-confirm-old-score="equipConfirmOldScore"
      :show-reset-confirm="showResetConfirm"
      @remove-popup="(id) => damagePopups = damagePopups.filter(p => p.id !== id)"
      @confirm-equip="confirmEquip"
      @cancel-equip="cancelEquip"
      @confirm-reset="playerStore.resetGame(); showResetConfirm = false"
      @cancel-reset="showResetConfirm = false"
    />
    <PlayerStatusBar @open-rebirth-shop="openRebirthShop" @open-rebirth-modal="openRebirthModal" />
    <BattleHUD :battle-mode="battleMode" @switch-mode="switchBattleMode" />
    <TabsContainer v-model:currentTab="currentTab" :tabs="tabs" :battle-mode="battleMode" :is-debug-mode="isDebugMode" :debug-stats="debugStats" :debug-log="debugLog" :player-stats="{}" @use-skill="useSkill" @go-back-levels="goBackLevels" @confirm-reset="showResetConfirm = true" @toggle-debug-mode="toggleDebugMode" @export-debug-log="exportDebugLog" @reset-debug-stats="resetDebugStats" />
    <PauseOverlay />
    <RebirthModal :show-rebirth-modal="showRebirthModal" :show-rebirth-shop="showRebirthShop" @close="closeRebirthModal" @perform-rebirth="performRebirth" @open-rebirth-shop="openRebirthShop" @open-rebirth-modal="openRebirthModal" />
  </div>
</template>

<style scoped>
@import './styles/design-system.css';
* { margin: 0; padding: 0; box-sizing: border-box; }
.game-container { font-family: var(--font-family); background: var(--color-bg-dark); color: var(--color-text-primary); min-height: 100vh; display: flex; flex-direction: column; }
</style>
