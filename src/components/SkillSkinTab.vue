<script setup lang="ts">
import { SKILL_SKINS } from '../data/skillSkins'
import { useSkillSkinStore } from '../stores/skillSkinStore'

const skinStore = useSkillSkinStore()

function getRarityClass(rarity: string) {
  return `rarity-${rarity}`
}

function getUnlockLabel(skin: any) {
  if (skin.unlockType === 'purchase') return `${skin.cost} 金币`
  if (skin.unlockType === 'reputation') return `声望 Lv.${skin.reputationLevel}`
  if (skin.unlockType === 'achievement') return '成就解锁'
  if (skin.unlockType === 'battlePass') return '战令限定'
  return ''
}
</script>

<template>
  <div class="skill-skin-tab">
    <h2>技能皮肤</h2>
    
    <div class="skin-grid">
      <div v-for="skin in SKILL_SKINS" :key="skin.id" 
           class="skin-card" :class="[getRarityClass(skin.rarity), { owned: skinStore.isOwned(skin.id) }]">
        <div class="skin-color" :style="{ background: skin.effectColor }"></div>
        <div class="skin-name">{{ skin.name }}</div>
        <div class="skin-desc">{{ skin.description }}</div>
        <div class="skin-unlock">{{ getUnlockLabel(skin) }}</div>
        
        <button v-if="skinStore.isOwned(skin.id)" 
                @click="skinStore.equipSkin(skin.skillId, skin.id)">
          装备
        </button>
        <button v-else-if="skin.unlockType === 'purchase'"
                @click="skinStore.unlockSkin(skin.id)">
          解锁
        </button>
        <span v-else class="locked">未解锁</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.skin-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 12px;
}
.skin-card {
  padding: 16px;
  background: var(--color-bg-panel);
  border-radius: 12px;
  text-align: center;
}
.skin-card.owned { border: 2px solid var(--color-primary); }
.skin-color {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  margin: 0 auto 12px;
}
.skin-name { font-size: 15px; font-weight: bold; }
.skin-desc { font-size: 12px; color: var(--color-text-secondary); margin: 6px 0; }
.skin-unlock { font-size: 11px; color: #f59e0b; margin-bottom: 8px; }
button { padding: 6px 16px; background: var(--color-primary); color: white; border: none; border-radius: 6px; cursor: pointer; }
.locked { color: #666; font-size: 12px; }
.rarity-common { color: #888; }
.rarity-rare { color: #4a9eff; }
.rarity-epic { color: #a855f7; }
.rarity-legend { color: #f59e0b; }
</style>
