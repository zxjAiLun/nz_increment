<script setup lang="ts">
import { ref, computed } from 'vue'
import { useGachaStore } from '@/stores/gachaStore'
import { GACHA_POOLS, PERMANENT_POOL_ID, LIMITED_POOL_ID } from '@/data/gachaPools'

const gacha = useGachaStore()
const currentPool = ref(PERMANENT_POOL_ID)
const pool = computed(() => GACHA_POOLS[currentPool.value])
const results = ref<any[]>([])
const showResults = ref(false)
const pity = computed(() => gacha.getPityProgress(currentPool.value))

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
</script>

<template>
  <div class="gacha-tab">
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
        :disabled="!gacha.canClaimDailyFree(currentPool)"
        @click="claimFree"
      >
        每日免费
      </button>
      <button @click="doPull(1)">单抽 ({{ pool.cost }}钻石)</button>
      <button @click="doPull(10)">十连 (2800钻石)</button>
    </div>

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
