<script setup lang="ts">
import { ref, onBeforeUnmount, onMounted, defineAsyncComponent } from 'vue'
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
import { useGameLoop } from './composables/useGameLoop'
import { useOfflineRewardModal } from './composables/useOfflineRewardModal'
// Phase 3.55：RebirthModal 异步加载——从首屏依赖图拆出，仅当 modal/shop 打开时才加载。
const RebirthModal = defineAsyncComponent(() => import('./components/RebirthModal.vue'))

// Phase 3.56：OfflineRewardModal 异步加载——从首屏依赖图拆出，仅当存在离线结算时才加载。
const OfflineRewardModal = defineAsyncComponent(() => import('./components/OfflineRewardModal.vue'))

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
// Phase 3.43：beforeunload listener 所有权标记。成功注册后才为 true；stopRuntime 只移除已注册的 listener。
let beforeUnloadRegistered = false
// Phase 3.40：启动运行时闸门。只有 ready 才允许启动 game loop / 在线计时 / 自动保存 /
// beforeunload / 离线奖励入口；blocked 时暂停一切运行时并展示失败层，仅允许显式重试。
const runtimeStartupStatus = ref<'initializing' | 'ready' | 'blocked' | 'faulted'>('initializing')
const runtimeStartupError = ref('')
let runtimeStartedOnce = false
// Phase 3.46：单次关闭事务 latch。在任何清理/保存前提交，重复调用关闭入口为 no-op。
let runtimeShutdownStarted = false

// Phase 3.51：ready guard + 快照 pending/slot + 权威装备事务包 try/catch。
// Phase 3.3 语义保持：false（锁定/不够好/保存失败）保持确认 UI；throw 进入 fail-stop。
function confirmEquip() {
  if (runtimeStartupStatus.value !== 'ready') return

  const slot = equipConfirmSlot.value
  const pending = playerStore.pendingEquipment

  if (!slot || !pending) {
    showEquipConfirm.value = false
    equipConfirmSlot.value = null
    return
  }

  try {
    if (playerStore.equipNewEquipment(pending)) {
      showEquipConfirm.value = false
      equipConfirmSlot.value = null
    }
  } catch (error) {
    enterRuntimeFault(formatRuntimeFault('equipment confirmation failed', error))
  }
}
function cancelEquip() { showEquipConfirm.value = false; equipConfirmSlot.value = null; playerStore.pendingEquipment = null }
// Phase 3.52：游戏重置确认。ready guard + resetGame 一次；true 才关闭 modal；
// false 保持 modal（业务拒绝/持久化失败，不 fault）；unexpected throw 进入 fail-stop。
function confirmReset() {
  if (runtimeStartupStatus.value !== 'ready') return
  try {
    if (playerStore.resetGame()) {
      showResetConfirm.value = false
    }
  } catch (error) {
    enterRuntimeFault(formatRuntimeFault('game reset failed', error))
  }
}
function useSkill(slotIndex: number) {
  // Phase 3.40：blocked 状态禁止技能交互，不进入战斗行动。
  // Phase 3.50：action 意外 throw 进入 App fail-stop（skill interaction failed），不重试。
  if (runtimeStartupStatus.value !== 'ready') return
  try {
    gameStore.tryUsePlayerSkill(slotIndex)
  } catch (error) {
    enterRuntimeFault(formatRuntimeFault('skill interaction failed', error))
  }
}
// Phase 3.39：模式切换在死亡/非法 HP 时 fail-closed。切到训练直接设置模式；切回主线
// 必须等 resumeBattle() 返回 true（存活校验通过、战斗恢复成功）才把 UI 模式设为 main，
// 否则保留原模式。App 不直接检查/修改 HP，不调用 revive/saveGame/死亡恢复事务。
function switchBattleMode(mode: 'main' | 'training') {
  // Phase 3.40：blocked 状态禁止切换主线（resumeBattle 也不得被绕过触发）。
  // Phase 3.50：整个交互在同一异常边界；resumeBattle throw 进入 fail-stop，不提交 UI 模式。
  if (runtimeStartupStatus.value !== 'ready') return
  if (mode === 'training') {
    battleMode.value = 'training'
    return
  }

  try {
    if (gameStore.resumeBattle()) {
      battleMode.value = 'main'
    }
  } catch (error) {
    enterRuntimeFault(formatRuntimeFault('battle mode switch failed', error))
  }
}
// Phase 3.33：返回 10 层购买收口为 gameStore 单一权威事务（扣钻→回层→满血→单次写盘，
// 失败完整回滚）。App.vue 不再直接改 diamond / currentHp、不再调 monsterStore.goBackLevels
// / playerStore.revive / saveGame。
// Phase 3.50：新增 ready guard；action 意外 throw 进入 fail-stop（go back levels failed）。
function goBackLevels() {
  if (runtimeStartupStatus.value !== 'ready') return
  try {
    gameStore.tryPurchaseGoBackLevels()
  } catch (error) {
    enterRuntimeFault(formatRuntimeFault('go back levels failed', error))
  }
}
function openRebirthModal() { showRebirthModal.value = true; showRebirthShop.value = false }
function openRebirthShop() { showRebirthShop.value = true; showRebirthModal.value = false }
function closeRebirthModal() { showRebirthModal.value = false; showRebirthShop.value = false }
// Phase 3.53：转生确认。ready guard + action 异常边界；null 表示资格拒绝保持 UI；
// 成功才关闭 modal/shop；alert 成功提示独立防御边界（非关键副作用，不 fault）。
function performRebirth() {
  if (runtimeStartupStatus.value !== 'ready') return

  let result: { pointsEarned: number } | null

  try {
    result = rebirthStore.performRebirth()
  } catch (error) {
    enterRuntimeFault(formatRuntimeFault('rebirth interaction failed', error))
    return
  }

  if (!result) return

  closeRebirthModal()

  try {
    alert(`转生成功！获得 ${result.pointsEarned} 转生点数！`)
  } catch {
    // 成功提示是非关键副作用
  }
}
// Phase 3.54：转生商店升级购买。ready guard + action 异常边界；false（预期拒绝 /
// 事务失败回滚）保持 shop，不 fault；unexpected throw 进入 fail-stop。
function purchaseRebirthUpgrade(upgradeId: string) {
  if (runtimeStartupStatus.value !== 'ready') return

  try {
    rebirthStore.purchaseUpgrade(upgradeId)
  } catch (error) {
    enterRuntimeFault(formatRuntimeFault('rebirth upgrade purchase failed', error))
  }
}
function toggleDebugMode() { isDebugMode.value = !isDebugMode.value; if (isDebugMode.value) debugStats.value = { totalDamage: 0, critCount: 0, killCount: 0, damageByType: {}, startTime: Date.now() }; debugLog.value = [] }
function exportDebugLog() { const blob = new Blob([JSON.stringify({ exportTime: new Date().toISOString(), stats: debugStats.value, logs: debugLog.value }, null, 2)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `damage-log-${Date.now()}.json`; a.click(); URL.revokeObjectURL(a.href); alert('日志已导出!') }
function resetDebugStats() { debugStats.value = { totalDamage: 0, critCount: 0, killCount: 0, damageByType: {}, startTime: Date.now() }; debugLog.value = [] }
function openMenu() { navigationStore.openMenu('settings') }
// Phase 3.2.1：领取失败时 claimOfflineReward 返回 null，必须保持弹窗打开，
// 避免用户误以为已领取；成功才关闭。
const { handleClaim } = useOfflineRewardModal()
function onClaimOffline() {
  // Phase 3.40：blocked 状态禁止领取离线收益。
  // Phase 3.50：handleClaim 意外 throw 进入 fail-stop（offline reward claim failed）；
  // enterRuntimeFault 会关闭离线弹窗。
  if (runtimeStartupStatus.value !== 'ready') return
  try {
    if (handleClaim()) {
      showOfflineModal.value = false
    }
  } catch (error) {
    enterRuntimeFault(formatRuntimeFault('offline reward claim failed', error))
  }
}

// 单一战斗循环：通过受控帧包装接入 useGameLoop。deltaTime 为 useGameLoop 提供的毫秒数。
// Phase 3.41：帧返回 false（战斗运行期故障 / 死亡恢复失败）时进入全局 fail-stop。
// Phase 3.44：gameLoop 意外抛异常同样纳入 App 级 fail-stop（battle runtime frame failed），
// 与 false 返回分属独立故障域：catch 不修改 store 已锁定的 battleError，不重新抛出，
// 不逃出真实 RAF callback。
function handleGameFrame(deltaTime: number) {
  if (runtimeStartupStatus.value !== 'ready') return

  let ok: boolean

  try {
    ok = gameStore.gameLoop(deltaTime)
  } catch (error) {
    enterRuntimeFault(formatRuntimeFault('battle runtime frame failed', error))
    return
  }

  if (!ok) {
    enterRuntimeFault(
      gameStore.battleError?.message ??
        'battle runtime failed'
    )
  }
}

// Phase 3.49：运行期 visibility / 帧末调度失败统一进入 App fail-stop。
// ready 才处理；首次启动的资源安装失败不走此回调（由 startRuntimeOnce 分类）。
function handleGameLoopLifecycleFault(error: unknown) {
  if (runtimeStartupStatus.value !== 'ready') return

  enterRuntimeFault(formatRuntimeFault('game loop lifecycle failed', error))
}

const { start: startGameLoop, stop: stopGameLoop } = useGameLoop(handleGameFrame, handleGameLoopLifecycleFault)

// Phase 3.40 / 3.42：tickTime 只有运行时 ready 才结算在线时间 / 在线经验 / 自动保存。
// 即使未来重构误调用，blocked / initializing / faulted 状态下也一律零结算、零写盘。
// Phase 3.42 Repair 1：在线任务异常与自动保存异常分属独立故障域——前者标记
// online runtime tick failed，后者标记 automatic save failed；saveGame 返回 false
// 走明确失败分支，计数只在保存成功后才归零；异常不逃出 interval callback。

// 故障原因统一规范化：Error 取 message，非 Error 用 String；空 message 收敛为基础
// 分类文本，不产生多余尾随冒号，不向 UI 暴露 stack。
function formatRuntimeFault(prefix: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)

  return message ? `${prefix}: ${message}` : prefix
}

function tickTime() {
  if (runtimeStartupStatus.value !== 'ready') return
  if (gameStore.isPaused) return

  try {
    onlineTimeCounter++
    autoSaveCounter++

    if (onlineTimeCounter >= 1) {
      playerStore.updateOnlineTime(1)

      const expGain = playerStore.getExpPerSecond()
      if (expGain > 0) {
        playerStore.addExperience(expGain)
      }

      onlineTimeCounter = 0
    }
  } catch (error) {
    // 仅在线任务（updateOnlineTime / getExpPerSecond / addExperience）故障域。
    enterRuntimeFault(formatRuntimeFault('online runtime tick failed', error))
    return
  }

  if (autoSaveCounter >= 30) {
    let saved: boolean

    try {
      saved = playerStore.saveGame()
    } catch (error) {
      // 自动保存故障域：saveGame 抛异常不落入在线任务通用 catch。
      enterRuntimeFault(formatRuntimeFault('automatic save failed', error))
      return
    }

    if (!saved) {
      enterRuntimeFault('automatic save failed')
      return
    }

    autoSaveCounter = 0
  }
}

/**
 * Phase 3.40：启动运行时。权威入口是 gameStore.prepareBattleRuntimeAfterLoad()——
 * App 不再直接 initMonster / recoverLoadedPlayerDeath / 检查或修改 currentHp。
 * Phase 3.43：准备入口与资源安装都改为原子启动事务——准备入口抛异常进入 faulted
 * （runtime preparation failed）；{ ok:false } 仍进入 blocked（可显式重试）；
 * 资源安装全部成功才提交 ready，任一步失败 rollback 并进入 faulted。
 */
function attemptRuntimeStartup() {
  // 已 ready 时 no-op；faulted 只允许重新加载应用，不提供启动重试。
  if (runtimeStartupStatus.value === 'ready' || runtimeStartupStatus.value === 'faulted') return

  let result: ReturnType<typeof gameStore.prepareBattleRuntimeAfterLoad>

  try {
    result = gameStore.prepareBattleRuntimeAfterLoad()
  } catch (error) {
    // 准备入口意外抛异常：与运行期 latch 隔离，不写 battleError。
    enterRuntimeFault(formatRuntimeFault('runtime preparation failed', error))
    return
  }

  if (!result.ok) {
    runtimeStartupStatus.value = 'blocked'
    runtimeStartupError.value = result.reason
    return
  }

  runtimeStartupError.value = ''

  if (startRuntimeOnce()) {
    runtimeStartupStatus.value = 'ready'
  }
}

/**
 * Phase 3.47：浏览器 beforeunload 持久化边界。ready 才执行；recordLogout 返回 false /
 * 抛异常统一进入 faulted（beforeunload persistence failed）。成功后保持运行资源——
 * 其他页面 handler 可能取消导航，若用户留在页面游戏必须继续正常运行。
 */
function handleBeforeUnload() {
  if (runtimeStartupStatus.value !== 'ready') return

  try {
    const saved = playerStore.recordLogout()

    if (!saved) {
      enterRuntimeFault('beforeunload persistence failed')
    }
  } catch (error) {
    enterRuntimeFault(formatRuntimeFault('beforeunload persistence failed', error))
  }
}

/**
 * Phase 3.43：原子启动事务。全部资源（RAF / interval / beforeunload / 离线弹窗初始化）
 * 安装成功才提交 runtimeStartedOnce 并返回 true；任一步抛异常则统一 enterRuntimeFault
 * 回滚已安装资源并返回 false。runtimeStartedOnce 是成功提交标志而非「尝试过」标志。
 */
function startRuntimeOnce(): boolean {
  if (runtimeStartedOnce) return true

  try {
    startGameLoop()

    timeIntervalId = window.setInterval(tickTime, 1000)

    window.addEventListener('beforeunload', handleBeforeUnload)
    beforeUnloadRegistered = true

    // Phase 3.2：弹窗只展示同一份结算快照，领取统一走 claimOfflineReward。
    // 只有全部资源安装成功后才允许展示离线收益入口。
    const pending = playerStore.pendingOfflineReward
    if (pending && (pending.gold > 0 || pending.exp > 0)) {
      showOfflineModal.value = true
    }

    runtimeStartedOnce = true
    return true
  } catch (error) {
    // 统一经 enterRuntimeFault 回滚（stopRuntime）并进入 faulted，不复制清理逻辑。
    enterRuntimeFault(formatRuntimeFault('runtime startup failed', error))
    return false
  }
}

/**
 * Phase 3.48：运行时资源清理。每个资源独立异常边界，先释放内部所有权再最佳努力
 * 调用外部 API；返回第一条清理错误（null 表示全部成功）。不直接修改 runtime status、
 * 不调用 enterRuntimeFault、不保存。
 */
function stopRuntime(): unknown | null {
  let firstError: unknown | null = null

  try {
    const loopError = stopGameLoop()
    if (loopError !== null) {
      firstError = loopError
    }
  } catch (error) {
    firstError = error
  }

  if (timeIntervalId !== null) {
    const intervalId = timeIntervalId
    timeIntervalId = null

    try {
      clearInterval(intervalId)
    } catch (error) {
      if (firstError === null) {
        firstError = error
      }
    }
  }

  if (beforeUnloadRegistered) {
    beforeUnloadRegistered = false

    try {
      window.removeEventListener('beforeunload', handleBeforeUnload)
    } catch (error) {
      if (firstError === null) {
        firstError = error
      }
    }
  }

  return firstError
}

/**
 * Phase 3.41：运行期故障熔断（幂等）。首次调用：
 * 状态 → faulted、保存错误文本、停止 game loop、清除 1000ms interval、移除 beforeunload、
 * 关闭离线弹窗、阻止技能/模式切换/离线领取；不 saveGame、不 recordLogout、不启动准备、
 * 不调用死亡恢复、不修改 HP、不自动重试。重复调用 no-op，保留第一条错误原因。
 */
function enterRuntimeFault(reason: string) {
  if (runtimeStartupStatus.value === 'faulted') return
  runtimeStartupStatus.value = 'faulted'
  runtimeStartupError.value = reason
  stopRuntime()
  showOfflineModal.value = false
}

/** 故障 UI 的「重新加载游戏」：只允许页面重载，不先写盘、不自动刷新。 */
function reloadGame() {
  window.location.reload()
}

// Phase 3.45：debug gameVM 不是关键启动资源，赋值失败不影响正式启动。
function exposeDebugVm() {
  try {
    ;(window as any).gameVM = { playerStore, monsterStore, gameStore, skillStore, trainingStore, rebirthStore }
  } catch {
    // 非关键调试入口，失败不影响导航 / 存档 / 启动准备。
  }
}

/**
 * Phase 3.45：App bootstrap 单一协调入口。导航初始化与存档加载各拥有独立异常边界——
 * 任一步抛异常 → faulted（navigation initialization failed / game state loading failed），
 * 后续步骤全部跳过；两步都成功后才调用启动准备（attemptRuntimeStartup）。
 * faulted 后调用为 no-op；blocked 重试仍只调用 attemptRuntimeStartup，不重跑导航/存档。
 */
function initializeAppRuntime() {
  if (runtimeStartupStatus.value !== 'initializing') return

  try {
    navigationStore.initialize()
  } catch (error) {
    enterRuntimeFault(formatRuntimeFault('navigation initialization failed', error))
    return
  }

  try {
    playerStore.loadGame()
  } catch (error) {
    enterRuntimeFault(formatRuntimeFault('game state loading failed', error))
    return
  }

  attemptRuntimeStartup()
}

onMounted(() => {
  exposeDebugVm()
  initializeAppRuntime()
})

/**
 * Phase 3.46：运行时卸载单次关闭事务。
 * runtimeShutdownStarted 在任何清理/保存前提交，重复调用 no-op；
 * shouldSave 在 stopRuntime() 之前按状态快照取得；只有原状态为 ready 才保存一次；
 * 保存返回 false / 抛异常统一进入 faulted（shutdown save failed），零重试、零 recordLogout。
 */
function shutdownAppRuntime() {
  if (runtimeShutdownStarted) return
  runtimeShutdownStarted = true

  const shouldSave = runtimeStartupStatus.value === 'ready'

  // Phase 3.48：先取 ready 快照，再执行清理；清理异常分类为 runtime cleanup failed，
  // 不阻止原 ready 状态保存一次（cleanup 错误优先成为第一条 App reason）。
  const cleanupError = stopRuntime()

  if (cleanupError !== null) {
    enterRuntimeFault(formatRuntimeFault('runtime cleanup failed', cleanupError))
  }

  if (!shouldSave) return

  try {
    const saved = playerStore.saveGame()

    if (!saved) {
      enterRuntimeFault('shutdown save failed')
    }
  } catch (error) {
    enterRuntimeFault(formatRuntimeFault('shutdown save failed', error))
  }
}

// Phase 3.48 Repair 1：用 onBeforeUnmount 让 App 关闭事务先于 useGameLoop 自身的
// onUnmounted teardown 执行，从而在真实 Vue 卸载时可捕获 RAF cleanup 错误。
onBeforeUnmount(() => {
  shutdownAppRuntime()
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
      @confirm-reset="confirmReset"
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
    <RebirthModal v-if="showRebirthModal || showRebirthShop" :show-rebirth-modal="showRebirthModal" :show-rebirth-shop="showRebirthShop" @close="closeRebirthModal" @perform-rebirth="performRebirth" @purchase-upgrade="purchaseRebirthUpgrade" @open-rebirth-shop="openRebirthShop" @open-rebirth-modal="openRebirthModal" />
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

    <!-- Phase 3.41：运行期故障熔断层——只允许重新加载应用，不提供继续/复活/启动重试。 -->
    <div v-if="runtimeStartupStatus === 'faulted'" class="runtime-gate-overlay">
      <div class="runtime-gate-panel ui-panel">
        <h2>游戏运行时发生错误</h2>
        <p>战斗循环、在线收益与自动保存已停止</p>
        <p class="runtime-gate-reason">错误原因：{{ runtimeStartupError }}</p>
        <button class="ui-btn" @click="reloadGame">重新加载游戏</button>
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
