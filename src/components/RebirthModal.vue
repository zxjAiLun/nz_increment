<script setup lang="ts">
import { useRebirthStore } from '../stores/rebirthStore'
import { useMonsterStore } from '../stores/monsterStore'

interface Props {
  visible: boolean
  isShop: boolean
}

defineProps<Props>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'perform'): void
  (e: 'openShop'): void
}>()

const rebirthStore = useRebirthStore()
const monsterStore = useMonsterStore()

const currentDifficulty = monsterStore.difficultyValue

function performRebirth() {
  const result = rebirthStore.performRebirth()
  emit('close')
  alert(`转生成功！获得 ${result.pointsEarned} 转生点数！`)
}

function openShop() {
  emit('openShop')
}

function close() {
  emit('close')
}
</script>

<template>
  <div v-if="visible" class="modal-overlay" @click.self="close">
    <div class="rebirth-modal">
      <div class="modal-header">
        <h2 v-if="!isShop">转生</h2>
        <h2 v-else>转生商店</h2>
        <button class="close-btn" @click="close">&times;</button>
      </div>

      <div v-if="!isShop" class="rebirth-content">
        <div class="rebirth-preview">
          <h3>📊 转生收益预览</h3>
          <div class="preview-card">
            <div class="preview-icon">⭐</div>
            <div class="preview-details">
              <div class="preview-stat">
                <span class="stat-label">可获得转生点数</span>
                <span class="stat-value highlight">
                  +{{ rebirthStore.calculateRebirthPoints(currentDifficulty) }}
                </span>
              </div>
              <div class="preview-stat">
                <span class="stat-label">预计累计点数</span>
                <span class="stat-value">
                  {{ rebirthStore.rebirthPoints + rebirthStore.calculateRebirthPoints(currentDifficulty) }}
                </span>
              </div>
            </div>
          </div>
          
          <div class="progress-section">
            <div class="progress-label">
              <span>当前难度</span>
              <span>{{ currentDifficulty }}</span>
            </div>
            <div class="progress-bar">
              <div 
                class="progress-fill" 
                :style="{ width: Math.min(currentDifficulty / 100 * 100, 100) + '%' }"
              ></div>
            </div>
            <div class="progress-milestones">
              <span>0</span>
              <span>25</span>
              <span>50</span>
              <span>75</span>
              <span>100</span>
            </div>
          </div>
        </div>
        
        <div class="rebirth-stats">
          <div class="stat-item">
            <span class="stat-label">已拥有转生点数</span>
            <span class="stat-value highlight">{{ rebirthStore.rebirthPoints }}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">累计转生次数</span>
            <span class="stat-value">{{ rebirthStore.totalRebirthCount }}</span>
          </div>
        </div>

        <div class="rebirth-warning">
          <h4>⚠️ 转生将重置以下内容：</h4>
          <ul>
            <li>💰 所有金币和钻石</li>
            <li>🎒 所有装备和物品</li>
            <li>📊 所有角色属性和技能</li>
            <li>🗺️ 当前推图进度</li>
          </ul>
          <h4>✅ 转生将保留：</h4>
          <ul>
            <li>⏱️ 累计在线/离线时间</li>
            <li>⭐ 转生点数和永久加成</li>
            <li>📈 击杀数等统计数据</li>
          </ul>
        </div>

        <div class="rebirth-actions">
          <button
            class="rebirth-confirm-btn"
            @click="performRebirth"
            :disabled="currentDifficulty < 10"
          >
            ⭐ 确认转生
          </button>
          <button class="shop-btn" @click="openShop">
            🏪 进入转生商店
          </button>
        </div>
        
        <div class="rebirth-help">
          <button class="help-btn">❓ 什么是转生？</button>
        </div>
      </div>

      <div v-else class="shop-content">
        <div class="shop-currency">
          <span class="highlight">转生点数: {{ rebirthStore.rebirthPoints }}</span>
        </div>

        <div 
          class="upgrade-section" 
          v-for="category in ['tech', 'skill', 'rarity', 'permanent']" 
          :key="category"
        >
          <h3>
            {{
              category === 'tech' ? '科技类' : 
              category === 'skill' ? '技能类' : 
              category === 'rarity' ? '稀有乘区' : 
              '永久属性'
            }}
          </h3>
          <div class="upgrade-list">
            <div
              v-for="upgrade in rebirthStore.getUpgradesByCategory(category as any)"
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
          <button class="back-btn" @click="emit('close')">返回转生</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
  backdrop-filter: blur(4px);
}

.rebirth-modal {
  background: var(--color-bg-panel, #1a1a2e);
  border-radius: 16px;
  width: 90%;
  max-width: 500px;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 12px 48px rgba(0, 0, 0, 0.5);
  border: 1px solid rgba(255, 255, 255, 0.1);
  overflow: hidden;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1.25rem 1.5rem;
  background: linear-gradient(135deg, rgba(255, 215, 0, 0.1), rgba(255, 107, 107, 0.1));
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.modal-header h2 {
  color: var(--color-gold, #ffd700);
  font-size: 1.5rem;
  margin: 0;
}

.close-btn {
  background: transparent;
  border: none;
  color: var(--color-text-muted, #888);
  font-size: 2rem;
  cursor: pointer;
  padding: 0;
  line-height: 1;
  transition: color 0.2s;
}

.close-btn:hover {
  color: var(--color-text-primary, #fff);
}

.rebirth-content,
.shop-content {
  flex: 1;
  overflow-y: auto;
  padding: 1.5rem;
}

.rebirth-preview h3,
.upgrade-section h3 {
  color: var(--color-text-primary, #fff);
  margin-bottom: 1rem;
  font-size: 1.1rem;
}

.preview-card {
  background: linear-gradient(135deg, rgba(255, 215, 0, 0.15), rgba(255, 107, 107, 0.1));
  border-radius: 12px;
  padding: 1.25rem;
  display: flex;
  gap: 1rem;
  align-items: center;
  border: 1px solid rgba(255, 215, 0, 0.2);
}

.preview-icon {
  font-size: 3rem;
}

.preview-details {
  flex: 1;
}

.preview-stat {
  display: flex;
  justify-content: space-between;
  margin-bottom: 0.5rem;
}

.preview-stat .stat-label {
  color: var(--color-text-muted, #888);
}

.preview-stat .stat-value.highlight {
  color: var(--color-gold, #ffd700);
  font-size: 1.25rem;
  font-weight: bold;
}

.progress-section {
  margin-top: 1.5rem;
}

.progress-label {
  display: flex;
  justify-content: space-between;
  margin-bottom: 0.5rem;
  color: var(--color-text-secondary, #aaa);
  font-size: 0.9rem;
}

.progress-bar {
  height: 12px;
  background: rgba(0, 0, 0, 0.4);
  border-radius: 6px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--color-primary, #4ecdc4), var(--color-accent, #ff6b6b));
  transition: width 0.3s ease;
}

.progress-milestones {
  display: flex;
  justify-content: space-between;
  margin-top: 0.25rem;
  font-size: 0.7rem;
  color: var(--color-text-muted, #666);
}

.rebirth-stats {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 1rem;
  margin: 1.5rem 0;
}

.rebirth-stats .stat-item {
  background: rgba(0, 0, 0, 0.3);
  padding: 1rem;
  border-radius: 8px;
  text-align: center;
}

.rebirth-stats .stat-label {
  display: block;
  color: var(--color-text-muted, #888);
  font-size: 0.85rem;
  margin-bottom: 0.5rem;
}

.rebirth-stats .stat-value.highlight {
  color: var(--color-gold, #ffd700);
  font-size: 1.5rem;
  font-weight: bold;
}

.rebirth-warning {
  background: rgba(255, 107, 107, 0.1);
  border-radius: 12px;
  padding: 1.25rem;
  margin: 1.5rem 0;
  border: 1px solid rgba(255, 107, 107, 0.2);
}

.rebirth-warning h4 {
  color: var(--color-accent, #ff6b6b);
  margin: 0 0 0.75rem 0;
  font-size: 0.95rem;
}

.rebirth-warning ul {
  list-style: none;
  padding: 0;
  margin: 0 0 1rem 0;
}

.rebirth-warning li {
  padding: 0.4rem 0;
  color: var(--color-text-secondary, #aaa);
  font-size: 0.9rem;
}

.rebirth-warning h4:last-child {
  color: var(--color-primary, #4ecdc4);
}

.rebirth-actions {
  display: flex;
  gap: 1rem;
  margin-top: 1.5rem;
}

.rebirth-confirm-btn {
  flex: 1;
  background: linear-gradient(135deg, var(--color-gold, #ffd700), #ff8c00);
  color: #000;
  border: none;
  padding: 1rem;
  border-radius: 8px;
  font-size: 1.1rem;
  font-weight: bold;
  cursor: pointer;
  transition: all 0.2s;
}

.rebirth-confirm-btn:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(255, 215, 0, 0.4);
}

.rebirth-confirm-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.shop-btn {
  flex: 1;
  background: var(--color-bg-card, #252542);
  color: var(--color-text-primary, #fff);
  border: 1px solid rgba(255, 255, 255, 0.1);
  padding: 1rem;
  border-radius: 8px;
  font-size: 1rem;
  cursor: pointer;
  transition: all 0.2s;
}

.shop-btn:hover {
  background: var(--color-primary, #4ecdc4);
}

.rebirth-help {
  margin-top: 1.5rem;
  text-align: center;
}

.help-btn {
  background: transparent;
  border: 1px dashed rgba(255, 255, 255, 0.2);
  color: var(--color-text-muted, #888);
  padding: 0.75rem 1.5rem;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.help-btn:hover {
  border-color: var(--color-primary, #4ecdc4);
  color: var(--color-primary, #4ecdc4);
}

.shop-content {
  padding: 1.5rem;
}

.shop-currency {
  text-align: center;
  margin-bottom: 1.5rem;
}

.shop-currency .highlight {
  color: var(--color-gold, #ffd700);
  font-size: 1.5rem;
  font-weight: bold;
}

.upgrade-section {
  margin-bottom: 2rem;
}

.upgrade-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.upgrade-item {
  background: rgba(0, 0, 0, 0.3);
  border-radius: 10px;
  padding: 1rem;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  border: 1px solid rgba(255, 255, 255, 0.05);
  transition: all 0.2s;
}

.upgrade-item:hover {
  border-color: rgba(255, 255, 255, 0.15);
  background: rgba(0, 0, 0, 0.4);
}

.upgrade-icon {
  font-size: 1.5rem;
  width: 40px;
  text-align: center;
}

.upgrade-info {
  flex: 1;
  min-width: 0;
}

.upgrade-name {
  font-weight: bold;
  color: var(--color-text-primary, #fff);
  margin-bottom: 0.25rem;
}

.upgrade-desc {
  font-size: 0.8rem;
  color: var(--color-text-muted, #888);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.upgrade-level {
  font-size: 0.75rem;
  color: var(--color-primary, #4ecdc4);
  margin-top: 0.25rem;
}

.upgrade-effect {
  color: var(--color-gold, #ffd700);
  font-weight: bold;
  font-size: 0.9rem;
  min-width: 50px;
  text-align: center;
}

.buy-btn {
  background: var(--color-primary, #4ecdc4);
  color: #000;
  border: none;
  padding: 0.5rem 0.75rem;
  border-radius: 6px;
  font-size: 0.8rem;
  font-weight: bold;
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
}

.buy-btn:hover:not(:disabled) {
  background: #6ee7df;
}

.buy-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.back-btn-container {
  margin-top: 2rem;
  text-align: center;
}

.back-btn {
  background: var(--color-bg-card, #252542);
  color: var(--color-text-primary, #fff);
  border: 1px solid rgba(255, 255, 255, 0.1);
  padding: 0.75rem 2rem;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.back-btn:hover {
  background: var(--color-primary, #4ecdc4);
  color: #000;
}
</style>
