<script setup lang="ts">
import { computed } from 'vue'
import type { ProbabilityAudit } from '../../systems/probability/probabilityAudit'
import { formatProbabilityAuditRows } from '../../systems/probability/probabilityAudit'
import { useProbabilityStore } from '../../stores/probabilityStore'

const props = defineProps<{
  audit?: ProbabilityAudit | null
}>()

const probabilityStore = useProbabilityStore()
const rows = computed(() => props.audit ? formatProbabilityAuditRows(props.audit) : [])
</script>

<template>
  <section class="probability-audit-panel">
    <h3>概率审计</h3>
    <div v-if="rows.length" class="audit-list">
      <div v-for="row in rows" :key="row.label" class="audit-row">
        <span>{{ row.label }}</span>
        <strong>{{ row.value }}</strong>
      </div>
    </div>
    <div v-else class="audit-empty">暂无 resolver 审计</div>

    <div v-if="probabilityStore.visibleModifiers.length" class="modifier-list">
      <div class="modifier-title">待展示 modifier</div>
      <div v-for="modifier in probabilityStore.visibleModifiers" :key="modifier.id" class="audit-row">
        <span>{{ modifier.source }}</span>
        <strong>{{ modifier.label }}</strong>
      </div>
    </div>

    <div class="budget-list">
      <div class="modifier-title">玩法预算</div>
      <div v-for="row in probabilityStore.budgetRows" :key="row.id" class="budget-card">
        <strong>{{ row.name }}</strong>
        <span>EV {{ row.expectedValue }}</span>
        <span>传说加成 {{ row.legendaryRateBonus }}</span>
        <span>保底 {{ row.pityGain }}</span>
        <span>免费抽 {{ row.freePulls }}</span>
        <span>jackpot {{ row.jackpots }}</span>
      </div>
    </div>
  </section>
</template>

<style scoped>
.probability-audit-panel {
  padding: 10px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-bg-dark);
}

.probability-audit-panel h3,
.modifier-title {
  margin: 0 0 6px;
  color: var(--color-primary);
  font-size: 0.9rem;
}

.audit-list,
.modifier-list {
  display: grid;
  gap: 4px;
}

.modifier-list {
  margin-top: 8px;
}

.budget-list {
  display: grid;
  gap: 6px;
  margin-top: 8px;
}

.budget-card {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 3px 8px;
  padding: 6px;
  border-radius: 6px;
  background: var(--color-bg-panel);
  font-size: 0.72rem;
}

.budget-card strong {
  grid-column: 1 / -1;
  color: var(--color-text-primary);
}

.budget-card span {
  color: var(--color-text-muted);
}

.audit-row {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 0.78rem;
}

.audit-row span,
.audit-empty {
  color: var(--color-text-muted);
}

.audit-row strong {
  color: var(--color-text-primary);
  text-align: right;
}
</style>
