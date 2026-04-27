<script setup lang="ts">
import { computed } from 'vue'
import { usePlayerStore } from '../stores/playerStore'
import { useMonsterStore } from '../stores/monsterStore'
import { useRebirthStore } from '../stores/rebirthStore'
import { formatNumber, formatTime } from '../utils/format'
import { PHASE_NAMES } from '../types'

const playerStore = usePlayerStore()
const monsterStore = useMonsterStore()
const rebirthStore = useRebirthStore()

const expNeeded = computed(() => playerStore.getExpNeeded())
const expPercent = computed(() => Math.min(100, (playerStore.player.experience / expNeeded.value) * 100))
const expPerSecond = computed(() => playerStore.getAverageExpPerSecond())
const secondsToLevelUp = computed(() => playerStore.getSecondsToLevelUp())

const emit = defineEmits<{
  openRebirthShop: []
  openRebirthModal: []
}>()

function onRebirthPointsClick() {
  emit('openRebirthShop')
}

function onRebirthClick() {
  emit('openRebirthModal')
}
</script>

<template>
  <header class="game-header">
    <div class="brand-block">
      <div class="brand-mark">🍭</div>
      <div>
        <p class="eyebrow">Incremental RPG Dashboard</p>
        <h1>棒棒糖大冒险</h1>
      </div>
    </div>

    <div class="progress-block">
      <div class="level-row">
        <span class="level-badge">Lv.{{ playerStore.player.level }}</span>
        <span class="phase-pill">阶段 {{ monsterStore.currentPhase }} · {{ PHASE_NAMES[monsterStore.currentPhase] }}</span>
        <span v-if="secondsToLevelUp < Infinity" class="time-pill">{{ formatTime(secondsToLevelUp) }} 升级</span>
      </div>
      <div class="header-exp-bar" aria-label="经验进度">
        <div class="header-exp-fill exp-fill-animated" :style="{ width: expPercent + '%' }"></div>
      </div>
      <div class="exp-meta">
        <span>{{ formatNumber(playerStore.player.experience) }} / {{ formatNumber(expNeeded) }}</span>
        <span>{{ formatNumber(expPerSecond) }}/秒</span>
      </div>
    </div>

    <div class="resource-grid">
      <div class="resource-card gold">
        <span>金币</span>
        <strong>💰 {{ formatNumber(playerStore.player.gold) }}</strong>
      </div>
      <div class="resource-card diamond">
        <span>钻石</span>
        <strong>💎 {{ formatNumber(playerStore.player.diamond) }}</strong>
      </div>
      <button class="resource-card rebirth" @click="onRebirthPointsClick" title="点击进入转生商店">
        <span>转生点</span>
        <strong>⭐ {{ formatNumber(rebirthStore.rebirthPoints) }}</strong>
      </button>
      <button class="rebirth-btn" @click="onRebirthClick">转生</button>
    </div>
  </header>
</template>

<style scoped>
@import '../styles/design-system.css';

.game-header {
  display: grid;
  grid-template-columns: minmax(13rem, 1.2fr) minmax(16rem, 1.6fr) minmax(18rem, 1.8fr);
  gap: 1rem;
  align-items: center;
  padding: 0.9rem 1rem;
  width: 100%;
  max-width: 100%;
  min-width: 0;
}

.brand-block {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  min-width: 0;
}

.brand-block > div {
  min-width: 0;
}

.brand-mark {
  width: 3rem;
  height: 3rem;
  display: grid;
  place-items: center;
  border-radius: 1rem;
  background: linear-gradient(135deg, rgba(255, 79, 123, 0.22), rgba(69, 230, 208, 0.14));
  border: 1px solid var(--color-border);
  box-shadow: var(--shadow-glow-primary);
  font-size: 1.45rem;
}

.eyebrow {
  margin: 0 0 0.15rem;
  color: var(--color-text-muted);
  font-size: 0.66rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.game-header h1 {
  margin: 0;
  color: var(--color-text-primary);
  font-size: clamp(1.15rem, 2vw, 1.65rem);
  line-height: 1.1;
  overflow-wrap: anywhere;
}

.progress-block {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  min-width: 0;
}

.level-row,
.exp-meta {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  flex-wrap: wrap;
}

.level-badge,
.phase-pill,
.time-pill {
  display: inline-flex;
  align-items: center;
  border-radius: var(--border-radius-full);
  padding: 0.22rem 0.5rem;
  font-size: var(--font-size-xs);
  line-height: 1;
}

.level-badge {
  background: var(--gradient-primary);
  color: #fff;
  font-weight: 800;
}

.phase-pill {
  background: rgba(143, 122, 255, 0.12);
  color: var(--color-accent-light);
  border: 1px solid rgba(143, 122, 255, 0.22);
}

.time-pill {
  background: rgba(69, 230, 208, 0.1);
  color: var(--color-secondary-light);
  border: 1px solid rgba(69, 230, 208, 0.18);
}

.header-exp-bar {
  height: 0.68rem;
  border-radius: var(--border-radius-full);
  background: rgba(255, 255, 255, 0.06);
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.header-exp-fill {
  height: 100%;
  background: var(--gradient-exp);
}

.exp-meta {
  justify-content: space-between;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.resource-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.5rem;
  align-items: stretch;
  min-width: 0;
}

.resource-card {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.18rem;
  padding: 0.55rem 0.65rem;
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius-md);
  background: rgba(255, 255, 255, 0.045);
  color: var(--color-text-primary);
  text-align: left;
}

.resource-card span {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.resource-card strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
}

.resource-card.gold strong { color: var(--color-gold); }
.resource-card.diamond strong { color: var(--color-diamond); }
.resource-card.rebirth strong { color: var(--color-gold-light); }

.resource-card.rebirth {
  cursor: pointer;
}

.rebirth-btn {
  border: 1px solid rgba(69, 230, 208, 0.22);
  border-radius: var(--border-radius-md);
  background: linear-gradient(135deg, rgba(69, 230, 208, 0.22), rgba(143, 122, 255, 0.22));
  color: var(--color-text-primary);
  cursor: pointer;
  font-weight: 800;
  transition: transform var(--transition-fast), border-color var(--transition-fast);
}

.rebirth-btn:hover {
  transform: translateY(-1px);
  border-color: rgba(69, 230, 208, 0.42);
}

@media (max-width: 1180px) {
  .game-header {
    grid-template-columns: 1fr 1.5fr;
  }

  .resource-grid {
    grid-column: 1 / -1;
  }
}

@media (max-width: 720px) {
  .game-header {
    grid-template-columns: 1fr;
    padding: 0.75rem;
    gap: 0.75rem;
  }

  .resource-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .global-actions {
    min-width: 0;
  }
}

@media (max-width: 420px) {
  .game-header {
    padding: 0.65rem;
  }

  .brand-mark {
    width: 2.5rem;
    height: 2.5rem;
  }

  .resource-grid {
    gap: 0.45rem;
  }

  .resource-card,
  .rebirth-btn {
    padding: 0.5rem;
  }
}
</style>
