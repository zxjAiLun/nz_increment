<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'
import { useDungeonStore } from '../stores/dungeonStore'
import { formatNumber } from '../utils/format'

const dungeonStore = useDungeonStore()
onMounted(() => dungeonStore.load())

const availableFloors = computed(() => dungeonStore.availableFloors.slice(0, 10))

function getFloorColor(floor: number): string {
  if (floor <= 5) return '#4ade80'
  if (floor <= 10) return '#60a5fa'
  if (floor <= 15) return '#f59e0b'
  return '#f87171'
}

function getElementIcon(element: string): string {
  const icons: Record<string, string> = { fire: '🔥', water: '💧', wind: '💨', dark: '🌑', none: '⚪' }
  return icons[element] || '⚪'
}

function getStatusLabel(status: string): string {
  const labels: Record<string, string> = { locked: '🔒', available: '⭕', cleared: '✅', current: '▶️' }
  return labels[status] || status
}
</script>

<template>
  <div class="dungeon-tab">
    <div class="dungeon-header">
      <h2>地下城</h2>
      <div class="dungeon-info">
        <span>最高: {{ dungeonStore.progress.highestFloor }}层</span>
        <span>今日挑战: {{ dungeonStore.dailyAttempts }}/10</span>
      </div>
    </div>

    <div class="floor-list">
      <div
        v-for="floor in dungeonStore.floors.slice(0, 20)"
        :key="floor.floor"
        :class="['floor-item', `floor-${floor.status}`, { boss: floor.bossAppears }]"
      >
        <div class="floor-left">
          <span class="floor-num">{{ getStatusLabel(floor.status) }} {{ floor.floor }}层</span>
          <span class="floor-name">{{ floor.name }}</span>
        </div>
        <div class="floor-right">
          <span class="floor-element">{{ getElementIcon(floor.element) }}</span>
          <span v-if="floor.bossAppears" class="boss-tag">BOSS</span>
          <div class="floor-hp">
            <div
              class="hp-bar-fill"
              :style="{ width: (floor.currentHealth / floor.totalHealth * 100) + '%', background: getFloorColor(floor.floor) }"
            ></div>
          </div>
          <span class="hp-text">{{ formatNumber(floor.currentHealth) }}/{{ formatNumber(floor.totalHealth) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dungeon-tab { padding: 12px; overflow-y: auto; height: 100%; }
.dungeon-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.dungeon-header h2 { margin: 0; font-size: 18px; }
.dungeon-info { display: flex; gap: 12px; font-size: 13px; color: #888; }
.floor-list { display: flex; flex-direction: column; gap: 8px; }
.floor-item { display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; border-radius: 8px; background: #1a1a2e; border: 1px solid #333; }
.floor-item.floor-locked { opacity: 0.5; }
.floor-item.floor-cleared { border-color: #4ade80; }
.floor-item.floor-current { border-color: #f59e0b; background: #2a2a1a; }
.floor-item.boss { border-color: #f87171; background: linear-gradient(135deg, #2a1a1a 0%, #3a2020 100%); }
.floor-left { display: flex; flex-direction: column; gap: 2px; }
.floor-num { font-weight: 600; font-size: 14px; }
.floor-name { font-size: 12px; color: #888; }
.floor-right { display: flex; align-items: center; gap: 8px; }
.floor-element { font-size: 16px; }
.boss-tag { background: #dc2626; color: white; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: bold; }
.floor-hp { width: 80px; height: 6px; background: #333; border-radius: 3px; overflow: hidden; }
.hp-bar-fill { height: 100%; transition: width 0.3s; }
.hp-text { font-size: 11px; color: #888; min-width: 80px; text-align: right; }
</style>
