<script setup lang="ts">
import { computed, ref } from 'vue'
import { usePlayerStore } from '../stores/playerStore'
import { useMonsterStore } from '../stores/monsterStore'
import { useGameStore } from '../stores/gameStore'
import { formatNumber } from '../utils/format'
import BattleLog from './BattleLog.vue'
import type { Skill } from '../types'

const playerStore = usePlayerStore()
const monsterStore = useMonsterStore()
const gameStore = useGameStore()
const props = withDefaults(defineProps<{
  battleMode: 'main' | 'training'
  viewMode?: 'main' | 'report'
  buildSummary?: string
  buildTags?: string[]
}>(), {
  buildSummary: '',
  buildTags: () => []
})

const emit = defineEmits<{
  (e: 'useSkill', slotIndex: number): void
}>()

const showMonsterDetails = ref(false)

const activeMonster = computed(() => {
  if (props.battleMode === 'training') {
    return null
  }
  return monsterStore.currentMonster
})

const activeMonsterHpPercent = computed(() => {
  if (!activeMonster.value) return 0
  return (activeMonster.value.currentHp / activeMonster.value.maxHp) * 100
})

const skillSlots = computed(() => playerStore.player.skills)

// Performance: cache expensive computations called multiple times in template
const damageBreakdown = computed(() => gameStore.getDamageBreakdown())
const totalDamage = computed(() => gameStore.damageStats.totalDamage)
const recentBattleLog = computed(() => gameStore.battleEvents.slice(0, 10))

function getSkillCooldownPercent(skill: Skill | null): number {
  if (!skill) return 100
  if (skill.cooldown === 0) return 100
  return ((skill.cooldown - skill.currentCooldown) / skill.cooldown) * 100
}

function useSkill(slotIndex: number) {
  emit('useSkill', slotIndex)
}
</script>

<template>
  <div class="battle-tab">
    <!-- 怪物信息 -->
    <section v-if="props.viewMode !== 'report'" class="monster-panel">
      <div v-if="activeMonster" class="monster-info">
        <h3
          :class="{ boss: activeMonster.isBoss }"
          @click="showMonsterDetails = !showMonsterDetails"
        >
          {{ activeMonster.name }}
          <span v-if="activeMonster.isBoss" class="boss-tag">⚠ BOSS ⚠</span>
        </h3>
        <div class="monster-hp-bar">
          <div class="hp-fill" :style="{ width: activeMonsterHpPercent + '%' }"></div>
        </div>
        <div class="hp-text">
          HP: {{ formatNumber(activeMonster.currentHp) }} / {{ formatNumber(activeMonster.maxHp) }}
        </div>
        <div v-if="activeMonster.bossMechanic" class="boss-mechanic-card">
          <div class="mechanic-head">
            <span>{{ activeMonster.bossMechanic.name }}</span>
            <strong>{{ activeMonster.bossMechanic.feedback }}</strong>
          </div>
          <div class="mechanic-desc">{{ activeMonster.bossMechanic.description }}</div>
          <div class="mechanic-build">推荐构筑：{{ activeMonster.bossMechanic.recommendedBuild }}</div>
          <div v-if="activeMonster.bossState?.shield" class="mechanic-shield">
            当前护盾：{{ formatNumber(activeMonster.bossState.shield) }}
          </div>
        </div>
        <div v-if="showMonsterDetails" class="monster-details">
          <div class="detail-row">攻击: {{ formatNumber(activeMonster.attack) }}</div>
          <div class="detail-row">防御: {{ formatNumber(activeMonster.defense) }}</div>
          <div class="detail-row">速度: {{ formatNumber(activeMonster.speed) }}</div>
          <div v-if="activeMonster.critRate" class="detail-row">暴击率: {{ activeMonster.critRate.toFixed(1) }}%</div>
          <div v-if="activeMonster.critDamage" class="detail-row">暴击伤害: {{ activeMonster.critDamage.toFixed(1) }}%</div>
          <div v-if="activeMonster.critResist" class="detail-row">暴击抵抗: {{ activeMonster.critResist.toFixed(1) }}%</div>
          <div v-if="activeMonster.penetration" class="detail-row">穿透: {{ activeMonster.penetration.toFixed(1) }}</div>
          <div v-if="activeMonster.accuracy" class="detail-row">必中概率: {{ activeMonster.accuracy.toFixed(1) }}%</div>
          <div v-if="activeMonster.dodge" class="detail-row">闪避率: {{ activeMonster.dodge.toFixed(1) }}%</div>
        </div>
        <div v-else class="monster-stats">
          <div>攻击: {{ formatNumber(activeMonster.attack) }}</div>
          <div>防御: {{ formatNumber(activeMonster.defense) }}</div>
          <div>速度: {{ formatNumber(activeMonster.speed) }}</div>
        </div>
      </div>
      <div v-else class="monster-empty">
        正在生成怪物...
      </div>
    </section>

    <!-- 玩家状态 -->
    <section v-if="props.viewMode !== 'report'" class="player-status-panel">
      <h3>{{ playerStore.player.name }} Lv.{{ playerStore.player.level }}</h3>
      <div class="player-hp-bar">
        <div
          class="hp-fill player-hp"
          :style="{ width: ((playerStore.player.currentHp / playerStore.player.maxHp) * 100) + '%' }"
        ></div>
      </div>
      <div class="hp-text">
        HP: {{ formatNumber(playerStore.player.currentHp) }} / {{ formatNumber(playerStore.player.maxHp) }}
      </div>
      <div class="player-stats">
        攻击: {{ formatNumber(playerStore.totalStats.attack) }} |
        防御: {{ formatNumber(playerStore.totalStats.defense) }} |
        速度: {{ formatNumber(playerStore.totalStats.speed) }}
      </div>
    </section>

    <!-- 当前构筑摘要 -->
    <section v-if="props.viewMode !== 'report' && props.buildSummary" class="build-summary-panel">
      <h2>当前构筑摘要</h2>
      <p>{{ props.buildSummary }}</p>
      <div v-if="props.buildTags.length" class="build-tags">
        <span v-for="tag in props.buildTags" :key="tag" class="build-tag">{{ tag }}</span>
      </div>
    </section>

    <!-- 技能栏 -->
    <section v-if="props.viewMode !== 'report'" class="skill-panel">
      <h2>技能栏</h2>
      <div class="skill-slots">
        <div
          v-for="(skill, index) in skillSlots"
          :key="index"
          class="skill-slot"
          :class="{
            ready: skill && skill.currentCooldown <= 0,
            cooldown: skill && skill.currentCooldown > 0
          }"
          @click="skill && skill.currentCooldown <= 0 && gameStore.canPlayerAct && useSkill(index)"
        >
          <template v-if="skill">
            <div class="skill-name">{{ skill.name }}</div>
            <div class="skill-cooldown-bar">
              <div
                class="cooldown-fill"
                :style="{ width: getSkillCooldownPercent(skill) + '%' }"
              ></div>
            </div>
            <div class="skill-cooldown-text" v-if="skill.currentCooldown > 0">
              {{ skill.currentCooldown.toFixed(1) }}s
            </div>
          </template>
          <template v-else>
            <div class="skill-empty">空</div>
          </template>
        </div>
      </div>
    </section>

    <!-- 主界面关键反馈 -->
    <section v-if="props.viewMode !== 'report'" class="battle-feedback-panel">
      <h2>关键反馈</h2>
      <div class="damage-summary">
        <div class="damage-stat">
          <span class="stat-label">总伤害</span>
          <span class="stat-value">{{ formatNumber(gameStore.damageStats.totalDamage) }}</span>
        </div>
        <div class="damage-stat">
          <span class="stat-label">DPS</span>
          <span class="stat-value">{{ formatNumber(gameStore.getDPS()) }}</span>
        </div>
        <div class="damage-stat">
          <span class="stat-label">击杀</span>
          <span class="stat-value">{{ gameStore.damageStats.killCount }}</span>
        </div>
      </div>
    </section>

    <!-- 主战斗页日志 -->
    <section v-if="props.viewMode !== 'report'" class="battle-log-panel">
      <BattleLog :entries="recentBattleLog" :max-entries="8" @clear="gameStore.clearBattleLog" />
    </section>

    <!-- 伤害统计 -->
    <section v-if="props.viewMode === 'report'" class="damage-stats-panel">
      <h2>伤害统计</h2>
      <div class="damage-summary">
        <div class="damage-stat">
          <span class="stat-label">总伤害</span>
          <span class="stat-value">{{ formatNumber(gameStore.damageStats.totalDamage) }}</span>
        </div>
        <div class="damage-stat">
          <span class="stat-label">DPS</span>
          <span class="stat-value">{{ formatNumber(gameStore.getDPS()) }}</span>
        </div>
        <div class="damage-stat">
          <span class="stat-label">击杀</span>
          <span class="stat-value">{{ gameStore.damageStats.killCount }}</span>
        </div>
        <div class="damage-stat">
          <span class="stat-label">暴击</span>
          <span class="stat-value">{{ gameStore.damageStats.critCount }}</span>
        </div>
      </div>
      <div class="damage-breakdown">
        <div class="breakdown-bar">
          <div
            v-for="(item, index) in damageBreakdown"
            :key="index"
            class="breakdown-segment"
            :style="{
              width: (item.value / totalDamage * 100) + '%',
              backgroundColor: item.color
            }"
            :title="item.name + ': ' + formatNumber(item.value)"
          ></div>
        </div>
        <div class="breakdown-legend">
          <div
            v-for="(item, index) in damageBreakdown"
            :key="index"
            class="legend-item"
          >
            <span class="legend-color" :style="{ backgroundColor: item.color }"></span>
            <span class="legend-name">{{ item.name }}</span>
            <span class="legend-value">{{ formatNumber(item.value) }}</span>
          </div>
        </div>
      </div>
    </section>

    <!-- 战斗日志 -->
    <section v-if="props.viewMode === 'report'" class="battle-log-panel">
      <BattleLog :entries="recentBattleLog" :max-entries="10" @clear="gameStore.clearBattleLog" />
    </section>
  </div>
</template>

<style scoped>
.battle-tab {
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
}

.monster-panel {
  text-align: center;
  position: relative;
}

.monster-info h3 {
  color: var(--color-primary);
  margin-bottom: 0.5rem;
  cursor: pointer;
}

.monster-info h3.boss {
  color: var(--color-danger);
  text-shadow: 0 0 10px var(--color-danger);
}

.boss-tag {
  font-size: 0.7rem;
  color: var(--color-danger);
  margin-left: 0.3rem;
}

.monster-hp-bar {
  height: 20px;
  background: var(--color-bg-dark);
  border-radius: var(--border-radius-md);
  overflow: hidden;
  margin: 0.3rem 0;
}

.hp-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--color-primary), var(--color-primary-light));
  transition: width 0.1s;
}

.player-hp {
  background: linear-gradient(90deg, var(--color-secondary), var(--color-secondary-light));
}

.hp-text {
  font-size: var(--font-size-sm);
  color: var(--color-secondary);
}

.monster-stats {
  display: flex;
  justify-content: center;
  gap: 1rem;
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
  margin-top: 0.3rem;
}

.boss-mechanic-card {
  margin: 0.55rem auto 0;
  max-width: 30rem;
  padding: 0.65rem;
  border: 1px solid color-mix(in srgb, var(--color-danger) 55%, var(--color-border));
  border-radius: var(--border-radius-md);
  background: color-mix(in srgb, var(--color-bg-panel) 82%, var(--color-danger));
  text-align: left;
}

.mechanic-head {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
  color: var(--color-text-primary);
  font-weight: 800;
}

.mechanic-head strong {
  color: var(--color-danger);
  font-size: var(--font-size-xs);
}

.mechanic-desc,
.mechanic-build,
.mechanic-shield {
  margin-top: 0.25rem;
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
}

.mechanic-build,
.mechanic-shield {
  color: var(--color-primary);
}

.monster-details {
  background: var(--color-bg-dark);
  padding: 0.5rem;
  border-radius: var(--border-radius-sm);
  margin-top: 0.5rem;
  text-align: left;
}

.detail-row {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  padding: 0.15rem 0;
}

.monster-empty {
  padding: 2rem;
  color: var(--color-text-disabled);
}

.player-status-panel {
  text-align: center;
  background: var(--color-bg-panel);
  padding: 1rem;
  border-radius: var(--border-radius-md);
}

.player-status-panel h3 {
  color: var(--color-secondary);
}

.player-hp-bar {
  height: 16px;
  background: var(--color-bg-dark);
  border-radius: var(--border-radius-md);
  overflow: hidden;
  margin: 0.3rem 0;
}

.player-stats {
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
  margin-top: 0.3rem;
}

.build-summary-panel {
  background: var(--color-bg-panel);
  border-radius: var(--border-radius-md);
  padding: 0.8rem;
}

.build-summary-panel h2 {
  margin-bottom: 0.35rem;
}

.build-summary-panel p {
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  line-height: 1.4;
}

.skill-panel {
  text-align: center;
  background: var(--color-bg-panel);
  padding: 1rem;
  border-radius: var(--border-radius-md);
}

.skill-slots {
  display: flex;
  gap: 0.5rem;
  justify-content: center;
}

.skill-slot {
  width: 60px;
  height: 70px;
  background: var(--color-bg-dark);
  border: 2px solid var(--color-bg-card);
  border-radius: var(--border-radius-md);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  position: relative;
  overflow: hidden;
  transition: border-color var(--transition-fast);
}

.skill-slot.ready {
  border-color: var(--color-secondary);
}

.skill-slot.cooldown {
  opacity: 0.6;
}

.skill-name {
  font-size: var(--font-size-xs);
  color: var(--color-text-primary);
  text-align: center;
  padding: 0 0.2rem;
}

.skill-cooldown-bar {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 4px;
  background: var(--color-bg-card);
}

.cooldown-fill {
  height: 100%;
  background: var(--color-secondary);
}

.skill-cooldown-text {
  position: absolute;
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}

.skill-empty {
  color: var(--color-text-disabled);
  font-size: var(--font-size-sm);
}

.damage-stats-panel {
  background: var(--color-bg-panel);
  padding: 1rem;
  border-radius: var(--border-radius-md);
}

.damage-summary {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 0.8rem;
  flex-wrap: wrap;
}

.damage-stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  background: var(--color-bg-dark);
  padding: 0.5rem;
  border-radius: var(--border-radius-sm);
  flex: 1;
  min-width: 60px;
}

.stat-label {
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  margin-bottom: 0.2rem;
}

.stat-value {
  font-size: var(--font-size-md);
  color: var(--color-secondary);
  font-weight: bold;
}

.damage-breakdown {
  margin-top: 0.5rem;
}

.breakdown-bar {
  display: flex;
  height: 16px;
  border-radius: var(--border-radius-sm);
  overflow: hidden;
  background: var(--color-bg-dark);
}

.breakdown-segment {
  height: 100%;
  transition: width 0.3s;
  min-width: 2px;
}

.breakdown-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 0.5rem;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  font-size: var(--font-size-xs);
}

.legend-color {
  width: 10px;
  height: 10px;
  border-radius: 2px;
}

.legend-name {
  color: var(--color-text-secondary);
}

.legend-value {
  color: var(--color-secondary);
  font-weight: bold;
}

.battle-log-panel {
  background: var(--color-bg-panel);
  padding: 1rem;
  border-radius: var(--border-radius-md);
  max-height: 320px;
}

.battle-log {
  max-height: 260px;
  overflow-y: auto;
}

.log-entry {
  font-size: var(--font-size-sm);
  padding: 0.35rem 0.2rem;
  border-bottom: 1px solid var(--color-bg-dark);
  color: var(--color-text-secondary);
}

.log-entry.explainable {
  cursor: pointer;
}

.log-entry:first-child {
  color: var(--color-secondary);
}

.log-message {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
}

.explain-hint {
  flex: 0 0 auto;
  color: var(--color-primary);
  font-size: var(--font-size-xs);
}

.damage-explain {
  margin-top: 0.4rem;
  padding: 0.45rem;
  border-radius: var(--border-radius-sm);
  background: var(--color-bg-dark);
}

.explain-row {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.12rem 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.explain-row strong {
  color: var(--color-text-primary);
}
</style>
