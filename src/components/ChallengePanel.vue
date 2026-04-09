<script setup lang="ts">
import { useChallengeStore } from '../stores/challengeStore'
import { usePlayerStore } from '../stores/playerStore'

const challengeStore = useChallengeStore()
const playerStore = usePlayerStore()

function getProgress(challengeId: string) {
  return challengeStore.getProgress(challengeId)
}

function getRewardLabel(reward: { type: string; amount: number }) {
  if (reward.type === 'gold') return `${reward.amount}金币`
  if (reward.type === 'diamond') return `${reward.amount}钻石`
  if (reward.type === 'exp') return `${reward.amount}经验`
  return `${reward.amount}`
}

function claim(challengeId: string) {
  const reward = challengeStore.claimReward(challengeId)
  if (!reward) return
  if (reward.type === 'gold') playerStore.addGold(reward.amount)
  if (reward.type === 'diamond') playerStore.addDiamond(reward.amount)
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
        <span class="progress-text">
          {{ getProgress(c.id)?.progress ?? 0 }}/{{ c.condition.target }}
        </span>
        <template v-if="getProgress(c.id)?.completed && !getProgress(c.id)?.claimed">
          <button class="claim-btn" @click="claim(c.id)">
            领取 {{ getRewardLabel(c.reward) }}
          </button>
        </template>
        <span v-else-if="getProgress(c.id)?.claimed" class="claimed-label">已领取</span>
      </div>
    </div>

    <h3 class="challenge-title" style="margin-top: 16px;">每周挑战</h3>
    <div v-for="c in challengeStore.weeklyChallenges" :key="c.id" class="challenge-item">
      <div class="challenge-info">
        <span class="challenge-name">{{ c.name }}</span>
        <span class="challenge-desc">{{ c.description }}</span>
      </div>
      <div class="challenge-progress">
        <span class="progress-text">
          {{ getProgress(c.id)?.progress ?? 0 }}/{{ c.condition.target }}
        </span>
        <template v-if="getProgress(c.id)?.completed && !getProgress(c.id)?.claimed">
          <button class="claim-btn" @click="claim(c.id)">
            领取 {{ getRewardLabel(c.reward) }}
          </button>
        </template>
        <span v-else-if="getProgress(c.id)?.claimed" class="claimed-label">已领取</span>
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
