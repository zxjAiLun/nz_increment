<script setup lang="ts">
import { useMerchantStore } from '../stores/merchantStore'

const merchant = useMerchantStore()

function getRarityClass(rarity: string) {
  if (rarity === 'legend') return '#f59e0b'
  if (rarity === 'epic') return '#a855f7'
  if (rarity === 'rare') return '#4a9eff'
  return '#888'
}
</script>

<template>
  <div class="merchant-tab">
    <div class="merchant-header">
      <h2>神秘商人</h2>
      <div class="refresh-cost">刷新: {{ merchant.refreshCost }}金币</div>
    </div>

    <div v-if="merchant.discountActive" class="discount-banner">
      限时折扣进行中! 全场7折
    </div>

    <div class="item-list">
      <div v-for="item in merchant.currentItems" :key="item.id" class="merchant-item"
           :style="{ borderLeftColor: getRarityClass(item.rarity) }">
        <div class="item-info">
          <div class="item-name">{{ item.name }}</div>
          <div class="item-type">{{ item.type }} · {{ item.rarity }}</div>
        </div>
        <div class="item-price">
          <span v-if="item.discountedPrice" class="original">{{ item.originalPrice }}</span>
          <span class="final">{{ item.discountedPrice || item.originalPrice }}金币</span>
        </div>
        <div class="item-stock" v-if="item.stock > 0">库存: {{ item.stock }}</div>
        <div class="item-stock sold-out" v-else>已售罄</div>
        <button
          @click="merchant.buyItem(item.id)"
          :disabled="item.stock === 0">
          购买
        </button>
      </div>
    </div>

    <div class="actions">
      <button @click="merchant.refresh()" class="refresh-btn">
        刷新商品
      </button>
      <button v-if="merchant.refreshCountdown > 0" class="countdown" disabled>
        {{ merchant.refreshCountdown }}秒后自动刷新
      </button>
    </div>
  </div>
</template>

<style scoped>
.merchant-tab { padding: 16px; }
.merchant-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.refresh-cost { font-size: 14px; color: var(--color-text-secondary); }
.discount-banner {
  background: linear-gradient(135deg, #f59e0b, #ef4444);
  color: white;
  text-align: center;
  padding: 12px;
  border-radius: 8px;
  font-weight: bold;
  margin-bottom: 16px;
}
.item-list { display: flex; flex-direction: column; gap: 12px; margin-bottom: 16px; }
.merchant-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  background: var(--color-bg-panel);
  border-radius: 12px;
  border-left: 4px solid;
}
.item-info { flex: 1; }
.item-name { font-weight: bold; }
.item-type { font-size: 12px; color: var(--color-text-secondary); }
.item-price { text-align: center; }
.original { text-decoration: line-through; color: #888; font-size: 12px; display: block; }
.final { font-weight: bold; color: #f59e0b; font-size: 16px; }
.item-stock { font-size: 12px; color: var(--color-text-secondary); min-width: 60px; }
.sold-out { color: #ef4444; }
button {
  padding: 8px 20px;
  background: var(--color-primary);
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
}
button:disabled { background: #666; cursor: not-allowed; }
.refresh-btn { width: 100%; padding: 14px; font-size: 16px; background: #6b7280; }
.countdown { width: 100%; margin-top: 8px; background: #374151; }
</style>
