<script setup lang="ts">
import { useSeasonStore } from '../stores/seasonStore'

const season = useSeasonStore()
</script>

<template>
  <div class="season-tab">
    <div class="season-header" :class="season.currentSeason.theme">
      <h2>{{ season.currentSeason.name }}</h2>
      <div class="season-meta">
        <span>剩余 {{ season.getRemainingDays() }} 天</span>
        <span>主题: {{ season.currentSeason.theme }}</span>
      </div>
    </div>

    <div class="progress-section">
      <h3>赛季进度</h3>
      <div class="level-display">
        <span class="level">等级 {{ season.seasonLevel }}</span>
        <span class="points">{{ season.seasonPoints }} 点</span>
      </div>
      <div class="progress-bar">
        <div class="fill" :style="{ width: (season.seasonPoints % 100) + '%' }"></div>
      </div>
    </div>

    <div class="rewards-section">
      <h3>赛季奖励</h3>
      <div v-for="reward in season.currentSeason.seasonPassReward" :key="reward.level" class="reward-item">
        <span class="level">Lv.{{ reward.level }}</span>
        <span class="item">{{ reward.item }}</span>
        <button
          v-if="season.seasonLevel >= reward.level && !season.ownedSeasonItems.includes(reward.item)"
          @click="season.claimSeasonReward(reward.level)">
          领取
        </button>
        <span v-else-if="season.ownedSeasonItems.includes(reward.item)" class="owned">已拥有</span>
        <span v-else class="locked">未解锁</span>
      </div>
    </div>

    <div class="exclusive-section">
      <h3>限定内容</h3>
      <p class="hint">赛季结束后这些内容将被重置</p>
      <div class="exclusive-list">
        <div v-for="item in season.currentSeason.exclusiveItems" :key="item.id" class="exclusive-item">
          <span>{{ item.name }}</span>
          <span class="type">{{ item.type }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.season-header { padding: 20px; border-radius: 12px; color: white; margin-bottom: 20px; }
.season-header.fire { background: linear-gradient(135deg, #ef4444, #f97316); }
.season-header.ice { background: linear-gradient(135deg, #3b82f6, #06b6d4); }
.season-header.shadow { background: linear-gradient(135deg, #6b7280, #1f2937); }
.season-header.holy { background: linear-gradient(135deg, #f59e0b, #fbbf24); }
h2 { margin: 0 0 8px; }
.season-meta { display: flex; gap: 16px; font-size: 14px; opacity: 0.9; }
.progress-bar { height: 8px; background: rgba(255,255,255,0.2); border-radius: 4px; overflow: hidden; margin-top: 8px; }
.fill { height: 100%; background: white; transition: width 0.3s; }
.level-display { display: flex; justify-content: space-between; font-size: 18px; font-weight: bold; }
.reward-item, .exclusive-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  background: var(--color-bg-panel);
  border-radius: 8px;
  margin-bottom: 8px;
}
.level { min-width: 50px; font-weight: bold; }
.item { flex: 1; }
.owned { color: #4ade80; font-size: 14px; }
.locked { color: #666; font-size: 14px; }
button { padding: 6px 16px; background: var(--color-primary); color: white; border: none; border-radius: 6px; cursor: pointer; }
.type { font-size: 12px; color: var(--color-text-secondary); }
.hint { font-size: 12px; color: var(--color-text-secondary); margin-bottom: 12px; }
</style>
