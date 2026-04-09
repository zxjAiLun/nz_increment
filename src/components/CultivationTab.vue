<script setup lang="ts">
import { computed } from 'vue'
import { useCultivationStore } from '@/stores/cultivationStore'
import { CONSTELLATION_TREE } from '@/types/character'

const cultivation = useCultivationStore()

const stars = computed(() => {
  const level = cultivation.cultivation.starLevel
  return Array.from({ length: 6 }, (_, i) => i < level)
})

function toggleNode(i: number) {
  if (!cultivation.isNodeUnlocked(i + 1)) {
    cultivation.unlockConstellationNode(i + 1)
  }
}
</script>

<template>
  <div class="cultivation-tab">
    <h2>角色养成</h2>

    <div class="star-section">
      <h3>星级</h3>
      <div class="stars">
        <span v-for="(filled, i) in stars" :key="i" :class="{ active: filled }">
          {{ filled ? '★' : '☆' }}
        </span>
      </div>
      <p>星级倍率: {{ cultivation.starMultiplier.toFixed(2) }}x</p>
    </div>

    <div class="ascension-section">
      <h3>觉醒阶段: {{ cultivation.cultivation.ascensionPhase }}</h3>
      <p>觉醒加成: {{ cultivation.ascensionMultiplier.toFixed(2) }}x</p>
    </div>

    <div class="constellation-section">
      <h3>命座</h3>
      <div class="nodes">
        <div
          v-for="(node, i) in CONSTELLATION_TREE"
          :key="node.id"
          :class="['node', { unlocked: cultivation.isNodeUnlocked(i + 1) }]"
          @click="toggleNode(i)"
        >
          <span class="position">{{ i + 1 }}</span>
          <span class="name">{{ node.name }}</span>
          <span class="desc">{{ node.description }}</span>
          <span v-if="!cultivation.isNodeUnlocked(i + 1)" class="cost">
            {{ node.unlockCost.amount }} 碎片
          </span>
        </div>
      </div>
    </div>
  </div>
</template>
