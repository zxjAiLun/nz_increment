<script setup lang="ts">
import { computed } from 'vue'
import { usePlayerStore } from '../stores/playerStore'
import { useMonsterStore } from '../stores/monsterStore'
import { useGameStore } from '../stores/gameStore'
import { useATBStore } from '../stores/atbStore'
import { useTrainingStore } from '../stores/trainingStore'
import { useNavigationStore } from '../stores/navigationStore'
import { formatNumber } from '../utils/format'
import { estimateCombatKpis, getMainlineGuidance } from '../utils/combatInsights'
import type { TrainingDifficulty } from '../stores/trainingStore'

const playerStore = usePlayerStore()
const monsterStore = useMonsterStore()
const gameStore = useGameStore()
const atbStore = useATBStore()
const trainingStore = useTrainingStore()
const nav = useNavigationStore()

const props = defineProps<{
  battleMode: 'main' | 'training'
}>()

const emit = defineEmits<{
  (e: 'switchMode', mode: 'main' | 'training'): void
}>()

const playerHpPercent = computed(() => {
  return (playerStore.player.currentHp / playerStore.player.maxHp) * 100
})

const activeMonster = computed(() => {
  if (props.battleMode === 'training') {
    return trainingStore.currentTrainingMonster
  }
  return monsterStore.currentMonster
})

const activeMonsterHpPercent = computed(() => {
  if (!activeMonster.value) return 0
  return (activeMonster.value.currentHp / activeMonster.value.maxHp) * 100
})

const difficultyLabel = computed(() => {
  if (props.battleMode === 'main') {
    return `难度: ${monsterStore.difficultyValue}`
  }
  return `练功房: ${trainingStore.trainingLevel}`
})

const phaseInfo = computed(() => {
  if (props.battleMode === 'main') {
    return `阶段 ${monsterStore.currentPhase} - ${monsterStore.phaseProgress * 100}%`
  }
  return `怪物Lv.${activeMonster.value?.level || 0}`
})

const consecutiveKillsProgress = computed(() => {
  if (props.battleMode !== 'training' || !trainingStore.autoUpgradeEnabled) return 0
  return (trainingStore.consecutiveFastKills / trainingStore.consecutiveKillsRequired) * 100
})

// T22.4 ATB状态计算属性
const playerATBPercent = computed(() => atbStore.playerATB)
const monsterATBPercent = computed(() => atbStore.monsterATB)
const currentTurnOrder = computed(() => atbStore.turnOrder)

const decisionMetrics = computed(() => estimateCombatKpis(
  playerStore.player,
  playerStore.totalStats,
  activeMonster.value,
  props.battleMode === 'main' ? monsterStore.difficultyValue : trainingStore.trainingLevel
))

const mainlineGuidance = computed(() => getMainlineGuidance(
  decisionMetrics.value,
  props.battleMode === 'main' ? nav.nextUnlockStage : null,
  playerStore.totalStats
))

function formatSeconds(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '--'
  if (value >= 60) return `${(value / 60).toFixed(1)}m`
  return `${value.toFixed(1)}s`
}

function formatPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '--'
  return `${Math.round(value)}%`
}

function switchMode(mode: 'main' | 'training') {
  emit('switchMode', mode)
}

function setTrainingDifficulty(diff: TrainingDifficulty) {
  trainingStore.setDifficulty(diff)
}

// T21.6 标记辅助函数
function getMarkIcon(type: string): string {
  const icons: Record<string, string> = {
    stun: '\u2691',       // 眩晕 - 旗
    bleed: '\u2764',      // 流血 - 心
    armor_break: '\u26e8', // 破甲 - 破盾
    vulnerable: '\u2600', // 易伤 - 太阳
    burn: '\u2601',       // 燃烧 - 云
  }
  return icons[type] || '\u25cf'
}

function getMarkName(type: string): string {
  const names: Record<string, string> = {
    stun: '眩晕',
    bleed: '流血',
    armor_break: '破甲',
    vulnerable: '易伤',
    burn: '燃烧',
  }
  return names[type] || type
}
</script>

<template>
  <div class="battle-hud">
    <!-- 顶部信息栏 -->
    <div class="hud-top">
      <div class="player-info">
        <span class="player-name">{{ playerStore.player.name }}</span>
        <span class="player-level">Lv.{{ playerStore.player.level }}</span>
      </div>
      <div class="battle-mode-switch">
        <button
          :class="{ active: battleMode === 'main' }"
          @click="switchMode('main')"
        >
          主线
        </button>
        <button
          :class="{ active: battleMode === 'training' }"
          @click="switchMode('training')"
        >
          练功
        </button>
      </div>
      <div class="difficulty-info">
        {{ difficultyLabel }}
      </div>
    </div>

    <div class="hud-decision-strip" :class="mainlineGuidance.severity">
      <div class="decision-cell">
        <span>难度</span>
        <strong>{{ decisionMetrics.difficulty }}</strong>
      </div>
      <div class="decision-cell">
        <span>普通怪 TTK</span>
        <strong>{{ formatSeconds(decisionMetrics.normalTtkSeconds) }}</strong>
      </div>
      <div class="decision-cell">
        <span>生存时间</span>
        <strong>{{ formatSeconds(decisionMetrics.survivalSeconds) }}</strong>
      </div>
      <div class="decision-cell">
        <span>Boss 生存率</span>
        <strong>{{ formatPercent(decisionMetrics.bossSurvivalRate) }}</strong>
      </div>
      <div class="decision-cell bottleneck">
        <span>当前瓶颈</span>
        <strong>{{ mainlineGuidance.bottleneck }}</strong>
      </div>
    </div>

    <!-- 战斗区域 -->
    <div class="battle-area">
      <!-- 玩家状态 -->
      <div class="player-section">
        <div class="section-label">玩家</div>
        <div class="hp-container">
          <div class="hp-bar player-hp-bar">
            <div
              class="hp-fill player-hp-fill"
              :style="{ width: playerHpPercent + '%' }"
            ></div>
          </div>
          <div class="hp-text">
            {{ formatNumber(playerStore.player.currentHp) }} / {{ formatNumber(playerStore.player.maxHp) }}
          </div>
        </div>
        <div class="player-stats-mini">
          攻击: {{ formatNumber(playerStore.totalStats.attack) }}
        </div>
      </div>

      <!-- VS 标志 -->
      <div class="vs-section">
        <span class="vs-text">VS</span>
      </div>

      <!-- 怪物状态 -->
      <div class="monster-section">
        <template v-if="activeMonster">
          <div class="section-label">
            {{ activeMonster.name }}
            <span v-if="activeMonster.isBoss" class="boss-tag">BOSS</span>
          </div>
          <div class="hp-container">
            <div
              class="hp-bar monster-hp-bar"
              :class="{ 'boss-hp': activeMonster.isBoss }"
            >
              <div
                class="hp-fill monster-hp-fill"
                :style="{ width: activeMonsterHpPercent + '%' }"
              ></div>
            </div>
            <div class="hp-text">
              {{ formatNumber(activeMonster.currentHp) }} / {{ formatNumber(activeMonster.maxHp) }}
            </div>
          </div>
          <div class="monster-stats-mini">
            攻击: {{ formatNumber(activeMonster.attack) }}
          </div>
          <div v-if="activeMonster.bossMechanic" class="boss-mechanic-hud">
            <span>{{ activeMonster.bossMechanic.name }}</span>
            <strong>{{ activeMonster.bossMechanic.feedback }}</strong>
          </div>
          <!-- T21.6 标记状态显示 -->
          <div v-if="activeMonster.status?.marks?.length" class="monster-marks">
            <span
              v-for="mark in activeMonster.status.marks"
              :key="mark.type"
              class="mark-icon"
              :class="mark.type"
              :title="`${getMarkName(mark.type)} ×${mark.stacks} (${mark.duration}回合)`"
            >
              {{ getMarkIcon(mark.type) }}×{{ mark.stacks }}
            </span>
          </div>
        </template>
        <template v-else>
          <div class="no-monster">等待怪物...</div>
        </template>
      </div>
    </div>

    <!-- 练功房控制 (仅练功模式显示) -->
    <div v-if="battleMode === 'training'" class="training-controls-hud">
      <div class="training-level-control">
        <button @click="trainingStore.downgradeTrainingLevel()">-</button>
        <span>{{ trainingStore.trainingLevel }}级</span>
        <button @click="trainingStore.upgradeTrainingLevel()">+</button>
      </div>
      <div class="training-difficulty-control">
        <button
          v-for="diff in ['easy', 'medium', 'hard'] as TrainingDifficulty[]"
          :key="diff"
          :class="{ active: trainingStore.trainingDifficulty === diff }"
          @click="setTrainingDifficulty(diff)"
        >
          {{ diff === 'easy' ? '简单' : diff === 'medium' ? '中等' : '困难' }}
        </button>
      </div>
    </div>

    <!-- 练功房金币速率 (仅练功模式显示) -->
    <div v-if="battleMode === 'training'" class="training-rewards-hud">
      <div class="reward-rate">
        <span class="rate-icon">💰</span>
        <span class="rate-value">{{ formatNumber(trainingStore.getGoldPerHour()) }}/h</span>
      </div>
      <div class="reward-rate">
        <span class="rate-icon">✨</span>
        <span class="rate-value">{{ formatNumber(trainingStore.getExpPerHour()) }}/h</span>
      </div>
      <div class="reward-rate">
        <span class="rate-icon">⚔️</span>
        <span class="rate-value">{{ trainingStore.trainingKillCount }} 击杀</span>
      </div>
    </div>

    <!-- 自动升级提示 -->
    <div v-if="battleMode === 'training' && trainingStore.autoUpgradeEnabled" class="auto-upgrade-bar">
      <div class="auto-upgrade-info">
        <span class="auto-upgrade-icon">🚀</span>
        <span class="auto-upgrade-text">自动升级</span>
        <div class="auto-upgrade-progress">
          <div
            class="progress-fill"
            :style="{ width: consecutiveKillsProgress + '%' }"
          ></div>
        </div>
        <span class="auto-upgrade-count">{{ trainingStore.consecutiveFastKills }}/{{ trainingStore.consecutiveKillsRequired }}</span>
      </div>
      <Transition name="notice">
        <div v-if="trainingStore.showAutoUpgradeNotice" class="auto-upgrade-notice">
          ⚡ 难度自动提升! 等级: {{ trainingStore.trainingLevel }}
        </div>
      </Transition>
    </div>

    <!-- T22.4 ATB速度条 -->
    <div class="atb-container">
      <div class="atb-bar atb-player">
        <div
          class="atb-fill"
          :style="{ width: playerATBPercent + '%' }"
          :class="{ ready: playerATBPercent >= 100, acting: currentTurnOrder === 'player' }"
        ></div>
        <span class="atb-label">
          玩家
          <span v-if="currentTurnOrder === 'player'" class="turn-indicator">行动中</span>
        </span>
      </div>
      <div class="atb-bar atb-monster">
        <div
          class="atb-fill"
          :style="{ width: monsterATBPercent + '%' }"
          :class="{ ready: monsterATBPercent >= 100, acting: currentTurnOrder === 'monster' }"
        ></div>
        <span class="atb-label">
          {{ activeMonster?.name || '敌人' }}
          <span v-if="currentTurnOrder === 'monster'" class="turn-indicator">行动中</span>
        </span>
      </div>
    </div>

    <!-- 行动槽 -->
    <div class="gauge-section">
      <div class="gauge-item">
        <span class="gauge-label">行动槽</span>
        <div class="gauge-bar">
          <div
            class="gauge-fill player-gauge-fill"
            :style="{ width: gameStore.getPlayerGaugePercent() + '%' }"
          ></div>
        </div>
      </div>
      <div class="gauge-item">
        <span class="gauge-label">敌人</span>
        <div class="gauge-bar">
          <div
            class="gauge-fill monster-gauge-fill"
            :style="{ width: gameStore.getMonsterGaugePercent() + '%' }"
          ></div>
        </div>
      </div>
    </div>

    <!-- 阶段信息 -->
    <div class="phase-bar">
      <span>{{ phaseInfo }}</span>
      <strong>{{ mainlineGuidance.recommendedAction }}</strong>
    </div>
  </div>
</template>

<style scoped>
.battle-hud {
  background: var(--color-bg-panel);
  border-bottom: 2px solid var(--color-bg-card);
  padding: 0.5rem 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.hud-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: var(--font-size-sm);
}

.player-info {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.player-name {
  color: var(--color-secondary);
  font-weight: bold;
}

.player-level {
  background: var(--color-primary);
  color: white;
  padding: 0.1rem 0.4rem;
  border-radius: var(--border-radius-sm);
  font-size: var(--font-size-xs);
}

.battle-mode-switch {
  display: flex;
  gap: 0.2rem;
}

.battle-mode-switch button {
  background: var(--color-bg-card);
  color: var(--color-text-secondary);
  border: none;
  padding: 0.2rem 0.6rem;
  cursor: pointer;
  border-radius: var(--border-radius-sm);
  font-size: var(--font-size-xs);
  transition: all var(--transition-fast);
}

.battle-mode-switch button.active {
  background: var(--color-primary);
  color: white;
}

.battle-mode-switch button:hover:not(.active) {
  background: var(--color-bg-input);
}

.difficulty-info {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.hud-decision-strip {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr)) minmax(12rem, 1.8fr);
  gap: 0.35rem;
  padding: 0.35rem;
  border: 1px solid var(--color-bg-card);
  border-radius: var(--border-radius-sm);
  background: var(--color-bg-dark);
}

.hud-decision-strip.warning {
  border-color: color-mix(in srgb, var(--color-warning) 60%, var(--color-bg-card));
}

.hud-decision-strip.danger {
  border-color: color-mix(in srgb, var(--color-danger) 65%, var(--color-bg-card));
}

.decision-cell {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  padding: 0.35rem 0.45rem;
  border-radius: var(--border-radius-sm);
  background: var(--color-bg-panel);
}

.decision-cell span {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  line-height: 1.2;
}

.decision-cell strong {
  color: var(--color-text-primary);
  font-size: var(--font-size-xs);
  line-height: 1.3;
  overflow-wrap: anywhere;
}

.decision-cell.bottleneck strong {
  color: var(--color-secondary);
}

.battle-area {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.5rem 0;
}

.player-section,
.monster-section {
  flex: 1;
  text-align: center;
}

.section-label {
  font-size: var(--font-size-sm);
  color: var(--color-text-primary);
  margin-bottom: 0.2rem;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.3rem;
}

.boss-tag {
  background: var(--color-danger);
  color: white;
  padding: 0.05rem 0.3rem;
  border-radius: var(--border-radius-sm);
  font-size: var(--font-size-xs);
  animation: pulse 1s infinite;
}

.hp-container {
  margin-bottom: 0.2rem;
}

.hp-bar {
  height: 14px;
  background: var(--color-bg-dark);
  border-radius: var(--border-radius-md);
  overflow: hidden;
  position: relative;
}

.hp-fill {
  height: 100%;
  transition: width 0.2s ease-out;
}

.player-hp-fill {
  background: var(--gradient-hp-player);
}

.monster-hp-fill {
  background: var(--gradient-hp-monster);
}

.boss-hp {
  border: 2px solid var(--color-danger);
  box-shadow: 0 0 10px rgba(255, 0, 0, 0.3);
}

.hp-text {
  font-size: var(--font-size-xs);
  color: var(--color-secondary);
  margin-top: 0.1rem;
}

.player-stats-mini,
.monster-stats-mini {
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}

.boss-mechanic-hud {
  display: flex;
  justify-content: center;
  gap: 0.35rem;
  flex-wrap: wrap;
  margin-top: 0.25rem;
  padding: 0.25rem 0.4rem;
  border: 1px solid color-mix(in srgb, var(--color-danger) 45%, var(--color-bg-card));
  border-radius: var(--border-radius-sm);
  background: color-mix(in srgb, var(--color-bg-dark) 82%, var(--color-danger));
  font-size: var(--font-size-xs);
}

.boss-mechanic-hud span {
  color: var(--color-danger);
  font-weight: bold;
}

.boss-mechanic-hud strong {
  color: var(--color-text-primary);
  font-weight: 600;
}

.no-monster {
  color: var(--color-text-disabled);
  font-size: var(--font-size-sm);
  padding: 1rem;
}

.vs-section {
  display: flex;
  align-items: center;
  justify-content: center;
}

.vs-text {
  font-size: var(--font-size-lg);
  font-weight: bold;
  color: var(--color-primary);
  text-shadow: 0 0 10px var(--color-primary);
}

.training-controls-hud {
  display: flex;
  justify-content: center;
  gap: 1rem;
  padding: 0.3rem;
  background: var(--color-bg-dark);
  border-radius: var(--border-radius-sm);
}

.training-level-control {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  font-size: var(--font-size-sm);
}

.training-level-control button {
  background: var(--color-bg-card);
  color: var(--color-text-primary);
  border: none;
  width: 24px;
  height: 24px;
  cursor: pointer;
  border-radius: var(--border-radius-sm);
  font-size: var(--font-size-sm);
}

.training-level-control button:hover {
  background: var(--color-secondary);
  color: var(--color-bg-dark);
}

.training-difficulty-control {
  display: flex;
  gap: 0.2rem;
}

.training-difficulty-control button {
  background: var(--color-bg-card);
  color: var(--color-text-secondary);
  border: none;
  padding: 0.15rem 0.4rem;
  cursor: pointer;
  border-radius: var(--border-radius-sm);
  font-size: var(--font-size-xs);
  transition: all var(--transition-fast);
}

.training-difficulty-control button.active {
  background: var(--color-primary);
  color: white;
}

/* T22.4 ATB速度条样式 */
.atb-container {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 4px 8px;
}
.atb-bar {
  height: 12px;
  background: #333;
  border-radius: 6px;
  overflow: hidden;
  position: relative;
}
.atb-fill {
  height: 100%;
  background: linear-gradient(90deg, #4a9eff, #7c3aed);
  transition: width 0.1s linear;
}
.atb-fill.ready {
  background: linear-gradient(90deg, #ffd700, #ff8c00);
  animation: pulse 0.5s ease-in-out infinite;
}
.atb-fill.acting {
  background: linear-gradient(90deg, #00ff88, #00cc66);
}
.atb-label {
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  display: flex;
  align-items: center;
  gap: 4px;
}
.turn-indicator {
  color: #00ff88;
  font-weight: bold;
}
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.7; }
}

.gauge-section {
  display: flex;
  gap: 1rem;
  justify-content: center;
}

.gauge-item {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  flex: 1;
  max-width: 200px;
}

.gauge-label {
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  width: 40px;
}

.gauge-bar {
  flex: 1;
  height: 8px;
  background: var(--color-bg-dark);
  border-radius: var(--border-radius-sm);
  overflow: hidden;
}

.gauge-fill {
  height: 100%;
  transition: width 0.1s linear;
}

.player-gauge-fill {
  background: var(--gradient-secondary);
}

.monster-gauge-fill {
  background: var(--gradient-primary);
}

.phase-bar {
  display: flex;
  justify-content: center;
  gap: 0.7rem;
  flex-wrap: wrap;
  text-align: center;
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  padding: 0.2rem;
  background: var(--color-bg-card);
  border-radius: var(--border-radius-sm);
}

.phase-bar strong {
  color: var(--color-secondary);
  font-weight: 600;
}

@media (max-width: 900px) {
  .hud-decision-strip {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .decision-cell.bottleneck {
    grid-column: 1 / -1;
  }
}

@media (max-width: 640px) {
  .hud-top,
  .battle-area,
  .gauge-section {
    flex-direction: column;
  }

  .hud-decision-strip {
    grid-template-columns: 1fr;
  }

  .battle-area {
    gap: 0.5rem;
  }

  .vs-section {
    display: none;
  }
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.auto-upgrade-bar {
  background: var(--color-bg-dark);
  padding: 0.3rem 0.5rem;
  border-radius: var(--border-radius-sm);
  margin-top: 0.2rem;
}

.auto-upgrade-info {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: var(--font-size-xs);
}

.auto-upgrade-icon {
  font-size: 0.9rem;
}

.auto-upgrade-text {
  color: var(--color-text-muted);
}

.auto-upgrade-progress {
  flex: 1;
  height: 6px;
  background: var(--color-bg-card);
  border-radius: 3px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: var(--color-secondary);
  transition: width 0.2s ease-out;
}

.auto-upgrade-count {
  color: var(--color-secondary);
  font-weight: bold;
  min-width: 30px;
  text-align: right;
}

.auto-upgrade-notice {
  background: linear-gradient(135deg, var(--color-secondary-dark), var(--color-secondary));
  color: var(--color-bg-dark);
  padding: 0.3rem 0.5rem;
  border-radius: var(--border-radius-sm);
  margin-top: 0.3rem;
  text-align: center;
  font-size: var(--font-size-sm);
  font-weight: bold;
}

.training-rewards-hud {
  display: flex;
  justify-content: center;
  gap: 1rem;
  padding: 0.3rem;
  background: var(--color-bg-dark);
  border-radius: var(--border-radius-sm);
  margin-top: 0.2rem;
}

.reward-rate {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  font-size: var(--font-size-xs);
}

.rate-icon {
  font-size: 0.9rem;
}

.rate-value {
  color: var(--color-secondary);
  font-weight: bold;
}

.notice-enter-active {
  animation: notice-pop 0.3s ease-out;
}

.notice-leave-active {
  animation: notice-pop 0.2s ease-in reverse;
}

@keyframes notice-pop {
  0% {
    opacity: 0;
    transform: translateY(-10px) scale(0.9);
  }
  100% {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

/* T21.6 标记样式 */
.monster-marks {
  display: flex;
  gap: 0.3rem;
  justify-content: center;
  margin-top: 0.2rem;
  flex-wrap: wrap;
}

.mark-icon {
  display: inline-flex;
  align-items: center;
  padding: 0.1rem 0.35rem;
  border-radius: 10px;
  font-size: var(--font-size-xs);
  font-weight: bold;
  cursor: default;
}

.mark-icon.stun {
  background: rgba(255, 230, 0, 0.2);
  color: #ffe600;
  border: 1px solid rgba(255, 230, 0, 0.4);
}

.mark-icon.bleed {
  background: rgba(220, 20, 60, 0.2);
  color: #dc143c;
  border: 1px solid rgba(220, 20, 60, 0.4);
}

.mark-icon.armor_break {
  background: rgba(138, 43, 226, 0.2);
  color: #9d4dff;
  border: 1px solid rgba(138, 43, 226, 0.4);
}

.mark-icon.vulnerable {
  background: rgba(255, 165, 0, 0.2);
  color: #ffa500;
  border: 1px solid rgba(255, 165, 0, 0.4);
}

.mark-icon.burn {
  background: rgba(255, 69, 0, 0.2);
  color: #ff4500;
  border: 1px solid rgba(255, 69, 0, 0.4);
}
</style>
