<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useLeaderboardStore } from '../stores/leaderboardStore'

const lb = useLeaderboardStore()

// Cache top 50 to avoid recreating slice on every render
const topEntries = computed(() => lb.entries.slice(0, 50))

onMounted(() => {
  lb.fetchLeaderboard()
})

function getRankClass(rank: number) {
  if (rank === 1) return 'gold'
  if (rank === 2) return 'silver'
  if (rank === 3) return 'bronze'
  return ''
}
</script>

<template>
  <div class="leaderboard-tab">
    <div class="season-header">
      <h2>{{ lb.currentSeason.name }}</h2>
      <span v-if="lb.myRank" class="my-rank">我的排名: #{{ lb.myRank }}</span>
    </div>

    <div v-if="lb.loading" class="loading">加载中...</div>

    <div v-else class="rank-list">
      <div v-for="entry in topEntries" :key="entry.playerName"
           class="rank-row" :class="getRankClass(entry.rank)">
        <span class="rank">#{{ entry.rank }}</span>
        <span class="name">{{ entry.playerName }}</span>
        <span class="power">{{ entry.totalPower.toLocaleString() }}</span>
        <span class="floor">层{{ entry.floorReached }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.rank-list {
  max-height: 70vh;
  overflow-y: auto;
}
.rank-row {
  display: grid;
  grid-template-columns: 60px 1fr 100px 60px;
  padding: 10px;
  border-bottom: 1px solid var(--color-border);
}
.rank-row.gold { background: linear-gradient(90deg, #ffd70033, transparent); color: #ffd700; }
.rank-row.silver { background: linear-gradient(90deg, #c0c0c033, transparent); color: #c0c0c0; }
.rank-row.bronze { background: linear-gradient(90deg, #cd7f3233, transparent); color: #cd7f32; }
.my-rank {
  background: var(--color-primary);
  color: white;
  padding: 4px 12px;
  border-radius: 12px;
}
</style>
