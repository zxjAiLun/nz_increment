<script setup lang="ts">
import { usePlayerStore } from '../stores/playerStore'
import { useGameStore } from '../stores/gameStore'
import { formatNumber, formatTime } from '../utils/format'

defineProps<{
  isDebugMode: boolean
}>()

const playerStore = usePlayerStore()
const gameStore = useGameStore()

const emit = defineEmits<{
  (e: 'confirmReset'): void
  (e: 'toggleDebugMode'): void
  (e: 'exportDebugLog'): void
  (e: 'resetDebugStats'): void
}>()

function saveGame() {
  playerStore.saveGame()
}

function confirmReset() {
  emit('confirmReset')
}

function toggleDebugMode() {
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
  <div class="settings-core-tab">
    <section class="stats-detail-panel">
      <h2>累计数据</h2>
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

    <section class="game-settings-panel">
      <h2>游戏设置</h2>
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
        <button @click="saveGame" class="save-btn">保存游戏</button>
        <button @click="confirmReset" class="reset-btn">重置游戏</button>
      </div>
    </section>

    <section class="debug-tools-panel">
      <h2>调试工具</h2>
      <p class="debug-description">用于数值验证和伤害分析</p>
      <div class="debug-buttons">
        <button
          @click="toggleDebugMode"
          :class="{ active: isDebugMode }"
          class="debug-btn"
        >
          {{ isDebugMode ? '关闭调试' : '开启调试' }}
        </button>
        <button @click="exportDebugLog" class="debug-btn export-btn">导出日志</button>
        <button @click="resetDebugStats" class="debug-btn reset-stats-btn">重置统计</button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.settings-core-tab {
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
}

.stats-detail-panel,
.game-settings-panel,
.debug-tools-panel {
  background: var(--color-bg-panel);
  padding: 1rem;
  border-radius: var(--border-radius-md);
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.5rem;
}

.stat-item {
  display: flex;
  justify-content: space-between;
  padding: 0.55rem 0.6rem;
  border-radius: var(--border-radius-sm);
  background: var(--color-bg-dark);
}

.stat-label {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.stat-value {
  color: var(--color-text-primary);
  font-weight: 700;
  font-size: var(--font-size-sm);
}

.speed-control {
  margin-top: 0.6rem;
}

.control-label {
  display: block;
  margin-bottom: 0.4rem;
  color: var(--color-text-muted);
}

.speed-buttons {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.4rem;
}

.speed-buttons button,
.save-btn,
.reset-btn,
.debug-btn {
  border: none;
  border-radius: var(--border-radius-sm);
  padding: 0.45rem 0.6rem;
  cursor: pointer;
}

.speed-buttons button {
  background: var(--color-bg-dark);
  color: var(--color-text-secondary);
}

.speed-buttons button.active {
  background: var(--color-primary);
  color: var(--color-bg-dark);
}

.save-reset-buttons {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.5rem;
  margin-top: 0.7rem;
}

.save-btn {
  background: var(--color-secondary);
  color: #fff;
}

.reset-btn {
  background: var(--color-danger);
  color: #fff;
}

.debug-description {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  margin-top: 0.4rem;
}

.debug-buttons {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.5rem;
  margin-top: 0.7rem;
}

.debug-btn {
  background: var(--color-bg-dark);
  color: var(--color-text-primary);
}

.debug-btn.active {
  background: var(--color-danger);
  color: #fff;
}

@media (max-width: 720px) {
  .stats-grid,
  .debug-buttons {
    grid-template-columns: 1fr;
  }
}
</style>
