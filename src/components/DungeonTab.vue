<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useDungeonStore } from '../stores/dungeonStore'
import { usePlayerStore } from '../stores/playerStore'
import { useMonsterStore } from '../stores/monsterStore'
import { formatNumber } from '../utils/format'
import { getDominantBuildArchetype } from '../data/buildArchetypes'
import { estimateCombatKpis, getChallengeDecisionHint } from '../utils/combatInsights'

const dungeonStore = useDungeonStore()
const playerStore = usePlayerStore()
const monsterStore = useMonsterStore()
onMounted(() => dungeonStore.load())

const challengeHint = computed(() => getChallengeDecisionHint(
  estimateCombatKpis(playerStore.player, playerStore.totalStats, monsterStore.currentMonster, monsterStore.difficultyValue),
  getDominantBuildArchetype(playerStore.totalStats).archetype.shortName
))


function getFloorColor(floor: number): string {
  if (floor <= 5) return '#4ade80'
  if (floor <= 10) return '#60a5fa'
  if (floor <= 15) return '#f59e0b'
  return '#f87171'
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

    <div class="challenge-decision" :class="challengeHint.severity">
      <div><span>失败原因</span><strong>{{ challengeHint.failureReason }}</strong></div>
      <div><span>推荐构筑</span><strong>{{ challengeHint.recommendedBuild }}</strong></div>
      <div><span>推荐属性</span><strong>{{ challengeHint.recommendedStats.join(' / ') }}</strong></div>
      <div><span>预计修正</span><strong>{{ challengeHint.expectedFix }}</strong></div>
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
.challenge-decision { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; padding: 12px; margin-bottom: 12px; border-radius: 10px; background: #1a1a2e; border: 1px solid #333; }
.challenge-decision.warning { border-color: #f59e0b; background: #2a2416; }
.challenge-decision.danger { border-color: #ef4444; background: #2a1616; }
.challenge-decision div { display: flex; flex-direction: column; gap: 3px; }
.challenge-decision span { font-size: 11px; color: #888; }
.challenge-decision strong { font-size: 12px; color: #fff; line-height: 1.4; }
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
.boss-tag { background: #dc2626; color: white; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: bold; }
.floor-hp { width: 80px; height: 6px; background: #333; border-radius: 3px; overflow: hidden; }
.hp-bar-fill { height: 100%; transition: width 0.3s; }
.hp-text { font-size: 11px; color: #888; min-width: 80px; text-align: right; }
</style>
