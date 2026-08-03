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
import { useOfflineRewardModal } from './composables/useOfflineRewardModal'

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
const screenShaking = ref(false)
const isDebugMode = ref(false)
const debugLog = ref<any[]>([])
const debugStats = ref({ totalDamage: 0, critCount: 0, killCount: 0, damageByType: {} as Record<string, number>, startTime: Date.now() })
let onlineTimeCounter = 0, autoSaveCounter = 0, timeIntervalId: number | null = null
// Phase 3.40：启动运行时闸门。只有 ready 才允许启动 game loop / 在线计时 / 自动保存 /
// beforeunload / 离线奖励入口；blocked 时暂停一切运行时并展示失败层，仅允许显式重试。
const runtimeStartupStatus = ref<'initializing' | 'ready' | 'blocked'>('initializing')
const runtimeStartupError = ref('')
let runtimeStartedOnce = false

function confirmEquip() {
  if (equipConfirmSlot.value && playerStore.pendingEquipment) {
    // Phase 3.3：必须检查实际返回值。只有权威事务成功（替换/空槽位装备）才关闭并清理；
    // 装备被锁或存档失败都返回 false，此时保持弹窗打开，绝不表现为成功。
    const equipped = playerStore.equipNewEquipment(playerStore.pendingEquipment)
    if (equipped) {
      showEquipConfirm.value = false
      equipConfirmSlot.value = null
    }
  } else {
    showEquipConfirm.value = false
    equipConfirmSlot.value = null
  }
}
function cancelEquip() { showEquipConfirm.value = false; equipConfirmSlot.value = null; playerStore.pendingEquipment = null }
function useSkill(slotIndex: number) {
  // Phase 3.40：blocked 状态禁止技能交互，不进入战斗行动。
  if (runtimeStartupStatus.value !== 'ready') return
  gameStore.tryUsePlayerSkill(slotIndex)
}
// Phase 3.39：模式切换在死亡/非法 HP 时 fail-closed。切到训练直接设置模式；切回主线
// 必须等 resumeBattle() 返回 true（存活校验通过、战斗恢复成功）才把 UI 模式设为 main，
// 否则保留原模式。App 不直接检查/修改 HP，不调用 revive/saveGame/死亡恢复事务。
function switchBattleMode(mode: 'main' | 'training') {
  // Phase 3.40：blocked 状态禁止切换主线（resumeBattle 也不得被绕过触发）。
  if (runtimeStartupStatus.value !== 'ready') return
  if (mode === 'training') {
    battleMode.value = 'training'
    return
  }

  if (gameStore.resumeBattle()) {
    battleMode.value = 'main'
  }
}
// Phase 3.33：返回 10 层购买收口为 gameStore 单一权威事务（扣钻→回层→满血→单次写盘，
// 失败完整回滚）。App.vue 不再直接改 diamond / currentHp、不再调 monsterStore.goBackLevels
// / playerStore.revive / saveGame。
function goBackLevels() { gameStore.tryPurchaseGoBackLevels() }
function openRebirthModal() { showRebirthModal.value = true; showRebirthShop.value = false }
function openRebirthShop() { showRebirthShop.value = true; showRebirthModal.value = false }
function closeRebirthModal() { showRebirthModal.value = false; showRebirthShop.value = false }
function performRebirth() { const result = rebirthStore.performRebirth(); closeRebirthModal(); alert(`转生成功！获得 ${result.pointsEarned} 转生点数！`) }
function toggleDebugMode() { isDebugMode.value = !isDebugMode.value; if (isDebugMode.value) debugStats.value = { totalDamage: 0, critCount: 0, killCount: 0, damageByType: {}, startTime: Date.now() }; debugLog.value = [] }
function exportDebugLog() { const blob = new Blob([JSON.stringify({ exportTime: new Date().toISOString(), stats: debugStats.value, logs: debugLog.value }, null, 2)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `damage-log-${Date.now()}.json`; a.click(); URL.revokeObjectURL(a.href); alert('日志已导出!') }
function resetDebugStats() { debugStats.value = { totalDamage: 0, critCount: 0, killCount: 0, damageByType: {}, startTime: Date.now() }; debugLog.value = [] }
function openMenu() { navigationStore.openMenu('settings') }
// Phase 3.2.1：领取失败时 claimOfflineReward 返回 null，必须保持弹窗打开，
// 避免用户误以为已领取；成功才关闭。
const { handleClaim } = useOfflineRewardModal()
function onClaimOffline() {
  // Phase 3.40：blocked 状态禁止领取离线收益。
  if (runtimeStartupStatus.value !== 'ready') return
  if (handleClaim()) {
    showOfflineModal.value = false
  }
}

// 单一战斗循环：直接复用 gameStore.gameLoop(deltaTime)，避免线上与 store 内
// 两套循环分歧（此前 App.vue 复制了简化循环，导致回血与标记 tick 长期未在
// 线上主循环执行）。deltaTime 为 useGameLoop 提供的毫秒数。
const { start: startGameLoop, stop: stopGameLoop } = useGameLoop(gameStore.gameLoop)

// Phase 3.40：tickTime 只有运行时 ready 才结算在线时间 / 在线经验 / 自动保存。
// 即使未来重构误调用，blocked / initializing 状态下也一律零结算、零写盘。
function tickTime() {
  if (runtimeStartupStatus.value !== 'ready') return
  if (gameStore.isPaused) return
  onlineTimeCounter++; autoSaveCounter++
  if (onlineTimeCounter >= 1) { playerStore.updateOnlineTime(1); const expGain = playerStore.getExpPerSecond(); if (expGain > 0) playerStore.addExperience(expGain); onlineTimeCounter = 0 }
  if (autoSaveCounter >= 30) { playerStore.saveGame(); autoSaveCounter = 0 }
}

/**
 * Phase 3.40：启动运行时。权威入口是 gameStore.prepareBattleRuntimeAfterLoad()——
 * App 不再直接 initMonster / recoverLoadedPlayerDeath / 检查或修改 currentHp。
 * 只有准备成功才启动运行资源（startRuntimeOnce 内部保证最多一次）。
 */
function attemptRuntimeStartup() {
  if (runtimeStartupStatus.value === 'ready') return // 已 ready 时 no-op，不重复创建资源

  const result = gameStore.prepareBattleRuntimeAfterLoad()
  if (result.ok) {
    runtimeStartupStatus.value = 'ready'
    runtimeStartupError.value = ''
    startRuntimeOnce()
  } else {
    runtimeStartupStatus.value = 'blocked'
    runtimeStartupError.value = result.reason
  }
}

/** 只允许在准备成功后调用，且最多执行一次：启动 loop / interval / beforeunload / 离线弹窗。 */
function startRuntimeOnce() {
  if (runtimeStartedOnce) return
  runtimeStartedOnce = true
  startGameLoop()
  timeIntervalId = window.setInterval(tickTime, 1000)
  window.addEventListener('beforeunload', playerStore.recordLogout)

  // Phase 3.2：弹窗只展示同一份结算快照，领取统一走 claimOfflineReward。
  // 只有运行时 ready 之后才允许展示离线收益入口。
  const pending = playerStore.pendingOfflineReward
  if (pending && (pending.gold > 0 || pending.exp > 0)) {
    showOfflineModal.value = true
  }
}

/** 停止并清理运行时资源（只在曾成功启动过时才有意义）。 */
function stopRuntime() {
  stopGameLoop()
  if (timeIntervalId !== null) {
    clearInterval(timeIntervalId)
    timeIntervalId = null
  }
  window.removeEventListener('beforeunload', playerStore.recordLogout)
}

onMounted(() => {
  ;(window as any).gameVM = { playerStore, monsterStore, gameStore, skillStore, trainingStore, rebirthStore }
  navigationStore.initialize()
  // Phase 3.40：先加载存档，再执行受控启动闸门。启动恢复/怪物初始化统一由
  // gameStore.prepareBattleRuntimeAfterLoad() 处理，成功才启动运行时。
  playerStore.loadGame()
  attemptRuntimeStartup()
})

onUnmounted(() => {
  if (runtimeStartedOnce) {
    stopRuntime()
    playerStore.saveGame()
  }
  // blocked / 从未 ready：零 saveGame、零 recordLogout，不形成隐式恢复重试。
})
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
    <OfflineRewardModal v-if="showOfflineModal" :offline-data="playerStore.pendingOfflineReward" @claim="onClaimOffline" @close="showOfflineModal = false" />

    <!-- Phase 3.40：启动失败阻断层——覆盖战斗交互，仅允许显式重试，不自动重试。 -->
    <div v-if="runtimeStartupStatus === 'blocked'" class="runtime-gate-overlay">
      <div class="runtime-gate-panel ui-panel">
        <h2>游戏启动恢复失败</h2>
        <p>战斗循环与自动保存已暂停</p>
        <p class="runtime-gate-reason">失败原因：{{ runtimeStartupError }}</p>
        <button class="ui-btn" @click="attemptRuntimeStartup">重试启动恢复</button>
      </div>
    </div>
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

.runtime-gate-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(5, 8, 16, 0.88);
  backdrop-filter: blur(4px);
}

.runtime-gate-panel {
  max-width: 24rem;
  padding: 1.5rem;
  text-align: center;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.runtime-gate-reason {
  color: var(--color-text-muted);
  word-break: break-all;
}
</style>
