<script setup lang="ts">
import { computed, ref } from 'vue'
import { usePlayerStore } from '../stores/playerStore'
import { PHASE_NAMES, STAT_NAMES, STAT_CATEGORY, EQUIPMENT_SLOTS, EQUIPMENT_SLOT_NAMES, RARITY_COLORS, PHASE_UNLOCK, type EquipmentSlot, type StatType } from '../types'
import { formatNumber } from '../utils/format'
import { calculateEquipmentScore } from '../utils/calc'

const playerStore = usePlayerStore()

const basicStats: StatType[] = ['attack', 'defense', 'maxHp', 'speed']
const advancedStats: StatType[] = ['critRate', 'critDamage', 'penetration', 'dodge', 'accuracy', 'critResist', 'damageBonusI']
const highStats: StatType[] = ['luck', 'voidDamage', 'trueDamage', 'gravityRange', 'gravityStrength', 'combo', 'damageBonusII']
const ultimateStats: StatType[] = ['timeWarp', 'massCollapse', 'dimensionTear', 'damageBonusIII']

const totalStats = computed(() => playerStore.totalStats)

const unlockedPhase = computed(() =>
  playerStore.player.unlockedPhases[playerStore.player.unlockedPhases.length - 1] || 1
)

function getUpgradeCost(stat: StatType): number {
  return playerStore.getUpgradeCost(stat)
}

function getPointsForGold(stat: StatType): number {
  return playerStore.getPointsForGold(stat)
}

interface StatChange {
  stat: StatType
  oldValue: number
  newValue: number
  timestamp: number
}
const statChanges = ref<StatChange[]>([])
const MAX_DISPLAY_CHANGES = 3

function showStatChange(stat: StatType, oldValue: number, newValue: number) {
  const diff = newValue - oldValue
  if (diff !== 0) {
    statChanges.value.push({
      stat,
      oldValue,
      newValue,
      timestamp: Date.now()
    })
    
    if (statChanges.value.length > MAX_DISPLAY_CHANGES) {
      statChanges.value.shift()
    }
    
    setTimeout(() => {
      const index = statChanges.value.findIndex(c => c.timestamp === Date.now())
      if (index !== -1) {
        statChanges.value.splice(index, 1)
      }
    }, 2000)
  }
}

function upgradeStat(stat: StatType) {
  const cost = playerStore.getUpgradeCost(stat)
  if (playerStore.player.gold >= cost) {
    const oldValue = totalStats.value[stat]
    playerStore.upgradeStat(stat, cost)
    showStatChange(stat, oldValue, totalStats.value[stat])
  }
}

function canUpgradeStat(stat: StatType): boolean {
  return playerStore.canUpgradeStat(stat)
}

function getStatUnlockPhase(stat: StatType): number {
  const category = STAT_CATEGORY[stat]
  return PHASE_UNLOCK[category]
}

function formatStatValue(type: StatType, value: number): string {
  const percentStats = ['critRate', 'critDamage', 'lifeSteal', 'dodge', 'accuracy', 'critResist', 'damageBonusI', 'damageBonusII', 'damageBonusIII', 'timeWarp', 'penetration']
  if (percentStats.includes(type)) {
    return value.toFixed(1) + '%'
  }
  return formatNumber(value)
}

function getEquipmentScore(slot: EquipmentSlot): number {
  const equip = playerStore.player.equipment[slot]
  return equip ? calculateEquipmentScore(equip) : 0
}

function getTotalPower(): number {
  let total = 0
  for (const slot of EQUIPMENT_SLOTS) {
    total += getEquipmentScore(slot)
  }
  return total
}

function unequipItem(slot: EquipmentSlot) {
  playerStore.unequipItem(slot)
}

function getSlotIcon(slot: EquipmentSlot): string {
  const icons: Record<EquipmentSlot, string> = {
    weapon: '⚔️',
    helmet: '🪖',
    armor: '🛡️',
    gloves: '🧤',
    boots: '👢',
    ring: '💍'
  }
  return icons[slot] || '📦'
}
</script>

<template>
  <div class="role-tab">
    <!-- 角色属性 -->
    <section class="player-panel">
      <h2>角色属性</h2>
      <div class="stat-change-notifications">
        <transition-group name="stat-change">
          <div
            v-for="change in statChanges"
            :key="change.timestamp"
            class="stat-change-item"
            :class="{
              increase: change.newValue > change.oldValue,
              decrease: change.newValue < change.oldValue
            }"
          >
            <span class="stat-change-icon">{{ change.newValue > change.oldValue ? '↑' : '↓' }}</span>
            <span class="stat-change-name">{{ STAT_NAMES[change.stat] }}</span>
            <span class="stat-change-value">
              {{ change.newValue > change.oldValue ? '+' : '' }}{{ formatStatValue(change.stat, change.newValue - change.oldValue) }}
            </span>
          </div>
        </transition-group>
      </div>
      <div class="phase-unlock">
        已解锁阶段: {{ unlockedPhase }}
      </div>

      <!-- 基础属性 -->
      <details class="stat-category basic-category" open>
        <summary class="category-header">
          <span class="category-icon">⚔️</span>
          <span class="category-title">基础属性</span>
          <span class="category-arrow">▼</span>
        </summary>
        <div class="category-content">
          <div
            v-for="stat in basicStats"
            :key="stat"
            class="stat-row"
            :class="{ locked: !playerStore.isStatUnlocked(stat) }"
          >
            <span class="stat-name">{{ STAT_NAMES[stat] }}</span>
            <span class="stat-value">{{ formatStatValue(stat, totalStats[stat]) }}</span>
            <button
              v-if="playerStore.isStatUnlocked(stat)"
              @click="upgradeStat(stat)"
              :disabled="!canUpgradeStat(stat)"
              class="upgrade-btn"
            >
              +{{ getPointsForGold(stat) }} ({{ formatNumber(getUpgradeCost(stat)) }})
            </button>
            <span v-else class="locked-indicator">Ph.{{ getStatUnlockPhase(stat) }}+</span>
          </div>
        </div>
      </details>

      <!-- 进阶属性 -->
      <details class="stat-category advanced-category">
        <summary class="category-header">
          <span class="category-icon">🛡️</span>
          <span class="category-title">进阶属性 (Ph.{{ PHASE_UNLOCK.advanced }}+)</span>
          <span class="category-arrow">▶</span>
        </summary>
        <div class="category-content">
          <div
            v-for="stat in advancedStats"
            :key="stat"
            class="stat-row"
            :class="{ locked: !playerStore.isStatUnlocked(stat) }"
          >
            <span class="stat-name">{{ STAT_NAMES[stat] }}</span>
            <span class="stat-value">{{ formatStatValue(stat, totalStats[stat]) }}</span>
            <button
              v-if="playerStore.isStatUnlocked(stat)"
              @click="upgradeStat(stat)"
              :disabled="!canUpgradeStat(stat)"
              class="upgrade-btn"
            >
              +{{ getPointsForGold(stat) }} ({{ formatNumber(getUpgradeCost(stat)) }})
            </button>
            <span v-else class="locked-indicator">Ph.{{ getStatUnlockPhase(stat) }}+</span>
          </div>
        </div>
      </details>

      <!-- 高级属性 -->
      <details class="stat-category high-category">
        <summary class="category-header">
          <span class="category-icon">💫</span>
          <span class="category-title">高级属性 (Ph.{{ PHASE_UNLOCK.high }}+)</span>
          <span class="category-arrow">▶</span>
        </summary>
        <div class="category-content">
          <div
            v-for="stat in highStats"
            :key="stat"
            class="stat-row"
            :class="{ locked: !playerStore.isStatUnlocked(stat) }"
          >
            <span class="stat-name">{{ STAT_NAMES[stat] }}</span>
            <span class="stat-value">{{ formatStatValue(stat, totalStats[stat]) }}</span>
            <button
              v-if="playerStore.isStatUnlocked(stat)"
              @click="upgradeStat(stat)"
              :disabled="!canUpgradeStat(stat)"
              class="upgrade-btn"
            >
              +{{ getPointsForGold(stat) }} ({{ formatNumber(getUpgradeCost(stat)) }})
            </button>
            <span v-else class="locked-indicator">Ph.{{ getStatUnlockPhase(stat) }}+</span>
          </div>
        </div>
      </details>

      <!-- 终极属性 -->
      <details class="stat-category ultimate-category">
        <summary class="category-header">
          <span class="category-icon">🌟</span>
          <span class="category-title">终极属性 (Ph.{{ PHASE_UNLOCK.ultimate }}+)</span>
          <span class="category-arrow">▶</span>
        </summary>
        <div class="category-content">
          <div
            v-for="stat in ultimateStats"
            :key="stat"
            class="stat-row"
            :class="{ locked: !playerStore.isStatUnlocked(stat) }"
          >
            <span class="stat-name">{{ STAT_NAMES[stat] }}</span>
            <span class="stat-value">{{ formatStatValue(stat, totalStats[stat]) }}</span>
            <button
              v-if="playerStore.isStatUnlocked(stat)"
              @click="upgradeStat(stat)"
              :disabled="!canUpgradeStat(stat)"
              class="upgrade-btn"
            >
              +{{ getPointsForGold(stat) }} ({{ formatNumber(getUpgradeCost(stat)) }})
            </button>
            <span v-else class="locked-indicator">Ph.{{ getStatUnlockPhase(stat) }}+</span>
          </div>
        </div>
      </details>
    </section>

    <!-- 装备栏 -->
    <section class="equipment-panel">
      <h2>装备栏 <span class="total-power">战力: {{ formatNumber(getTotalPower()) }}</span></h2>
      <div class="equipment-grid">
        <div
          v-for="slot in EQUIPMENT_SLOTS"
          :key="slot"
          class="equipment-slot"
          :class="{
            empty: !playerStore.player.equipment[slot],
            [slot]: true
          }"
          :style="playerStore.player.equipment[slot] ? {
            borderColor: RARITY_COLORS[playerStore.player.equipment[slot]!.rarity],
            boxShadow: `0 0 15px ${RARITY_COLORS[playerStore.player.equipment[slot]!.rarity]}40`
          } : {}"
        >
          <div class="slot-icon">
            {{ getSlotIcon(slot) }}
          </div>
          <div class="slot-name">{{ EQUIPMENT_SLOT_NAMES[slot] }}</div>
          
          <div
            v-if="playerStore.player.equipment[slot]"
            class="equipped-item"
          >
            <div class="item-header">
              <span class="item-name">{{ playerStore.player.equipment[slot]!.name }}</span>
              <span v-if="playerStore.player.equipment[slot]!.isLocked" class="lock-icon">🔒</span>
            </div>
            <div class="item-score">战力: {{ formatNumber(getEquipmentScore(slot)) }}</div>
            <div class="item-stats">
              <div v-for="stat in playerStore.player.equipment[slot]!.stats.slice(0, 2)" :key="stat.type" class="item-stat">
                <span class="stat-type">{{ STAT_NAMES[stat.type] }}</span>
                <span class="stat-value">+{{ formatStatValue(stat.type, stat.value) }}</span>
              </div>
              <div v-if="playerStore.player.equipment[slot]!.stats.length > 2" class="more-stats">
                +{{ playerStore.player.equipment[slot]!.stats.length - 2 }} 更多
              </div>
            </div>
            <button @click="unequipItem(slot)" class="unequip-btn">回收</button>
          </div>
          
          <div v-else class="empty-slot">
            <div class="empty-icon">{{ getSlotIcon(slot) }}</div>
            <div class="empty-text">未装备</div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.role-tab {
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
}

.player-panel,
.equipment-panel {
  background: var(--color-bg-panel);
  padding: 1rem;
  border-radius: var(--border-radius-md);
}

.phase-unlock {
  background: var(--color-bg-card);
  padding: 0.3rem;
  border-radius: var(--border-radius-sm);
  text-align: center;
  font-size: var(--font-size-sm);
  color: var(--color-secondary);
  margin-bottom: 0.5rem;
}

/* 属性分类折叠面板样式 */
.stat-category {
  margin-bottom: 0.75rem;
  border-radius: var(--border-radius-md);
  overflow: hidden;
}

.category-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.6rem 0.8rem;
  cursor: pointer;
  transition: all 0.2s ease;
  border-radius: var(--border-radius-md);
  user-select: none;
}

.category-header:hover {
  filter: brightness(1.1);
}

/* 基础属性样式 */
.basic-category > .category-header {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
}

/* 进阶属性样式 */
.advanced-category > .category-header {
  background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
  color: white;
}

/* 高级属性样式 */
.high-category > .category-header {
  background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);
  color: white;
}

/* 终极属性样式 */
.ultimate-category > .category-header {
  background: linear-gradient(135deg, #fa709a 0%, #fee140 100%);
  color: white;
}

.category-icon {
  font-size: 1.2rem;
}

.category-title {
  flex: 1;
  font-weight: bold;
  font-size: var(--font-size-sm);
}

.category-arrow {
  font-size: 0.8rem;
  transition: transform 0.3s ease;
}

/* details展开时的箭头旋转 */
details[open] > .category-header > .category-arrow {
  transform: rotate(180deg);
}

.category-content {
  padding: 0.5rem 0;
  animation: slideDown 0.3s ease-out;
}

@keyframes slideDown {
  from {
    opacity: 0;
    transform: translateY(-10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* 移除原来的stat-category h3样式 */
.stat-category h3 {
  display: none;
}

.stat-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.3rem;
  background: var(--color-bg-dark);
  border-radius: var(--border-radius-sm);
  margin-bottom: 0.2rem;
}

.stat-row.locked {
  opacity: 0.5;
}

.stat-name {
  flex: 1;
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

.stat-value {
  width: 80px;
  text-align: right;
  font-size: var(--font-size-sm);
  color: var(--color-secondary);
}

.upgrade-btn {
  width: 90px;
  background: var(--color-bg-card);
  color: var(--color-text-primary);
  border: none;
  padding: 0.2rem 0.3rem;
  cursor: pointer;
  border-radius: var(--border-radius-sm);
  font-size: var(--font-size-xs);
  transition: background var(--transition-fast);
}

.upgrade-btn:hover:not(:disabled) {
  background: var(--color-primary);
}

.upgrade-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.locked-indicator {
  font-size: var(--font-size-xs);
  color: var(--color-text-disabled);
  width: 90px;
  text-align: center;
}

.stat-change-notifications {
  position: fixed;
  top: 80px;
  right: 20px;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  pointer-events: none;
}

.stat-change-item {
  background: rgba(0, 0, 0, 0.85);
  padding: 0.6rem 1rem;
  border-radius: 8px;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  font-size: var(--font-size-sm);
  min-width: 180px;
}

.stat-change-item.increase {
  border-left: 3px solid #44ff44;
}

.stat-change-item.decrease {
  border-left: 3px solid #ff4444;
}

.stat-change-icon {
  font-size: 1.2rem;
  font-weight: bold;
}

.stat-change-item.increase .stat-change-icon {
  color: #44ff44;
}

.stat-change-item.decrease .stat-change-icon {
  color: #ff4444;
}

.stat-change-name {
  color: white;
  flex: 1;
}

.stat-change-value {
  font-weight: bold;
  font-family: monospace;
}

.stat-change-item.increase .stat-change-value {
  color: #44ff44;
}

.stat-change-item.decrease .stat-change-value {
  color: #ff4444;
}

.stat-change-enter-active {
  animation: slideInRight 0.3s ease-out;
}

.stat-change-leave-active {
  animation: slideOutRight 0.3s ease-in;
}

@keyframes slideInRight {
  from {
    opacity: 0;
    transform: translateX(100px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

@keyframes slideOutRight {
  from {
    opacity: 1;
    transform: translateX(0);
  }
  to {
    opacity: 0;
    transform: translateX(100px);
  }
}

/* 装备栏面板 */
.equipment-panel {
  background: var(--color-bg-panel);
  padding: 1rem;
  border-radius: var(--border-radius-md);
}

.equipment-panel h2 {
  margin-bottom: 1rem;
  display: flex;
  align-items: center;
  gap: 1rem;
}

.total-power {
  font-size: var(--font-size-sm);
  color: #ffd700;
  font-weight: bold;
}

/* 装备网格布局 */
.equipment-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1rem;
}

@media (max-width: 600px) {
  .equipment-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

/* 装备槽位 */
.equipment-slot {
  background: linear-gradient(145deg, #1a1a2e 0%, #16213e 100%);
  border: 2px dashed rgba(255, 255, 255, 0.2);
  border-radius: 12px;
  padding: 0.8rem;
  min-height: 120px;
  position: relative;
  transition: all 0.3s ease;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.equipment-slot.empty {
  opacity: 0.6;
}

.equipment-slot:hover {
  transform: translateY(-3px);
  box-shadow: 0 8px 16px rgba(0, 0, 0, 0.3);
}

.equipment-slot:not(.empty) {
  border-style: solid;
  border-width: 2px;
}

/* 槽位图标 */
.slot-icon {
  font-size: 2rem;
  margin-bottom: 0.3rem;
  filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.3));
}

.slot-name {
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  margin-bottom: 0.5rem;
  font-weight: 500;
}

/* 装备物品 */
.equipped-item {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.item-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.3rem;
}

.item-name {
  font-size: var(--font-size-sm);
  font-weight: bold;
  color: white;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lock-icon {
  font-size: 0.8rem;
}

.item-score {
  font-size: var(--font-size-xs);
  color: #ffd700;
  font-weight: bold;
}

.item-stats {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.item-stat {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.2rem;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 4px;
  font-size: var(--font-size-xs);
}

.stat-type {
  color: rgba(255, 255, 255, 0.7);
}

.stat-value {
  color: #44ff44;
  font-weight: bold;
}

.more-stats {
  font-size: var(--font-size-xs);
  color: rgba(255, 255, 255, 0.4);
  text-align: center;
  padding: 0.2rem;
}

.unequip-btn {
  background: rgba(255, 68, 68, 0.2);
  color: #ff6b6b;
  border: 1px solid rgba(255, 68, 68, 0.3);
  padding: 0.3rem;
  border-radius: 6px;
  cursor: pointer;
  font-size: var(--font-size-xs);
  transition: all 0.2s;
  margin-top: 0.3rem;
}

.unequip-btn:hover {
  background: rgba(255, 68, 68, 0.4);
  transform: scale(1.02);
}

/* 空槽位 */
.empty-slot {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  opacity: 0.5;
}

.empty-icon {
  font-size: 2rem;
  opacity: 0.4;
}

.empty-text {
  font-size: var(--font-size-xs);
  color: rgba(255, 255, 255, 0.4);
}

/* 不同装备槽位的图标颜色 */
.equipment-slot.weapon .slot-icon { filter: hue-rotate(0deg); }
.equipment-slot.helmet .slot-icon { filter: hue-rotate(30deg); }
.equipment-slot.armor .slot-icon { filter: hue-rotate(60deg); }
.equipment-slot.gloves .slot-icon { filter: hue-rotate(90deg); }
.equipment-slot.boots .slot-icon { filter: hue-rotate(120deg); }
.equipment-slot.ring .slot-icon { filter: hue-rotate(150deg); }
</style>
