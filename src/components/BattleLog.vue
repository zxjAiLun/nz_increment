<script setup lang="ts">
import { ref, computed } from 'vue'
import { formatNumber } from '../utils/format'

export interface BattleLogEntry {
  id: number
  timestamp: number
  type: 'damage' | 'skill' | 'boss' | 'item' | 'level' | 'system'
  message: string
  value?: number
  color?: string
}

const props = defineProps<{
  entries: BattleLogEntry[]
  maxEntries?: number
}>()

const emit = defineEmits<{
  (e: 'clear'): void
}>()

const filter = ref<'all' | 'damage' | 'skill' | 'boss' | 'item' | 'level'>('all')
const showOnlyRecent = ref(true)

const filteredEntries = computed(() => {
  let result = props.entries
  
  if (filter.value !== 'all') {
    result = result.filter(entry => entry.type === filter.value)
  }
  
  if (showOnlyRecent.value) {
    result = result.slice(-20)
  }
  
  return result.slice(-50)
})

function getTypeIcon(type: string): string {
  switch (type) {
    case 'damage': return '⚔️'
    case 'skill': return '✨'
    case 'boss': return '👹'
    case 'item': return '📦'
    case 'level': return '⬆️'
    case 'system': return '📢'
    default: return '•'
  }
}

function getTypeColor(type: string): string {
  switch (type) {
    case 'damage': return 'var(--color-danger)'
    case 'skill': return 'var(--color-accent)'
    case 'boss': return 'var(--color-warning)'
    case 'item': return 'var(--color-gold)'
    case 'level': return 'var(--color-success)'
    case 'system': return 'var(--color-info)'
    default: return 'var(--color-text-secondary)'
  }
}

function clearLog() {
  emit('clear')
}
</script>

<template>
  <div class="battle-log">
    <div class="log-header">
      <h3>战斗日志</h3>
      <div class="log-controls">
        <div class="filter-buttons">
          <button 
            :class="{ active: filter === 'all' }"
            @click="filter = 'all'"
          >
            全部
          </button>
          <button 
            :class="{ active: filter === 'damage' }"
            @click="filter = 'damage'"
          >
            伤害
          </button>
          <button 
            :class="{ active: filter === 'skill' }"
            @click="filter = 'skill'"
          >
            技能
          </button>
          <button 
            :class="{ active: filter === 'boss' }"
            @click="filter = 'boss'"
          >
            Boss
          </button>
        </div>
        <button class="clear-btn" @click="clearLog">清空</button>
      </div>
    </div>
    
    <div class="log-content">
      <div 
        v-for="entry in filteredEntries" 
        :key="entry.id"
        class="log-entry"
        :style="{ borderLeftColor: getTypeColor(entry.type) }"
      >
        <span class="entry-icon">{{ getTypeIcon(entry.type) }}</span>
        <span class="entry-message">{{ entry.message }}</span>
        <span v-if="entry.value !== undefined" class="entry-value">
          {{ formatNumber(entry.value) }}
        </span>
      </div>
      
      <div v-if="filteredEntries.length === 0" class="log-empty">
        暂无战斗记录
      </div>
    </div>
  </div>
</template>

<style scoped>
.battle-log {
  background: var(--color-bg-panel);
  border-radius: var(--border-radius-md);
  border: 1px solid var(--color-bg-card);
  overflow: hidden;
}

.log-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.5rem 1rem;
  background: var(--color-bg-dark);
  border-bottom: 1px solid var(--color-bg-card);
}

.log-header h3 {
  color: var(--color-primary);
  margin: 0;
  font-size: 0.9rem;
}

.log-controls {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.filter-buttons {
  display: flex;
  gap: 0.25rem;
}

.filter-buttons button {
  background: var(--color-bg-card);
  color: var(--color-text-muted);
  border: none;
  padding: 0.2rem 0.5rem;
  border-radius: var(--border-radius-sm);
  cursor: pointer;
  font-size: 0.7rem;
  transition: all var(--transition-fast);
}

.filter-buttons button:hover {
  background: var(--color-bg-dark);
  color: var(--color-text-primary);
}

.filter-buttons button.active {
  background: var(--color-primary);
  color: white;
}

.clear-btn {
  background: var(--color-bg-card);
  color: var(--color-text-muted);
  border: none;
  padding: 0.2rem 0.5rem;
  border-radius: var(--border-radius-sm);
  cursor: pointer;
  font-size: 0.7rem;
  transition: all var(--transition-fast);
}

.clear-btn:hover {
  background: var(--color-danger);
  color: white;
}

.log-content {
  max-height: 200px;
  overflow-y: auto;
  padding: 0.5rem;
}

.log-entry {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.3rem 0.5rem;
  border-left: 3px solid var(--color-text-muted);
  margin-bottom: 0.2rem;
  font-size: 0.75rem;
  background: var(--color-bg-dark);
  border-radius: 0 var(--border-radius-sm) var(--border-radius-sm) 0;
  animation: slide-in-right 0.2s ease;
}

.entry-icon {
  font-size: 0.9rem;
}

.entry-message {
  flex: 1;
  color: var(--color-text-secondary);
}

.entry-value {
  color: var(--color-secondary);
  font-weight: bold;
  min-width: 60px;
  text-align: right;
}

.log-empty {
  text-align: center;
  color: var(--color-text-muted);
  padding: 2rem;
  font-size: 0.8rem;
}

@keyframes slide-in-right {
  from {
    opacity: 0;
    transform: translateX(10px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}
</style>
