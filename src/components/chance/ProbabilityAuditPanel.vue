<script setup lang="ts">
import { computed } from 'vue'
import type { ProbabilityAudit } from '../../systems/probability/probabilityAudit'
import { formatProbabilityAuditRows } from '../../systems/probability/probabilityAudit'
import { useProbabilityStore } from '../../stores/probabilityStore'

const props = defineProps<{
  audit?: ProbabilityAudit | null
  showResult?: boolean
  poolId?: string
  count?: 1 | 10
}>()

const probabilityStore = useProbabilityStore()
const rows = computed(() => props.audit ? formatProbabilityAuditRows(props.audit, { includeResult: props.showResult ?? true }) : [])
const scopedModifiers = computed(() => props.poolId
  ? probabilityStore.getApplicableModifiers(props.poolId, { count: props.count ?? 10, costType: 'diamond' })
  : probabilityStore.visibleModifiers)
const modeLabel = computed(() => props.showResult ? '本次真实结果' : '预览概率')
const modeDescription = computed(() => props.showResult
  ? '显示最近一次真实抽卡的 roll、命中奖励和生效 modifier。'
  : '只显示当前有效概率和待生效 modifier，不展示固定 seed 的预测结果。')
</script>

<template>
  <section class="probability-audit-panel">
    <div class="audit-heading">
      <h3>概率审计</h3>
      <strong>{{ modeLabel }}</strong>
    </div>
    <p class="audit-mode">{{ modeDescription }}</p>
    <div v-if="rows.length" class="audit-list">
      <div v-for="row in rows" :key="row.label" class="audit-row">
        <span>{{ row.label }}</span>
        <strong>{{ row.value }}</strong>
      </div>
    </div>
    <div v-else class="audit-empty">暂无 resolver 审计</div>

    <div v-if="scopedModifiers.length" class="modifier-list">
      <div class="modifier-title">当前池待生效 modifier</div>
      <div v-for="modifier in scopedModifiers" :key="modifier.id" class="audit-row">
        <span>{{ modifier.source }}</span>
        <strong>{{ modifier.label }}</strong>
      </div>
    </div>

    <div class="budget-list">
      <div class="modifier-title">玩法预算</div>
      <div v-for="row in probabilityStore.budgetRows" :key="row.id" class="budget-card">
        <strong>{{ row.name }}</strong>
        <span>EV {{ row.expectedValue }}</span>
        <span>直接传奇加成 {{ row.legendaryRateBonus }}</span>
        <span>保底 {{ row.pityGain }}</span>
        <span>免费抽 {{ row.freePulls }}</span>
        <span>jackpot {{ row.jackpots }}</span>
      </div>
    </div>
  </section>
</template>

<style scoped>
.probability-audit-panel {
  padding: 0.85rem;
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius-md);
  background: rgba(7, 10, 18, 0.52);
}

.audit-heading {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  align-items: center;
}

.probability-audit-panel h3,
.modifier-title {
  margin: 0 0 6px;
  color: var(--color-text-primary);
  font-size: var(--font-size-md);
}

.audit-heading strong {
  border: 1px solid rgba(69, 230, 208, 0.32);
  border-radius: 999px;
  padding: 0.22rem 0.5rem;
  background: rgba(69, 230, 208, 0.1);
  color: var(--color-secondary-light);
  font-size: 0.78rem;
  white-space: nowrap;
}

.audit-mode {
  margin: 0 0 8px;
  color: var(--color-text-muted);
  font-size: 0.76rem;
  line-height: 1.4;
}

.audit-list,
.modifier-list {
  display: grid;
  gap: 0.35rem;
}

.modifier-list {
  margin-top: 8px;
}

.budget-list {
  display: grid;
  gap: 0.45rem;
  margin-top: 0.75rem;
}

.budget-card {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.25rem 0.5rem;
  padding: 0.55rem;
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius-md);
  background: rgba(255, 255, 255, 0.045);
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
  gap: 0.5rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  padding: 0.24rem 0;
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
