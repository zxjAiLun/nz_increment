<script setup lang="ts">
import { ref } from 'vue'
import { usePlayerStore } from '../stores/playerStore'
import { useAchievementStore } from '../stores/achievementStore'
import { useGameStore } from '../stores/gameStore'
import { formatNumber, formatTime } from '../utils/format'
import ThemeShop from './ThemeShop.vue'

const playerStore = usePlayerStore()
const achievementStore = useAchievementStore()
const gameStore = useGameStore()
const showThemeShop = ref(false)

const emit = defineEmits<{
  (e: 'confirmReset'): void
  (e: 'toggleDebugMode'): void
  (e: 'exportDebugLog'): void
  (e: 'resetDebugStats'): void
}>()

const isDebugMode = ref(false)

function saveGame() {
  playerStore.saveGame()
}

function confirmReset() {
  emit('confirmReset')
}

function claimOfflineReward() {
  playerStore.claimOfflineReward()
}

function toggleDebugMode() {
  isDebugMode.value = !isDebugMode.value
  emit('toggleDebugMode')
}

function exportDebugLog() {
  emit('exportDebugLog')
}

function resetDebugStats() {
  emit('resetDebugStats')
}
</script>

<template>
  <div class="settings-tab">
    <!-- 离线收益 -->
    <section v-if="playerStore.pendingOfflineReward" class="offline-panel">
      <div class="offline-header">
        <span class="offline-icon">🎁</span>
        <span class="offline-title">离线收益可用!</span>
      </div>
      <div class="offline-rewards">
        <div class="reward-item">
          <span class="reward-icon">💰</span>
          <span class="reward-value">{{ formatNumber(playerStore.pendingOfflineReward.gold) }}</span>
          <span class="reward-label">金币</span>
        </div>
        <div class="reward-item">
          <span class="reward-icon">✨</span>
          <span class="reward-value">{{ formatNumber(playerStore.pendingOfflineReward.exp) }}</span>
          <span class="reward-label">经验</span>
        </div>
      </div>
      <button @click="claimOfflineReward" class="claim-btn">
        领取奖励
      </button>
    </section>

    <!-- 成就 -->
    <section class="achievement-panel">
      <h2>🏆 成就 ({{ achievementStore.getCompletedCount() }}/{{ achievementStore.achievements.length }})</h2>
      <div class="achievement-list">
        <div
          v-for="achievement in achievementStore.achievements.slice(0, 10)"
          :key="achievement.id"
          class="achievement-item"
          :class="{ completed: achievement.completed }"
        >
          <div class="achievement-info">
            <span class="achievement-name">{{ achievement.name }}</span>
            <span class="achievement-desc">{{ achievement.description }}</span>
          </div>
          <div class="achievement-progress">
            <span class="progress-text">{{ achievement.progress }}/{{ achievement.requirement }}</span>
            <span v-if="achievement.completed" class="completed-badge">✓</span>
          </div>
        </div>
      </div>
    </section>

    <!-- 主题商店 -->
    <section class="theme-shop-entry">
      <h2>&#x2728; 主题商店</h2>
      <button v-if="!showThemeShop" @click="showThemeShop = true" class="theme-shop-btn">
        打开主题商店
      </button>
      <ThemeShop v-else />
    </section>

    <!-- 累计数据 -->
    <section class="stats-detail-panel">
      <h2>📊 累计数据</h2>
      <div class="stats-grid">
        <div class="stat-item">
          <span class="stat-label">累计击杀</span>
          <span class="stat-value">{{ formatNumber(playerStore.player.totalKillCount) }}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">累计在线</span>
          <span class="stat-value">{{ formatTime(playerStore.player.totalOnlineTime) }}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">累计离线</span>
          <span class="stat-value">{{ formatTime(playerStore.player.totalOfflineTime) }}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">最高连击</span>
          <span class="stat-value">{{ formatNumber(playerStore.player.maxComboCount) }}</span>
        </div>
      </div>
    </section>

    <!-- 游戏设置 -->
    <section class="game-settings-panel">
      <h2>⚙️ 游戏设置</h2>

      <div class="speed-control">
        <span class="control-label">游戏速度:</span>
        <div class="speed-buttons">
          <button
            v-for="speed in [1, 2, 4, 8]"
            :key="speed"
            :class="{ active: gameStore.gameSpeed === speed }"
            @click="gameStore.gameSpeed = speed"
          >
            {{ speed }}x
          </button>
        </div>
      </div>

      <div class="save-reset-buttons">
        <button @click="saveGame" class="save-btn">
          💾 保存游戏
        </button>
        <button @click="confirmReset" class="reset-btn">
          🗑️ 重置游戏
        </button>
      </div>
    </section>

    <!-- 调试工具 -->
    <section class="debug-tools-panel">
      <h2>🔧 调试工具</h2>
      <p class="debug-description">用于数值验证和伤害分析</p>

      <div class="debug-buttons">
        <button
          @click="toggleDebugMode"
          :class="{ active: isDebugMode }"
          class="debug-btn"
        >
          {{ isDebugMode ? '🔴 关闭调试' : '🟢 开启调试' }}
        </button>
        <button @click="exportDebugLog" class="debug-btn export-btn">
          📤 导出日志
        </button>
        <button @click="resetDebugStats" class="debug-btn reset-stats-btn">
          🔄 重置统计
        </button>
      </div>

      <div class="debug-shortcuts">
        <span class="shortcut-title">快捷键:</span>
        <span class="shortcut">Ctrl+D 调试面板</span>
        <span class="shortcut">Ctrl+E 导出日志</span>
        <span class="shortcut">Ctrl+R 重置统计</span>
      </div>
    </section>
  </div>
</template>

<style scoped>
.settings-tab {
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
}

.offline-panel {
  background: linear-gradient(135deg, var(--color-accent-dark), var(--color-accent));
  padding: 1rem;
  border-radius: var(--border-radius-md);
  text-align: center;
}

.offline-header {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  margin-bottom: 0.8rem;
}

.offline-icon {
  font-size: 1.5rem;
}

.offline-title {
  font-size: var(--font-size-lg);
  font-weight: bold;
  color: white;
}

.offline-rewards {
  display: flex;
  justify-content: center;
  gap: 2rem;
  margin-bottom: 0.8rem;
}

.reward-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.2rem;
}

.reward-icon {
  font-size: 1.2rem;
}

.reward-value {
  font-size: var(--font-size-lg);
  font-weight: bold;
  color: var(--color-gold);
}

.reward-label {
  font-size: var(--font-size-xs);
  color: rgba(255, 255, 255, 0.8);
}

.claim-btn {
  background: var(--color-gold);
  color: var(--color-bg-dark);
  border: none;
  padding: 0.5rem 2rem;
  cursor: pointer;
  border-radius: var(--border-radius-sm);
  font-size: var(--font-size-md);
  font-weight: bold;
  transition: all var(--transition-fast);
}

.claim-btn:hover {
  transform: scale(1.05);
  box-shadow: var(--shadow-glow-gold);
}

.achievement-panel,
.stats-detail-panel,
.game-settings-panel,
.theme-shop-entry {
  background: var(--color-bg-panel);
  padding: 1rem;
  border-radius: var(--border-radius-md);
}

.achievement-list {
  max-height: 200px;
  overflow-y: auto;
}

.achievement-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.5rem;
  background: var(--color-bg-dark);
  border-radius: var(--border-radius-sm);
  margin-bottom: 0.3rem;
}

.achievement-item.completed {
  border-left: 3px solid var(--color-secondary);
  background: var(--color-bg-card);
}

.achievement-info {
  display: flex;
  flex-direction: column;
}

.achievement-name {
  font-size: var(--font-size-sm);
  color: var(--color-text-primary);
  font-weight: bold;
}

.achievement-desc {
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}

.achievement-progress {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.progress-text {
  font-size: var(--font-size-sm);
  color: var(--color-secondary);
}

.completed-badge {
  background: var(--color-secondary);
  color: var(--color-bg-dark);
  width: 20px;
  height: 20px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--font-size-xs);
  font-weight: bold;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.5rem;
}

.stat-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  background: var(--color-bg-dark);
  padding: 0.8rem;
  border-radius: var(--border-radius-sm);
}

.stat-label {
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  margin-bottom: 0.2rem;
}

.stat-value {
  font-size: var(--font-size-md);
  color: var(--color-secondary);
  font-weight: bold;
}

.speed-control {
  margin-bottom: 1rem;
}

.control-label {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  display: block;
  margin-bottom: 0.5rem;
}

.speed-buttons {
  display: flex;
  gap: 0.3rem;
}

.speed-buttons button {
  flex: 1;
  background: var(--color-bg-dark);
  color: var(--color-text-primary);
  border: none;
  padding: 0.4rem;
  cursor: pointer;
  border-radius: var(--border-radius-sm);
  font-size: var(--font-size-sm);
  transition: all var(--transition-fast);
}

.speed-buttons button.active {
  background: var(--color-primary);
  color: white;
}

.speed-buttons button:hover:not(.active) {
  background: var(--color-bg-card);
}

.save-reset-buttons {
  display: flex;
  gap: 0.5rem;
}

.save-btn,
.reset-btn {
  flex: 1;
  padding: 0.6rem;
  border: none;
  cursor: pointer;
  border-radius: var(--border-radius-sm);
  font-size: var(--font-size-sm);
  font-weight: bold;
  transition: all var(--transition-fast);
}

.save-btn {
  background: var(--color-secondary);
  color: var(--color-bg-dark);
}

.save-btn:hover {
  background: var(--color-secondary-light);
}

.reset-btn {
  background: var(--color-primary);
  color: white;
}

.reset-btn:hover {
  background: var(--color-primary-light);
}

.theme-shop-btn {
  width: 100%;
  padding: 0.6rem;
  background: var(--color-accent);
  color: var(--color-bg-dark);
  border: none;
  border-radius: var(--border-radius-sm);
  font-size: var(--font-size-sm);
  font-weight: bold;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.theme-shop-btn:hover {
  transform: scale(1.02);
  box-shadow: var(--shadow-glow-gold);
}

.debug-tools-panel {
  background: var(--color-bg-panel);
  padding: 1rem;
  border-radius: var(--border-radius-md);
  border: 1px dashed var(--color-accent);
}

.debug-tools-panel h2 {
  color: var(--color-accent);
}

.debug-description {
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  margin-bottom: 0.8rem;
}

.debug-buttons {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.debug-btn {
  flex: 1;
  min-width: 100px;
  padding: 0.6rem 0.5rem;
  border: none;
  cursor: pointer;
  border-radius: var(--border-radius-sm);
  font-size: var(--font-size-sm);
  font-weight: bold;
  transition: all var(--transition-fast);
  background: var(--color-bg-dark);
  color: var(--color-text-primary);
}

.debug-btn:hover {
  background: var(--color-bg-card);
}

.debug-btn.active {
  background: var(--color-accent);
  color: white;
}

.export-btn {
  background: var(--color-secondary);
  color: var(--color-bg-dark);
}

.export-btn:hover {
  background: var(--color-secondary-light);
}

.reset-stats-btn {
  background: var(--color-warning);
  color: var(--color-bg-dark);
}

.reset-stats-btn:hover {
  filter: brightness(1.1);
}

.debug-shortcuts {
  margin-top: 0.8rem;
  padding-top: 0.5rem;
  border-top: 1px dashed var(--color-bg-card);
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  font-size: var(--font-size-xs);
}

.shortcut-title {
  color: var(--color-text-muted);
}

.shortcut {
  background: var(--color-bg-dark);
  padding: 0.15rem 0.4rem;
  border-radius: var(--border-radius-sm);
  color: var(--color-text-secondary);
}
</style>
