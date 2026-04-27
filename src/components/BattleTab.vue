<script setup lang="ts">
import { computed, ref } from 'vue'
import { usePlayerStore } from '../stores/playerStore'
import { useGameStore } from '../stores/gameStore'
import { useMonsterStore } from '../stores/monsterStore'
import { useTrainingStore } from '../stores/trainingStore'
import { formatNumber } from '../utils/format'
import BattleLog from './BattleLog.vue'
import type { Skill } from '../types'

const playerStore = usePlayerStore()
const gameStore = useGameStore()
const monsterStore = useMonsterStore()
const trainingStore = useTrainingStore()
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

const skillSlots = computed(() => playerStore.player.skills)
const damagePanelOpen = ref(false)

// Performance: cache expensive computations called multiple times in template
const primaryDamageBreakdown = computed(() => gameStore.getPrimaryDamageBreakdown())
const tagDamageBreakdown = computed(() => gameStore.getTagDamageBreakdown())
const totalDamage = computed(() => gameStore.damageStats.totalDamage)
const recentBattleLog = computed(() => gameStore.battleEvents.slice(0, 20))
const activeMonster = computed(() => props.battleMode === 'training'
  ? trainingStore.currentTrainingMonster
  : monsterStore.currentMonster
)
const activeMonsterHpPercent = computed(() => {
  if (!activeMonster.value) return 0
  return Math.max(0, Math.min(100, activeMonster.value.currentHp / activeMonster.value.maxHp * 100))
})
const playerHpPercent = computed(() => Math.max(0, Math.min(100, playerStore.player.currentHp / playerStore.player.maxHp * 100)))
const recentHitText = computed(() => {
  const latest = recentBattleLog.value.find(entry => entry.type === 'damage' || entry.message.includes('伤害'))
  return latest?.message ?? '战斗引擎待命'
})
const visualLanes = [
  { id: 1, delay: '0s', speed: '2.6s', tone: 'primary' },
  { id: 2, delay: '-0.7s', speed: '3.2s', tone: 'secondary' },
  { id: 3, delay: '-1.4s', speed: '2.9s', tone: 'accent' },
  { id: 4, delay: '-2.1s', speed: '3.5s', tone: 'gold' },
  { id: 5, delay: '-1s', speed: '2.8s', tone: 'primary' }
]
const impactSparks = Array.from({ length: 12 }, (_, index) => ({
  id: index,
  delay: `${-index * 0.18}s`,
  x: `${58 + (index % 4) * 7}%`,
  y: `${22 + (index % 3) * 18}%`
}))
const damageSummaryItems = computed(() => [
  { label: '总伤害', value: formatNumber(gameStore.damageStats.totalDamage), tone: 'secondary' },
  { label: 'DPS', value: formatNumber(gameStore.getDPS()), tone: 'accent' },
  { label: '击杀', value: `${gameStore.damageStats.killCount}`, tone: 'gold' },
  { label: '暴击', value: `${gameStore.damageStats.critCount}`, tone: 'primary' },
  { label: '承伤', value: formatNumber(gameStore.damageStats.damageToPlayer), tone: 'danger' },
  { label: '闪避', value: `${gameStore.damageStats.dodgedAttacks}`, tone: 'info' }
])
const hasDamageBreakdown = computed(() => primaryDamageBreakdown.value.length > 0 || tagDamageBreakdown.value.length > 0)

function getSkillCooldownPercent(skill: Skill | null): number {
  if (!skill) return 100
  if (skill.cooldown === 0) return 100
  return ((skill.cooldown - skill.currentCooldown) / skill.cooldown) * 100
}

function useSkill(slotIndex: number) {
  emit('useSkill', slotIndex)
}

function syncDamagePanel(event: Event) {
  damagePanelOpen.value = (event.target as HTMLDetailsElement).open
}
</script>

<template>
  <div class="battle-tab" :class="{ report: props.viewMode === 'report' }">
    <template v-if="props.viewMode !== 'report'">
      <section class="combat-visual-panel ui-card">
        <div class="visual-copy">
          <span class="panel-kicker">自动战线</span>
          <h2>{{ activeMonster?.name || '等待目标' }}</h2>
          <p>{{ recentHitText }}</p>
        </div>

        <div class="battle-visual-stage" aria-hidden="true">
          <div class="stage-grid"></div>
          <div class="player-forge">
            <div class="forge-core"></div>
            <div class="forge-ring"></div>
          </div>
          <div class="processing-lanes">
            <div
              v-for="lane in visualLanes"
              :key="lane.id"
              class="processing-lane"
              :class="lane.tone"
            >
              <span
                class="damage-packet"
                :style="{ animationDelay: lane.delay, animationDuration: lane.speed }"
              ></span>
              <span
                class="damage-packet echo"
                :style="{ animationDelay: lane.delay, animationDuration: lane.speed }"
              ></span>
            </div>
          </div>
          <div
            v-for="spark in impactSparks"
            :key="spark.id"
            class="impact-spark"
            :style="{ left: spark.x, top: spark.y, animationDelay: spark.delay }"
          ></div>
          <div class="enemy-core" :class="{ boss: activeMonster?.isBoss }">
            <div
              class="enemy-hp-ring"
              :style="{ background: `conic-gradient(var(--color-primary) ${activeMonsterHpPercent}%, rgba(255,255,255,0.08) 0)` }"
            ></div>
            <div class="enemy-blocks">
              <span v-for="n in 9" :key="n"></span>
            </div>
          </div>
        </div>

        <div class="visual-health-row">
          <div class="visual-health">
            <span>玩家</span>
            <div class="visual-health-bar"><i :style="{ width: playerHpPercent + '%' }"></i></div>
          </div>
          <div class="visual-health enemy">
            <span>{{ activeMonster?.isBoss ? 'Boss' : '敌人' }}</span>
            <div class="visual-health-bar"><i :style="{ width: activeMonsterHpPercent + '%' }"></i></div>
          </div>
        </div>

        <details class="damage-corner-widget" :open="damagePanelOpen" @toggle="syncDamagePanel">
          <summary>
            <span>伤害</span>
            <strong>{{ formatNumber(gameStore.getDPS()) }}/s</strong>
          </summary>
          <div class="corner-stat-grid">
            <div
              v-for="item in damageSummaryItems.slice(0, 4)"
              :key="item.label"
              class="corner-stat"
              :class="item.tone"
            >
              <span>{{ item.label }}</span>
              <strong>{{ item.value }}</strong>
            </div>
          </div>
          <div v-if="hasDamageBreakdown" class="corner-breakdown">
            <div class="breakdown-bar">
              <div
                v-for="(item, index) in primaryDamageBreakdown"
                :key="index"
                class="breakdown-segment"
                :style="{
                  width: Math.min(100, item.value / Math.max(1, totalDamage) * 100) + '%',
                  backgroundColor: item.color
                }"
                :title="item.name + ': ' + formatNumber(item.value)"
              ></div>
            </div>
          </div>
        </details>
      </section>

      <section class="workspace-grid">
        <section class="skill-panel ui-card">
          <div class="panel-head">
            <div>
              <span class="panel-kicker">技能</span>
              <h2>技能循环</h2>
            </div>
            <span class="state-chip" :class="{ ready: gameStore.canPlayerAct }">
              {{ gameStore.canPlayerAct ? '可行动' : '蓄力中' }}
            </span>
          </div>
          <div class="skill-slots">
            <button
              v-for="(skill, index) in skillSlots"
              :key="index"
              class="skill-slot"
              :class="{
                ready: skill && skill.currentCooldown <= 0 && gameStore.canPlayerAct,
                cooldown: skill && skill.currentCooldown > 0,
                empty: !skill
              }"
              :disabled="!skill || skill.currentCooldown > 0 || !gameStore.canPlayerAct"
              @click="skill && skill.currentCooldown <= 0 && gameStore.canPlayerAct && useSkill(index)"
            >
              <template v-if="skill">
                <span class="slot-index">{{ index + 1 }}</span>
                <span class="skill-name">{{ skill.name }}</span>
                <span class="skill-state">
                  {{ skill.currentCooldown > 0 ? `${skill.currentCooldown.toFixed(1)}s` : '就绪' }}
                </span>
                <span class="skill-cooldown-bar">
                  <span
                    class="cooldown-fill"
                    :style="{ width: getSkillCooldownPercent(skill) + '%' }"
                  ></span>
                </span>
              </template>
              <template v-else>
                <span class="slot-index">{{ index + 1 }}</span>
                <span class="skill-empty">空槽位</span>
              </template>
            </button>
          </div>
        </section>

        <section class="build-summary-panel ui-card">
          <div class="panel-head">
            <div>
              <span class="panel-kicker">构筑</span>
              <h2>构筑摘要</h2>
            </div>
          </div>
          <p v-if="props.buildSummary">{{ props.buildSummary }}</p>
          <p v-else class="empty-copy">暂无明确构筑倾向，先通过装备和技能建立主输出来源。</p>
          <div v-if="props.buildTags.length" class="build-tags">
            <span v-for="tag in props.buildTags" :key="tag" class="build-tag">{{ tag }}</span>
          </div>
        </section>
      </section>

      <section class="battle-log-panel ui-card">
        <BattleLog :entries="recentBattleLog" :max-entries="8" compact @clear="gameStore.clearBattleLog" />
      </section>
    </template>

    <template v-else>
      <section class="damage-stats-panel report-panel ui-card">
        <div class="panel-head">
          <div>
            <span class="panel-kicker">统计</span>
            <h2>伤害统计</h2>
          </div>
        </div>
        <div class="damage-summary report-summary">
          <div
            v-for="item in damageSummaryItems"
            :key="item.label"
            class="damage-stat"
            :class="item.tone"
          >
            <span class="stat-label">{{ item.label }}</span>
            <strong class="stat-value">{{ item.value }}</strong>
          </div>
        </div>
        <div class="damage-breakdown">
          <div class="breakdown-title">主来源</div>
          <div class="breakdown-bar">
            <div
              v-for="(item, index) in primaryDamageBreakdown"
              :key="index"
              class="breakdown-segment"
              :style="{
                width: Math.min(100, item.value / Math.max(1, totalDamage) * 100) + '%',
                backgroundColor: item.color
              }"
              :title="item.name + ': ' + formatNumber(item.value)"
            ></div>
          </div>
          <div class="breakdown-legend">
            <div
              v-for="(item, index) in primaryDamageBreakdown"
              :key="index"
              class="legend-item"
            >
              <span class="legend-color" :style="{ backgroundColor: item.color }"></span>
              <span class="legend-name">{{ item.name }}</span>
              <span class="legend-value">{{ formatNumber(item.value) }}</span>
            </div>
          </div>
          <div v-if="tagDamageBreakdown.length" class="tag-breakdown">
            <div class="breakdown-title">标签贡献</div>
            <div
              v-for="(item, index) in tagDamageBreakdown"
              :key="index"
              class="tag-row"
            >
              <span class="legend-color" :style="{ backgroundColor: item.color }"></span>
              <span class="legend-name">{{ item.name }}</span>
              <span class="legend-value">{{ formatNumber(item.value) }}</span>
              <span class="tag-percent">{{ (item.value / Math.max(1, totalDamage) * 100).toFixed(1) }}%</span>
            </div>
          </div>
        </div>
      </section>

      <section class="battle-log-panel ui-card">
        <BattleLog :entries="recentBattleLog" :max-entries="12" @clear="gameStore.clearBattleLog" />
      </section>
    </template>
  </div>
</template>

<style scoped>
.battle-tab {
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
}

.workspace-grid {
  display: grid;
  grid-template-columns: minmax(19rem, 1.1fr) minmax(18rem, 0.9fr);
  gap: 0.8rem;
  align-items: stretch;
}

.ui-card {
  padding: 0.9rem;
}

.combat-visual-panel {
  position: relative;
  min-height: 19rem;
  overflow: hidden;
  display: grid;
  grid-template-columns: minmax(14rem, 0.78fr) minmax(24rem, 1.22fr);
  align-items: stretch;
  gap: 1rem;
  border-color: rgba(69, 230, 208, 0.22);
  background:
    radial-gradient(circle at 18% 28%, rgba(69, 230, 208, 0.14), transparent 34%),
    radial-gradient(circle at 74% 52%, rgba(255, 91, 110, 0.16), transparent 35%),
    rgba(7, 10, 18, 0.72);
}

.visual-copy {
  position: relative;
  z-index: 2;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  min-width: 0;
  max-width: 25rem;
  padding: 0.4rem 0 2.4rem;
}

.visual-copy h2 {
  margin: 0;
  color: var(--color-text-primary);
  font-size: 1.55rem;
  line-height: 1.12;
  overflow-wrap: anywhere;
}

.visual-copy p {
  margin: 0.55rem 0 0;
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  line-height: 1.45;
  overflow-wrap: anywhere;
}

.battle-visual-stage {
  position: relative;
  min-height: 16.5rem;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: var(--border-radius-md);
  background:
    linear-gradient(90deg, rgba(69, 230, 208, 0.08), transparent 38%, rgba(255, 91, 110, 0.1)),
    rgba(3, 7, 14, 0.76);
}

.stage-grid {
  position: absolute;
  inset: 0;
  opacity: 0.42;
  background-image:
    linear-gradient(rgba(255, 255, 255, 0.06) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.06) 1px, transparent 1px);
  background-size: 2rem 2rem;
  animation: grid-drift 12s linear infinite;
}

.player-forge {
  position: absolute;
  left: 7%;
  top: 50%;
  width: 5.8rem;
  height: 5.8rem;
  transform: translateY(-50%);
}

.forge-core,
.forge-ring {
  position: absolute;
  inset: 0;
  border-radius: 50%;
}

.forge-core {
  inset: 1.25rem;
  background: var(--color-secondary);
  box-shadow: 0 0 28px rgba(69, 230, 208, 0.48);
  animation: core-pulse 1.4s ease-in-out infinite;
}

.forge-ring {
  border: 2px solid rgba(69, 230, 208, 0.42);
  border-top-color: var(--color-secondary-light);
  animation: core-spin 2.4s linear infinite;
}

.processing-lanes {
  position: absolute;
  left: 19%;
  right: 21%;
  top: 18%;
  bottom: 18%;
  display: grid;
  grid-template-rows: repeat(5, 1fr);
  gap: 0.45rem;
}

.processing-lane {
  position: relative;
  overflow: hidden;
  border-radius: var(--border-radius-full);
  background: linear-gradient(90deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0.025));
}

.processing-lane::before {
  content: "";
  position: absolute;
  inset: 50% 0 auto;
  height: 1px;
  background: rgba(255, 255, 255, 0.18);
}

.damage-packet {
  position: absolute;
  top: 50%;
  left: -1rem;
  width: 1rem;
  height: 1rem;
  border-radius: 3px;
  background: var(--color-primary);
  box-shadow: 0 0 18px currentColor;
  transform: translateY(-50%) rotate(45deg);
  animation: packet-run 3s linear infinite;
}

.damage-packet.echo {
  width: 0.58rem;
  height: 0.58rem;
  opacity: 0.68;
  animation-delay: -1.2s !important;
}

.processing-lane.secondary .damage-packet {
  background: var(--color-secondary);
  color: var(--color-secondary);
}

.processing-lane.accent .damage-packet {
  background: var(--color-accent);
  color: var(--color-accent);
}

.processing-lane.gold .damage-packet {
  background: var(--color-gold);
  color: var(--color-gold);
}

.processing-lane.primary .damage-packet {
  color: var(--color-primary);
}

.enemy-core {
  position: absolute;
  right: 7%;
  top: 50%;
  width: 7rem;
  height: 7rem;
  transform: translateY(-50%);
  display: grid;
  place-items: center;
}

.enemy-hp-ring {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  padding: 0.45rem;
  filter: drop-shadow(0 0 18px rgba(255, 91, 110, 0.36));
  animation: enemy-breathe 1.9s ease-in-out infinite;
}

.enemy-hp-ring::after {
  content: "";
  position: absolute;
  inset: 0.52rem;
  border-radius: 50%;
  background: rgba(7, 10, 18, 0.92);
}

.enemy-blocks {
  position: relative;
  z-index: 2;
  display: grid;
  grid-template-columns: repeat(3, 1rem);
  gap: 0.22rem;
}

.enemy-blocks span {
  width: 1rem;
  height: 1rem;
  border-radius: 3px;
  background: rgba(255, 91, 110, 0.78);
  box-shadow: 0 0 12px rgba(255, 91, 110, 0.35);
  animation: block-jitter 0.9s steps(2, end) infinite;
}

.enemy-blocks span:nth-child(2n) {
  animation-delay: -0.22s;
}

.enemy-blocks span:nth-child(3n) {
  background: rgba(143, 122, 255, 0.75);
  animation-delay: -0.44s;
}

.enemy-core.boss .enemy-blocks span {
  background: rgba(246, 173, 85, 0.84);
}

.impact-spark {
  position: absolute;
  width: 0.34rem;
  height: 0.34rem;
  border-radius: 50%;
  background: var(--color-gold);
  box-shadow: 0 0 12px rgba(246, 173, 85, 0.8);
  animation: spark-pop 1.2s ease-out infinite;
}

.visual-health-row {
  position: absolute;
  left: 1rem;
  right: 1rem;
  bottom: 0.9rem;
  z-index: 3;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 0.7rem;
}

.visual-health {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  font-weight: 800;
}

.visual-health-bar {
  height: 0.4rem;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: var(--border-radius-full);
  background: rgba(7, 10, 18, 0.72);
}

.visual-health-bar i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--gradient-secondary);
  transition: width 0.24s ease;
}

.visual-health.enemy .visual-health-bar i {
  background: var(--gradient-primary);
}

.damage-corner-widget {
  position: absolute;
  z-index: 4;
  top: 0.9rem;
  right: 0.9rem;
  width: min(18rem, calc(100% - 1.8rem));
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: var(--border-radius-md);
  background: rgba(7, 10, 18, 0.78);
  box-shadow: var(--shadow-lg);
  backdrop-filter: blur(14px);
}

.damage-corner-widget summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.8rem;
  min-height: 2.35rem;
  padding: 0.48rem 0.65rem;
  cursor: pointer;
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
  font-weight: 900;
  list-style: none;
}

.damage-corner-widget summary::-webkit-details-marker {
  display: none;
}

.damage-corner-widget summary::before {
  content: "";
  width: 0.48rem;
  height: 0.48rem;
  flex: 0 0 auto;
  border-right: 2px solid var(--color-text-muted);
  border-bottom: 2px solid var(--color-text-muted);
  transform: rotate(45deg) translateY(-1px);
  transition: transform var(--transition-fast);
}

.damage-corner-widget[open] summary::before {
  transform: rotate(225deg) translateY(-1px);
}

.damage-corner-widget summary span {
  flex: 1;
}

.damage-corner-widget summary strong {
  color: var(--color-secondary-light);
  font-size: var(--font-size-sm);
  white-space: nowrap;
}

.corner-stat-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.38rem;
  padding: 0 0.65rem 0.65rem;
}

.corner-stat {
  min-width: 0;
  padding: 0.42rem;
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius-sm);
  background: rgba(255, 255, 255, 0.045);
}

.corner-stat span {
  display: block;
  color: var(--color-text-muted);
  font-size: 0.66rem;
}

.corner-stat strong {
  display: block;
  margin-top: 0.16rem;
  color: var(--color-secondary-light);
  font-size: var(--font-size-sm);
  overflow-wrap: anywhere;
}

.corner-stat.primary strong { color: var(--color-primary-light); }
.corner-stat.accent strong { color: var(--color-accent-light); }
.corner-stat.gold strong { color: var(--color-gold); }

.corner-breakdown {
  padding: 0 0.65rem 0.68rem;
}

.panel-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.8rem;
  margin-bottom: 0.75rem;
}

.panel-kicker {
  display: block;
  margin-bottom: 0.18rem;
  color: var(--color-text-muted);
  font-size: 0.66rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.panel-head h2 {
  margin: 0;
  color: var(--color-text-primary);
  font-size: var(--font-size-lg);
  line-height: 1.2;
}

.state-chip {
  flex: 0 0 auto;
  border: 1px solid rgba(255, 91, 110, 0.3);
  border-radius: var(--border-radius-full);
  padding: 0.28rem 0.58rem;
  background: rgba(255, 91, 110, 0.1);
  color: var(--color-primary-light);
  font-size: var(--font-size-xs);
  font-weight: 800;
}

.state-chip.ready {
  border-color: rgba(69, 230, 208, 0.34);
  background: rgba(69, 230, 208, 0.12);
  color: var(--color-secondary-light);
}

.skill-slots {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr));
  gap: 0.55rem;
}

.skill-slot {
  position: relative;
  min-height: 5.2rem;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.35rem;
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius-md);
  padding: 0.65rem;
  background: rgba(7, 10, 18, 0.58);
  color: var(--color-text-secondary);
  cursor: pointer;
  text-align: left;
  transition: transform var(--transition-fast), border-color var(--transition-fast), background var(--transition-fast), opacity var(--transition-fast);
}

.skill-slot:hover:not(:disabled) {
  transform: translateY(-1px);
  border-color: rgba(69, 230, 208, 0.45);
  background: rgba(69, 230, 208, 0.09);
}

.skill-slot:disabled {
  cursor: not-allowed;
}

.skill-slot.ready {
  border-color: rgba(69, 230, 208, 0.45);
  box-shadow: inset 0 0 0 1px rgba(69, 230, 208, 0.08), 0 0 20px rgba(69, 230, 208, 0.1);
}

.skill-slot.cooldown {
  opacity: 0.72;
}

.skill-slot.empty {
  opacity: 0.48;
}

.slot-index {
  display: inline-grid;
  width: 1.45rem;
  height: 1.45rem;
  place-items: center;
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius-sm);
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  font-weight: 800;
}

.skill-name {
  min-height: 2rem;
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
  font-weight: 800;
  line-height: 1.25;
  overflow-wrap: anywhere;
}

.skill-state,
.skill-empty {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  font-weight: 700;
}

.skill-slot.ready .skill-state {
  color: var(--color-secondary-light);
}

.skill-cooldown-bar {
  position: absolute;
  inset: auto 0 0;
  height: 0.24rem;
  background: rgba(255, 255, 255, 0.06);
}

.cooldown-fill {
  display: block;
  height: 100%;
  background: var(--gradient-secondary);
  transition: width 0.2s ease;
}

.build-summary-panel {
  min-height: 100%;
}

.build-summary-panel p {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  line-height: 1.55;
}

.empty-copy {
  color: var(--color-text-muted) !important;
}

.build-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin-top: 0.75rem;
}

.build-tag {
  border: 1px solid rgba(143, 122, 255, 0.28);
  border-radius: var(--border-radius-full);
  padding: 0.26rem 0.52rem;
  background: rgba(143, 122, 255, 0.1);
  color: var(--color-accent-light);
  font-size: var(--font-size-xs);
  font-weight: 800;
}

.damage-summary {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.55rem;
}

.report-summary {
  grid-template-columns: repeat(6, minmax(0, 1fr));
}

.damage-stat {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius-md);
  padding: 0.65rem;
  background: rgba(7, 10, 18, 0.54);
}

.stat-label {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.stat-value {
  color: var(--color-secondary-light);
  font-size: var(--font-size-lg);
  line-height: 1.1;
  overflow-wrap: anywhere;
}

.damage-stat.primary .stat-value { color: var(--color-primary-light); }
.damage-stat.accent .stat-value { color: var(--color-accent-light); }
.damage-stat.gold .stat-value { color: var(--color-gold); }
.damage-stat.danger .stat-value { color: var(--color-danger); }
.damage-stat.info .stat-value { color: var(--color-info); }

.damage-breakdown {
  margin-top: 0.75rem;
}

.breakdown-title {
  margin: 0.35rem 0 0.25rem;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  font-weight: 800;
}

.breakdown-bar {
  display: flex;
  height: 0.68rem;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: var(--border-radius-full);
  background: rgba(7, 10, 18, 0.68);
}

.breakdown-segment {
  height: 100%;
  min-width: 2px;
  transition: width 0.3s;
}

.breakdown-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem 0.75rem;
  margin-top: 0.55rem;
}

.breakdown-legend.compact {
  gap: 0.35rem 0.65rem;
}

.legend-item {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  min-width: 0;
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
}

.legend-color {
  flex: 0 0 auto;
  width: 0.6rem;
  height: 0.6rem;
  border-radius: 2px;
}

.legend-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.legend-value {
  color: var(--color-secondary-light);
  font-weight: 800;
}

.tag-breakdown {
  display: grid;
  gap: 0.35rem;
  margin-top: 0.55rem;
}

.tag-row {
  display: grid;
  grid-template-columns: 10px minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 0.35rem;
  font-size: var(--font-size-xs);
}

.tag-percent {
  color: var(--color-text-muted);
}

.battle-log-panel {
  padding: 0;
  overflow: hidden;
}

@keyframes grid-drift {
  from { background-position: 0 0, 0 0; }
  to { background-position: 4rem 2rem, 4rem 2rem; }
}

@keyframes packet-run {
  0% {
    left: -1rem;
    opacity: 0;
    transform: translateY(-50%) rotate(45deg) scale(0.72);
  }
  12% {
    opacity: 1;
  }
  82% {
    opacity: 1;
  }
  100% {
    left: calc(100% + 1rem);
    opacity: 0;
    transform: translateY(-50%) rotate(405deg) scale(1);
  }
}

@keyframes core-spin {
  to { transform: rotate(360deg); }
}

@keyframes core-pulse {
  0%, 100% { transform: scale(0.92); opacity: 0.82; }
  50% { transform: scale(1.08); opacity: 1; }
}

@keyframes enemy-breathe {
  0%, 100% { transform: scale(0.98); }
  50% { transform: scale(1.03); }
}

@keyframes block-jitter {
  0%, 100% { transform: translate(0, 0); }
  50% { transform: translate(1px, -1px); }
}

@keyframes spark-pop {
  0% { opacity: 0; transform: scale(0.3); }
  24% { opacity: 1; transform: scale(1); }
  100% { opacity: 0; transform: translate(1.2rem, -0.9rem) scale(0.2); }
}

@media (max-width: 980px) {
  .combat-visual-panel {
    grid-template-columns: 1fr;
  }

  .visual-copy {
    max-width: none;
    padding: 0 0 0.2rem;
  }

  .battle-visual-stage {
    min-height: 14rem;
  }

  .workspace-grid {
    grid-template-columns: 1fr;
  }

  .report-summary {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 640px) {
  .ui-card {
    padding: 0.7rem;
  }

  .combat-visual-panel {
    min-height: 22rem;
  }

  .visual-copy h2 {
    font-size: 1.25rem;
  }

  .damage-corner-widget {
    position: relative;
    top: auto;
    right: auto;
    width: 100%;
    order: 4;
  }

  .visual-health-row {
    position: relative;
    left: auto;
    right: auto;
    bottom: auto;
    grid-template-columns: 1fr;
    margin-top: 0.65rem;
  }

  .battle-visual-stage {
    min-height: 12.5rem;
  }

  .player-forge {
    left: 5%;
    width: 4.6rem;
    height: 4.6rem;
  }

  .enemy-core {
    right: 5%;
    width: 5.6rem;
    height: 5.6rem;
  }

  .processing-lanes {
    left: 18%;
    right: 18%;
  }

  .damage-summary,
  .report-summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .skill-slots {
    grid-template-columns: 1fr;
  }
}
</style>
