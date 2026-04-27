<script setup lang="ts">
import type { PrimaryTabConfig, PrimaryTabId } from '../types/navigation'

defineProps<{
  tabs: PrimaryTabConfig[]
  activeTab: PrimaryTabId
}>()

const emit = defineEmits<{
  (e: 'select', tab: PrimaryTabId): void
}>()

const tabDescriptions: Record<PrimaryTabId, string> = {
  adventure: '战斗 / 训练 / 战报',
  build: '装备 / 技能 / 加成',
  growth: '属性 / 命座 / 伙伴',
  challenge: '副本 / Boss / 事件',
  resources: '抽卡 / 商店 / 周常'
}
</script>

<template>
  <nav class="primary-navigation" aria-label="主模块导航">
    <button
      v-for="tab in tabs"
      :key="tab.id"
      :class="{ active: activeTab === tab.id }"
      :data-tab="tab.id === 'adventure' ? 'battle' : tab.id === 'build' ? 'inventory' : tab.id === 'resources' ? 'signin' : tab.id"
      @click="emit('select', tab.id)"
    >
      <span class="tab-icon" aria-hidden="true">{{ tab.icon }}</span>
      <span class="tab-copy">
        <span class="tab-name">{{ tab.name }}</span>
        <span class="tab-desc">{{ tabDescriptions[tab.id] }}</span>
      </span>
    </button>
  </nav>
</template>

<style scoped>
.primary-navigation {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 0.55rem;
  padding: 0.65rem;
  border-bottom: 1px solid var(--color-border);
  background: rgba(7, 10, 18, 0.56);
}

.primary-navigation button {
  min-width: 0;
  min-height: 4.1rem;
  display: flex;
  align-items: center;
  gap: 0.55rem;
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius-md);
  padding: 0.65rem;
  background: rgba(255, 255, 255, 0.045);
  color: var(--color-text-muted);
  cursor: pointer;
  text-align: left;
  transition: transform var(--transition-fast), border-color var(--transition-fast), background var(--transition-fast), color var(--transition-fast), box-shadow var(--transition-fast);
}

.primary-navigation button:hover {
  transform: translateY(-1px);
  color: var(--color-text-primary);
  border-color: var(--color-border-strong);
  background: rgba(255, 255, 255, 0.07);
}

.primary-navigation button.active {
  color: var(--color-text-primary);
  border-color: rgba(69, 230, 208, 0.5);
  background: linear-gradient(135deg, rgba(69, 230, 208, 0.15), rgba(143, 122, 255, 0.12));
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08), 0 0 26px rgba(69, 230, 208, 0.12);
}

.tab-icon {
  flex: 0 0 auto;
  width: 2rem;
  height: 2rem;
  display: grid;
  place-items: center;
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius-sm);
  background: rgba(255, 255, 255, 0.055);
  font-size: 1rem;
  line-height: 1;
}

.tab-copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.tab-name {
  font-size: var(--font-size-xs);
  font-weight: 800;
  color: var(--color-text-primary);
}

.tab-desc {
  color: var(--color-text-muted);
  font-size: 0.66rem;
  line-height: 1.25;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

@media (max-width: 980px) {
  .primary-navigation {
    display: flex;
    overflow-x: auto;
    scrollbar-width: none;
  }

  .primary-navigation::-webkit-scrollbar {
    display: none;
  }

  .primary-navigation button {
    flex: 0 0 9.5rem;
  }
}

@media (max-width: 560px) {
  .primary-navigation {
    position: fixed;
    left: 0.55rem;
    right: 0.55rem;
    bottom: calc(0.45rem + env(safe-area-inset-bottom));
    z-index: 900;
    gap: 0.4rem;
    padding: 0.5rem;
    border: 1px solid var(--color-border);
    border-radius: var(--border-radius-lg);
    background: rgba(10, 15, 28, 0.94);
    box-shadow: var(--shadow-lg);
    backdrop-filter: blur(22px);
  }

  .primary-navigation button {
    flex: 1 0 4.4rem;
    min-height: 3.35rem;
    justify-content: center;
    gap: 0.28rem;
    padding: 0.42rem 0.32rem;
    text-align: center;
  }

  .tab-icon {
    width: 1.7rem;
    height: 1.7rem;
    margin: 0 auto;
  }

  .tab-copy {
    align-items: center;
  }

  .tab-name {
    font-size: 0.66rem;
  }

  .tab-desc {
    display: none;
  }
}
</style>
