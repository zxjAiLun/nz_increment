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
  <nav class="secondary-navigation" aria-label="当前模块页面导航">
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
  gap: 0.4rem;
  overflow-x: auto;
  padding: 0.55rem 0.65rem;
  border-bottom: 1px solid var(--color-border);
  background: rgba(7, 10, 18, 0.42);
  scrollbar-width: none;
}

.secondary-navigation::-webkit-scrollbar {
  display: none;
}

.secondary-navigation button {
  flex: 0 0 auto;
  min-height: 2rem;
  padding: 0.38rem 0.8rem;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.04);
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  font-weight: 700;
  cursor: pointer;
  transition: border-color var(--transition-fast), background var(--transition-fast), color var(--transition-fast);
}

.secondary-navigation button:hover {
  border-color: var(--color-border-strong);
  color: var(--color-text-primary);
  background: rgba(255, 255, 255, 0.07);
}

.secondary-navigation button.active {
  color: var(--color-secondary-light);
  border-color: rgba(69, 230, 208, 0.38);
  background: rgba(69, 230, 208, 0.12);
  box-shadow: inset 0 0 0 1px rgba(69, 230, 208, 0.1);
}

@media (max-width: 560px) {
  .secondary-navigation {
    padding: 0.45rem 0.5rem;
  }

  .secondary-navigation button {
    min-height: 1.85rem;
    padding: 0.3rem 0.65rem;
  }
}
</style>
