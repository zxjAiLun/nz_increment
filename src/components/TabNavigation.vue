<script setup lang="ts">
export interface TabItem {
  id: string
  name: string
  icon: string
}

defineProps<{
  tabs: TabItem[]
  activeTab: string
}>()

const emit = defineEmits<{
  (e: 'update:activeTab', tabId: string): void
}>()

function selectTab(tabId: string) {
  emit('update:activeTab', tabId)
}
</script>

<template>
  <nav class="tab-navigation">
    <button
      v-for="tab in tabs"
      :key="tab.id"
      :class="{ active: activeTab === tab.id }"
      @click="selectTab(tab.id)"
    >
      <span class="tab-icon">{{ tab.icon }}</span>
      <span class="tab-name">{{ tab.name }}</span>
    </button>
  </nav>
</template>

<style scoped>
.tab-navigation {
  display: flex;
  background: var(--color-bg-panel);
  border-bottom: 1px solid var(--color-bg-card);
  overflow-x: auto;
  scrollbar-width: none;
}

.tab-navigation::-webkit-scrollbar {
  display: none;
}

.tab-navigation button {
  flex: 1;
  min-width: 70px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.15rem;
  padding: 0.5rem 0.3rem;
  background: transparent;
  color: var(--color-text-muted);
  border: none;
  cursor: pointer;
  transition: all var(--transition-fast);
  position: relative;
  border-bottom: 2px solid transparent;
}

.tab-navigation button:hover {
  background: var(--color-bg-card);
  color: var(--color-text-secondary);
}

.tab-navigation button.active {
  color: var(--color-primary);
  border-bottom-color: var(--color-primary);
  background: var(--color-bg-card);
}

.tab-icon {
  font-size: 1.2rem;
}

.tab-name {
  font-size: var(--font-size-xs);
  font-weight: 500;
}
</style>
