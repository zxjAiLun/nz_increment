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
import ConfirmDialog from './components/ConfirmDialog.vue'
import BattleHUD from './components/BattleHUD.vue'
import TabNavigation, { type TabItem } from './components/TabNavigation.vue'
import BattleTab from './components/BattleTab.vue'
import RoleTab from './components/RoleTab.vue'
import SkillsTab from './components/SkillsTab.vue'
import ShopTab from './components/ShopTab.vue'
import SettingsTab from './components/SettingsTab.vue'

const playerStore = usePlayerStore()
const monsterStore = useMonsterStore()
const gameStore = useGameStore()
const achievementStore = useAchievementStore()
const skillStore = useSkillStore()
const trainingStore = useTrainingStore()
const rebirthStore = useRebirthStore()

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

// 伤害飘字
const damagePopups = ref<DamagePopupData[]>([])
let popupIdCounter = 0

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
  // 暴露全局引用供测试脚本使用
  ;(window as any).gameVM = {
    playerStore,
    monsterStore,
    gameStore,
    achievementStore,
    skillStore,
    trainingStore,
    rebirthStore
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
  if (battleIntervalId) clearInterval(battleIntervalId)
  if (timeIntervalId) clearInterval(timeIntervalId)
  playerStore.saveGame()
})
</script>

<template>
  <div class="game-container">
    <DamagePopup
      v-for="popup in damagePopups"
      :key="popup.id"
      :popup="popup"
      @remove="removeDamagePopup"
    />

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
        <h1>棒棒糖大冒险</h1>
        <div class="header-info">
          <span class="gold">💰 {{ formatNumber(playerStore.player.gold) }}</span>
          <span class="diamond">💎 {{ formatNumber(playerStore.player.diamond) }}</span>
          <span
            class="rebirth-points"
            @click="openRebirthShop"
            title="点击进入转生商店"
          >
            ⭐ {{ formatNumber(rebirthStore.rebirthPoints) }}
          </span>
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
          <div class="rebirth-info">
            <p>当前难度值: <strong>{{ monsterStore.difficultyValue }}</strong></p>
            <p>可获得转生点数: <strong class="highlight">{{ rebirthStore.calculateRebirthPoints(monsterStore.difficultyValue) }}</strong></p>
            <p>已拥有转生点数: <strong class="highlight">{{ rebirthStore.rebirthPoints }}</strong></p>
            <p>累计转生次数: <strong>{{ rebirthStore.totalRebirthCount }}</strong></p>
          </div>

          <div class="rebirth-warning">
            <p>⚠️ 转生将重置以下内容：</p>
            <ul>
              <li>所有金币和钻石</li>
              <li>所有装备和物品</li>
              <li>所有角色属性和技能</li>
              <li>当前推图进度</li>
            </ul>
            <p>✅ 转生将保留：</p>
            <ul>
              <li>累计在线/离线时间</li>
              <li>转生点数和已购买的永久加成</li>
              <li>累计击杀数等统计数据</li>
            </ul>
          </div>

          <div class="rebirth-actions">
            <button
              class="rebirth-confirm-btn"
              @click="performRebirth"
              :disabled="monsterStore.difficultyValue < 10"
            >
              转生 (需要难度值 ≥ 10)
            </button>
            <button class="shop-btn" @click="openRebirthShop">
              进入转生商店
            </button>
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
</style>
