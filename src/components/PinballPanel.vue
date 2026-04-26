<script setup lang="ts">
import { computed } from 'vue'
import { PINBALL_MAX_CONVERT_TOKENS, PINBALL_SCORE_BANDS } from '../data/pinball'
import { useGachaStore } from '../stores/gachaStore'
import { usePinballStore } from '../stores/pinballStore'

const props = defineProps<{
  poolId: string
}>()

const gacha = useGachaStore()
const pinball = usePinballStore()
const lastPlay = computed(() => pinball.state.plays[0] ?? null)
const pendingBonus = computed(() => gacha.state.pendingEventRarePlusBonus[props.poolId] || 0)
const convertibleTokens = computed(() => Math.min(pinball.state.tokens, PINBALL_MAX_CONVERT_TOKENS))
const previewAudit = computed(() => gacha.getProbabilityAudit(props.poolId, 2027))

function playEvent() {
  pinball.playEvent()
}

function convertTokens() {
  pinball.convertTokensToModifier(props.poolId)
}
</script>

<template>
  <section class="pinball-panel">
    <div class="panel-header">
      <div>
        <h3>活动弹球机</h3>
        <p>score → token → modifier</p>
      </div>
      <div class="actions">
        <button @click="playEvent">开局</button>
        <button :disabled="convertibleTokens <= 0" @click="convertTokens">
          兑换 +{{ pinball.nextRarePlusBonus }}%
        </button>
      </div>
    </div>

    <div class="status-grid">
      <div>
        <span>活动 token</span>
        <strong>{{ pinball.state.tokens }}</strong>
      </div>
      <div>
        <span>待生效 modifier</span>
        <strong>+{{ pendingBonus }}% rare+</strong>
      </div>
      <div>
        <span>最近分数</span>
        <strong>{{ lastPlay?.score ?? 0 }}</strong>
      </div>
      <div>
        <span>最近 token</span>
        <strong>+{{ lastPlay?.tokensGained ?? 0 }}</strong>
      </div>
    </div>

    <div class="band-grid">
      <div v-for="band in PINBALL_SCORE_BANDS" :key="band.id" class="band-tile">
        <strong>{{ band.name }}</strong>
        <span>{{ band.minScore }}+ / token +{{ band.tokens }}</span>
      </div>
    </div>

    <div class="audit-row-list">
      <div class="audit-title">抽卡 modifier 审计</div>
      <div v-for="modifier in previewAudit?.modifiers ?? []" :key="modifier.id" class="audit-row">
        <span>{{ modifier.label }}</span>
        <strong>{{ modifier.active ? '生效' : '未生效' }}</strong>
      </div>
      <div v-if="(previewAudit?.modifiers.length ?? 0) === 0" class="audit-empty">无额外 modifier</div>
    </div>
  </section>
</template>

<style scoped>
.pinball-panel {
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

.actions {
  display: flex;
  gap: 8px;
}

.actions button {
  border: 1px solid var(--color-primary);
  background: var(--color-primary);
  color: white;
  border-radius: 6px;
  padding: 8px 12px;
  cursor: pointer;
  white-space: nowrap;
}

.actions button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.status-grid,
.band-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 8px;
  margin-bottom: 10px;
}

.status-grid div,
.band-tile,
.audit-row-list {
  padding: 8px;
  border-radius: 6px;
  background: var(--color-bg-dark);
}

.status-grid span,
.band-tile span,
.audit-row span,
.audit-empty {
  color: var(--color-text-muted);
  font-size: 0.78rem;
}

.status-grid strong,
.band-tile strong {
  display: block;
  margin-top: 4px;
  color: var(--color-text-primary);
  font-size: 0.9rem;
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

@media (max-width: 760px) {
  .panel-header {
    display: grid;
  }

  .actions {
    flex-wrap: wrap;
  }
}
</style>
