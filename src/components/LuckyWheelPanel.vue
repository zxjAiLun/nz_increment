<script setup lang="ts">
import { computed, ref } from 'vue'
import { LUCKY_WHEEL_REWARDS } from '../data/luckyWheel'
import { PERMANENT_POOL_ID } from '../data/gachaPools'
import { useGachaStore } from '../stores/gachaStore'
import { useLuckyWheelStore } from '../stores/luckyWheelStore'
import { usePlayerStore } from '../stores/playerStore'
import { useProbabilityStore } from '../stores/probabilityStore'

const wheel = useLuckyWheelStore()
const gacha = useGachaStore()
const player = usePlayerStore()
const probability = useProbabilityStore()
const lastResultId = ref<string | null>(wheel.state.history[0]?.reward.id ?? null)
const previewAudit = computed(() => wheel.state.history[0]?.audit ?? wheel.getPreviewAudit(2026))
const canSpin = computed(() => wheel.canSpinDaily())
const wheelBudget = computed(() => probability.getBudgetSnapshot('luckyWheel'))
const pity = computed(() => gacha.getPityProgress(PERMANENT_POOL_ID))
const rarePlusBonus = computed(() => probability.visibleModifiers
  .filter(modifier => modifier.poolId === PERMANENT_POOL_ID && modifier.appliesTo === 'nextPull')
  .reduce((sum, modifier) => sum + (modifier.rarePlusBonus || 0), 0))
const rateRows = computed(() => Object.entries(previewAudit.value.normalizedRates)
  .map(([rarity, rate]) => ({ rarity, rate: rate.toFixed(2) })))
const rewardRange = computed(() => {
  const names = LUCKY_WHEEL_REWARDS.map(reward => reward.name)
  return names.join(' / ')
})

function spin() {
  const result = wheel.spinDaily()
  if (!result) return
  lastResultId.value = result.reward.id
}
</script>

<template>
  <section class="lucky-wheel-panel">
    <div class="wheel-header">
      <div>
        <h3>每日幸运转盘</h3>
        <p>免费 1 次，奖励只影响抽卡资源与构筑 token。</p>
      </div>
      <button :disabled="!canSpin" @click="spin">
        {{ canSpin ? '免费转一次' : '今日已领取' }}
      </button>
    </div>

    <div class="wheel-status-grid">
      <div>
        <span>领取状态</span>
        <strong>{{ canSpin ? '可领取' : '今日已领取' }}</strong>
      </div>
      <div>
        <span>今日 EV 预算</span>
        <strong>{{ wheelBudget?.usage.expectedValue ?? 0 }} / {{ wheelBudget?.game.budget.expectedValueBudget ?? 0 }}</strong>
      </div>
      <div>
        <span>今日保底预算</span>
        <strong>{{ wheelBudget?.usage.pityGain ?? 0 }} / {{ wheelBudget?.game.budget.maxPityGainPerDay ?? 0 }}</strong>
      </div>
      <div>
        <span>本周免费抽预算</span>
        <strong>{{ wheelBudget?.usage.freePulls ?? 0 }} / {{ wheelBudget?.game.budget.maxFreePullsPerWeek ?? 0 }}</strong>
      </div>
    </div>

    <div class="reward-range">
      <span>可获得奖励范围</span>
      <strong>{{ rewardRange }}</strong>
    </div>

    <div class="wheel-body">
      <div class="wheel-grid">
        <div
          v-for="reward in LUCKY_WHEEL_REWARDS"
          :key="reward.id"
          class="wheel-tile"
          :class="[reward.rarity, { active: lastResultId === reward.id }]"
        >
          <span>{{ reward.name }}</span>
          <small>{{ reward.description }}</small>
        </div>
      </div>

      <div class="wheel-side">
        <div class="status-row">
          <span>常驻保底</span>
          <strong>{{ pity.current }} / {{ pity.target }}</strong>
        </div>
        <div class="status-row">
          <span>下一抽 rare+</span>
          <strong>+{{ rarePlusBonus }}%</strong>
        </div>
        <div class="status-row">
          <span>抽卡券</span>
          <strong>{{ player.player.gachaTickets }}</strong>
        </div>
        <div class="audit-block">
          <div class="audit-title">概率审计</div>
          <div v-for="row in rateRows" :key="row.rarity" class="audit-row">
            <span>{{ row.rarity }}</span>
            <strong>{{ row.rate }}%</strong>
          </div>
          <div v-if="previewAudit.modifiers.length === 0" class="audit-empty">无额外 modifier</div>
          <div v-for="modifier in previewAudit.modifiers" :key="modifier.id" class="audit-row">
            <span>{{ modifier.label }}</span>
            <strong>{{ modifier.active ? '生效' : '未生效' }}</strong>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.lucky-wheel-panel {
  padding: 14px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-bg-panel);
}

.wheel-header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
  margin-bottom: 12px;
}

.wheel-header h3 {
  margin: 0 0 4px;
  color: var(--color-primary);
  font-size: 1rem;
}

.wheel-header p {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: 0.82rem;
}

.wheel-header button {
  border: 1px solid var(--color-primary);
  background: var(--color-primary);
  color: white;
  border-radius: 6px;
  padding: 8px 12px;
  cursor: pointer;
  white-space: nowrap;
}

.wheel-header button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.wheel-body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 220px;
  gap: 12px;
}

.wheel-status-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  margin-bottom: 10px;
}

.wheel-status-grid div,
.reward-range {
  padding: 8px;
  border-radius: 6px;
  background: var(--color-bg-dark);
}

.wheel-status-grid span,
.reward-range span {
  display: block;
  color: var(--color-text-muted);
  font-size: 0.76rem;
  margin-bottom: 4px;
}

.wheel-status-grid strong,
.reward-range strong {
  color: var(--color-text-primary);
  font-size: 0.84rem;
}

.reward-range {
  margin-bottom: 12px;
}

.wheel-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
  gap: 8px;
}

.wheel-tile {
  min-height: 74px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 9px;
  background: var(--color-bg-dark);
}

.wheel-tile.active {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 1px var(--color-primary);
}

.wheel-tile span {
  display: block;
  font-size: 0.86rem;
  font-weight: 700;
  margin-bottom: 5px;
}

.wheel-tile small {
  color: var(--color-text-muted);
  line-height: 1.35;
}

.wheel-tile.legendary span { color: #f59e0b; }
.wheel-tile.epic span { color: #a855f7; }
.wheel-tile.rare span { color: #3b82f6; }

.wheel-side {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.status-row,
.audit-row {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 0.8rem;
}

.status-row {
  padding: 8px;
  border-radius: 6px;
  background: var(--color-bg-dark);
}

.status-row span,
.audit-row span,
.audit-empty {
  color: var(--color-text-muted);
}

.audit-block {
  padding: 8px;
  border-radius: 6px;
  background: var(--color-bg-dark);
}

.audit-title {
  color: var(--color-text-primary);
  font-weight: 700;
  margin-bottom: 6px;
}

.audit-empty {
  font-size: 0.78rem;
}

@media (max-width: 760px) {
  .wheel-header,
  .wheel-body {
    grid-template-columns: 1fr;
  }

  .wheel-status-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .wheel-header {
    display: grid;
  }
}
</style>
