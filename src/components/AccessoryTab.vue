<template>
  <div class="accessory-tab">
    <div class="panel-header">
      <h2>配饰</h2>
      <div class="header-stats">
        <span class="stat">
          <span class="label">材料:</span>
          <span class="value">{{ materials }}</span>
        </span>
      </div>
    </div>

    <!-- 佩戴中的配饰 -->
    <div class="equipped-section">
      <h3>已佩戴</h3>
      <div class="equipped-grid">
        <div 
          v-for="type in accessoryTypes" 
          :key="type"
          class="equipped-slot"
          :class="{ filled: equipped[type] }"
          @click="handleUnequip(type)"
        >
          <template v-if="equipped[type]">
            <div class="accessory-icon" :class="getAccessory(equipped[type])?.rarity">
              {{ getAccessoryIcon(type) }}
            </div>
            <div class="accessory-info">
              <span class="acc-name">{{ getAccessory(equipped[type])?.name }}</span>
              <span class="acc-level">Lv.{{ getAccessory(equipped[type])?.level }}</span>
            </div>
          </template>
          <template v-else>
            <div class="empty-slot">{{ getSlotIcon(type) }}</div>
            <span class="slot-label">{{ getTypeName(type) }}</span>
          </template>
        </div>
      </div>
    </div>

    <!-- 套装效果 -->
    <div v-if="activeSetBonus" class="set-bonus-section">
      <h3>套装效果</h3>
      <div class="set-bonus-card">
        <span class="set-name">{{ activeSetBonus.name }}</span>
        <div class="set-effects">
          <div 
            v-for="(bonus, idx) in activeSetBonus.bonuses" 
            :key="idx"
            class="set-effect"
            :class="{ active: getEquippedSetCount() >= bonus.pieceCount }"
          >
            {{ bonus.pieceCount }}件: {{ bonus.stat }}+{{ bonus.value }}
          </div>
        </div>
      </div>
    </div>

    <!-- 背包 -->
    <div class="inventory-section">
      <h3>背包 ({{ accessories.length }})</h3>
      <div class="accessory-grid">
        <div 
          v-for="acc in accessories" 
          :key="acc.id"
          class="accessory-item"
          :class="acc.rarity"
          @click="handleSelect(acc)"
        >
          <div class="acc-icon">{{ getAccessoryIcon(acc.type) }}</div>
          <div class="acc-details">
            <span class="acc-name">{{ acc.name }}</span>
            <span class="acc-level">Lv.{{ acc.level }}</span>
          </div>
          <div class="acc-stats">
            <span v-if="acc.stats.attack">ATK {{ acc.stats.attack }}</span>
            <span v-if="acc.stats.critRate">CRIT {{ acc.stats.critRate }}%</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 操作按钮 -->
    <div v-if="selectedAccessory" class="action-buttons">
      <button class="btn" @click="equipSelected" :disabled="!canEquip">佩戴</button>
      <button class="btn" @click="upgradeSelected">升级 (需 {{ upgradeCost }} 材料)</button>
      <button class="btn btn-secondary" @click="recycleSelected">分解 (+{{ recycleValue }} 材料)</button>
    </div>

    <!-- 右侧详情 -->
    <div v-if="selectedAccessory" class="accessory-detail">
      <h3>{{ selectedAccessory.name }}</h3>
      <div class="detail-stats">
        <div class="stat-row" v-if="selectedAccessory.stats.attack">
          <span class="stat-label">攻击力</span>
          <span class="stat-value">{{ selectedAccessory.stats.attack }}</span>
        </div>
        <div class="stat-row" v-if="selectedAccessory.stats.defense">
          <span class="stat-label">防御力</span>
          <span class="stat-value">{{ selectedAccessory.stats.defense }}</span>
        </div>
        <div class="stat-row" v-if="selectedAccessory.stats.maxHp">
          <span class="stat-label">生命值</span>
          <span class="stat-value">{{ selectedAccessory.stats.maxHp }}</span>
        </div>
        <div class="stat-row" v-if="selectedAccessory.stats.critRate">
          <span class="stat-label">暴击率</span>
          <span class="stat-value">{{ selectedAccessory.stats.critRate }}%</span>
        </div>
        <div class="stat-row" v-if="selectedAccessory.stats.critDamage">
          <span class="stat-label">暴击伤害</span>
          <span class="stat-value">{{ selectedAccessory.stats.critDamage }}%</span>
        </div>
        <div class="stat-row" v-if="selectedAccessory.stats.lifesteal">
          <span class="stat-label">生命偷取</span>
          <span class="stat-value">{{ selectedAccessory.stats.lifesteal }}%</span>
        </div>
      </div>
      <div class="exp-bar">
        <span>经验 {{ selectedAccessory.exp }} / {{ expTable[selectedAccessory.level] || 'MAX' }}</span>
        <div class="bar" :style="{ width: expPercent + '%' }"></div>
      </div>
    </div>

    <!-- 生成配饰（测试用） -->
    <div class="test-actions">
      <button class="btn btn-small" @click="generateRandom">生成随机配饰</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useAccessoryStore, ACCESSORY_SETS } from '../stores/accessoryStore'
import { usePlayerStore } from '../stores/playerStore'
import type { Accessory, AccessoryType } from '../stores/accessoryStore'

const accessoryStore = useAccessoryStore()
const playerStore = usePlayerStore()

const { accessories, equipped, expTable } = accessoryStore

const accessoryTypes: AccessoryType[] = ['ring', 'necklace', 'bracelet', 'anklet', 'earring']
const selectedAccessory = ref<Accessory | null>(null)
const materials = computed(() => playerStore.player.materials || 0)

function getAccessory(id: string): Accessory | undefined {
  return accessories.find(a => a.id === id)
}

function getAccessoryIcon(type: AccessoryType): string {
  const icons: Record<AccessoryType, string> = {
    ring: '戒',
    necklace: '链',
    bracelet: '镯',
    anklet: '铃',
    earring: '环',
  }
  return icons[type]
}

function getSlotIcon(type: AccessoryType): string {
  return getAccessoryIcon(type)
}

function getTypeName(type: AccessoryType): string {
  const names: Record<AccessoryType, string> = {
    ring: '戒指',
    necklace: '项链',
    bracelet: '手镯',
    anklet: '脚饰',
    earring: '耳环',
  }
  return names[type]
}

function getEquippedSetCount(): number {
  const equippedTypes = Object.values(equipped).map(id => accessories.find(a => a.id === id)?.type).filter(Boolean) as AccessoryType[]
  // Simplified - just return count for now
  return equippedTypes.length
}

const activeSetBonus = computed(() => {
  const equippedTypes = Object.values(equipped).map(id => accessories.find(a => a.id === id)?.type).filter(Boolean) as AccessoryType[]
  for (const set of ACCESSORY_SETS) {
    const matchingPieces = equippedTypes.filter(t => set.pieces.includes(t)).length
    if (matchingPieces >= 2) {
      return set
    }
  }
  return null
})

const upgradeCost = computed(() => {
  if (!selectedAccessory.value) return 0
  return Math.floor(10 * selectedAccessory.value.level)
})

const recycleValue = computed(() => {
  if (!selectedAccessory.value) return 0
  const rarityValue = { common: 1, rare: 3, epic: 10, legend: 30, mythic: 100 }
  return rarityValue[selectedAccessory.value.rarity] * selectedAccessory.value.level
})

const expPercent = computed(() => {
  if (!selectedAccessory.value) return 0
  const level = selectedAccessory.value.level
  const current = selectedAccessory.value.exp
  const total = expTable[level] || 1
  return Math.min(100, (current / total) * 100)
})

const canEquip = computed(() => {
  if (!selectedAccessory.value) return false
  return true
})

function handleSelect(acc: Accessory) {
  selectedAccessory.value = acc
}

function handleUnequip(type: AccessoryType) {
  if (equipped[type]) {
    accessoryStore.unequipAccessory(type)
  }
}

function equipSelected() {
  if (selectedAccessory.value) {
    accessoryStore.equipAccessory(selectedAccessory.value.id)
  }
}

function upgradeSelected() {
  if (selectedAccessory.value && materials.value >= upgradeCost.value) {
    playerStore.player.materials -= upgradeCost.value
    accessoryStore.upgradeAccessory(selectedAccessory.value.id, upgradeCost.value * 10)
  }
}

function recycleSelected() {
  if (selectedAccessory.value) {
    const value = accessoryStore.recycleAccessory(selectedAccessory.value.id)
    playerStore.player.materials += value
    selectedAccessory.value = null
  }
}

function generateRandom() {
  const acc = accessoryStore.generateAccessory()
  accessoryStore.addAccessory(acc)
}
</script>

<style scoped>
.accessory-tab {
  padding: 1rem;
  max-height: 80vh;
  overflow-y: auto;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
}

.panel-header h2 {
  margin: 0;
  font-size: 1.2rem;
}

.header-stats {
  display: flex;
  gap: 1rem;
}

.equipped-section, .inventory-section, .set-bonus-section {
  margin-bottom: 1rem;
}

.equipped-section h3, .inventory-section h3, .set-bonus-section h3 {
  font-size: 0.9rem;
  color: #888;
  margin-bottom: 0.5rem;
}

.equipped-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 0.5rem;
}

.equipped-slot {
  border: 1px solid #333;
  border-radius: 8px;
  padding: 0.5rem;
  text-align: center;
  cursor: pointer;
  transition: all 0.2s;
  background: #1a1a1a;
}

.equipped-slot:hover {
  border-color: #f0c040;
}

.equipped-slot.filled {
  border-color: #50a0f0;
  background: #1a2a3a;
}

.accessory-icon {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 0.25rem;
  font-size: 1.2rem;
}

.accessory-icon.common { background: #888; }
.accessory-icon.rare { background: #4a9; }
.accessory-icon.epic { background: #a5a; }
.accessory-icon.legend { background: #f80; color: #fff; }
.accessory-icon.mythic { background: linear-gradient(135deg, #f80, #ff0); color: #000; }

.empty-slot {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: 2px dashed #444;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 0.25rem;
  font-size: 1.2rem;
  color: #666;
}

.slot-label {
  font-size: 0.7rem;
  color: #666;
}

.accessory-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 0.5rem;
}

.accessory-item {
  border: 1px solid #333;
  border-radius: 8px;
  padding: 0.5rem;
  cursor: pointer;
  transition: all 0.2s;
  background: #1a1a1a;
}

.accessory-item:hover {
  border-color: #f0c040;
  transform: translateY(-2px);
}

.accessory-item.common { border-color: #888; }
.accessory-item.rare { border-color: #4a9; }
.accessory-item.epic { border-color: #a5a; }
.accessory-item.legend { border-color: #f80; }
.accessory-item.mythic { border-color: #ff0; }

.acc-icon {
  font-size: 1.5rem;
  margin-bottom: 0.25rem;
}

.acc-name {
  font-size: 0.8rem;
  display: block;
}

.acc-level {
  font-size: 0.7rem;
  color: #888;
}

.acc-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  margin-top: 0.25rem;
  font-size: 0.65rem;
  color: #aaa;
}

.action-buttons {
  display: flex;
  gap: 0.5rem;
  margin: 1rem 0;
  flex-wrap: wrap;
}

.btn {
  padding: 0.5rem 1rem;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  background: #50a0f0;
  color: white;
  font-size: 0.85rem;
  transition: all 0.2s;
}

.btn:hover:not(:disabled) {
  background: #70b0ff;
}

.btn:disabled {
  background: #444;
  color: #888;
  cursor: not-allowed;
}

.btn-secondary {
  background: #666;
}

.btn-small {
  padding: 0.25rem 0.5rem;
  font-size: 0.75rem;
}

.accessory-detail {
  margin-top: 1rem;
  padding: 1rem;
  background: #1a1a1a;
  border-radius: 8px;
  border: 1px solid #333;
}

.detail-stats {
  margin: 0.5rem 0;
}

.stat-row {
  display: flex;
  justify-content: space-between;
  padding: 0.25rem 0;
  border-bottom: 1px solid #2a2a2a;
}

.stat-label {
  color: #888;
}

.stat-value {
  color: #f0c040;
}

.exp-bar {
  margin-top: 0.5rem;
  font-size: 0.75rem;
  color: #888;
}

.exp-bar .bar {
  height: 4px;
  background: #50a0f0;
  border-radius: 2px;
  margin-top: 0.25rem;
}

.test-actions {
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px solid #333;
}
</style>
