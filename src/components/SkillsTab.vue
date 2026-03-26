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

function getSkillIcon(type: string): string {
  const icons: Record<string, string> = {
    damage: '⚔️',
    heal: '💚',
    buff: '💪',
    debuff: '💀',
    special: '✨'
  }
  return icons[type] || '🔮'
}
</script>

<template>
  <div class="skills-tab">
    <!-- 技能学习 -->
    <section class="skill-learn-panel">
      <h2>技能学习 <span class="skill-slot-count">技能槽: {{ skillSlots.length }}/5</span></h2>
      <div class="skill-learn-list">
        <div v-for="skill in availableSkillsForLearning.slice(0, 8)" :key="skill.id" class="skill-learn-item" :class="[`skill-type-${skill.type}`]">
          <div class="skill-card">
            <div class="skill-header">
              <span class="skill-icon">{{ getSkillIcon(skill.type) }}</span>
              <div class="skill-title">
                <span class="skill-name">{{ skill.name }}</span>
                <span class="skill-type-badge" :class="skill.type">{{ skill.type }}</span>
              </div>
            </div>
            
            <div class="skill-preview">
              <div class="skill-desc">{{ skill.description }}</div>
              <div class="skill-details">
                <div v-if="skill.damageMultiplier" class="detail-item">
                  <span class="detail-label">伤害倍率</span>
                  <span class="detail-value damage">{{ skill.damageMultiplier }}x</span>
                </div>
                <div v-if="skill.healPercent" class="detail-item">
                  <span class="detail-label">治疗百分比</span>
                  <span class="detail-value heal">{{ skill.healPercent }}%</span>
                </div>
                <div v-if="skill.buffEffect" class="detail-item">
                  <span class="detail-label">增益效果</span>
                  <span class="detail-value buff">{{ skill.buffEffect.stat }} +{{ skill.buffEffect.percentBoost }}%</span>
                </div>
                <div v-if="skill.cooldown" class="detail-item">
                  <span class="detail-label">冷却时间</span>
                  <span class="detail-value">{{ skill.cooldown }}秒</span>
                </div>
              </div>
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

/* 技能学习列表 */
.skill-learn-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 1rem;
  margin-top: 1rem;
  max-height: none;
  overflow: visible;
}

/* 技能卡片 */
.skill-learn-item {
  background: linear-gradient(145deg, rgba(30, 30, 50, 0.8), rgba(20, 20, 35, 0.9));
  border: 2px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  padding: 1rem;
  transition: all 0.3s ease;
  cursor: pointer;
  overflow: hidden;
}

.skill-learn-item:hover {
  transform: translateY(-5px) scale(1.02);
  border-color: rgba(102, 126, 234, 0.5);
  box-shadow: 0 10px 30px rgba(102, 126, 234, 0.2);
}

.skill-learn-item:hover .skill-preview {
  max-height: 200px;
  opacity: 1;
  margin-top: 0.8rem;
}

/* 不同类型技能边框颜色 */
.skill-type-damage {
  border-left: 4px solid #ff4444;
}
.skill-type-heal {
  border-left: 4px solid #44ff44;
}
.skill-type-buff {
  border-left: 4px solid #ffd700;
}
.skill-type-debuff {
  border-left: 4px solid #9966ff;
}
.skill-type-special {
  border-left: 4px solid #ff69b4;
}

/* 技能卡片头部 */
.skill-card .skill-header {
  display: flex;
  align-items: center;
  gap: 0.8rem;
}

.skill-icon {
  font-size: 2.5rem;
  filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.3));
}

.skill-title {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.skill-name {
  font-size: 1.1rem;
  font-weight: bold;
  color: white;
}

.skill-type-badge {
  display: inline-block;
  padding: 0.2rem 0.6rem;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: bold;
  width: fit-content;
}

.skill-type-badge.damage {
  background: rgba(255, 68, 68, 0.2);
  color: #ff4444;
  border: 1px solid rgba(255, 68, 68, 0.3);
}

.skill-type-badge.heal {
  background: rgba(68, 255, 68, 0.2);
  color: #44ff44;
  border: 1px solid rgba(68, 255, 68, 0.3);
}

.skill-type-badge.buff {
  background: rgba(255, 215, 0, 0.2);
  color: #ffd700;
  border: 1px solid rgba(255, 215, 0, 0.3);
}

.skill-type-badge.debuff {
  background: rgba(153, 102, 255, 0.2);
  color: #9966ff;
  border: 1px solid rgba(153, 102, 255, 0.3);
}

.skill-type-badge.special {
  background: rgba(255, 105, 180, 0.2);
  color: #ff69b4;
  border: 1px solid rgba(255, 105, 180, 0.3);
}

/* 技能预览 */
.skill-preview {
  max-height: 0;
  opacity: 0;
  overflow: hidden;
  transition: all 0.3s ease;
  margin-top: 0;
}

.skill-desc {
  font-size: 0.9rem;
  color: rgba(255, 255, 255, 0.8);
  margin-bottom: 0.8rem;
  line-height: 1.4;
}

.skill-details {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.detail-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.5rem;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 6px;
}

.detail-label {
  font-size: 0.85rem;
  color: rgba(255, 255, 255, 0.7);
}

.detail-value {
  font-size: 0.9rem;
  font-weight: bold;
}

.detail-value.damage {
  color: #ff4444;
}

.detail-value.heal {
  color: #44ff44;
}

.detail-value.buff {
  color: #ffd700;
}

/* 选择框 */
.skill-slot-select {
  width: 100%;
  padding: 0.6rem;
  background: rgba(102, 126, 234, 0.2);
  color: white;
  border: 1px solid rgba(102, 126, 234, 0.3);
  border-radius: 8px;
  font-size: 0.9rem;
  cursor: pointer;
  transition: all 0.2s;
  margin-top: 0.8rem;
}

.skill-slot-select:hover {
  background: rgba(102, 126, 234, 0.3);
  border-color: rgba(102, 126, 234, 0.5);
}

.skill-slot-select:focus {
  outline: none;
  border-color: rgba(102, 126, 234, 0.8);
  box-shadow: 0 0 10px rgba(102, 126, 234, 0.3);
}

.skill-slot-select option {
  background: #1e1e2f;
  color: white;
}

/* 响应式 */
@media (max-width: 600px) {
  .skill-learn-list {
    grid-template-columns: 1fr;
  }
}
</style>
