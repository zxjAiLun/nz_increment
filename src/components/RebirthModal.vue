<script setup lang="ts">
import { usePlayerStore } from '../stores/playerStore'
import { useMonsterStore } from '../stores/monsterStore'
import { useRebirthStore } from '../stores/rebirthStore'
import { formatNumber } from '../utils/format'
import type { RebirthUpgradeCategory } from '../types'

const props = defineProps<{
  showRebirthModal: boolean
  showRebirthShop: boolean
}>()

const emit = defineEmits<{
  close: []
  performRebirth: []
  openRebirthShop: []
  openRebirthModal: []
}>()

const playerStore = usePlayerStore()
const monsterStore = useMonsterStore()
const rebirthStore = useRebirthStore()

function onOverlayClick(e: MouseEvent) {
  if ((e.target as HTMLElement).classList.contains('modal-overlay')) {
    emit('close')
  }
}
</script>

<template>
  <div
    v-if="showRebirthModal || showRebirthShop"
    class="modal-overlay"
    @click="onOverlayClick"
  >
    <div class="rebirth-modal">
      <div class="modal-header">
        <h2 v-if="showRebirthModal">转生</h2>
        <h2 v-else>转生商店</h2>
        <button class="close-btn" @click="emit('close')">&times;</button>
      </div>

      <!-- Rebirth Info -->
      <div v-if="showRebirthModal" class="rebirth-content">
        <div class="rebirth-info">
          <p>当前难度值: <strong>{{ monsterStore.difficultyValue }}</strong></p>
          <p>可获得转生点数: <strong class="highlight">{{ rebirthStore.calculateRebirthPoints(monsterStore.difficultyValue) }}</strong></p>
          <p>已拥有转生点数: <strong class="highlight">{{ rebirthStore.rebirthPoints }}</strong></p>
          <p>累计转生次数: <strong>{{ rebirthStore.totalRebirthCount }}</strong></p>
        </div>

        <div class="rebirth-warning">
          <p>⚠️ 转生将重置以下内容：</p>
          <ul>
            <li>所有金币和钻石</li>
            <li>所有装备和物品</li>
            <li>所有角色属性和技能</li>
            <li>当前推图进度</li>
          </ul>
          <p>✅ 转生将保留：</p>
          <ul>
            <li>累计在线/离线时间</li>
            <li>转生点数和已购买的永久加成</li>
            <li>累计击杀数等统计数据</li>
          </ul>
        </div>

        <div class="rebirth-actions">
          <button
            class="rebirth-confirm-btn"
            @click="emit('performRebirth')"
            :disabled="monsterStore.difficultyValue < 10"
          >
            转生 (需要难度值 ≥ 10)
          </button>
          <button class="shop-btn" @click="emit('openRebirthShop')">
            进入转生商店
          </button>
        </div>
      </div>

      <!-- Rebirth Shop -->
      <div v-else class="shop-content">
        <div class="shop-currency">
          <span class="highlight">转生点数: {{ rebirthStore.rebirthPoints }}</span>
        </div>

        <div class="upgrade-section" v-for="category in ['tech', 'skill', 'rarity', 'permanent']" :key="category">
          <h3>{{ category === 'tech' ? '科技类' : category === 'skill' ? '技能类' : category === 'rarity' ? '稀有乘区' : '永久属性' }}</h3>
          <div class="upgrade-list">
            <div
              v-for="upgrade in rebirthStore.getUpgradesByCategory(category as RebirthUpgradeCategory)"
              :key="upgrade.id"
              class="upgrade-item"
            >
              <div class="upgrade-icon">{{ upgrade.icon }}</div>
              <div class="upgrade-info">
                <div class="upgrade-name">{{ upgrade.name }}</div>
                <div class="upgrade-desc">{{ upgrade.description }}</div>
                <div class="upgrade-level">
                  等级: {{ rebirthStore.getUpgradeLevel(upgrade.id) }} / {{ upgrade.maxLevel }}
                </div>
              </div>
              <div class="upgrade-effect">
                +{{ (upgrade.effectPerLevel * rebirthStore.getUpgradeLevel(upgrade.id)).toFixed(1) }}
              </div>
              <button
                class="buy-btn"
                :disabled="!rebirthStore.canAffordUpgrade(upgrade.id)"
                @click="rebirthStore.purchaseUpgrade(upgrade.id)"
              >
                {{ rebirthStore.getUpgradeCost(upgrade.id) }}点
              </button>
            </div>
          </div>
        </div>

        <div class="back-btn-container">
          <button class="back-btn" @click="emit('openRebirthModal')">返回转生</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
@import '../styles/design-system.css';

.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.8);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
}

.rebirth-modal {
  background: var(--color-bg-panel);
  border-radius: var(--border-radius-lg);
  padding: 1.5rem;
  max-width: 600px;
  width: 90%;
  max-height: 80vh;
  overflow-y: auto;
  border: 2px solid var(--color-accent);
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid var(--color-bg-card);
}

.modal-header h2 {
  color: var(--color-accent);
}

.close-btn {
  background: none;
  border: none;
  color: var(--color-text-muted);
  font-size: 1.5rem;
  cursor: pointer;
}

.close-btn:hover {
  color: var(--color-primary);
}

.rebirth-info {
  background: var(--color-bg-dark);
  padding: 1rem;
  border-radius: var(--border-radius-md);
  margin-bottom: 1rem;
}

.rebirth-info p {
  margin: 0.5rem 0;
}

.rebirth-info .highlight {
  color: var(--color-gold);
  font-size: 1.2rem;
}

.rebirth-warning {
  background: var(--color-bg-dark);
  padding: 1rem;
  border-radius: var(--border-radius-md);
  margin-bottom: 1rem;
}

.rebirth-warning p {
  margin: 0.5rem 0;
}

.rebirth-warning ul {
  margin-left: 1.5rem;
  color: var(--color-text-muted);
}

.rebirth-warning li {
  margin: 0.2rem 0;
}

.rebirth-actions {
  display: flex;
  gap: 0.5rem;
}

.rebirth-confirm-btn {
  flex: 1;
  background: linear-gradient(135deg, var(--color-accent), var(--color-accent-light));
  color: white;
  border: none;
  padding: 0.8rem;
  border-radius: var(--border-radius-md);
  cursor: pointer;
  font-size: var(--font-size-md);
}

.rebirth-confirm-btn:disabled {
  background: var(--color-text-disabled);
  cursor: not-allowed;
}

.shop-btn {
  background: var(--color-secondary);
  color: var(--color-bg-dark);
  border: none;
  padding: 0.8rem 1.5rem;
  border-radius: var(--border-radius-md);
  cursor: pointer;
}

.shop-content {
  max-height: 60vh;
  overflow-y: auto;
}

.shop-currency {
  text-align: center;
  font-size: var(--font-size-lg);
  margin-bottom: 1rem;
}

.shop-currency .highlight {
  color: var(--color-gold);
}

.upgrade-section {
  margin-bottom: 1rem;
}

.upgrade-section h3 {
  color: var(--color-secondary);
  margin-bottom: 0.5rem;
  font-size: var(--font-size-md);
}

.upgrade-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.upgrade-item {
  display: flex;
  align-items: center;
  background: var(--color-bg-dark);
  padding: 0.8rem;
  border-radius: var(--border-radius-sm);
  gap: 0.5rem;
}

.upgrade-icon {
  font-size: 1.5rem;
  width: 40px;
  text-align: center;
}

.upgrade-info {
  flex: 1;
}

.upgrade-name {
  font-weight: bold;
  color: var(--color-text-primary);
}

.upgrade-desc {
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}

.upgrade-level {
  font-size: var(--font-size-xs);
  color: var(--color-secondary);
}

.upgrade-effect {
  color: var(--color-secondary);
  font-weight: bold;
  min-width: 60px;
  text-align: right;
}

.buy-btn {
  background: var(--color-accent);
  color: white;
  border: none;
  padding: 0.4rem 0.8rem;
  border-radius: var(--border-radius-sm);
  cursor: pointer;
  min-width: 60px;
}

.buy-btn:disabled {
  background: var(--color-text-disabled);
  cursor: not-allowed;
}

.back-btn-container {
  margin-top: 1rem;
  text-align: center;
}

.back-btn {
  background: var(--color-bg-card);
  color: var(--color-text-primary);
  border: none;
  padding: 0.6rem 2rem;
  border-radius: var(--border-radius-md);
  cursor: pointer;
}

.back-btn:hover {
  background: var(--color-bg-dark);
}
</style>
