<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Skill } from '../types'
import { usePlayerStore } from '../stores/playerStore'
import { usePetStore } from '../stores/petStore'
import { useTitleStore } from '../stores/titleStore'
import { TITLES } from '../data/titles'
import { getUnlockedSkills, createSkillInstance } from '../utils/skillSystem'
import type { AutoBuildRecommendation, BuildTarget } from '../types/navigation'

type StatsDelta = AutoBuildRecommendation['delta']

interface BuildSnapshot {
  skills: (Skill | null)[]
  titleId: string | null
  petId: string | null
}

const playerStore = usePlayerStore()
const petStore = usePetStore()
const titleStore = useTitleStore()

const selectedTarget = ref<BuildTarget>('push')
const recommendation = ref<AutoBuildRecommendation | null>(null)
const lastSnapshot = ref<BuildSnapshot | null>(null)
const statusMessage = ref('')

const targetLabels: Record<BuildTarget, string> = {
  push: '推图',
  idle: '挂机',
  boss: 'Boss',
  roguelike: '冒险模式'
}

const targetSummary: Record<BuildTarget, string> = {
  push: '偏向输出与推进速度，优先攻击/穿透/速度',
  idle: '偏向稳定挂机，优先防御/生命/续航',
  boss: '偏向单体爆发，优先暴击/穿透/高倍率技能',
  roguelike: '偏向均衡泛用，兼顾伤害与生存'
}

const availableSkills = computed(() => {
  const phase = playerStore.player.unlockedPhases[playerStore.player.unlockedPhases.length - 1] || 1
  return getUnlockedSkills(phase)
})

const skillNameMap = computed(() => new Map(availableSkills.value.map(s => [s.id, s.name])))

function cloneSkills(skills: (Skill | null)[]): (Skill | null)[] {
  return skills.map(skill => (skill ? { ...skill } : null))
}

function toTopSkills(skillIds: string[], limit: number): string[] {
  const result: string[] = []
  for (const id of skillIds) {
    if (!result.includes(id)) result.push(id)
    if (result.length >= limit) break
  }
  return result
}

function pickSkillIds(target: BuildTarget): string[] {
  const skills = availableSkills.value
  const damage = [...skills]
    .filter(skill => skill.type === 'damage')
    .sort((a, b) => ((b.damageMultiplier * b.hitCount + b.trueDamage / 100) - b.cooldown * 0.2) - ((a.damageMultiplier * a.hitCount + a.trueDamage / 100) - a.cooldown * 0.2))
    .map(skill => skill.id)
  const buff = [...skills]
    .filter(skill => skill.type === 'buff')
    .sort((a, b) => a.cooldown - b.cooldown)
    .map(skill => skill.id)
  const heal = skills.filter(skill => skill.type === 'heal').map(skill => skill.id)
  const slots = playerStore.player.skills.length

  if (target === 'idle') {
    return toTopSkills([...damage.slice(0, 2), ...buff.slice(0, 2), ...heal.slice(0, 1)], slots)
  }
  if (target === 'boss') {
    return toTopSkills([...damage.slice(0, 4), ...buff.slice(0, 1), ...heal.slice(0, 1)], slots)
  }
  if (target === 'roguelike') {
    return toTopSkills([...damage.slice(0, 3), ...buff.slice(0, 1), ...heal.slice(0, 1)], slots)
  }
  return toTopSkills([...damage.slice(0, 4), ...buff.slice(0, 1), ...heal.slice(0, 1)], slots)
}

function getStatWeight(target: BuildTarget): Record<string, number> {
  if (target === 'idle') {
    return { maxHp: 1.2, defense: 1.2, attack: 0.8, speed: 0.6, critRate: 0.4, penetration: 0.5 }
  }
  if (target === 'boss') {
    return { attack: 1.2, critRate: 1.3, penetration: 1.2, speed: 0.6, maxHp: 0.4, defense: 0.3 }
  }
  if (target === 'roguelike') {
    return { attack: 1, defense: 1, maxHp: 1, speed: 1, critRate: 0.8, penetration: 0.8 }
  }
  return { attack: 1.3, speed: 1.1, penetration: 1.1, critRate: 0.9, defense: 0.4, maxHp: 0.4 }
}

function getTitleScore(titleId: string, target: BuildTarget): number {
  const title = TITLES.find(t => t.id === titleId)
  if (!title?.effect) return 0
  const weights = getStatWeight(target)
  const first = (weights[title.effect.stat] || 0) * title.effect.value
  const second = title.effect.stat2 && title.effect.value2 ? (weights[title.effect.stat2] || 0) * title.effect.value2 : 0
  return first + second
}

function pickTitle(target: BuildTarget): string | undefined {
  const owned = titleStore.ownedTitles
  if (!owned.length) return undefined
  const best = [...owned].sort((a, b) => getTitleScore(b, target) - getTitleScore(a, target))[0]
  return best || undefined
}

function getPetScore(petId: string, target: BuildTarget): number {
  const pet = petStore.ownedPets.find(item => item.id === petId)
  if (!pet) return 0
  const stats = petStore.getStats(pet)
  const weights = getStatWeight(target)
  return (
    stats.attack * (weights.attack || 0) +
    stats.defense * (weights.defense || 0) +
    stats.maxHp * (weights.maxHp || 0) * 0.01 +
    stats.speed * (weights.speed || 0)
  )
}

function pickPet(target: BuildTarget): string | undefined {
  if (!petStore.ownedPets.length) return undefined
  const best = [...petStore.ownedPets]
    .sort((a, b) => getPetScore(b.id, target) - getPetScore(a.id, target))[0]
  return best?.id
}

function getTitleMainStats(titleId?: string): Partial<Record<'attack' | 'defense' | 'maxHp' | 'speed', number>> {
  if (!titleId) return {}
  const title = TITLES.find(item => item.id === titleId)
  const result: Partial<Record<'attack' | 'defense' | 'maxHp' | 'speed', number>> = {}
  if (!title?.effect) return result
  if (title.effect.stat === 'attack' || title.effect.stat === 'defense' || title.effect.stat === 'maxHp' || title.effect.stat === 'speed') {
    result[title.effect.stat] = title.effect.value
  }
  if (title.effect.stat2 && title.effect.value2 && (title.effect.stat2 === 'attack' || title.effect.stat2 === 'defense' || title.effect.stat2 === 'maxHp' || title.effect.stat2 === 'speed')) {
    result[title.effect.stat2] = (result[title.effect.stat2] || 0) + title.effect.value2
  }
  return result
}

function getPetMainStats(petId?: string): Partial<Record<'attack' | 'defense' | 'maxHp' | 'speed', number>> {
  if (!petId) return {}
  const pet = petStore.ownedPets.find(item => item.id === petId)
  if (!pet) return {}
  const stats = petStore.getStats(pet)
  return { attack: stats.attack, defense: stats.defense, maxHp: stats.maxHp, speed: stats.speed }
}

function calculateDelta(nextTitleId?: string, nextPetId?: string): StatsDelta {
  const currentTitleStats = getTitleMainStats(titleStore.equippedTitle || undefined)
  const currentPetStats = getPetMainStats(petStore.equippedPet?.id)
  const nextTitleStats = getTitleMainStats(nextTitleId)
  const nextPetStats = getPetMainStats(nextPetId)

  const attack = (nextTitleStats.attack || 0) + (nextPetStats.attack || 0) - (currentTitleStats.attack || 0) - (currentPetStats.attack || 0)
  const defense = (nextTitleStats.defense || 0) + (nextPetStats.defense || 0) - (currentTitleStats.defense || 0) - (currentPetStats.defense || 0)
  const maxHp = (nextTitleStats.maxHp || 0) + (nextPetStats.maxHp || 0) - (currentTitleStats.maxHp || 0) - (currentPetStats.maxHp || 0)
  const speed = (nextTitleStats.speed || 0) + (nextPetStats.speed || 0) - (currentTitleStats.speed || 0) - (currentPetStats.speed || 0)

  return { attack, defense, maxHp, speed }
}

function generateRecommendation() {
  const target = selectedTarget.value
  const skillIds = pickSkillIds(target)
  const titleId = pickTitle(target)
  const petId = pickPet(target)
  const equipmentIds = Object.values(playerStore.player.equipment).map(equip => equip?.id).filter((id): id is string => !!id)
  recommendation.value = {
    target,
    equipmentIds,
    skillIds,
    titleId,
    petId,
    summary: targetSummary[target],
    delta: calculateDelta(titleId, petId)
  }
  statusMessage.value = '已生成推荐方案，可以查看差异后一键应用。'
}

function applyRecommendation() {
  if (!recommendation.value) return

  lastSnapshot.value = {
    skills: cloneSkills(playerStore.player.skills),
    titleId: titleStore.equippedTitle,
    petId: petStore.equippedPet?.id || null
  }

  const skillById = new Map(availableSkills.value.map(skill => [skill.id, skill]))
  for (let i = 0; i < playerStore.player.skills.length; i++) {
    const nextSkillId = recommendation.value.skillIds[i]
    if (!nextSkillId) {
      playerStore.player.skills[i] = null
      continue
    }
    const skill = skillById.get(nextSkillId)
    playerStore.player.skills[i] = skill ? createSkillInstance(skill) : null
  }

  if (recommendation.value.titleId) {
    titleStore.equipTitle(recommendation.value.titleId)
  }
  if (recommendation.value.petId) {
    petStore.equipPet(recommendation.value.petId)
  }

  playerStore.saveGame()
  statusMessage.value = '自动构筑已应用。可随时撤销上次应用。'
}

function undoLastApply() {
  if (!lastSnapshot.value) return
  playerStore.player.skills = cloneSkills(lastSnapshot.value.skills)
  if (lastSnapshot.value.titleId) {
    titleStore.equipTitle(lastSnapshot.value.titleId)
  } else {
    titleStore.unequipTitle()
  }
  if (lastSnapshot.value.petId) {
    petStore.equipPet(lastSnapshot.value.petId)
  } else {
    petStore.unequipPet()
  }
  playerStore.saveGame()
  statusMessage.value = '已撤销上次自动构筑应用。'
  lastSnapshot.value = null
}
</script>

<template>
  <div class="auto-build-tab">
    <section class="build-section">
      <h2>自动构筑</h2>
      <p class="hint">选择目标模板后生成推荐，并支持一键应用与撤销。</p>
      <div class="target-grid">
        <button
          v-for="target in (Object.keys(targetLabels) as BuildTarget[])"
          :key="target"
          :class="{ active: selectedTarget === target }"
          @click="selectedTarget = target"
        >
          {{ targetLabels[target] }}
        </button>
      </div>
      <div class="action-row">
        <button class="primary-btn" @click="generateRecommendation">生成推荐</button>
        <button class="secondary-btn" :disabled="!recommendation" @click="applyRecommendation">一键应用</button>
        <button class="ghost-btn" :disabled="!lastSnapshot" @click="undoLastApply">撤销上次应用</button>
      </div>
      <p v-if="statusMessage" class="status">{{ statusMessage }}</p>
    </section>

    <section v-if="recommendation" class="build-section">
      <h3>构筑推荐</h3>
      <p class="summary">{{ recommendation.summary }}</p>
      <div class="recommend-grid">
        <div class="recommend-card">
          <div class="card-title">技能位推荐</div>
          <div v-for="(skillId, index) in recommendation.skillIds" :key="`${skillId}-${index}`" class="recommend-line">
            槽位 {{ index + 1 }}: {{ skillNameMap.get(skillId) || skillId }}
          </div>
        </div>
        <div class="recommend-card">
          <div class="card-title">装备与组件</div>
          <div class="recommend-line">称号: {{ recommendation.titleId || '不调整' }}</div>
          <div class="recommend-line">宠物: {{ recommendation.petId || '不调整' }}</div>
          <div class="recommend-line">装备槽位: {{ recommendation.equipmentIds.length }} 件沿用</div>
        </div>
      </div>
      <div class="delta-panel">
        <span>差异预估</span>
        <span>攻击 {{ recommendation.delta.attack && recommendation.delta.attack >= 0 ? '+' : '' }}{{ recommendation.delta.attack || 0 }}</span>
        <span>防御 {{ recommendation.delta.defense && recommendation.delta.defense >= 0 ? '+' : '' }}{{ recommendation.delta.defense || 0 }}</span>
        <span>生命 {{ recommendation.delta.maxHp && recommendation.delta.maxHp >= 0 ? '+' : '' }}{{ recommendation.delta.maxHp || 0 }}</span>
        <span>速度 {{ recommendation.delta.speed && recommendation.delta.speed >= 0 ? '+' : '' }}{{ recommendation.delta.speed || 0 }}</span>
      </div>
    </section>
  </div>
</template>

<style scoped>
.auto-build-tab {
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
}

.build-section {
  background: var(--color-bg-panel);
  border-radius: var(--border-radius-md);
  padding: 0.9rem;
}

.hint {
  color: var(--color-text-muted);
  margin-top: 0.35rem;
  font-size: var(--font-size-sm);
}

.target-grid {
  margin-top: 0.55rem;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.45rem;
}

.target-grid button,
.action-row button {
  border: none;
  border-radius: var(--border-radius-sm);
  padding: 0.5rem 0.65rem;
  cursor: pointer;
}

.target-grid button {
  background: var(--color-bg-dark);
  color: var(--color-text-secondary);
}

.target-grid button.active {
  background: var(--color-primary);
  color: var(--color-bg-dark);
  font-weight: 700;
}

.action-row {
  margin-top: 0.65rem;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.45rem;
}

.primary-btn {
  background: var(--color-primary);
  color: var(--color-bg-dark);
  font-weight: 700;
}

.secondary-btn {
  background: var(--color-secondary);
  color: #fff;
}

.ghost-btn {
  background: var(--color-bg-dark);
  color: var(--color-text-secondary);
}

.status {
  margin-top: 0.45rem;
  color: var(--color-accent);
  font-size: var(--font-size-sm);
}

.summary {
  margin-top: 0.35rem;
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
}

.recommend-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.45rem;
  margin-top: 0.55rem;
}

.recommend-card {
  background: var(--color-bg-dark);
  border-radius: var(--border-radius-sm);
  padding: 0.6rem;
}

.card-title {
  color: var(--color-text-primary);
  font-weight: 700;
  margin-bottom: 0.3rem;
}

.recommend-line {
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  margin: 0.15rem 0;
}

.delta-panel {
  margin-top: 0.6rem;
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 0.3rem;
}

.delta-panel span {
  background: var(--color-bg-dark);
  border-radius: var(--border-radius-sm);
  padding: 0.35rem 0.45rem;
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
}

@media (max-width: 720px) {
  .target-grid,
  .action-row,
  .recommend-grid,
  .delta-panel {
    grid-template-columns: 1fr;
  }
}
</style>

