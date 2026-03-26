<script setup lang="ts">
import { computed } from 'vue'
import { usePlayerStore } from '../stores/playerStore'
import { useMonsterStore } from '../stores/monsterStore'
import { useGameStore } from '../stores/gameStore'
import { useTrainingStore } from '../stores/trainingStore'
import { formatNumber } from '../utils/format'
import type { TrainingDifficulty } from '../stores/trainingStore'

const playerStore = usePlayerStore()
const monsterStore = useMonsterStore()
const gameStore = useGameStore()
const trainingStore = useTrainingStore()

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

const hasSpeedAdvantage = computed(() => {
  if (!monsterStore.currentMonster) return false
  const playerSpeed = playerStore.totalStats.speed
  const monsterSpeed = monsterStore.currentMonster.speed
  return playerSpeed > monsterSpeed * 1.5
})

function switchMode(mode: 'main' | 'training') {
  emit('switchMode', mode)
}

function setTrainingDifficulty(diff: TrainingDifficulty) {
  trainingStore.setDifficulty(diff)
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
        <div v-if="activeMonster" class="monster-card" :class="{ 'is-boss': activeMonster.isBoss }">
          <div class="monster-header">
            <div class="monster-title">
              <h3 class="monster-name">
                {{ activeMonster.name }}
                <span v-if="activeMonster.isBoss" class="boss-tag">BOSS</span>
              </h3>
              <div class="monster-level">Lv.{{ activeMonster.level }}</div>
            </div>
          </div>
          
          <div class="monster-stats-mini">
            <span>攻击力: {{ formatNumber(activeMonster.attack) }}</span>
            <span>防御力: {{ formatNumber(activeMonster.defense) }}</span>
            <span>速度: {{ activeMonster.speed }}</span>
          </div>
          
          <div class="hp-container">
            <div class="hp-bar" :class="{ 'boss-hp': activeMonster.isBoss }">
              <div 
                class="hp-fill monster-hp-fill"
                :style="{ width: activeMonsterHpPercent + '%' }"
              ></div>
              <div class="hp-shine"></div>
            </div>
            <div class="hp-text">
              {{ formatNumber(activeMonster.currentHp) }} / {{ formatNumber(activeMonster.maxHp) }}
            </div>
          </div>
        </div>
        <div v-else class="no-monster">等待怪物...</div>
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

    <!-- 行动槽 -->
    <div class="gauge-section">
      <div class="gauge-item" :class="{ 'speed-advantage': hasSpeedAdvantage }">
        <span class="gauge-label">行动槽</span>
        <div class="gauge-bar">
          <div class="gauge-marks">
            <div class="gauge-mark" style="left: 25%"></div>
            <div class="gauge-mark" style="left: 50%"></div>
            <div class="gauge-mark" style="left: 75%"></div>
          </div>
          <div
            class="gauge-fill player-gauge-fill"
            :style="{ width: gameStore.getPlayerGaugePercent() + '%' }"
          ></div>
          <div v-if="hasSpeedAdvantage" class="speed-advantage-glow"></div>
        </div>
      </div>
      <div class="gauge-item">
        <span class="gauge-label">敌人</span>
        <div class="gauge-bar">
          <div class="gauge-marks">
            <div class="gauge-mark" style="left: 25%"></div>
            <div class="gauge-mark" style="left: 50%"></div>
            <div class="gauge-mark" style="left: 75%"></div>
          </div>
          <div
            class="gauge-fill monster-gauge-fill"
            :style="{ width: gameStore.getMonsterGaugePercent() + '%' }"
          ></div>
        </div>
      </div>
    </div>

    <!-- 阶段信息 -->
    <div class="phase-bar">
      {{ phaseInfo }}
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
  height: 12px;
  background: linear-gradient(180deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
  border-radius: 6px;
  overflow: visible;
  position: relative;
  box-shadow: 
    inset 0 2px 4px rgba(0, 0, 0, 0.3),
    0 1px 2px rgba(255, 255, 255, 0.1);
}

.gauge-marks {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  pointer-events: none;
  z-index: 2;
}

.gauge-mark {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  background: rgba(255, 255, 255, 0.2);
  transform: translateX(-50%);
}

.gauge-mark::before {
  content: '';
  position: absolute;
  top: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 4px;
  height: 4px;
  background: rgba(255, 255, 255, 0.3);
  border-radius: 50%;
}

.gauge-fill {
  height: 100%;
  transition: width 0.1s linear;
  position: relative;
  z-index: 1;
  box-shadow: 
    0 0 8px rgba(255, 255, 255, 0.3),
    inset 0 1px 2px rgba(255, 255, 255, 0.2);
}

.player-gauge-fill {
  background: linear-gradient(180deg, #667eea 0%, #764ba2 50%, #5a3d7a 100%);
  border-radius: 6px 0 0 6px;
}

.monster-gauge-fill {
  background: linear-gradient(180deg, #f093fb 0%, #f5576c 50%, #c44569 100%);
  border-radius: 6px 0 0 6px;
}

.phase-bar {
  text-align: center;
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  padding: 0.2rem;
  background: var(--color-bg-card);
  border-radius: var(--border-radius-sm);
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

.speed-advantage .gauge-bar {
  box-shadow: 
    inset 0 2px 4px rgba(0, 0, 0, 0.3),
    0 1px 2px rgba(255, 255, 255, 0.1),
    0 0 12px rgba(102, 126, 234, 0.5);
}

.speed-advantage-glow {
  position: absolute;
  top: -2px;
  left: 0;
  right: 0;
  bottom: -2px;
  background: linear-gradient(90deg, 
    transparent 0%,
    rgba(102, 126, 234, 0.3) 50%,
    transparent 100%
  );
  border-radius: 8px;
  animation: speed-glow-pulse 1.5s ease-in-out infinite;
  pointer-events: none;
  z-index: 3;
}

@keyframes speed-glow-pulse {
  0%, 100% {
    opacity: 0.5;
  }
  50% {
    opacity: 1;
  }
}

.speed-advantage .gauge-label {
  color: #667eea;
  font-weight: bold;
}

/* 怪物卡片样式 */
.monster-card {
  background: linear-gradient(145deg, rgba(60, 20, 80, 0.3), rgba(40, 10, 60, 0.5));
  border: 2px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  padding: 1rem;
  transition: all 0.3s ease;
}

.monster-card:hover {
  border-color: rgba(255, 255, 255, 0.2);
  transform: translateY(-2px);
  box-shadow: 0 8px 16px rgba(0, 0, 0, 0.3);
}

.monster-card.is-boss {
  background: linear-gradient(145deg, rgba(80, 20, 20, 0.5), rgba(60, 10, 10, 0.7));
  border: 2px solid rgba(255, 68, 68, 0.5);
  box-shadow: 0 0 20px rgba(255, 68, 68, 0.2);
}

.monster-header {
  margin-bottom: 0.8rem;
}

.monster-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
}

.monster-name {
  font-size: 1.1rem;
  font-weight: bold;
  color: white;
  margin: 0;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex: 1;
}

.monster-name .boss-tag {
  background: linear-gradient(135deg, #ff4444, #cc0000);
  color: white;
  padding: 0.2rem 0.5rem;
  border-radius: 4px;
  font-size: 0.7rem;
  font-weight: bold;
  animation: boss-tag-pulse 2s ease-in-out infinite;
}

@keyframes boss-tag-pulse {
  0%, 100% {
    box-shadow: 0 0 5px rgba(255, 68, 68, 0.5);
  }
  50% {
    box-shadow: 0 0 15px rgba(255, 68, 68, 0.8);
  }
}

.monster-level {
  font-size: 0.85rem;
  color: rgba(255, 255, 255, 0.7);
  background: rgba(255, 255, 255, 0.1);
  padding: 0.2rem 0.5rem;
  border-radius: 4px;
}

.monster-stats-mini {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.8rem;
  font-size: var(--font-size-xs);
  color: rgba(255, 255, 255, 0.6);
  flex-wrap: wrap;
}

.monster-stats-mini span {
  background: rgba(255, 255, 255, 0.05);
  padding: 0.2rem 0.4rem;
  border-radius: 4px;
}

/* 优化HP条 */
.monster-card .hp-bar {
  height: 16px;
  border-radius: 8px;
  position: relative;
  overflow: hidden;
}

.monster-card .hp-fill {
  border-radius: 8px;
}

.monster-card .hp-shine {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 50%;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.2), transparent);
  border-radius: 8px 8px 0 0;
  pointer-events: none;
}

.monster-card .hp-text {
  font-size: var(--font-size-xs);
  color: rgba(255, 255, 255, 0.8);
  margin-top: 0.3rem;
  text-align: center;
}
</style>
