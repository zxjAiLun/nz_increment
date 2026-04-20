<script setup lang="ts">
import type { PrimaryTabConfig, PrimaryTabId } from '../types/navigation'

defineProps<{
  tabs: PrimaryTabConfig[]
  activeTab: PrimaryTabId
}>()

const emit = defineEmits<{
  (e: 'select', tab: PrimaryTabId): void
}>()
</script>

<template>
  <nav class="primary-navigation">
    <button
      v-for="tab in tabs"
      :key="tab.id"
      :class="{ active: activeTab === tab.id }"
      :data-tab="tab.id === 'adventure' ? 'battle' : tab.id === 'build' ? 'inventory' : tab.id === 'resources' ? 'signin' : tab.id"
      @click="emit('select', tab.id)"
    >
      <span class="tab-icon">{{ tab.icon }}</span>
      <span class="tab-name">{{ tab.name }}</span>
    </button>
  </nav>
</template>

<style scoped>
.primary-navigation {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 0.4rem;
  padding: 0.5rem;
  background: var(--color-bg-panel);
  border-bottom: 1px solid var(--color-border);
}

.primary-navigation button {
  min-height: 3rem;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 0.1rem;
  border: 1px solid transparent;
  border-radius: 0.6rem;
  background: var(--color-bg-card);
  color: var(--color-text-muted);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.primary-navigation button:hover {
  color: var(--color-text-primary);
}

.primary-navigation button.active {
  color: var(--color-primary);
  border-color: var(--color-primary);
  background: color-mix(in srgb, var(--color-primary) 12%, var(--color-bg-card));
}

.tab-icon {
  font-size: 1rem;
  line-height: 1;
}

.tab-name {
  font-size: var(--font-size-xs);
  font-weight: 700;
}

@media (max-width: 720px) {
  .primary-navigation {
    gap: 0.3rem;
    padding: 0.4rem;
  }

  .primary-navigation button {
    min-height: 2.7rem;
  }
}
</style>
