<script setup lang="ts">
import { computed } from 'vue'
import { STAT_NAMES, RARITY_COLORS, type Equipment } from '../types'
import { formatNumber } from '../utils/format'
import { calculateEquipmentScore } from '../utils/calc'

const props = defineProps<{
  equipment: Equipment
  visible: boolean
}>()

const emit = defineEmits<{
  close: []
}>()

const equipmentScore = computed(() => {
  return calculateEquipmentScore(props.equipment)
})

function formatStatValue(_type: string, value: number, isPercent?: boolean): string {
  if (isPercent) {
    return value.toFixed(1) + '%'
  }
  return formatNumber(value)
}

function getRarityName(rarity: string): string {
  const names: Record<string, string> = {
    common: '普通',
    good: '优秀',
    fine: '精良',
    epic: '史诗',
    legend: '传说',
    myth: '神话',
    ancient: '上古',
    eternal: '永恒'
  }
  return names[rarity] || rarity
}

function getSlotName(slot: string): string {
  const names: Record<string, string> = {
    head: '头部',
    neck: '颈部',
    shoulder: '肩部',
    chest: '胸部',
    back: '背部',
    hand: '手部',
    waist: '腰部',
    legs: '腿部',
    leftHand: '左手',
    rightHand: '右手',
    ringLeft: '左戒指',
    ringRight: '右戒指'
  }
  return names[slot] || slot
}

function getRarityColor(rarity: string): string {
  return RARITY_COLORS[rarity as keyof typeof RARITY_COLORS] || RARITY_COLORS.common
}

function handleOverlayClick() {
  emit('close')
}

function handleModalClick(event: Event) {
  event.stopPropagation()
}
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="visible" class="modal-overlay" @click="handleOverlayClick">
        <div class="equipment-detail-modal" @click="handleModalClick">
          <div class="modal-header">
            <h2>📦 装备详情</h2>
            <button class="close-btn" @click="emit('close')">×</button>
          </div>
          
          <div class="modal-content">
            <div class="equipment-card" :style="{ borderColor: getRarityColor(equipment.rarity) }">
              <div class="card-header">
                <span class="rarity-badge" :style="{ backgroundColor: getRarityColor(equipment.rarity) }">
                  {{ getRarityName(equipment.rarity) }}
                </span>
                <span class="slot-badge">{{ getSlotName(equipment.slot) }}</span>
              </div>
              
              <h3 class="equipment-name">{{ equipment.name }}</h3>
              
              <div class="equipment-level">
                等级: Lv.{{ equipment.level }}
              </div>
              
              <div class="equipment-score">
                战力: {{ formatNumber(equipmentScore) }}
              </div>
            </div>
            
            <div class="stats-section">
              <h4>📊 属性加成</h4>
              <div class="stats-list">
                <div v-for="stat in equipment.stats" :key="stat.type" class="stat-item">
                  <span class="stat-name">{{ STAT_NAMES[stat.type as keyof typeof STAT_NAMES] || stat.type }}</span>
                  <span class="stat-value">+{{ formatStatValue(stat.type, stat.value, stat.isPercent) }}</span>
                </div>
              </div>
            </div>
            
            <div v-if="equipment.isLocked" class="lock-info">
              🔒 该装备已锁定
            </div>
          </div>
          
          <div class="modal-footer">
            <button class="close-btn-modal" @click="emit('close')">关闭</button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.8);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
  backdrop-filter: blur(5px);
}

.equipment-detail-modal {
  background: linear-gradient(145deg, #1e1e2f 0%, #151520 100%);
  border: 2px solid rgba(255, 255, 255, 0.2);
  border-radius: 16px;
  max-width: 500px;
  width: 90%;
  max-height: 80vh;
  overflow-y: auto;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1.5rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.modal-header h2 {
  color: white;
  font-size: 1.3rem;
  margin: 0;
}

.close-btn {
  background: rgba(255, 255, 255, 0.1);
  border: none;
  color: rgba(255, 255, 255, 0.6);
  font-size: 2rem;
  cursor: pointer;
  padding: 0 0.5rem;
  line-height: 1;
  border-radius: 50%;
  transition: all 0.2s;
}

.close-btn:hover {
  background: rgba(255, 255, 255, 0.2);
  color: white;
}

.modal-content {
  padding: 1.5rem;
}

.equipment-card {
  background: rgba(255, 255, 255, 0.05);
  border: 2px solid;
  border-radius: 12px;
  padding: 1.2rem;
  margin-bottom: 1.5rem;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

.card-header {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 0.8rem;
}

.rarity-badge,
.slot-badge {
  padding: 0.3rem 0.6rem;
  border-radius: 6px;
  font-size: 0.85rem;
  font-weight: bold;
  color: white;
}

.rarity-badge {
  text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.3);
}

.slot-badge {
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.8);
}

.equipment-name {
  color: white;
  font-size: 1.2rem;
  margin: 0.5rem 0;
  text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.3);
}

.equipment-level {
  color: rgba(255, 255, 255, 0.7);
  font-size: 0.9rem;
  margin: 0.5rem 0;
}

.equipment-score {
  color: #ffd700;
  font-size: 1.1rem;
  font-weight: bold;
  margin-top: 0.5rem;
  padding-top: 0.5rem;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}

.stats-section h4 {
  color: white;
  margin: 0 0 1rem 0;
  font-size: 1rem;
}

.stats-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.stat-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.6rem;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 8px;
  transition: background 0.2s;
}

.stat-item:hover {
  background: rgba(255, 255, 255, 0.1);
}

.stat-name {
  color: rgba(255, 255, 255, 0.8);
  font-size: 0.95rem;
}

.stat-value {
  color: #44ff44;
  font-size: 0.95rem;
  font-weight: bold;
}

.lock-info {
  margin-top: 1rem;
  padding: 0.8rem;
  background: rgba(255, 215, 0, 0.1);
  border: 1px solid rgba(255, 215, 0, 0.3);
  border-radius: 8px;
  color: #ffd700;
  text-align: center;
  font-size: 0.9rem;
}

.modal-footer {
  padding: 1rem 1.5rem;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  text-align: center;
}

.close-btn-modal {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border: none;
  padding: 0.8rem 2rem;
  border-radius: 8px;
  font-size: 1rem;
  font-weight: bold;
  cursor: pointer;
  transition: all 0.2s;
  box-shadow: 0 2px 8px rgba(102, 126, 234, 0.3);
}

.close-btn-modal:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
}

.close-btn-modal:active {
  transform: translateY(0);
}

/* 动画 */
.modal-enter-active {
  animation: modal-in 0.3s ease-out;
}

.modal-leave-active {
  animation: modal-out 0.2s ease-in;
}

@keyframes modal-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@keyframes modal-out {
  from {
    opacity: 1;
  }
  to {
    opacity: 0;
  }
}

.modal-enter-active .equipment-detail-modal {
  animation: modal-slide-in 0.3s ease-out;
}

.modal-leave-active .equipment-detail-modal {
  animation: modal-slide-out 0.2s ease-in;
}

@keyframes modal-slide-in {
  from {
    opacity: 0;
    transform: scale(0.9) translateY(-20px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}

@keyframes modal-slide-out {
  from {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
  to {
    opacity: 0;
    transform: scale(0.9) translateY(-20px);
  }
}

/* 滚动条样式 */
.equipment-detail-modal::-webkit-scrollbar {
  width: 8px;
}

.equipment-detail-modal::-webkit-scrollbar-track {
  background: rgba(255, 255, 255, 0.05);
}

.equipment-detail-modal::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.2);
  border-radius: 4px;
}

.equipment-detail-modal::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.3);
}
</style>
