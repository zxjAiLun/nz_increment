<script setup lang="ts">
import { computed } from 'vue'
import { usePlayerStore } from '../stores/playerStore'
import { useSkillStore } from '../stores/skillStore'
import { usePetStore } from '../stores/petStore'
import { calculateActiveSets } from '../utils/equipmentSetCalculator'
import TitleTab from './TitleTab.vue'

const playerStore = usePlayerStore()
const skillStore = useSkillStore()
const petStore = usePetStore()

const activeSetBonuses = computed(() => calculateActiveSets(playerStore.player.equipment))
const equippedPetStats = computed(() => {
  if (!petStore.equippedPet) return null
  return petStore.getStats(petStore.equippedPet)
})
</script>

<template>
  <div class="build-bonus-tab">
    <section class="bonus-section">
      <h2>当前生效加成</h2>
      <div class="bonus-grid">
        <div class="bonus-item">
          <span class="bonus-label">激活套装</span>
          <span class="bonus-value">{{ activeSetBonuses.length }}</span>
        </div>
        <div class="bonus-item">
          <span class="bonus-label">已解锁被动</span>
          <span class="bonus-value">{{ skillStore.passiveSkills.length }}</span>
        </div>
        <div class="bonus-item">
          <span class="bonus-label">宠物加成</span>
          <span class="bonus-value">{{ petStore.equippedPet ? petStore.equippedPet.name : '未装备' }}</span>
        </div>
      </div>
    </section>

    <section class="bonus-section">
      <h3>套装效果</h3>
      <div v-if="activeSetBonuses.length === 0" class="empty-panel">未激活套装效果</div>
      <div v-else class="set-list">
        <div v-for="setBonus in activeSetBonuses" :key="`${setBonus.setId}-${setBonus.tier}`" class="set-card">
          <div class="set-title">{{ setBonus.setName }} ({{ setBonus.tier }}件)</div>
          <div class="set-effect">{{ setBonus.effect.description }}</div>
        </div>
      </div>
    </section>

    <section class="bonus-section">
      <h3>被动技能</h3>
      <div v-if="skillStore.passiveSkills.length === 0" class="empty-panel">暂无已解锁被动技能</div>
      <div v-else class="passive-list">
        <div v-for="passive in skillStore.passiveSkills" :key="passive.id" class="passive-card">
          <div class="passive-name">{{ passive.name }}</div>
          <div class="passive-desc">{{ passive.description }}</div>
        </div>
      </div>
    </section>

    <section class="bonus-section">
      <h3>宠物上阵加成</h3>
      <div v-if="!petStore.equippedPet || !equippedPetStats" class="empty-panel">未上阵宠物</div>
      <div v-else class="pet-bonus-card">
        <div class="pet-name">{{ petStore.equippedPet.name }}</div>
        <div class="pet-stats">
          <span>攻击 +{{ equippedPetStats.attack }}</span>
          <span>防御 +{{ equippedPetStats.defense }}</span>
          <span>生命 +{{ equippedPetStats.maxHp }}</span>
          <span>速度 +{{ equippedPetStats.speed }}</span>
        </div>
      </div>
    </section>

    <section class="bonus-section">
      <TitleTab />
    </section>
  </div>
</template>

<style scoped>
.build-bonus-tab {
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
}

.bonus-section {
  background: var(--color-bg-panel);
  border-radius: var(--border-radius-md);
  padding: 0.9rem;
}

.bonus-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.5rem;
  margin-top: 0.5rem;
}

.bonus-item {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  padding: 0.55rem;
  background: var(--color-bg-dark);
  border-radius: var(--border-radius-sm);
}

.bonus-label {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.bonus-value {
  color: var(--color-text-primary);
  font-weight: 700;
  font-size: var(--font-size-sm);
}

.empty-panel {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  padding: 0.5rem;
}

.set-list,
.passive-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.45rem;
  margin-top: 0.45rem;
}

.set-card,
.passive-card,
.pet-bonus-card {
  background: var(--color-bg-dark);
  border-radius: var(--border-radius-sm);
  padding: 0.6rem;
}

.set-title,
.passive-name,
.pet-name {
  color: var(--color-text-primary);
  font-weight: 700;
  margin-bottom: 0.2rem;
}

.set-effect,
.passive-desc {
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
}

.pet-stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.35rem;
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
}

@media (max-width: 720px) {
  .bonus-grid,
  .set-list,
  .passive-list,
  .pet-stats {
    grid-template-columns: 1fr;
  }
}
</style>

