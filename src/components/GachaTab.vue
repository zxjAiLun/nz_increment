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
        <span>每日</span>
        <strong>幸运转盘</strong>
      </div>
      <LuckyWheelPanel />
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
.gacha-tab { padding: 16px; }
.probability-note { padding: 10px 12px; margin-bottom: 12px; border: 1px solid var(--color-border); border-radius: 8px; background: var(--color-bg-panel); color: var(--color-text-secondary); font-size: 13px; line-height: 1.45; }
.gacha-section { margin-bottom: 12px; }
.section-heading { display: flex; justify-content: space-between; gap: 12px; align-items: center; margin-bottom: 8px; }
.section-heading span { color: var(--color-text-muted); font-size: 12px; }
.section-heading strong { color: var(--color-primary); font-size: 14px; text-align: right; }
.pool-tabs { display: flex; gap: 8px; margin-bottom: 12px; }
.pool-tabs button, .actions button { padding: 8px 12px; border: 1px solid var(--color-border); border-radius: 8px; background: var(--color-bg-panel); color: var(--color-text-primary); cursor: pointer; }
.pool-tabs button.active { border-color: var(--color-primary); color: var(--color-primary); }
.pool-info { padding: 14px; border-radius: 12px; background: var(--color-bg-panel); margin-bottom: 12px; }
.gacha-decision { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin: 10px 0; }
.gacha-decision div { display: flex; flex-direction: column; gap: 4px; padding: 10px; border-radius: 8px; background: var(--color-bg-dark); }
.gacha-decision span { color: var(--color-text-muted); font-size: 12px; }
.gacha-decision strong { color: var(--color-text-primary); font-size: 13px; line-height: 1.4; }
.archetype-boosts { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
.archetype-boosts span { padding: 4px 8px; border-radius: 999px; border: 1px solid var(--color-primary); color: var(--color-primary); font-size: 12px; }
.pity-bar { height: 10px; background: var(--color-bg-dark); border-radius: 5px; overflow: hidden; }
.pity-fill { height: 100%; background: var(--color-primary); }
.actions { display: flex; gap: 8px; flex-wrap: wrap; }
.weekly-handoff { border-top: 1px solid var(--color-border); padding-top: 12px; }
.handoff-panel { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px; border: 1px solid var(--color-border); border-radius: 8px; background: var(--color-bg-panel); color: var(--color-text-secondary); font-size: 13px; line-height: 1.45; }
.handoff-panel button { flex: 0 0 auto; padding: 8px 12px; border: 1px solid var(--color-primary); border-radius: 6px; background: var(--color-primary); color: white; cursor: pointer; }
.results-modal { position: fixed; inset: 0; display: grid; place-items: center; background: rgba(0, 0, 0, 0.6); z-index: 200; }
.results { padding: 18px; border-radius: 12px; background: var(--color-bg-panel); min-width: 260px; }
.result-item { padding: 8px; border-bottom: 1px solid var(--color-border); }
.legendary { color: #f59e0b; }
.epic { color: #a855f7; }
.rare { color: #3b82f6; }
@media (max-width: 700px) {
  .gacha-decision { grid-template-columns: 1fr; }
  .handoff-panel { align-items: stretch; flex-direction: column; }
  .handoff-panel button { width: 100%; }
}
</style>
