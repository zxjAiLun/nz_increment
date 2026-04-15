<script setup lang="ts">
import { computed } from 'vue'
import { formatNumber } from '../utils/format'
import type { DamageLogEntry } from '../types'

const props = defineProps<{
  debugStats: {
    totalDamage: number
    critCount: number
    killCount: number
    damageByType: Record<string, number>
    startTime: number
  }
  debugLog: DamageLogEntry[]
}>()

// Cache sliced/reversed logs to avoid recreating array on every render
const recentLogs = computed(() => props.debugLog.slice(-5).reverse())

const emit = defineEmits<{
  toggleDebugMode: []
  exportDebugLog: []
  resetDebugStats: []
}>()
</script>

<template>
  <div class="debug-panel-overlay">
    <div class="debug-panel">
      <div class="debug-panel-header">
        <span class="debug-panel-title">🔧 数值调试面板</span>
        <button class="debug-close-btn" @click="emit('toggleDebugMode')">×</button>
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
                <div class="breakdown-bar" :style="{ width: (value / debugStats.totalDamage * 100) + '%' }"></div>
              </div>
              <span class="breakdown-value">{{ formatNumber(value) }} ({{ (value / debugStats.totalDamage * 100).toFixed(1) }}%)</span>
            </div>
          </div>
        </div>
        <div class="debug-section">
          <h4>📋 最近日志</h4>
          <div class="debug-log-list">
            <div v-for="(log, idx) in recentLogs" :key="idx" class="log-entry">
              <span class="log-type">{{ log.type }}</span>
              <span class="log-damage">{{ formatNumber(log.damage) }}</span>
              <span class="log-crit">{{ log.isCrit ? '💥' : '' }}</span>
            </div>
            <div v-if="debugLog.length === 0" class="log-empty">暂无日志</div>
          </div>
        </div>
      </div>
      <div class="debug-panel-actions">
        <button @click="emit('exportDebugLog')" class="debug-action-btn">📤 导出</button>
        <button @click="emit('resetDebugStats')" class="debug-action-btn">🔄 重置</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
@import '../styles/design-system.css';

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
