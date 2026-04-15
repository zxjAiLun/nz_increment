<script setup lang="ts">
import { RECYCLE_MATERIALS } from '../data/recycleMaterials'
import { useRecycleStore } from '../stores/recycleStore'

const recycle = useRecycleStore()

function getRarityClass(rarity: string) {
  return `rarity-${rarity}`
}

function getSourcesForRarity(_rarity: string) {
  return RECYCLE_MATERIALS.filter(m => m.rarity === 'common')
}
</script>

<template>
  <div class="recycle-tab">
    <h2>装备回收</h2>
    <p class="hint">分解多余装备获得材料，用于合成更稀有物品</p>

    <div class="materials">
      <h3>背包材料</h3>
      <div class="material-grid">
        <div v-for="mat in RECYCLE_MATERIALS" :key="mat.id"
             class="material-item" :class="getRarityClass(mat.rarity)">
          <span class="icon">{{ mat.icon }}</span>
          <span class="name">{{ mat.name }}</span>
          <span class="count">x{{ recycle.getMaterialCount(mat.id) }}</span>
        </div>
      </div>
    </div>

    <div class="craft-section">
      <h3>材料合成</h3>
      <div class="craft-list">
        <div v-for="mat in RECYCLE_MATERIALS.filter(m => m.rarity !== 'common')"
             :key="mat.id" class="craft-item">
          <span class="icon">{{ mat.icon }}</span>
          <span class="name">{{ mat.name }}</span>
          <span class="cost">消耗 3x {{ getSourcesForRarity(mat.rarity).map((s: any) => s.name).join(' + ') }}</span>
          <button v-if="recycle.canCraft(mat.id)" @click="recycle.craft(mat.id)">合成</button>
          <span v-else class="locked">材料不足</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.material-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  margin: 12px 0;
}
.material-item {
  padding: 12px;
  background: var(--color-bg-panel);
  border-radius: 8px;
  text-align: center;
}
.icon { font-size: 24px; display: block; }
.name { font-size: 12px; display: block; margin: 4px 0; }
.count { font-size: 14px; font-weight: bold; color: var(--color-primary); }
.craft-list { display: flex; flex-direction: column; gap: 8px; }
.craft-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  background: var(--color-bg-panel);
  border-radius: 8px;
}
.cost { flex: 1; font-size: 12px; color: var(--color-text-secondary); }
button { padding: 6px 16px; background: var(--color-primary); color: white; border: none; border-radius: 6px; }
.locked { color: #666; font-size: 14px; }
.rarity-common { border-left: 3px solid #888; }
.rarity-rare { border-left: 3px solid #4a9eff; }
.rarity-epic { border-left: 3px solid #a855f7; }
.rarity-legend { border-left: 3px solid #f59e0b; }
</style>
