<script setup lang="ts">
import { computed, ref } from 'vue'
import { PACHINKO_MODIFIERS } from '../data/pachinko'
import { useGachaStore } from '../stores/gachaStore'
import { usePachinkoStore } from '../stores/pachinkoStore'
import { useProbabilityStore } from '../stores/probabilityStore'

const props = defineProps<{
  poolId: string
}>()

const gacha = useGachaStore()
const pachinko = usePachinkoStore()
const probability = useProbabilityStore()
const lastModifierId = ref<string | null>(pachinko.state.history[0]?.modifier.id ?? null)
const activeTenPullModifiers = computed(() => probability.visibleModifiers
  .filter(modifier => modifier.poolId === props.poolId && modifier.appliesTo === 'tenPull'))
const pendingBonus = computed(() => activeTenPullModifiers.value
  .reduce((sum, modifier) => sum + (modifier.rarePlusBonus || 0), 0))
const previewAudit = computed(() => gacha.getProbabilityPreview(props.poolId, 10))
const pachinkoBudget = computed(() => probability.getBudgetSnapshot('pachinko'))
const rateRows = computed(() => Object.entries(previewAudit.value?.normalizedRates ?? {})
  .map(([rarity, rate]) => ({ rarity, rate: rate.toFixed(2) })))

function playShot() {
  const record = pachinko.playShot(props.poolId)
  if (!record) return
  lastModifierId.value = record.modifier.id
}
</script>

<template>
  <section class="pachinko-panel">
    <div class="panel-header">
      <div>
        <h3>十连前幸运投球</h3>
        <p>本次只影响下一次十连，单抽不会消耗该 modifier。</p>
      </div>
      <button @click="playShot">投球</button>
    </div>

    <div class="modifier-status-grid">
      <div>
        <span>十连 modifier 状态</span>
        <strong>{{ pendingBonus > 0 ? `待生效 +${pendingBonus}% rare+` : '无待生效 modifier' }}</strong>
      </div>
      <div>
        <span>生效条件</span>
        <strong>下一次十连</strong>
      </div>
      <div>
        <span>今日 EV 预算</span>
        <strong>{{ pachinkoBudget?.usage.expectedValue ?? 0 }} / {{ pachinkoBudget?.game.budget.expectedValueBudget ?? 0 }}</strong>
      </div>
      <div>
        <span>本周 jackpot</span>
        <strong>{{ pachinkoBudget?.usage.jackpots ?? 0 }} / {{ pachinkoBudget?.game.budget.maxJackpotPerWeek ?? 0 }}</strong>
      </div>
    </div>

    <div v-if="activeTenPullModifiers.length" class="pending-list">
      <div v-for="modifier in activeTenPullModifiers" :key="modifier.id" class="pending-row">
        <span>{{ modifier.label }}</span>
        <strong>等待十连消耗</strong>
      </div>
    </div>

    <div class="modifier-grid">
      <div
        v-for="modifier in PACHINKO_MODIFIERS"
        :key="modifier.id"
        class="modifier-tile"
        :class="[modifier.rarity, { active: lastModifierId === modifier.id }]"
      >
        <strong>{{ modifier.name }}</strong>
        <span>{{ modifier.description }}</span>
      </div>
    </div>

    <div class="audit-row-list">
      <div class="audit-title">十连概率审计</div>
      <div v-for="row in rateRows" :key="row.rarity" class="audit-row">
        <span>{{ row.rarity }}</span>
        <strong>{{ row.rate }}%</strong>
      </div>
      <div v-for="modifier in previewAudit?.modifiers ?? []" :key="modifier.id" class="audit-row">
        <span>{{ modifier.label }}</span>
        <strong>{{ modifier.active ? '生效' : '未生效' }}</strong>
      </div>
    </div>
  </section>
</template>

<style scoped>
.pachinko-panel {
  padding: 14px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-bg-panel);
}

.panel-header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
  margin-bottom: 12px;
}

.panel-header h3 {
  margin: 0 0 4px;
  color: var(--color-primary);
  font-size: 1rem;
}

.panel-header p {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: 0.82rem;
}

.panel-header button {
  border: 1px solid var(--color-primary);
  background: var(--color-primary);
  color: white;
  border-radius: 6px;
  padding: 8px 12px;
  cursor: pointer;
}

.modifier-status-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  margin-bottom: 10px;
}

.modifier-status-grid div,
.pending-list {
  padding: 8px;
  border-radius: 6px;
  background: var(--color-bg-dark);
}

.modifier-status-grid span,
.pending-row span {
  color: var(--color-text-muted);
  font-size: 0.76rem;
}

.modifier-status-grid span {
  display: block;
  margin-bottom: 4px;
}

.modifier-status-grid strong,
.pending-row strong {
  color: var(--color-text-primary);
  font-size: 0.84rem;
}

.pending-list {
  display: grid;
  gap: 4px;
  margin-bottom: 10px;
}

.pending-row {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}

.modifier-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 8px;
  margin-bottom: 10px;
}

.modifier-tile {
  min-height: 68px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 9px;
  background: var(--color-bg-dark);
}

.modifier-tile.active {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 1px var(--color-primary);
}

.modifier-tile strong {
  display: block;
  margin-bottom: 5px;
  font-size: 0.86rem;
}

.modifier-tile span {
  color: var(--color-text-muted);
  font-size: 0.78rem;
  line-height: 1.35;
}

.modifier-tile.legendary strong { color: #f59e0b; }
.modifier-tile.epic strong { color: #a855f7; }
.modifier-tile.rare strong { color: #3b82f6; }

.audit-row-list {
  padding: 8px;
  border-radius: 6px;
  background: var(--color-bg-dark);
}

.audit-title {
  color: var(--color-text-primary);
  font-weight: 700;
  margin-bottom: 6px;
}

.audit-row {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 0.8rem;
}

.audit-row span {
  color: var(--color-text-muted);
}

@media (max-width: 760px) {
  .panel-header,
  .modifier-status-grid {
    display: grid;
    grid-template-columns: 1fr;
  }
}
</style>
