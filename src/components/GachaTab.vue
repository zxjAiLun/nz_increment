<script setup lang="ts">
import { ref, computed } from 'vue'
import { useGachaStore } from '@/stores/gachaStore'
import { GACHA_POOLS, PERMANENT_POOL_ID, LIMITED_POOL_ID } from '@/data/gachaPools'
import { getGachaDecisionHint } from '@/utils/combatInsights'
import { useNavigationStore } from '@/stores/navigationStore'
import LuckyWheelPanel from './LuckyWheelPanel.vue'
import PachinkoPanel from './PachinkoPanel.vue'
import PinballPanel from './PinballPanel.vue'
import ProbabilityAuditPanel from './chance/ProbabilityAuditPanel.vue'

const gacha = useGachaStore()
const nav = useNavigationStore()
const currentPool = ref(PERMANENT_POOL_ID)
const pool = computed(() => GACHA_POOLS[currentPool.value])
const results = ref<any[]>([])
const showResults = ref(false)
const pity = computed(() => gacha.getPityProgress(currentPool.value))
const canFree = computed(() => gacha.canClaimDailyFree(currentPool.value))
const decisionHint = computed(() => getGachaDecisionHint(pool.value.name, pity.value, canFree.value))
const previewAudit = computed(() => gacha.getProbabilityPreview(currentPool.value, 10))
const lastPullAudit = computed(() => gacha.getLastPullAudit(currentPool.value))
const currentAudit = computed(() => lastPullAudit.value ?? previewAudit.value)
const showAuditResult = computed(() => Boolean(lastPullAudit.value))

function switchPool(id: string) {
  currentPool.value = id
}

function doPull(count: 1 | 10) {
  const r = gacha.pull(currentPool.value, count)
  results.value = r
  showResults.value = true
}

function claimFree() {
  const r = gacha.claimDailyFree(currentPool.value)
  if (r) {
    results.value = [r]
    showResults.value = true
  }
}

function openMonopoly() {
  nav.selectPrimary('resources')
  nav.selectSecondary('monopoly')
}
</script>

<template>
  <div class="gacha-tab">
    <section class="probability-note">
      这些玩法不会直接改变最终抽卡规则，只提供可审计的临时 modifier、保底进度和资源补给。
    </section>

    <section class="gacha-section">
      <div class="section-heading">
        <span>抽卡</span>
        <strong>抽卡池 + 柏青哥十连 modifier</strong>
      </div>
      <div class="pool-tabs">
        <button
          :class="{ active: currentPool === PERMANENT_POOL_ID }"
          @click="switchPool(PERMANENT_POOL_ID)"
        >常驻奖池</button>
        <button
          :class="{ active: currentPool === LIMITED_POOL_ID }"
          @click="switchPool(LIMITED_POOL_ID)"
        >限定奖池·深渊征服者</button>
      </div>

      <div class="pool-info">
        <p>{{ pool.description }}</p>
        <div class="gacha-decision">
          <div><span>保底</span><strong>{{ decisionHint.pityText }}</strong></div>
          <div><span>免费</span><strong>{{ decisionHint.freeText }}</strong></div>
          <div><span>目标</span><strong>{{ decisionHint.targetText }}</strong></div>
        </div>
        <div class="archetype-boosts">
          <span v-for="boost in decisionHint.archetypeBoosts" :key="boost.archetype">
            {{ boost.archetype }}：{{ boost.impact }}
          </span>
        </div>
        <p>保底进度：{{ pity.current }} / {{ pity.target }}</p>
        <p class="pity-rule">抽到传说后重置保底；每日免费计入保底且不消耗钻石。</p>
        <div class="pity-bar">
          <div
            class="pity-fill"
            :style="{ width: `${(pity.current / pity.target) * 100}%` }"
          ></div>
        </div>
        <p v-if="pity.bonus">处于保底加成区间！</p>
      </div>

      <div class="actions">
        <button
          class="free-btn"
          :disabled="!canFree"
          @click="claimFree"
        >
          每日免费
        </button>
        <button @click="doPull(1)">单抽 ({{ pool.cost }}钻石)</button>
        <button @click="doPull(10)">十连 (2800钻石)</button>
      </div>

      <PachinkoPanel :pool-id="currentPool" />
    </section>

    <section class="gacha-section">
      <div class="section-heading">
        <span>每日</span>
        <strong>幸运转盘</strong>
      </div>
      <LuckyWheelPanel />
    </section>

    <section class="gacha-section">
      <div class="section-heading">
        <span>活动</span>
        <strong>弹球机</strong>
      </div>
      <PinballPanel :pool-id="currentPool" />
    </section>

    <section class="gacha-section weekly-handoff">
      <div class="section-heading">
        <span>周常</span>
        <strong>资源大富翁</strong>
      </div>
      <div class="handoff-panel">
        <span>大富翁是资源页的周常长期循环，负责抽卡券、保底、流派 token 和 Boss 格战力校验。</span>
        <button @click="openMonopoly">前往资源大富翁</button>
      </div>
    </section>

    <section class="gacha-section">
      <div class="section-heading">
        <span>审计</span>
        <strong>概率详情 / 预算 / modifier</strong>
      </div>
      <ProbabilityAuditPanel
        :audit="currentAudit"
        :show-result="showAuditResult"
        :pool-id="currentPool"
        :count="10"
      />
    </section>

    <div v-if="showResults" class="results-modal">
      <div class="results">
        <div
          v-for="(r, i) in results"
          :key="i"
          :class="['result-item', r.rarity]"
        >
          {{ r.name }}
        </div>
      </div>
      <button @click="showResults = false">确定</button>
    </div>
  </div>
</template>


<style scoped>
.gacha-tab {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.probability-note,
.gacha-section {
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius-lg);
  background: var(--gradient-card);
  box-shadow: var(--shadow-sm);
}

.probability-note {
  padding: 0.75rem 0.9rem;
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  line-height: 1.5;
}

.gacha-section {
  padding: 0.9rem;
}

.section-heading {
  display: flex;
  justify-content: space-between;
  gap: 0.8rem;
  align-items: center;
  margin-bottom: 0.75rem;
}

.section-heading span {
  color: var(--color-text-muted);
  font-size: 0.66rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.section-heading strong {
  color: var(--color-text-primary);
  font-size: var(--font-size-lg);
  text-align: right;
}

.pool-tabs,
.actions {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.pool-tabs {
  margin-bottom: 0.75rem;
}

.pool-tabs button,
.actions button,
.handoff-panel button {
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius-md);
  padding: 0.52rem 0.78rem;
  background: rgba(255, 255, 255, 0.045);
  color: var(--color-text-primary);
  cursor: pointer;
  font-weight: 800;
  transition: transform var(--transition-fast), border-color var(--transition-fast), background var(--transition-fast), opacity var(--transition-fast);
}

.pool-tabs button:hover,
.actions button:hover:not(:disabled),
.handoff-panel button:hover {
  transform: translateY(-1px);
  border-color: var(--color-border-strong);
  background: rgba(255, 255, 255, 0.07);
}

.pool-tabs button.active,
.actions .free-btn:not(:disabled) {
  border-color: rgba(69, 230, 208, 0.42);
  background: rgba(69, 230, 208, 0.12);
  color: var(--color-secondary-light);
}

.actions button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.pool-info {
  padding: 0.85rem;
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius-md);
  background: rgba(7, 10, 18, 0.52);
  margin-bottom: 0.75rem;
}

.pool-info p {
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  line-height: 1.5;
}

.gacha-decision {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.5rem;
  margin: 0.7rem 0;
}

.gacha-decision div {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 0.65rem;
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius-md);
  background: rgba(255, 255, 255, 0.045);
}

.gacha-decision span {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.gacha-decision strong {
  color: var(--color-text-primary);
  font-size: var(--font-size-xs);
  line-height: 1.4;
}

.archetype-boosts {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin-bottom: 0.65rem;
}

.archetype-boosts span {
  padding: 0.25rem 0.52rem;
  border-radius: 999px;
  border: 1px solid rgba(143, 122, 255, 0.32);
  background: rgba(143, 122, 255, 0.1);
  color: var(--color-accent-light);
  font-size: var(--font-size-xs);
  font-weight: 800;
}

.pity-bar {
  height: 0.65rem;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 999px;
  overflow: hidden;
}

.pity-fill {
  height: 100%;
  background: var(--gradient-accent);
}

.weekly-handoff {
  border-color: rgba(255, 209, 102, 0.22);
}

.handoff-panel {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.8rem;
  padding: 0.8rem;
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius-md);
  background: rgba(7, 10, 18, 0.52);
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  line-height: 1.5;
}

.handoff-panel button {
  flex: 0 0 auto;
  border-color: rgba(255, 209, 102, 0.3);
  background: rgba(255, 209, 102, 0.12);
  color: var(--color-gold);
}

.results-modal {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  background: rgba(0, 0, 0, 0.68);
  z-index: 200;
  padding: 1rem;
  backdrop-filter: blur(8px);
}

.results {
  padding: 1rem;
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius-lg);
  background: var(--gradient-panel);
  min-width: min(26rem, 100%);
  max-height: 70vh;
  overflow-y: auto;
}

.result-item {
  padding: 0.55rem;
  border-bottom: 1px solid var(--color-border);
}

.legendary { color: var(--color-rarity-legend); }
.epic { color: var(--color-rarity-epic); }
.rare { color: var(--color-rarity-fine); }

@media (max-width: 700px) {
  .gacha-decision {
    grid-template-columns: 1fr;
  }

  .handoff-panel {
    align-items: stretch;
    flex-direction: column;
  }

  .handoff-panel button {
    width: 100%;
  }

  .results-modal {
    align-items: end;
    place-items: end stretch;
    background: rgba(2, 7, 17, 0.48);
    padding: 0;
  }

  .results {
    min-width: 0;
    width: 100%;
    max-height: 56vh;
    border-radius: var(--border-radius-lg) var(--border-radius-lg) 0 0;
    padding-bottom: calc(1rem + env(safe-area-inset-bottom));
  }
}
</style>
