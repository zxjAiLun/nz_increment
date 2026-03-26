<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { usePlayerStore } from '../stores/playerStore'
import { formatNumber } from '../utils/format'

interface Props {
  visible: boolean
}

defineProps<Props>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'export'): void
  (e: 'reset'): void
}>()

const playerStore = usePlayerStore()

const debugStats = ref({
  totalDamage: 0,
  critCount: 0,
  killCount: 0,
  damageByType: {} as Record<string, number>,
  startTime: Date.now()
})

const debugLog = ref<any[]>([])

const combatDuration = computed(() => {
  return Math.floor((Date.now() - debugStats.value.startTime) / 1000)
})

const currentDPS = computed(() => {
  return formatNumber(debugStats.value.totalDamage / Math.max(1, (Date.now() - debugStats.value.startTime) / 1000))
})

function resetStats() {
  debugStats.value = {
    totalDamage: 0,
    critCount: 0,
    killCount: 0,
    damageByType: {},
    startTime: Date.now()
  }
  debugLog.value = []
  emit('reset')
}

function exportLog() {
  emit('export')
}

let durationInterval: number | null = null

onMounted(() => {
  durationInterval = window.setInterval(() => {
    // Force reactivity update for duration display
  }, 1000)
})

onUnmounted(() => {
  if (durationInterval) {
    clearInterval(durationInterval)
  }
})
</script>

<template>
  <div v-if="visible" class="debug-panel-overlay">
    <div class="debug-panel">
      <div class="debug-panel-header">
        <span class="debug-panel-title">🔧 数值调试面板</span>
        <button class="debug-close-btn" @click="emit('close')">×</button>
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
              <span class="debug-stat-value">{{ combatDuration }}s</span>
            </div>
            <div class="debug-stat">
              <span class="debug-stat-label">实时DPS</span>
              <span class="debug-stat-value">{{ currentDPS }}</span>
            </div>
          </div>
        </div>
        
        <div class="debug-section">
          <h4>📈 伤害构成</h4>
          <div class="damage-breakdown-list">
            <div 
              v-for="(value, type) in debugStats.damageByType" 
              :key="type" 
              class="breakdown-item"
            >
              <span class="breakdown-type">{{ type }}</span>
              <div class="breakdown-bar-container">
                <div 
                  class="breakdown-bar"
                  :style="{ width: (value / debugStats.totalDamage * 100) + '%' }"
                ></div>
              </div>
              <span class="breakdown-value">
                {{ formatNumber(value) }} ({{ (value / debugStats.totalDamage * 100).toFixed(1) }}%)
              </span>
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
            <div>
              伤害加成: 
              {{ (playerStore.totalStats.damageBonusI + playerStore.totalStats.damageBonusII + playerStore.totalStats.damageBonusIII).toFixed(1) }}%
            </div>
          </div>
        </div>
        
        <div class="debug-section">
          <h4>📋 最近日志</h4>
          <div class="debug-log-list">
            <div 
              v-for="(log, idx) in debugLog.slice(-5).reverse()" 
              :key="idx" 
              class="log-entry"
            >
              <span class="log-type">{{ log.type }}</span>
              <span class="log-damage">{{ formatNumber(log.damage) }}</span>
              <span class="log-crit">{{ log.isCrit ? '💥' : '' }}</span>
            </div>
            <div v-if="debugLog.length === 0" class="log-empty">暂无日志</div>
          </div>
        </div>
      </div>
      
      <div class="debug-panel-actions">
        <button @click="exportLog" class="debug-action-btn">📤 导出</button>
        <button @click="resetStats" class="debug-action-btn">🔄 重置</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.debug-panel-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 900;
  backdrop-filter: blur(4px);
}

.debug-panel {
  background: var(--color-bg-panel, #1a1a2e);
  border-radius: 12px;
  width: 90%;
  max-width: 500px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  border: 1px solid rgba(255, 255, 255, 0.1);
  overflow: hidden;
}

.debug-panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem;
  background: rgba(0, 0, 0, 0.3);
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.debug-panel-title {
  font-size: 1.1rem;
  font-weight: bold;
  color: var(--color-primary, #4ecdc4);
}

.debug-close-btn {
  background: transparent;
  border: none;
  color: var(--color-text-muted, #888);
  font-size: 1.5rem;
  cursor: pointer;
  padding: 0 0.5rem;
  transition: color 0.2s;
}

.debug-close-btn:hover {
  color: var(--color-text-primary, #fff);
}

.debug-panel-content {
  flex: 1;
  overflow-y: auto;
  padding: 1rem;
}

.debug-section {
  margin-bottom: 1.5rem;
}

.debug-section h4 {
  color: var(--color-accent, #ff6b6b);
  margin-bottom: 0.75rem;
  font-size: 0.95rem;
}

.debug-stats-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.5rem;
}

.debug-stat {
  background: rgba(0, 0, 0, 0.3);
  padding: 0.5rem;
  border-radius: 6px;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.debug-stat-label {
  font-size: 0.75rem;
  color: var(--color-text-muted, #888);
}

.debug-stat-value {
  font-size: 1rem;
  font-weight: bold;
  color: var(--color-primary, #4ecdc4);
}

.damage-breakdown-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.breakdown-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.85rem;
}

.breakdown-type {
  width: 60px;
  color: var(--color-text-secondary, #aaa);
}

.breakdown-bar-container {
  flex: 1;
  height: 8px;
  background: rgba(0, 0, 0, 0.3);
  border-radius: 4px;
  overflow: hidden;
}

.breakdown-bar {
  height: 100%;
  background: linear-gradient(90deg, var(--color-primary, #4ecdc4), var(--color-accent, #ff6b6b));
  transition: width 0.3s ease;
}

.breakdown-value {
  width: 100px;
  text-align: right;
  color: var(--color-text-muted, #888);
  font-size: 0.75rem;
}

.player-stats-debug {
  background: rgba(0, 0, 0, 0.3);
  padding: 0.75rem;
  border-radius: 6px;
  font-size: 0.85rem;
  line-height: 1.6;
}

.debug-log-list {
  background: rgba(0, 0, 0, 0.3);
  padding: 0.75rem;
  border-radius: 6px;
  max-height: 150px;
  overflow-y: auto;
}

.log-entry {
  display: flex;
  gap: 0.5rem;
  padding: 0.25rem 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  font-size: 0.8rem;
}

.log-empty {
  color: var(--color-text-muted, #888);
  font-style: italic;
  text-align: center;
  padding: 1rem;
}

.debug-panel-actions {
  display: flex;
  gap: 0.5rem;
  padding: 1rem;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  justify-content: flex-end;
}

.debug-action-btn {
  background: var(--color-bg-card, #252542);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: var(--color-text-primary, #fff);
  padding: 0.5rem 1rem;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
}

.debug-action-btn:hover {
  background: var(--color-primary, #4ecdc4);
  color: #fff;
}
</style>
