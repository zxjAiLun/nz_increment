<script setup lang="ts">
import { useArenaStore } from '../stores/arenaStore'
import { PVP_BUFFS } from '../data/pvpBuffs'

const arena = useArenaStore()

function selectBuff(buffId: string) {
  // 简化：选择后开始匹配
}
</script>

<template>
  <div class="arena-tab">
    <div class="arena-header">
      <h2>竞技场</h2>
      <div class="rank-info">
        <span>段位: {{ arena.rank }}</span>
        <span>积分: {{ arena.currentRating }}</span>
        <span>战绩: {{ arena.winCount }}胜 {{ arena.loseCount }}负</span>
      </div>
    </div>

    <div v-if="arena.matching" class="matching">
      <div class="spinner"></div>
      <p>匹配中...</p>
    </div>

    <div v-else class="arena-actions">
      <h3>选择增益</h3>
      <div class="buff-grid">
        <div
          v-for="buff in PVP_BUFFS"
          :key="buff.id"
          class="buff-card"
          @click="selectBuff(buff.id)"
        >
          <span class="buff-name">{{ buff.name }}</span>
          <span class="buff-desc">{{ buff.description }}</span>
        </div>
      </div>
      <button class="start-btn" @click="arena.startMatching()">开始匹配</button>
    </div>

    <div class="season-info">
      <h3>赛季信息</h3>
      <p>赛季结束: {{ new Date(arena.currentSeason.endTime).toLocaleDateString() }}</p>
    </div>
  </div>
</template>

<style scoped>
.arena-header {
  padding: 16px;
  background: var(--color-surface);
  border-radius: 8px;
  margin-bottom: 16px;
}
.rank-info {
  display: flex;
  gap: 16px;
  margin-top: 8px;
}
.matching {
  text-align: center;
  padding: 48px;
}
.spinner {
  width: 40px;
  height: 40px;
  border: 3px solid var(--color-bg-dark);
  border-top-color: var(--color-primary);
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin: 0 auto 16px;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
.buff-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
  margin: 12px 0;
}
.buff-card {
  padding: 12px;
  background: var(--color-bg-panel);
  border-radius: 8px;
  cursor: pointer;
}
.buff-card:hover {
  background: var(--color-bg-card);
}
.start-btn {
  width: 100%;
  padding: 14px;
  background: var(--color-primary);
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 16px;
  font-weight: bold;
  margin-top: 16px;
}
</style>
