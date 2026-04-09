<script setup lang="ts">
import { computed } from 'vue'
import { useSkillStore } from '../stores/skillStore'
import { PASSIVE_SKILLS } from '../types'

const skillStore = useSkillStore()

const slots = computed(() => {
  return PASSIVE_SKILLS.map((skill: typeof PASSIVE_SKILLS[number]) => ({
    ...skill,
    unlocked: skillStore.isPassiveUnlocked(skill.id)
  }))
})
</script>

<template>
  <div class="passive-skills-panel">
    <div class="grid">
      <div 
        v-for="slot in slots" 
        :key="slot.id"
        :class="['slot', { locked: !slot.unlocked }]"
      >
        <span v-if="!slot.unlocked" class="lock-icon">&#128274;</span>
        <span v-else class="skill-name">{{ slot.name }}</span>
        <span v-if="!slot.unlocked" class="condition">难度 {{ slot.unlockCondition }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.passive-skills-panel {
  padding: 8px;
}

.grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}

.slot {
  aspect-ratio: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  padding: 8px;
  font-size: 12px;
  border: 1px solid rgba(255, 255, 255, 0.2);
}

.slot.locked {
  opacity: 0.6;
  background: rgba(0, 0, 0, 0.2);
}

.lock-icon {
  font-size: 20px;
}

.skill-name {
  font-weight: bold;
  color: #ffd700;
}

.condition {
  font-size: 10px;
  color: #888;
  margin-top: 4px;
}
</style>
