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
    <div class="header-top">
      <h1>棒棒糖大冒险</h1>
      <div class="header-info">
        <span class="gold">💰 {{ formatNumber(playerStore.player.gold) }}</span>
        <span class="diamond">💎 {{ formatNumber(playerStore.player.diamond) }}</span>
        <span
          class="rebirth-points"
          @click="onRebirthPointsClick"
          title="点击进入转生商店"
        >
          ⭐ {{ formatNumber(rebirthStore.rebirthPoints) }}
        </span>
        <button class="rebirth-btn" @click="onRebirthClick">
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
</template>

<style scoped>
@import '../styles/design-system.css';

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
</style>
