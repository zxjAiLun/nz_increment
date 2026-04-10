<script setup lang="ts">
import { computed } from 'vue'
import { usePlayerStore } from '../stores/playerStore'
import { getUnlockedSkills } from '../utils/skillSystem'
import type { Skill } from '../types'

const playerStore = usePlayerStore()

const unlockedPhase = computed(() =>
  playerStore.player.unlockedPhases[playerStore.player.unlockedPhases.length - 1] || 1
)

const availableSkillsForLearning = computed(() =>
  getUnlockedSkills(unlockedPhase.value).filter(skill => {
    return !playerStore.player.skills.some(ps => ps && ps.id === skill.id)
  })
)

const skillSlots = computed(() => playerStore.player.skills)

function learnSkill(skill: Skill, slotIndex: number) {
  playerStore.learnSkill(skill, slotIndex)
}
</script>

<template>
  <div class="skills-tab">
    <!-- 技能学习 -->
    <section class="skill-learn-panel">
      <h2>技能学习 <span class="skill-slot-count">技能槽: {{ skillSlots.length }}/5</span></h2>
      <div class="skill-learn-list">
        <div v-for="skill in availableSkillsForLearning.slice(0, 8)" :key="skill.id" class="skill-learn-item">
          <div class="skill-header">
            <span class="skill-name">{{ skill.name }}</span>
            <span class="skill-type">{{ skill.type }}</span>
          </div>
          <div class="skill-desc">{{ skill.description }}</div>
          <div class="skill-stats" v-if="skill.damageMultiplier || skill.healAmount">
            <span v-if="skill.damageMultiplier">伤害: {{ skill.damageMultiplier }}x</span>
            <span v-if="skill.healAmount">治疗: {{ skill.healAmount }}</span>
          </div>
          <select
            class="skill-slot-select"
            @change="(e) => {
              const val = parseInt((e.target as HTMLSelectElement).value)
              if (val >= 0) learnSkill(skill, val)
              ;(e.target as HTMLSelectElement).value = ''
            }"
          >
            <option value="">选择槽位</option>
            <option v-for="(s, idx) in skillSlots" :key="idx" :value="idx">
              槽位{{ idx + 1 }} {{ s ? s.name : '空' }}
            </option>
          </select>
        </div>
      </div>
      <div class="skill-slot-info">
        <span class="slot-info-text">共 {{ skillSlots.length }} 个技能槽位</span>
      </div>
    </section>

    <!-- 技能说明 -->
    <section class="skill-info-panel">
      <h2>技能说明</h2>
      <div class="skill-info-content">
        <p>每个技能只能装备一次，共5个技能槽位。</p>
        <p>技能冷却结束后，点击技能栏即可释放。</p>
        <p>合理分配技能可以提高战斗效率。</p>
      </div>
    </section>
  </div>
</template>

<style scoped>
.skills-tab {
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
}

.skill-learn-panel,
.skill-info-panel {
  background: var(--color-bg-panel);
  padding: 1rem;
  border-radius: var(--border-radius-md);
}

.skill-slot-count {
  font-size: var(--font-size-sm);
  color: var(--color-secondary);
  font-weight: normal;
}

.skill-slot-info {
  margin-top: 0.5rem;
  text-align: center;
}

.slot-info-text {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.skill-learn-list {
  max-height: 300px;
  overflow-y: auto;
}

.skill-learn-item {
  display: flex;
  flex-direction: column;
  padding: 0.5rem;
  background: var(--color-bg-dark);
  border-radius: var(--border-radius-sm);
  margin-bottom: 0.4rem;
}

.skill-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.2rem;
}

.skill-name {
  color: var(--color-primary);
  font-weight: bold;
  font-size: var(--font-size-md);
}

.skill-type {
  color: var(--color-accent);
  font-size: var(--font-size-xs);
  background: var(--color-bg-card);
  padding: 0.1rem 0.3rem;
  border-radius: var(--border-radius-sm);
}

.skill-desc {
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  margin-bottom: 0.3rem;
}

.skill-stats {
  display: flex;
  gap: 1rem;
  font-size: var(--font-size-xs);
  color: var(--color-secondary);
  margin-bottom: 0.3rem;
}

.skill-slot-select {
  background: var(--color-bg-card);
  color: var(--color-text-primary);
  border: none;
  padding: 0.3rem;
  border-radius: var(--border-radius-sm);
  font-size: var(--font-size-sm);
  cursor: pointer;
}

.skill-slot-unlock {
  margin-top: 0.5rem;
  text-align: center;
}

.unlock-slot-btn {
  background: var(--color-accent);
  color: white;
  border: none;
  padding: 0.5rem 1rem;
  cursor: pointer;
  border-radius: var(--border-radius-sm);
  font-size: var(--font-size-sm);
  width: 100%;
  transition: background var(--transition-fast);
}

.unlock-slot-btn:hover:not(:disabled) {
  background: var(--color-accent-light);
}

.unlock-slot-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.skill-info-content {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  line-height: 1.6;
}

.skill-info-content p {
  margin-bottom: 0.3rem;
}
</style>
