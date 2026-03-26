<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { usePlayerStore } from './stores/playerStore'
import { useMonsterStore } from './stores/monsterStore'
import { useGameStore } from './stores/gameStore'
import { useAchievementStore } from './stores/achievementStore'
import { useSkillStore } from './stores/skillStore'
import { useTrainingStore } from './stores/trainingStore'
import { useRebirthStore } from './stores/rebirthStore'
import { formatNumber, formatTime } from './utils/format'
import { PHASE_NAMES, type EquipmentSlot } from './types'
import DamagePopup, { type DamagePopupData } from './components/DamagePopup.vue'
import SkillEffect from './components/SkillEffect.vue'
import EquipmentPopup from './components/EquipmentPopup.vue'
import ConfirmDialog from './components/ConfirmDialog.vue'
import BattleHUD from './components/BattleHUD.vue'
import TabNavigation, { type TabItem } from './components/TabNavigation.vue'
import BattleTab from './components/BattleTab.vue'
import RoleTab from './components/RoleTab.vue'
import SkillsTab from './components/SkillsTab.vue'
import ShopTab from './components/ShopTab.vue'
import SettingsTab from './components/SettingsTab.vue'
import ToastContainer from './components/ToastContainer.vue'
import EquipmentDetailModal from './components/EquipmentDetailModal.vue'

const playerStore = usePlayerStore()
const monsterStore = useMonsterStore()
const gameStore = useGameStore()
const achievementStore = useAchievementStore()
const skillStore = useSkillStore()
const trainingStore = useTrainingStore()
const rebirthStore = useRebirthStore()

// Toast提示
const toastContainer = ref()

function showToast(message: string, type?: 'success' | 'error' | 'info' | 'warning', duration?: number) {
  toastContainer.value?.showToast(message, type, duration)
}

// 装备详情模态框
const showEquipmentDetail = ref(false)
const selectedEquipment = ref<any>(null)

function showEquipmentDetailModal(equipment: any) {
  selectedEquipment.value = equipment
  showEquipmentDetail.value = true
}

function closeEquipmentDetailModal() {
  showEquipmentDetail.value = false
  selectedEquipment.value = null
}

// 调试模式相关
const isDebugMode = ref(false)
const debugLog = ref<any[]>([])
const debugStats = ref({
  totalDamage: 0,
  critCount: 0,
  killCount: 0,
  damageByType: {} as Record<string, number>,
  startTime: Date.now()
})

// 标签页配置
const tabs: TabItem[] = [
  { id: 'battle', name: '战斗', icon: '⚔️' },
  { id: 'role', name: '角色', icon: '👤' },
  { id: 'skills', name: '技能', icon: '✨' },
  { id: 'shop', name: '商店', icon: '🛒' },
  { id: 'settings', name: '更多', icon: '⚙️' }
]

const currentTab = ref('battle')
const battleMode = ref<'main' | 'training'>('main')

// 转生相关
const showRebirthModal = ref(false)
const showRebirthShop = ref(false)

// 装备确认
const showEquipConfirm = ref(false)
const equipConfirmSlot = ref<EquipmentSlot | null>(null)
const equipConfirmNewScore = ref(0)
const equipConfirmOldScore = ref(0)

// 重置确认
const showResetConfirm = ref(false)

// 快捷键提示
const showKeyboardShortcuts = ref(false)

// 伤害飘字
const damagePopups = ref<DamagePopupData[]>([])
let popupIdCounter = 0

// BOSS警告状态
const showBossWarning = ref(false)
const bossWarningTimer = ref<number | null>(null)

// 快捷键配置
interface KeyBinding {
  key: string
  action: string
  handler: () => void
  enabled: boolean
}

const keyBindings = ref<KeyBinding[]>([
  {
    key: 'Space',
    action: '暂停/继续战斗',
    handler: () => {
      if (gameStore.battleActive) {
        gameStore.isPaused ? gameStore.resumeBattle() : gameStore.pauseBattle()
      }
    },
    enabled: true
  },
  {
    key: 'KeyS',
    action: '打开技能面板',
    handler: () => {
      currentTab.value = 'skills'
    },
    enabled: true
  },
  {
    key: 'KeyE',
    action: '打开装备面板',
    handler: () => {
      currentTab.value = 'role'
    },
    enabled: true
  },
  {
    key: 'KeyR',
    action: '打开角色属性',
    handler: () => {
      currentTab.value = 'role'
    },
    enabled: true
  },
  {
    key: 'KeyB',
    action: '打开商店',
    handler: () => {
      currentTab.value = 'shop'
    },
    enabled: true
  },
  {
    key: 'Escape',
    action: '关闭当前面板',
    handler: () => {
      if (showRebirthModal.value || showRebirthShop.value) {
        closeRebirthModal()
      }
    },
    enabled: true
  }
])

// 处理键盘事件
function handleKeyDown(event: KeyboardEvent) {
  const target = event.target as HTMLElement
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
    return
  }

  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
  if (isMobile) {
    return
  }

  for (const binding of keyBindings.value) {
    if (binding.enabled && event.code === binding.key) {
      event.preventDefault()
      binding.handler()
      break
    }
  }
}

// 启用/禁用快捷键
function enableKeyBinding(key: string) {
  const binding = keyBindings.value.find(b => b.key === key)
  if (binding) {
    binding.enabled = true
  }
}

function disableKeyBinding(key: string) {
  const binding = keyBindings.value.find(b => b.key === key)
  if (binding) {
    binding.enabled = false
  }
}

const TICK_INTERVAL = 100
const TICK_RATE = TICK_INTERVAL / 1000
let battleIntervalId: number | null = null
let timeIntervalId: number | null = null
let onlineTimeCounter = 0
let autoSaveCounter = 0 // 每30秒自动保存

// 经验相关计算
const expNeeded = computed(() => playerStore.getExpNeeded())
const expPercent = computed(() => Math.min(100, (playerStore.player.experience / expNeeded.value) * 100))
const expPerSecond = computed(() => playerStore.getAverageExpPerSecond())
const secondsToLevelUp = computed(() => playerStore.getSecondsToLevelUp())

const currentDifficulty = computed(() => monsterStore.difficultyValue || 0)

function addDamagePopup(value: number, type: 'normal' | 'crit' | 'true' | 'void' | 'skill' | 'heal', offsetX = 0, offsetY = 0) {
  const popup: DamagePopupData = {
    id: popupIdCounter++,
    value,
    type,
    x: 150 + offsetX + Math.random() * 40 - 20,
    y: 200 + offsetY + Math.random() * 20 - 10
  }
  damagePopups.value.push(popup)
}

function removeDamagePopup(id: number) {
  damagePopups.value = damagePopups.value.filter(p => p.id !== id)
}

function showBossWarningAlert() {
  showBossWarning.value = true
  if (bossWarningTimer.value) {
    clearTimeout(bossWarningTimer.value)
  }
  bossWarningTimer.value = setTimeout(() => {
    showBossWarning.value = false
  }, 1500) as unknown as number
}

function handleEquipmentClick(equipment: any) {
  console.log('查看装备详情:', equipment)
  showEquipmentDetailModal(equipment)
}

function showEquipmentConfirm(slot: EquipmentSlot, newScore: number, oldScore: number) {
  equipConfirmSlot.value = slot
  equipConfirmNewScore.value = newScore
  equipConfirmOldScore.value = oldScore
  showEquipConfirm.value = true
}

function confirmEquip() {
  if (equipConfirmSlot.value) {
    playerStore.equipNewEquipment(playerStore.pendingEquipment!)
  }
  showEquipConfirm.value = false
  equipConfirmSlot.value = null
}

function cancelEquip() {
  showEquipConfirm.value = false
  equipConfirmSlot.value = null
  playerStore.pendingEquipment = null
}

function confirmReset() {
  playerStore.resetGame()
  showResetConfirm.value = false
}

function cancelReset() {
  showResetConfirm.value = false
}

function useSkill(slotIndex: number) {
  const skill = skillStore.getPlayerSkills()[slotIndex]
  if (!skill || skill.currentCooldown > 0) return
  if (!gameStore.canPlayerAct) return

  skillStore.useSkill(slotIndex)
  gameStore.processPlayerAttack(slotIndex)
}

function switchBattleMode(mode: 'main' | 'training') {
  battleMode.value = mode
  if (mode === 'main') {
    gameStore.resumeBattle()
  }
}

function switchToMainMode() {
  battleMode.value = 'main'
  gameStore.resumeBattle()
}

function switchToTrainingMode() {
  battleMode.value = 'training'
  if (!trainingStore.currentTrainingMonster) {
    trainingStore.spawnTrainingMonster()
  }
}

function goBackLevels() {
  if (playerStore.player.diamond >= 50) {
    playerStore.player.diamond -= 50
    monsterStore.goBackLevels(10)
    playerStore.revive()
  }
}

// 转生相关
function openRebirthModal() {
  showRebirthModal.value = true
  showRebirthShop.value = false
}

function openRebirthShop() {
  showRebirthShop.value = true
  showRebirthModal.value = false
}

function closeRebirthModal() {
  showRebirthModal.value = false
  showRebirthShop.value = false
}

function performRebirth() {
  const result = rebirthStore.performRebirth()
  closeRebirthModal()
  alert(`转生成功！获得 ${result.pointsEarned} 转生点数！`)
}

// 调试相关函数
function toggleDebugMode() {
  isDebugMode.value = !isDebugMode.value
  if (isDebugMode.value) {
    debugStats.value = {
      totalDamage: 0,
      critCount: 0,
      killCount: 0,
      damageByType: {},
      startTime: Date.now()
    }
    debugLog.value = []
  }
}

function exportDebugLog() {
  const logData = {
    exportTime: new Date().toISOString(),
    stats: debugStats.value,
    logs: debugLog.value,
    playerStats: playerStore.totalStats,
    combatDuration: Date.now() - debugStats.value.startTime
  }

  const blob = new Blob([JSON.stringify(logData, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `damage-log-${Date.now()}.json`
  a.click()
  URL.revokeObjectURL(url)

  alert('日志已导出!')
}

function resetDebugStats() {
  debugStats.value = {
    totalDamage: 0,
    critCount: 0,
    killCount: 0,
    damageByType: {},
    startTime: Date.now()
  }
  debugLog.value = []
}

// 记录伤害到调试日志
function logDamage(entry: any) {
  if (!isDebugMode.value) return

  debugStats.value.totalDamage += entry.damage
  if (entry.isCrit) debugStats.value.critCount++

  if (!debugStats.value.damageByType[entry.type]) {
    debugStats.value.damageByType[entry.type] = 0
  }
  debugStats.value.damageByType[entry.type] += entry.damage

  debugLog.value.push({
    ...entry,
    timestamp: Date.now()
  })

  // 最多保存1000条
  if (debugLog.value.length > 1000) {
    debugLog.value.shift()
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeyDown)
  // 暴露全局引用供测试脚本使用
  ;(window as any).gameVM = {
    playerStore,
    monsterStore,
    gameStore,
    achievementStore,
    skillStore,
    trainingStore,
    rebirthStore,
    showBossWarningAlert,
    showToast
  }

  try {
    playerStore.loadGame()

    if (playerStore.player.currentHp <= 0) {
      playerStore.player.currentHp = playerStore.player.maxHp
    }

    if (!monsterStore.currentMonster) {
      monsterStore.initMonster()
    }

    battleIntervalId = window.setInterval(() => {
      if (gameStore.isPaused) return

      if (battleMode.value === 'training') {
        if (!trainingStore.currentTrainingMonster) {
          trainingStore.spawnTrainingMonster()
        }

        if (trainingStore.currentTrainingMonster) {
          const result = trainingStore.damageTrainingMonster(playerStore.totalStats.attack)

          if (result.killed) {
            playerStore.addGold(result.goldReward)
            playerStore.addExperience(result.expReward)
            if (result.diamondReward > 0) {
              playerStore.addDiamond(result.diamondReward)
            }
            if (result.shouldDropEquipment) {
              const equipment = playerStore.generateRandomEquipment()
              if (equipment) {
                playerStore.equipNewEquipment(equipment)
              }
            }
            // 处理属性掉落
            if (result.statDrop) {
              playerStore.addStatReward(result.statDrop.type as any, result.statDrop.value)
            }
            // 如果不是自动升级，则手动生成新怪物
            if (!result.autoUpgraded) {
              trainingStore.spawnTrainingMonster()
            }
          }

          if (playerStore.isDead()) {
            playerStore.revive()
          }
        }
      } else {
        gameStore.gameLoop(TICK_RATE)
      }
    }, TICK_INTERVAL)

    timeIntervalId = window.setInterval(() => {
      if (!gameStore.isPaused) {
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
        // 每30秒自动保存一次
        if (autoSaveCounter >= 30) {
          playerStore.saveGame()
          autoSaveCounter = 0
        }
      }
    }, 1000)
  } catch (e) {
    console.error('Error in onMounted:', e)
  }
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyDown)
  if (battleIntervalId) clearInterval(battleIntervalId)
  if (timeIntervalId) clearInterval(timeIntervalId)
  playerStore.saveGame()
})
</script>

<template>
  <div class="game-container" @keydown="handleKeyDown" tabindex="0">
    <DamagePopup
      v-for="popup in damagePopups"
      :key="popup.id"
      :popup="popup"
      @remove="removeDamagePopup"
    />
    
    <SkillEffect
      v-for="effect in gameStore.skillEffects"
      :key="effect.id"
      :type="effect.type"
      :x="effect.x"
      :y="effect.y"
      @complete="gameStore.removeSkillEffect(effect.id)"
    />

    <EquipmentPopup
      v-for="drop in gameStore.equipmentDrops"
      :key="drop.id"
      :equipment="drop.equipment"
      :position="drop.position"
      @remove="gameStore.removeEquipmentDrop(drop.id)"
      @click="handleEquipmentClick"
    />

    <!-- BOSS警告 -->
    <div v-if="showBossWarning" class="boss-warning active">
      <div class="screen-flash active"></div>
      <div class="boss-warning-text">⚠️ BOSS来袭！ ⚠️</div>
    </div>

    <ConfirmDialog
      v-if="showEquipConfirm"
      title="替换装备"
      :message="`新装备战力: ${formatNumber(equipConfirmNewScore)}\n当前装备战力: ${formatNumber(equipConfirmOldScore)}\n是否确认替换？`"
      confirm-text="确认替换"
      @confirm="confirmEquip"
      @cancel="cancelEquip"
    />

    <ConfirmDialog
      v-if="showResetConfirm"
      title="重置游戏"
      message="确定要重置游戏吗？所有进度将丢失！"
      type="danger"
      confirm-text="确认重置"
      @confirm="confirmReset"
      @cancel="cancelReset"
    />

    <!-- 顶部状态栏 -->
    <header class="game-header">
      <div class="header-top">
        <div class="header-left">
          <h1>棒棒糖大冒险</h1>
        </div>
        <div class="header-stats">
          <div class="stat-item difficulty">
            <span class="stat-icon">🎯</span>
            <span class="stat-label">难度</span>
            <span class="stat-value">{{ formatNumber(currentDifficulty) }}</span>
          </div>
          <div class="stat-item health">
            <span class="stat-icon">❤️</span>
            <span class="stat-label">生命</span>
            <span class="stat-value">{{ formatNumber(playerStore.player.currentHp) }}/{{ formatNumber(playerStore.totalStats.maxHp) }}</span>
          </div>
          <div class="stat-item gold">
            <span class="stat-icon">💰</span>
            <span class="stat-label">金币</span>
            <span class="stat-value">{{ formatNumber(playerStore.player.gold) }}</span>
          </div>
          <div class="stat-item diamond">
            <span class="stat-icon">💎</span>
            <span class="stat-label">钻石</span>
            <span class="stat-value">{{ formatNumber(playerStore.player.diamond) }}</span>
          </div>
          <div class="stat-item rebirth" @click="openRebirthShop" title="点击进入转生商店">
            <span class="stat-icon">⭐</span>
            <span class="stat-label">转生</span>
            <span class="stat-value">{{ formatNumber(rebirthStore.rebirthPoints) }}</span>
          </div>
        </div>
        <div class="header-actions">
          <button class="rebirth-btn" @click="openRebirthModal">
            转生
          </button>
        </div>
      </div>

      <div class="header-exp-section">
        <div class="header-level">
          <span class="level-badge">Lv.{{ playerStore.player.level }}</span>
          <span class="exp-info">
            {{ formatNumber(playerStore.player.experience) }} / {{ formatNumber(expNeeded) }}
            <span class="exp-rate">({{ formatNumber(expPerSecond) }}/秒)</span>
          </span>
          <span class="level-time" v-if="secondsToLevelUp < Infinity">
            升级还需: {{ formatTime(secondsToLevelUp) }}
          </span>
        </div>
        <div class="header-exp-bar">
          <div class="header-exp-fill" :style="{ width: expPercent + '%' }"></div>
        </div>
        <div class="header-exp-time">
          <span class="phase-info">阶段 {{ monsterStore.currentPhase }} - {{ PHASE_NAMES[monsterStore.currentPhase] }}</span>
        </div>
      </div>
    </header>

    <!-- 核心战斗HUD - 始终可见 -->
    <BattleHUD
      :battle-mode="battleMode"
      @switch-mode="switchBattleMode"
    />

    <!-- 标签页导航 -->
    <TabNavigation
      :tabs="tabs"
      v-model:activeTab="currentTab"
    />

    <!-- 标签页内容 -->
    <main class="main-content">
      <BattleTab
        v-if="currentTab === 'battle'"
        :battle-mode="battleMode"
        @use-skill="useSkill"
      />
      <RoleTab v-else-if="currentTab === 'role'" />
      <SkillsTab v-else-if="currentTab === 'skills'" />
      <ShopTab
        v-else-if="currentTab === 'shop'"
        @go-back-levels="goBackLevels"
      />
      <SettingsTab
        v-else-if="currentTab === 'settings'"
        @confirm-reset="showResetConfirm = true"
        @toggle-debug-mode="toggleDebugMode"
        @export-debug-log="exportDebugLog"
        @reset-debug-stats="resetDebugStats"
      />

      <!-- 调试面板 -->
      <div v-if="isDebugMode" class="debug-panel-overlay">
        <div class="debug-panel">
          <div class="debug-panel-header">
            <span class="debug-panel-title">🔧 数值调试面板</span>
            <button class="debug-close-btn" @click="toggleDebugMode">×</button>
          </div>
          <div class="debug-panel-content">
            <div class="debug-section">
              <h4>📊 DPS统计</h4>
              <div class="debug-stats-grid">
                <div class="debug-stat">
                  <span class="debug-stat-label">总伤害</span>
                  <span class="debug-stat-value">{{ formatNumber(debugStats.totalDamage) }}</span>
                </div>
                <div class="debug-stat">
                  <span class="debug-stat-label">暴击次数</span>
                  <span class="debug-stat-value">{{ debugStats.critCount }}</span>
                </div>
                <div class="debug-stat">
                  <span class="debug-stat-label">战斗时长</span>
                  <span class="debug-stat-value">{{ Math.floor((Date.now() - debugStats.startTime) / 1000) }}s</span>
                </div>
                <div class="debug-stat">
                  <span class="debug-stat-label">实时DPS</span>
                  <span class="debug-stat-value">{{ formatNumber(debugStats.totalDamage / Math.max(1, (Date.now() - debugStats.startTime) / 1000)) }}</span>
                </div>
              </div>
            </div>
            <div class="debug-section">
              <h4>📈 伤害构成</h4>
              <div class="damage-breakdown-list">
                <div v-for="(value, type) in debugStats.damageByType" :key="type" class="breakdown-item">
                  <span class="breakdown-type">{{ type }}</span>
                  <div class="breakdown-bar-container">
                    <div
                      class="breakdown-bar"
                      :style="{ width: (value / debugStats.totalDamage * 100) + '%' }"
                    ></div>
                  </div>
                  <span class="breakdown-value">{{ formatNumber(value) }} ({{ (value / debugStats.totalDamage * 100).toFixed(1) }}%)</span>
                </div>
              </div>
            </div>
            <div class="debug-section">
              <h4>👤 角色属性</h4>
              <div class="player-stats-debug">
                <div>攻击: {{ formatNumber(playerStore.totalStats.attack) }}</div>
                <div>防御: {{ formatNumber(playerStore.totalStats.defense) }}</div>
                <div>暴击率: {{ playerStore.totalStats.critRate.toFixed(1) }}%</div>
                <div>暴击伤害: {{ playerStore.totalStats.critDamage.toFixed(1) }}%</div>
                <div>伤害加成: {{ (playerStore.totalStats.damageBonusI + playerStore.totalStats.damageBonusII + playerStore.totalStats.damageBonusIII).toFixed(1) }}%</div>
              </div>
            </div>
            <div class="debug-section">
              <h4>📋 最近日志</h4>
              <div class="debug-log-list">
                <div v-for="(log, idx) in debugLog.slice(-5).reverse()" :key="idx" class="log-entry">
                  <span class="log-type">{{ log.type }}</span>
                  <span class="log-damage">{{ formatNumber(log.damage) }}</span>
                  <span class="log-crit">{{ log.isCrit ? '💥' : '' }}</span>
                </div>
                <div v-if="debugLog.length === 0" class="log-empty">暂无日志</div>
              </div>
            </div>
          </div>
          <div class="debug-panel-actions">
            <button @click="exportDebugLog" class="debug-action-btn">📤 导出</button>
            <button @click="resetDebugStats" class="debug-action-btn">🔄 重置</button>
          </div>
        </div>
      </div>
    </main>

    <!-- 暂停覆盖层 -->
    <div v-if="gameStore.isPaused" class="paused-overlay">
      <div class="paused-content">
        <h2>游戏暂停</h2>
        <button @click="gameStore.togglePause()">继续</button>
      </div>
    </div>

    <!-- 转生模态框 -->
    <div v-if="showRebirthModal || showRebirthShop" class="modal-overlay" @click.self="closeRebirthModal">
      <div class="rebirth-modal">
        <div class="modal-header">
          <h2 v-if="showRebirthModal">转生</h2>
          <h2 v-else>转生商店</h2>
          <button class="close-btn" @click="closeRebirthModal">&times;</button>
        </div>

        <div v-if="showRebirthModal" class="rebirth-content">
          <!-- 转生收益预览 -->
          <div class="rebirth-preview">
            <h3>📊 转生收益预览</h3>
            <div class="preview-card">
              <div class="preview-icon">⭐</div>
              <div class="preview-details">
                <div class="preview-stat">
                  <span class="stat-label">可获得转生点数</span>
                  <span class="stat-value highlight">+{{ rebirthStore.calculateRebirthPoints(monsterStore.difficultyValue) }}</span>
                </div>
                <div class="preview-stat">
                  <span class="stat-label">预计累计点数</span>
                  <span class="stat-value">{{ rebirthStore.rebirthPoints + rebirthStore.calculateRebirthPoints(monsterStore.difficultyValue) }}</span>
                </div>
              </div>
            </div>
            
            <!-- 难度进度条 -->
            <div class="progress-section">
              <div class="progress-label">
                <span>当前难度</span>
                <span>{{ monsterStore.difficultyValue }}</span>
              </div>
              <div class="progress-bar">
                <div class="progress-fill" :style="{ width: Math.min(monsterStore.difficultyValue / 100 * 100, 100) + '%' }"></div>
              </div>
              <div class="progress-milestones">
                <span>0</span>
                <span>25</span>
                <span>50</span>
                <span>75</span>
                <span>100</span>
              </div>
            </div>
          </div>
          
          <!-- 转生统计 -->
          <div class="rebirth-stats">
            <div class="stat-item">
              <span class="stat-label">已拥有转生点数</span>
              <span class="stat-value highlight">{{ rebirthStore.rebirthPoints }}</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">累计转生次数</span>
              <span class="stat-value">{{ rebirthStore.totalRebirthCount }}</span>
            </div>
          </div>

          <div class="rebirth-warning">
            <h4>⚠️ 转生将重置以下内容：</h4>
            <ul>
              <li>💰 所有金币和钻石</li>
              <li>🎒 所有装备和物品</li>
              <li>📊 所有角色属性和技能</li>
              <li>🗺️ 当前推图进度</li>
            </ul>
            <h4>✅ 转生将保留：</h4>
            <ul>
              <li>⏱️ 累计在线/离线时间</li>
              <li>⭐ 转生点数和永久加成</li>
              <li>📈 击杀数等统计数据</li>
            </ul>
          </div>

          <div class="rebirth-actions">
            <button
              class="rebirth-confirm-btn"
              @click="performRebirth"
              :disabled="monsterStore.difficultyValue < 10"
            >
              ⭐ 确认转生
            </button>
            <button class="shop-btn" @click="openRebirthShop">
              🏪 进入转生商店
            </button>
          </div>
          
          <div class="rebirth-help">
            <button class="help-btn">❓ 什么是转生？</button>
          </div>
        </div>

        <div v-else class="shop-content">
          <div class="shop-currency">
            <span class="highlight">转生点数: {{ rebirthStore.rebirthPoints }}</span>
          </div>

          <div class="upgrade-section" v-for="category in ['tech', 'skill', 'rarity', 'permanent']" :key="category">
            <h3>{{ category === 'tech' ? '科技类' : category === 'skill' ? '技能类' : category === 'rarity' ? '稀有乘区' : '永久属性' }}</h3>
            <div class="upgrade-list">
              <div
                v-for="upgrade in rebirthStore.getUpgradesByCategory(category as any)"
                :key="upgrade.id"
                class="upgrade-item"
              >
                <div class="upgrade-icon">{{ upgrade.icon }}</div>
                <div class="upgrade-info">
                  <div class="upgrade-name">{{ upgrade.name }}</div>
                  <div class="upgrade-desc">{{ upgrade.description }}</div>
                  <div class="upgrade-level">
                    等级: {{ rebirthStore.getUpgradeLevel(upgrade.id) }} / {{ upgrade.maxLevel }}
                  </div>
                </div>
                <div class="upgrade-effect">
                  +{{ (upgrade.effectPerLevel * rebirthStore.getUpgradeLevel(upgrade.id)).toFixed(1) }}
                </div>
                <button
                  class="buy-btn"
                  :disabled="!rebirthStore.canAffordUpgrade(upgrade.id)"
                  @click="rebirthStore.purchaseUpgrade(upgrade.id)"
                >
                  {{ rebirthStore.getUpgradeCost(upgrade.id) }}点
                </button>
              </div>
            </div>
          </div>

          <div class="back-btn-container">
            <button class="back-btn" @click="openRebirthModal">返回转生</button>
          </div>
        </div>
      </div>
    </div>

    <!-- 快捷键提示 -->
    <div v-if="showKeyboardShortcuts" class="keyboard-shortcuts-overlay" @click="showKeyboardShortcuts = false">
      <div class="keyboard-shortcuts-panel" @click.stop>
        <h2>⌨️ 键盘快捷键</h2>
        <div class="shortcuts-list">
          <div v-for="binding in keyBindings" :key="binding.key" class="shortcut-item">
            <div class="shortcut-keys">
              <kbd v-if="binding.key === 'Space'">空格</kbd>
              <kbd v-else-if="binding.key === 'Escape'">Esc</kbd>
              <kbd v-else>{{ binding.key.replace('Key', '') }}</kbd>
            </div>
            <span class="shortcut-action">{{ binding.action }}</span>
            <span class="shortcut-status" :class="{ disabled: !binding.enabled }">
              {{ binding.enabled ? '✓' : '✗' }}
            </span>
          </div>
        </div>
        <div class="shortcuts-tip">提示：快捷键在移动端不生效</div>
        <button class="close-shortcuts" @click="showKeyboardShortcuts = false">关闭</button>
      </div>
    </div>

    <!-- 快捷键提示按钮 -->
    <button class="shortcuts-hint-btn" @click="showKeyboardShortcuts = true" title="查看快捷键">
      ⌨️
    </button>

    <!-- Toast提示组件 -->
    <ToastContainer ref="toastContainer" />
    
    <!-- 装备详情模态框 -->
    <EquipmentDetailModal
      v-if="selectedEquipment"
      :equipment="selectedEquipment"
      :visible="showEquipmentDetail"
      @close="closeEquipmentDetailModal"
    />
  </div>
</template>

<style scoped>
@import './styles/design-system.css';

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

.game-container {
  font-family: var(--font-family);
  background: var(--color-bg-dark);
  color: var(--color-text-primary);
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.game-container:focus {
  outline: none;
}

.game-header {
  background: var(--color-bg-panel);
  padding: 0.5rem 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  border-bottom: 1px solid var(--color-bg-card);
}

.header-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.game-header h1 {
  color: var(--color-primary);
  font-size: 1.2rem;
}

.header-left {
  flex-shrink: 0;
}

.header-stats {
  display: flex;
  gap: 0.6rem;
  align-items: center;
  flex-wrap: wrap;
  flex: 1;
  justify-content: center;
}

.stat-item {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.3rem 0.6rem;
  background: var(--color-bg-dark);
  border-radius: var(--border-radius-sm);
  font-size: var(--font-size-xs);
  transition: transform var(--transition-fast);
}

.stat-item:hover {
  transform: translateY(-1px);
}

.stat-icon {
  font-size: 1rem;
}

.stat-label {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.stat-value {
  font-weight: bold;
  font-size: var(--font-size-sm);
}

.stat-item.difficulty .stat-value {
  color: var(--color-primary);
}

.stat-item.health .stat-value {
  color: #ff6b6b;
}

.stat-item.gold .stat-value {
  color: var(--color-gold);
}

.stat-item.diamond .stat-value {
  color: var(--color-diamond);
}

.stat-item.rebirth {
  cursor: pointer;
}

.stat-item.rebirth .stat-value {
  color: var(--color-accent);
}

.stat-item.rebirth:hover {
  background: var(--color-bg-card);
}

.header-actions {
  flex-shrink: 0;
}

.header-info {
  display: flex;
  gap: 0.8rem;
  align-items: center;
  font-size: var(--font-size-sm);
  flex-wrap: wrap;
}

.header-info .gold {
  color: var(--color-gold);
}

.header-info .diamond {
  color: var(--color-diamond);
}

.rebirth-points {
  cursor: pointer;
  color: var(--color-gold);
}

.rebirth-points:hover {
  text-decoration: underline;
}

.rebirth-btn {
  background: linear-gradient(135deg, var(--color-accent), var(--color-accent-light));
  color: white;
  border: none;
  padding: 0.25rem 0.6rem;
  cursor: pointer;
  border-radius: var(--border-radius-sm);
  font-size: var(--font-size-sm);
  transition: opacity var(--transition-fast);
}

.rebirth-btn:hover {
  opacity: 0.9;
}

.header-exp-section {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  max-width: 600px;
  margin: 0 auto;
  width: 100%;
}

.header-level {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: var(--font-size-sm);
  flex-wrap: wrap;
  gap: 0.3rem;
}

.level-badge {
  background: var(--color-primary);
  color: white;
  padding: 0.1rem 0.4rem;
  border-radius: var(--border-radius-sm);
  font-weight: bold;
}

.exp-info {
  color: var(--color-accent);
  font-size: var(--font-size-xs);
}

.exp-rate {
  color: var(--color-accent-light);
}

.level-time {
  color: var(--color-secondary);
  font-size: var(--font-size-xs);
}

.header-exp-bar {
  height: 12px;
  background: var(--color-bg-dark);
  border-radius: var(--border-radius-md);
  overflow: hidden;
}

.header-exp-fill {
  height: 100%;
  background: var(--gradient-exp);
  transition: width 0.3s;
}

.header-exp-time {
  display: flex;
  justify-content: space-between;
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}

.phase-info {
  color: var(--color-primary);
}

.main-content {
  flex: 1;
  padding: 0.8rem;
  overflow-y: auto;
}

.paused-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.8);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
}

.paused-content {
  background: var(--color-bg-panel);
  padding: 2rem;
  border-radius: var(--border-radius-lg);
  text-align: center;
}

.paused-content h2 {
  color: var(--color-primary);
  margin-bottom: 1rem;
}

.paused-content button {
  background: var(--color-primary);
  color: white;
  border: none;
  padding: 0.5rem 2rem;
  cursor: pointer;
  border-radius: var(--border-radius-sm);
  font-size: var(--font-size-md);
  margin-top: 1rem;
}

.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.8);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
}

.rebirth-modal {
  background: var(--color-bg-panel);
  border-radius: var(--border-radius-lg);
  padding: 1.5rem;
  max-width: 600px;
  width: 90%;
  max-height: 80vh;
  overflow-y: auto;
  border: 2px solid var(--color-accent);
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid var(--color-bg-card);
}

.modal-header h2 {
  color: var(--color-accent);
}

.close-btn {
  background: none;
  border: none;
  color: var(--color-text-muted);
  font-size: 1.5rem;
  cursor: pointer;
}

.close-btn:hover {
  color: var(--color-primary);
}

.rebirth-info {
  background: var(--color-bg-dark);
  padding: 1rem;
  border-radius: var(--border-radius-md);
  margin-bottom: 1rem;
}

.rebirth-info p {
  margin: 0.5rem 0;
}

.rebirth-info .highlight {
  color: var(--color-gold);
  font-size: 1.2rem;
}

.rebirth-warning {
  background: var(--color-bg-dark);
  padding: 1rem;
  border-radius: var(--border-radius-md);
  margin-bottom: 1rem;
}

.rebirth-warning p {
  margin: 0.5rem 0;
}

.rebirth-warning ul {
  margin-left: 1.5rem;
  color: var(--color-text-muted);
}

.rebirth-warning li {
  margin: 0.2rem 0;
}

.rebirth-actions {
  display: flex;
  gap: 0.5rem;
}

.rebirth-confirm-btn {
  flex: 1;
  background: linear-gradient(135deg, var(--color-accent), var(--color-accent-light));
  color: white;
  border: none;
  padding: 0.8rem;
  border-radius: var(--border-radius-md);
  cursor: pointer;
  font-size: var(--font-size-md);
}

.rebirth-confirm-btn:disabled {
  background: var(--color-text-disabled);
  cursor: not-allowed;
}

.shop-btn {
  background: var(--color-secondary);
  color: var(--color-bg-dark);
  border: none;
  padding: 0.8rem 1.5rem;
  border-radius: var(--border-radius-md);
  cursor: pointer;
}

.shop-content {
  max-height: 60vh;
  overflow-y: auto;
}

.shop-currency {
  text-align: center;
  font-size: var(--font-size-lg);
  margin-bottom: 1rem;
}

.shop-currency .highlight {
  color: var(--color-gold);
}

.upgrade-section {
  margin-bottom: 1rem;
}

.upgrade-section h3 {
  color: var(--color-secondary);
  margin-bottom: 0.5rem;
  font-size: var(--font-size-md);
}

.upgrade-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.upgrade-item {
  display: flex;
  align-items: center;
  background: var(--color-bg-dark);
  padding: 0.8rem;
  border-radius: var(--border-radius-sm);
  gap: 0.5rem;
}

.upgrade-icon {
  font-size: 1.5rem;
  width: 40px;
  text-align: center;
}

.upgrade-info {
  flex: 1;
}

.upgrade-name {
  font-weight: bold;
  color: var(--color-text-primary);
}

.upgrade-desc {
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}

.upgrade-level {
  font-size: var(--font-size-xs);
  color: var(--color-secondary);
}

.upgrade-effect {
  color: var(--color-secondary);
  font-weight: bold;
  min-width: 60px;
  text-align: right;
}

.buy-btn {
  background: var(--color-accent);
  color: white;
  border: none;
  padding: 0.4rem 0.8rem;
  border-radius: var(--border-radius-sm);
  cursor: pointer;
  min-width: 60px;
}

.buy-btn:disabled {
  background: var(--color-text-disabled);
  cursor: not-allowed;
}

.back-btn-container {
  margin-top: 1rem;
  text-align: center;
}

.back-btn {
  background: var(--color-bg-card);
  color: var(--color-text-primary);
  border: none;
  padding: 0.6rem 2rem;
  border-radius: var(--border-radius-md);
  cursor: pointer;
}

.back-btn:hover {
  background: var(--color-bg-dark);
}

/* 调试面板样式 */
.debug-panel-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 2000;
}

.debug-panel {
  background: var(--color-bg-panel);
  border: 2px solid var(--color-accent);
  border-radius: var(--border-radius-lg);
  width: 90%;
  max-width: 500px;
  max-height: 80vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.debug-panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.8rem 1rem;
  background: var(--color-bg-card);
  border-bottom: 1px solid var(--color-accent);
}

.debug-panel-title {
  font-size: var(--font-size-md);
  font-weight: bold;
  color: var(--color-accent);
}

.debug-close-btn {
  background: none;
  border: none;
  color: var(--color-text-muted);
  font-size: 1.5rem;
  cursor: pointer;
  padding: 0;
  line-height: 1;
}

.debug-close-btn:hover {
  color: var(--color-primary);
}

.debug-panel-content {
  flex: 1;
  overflow-y: auto;
  padding: 0.8rem;
}

.debug-panel .debug-section {
  background: var(--color-bg-dark);
  padding: 0.8rem;
  border-radius: var(--border-radius-sm);
  margin-bottom: 0.8rem;
}

.debug-panel .debug-section h4 {
  font-size: var(--font-size-sm);
  color: var(--color-secondary);
  margin-bottom: 0.5rem;
}

.debug-stats-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.5rem;
}

.debug-stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  background: var(--color-bg-card);
  padding: 0.4rem;
  border-radius: var(--border-radius-sm);
}

.debug-stat-label {
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}

.debug-stat-value {
  font-size: var(--font-size-md);
  color: var(--color-secondary);
  font-weight: bold;
}

.damage-breakdown-list {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.breakdown-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: var(--font-size-xs);
}

.breakdown-type {
  min-width: 50px;
  color: var(--color-text-secondary);
}

.breakdown-bar-container {
  flex: 1;
  height: 8px;
  background: var(--color-bg-card);
  border-radius: 4px;
  overflow: hidden;
}

.breakdown-bar {
  height: 100%;
  background: var(--color-secondary);
  transition: width 0.3s;
}

.breakdown-value {
  min-width: 80px;
  text-align: right;
  color: var(--color-secondary);
}

.player-stats-debug {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.3rem;
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
}

.debug-log-list {
  max-height: 120px;
  overflow-y: auto;
}

.log-entry {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.2rem 0;
  border-bottom: 1px solid var(--color-bg-card);
  font-size: var(--font-size-xs);
}

.log-type {
  min-width: 50px;
  color: var(--color-text-muted);
}

.log-damage {
  flex: 1;
  color: var(--color-secondary);
}

.log-crit {
  color: var(--color-primary);
}

.log-empty {
  color: var(--color-text-disabled);
  font-size: var(--font-size-xs);
  text-align: center;
  padding: 0.5rem;
}

.debug-panel-actions {
  display: flex;
  gap: 0.5rem;
  padding: 0.8rem;
  background: var(--color-bg-card);
  border-top: 1px solid var(--color-bg-dark);
}

.debug-action-btn {
  flex: 1;
  padding: 0.5rem;
  border: none;
  border-radius: var(--border-radius-sm);
  cursor: pointer;
  font-size: var(--font-size-sm);
  font-weight: bold;
  background: var(--color-accent);
  color: white;
}

.debug-action-btn:hover {
  opacity: 0.9;
}

/* BOSS警告样式 */
.boss-warning {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  pointer-events: none;
  z-index: 9999;
  display: flex;
  justify-content: center;
  align-items: center;
}

.boss-warning.active {
  animation: boss-warning-pulse 0.5s ease-in-out infinite;
}

.screen-flash {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(255, 0, 0, 0);
}

.screen-flash.active {
  animation: screen-flash 0.3s ease-in-out infinite;
}

.boss-warning-text {
  font-size: 3rem;
  font-weight: bold;
  color: #ff4444;
  text-shadow: 0 0 20px #ff0000, 0 0 40px #ff0000, 0 0 60px #ff0000;
  animation: text-glow 0.3s ease-in-out infinite alternate;
}

@keyframes boss-warning-pulse {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.8;
  }
}

@keyframes screen-flash {
  0%, 100% {
    background: rgba(255, 0, 0, 0.1);
  }
  50% {
    background: rgba(255, 0, 0, 0.3);
  }
}

@keyframes text-glow {
  from {
    text-shadow: 0 0 20px #ff0000, 0 0 40px #ff0000, 0 0 60px #ff0000;
    transform: scale(1);
  }
  to {
    text-shadow: 0 0 30px #ff0000, 0 0 60px #ff0000, 0 0 90px #ff0000;
    transform: scale(1.05);
  }
}

/* 快捷键提示按钮 */
.shortcuts-hint-btn {
  position: fixed;
  bottom: 20px;
  right: 20px;
  width: 50px;
  height: 50px;
  border-radius: 50%;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border: none;
  font-size: 1.5rem;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
  transition: all 0.3s ease;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
}

.shortcuts-hint-btn:hover {
  transform: scale(1.1);
  box-shadow: 0 6px 16px rgba(102, 126, 234, 0.5);
}

.shortcuts-hint-btn:active {
  transform: scale(0.95);
}

/* 快捷键提示遮罩 */
.keyboard-shortcuts-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
  animation: fadeIn 0.2s ease-out;
}

.keyboard-shortcuts-panel {
  background: linear-gradient(145deg, #1e1e2f 0%, #151520 100%);
  border: 2px solid rgba(102, 126, 234, 0.3);
  border-radius: 16px;
  padding: 2rem;
  max-width: 500px;
  width: 90%;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  animation: slideUp 0.3s ease-out;
}

.keyboard-shortcuts-panel h2 {
  text-align: center;
  color: white;
  margin-bottom: 1.5rem;
  font-size: 1.5rem;
}

.shortcuts-list {
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
  margin-bottom: 1.5rem;
}

.shortcut-item {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.8rem;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 8px;
  transition: background 0.2s;
}

.shortcut-item:hover {
  background: rgba(255, 255, 255, 0.1);
}

.shortcut-keys {
  flex: 0 0 80px;
}

.shortcut-keys kbd {
  display: inline-block;
  padding: 0.4rem 0.8rem;
  background: linear-gradient(180deg, #667eea 0%, #764ba2 100%);
  color: white;
  border-radius: 6px;
  font-family: 'Courier New', monospace;
  font-size: 0.85rem;
  font-weight: bold;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
}

.shortcut-action {
  flex: 1;
  color: rgba(255, 255, 255, 0.9);
  font-size: 0.95rem;
}

.shortcut-status {
  flex: 0 0 30px;
  text-align: center;
  font-size: 1.2rem;
}

.shortcut-status.enabled {
  color: #44ff44;
}

.shortcut-status.disabled {
  color: #ff4444;
}

.shortcuts-tip {
  text-align: center;
  color: rgba(255, 255, 255, 0.5);
  font-size: 0.85rem;
  margin-bottom: 1rem;
  padding: 0.5rem;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 6px;
}

.close-shortcuts {
  width: 100%;
  padding: 0.8rem;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 1rem;
  font-weight: bold;
  cursor: pointer;
  transition: all 0.2s;
}

.close-shortcuts:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
}

.close-shortcuts:active {
  transform: translateY(0);
}

/* 动画 */
@keyframes fadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

/* 转生预览 */
.rebirth-preview {
  margin-bottom: 1.5rem;
}

.rebirth-preview h3 {
  font-size: 1.1rem;
  color: #ffd700;
  margin-bottom: 1rem;
  text-align: center;
}

.preview-card {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1.2rem;
  background: linear-gradient(145deg, rgba(102, 126, 234, 0.2), rgba(118, 75, 162, 0.2));
  border: 2px solid rgba(255, 215, 0, 0.3);
  border-radius: 12px;
  margin-bottom: 1rem;
}

.preview-icon {
  font-size: 3rem;
  filter: drop-shadow(0 0 10px rgba(255, 215, 0, 0.5));
}

.preview-details {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.preview-stat {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.5rem;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 6px;
}

.preview-stat .stat-label {
  font-size: 0.9rem;
  color: rgba(255, 255, 255, 0.8);
}

.preview-stat .stat-value {
  font-size: 1.1rem;
  font-weight: bold;
}

.preview-stat .stat-value.highlight {
  color: #ffd700;
}

/* 进度条 */
.progress-section {
  margin-top: 1rem;
}

.progress-label {
  display: flex;
  justify-content: space-between;
  font-size: 0.85rem;
  color: rgba(255, 255, 255, 0.7);
  margin-bottom: 0.5rem;
}

.progress-bar {
  height: 12px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #667eea 0%, #764ba2 50%, #ffd700 100%);
  border-radius: 6px;
  transition: width 0.3s ease;
  box-shadow: 0 0 10px rgba(255, 215, 0, 0.3);
}

.progress-milestones {
  display: flex;
  justify-content: space-between;
  font-size: 0.7rem;
  color: rgba(255, 255, 255, 0.4);
  margin-top: 0.3rem;
}

/* 转生统计 */
.rebirth-stats {
  display: flex;
  gap: 1rem;
  margin-bottom: 1.5rem;
}

.rebirth-stats .stat-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.3rem;
  padding: 0.8rem;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 8px;
}

.rebirth-stats .stat-label {
  font-size: 0.8rem;
  color: rgba(255, 255, 255, 0.6);
}

.rebirth-stats .stat-value {
  font-size: 1.2rem;
  font-weight: bold;
  color: white;
}

/* 转生警告 */
.rebirth-warning {
  padding: 1rem;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 8px;
  margin-bottom: 1.5rem;
}

.rebirth-warning h4 {
  font-size: 0.95rem;
  margin-bottom: 0.8rem;
  color: white;
}

.rebirth-warning ul {
  list-style: none;
  padding: 0;
  margin-bottom: 1rem;
}

.rebirth-warning li {
  padding: 0.4rem 0;
  font-size: 0.9rem;
  color: rgba(255, 255, 255, 0.8);
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.rebirth-warning li:last-child {
  border-bottom: none;
}

/* 转生按钮 */
.rebirth-actions {
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
  margin-bottom: 1rem;
}

.rebirth-confirm-btn {
  width: 100%;
  padding: 1rem;
  background: linear-gradient(135deg, #ffd700 0%, #ff8c00 100%);
  color: white;
  border: none;
  border-radius: 10px;
  font-size: 1.1rem;
  font-weight: bold;
  cursor: pointer;
  transition: all 0.3s ease;
  box-shadow: 0 4px 12px rgba(255, 215, 0, 0.3);
}

.rebirth-confirm-btn:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 6px 16px rgba(255, 215, 0, 0.4);
}

.rebirth-confirm-btn:active:not(:disabled) {
  transform: translateY(0);
}

.rebirth-confirm-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.shop-btn {
  width: 100%;
  padding: 0.8rem;
  background: rgba(255, 255, 255, 0.1);
  color: white;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 8px;
  font-size: 0.95rem;
  cursor: pointer;
  transition: all 0.2s;
}

.shop-btn:hover {
  background: rgba(255, 255, 255, 0.2);
  border-color: rgba(255, 255, 255, 0.3);
}

/* 帮助按钮 */
.rebirth-help {
  text-align: center;
  margin-top: 1rem;
}

.help-btn {
  background: none;
  border: none;
  color: rgba(255, 255, 255, 0.5);
  font-size: 0.85rem;
  cursor: pointer;
  transition: color 0.2s;
}

.help-btn:hover {
  color: rgba(255, 255, 255, 0.8);
}

@keyframes slideUp {
  from {
    opacity: 0;
    transform: translateY(50px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
