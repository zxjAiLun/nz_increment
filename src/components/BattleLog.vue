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
  compact?: boolean
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

const hasEntries = computed(() => (props.entries?.length ?? 0) > 0)

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
  <div class="battle-log" :class="{ compact: props.compact }">
    <div class="log-header">
      <div>
        <span v-if="!props.compact" class="log-kicker">最近事件</span>
        <h3>{{ props.compact ? '最近战报' : '战斗记录' }}</h3>
      </div>
      <div class="log-controls">
        <div v-if="!props.compact" class="filter-buttons">
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
        <button
          class="clear-btn"
          :disabled="!hasEntries"
          title="清空战斗记录"
          @click="clearLog"
        >
          清空记录
        </button>
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
          <span class="entry-icon" :style="{ color: getTypeColor(inferEntryType(entry)) }">{{ getTypeIcon(inferEntryType(entry)) }}</span>
          <span class="entry-message">{{ entry.message }}</span>
          <span v-if="entry.explanation" class="explain-hint">伤害解释</span>
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
        暂无战斗记录
      </div>
    </div>
  </div>
</template>

<style scoped>
.battle-log {
  background: transparent;
  border-radius: var(--border-radius-md);
  overflow: hidden;
}

.log-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 0.8rem;
  padding: 0.85rem 0.9rem 0.65rem;
  border-bottom: 1px solid var(--color-border);
  background: rgba(7, 10, 18, 0.42);
}

.log-kicker {
  display: block;
  margin-bottom: 0.18rem;
  color: var(--color-text-muted);
  font-size: 0.66rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.log-header h3 {
  margin: 0;
  color: var(--color-text-primary);
  font-size: var(--font-size-lg);
  line-height: 1.2;
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
  border: 1px solid var(--color-border);
  background: rgba(255, 255, 255, 0.045);
  color: var(--color-text-muted);
  padding: 0.25rem 0.52rem;
  border-radius: var(--border-radius-full);
  cursor: pointer;
  font-size: var(--font-size-xs);
  font-weight: 800;
  transition: border-color var(--transition-fast), background var(--transition-fast), color var(--transition-fast);
}

.filter-buttons button:hover {
  border-color: var(--color-border-strong);
  background: rgba(255, 255, 255, 0.07);
  color: var(--color-text-primary);
}

.filter-buttons button.active {
  border-color: rgba(69, 230, 208, 0.38);
  background: rgba(69, 230, 208, 0.12);
  color: var(--color-secondary-light);
}

.clear-btn {
  border: 1px solid var(--color-border);
  background: rgba(255, 255, 255, 0.045);
  color: var(--color-text-muted);
  padding: 0.25rem 0.52rem;
  border-radius: var(--border-radius-full);
  cursor: pointer;
  font-size: var(--font-size-xs);
  font-weight: 800;
  transition: border-color var(--transition-fast), background var(--transition-fast), color var(--transition-fast);
}

.clear-btn:hover {
  border-color: rgba(255, 91, 110, 0.38);
  background: rgba(255, 91, 110, 0.12);
  color: var(--color-primary-light);
}

.log-content {
  max-height: 19rem;
  overflow-y: auto;
  padding: 0.65rem 0.75rem 0.75rem;
}

.log-entry {
  position: relative;
  padding: 0.48rem 0.6rem 0.48rem 0.75rem;
  border: 1px solid var(--color-border);
  border-left: 3px solid var(--color-text-muted);
  margin-bottom: 0.38rem;
  font-size: var(--font-size-xs);
  background: rgba(7, 10, 18, 0.56);
  border-radius: var(--border-radius-sm);
  animation: slide-in-right 0.2s ease;
}

.log-entry.explainable {
  cursor: pointer;
}

.entry-line {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  min-width: 0;
}

/* T19.4 Highlighting */
.log-passive { color: #66ccff; }
.log-set { color: #cc99ff; }
.log-crit { color: #ffd700; font-weight: bold; }
.log-heal { color: #44ff44; }

.entry-icon {
  flex: 0 0 auto;
  font-size: 0.86rem;
}

.entry-message {
  flex: 1;
  color: var(--color-text-secondary);
  line-height: 1.4;
  min-width: 0;
  overflow-wrap: anywhere;
}

.entry-value {
  color: var(--color-secondary-light);
  font-weight: 800;
  min-width: 3.5rem;
  text-align: right;
}

.explain-hint {
  color: var(--color-accent-light);
  font-size: 0.68rem;
  font-weight: 800;
  white-space: nowrap;
}

.damage-explain {
  margin-top: 0.4rem;
  padding: 0.5rem 0.6rem;
  border: 1px solid var(--color-border);
  background: rgba(255, 255, 255, 0.045);
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
  padding: 2rem 1rem;
  font-size: 0.8rem;
}

.battle-log.compact .log-header {
  align-items: center;
  padding: 0.75rem 0.85rem 0.55rem;
}

.battle-log.compact .log-header h3 {
  font-size: var(--font-size-md);
}

.battle-log.compact .log-content {
  max-height: 14rem;
  padding: 0.55rem 0.65rem 0.65rem;
}

.battle-log.compact .log-entry {
  margin-bottom: 0.28rem;
  padding: 0.42rem 0.55rem 0.42rem 0.68rem;
}

.battle-log.compact .explain-hint {
  display: none;
}

@media (max-width: 640px) {
  .log-header {
    flex-direction: column;
  }

  .log-controls {
    width: 100%;
    justify-content: space-between;
  }

  .filter-buttons {
    overflow-x: auto;
  }

  .battle-log.compact .log-content {
    max-height: 7.5rem;
  }

  .battle-log.compact .log-entry:nth-child(n + 4) {
    display: none;
  }

  .entry-value {
    min-width: auto;
  }
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
