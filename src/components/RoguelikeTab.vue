<script setup lang="ts">
import { computed } from 'vue'
import { useRoguelikeStore } from '../stores/roguelikeStore'
import type { Blessing } from '../types/roguelike'

const roguelike = useRoguelikeStore()

function start() {
  roguelike.startRun()
}

function pickBlessing(b: Blessing) {
  roguelike.selectBlessing(b)
  roguelike.advanceFloor()
}

const options = computed(() => roguelike.getRandomBlessings(3))
</script>

<template>
  <div class="roguelike-tab">
    <div v-if="roguelike.currentRun.status === 'active'" class="floor-info">
      <h2>第 {{ roguelike.currentRun.currentFloor }} 层</h2>
      <p>积分: {{ roguelike.currentRun.score }}</p>
    </div>

    <div v-if="!roguelike.currentRun.blessings.length" class="start-screen">
      <h2>Roguelike 模式</h2>
      <p>无限层地牢，随机祝福/诅咒/遗物</p>
      <button @click="start()">开始挑战</button>
    </div>

    <div v-else class="selection-phase">
      <h3>选择祝福</h3>
      <div class="blessing-grid">
        <div
          v-for="b in options"
          :key="b.id"
          class="blessing-card"
          @click="pickBlessing(b)"
        >
          <span class="rarity">{{ b.rarity }}</span>
          <span class="name">{{ b.name }}</span>
          <span class="desc">{{ b.description }}</span>
        </div>
      </div>
    </div>

    <div class="status-bar">
      <div>祝福: {{ roguelike.currentRun.blessings.length }}</div>
      <div>遗物: {{ roguelike.currentRun.relics.length }}</div>
      <div>诅咒: {{ roguelike.currentRun.curses.length }}</div>
    </div>
  </div>
</template>

<style scoped>
.blessing-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  padding: 16px;
}
.blessing-card {
  padding: 16px;
  background: var(--color-bg-panel);
  border-radius: 8px;
  cursor: pointer;
  text-align: center;
}
.blessing-card:hover {
  background: var(--color-bg-card);
}
.rarity {
  font-size: 11px;
  text-transform: uppercase;
  color: var(--color-accent);
}
.name {
  display: block;
  font-weight: bold;
  margin: 8px 0;
}
.status-bar {
  display: flex;
  gap: 16px;
  padding: 12px;
  background: var(--color-surface);
}
</style>
