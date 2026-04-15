<script setup lang="ts">
import { TITLES } from '../data/titles'
import { useTitleStore } from '../stores/titleStore'

const titleStore = useTitleStore()

function getRarityClass(rarity: string) {
  return `rarity-${rarity}`
}
</script>

<template>
  <div class="title-tab">
    <h2>称号系统</h2>
    
    <div v-if="titleStore.equippedTitle" class="equipped">
      <p>当前装备: <strong>{{ TITLES.find(t => t.id === titleStore.equippedTitle)?.name }}</strong></p>
      <button @click="titleStore.unequipTitle()">卸下称号</button>
    </div>

    <div class="title-grid">
      <div v-for="title in TITLES" :key="title.id" 
           class="title-card" :class="[getRarityClass(title.rarity), { owned: titleStore.ownedTitles.includes(title.id) }]">
        <div class="title-name">{{ title.name }}</div>
        <div class="title-source">{{ title.source }}</div>
        <div class="title-req">{{ title.requirement }}</div>
        <div v-if="title.effect" class="title-effect">
          {{ title.effect.stat }}+{{ title.effect.value }}
        </div>
        <button v-if="titleStore.ownedTitles.includes(title.id) && titleStore.equippedTitle !== title.id"
                @click="titleStore.equipTitle(title.id)">
          装备
        </button>
        <span v-else-if="titleStore.equippedTitle === title.id" class="equipped-tag">已装备</span>
        <span v-else class="locked">未解锁</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.title-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 12px;
}
.title-card {
  padding: 16px;
  background: var(--color-bg-panel);
  border-radius: 12px;
  text-align: center;
}
.title-card.owned { border: 2px solid var(--color-primary); }
.rarity-common { color: #888; }
.rarity-rare { color: #4a9eff; }
.rarity-epic { color: #a855f7; }
.rarity-legend { color: #f59e0b; }
.title-name { font-size: 16px; font-weight: bold; margin-bottom: 4px; }
.title-source { font-size: 11px; color: var(--color-text-secondary); text-transform: uppercase; }
.title-req { font-size: 12px; margin: 6px 0; }
.title-effect { font-size: 14px; color: #4ade80; margin: 6px 0; }
button { padding: 6px 16px; background: var(--color-primary); color: white; border: none; border-radius: 6px; cursor: pointer; }
.equipped-tag { color: #4ade80; font-size: 12px; }
.locked { color: #666; font-size: 12px; }
</style>
