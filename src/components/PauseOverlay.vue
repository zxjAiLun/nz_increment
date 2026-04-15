<script setup lang="ts">
import { useGameStore } from '../stores/gameStore'

const gameStore = useGameStore()
</script>

<template>
  <div v-if="gameStore.isPaused" class="paused-overlay">
    <div class="paused-content">
      <h2>游戏暂停</h2>
      <button @click="gameStore.togglePause()">继续</button>
    </div>
  </div>
</template>

<style scoped>
@import '../styles/design-system.css';

.paused-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.8);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
}

.paused-content {
  background: var(--color-bg-panel);
  padding: 2rem;
  border-radius: var(--border-radius-lg);
  text-align: center;
}

.paused-content h2 {
  color: var(--color-primary);
  margin-bottom: 1rem;
}

.paused-content button {
  background: var(--color-primary);
  color: white;
  border: none;
  padding: 0.5rem 2rem;
  cursor: pointer;
  border-radius: var(--border-radius-sm);
  font-size: var(--font-size-md);
  margin-top: 1rem;
}
</style>
