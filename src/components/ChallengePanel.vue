<script setup lang="ts">
import { useChallengeStore } from '../stores/challengeStore'

const challengeStore = useChallengeStore()

function getRewardLabel(challenge: { reward: { gold?: number; diamond?: number; exp?: number } }) {
  const entry = challengeStore.getRewardEntry(challenge.reward)
  if (!entry) return ''
  if (entry.type === 'gold') return `${entry.amount}金币`
  if (entry.type === 'diamond') return `${entry.amount}钻石`
  if (entry.type === 'exp') return `${entry.amount}经验`
  return `${entry.amount}`
}

function claim(_challengeId: string) {
  challengeStore.checkCompletion()
}
</script>

<template>
  <div class="challenge-panel">
    <h3 class="challenge-title">每日挑战</h3>
    <div v-for="c in challengeStore.dailyChallenges" :key="c.id" class="challenge-item">
      <div class="challenge-info">
        <span class="challenge-name">{{ c.name }}</span>
        <span class="challenge-desc">{{ c.description }}</span>
      </div>
      <div class="challenge-progress">
        <span class="progress-text">{{ c.progress }}/{{ c.target }}</span>
        <template v-if="c.completed">
          <span class="claimed-label">已完成</span>
        </template>
        <template v-else>
          <button class="claim-btn" @click="claim(c.id)">
            领取 {{ getRewardLabel(c) }}
          </button>
        </template>
      </div>
    </div>

    <h3 class="challenge-title" style="margin-top: 16px;">每周挑战</h3>
    <div v-for="c in challengeStore.weeklyChallenges" :key="c.id" class="challenge-item">
      <div class="challenge-info">
        <span class="challenge-name">{{ c.name }}</span>
        <span class="challenge-desc">{{ c.description }}</span>
      </div>
      <div class="challenge-progress">
        <span class="progress-text">{{ c.progress }}/{{ c.target }}</span>
        <template v-if="c.completed">
          <span class="claimed-label">已完成</span>
        </template>
        <template v-else>
          <button class="claim-btn" @click="claim(c.id)">
            领取 {{ getRewardLabel(c) }}
          </button>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.challenge-panel {
  padding: 12px;
}

.challenge-title {
  margin: 0 0 8px 0;
  font-size: 14px;
  color: #ffd700;
}

.challenge-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px;
  margin-bottom: 6px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 6px;
  gap: 8px;
}

.challenge-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}

.challenge-name {
  font-size: 13px;
  color: #fff;
  font-weight: bold;
}

.challenge-desc {
  font-size: 11px;
  color: #aaa;
}

.challenge-progress {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  flex-shrink: 0;
}

.progress-text {
  font-size: 11px;
  color: #ccc;
}

.claim-btn {
  font-size: 11px;
  padding: 3px 8px;
  background: #ffd700;
  color: #000;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  white-space: nowrap;
}

.claim-btn:hover {
  background: #ffed4a;
}

.claimed-label {
  font-size: 11px;
  color: #888;
}
</style>
