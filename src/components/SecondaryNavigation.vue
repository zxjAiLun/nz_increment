<script setup lang="ts">
import type { SecondaryPageConfig, SecondaryPageId } from '../types/navigation'

defineProps<{
  pages: SecondaryPageConfig[]
  activePage: SecondaryPageId
}>()

const emit = defineEmits<{
  (e: 'select', page: SecondaryPageId): void
}>()
</script>

<template>
  <nav class="secondary-navigation">
    <button
      v-for="page in pages"
      :key="page.id"
      :class="{ active: activePage === page.id }"
      :data-tab="page.id === 'achievementReward' ? 'achievement' : page.id"
      @click="emit('select', page.id)"
    >
      {{ page.name }}
    </button>
  </nav>
</template>

<style scoped>
.secondary-navigation {
  display: flex;
  gap: 0.35rem;
  overflow-x: auto;
  padding: 0.45rem 0.5rem;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-bg-dark);
  scrollbar-width: none;
}

.secondary-navigation::-webkit-scrollbar {
  display: none;
}

.secondary-navigation button {
  flex: 0 0 auto;
  padding: 0.35rem 0.75rem;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  background: var(--color-bg-panel);
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.secondary-navigation button.active {
  color: var(--color-bg-dark);
  border-color: var(--color-primary);
  background: var(--color-primary);
}
</style>
