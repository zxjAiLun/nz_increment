<script setup lang="ts">
import { ref, computed } from 'vue'
import { formatNumber } from '../utils/format'

export interface BattleLogEntry {
  id: number
  message: string
  explanation?: Array<{ label: string; value: string }>
  type?: 'damage' | 'skill' | 'boss' | 'item' | 'level' | 'system'
  value?: number
}

const props = defineProps<{
  entries?: BattleLogEntry[]
  maxEntries?: number
}>()

const emit = defineEmits<{
  (e: 'clear'): void
}>()

const filter = ref<'all' | 'damage' | 'skill' | 'boss' | 'item' | 'level'>('all')
const showOnlyRecent = ref(true)
const expandedLogId = ref<number | null>(null)

const filteredEntries = computed(() => {
  if (!props.entries) return []
  let result = props.entries
  if (filter.value !== 'all') {
    result = result.filter(entry => (entry.type ?? inferEntryType(entry)) === filter.value)
  }
  if (showOnlyRecent.value) {
    result = result.slice(0, 20)
  }
  return result.slice(0, props.maxEntries ?? 50)
})

function getTypeIcon(type: BattleLogEntry['type']): string {
  switch (type) {
    case 'damage': return '\u2694\ufe0f'
    case 'skill': return '\u2728'
    case 'boss': return '\ud83d\udc7b'
    case 'item': return '\ud83d\udce6'
    case 'level': return '\u2b06\ufe0f'
    case 'system': return '\ud83d\udcde'
    default: return '\u2022'
  }
}

function getTypeColor(type: BattleLogEntry['type']): string {
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

function getEntryClass(entry: BattleLogEntry): string {
  const msg = entry.message
  if (msg.includes('[\u88c5\u5907]') || msg.includes('[被动]')) return 'log-passive'
  if (msg.includes('[\u5957\u4ef6]')) return 'log-set'
  if (msg.includes('\u66b4\u51fb')) return 'log-crit'
  if (msg.includes('\u6cbb\u7597') || msg.includes('\u751f\u547d\u5077\u53d6')) return 'log-heal'
  return ''
}

function inferEntryType(entry: BattleLogEntry): BattleLogEntry['type'] {
  if (entry.type) return entry.type
  if (entry.message.includes('技能') || entry.message.includes('必杀')) return 'skill'
  if (entry.message.includes('Boss') || entry.message.includes('BOSS') || entry.message.includes('狂暴')) return 'boss'
  if (entry.message.includes('获得') || entry.message.includes('装备')) return 'item'
  if (entry.message.includes('伤害') || entry.message.includes('暴击') || entry.message.includes('未命中')) return 'damage'
  return 'system'
}

function toggleExplanation(entry: BattleLogEntry) {
  if (!entry.explanation) return
  expandedLogId.value = expandedLogId.value === entry.id ? null : entry.id
}

function clearLog() {
  emit('clear')
}
</script>

<template>
  <div class="battle-log">
    <div class="log-header">
      <h3>\u6218\u6597\u65e5\u5fd7</h3>
      <div class="log-controls">
        <div class="filter-buttons">
          <button
            :class="{ active: filter === 'all' }"
            @click="filter = 'all'"
          >
            \u5168\u90e8
          </button>
          <button
            :class="{ active: filter === 'damage' }"
            @click="filter = 'damage'"
          >
            \u4f24\u5bb3
          </button>
          <button
            :class="{ active: filter === 'skill' }"
            @click="filter = 'skill'"
          >
            \u6280\u80fd
          </button>
          <button
            :class="{ active: filter === 'boss' }"
            @click="filter = 'boss'"
          >
            Boss
          </button>
        </div>
        <button class="clear-btn" @click="clearLog">\u6e05\u7a7a</button>
      </div>
    </div>

    <div class="log-content">
      <div
        v-for="entry in filteredEntries"
        :key="entry.id"
        class="log-entry"
        :class="[getEntryClass(entry), { explainable: !!entry.explanation, expanded: expandedLogId === entry.id }]"
        :style="{ borderLeftColor: getTypeColor(inferEntryType(entry)) }"
        @click="toggleExplanation(entry)"
      >
        <div class="entry-line">
          <span class="entry-icon">{{ getTypeIcon(inferEntryType(entry)) }}</span>
          <span class="entry-message">{{ entry.message }}</span>
          <span v-if="entry.explanation" class="explain-hint">\u4f24\u5bb3\u89e3\u91ca</span>
          <span v-if="entry.value !== undefined" class="entry-value">
            {{ formatNumber(entry.value) }}
          </span>
        </div>
        <div v-if="entry.explanation && expandedLogId === entry.id" class="damage-explain">
          <div v-for="row in entry.explanation" :key="row.label" class="explain-row">
            <span>{{ row.label }}</span>
            <strong>{{ row.value }}</strong>
          </div>
        </div>
      </div>

      <div v-if="filteredEntries.length === 0" class="log-empty">
        \u6682\u65e0\u6218\u6597\u8bb0\u5f55
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
  padding: 0.3rem 0.5rem;
  border-left: 3px solid var(--color-text-muted);
  margin-bottom: 0.2rem;
  font-size: 0.75rem;
  background: var(--color-bg-dark);
  border-radius: 0 var(--border-radius-sm) var(--border-radius-sm) 0;
  animation: slide-in-right 0.2s ease;
}

.log-entry.explainable {
  cursor: pointer;
}

.entry-line {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

/* T19.4 Highlighting */
.log-passive { color: #66ccff; }
.log-set { color: #cc99ff; }
.log-crit { color: #ffd700; font-weight: bold; }
.log-heal { color: #44ff44; }

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

.explain-hint {
  color: var(--color-primary);
  font-size: 0.68rem;
  white-space: nowrap;
}

.damage-explain {
  margin-top: 0.4rem;
  padding: 0.45rem 0.55rem;
  background: var(--color-bg-panel);
  border-radius: var(--border-radius-sm);
}

.explain-row {
  display: flex;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.12rem 0;
  color: var(--color-text-muted);
}

.explain-row strong {
  color: var(--color-text-primary);
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
