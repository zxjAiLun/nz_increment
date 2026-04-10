<script setup lang="ts">
import { useStreakStore } from '../stores/streakStore'

const streak = useStreakStore()
</script>

<template>
  <div class="streak-tab">
    <h2>连续挑战</h2>
    <div class="streak-info">
      <div class="current">
        <span class="label">当前连续</span>
        <span class="value">{{ streak.currentStreak }} 天</span>
      </div>
      <div class="best">
        <span class="label">历史最高</span>
        <span class="value">{{ streak.bestStreak }} 天</span>
      </div>
      <div class="multiplier">
        <span class="label">加成倍率</span>
        <span class="value">x{{ streak.streakMultiplier.toFixed(2) }}</span>
      </div>
    </div>

    <div class="rewards">
      <h3>连续奖励</h3>
      <div v-for="reward in streak.STREAK_REWARDS" :key="reward.days" class="reward-item">
        <span class="days">{{ reward.days }}天</span>
        <span class="items">💎{{ reward.diamond }} 🪙{{ reward.gold }}</span>
        <button
          v-if="streak.currentStreak >= reward.days && !streak.streakRewardsClaimed.includes('streak_' + reward.days)"
          @click="streak.claimStreakReward(reward.days)">
          领取
        </button>
        <span v-else-if="streak.streakRewardsClaimed.includes('streak_' + reward.days)" class="claimed">已领取</span>
        <span v-else class="locked">未达成</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.streak-info {
  display: flex;
  gap: 16px;
  margin: 20px 0;
}
.current, .best, .multiplier {
  flex: 1;
  padding: 16px;
  background: var(--color-bg-panel);
  border-radius: 12px;
  text-align: center;
}
.label { font-size: 12px; color: var(--color-text-secondary); display: block; }
.value { font-size: 24px; font-weight: bold; }
.reward-item {
  display: flex;
  align-items: center;
  padding: 12px;
  background: var(--color-bg-panel);
  border-radius: 8px;
  margin-bottom: 8px;
  gap: 12px;
}
.days { font-weight: bold; min-width: 50px; }
.items { flex: 1; }
button { padding: 6px 16px; background: var(--color-primary); color: white; border: none; border-radius: 6px; }
.claimed { color: #4ade80; font-size: 14px; }
.locked { color: #666; font-size: 14px; }
</style>
