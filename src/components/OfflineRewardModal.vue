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
  background: rgba(2, 7, 17, 0.72);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 1rem;
  backdrop-filter: blur(8px);
}

.offline-modal {
  width: min(100%, 22rem);
  border: 1px solid var(--color-border);
  background: var(--gradient-panel);
  border-radius: var(--border-radius-lg);
  padding: 1.25rem;
  text-align: center;
  box-shadow: var(--shadow-lg);
}

.offline-modal h2 {
  margin: 0 0 0.35rem;
  color: var(--color-text-primary);
}

.offline-modal p {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.rewards {
  display: grid;
  gap: 0.5rem;
  margin: 1rem 0;
}

.reward-item {
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius-md);
  padding: 0.75rem;
  background: rgba(255, 255, 255, 0.045);
  color: var(--color-text-primary);
  font-size: var(--font-size-md);
}

button {
  width: 100%;
  border: 1px solid rgba(69, 230, 208, 0.34);
  border-radius: var(--border-radius-md);
  padding: 0.75rem;
  background: rgba(69, 230, 208, 0.16);
  color: var(--color-text-primary);
  font-size: var(--font-size-md);
  font-weight: 800;
  cursor: pointer;
}

@media (max-width: 560px) {
  .modal-overlay {
    align-items: flex-end;
    padding: 0;
  }

  .offline-modal {
    width: 100%;
    border-radius: var(--border-radius-lg) var(--border-radius-lg) 0 0;
    padding-bottom: calc(1.25rem + env(safe-area-inset-bottom));
  }
}
</style>
