<script setup lang="ts">
import { ref } from 'vue'
import { useAchievementStore } from '../stores/achievementStore'
import type { AchievementCategory } from '../types/achievement'

const achievementStore = useAchievementStore()

const categories: { id: AchievementCategory; name: string }[] = [
  { id: 'combat', name: '战斗' },
  { id: 'collection', name: '收集' },
  { id: 'challenge', name: '挑战' },
]

const activeCategory = ref<AchievementCategory>('combat')
</script>

<template>
  <div class="achievement-tab">
    <h2>成就</h2>

    <div class="category-tabs">
      <button
        v-for="cat in categories"
        :key="cat.id"
        :class="{ active: activeCategory === cat.id }"
        @click="activeCategory = cat.id"
      >
        {{ cat.name }}
      </button>
    </div>

    <div class="achievement-list">
      <div
        v-for="ach in achievementStore.getByCategory(activeCategory)"
        :key="ach.id"
        class="achievement-item"
        :class="{ unlocked: achievementStore.isUnlocked(ach.id) }"
      >
        <div class="ach-icon">{{ achievementStore.isUnlocked(ach.id) ? '🏆' : '🔒' }}</div>
        <div class="ach-info">
          <span class="ach-name">{{ ach.name }}</span>
          <span class="ach-desc">{{ ach.description }}</span>
        </div>
        <div class="ach-progress">{{ getProgress(ach) }}</div>
        <div class="ach-reward">
          <span v-if="ach.reward.diamond">💎 {{ ach.reward.diamond }}</span>
          <span v-if="ach.reward.title">称号</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.category-tabs {
  display: flex;
  gap: 8px;
  margin: 12px 0;
}
.category-tabs button {
  padding: 8px 16px;
  background: var(--color-bg-panel);
  border: none;
  border-radius: 8px;
  cursor: pointer;
  color: var(--color-text);
}
.category-tabs button.active {
  background: var(--color-primary);
  color: white;
}
.achievement-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  background: var(--color-bg-panel);
  border-radius: 8px;
  margin-bottom: 8px;
}
.achievement-item.unlocked {
  border-left: 3px solid var(--color-accent);
}
.ach-icon {
  font-size: 24px;
}
.ach-info {
  flex: 1;
}
.ach-name {
  display: block;
  font-weight: bold;
}
.ach-desc {
  font-size: 12px;
  color: var(--color-text-muted);
}
</style>
