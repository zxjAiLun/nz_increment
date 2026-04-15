<script setup lang="ts">
import { BATTLE_SPEEDS } from '../data/battleSpeed'
import { useBattleSpeedStore } from '../stores/battleSpeedStore'

const speed = useBattleSpeedStore()
</script>

<template>
  <div class="battle-speed-control">
    <div class="speed-buttons">
      <button 
        v-for="s in BATTLE_SPEEDS" 
        :key="s.multiplier"
        :class="{ active: speed.speedMultiplier === s.multiplier }"
        @click="speed.setSpeed(s.multiplier)">
        {{ s.label }}
      </button>
    </div>

    <button 
      class="auto-btn" 
      :class="{ active: speed.autoMode }"
      @click="speed.toggleAuto()">
      {{ speed.autoMode ? '自动: ON' : '自动: OFF' }}
    </button>

    <div class="skip-tickets">
      <span>跳过券: {{ speed.skipTickets }}</span>
      <button 
        v-if="speed.skipTickets > 0"
        @click="speed.useSkipTicket()">
        使用跳过
      </button>
    </div>
  </div>
</template>

<style scoped>
.battle-speed-control {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 16px;
  background: var(--color-bg-panel);
  border-radius: 8px;
}
.speed-buttons {
  display: flex;
  gap: 4px;
}
.speed-buttons button {
  padding: 6px 12px;
  border: 1px solid var(--color-border);
  background: transparent;
  border-radius: 4px;
  cursor: pointer;
}
.speed-buttons button.active {
  background: var(--color-primary);
  color: white;
  border-color: var(--color-primary);
}
.auto-btn {
  padding: 6px 12px;
  border: 1px solid var(--color-border);
  background: transparent;
  border-radius: 4px;
  cursor: pointer;
}
.auto-btn.active {
  background: #4ade80;
  color: white;
  border-color: #4ade80;
}
.skip-tickets {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}
.skip-tickets span { font-size: 14px; }
.skip-tickets button {
  padding: 4px 10px;
  background: #f59e0b;
  color: white;
  border: none;
  border-radius: 4px;
  font-size: 12px;
}
</style>
