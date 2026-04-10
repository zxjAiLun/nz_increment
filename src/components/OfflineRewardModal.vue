<script setup lang="ts">
import { usePlayerStore } from '../stores/playerStore'

const props = defineProps<{ offlineData: { gold: number; exp: number; minutes: number } }>()
const emit = defineEmits<{ close: [] }>()
const playerStore = usePlayerStore()

function claim() {
  playerStore.addGold(props.offlineData.gold)
  playerStore.addExperience(props.offlineData.exp)
  emit('close')
}
</script>

<template>
  <div class="modal-overlay" @click.self="claim()">
    <div class="offline-modal">
      <h2>离线收益</h2>
      <p>离线 {{ offlineData.minutes }} 分钟</p>
      <div class="rewards">
        <div class="reward-item">🪙 {{ offlineData.gold }} 金币</div>
        <div class="reward-item">✨ {{ offlineData.exp }} 经验</div>
      </div>
      <button @click="claim()">领取奖励</button>
    </div>
  </div>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.8);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.offline-modal {
  background: var(--color-surface);
  border-radius: 16px;
  padding: 32px;
  text-align: center;
  max-width: 320px;
}
.rewards {
  margin: 24px 0;
}
.reward-item {
  padding: 12px;
  background: var(--color-bg-panel);
  border-radius: 8px;
  margin-bottom: 8px;
  font-size: 18px;
}
button {
  width: 100%;
  padding: 14px;
  background: var(--color-primary);
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 16px;
}
</style>
