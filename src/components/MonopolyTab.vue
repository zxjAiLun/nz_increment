<script setup lang="ts">
import { computed, ref } from 'vue'
import { DAILY_MONOPOLY_DICE } from '../data/monopoly'
import { useMonopolyStore } from '../stores/monopolyStore'
import { useProbabilityStore } from '../stores/probabilityStore'
import { formatNumber } from '../utils/format'

const monopoly = useMonopolyStore()
const probability = useProbabilityStore()
const lastMoveId = ref(0)
const latest = computed(() => monopoly.state.history[0] ?? null)
const currentAudit = computed(() => monopoly.getTileAudit(monopoly.state.position))
const rateRows = computed(() => Object.entries(currentAudit.value?.normalizedRates ?? {})
  .map(([rarity, rate]) => ({ rarity, rate: rate.toFixed(2) })))
const monopolyBudget = computed(() => probability.getBudgetSnapshot('monopoly'))
const currentExpectedReward = computed(() => {
  const tile = monopoly.currentTile
  if (!tile) return '无'
  if (tile.reward) return tile.reward.description
  if (tile.boss) return tile.boss.rewards.map(reward => reward.description).join(' / ')
  return '起点无奖励'
})
const currentBossPower = computed(() => monopoly.currentTile?.boss?.requiredPower ?? null)

function rollDice() {
  const result = monopoly.rollDice()
  if (result) lastMoveId.value++
}
</script>

<template>
  <section class="monopoly-tab">
    <div class="monopoly-header">
      <div>
        <h2>资源大富翁</h2>
        <p>
          周常资源循环，独立于抽卡页即时 modifier；每日 {{ DAILY_MONOPOLY_DICE }} 次骰子，每周重置地图，当前周 seed 固定为 {{ monopoly.state.weekId }}。
        </p>
      </div>
      <button :disabled="monopoly.state.diceRemaining <= 0" @click="rollDice">
        掷骰 {{ monopoly.state.diceRemaining }}/{{ DAILY_MONOPOLY_DICE }}
      </button>
    </div>

    <div class="monopoly-summary">
      <div><span>本周 seed</span><strong>{{ monopoly.state.weekId }}</strong></div>
      <div><span>当前位置</span><strong>{{ monopoly.currentTile?.name }}</strong></div>
      <div><span>剩余骰子</span><strong>{{ monopoly.state.diceRemaining }} / {{ DAILY_MONOPOLY_DICE }}</strong></div>
      <div><span>当前战力</span><strong>{{ formatNumber(monopoly.playerPower) }}</strong></div>
      <div><span>Boss 所需战力</span><strong>{{ currentBossPower ? formatNumber(currentBossPower) : '非 Boss 格' }}</strong></div>
      <div><span>预计奖励</span><strong>{{ currentExpectedReward }}</strong></div>
      <div><span>周 EV 预算</span><strong>{{ monopolyBudget?.usage.expectedValue ?? 0 }} / {{ monopolyBudget?.game.budget.expectedValueBudget ?? 0 }}</strong></div>
      <div v-if="latest"><span>上次骰子</span><strong>{{ latest.roll }} 步</strong></div>
    </div>

    <div class="board">
      <div
        v-for="tile in monopoly.state.board"
        :key="tile.id"
        class="tile"
        :class="[tile.type, tile.reward?.rarity, { active: tile.index === monopoly.state.position }]"
      >
        <span class="tile-index">{{ tile.index }}</span>
        <strong>{{ tile.name }}</strong>
        <small v-if="tile.reward">{{ tile.reward.description }}</small>
        <small v-else-if="tile.boss">
          所需战力 {{ formatNumber(tile.boss.requiredPower) }}<br>
          预计 {{ tile.boss.rewards.map(reward => reward.description).join(' / ') }}
        </small>
        <small v-else>每周起点</small>
      </div>
    </div>

    <div class="monopoly-bottom">
      <section class="result-panel">
        <h3>行动结果</h3>
        <template v-if="latest">
          <p>从 {{ latest.from }} 前进 {{ latest.roll }} 步到 {{ latest.to }}。</p>
          <p v-if="latest.tile.type === 'boss'">
            Boss 战斗模拟：{{ latest.bossPassed ? '胜利' : '失败' }}
            <span>(战力参考 {{ formatNumber(latest.playerPower || 0) }} / {{ formatNumber(latest.requiredPower || 0) }})</span>
          </p>
          <p v-if="latest.rewardNames.length">获得：{{ latest.rewardNames.join('、') }}</p>
          <p v-else>本次没有获得奖励。</p>
        </template>
        <p v-else>尚未掷骰。</p>
      </section>

      <section class="audit-panel">
        <h3>格子概率审计</h3>
        <template v-if="rateRows.length">
          <div v-for="row in rateRows" :key="row.rarity" class="audit-row">
            <span>{{ row.rarity }}</span>
            <strong>{{ row.rate }}%</strong>
          </div>
          <p>当前奖励格来自本周 seed 生成，可复现。</p>
          <p>本周 seed：{{ monopoly.state.weekId }}</p>
        </template>
        <p v-else>Boss/起点为固定格，无随机奖励审计。</p>
      </section>
    </div>
  </section>
</template>

<style scoped>
.monopoly-tab {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.monopoly-header {
  display: flex;
  justify-content: space-between;
  gap: 0.8rem;
  align-items: flex-start;
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius-lg);
  padding: 0.95rem;
  background: var(--gradient-card);
  box-shadow: var(--shadow-sm);
}

.monopoly-header h2 {
  margin: 0 0 4px;
  color: var(--color-text-primary);
  font-size: 1.2rem;
}

.monopoly-header p,
.result-panel p,
.audit-panel p {
  margin: 0;
  color: var(--color-text-secondary);
  line-height: 1.45;
}

.monopoly-header button {
  border: 1px solid rgba(255, 209, 102, 0.32);
  border-radius: var(--border-radius-md);
  background: rgba(255, 209, 102, 0.12);
  color: var(--color-gold);
  padding: 0.55rem 0.85rem;
  cursor: pointer;
  font-weight: 800;
  white-space: nowrap;
}

.monopoly-header button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.monopoly-summary {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.5rem;
}

.monopoly-summary div,
.result-panel,
.audit-panel {
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius-md);
  background: rgba(7, 10, 18, 0.52);
  padding: 0.65rem;
}

.monopoly-summary span,
.audit-row span {
  display: block;
  color: var(--color-text-muted);
  font-size: 0.75rem;
  margin-bottom: 4px;
}

.monopoly-summary strong {
  overflow-wrap: anywhere;
}

.board {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 0.5rem;
}

.tile {
  min-height: 5.7rem;
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius-md);
  background: var(--gradient-card);
  padding: 0.55rem;
  position: relative;
}

.tile.active {
  border-color: rgba(69, 230, 208, 0.52);
  box-shadow: inset 0 0 0 1px rgba(69, 230, 208, 0.12), 0 0 24px rgba(69, 230, 208, 0.12);
}

.tile-index {
  position: absolute;
  top: 6px;
  right: 8px;
  color: var(--color-text-muted);
  font-size: 0.72rem;
}

.tile strong {
  display: block;
  margin: 10px 0 6px;
  font-size: 0.86rem;
}

.tile small {
  color: var(--color-text-muted);
  line-height: 1.35;
}

.tile.boss strong { color: var(--color-danger); }
.tile.legendary strong { color: #f59e0b; }
.tile.epic strong { color: #a855f7; }
.tile.rare strong { color: #3b82f6; }

.monopoly-bottom {
  display: grid;
  grid-template-columns: 1fr 260px;
  gap: 0.8rem;
}

.result-panel,
.audit-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.result-panel h3,
.audit-panel h3 {
  margin: 0;
  color: var(--color-text-primary);
  font-size: 0.95rem;
}

.audit-row {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}

@media (max-width: 800px) {
  .monopoly-header,
  .monopoly-bottom {
    display: grid;
    grid-template-columns: 1fr;
  }

  .monopoly-summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .board {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
