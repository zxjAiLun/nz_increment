<script setup lang="ts">
import { useTalentStore } from '../stores/talentStore'

const talent = useTalentStore()

function getTalentClass(t: any) {
  if (talent.isUnlocked(t.id)) return 'unlocked'
  if (talent.canUnlock(t.id)) return 'available'
  return 'locked'
}
</script>

<template>
  <div class="talent-tab">
    <div class="talent-header">
      <h2>天赋系统</h2>
      <div class="points">可用天赋点: {{ talent.talentPoints }}</div>
    </div>

    <div v-for="tier in [1,2,3,4,5]" :key="tier" class="tier-section">
      <h3>Tier {{ tier }}</h3>
      <div class="talent-grid">
        <div v-for="t in talent.getTalentsByTier(tier)" :key="t.id"
             class="talent-card" :class="getTalentClass(t)">
          <div class="talent-name">{{ t.name }}</div>
          <div class="talent-desc">{{ t.description }}</div>
          <div class="talent-cost">消耗: {{ t.cost }} 点</div>
          <button v-if="talent.isUnlocked(t.id)" disabled>已解锁</button>
          <button v-else-if="talent.canUnlock(t.id)" @click="talent.spendPoint(t.id)">加点</button>
          <span v-else class="need-prereq">需要前置</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.talent-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
.points { background: var(--color-primary); color: white; padding: 8px 16px; border-radius: 20px; font-weight: bold; }
.tier-section { margin-bottom: 24px; }
.tier-section h3 { font-size: 14px; color: var(--color-text-secondary); margin-bottom: 12px; }
.talent-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px; }
.talent-card {
  padding: 16px;
  background: var(--color-bg-panel);
  border-radius: 12px;
  border: 2px solid transparent;
}
.talent-card.unlocked { border-color: #4ade80; }
.talent-card.available { border-color: var(--color-primary); cursor: pointer; }
.talent-card.locked { opacity: 0.5; }
.talent-name { font-weight: bold; margin-bottom: 4px; }
.talent-desc { font-size: 12px; color: var(--color-text-secondary); margin-bottom: 8px; }
.talent-cost { font-size: 11px; color: #f59e0b; margin-bottom: 8px; }
button { width: 100%; padding: 8px; background: var(--color-primary); color: white; border: none; border-radius: 6px; cursor: pointer; }
button:disabled { background: #4ade80; cursor: default; }
.need-prereq { font-size: 12px; color: #ef4444; }
</style>
