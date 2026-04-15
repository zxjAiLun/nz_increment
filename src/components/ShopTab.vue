<script setup lang="ts">
import { usePlayerStore } from '../stores/playerStore'

const playerStore = usePlayerStore()

defineEmits<{
  (e: 'goBackLevels'): void
}>()
</script>

<template>
  <div class="shop-tab">
    <!-- 钻石商店 -->
    <section class="shop-section">
      <h2>💎 钻石商店</h2>
      <div class="shop-items">
        <div class="shop-item">
          <div class="item-info">
            <span class="item-icon">⬅️</span>
            <div class="item-details">
              <span class="item-name">返回10层</span>
              <span class="item-desc">立即返回10个怪物等级</span>
            </div>
          </div>
          <button
            :disabled="playerStore.player.diamond < 50"
            @click="$emit('goBackLevels')"
            class="buy-btn"
          >
            50💎
          </button>
        </div>
      </div>
    </section>

    <!-- 商店提示 -->
    <section class="shop-tips">
      <h3>💡 小贴士</h3>
      <ul>
        <li>装备有8种稀有度，传说以上装备可能有额外词条</li>
        <li>抽到重复装备会自动回收，获得金币</li>
        <li>练功房可以获得稳定的装备和金币收益</li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.shop-tab {
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
}

.shop-section {
  background: var(--color-bg-panel);
  padding: 1rem;
  border-radius: var(--border-radius-md);
}

.shop-section h2 {
  margin-bottom: 0.8rem;
  font-size: var(--font-size-lg);
}

.shop-items {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.shop-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: var(--color-bg-dark);
  padding: 0.8rem;
  border-radius: var(--border-radius-sm);
}

.item-info {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.item-icon {
  font-size: 1.5rem;
}

.item-details {
  display: flex;
  flex-direction: column;
}

.item-name {
  font-size: var(--font-size-md);
  color: var(--color-text-primary);
  font-weight: bold;
}

.item-desc {
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}

.buy-btn {
  background: var(--color-diamond);
  color: var(--color-bg-dark);
  border: none;
  padding: 0.4rem 0.8rem;
  cursor: pointer;
  border-radius: var(--border-radius-sm);
  font-size: var(--font-size-sm);
  font-weight: bold;
  transition: all var(--transition-fast);
}

.buy-btn:hover:not(:disabled) {
  background: var(--color-diamond-light);
  transform: translateY(-1px);
}

.buy-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.shop-tips {
  background: var(--color-bg-panel);
  padding: 1rem;
  border-radius: var(--border-radius-md);
}

.shop-tips h3 {
  font-size: var(--font-size-md);
  color: var(--color-secondary);
  margin-bottom: 0.5rem;
}

.shop-tips ul {
  list-style: none;
  padding: 0;
}

.shop-tips li {
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
  padding: 0.3rem 0;
  padding-left: 1rem;
  position: relative;
}

.shop-tips li::before {
  content: '•';
  position: absolute;
  left: 0;
  color: var(--color-accent);
}
</style>
