<script setup lang="ts">
import { PETS, PET_SKILLS } from '../data/pets'
import { usePetStore } from '../stores/petStore'

const pet = usePetStore()

function getRarityColor(rarity: string) {
  if (rarity === 'legend') return '#f59e0b'
  if (rarity === 'epic') return '#a855f7'
  if (rarity === 'rare') return '#4a9eff'
  return '#888'
}
</script>

<template>
  <div class="pet-tab">
    <h2>宠物伙伴</h2>

    <div class="equipped-pet" v-if="pet.equippedPet">
      <h3>已装备</h3>
      <div class="pet-card equipped" :style="{ borderColor: getRarityColor(pet.equippedPet.rarity) }">
        <div class="pet-name">{{ pet.equippedPet.name }}</div>
        <div class="pet-stage">阶段 {{ pet.equippedPet.currentStage }}/{{ pet.equippedPet.evolutionStages }}</div>
        <div class="pet-stats">
          <span>攻击: {{ pet.getStats(pet.equippedPet).attack }}</span>
          <span>防御: {{ pet.getStats(pet.equippedPet).defense }}</span>
          <span>HP: {{ pet.getStats(pet.equippedPet).maxHp }}</span>
        </div>
        <button @click="pet.unequipPet()">卸下</button>
      </div>
    </div>

    <div class="owned-pets">
      <h3>拥有宠物</h3>
      <div v-for="p in pet.ownedPets" :key="p.id" class="pet-card" :style="{ borderColor: getRarityColor(p.rarity) }">
        <div class="pet-name">{{ p.name }} <span class="rarity">{{ p.rarity }}</span></div>
        <div class="pet-stage">阶段 {{ p.currentStage }}/{{ p.evolutionStages }}</div>
        <div class="pet-skill">{{ (PET_SKILLS as any)[p.skillId]?.name }}</div>
        <div class="pet-stats">
          <span>攻{{ pet.getStats(p).attack }}</span>
          <span>防{{ pet.getStats(p).defense }}</span>
          <span>速{{ pet.getStats(p).speed }}</span>
        </div>
        <div class="actions">
          <button v-if="!pet.equippedPet" @click="pet.equipPet(p.id)">装备</button>
          <button v-if="p.currentStage < p.evolutionStages" @click="pet.evolvePet(p.id)">进化</button>
        </div>
      </div>
      <div v-if="pet.ownedPets.length === 0" class="empty">还没有宠物</div>
    </div>

    <div class="capture-section">
      <h3>捕捉</h3>
      <div class="capture-list">
        <div v-for="p in PETS.filter(p => !pet.ownedPets.some(o => o.id === p.id))" :key="p.id" class="capture-item">
          <span :style="{ color: getRarityColor(p.rarity) }">{{ p.name }}</span>
          <button @click="pet.capturePet(p.id)">捕捉</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pet-card {
  padding: 16px;
  background: var(--color-bg-panel);
  border-radius: 12px;
  border: 2px solid;
  margin-bottom: 12px;
}
.pet-name { font-weight: bold; font-size: 16px; }
.rarity { font-size: 12px; color: var(--color-text-secondary); margin-left: 8px; }
.pet-stage { font-size: 12px; color: var(--color-text-secondary); }
.pet-skill { font-size: 14px; color: #f59e0b; margin: 4px 0; }
.pet-stats { display: flex; gap: 12px; font-size: 12px; color: var(--color-text-secondary); margin: 8px 0; }
.actions { display: flex; gap: 8px; }
button { padding: 6px 16px; background: var(--color-primary); color: white; border: none; border-radius: 6px; cursor: pointer; }
.empty { text-align: center; padding: 20px; color: var(--color-text-secondary); }
.capture-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px;
  background: var(--color-bg-panel);
  border-radius: 8px;
  margin-bottom: 6px;
}
</style>
