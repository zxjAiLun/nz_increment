<script setup lang="ts">
import { computed } from 'vue'
import type { Equipment, StatType } from '../types'
import { EQUIPMENT_SLOT_NAMES, RARITY_COLORS, STAT_NAMES } from '../types'
import { EQUIPMENT_SETS } from '../data/equipmentSets'
import { calculateEquipmentScore } from '../utils/calc'
import { formatNumber } from '../utils/format'
import { useEquipmentUpgradeStore } from '../stores/equipmentUpgradeStore'
import { usePlayerStore } from '../stores/playerStore'
import { calculateActiveSets } from '../utils/equipmentSetCalculator'
import { useRefiningStore } from '../stores/refiningStore'

const props = defineProps<{
  equipment: Equipment
  /** 对比的装备（当前已装备的同槽位装备） */
  compareTo?: Equipment | null
}>()

const emit = defineEmits<{
  close: []
  equip: [Equipment]
  unequip: []
}>()

const equipmentUpgrade = useEquipmentUpgradeStore()
const playerStore = usePlayerStore()
const refiningStore = useRefiningStore()

const canRefine = computed(() => refiningStore.canRefine(props.equipment, playerStore.player.gold))

function doRefine() {
  if (!canRefine.value) return
  const cost = refiningStore.getRefiningCost(props.equipment.refiningLevel)
  playerStore.player.gold -= cost
  refiningStore.refine(props.equipment, playerStore.player.gold)
}

const score = computed(() => calculateEquipmentScore(props.equipment))

const setInfo = computed(() => {
  if (!props.equipment.setId) return null
  return EQUIPMENT_SETS.find(s => s.id === props.equipment.setId) ?? null
})

// Active set bonuses from player's current equipment
const activeSetBonuses = computed(() => calculateActiveSets(playerStore.player.equipment))

function formatStatValue(type: StatType | string, value: number, isPercent?: boolean): string {
  if (isPercent) return value.toFixed(1) + '%'
  const percentStats = ['critRate', 'critDamage', 'dodge', 'accuracy', 'critResist', 'damageBonusI', 'damageBonusII', 'damageBonusIII', 'timeWarp', 'penetration']
  if (percentStats.includes(type as string)) {
    return value.toFixed(1) + '%'
  }
  return formatNumber(value)
}

/** 比较两件装备的属性差异 */
function compareEquip(a: Equipment, b: Equipment | null | undefined): Record<string, { a: number; b: number; isPercent?: boolean }> {
  const diff: Record<string, { a: number; b: number; isPercent?: boolean }> = {}
  for (const affix of a.stats) {
    diff[affix.type] = { a: affix.value, b: 0, isPercent: affix.isPercent }
  }
  if (b) {
    for (const affix of b.stats) {
      if (diff[affix.type]) {
        diff[affix.type].b = affix.value
      } else {
        diff[affix.type] = { a: 0, b: affix.value, isPercent: affix.isPercent }
      }
    }
  }
  return diff
}

const comparison = computed(() => {
  if (!props.compareTo) return null
  return compareEquip(props.equipment, props.compareTo)
})

const scoreDiff = computed(() => {
  if (!props.compareTo) return null
  const diff = score.value - calculateEquipmentScore(props.compareTo)
  return diff
})

/**
 * 升级词缀
 */
function upgradeAffix(statKey: string) {
  const affixIndex = props.equipment.affixes.findIndex(a => a.stat === statKey)
  if (affixIndex === -1) return
  const affix = props.equipment.affixes[affixIndex]
  if (!affix.isUpgradeable) return
  const cost = equipmentUpgrade.calculateUpgradeCost(affix.value, affix.upgradeLevel)
  if (playerStore.player.gold < cost) return
  equipmentUpgrade.upgradeAffix(props.equipment, affixIndex, playerStore.player.gold)
  playerStore.player.gold -= cost
}

/**
 * 获取词缀升级信息
 */
function getUpgradeInfo(statKey: string) {
  const affix = props.equipment.affixes.find(a => a.stat === statKey)
  if (!affix) return null
  return equipmentUpgrade.getAffixUpgradeInfo(affix)
}
</script>

<template>
  <div class="modal-overlay" @click.self="emit('close')">
    <div class="modal-content">
      <div class="modal-header" :style="{ borderColor: RARITY_COLORS[equipment.rarity] }">
        <div class="item-title">
          <span class="item-name">{{ equipment.name }}</span>
          <span class="item-rarity" :style="{ color: RARITY_COLORS[equipment.rarity] }">
            {{ equipment.rarity }}
          </span>
        </div>
        <button class="close-btn" @click="emit('close')">x</button>
      </div>

      <div class="modal-body">
        <!-- 基本信息 -->
        <div class="info-row">
          <span class="info-label">等级:</span>
          <span class="info-value">{{ equipment.level }}</span>
          <span class="info-label" style="margin-left:1rem">槽位:</span>
          <span class="info-value">{{ EQUIPMENT_SLOT_NAMES[equipment.slot] }}</span>
        </div>

        <div class="info-row">
          <span class="info-label">战力:</span>
          <span class="info-value score">{{ formatNumber(score) }}</span>
          <span v-if="scoreDiff !== null" class="score-diff" :class="{ positive: scoreDiff > 0, negative: scoreDiff < 0 }">
            {{ scoreDiff > 0 ? '+' : '' }}{{ scoreDiff }}
          </span>
        </div>

        <!-- 套装信息 -->
        <div v-if="setInfo" class="set-info">
          <span class="set-name">{{ setInfo.name }}</span>
          <div class="set-bonus">
            <div class="bonus-item">2件: {{ setInfo.effects[2]?.description }}</div>
            <div class="bonus-item">3件: {{ setInfo.effects[3]?.description }}</div>
            <div class="bonus-item">5件: {{ setInfo.effects[5]?.description }}</div>
          </div>
        </div>

        <!-- 套装效果面板 -->
        <div v-if="activeSetBonuses.length > 0" class="set-bonus-panel">
          <h4>已激活套装</h4>
          <div
            v-for="bonus in activeSetBonuses"
            :key="bonus.setId + bonus.tier"
            class="set-bonus-item"
          >
            <span class="set-name">{{ bonus.setName }}</span>
            <span class="set-tier">{{ bonus.tier }}件套</span>
            <span class="set-desc">{{ bonus.effect.description }}</span>
          </div>
        </div>
        <div v-else class="set-bonus-panel">
          <h4>已激活套装</h4>
          <div class="no-sets">未激活套装</div>
        </div>

        <!-- 词条列表 / 对比 -->
        <div class="stats-section">
          <h4>词条</h4>
          <div v-if="comparison" class="compare-hint">对比已装备装备</div>
          <div
            v-for="(diff, stat) in (comparison || equipment.stats.reduce((acc, s) => ({ ...acc, [s.type]: { a: s.value, b: 0, isPercent: s.isPercent } }), {} as Record<string, { a: number; b: number; isPercent?: boolean }>))"
            :key="stat"
            class="stat-row"
            :class="{
              'stat-better': comparison && diff.a > diff.b,
              'stat-worse': comparison && diff.a < diff.b,
            }"
          >
            <span class="stat-name">{{ STAT_NAMES[stat as StatType] || stat }}</span>
            <div class="stat-values">
              <span class="stat-val current">+{{ formatStatValue(stat as StatType, diff.a, diff.isPercent) }}</span>
              <span v-if="comparison && diff.b !== 0" class="stat-val compare">
                vs +{{ formatStatValue(stat as StatType, diff.b, diff.isPercent) }}
              </span>
              <span v-if="comparison && diff.a > diff.b" class="diff-arrow up">^</span>
              <span v-if="comparison && diff.a < diff.b" class="diff-arrow down">v</span>
              <!-- 升级按钮 -->
              <template v-if="getUpgradeInfo(stat as string)">
                <template v-if="getUpgradeInfo(stat as string)?.canUpgrade">
                  <span class="upgrade-level">Lv.{{ equipment.affixes.find(a => a.stat === stat)?.upgradeLevel || 0 }}</span>
                  <button
                    class="upgrade-btn"
                    :disabled="playerStore.player.gold < (getUpgradeInfo(stat as string)?.nextCost || 0)"
                    @click="upgradeAffix(stat as string)"
                  >
                    升级 ({{ getUpgradeInfo(stat as string)?.nextCost }}金币)
                  </button>
                </template>
                <span v-else class="locked-badge">锁定</span>
              </template>
            </div>
          </div>
        </div>

        <!-- 精炼面板 -->
        <div class="refining-panel">
          <h4>精炼等级: {{ equipment.refiningLevel }}/15</h4>
          <div class="refining-slots">
            <div v-if="equipment.refiningSlots.length === 0" class="no-slots">暂无精炼词缀</div>
            <div
              v-for="slot in equipment.refiningSlots"
              :key="slot.index"
              class="refining-slot"
            >
              {{ STAT_NAMES[slot.stat as StatType] || slot.stat }} +{{ slot.value }}
            </div>
            <button
              v-if="equipment.refiningLevel < 15"
              class="upgrade-btn"
              :disabled="!canRefine"
              @click="doRefine"
            >
              精炼 (+{{ refiningStore.getRefiningCost(equipment.refiningLevel) }}金币)
            </button>
            <span v-else class="max-badge">已达最大</span>
          </div>
        </div>
      </div>

      <div class="modal-footer">
        <button class="action-btn unequip" @click="emit('unequip')">回收</button>
        <button class="action-btn equip" @click="emit('equip', equipment)">穿戴</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-content {
  background: var(--color-bg-panel, #16213e);
  border-radius: var(--border-radius-md, 8px);
  width: 360px;
  max-height: 80vh;
  overflow-y: auto;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.8rem;
  border-bottom: 2px solid;
  border-color: inherit;
}

.item-title {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.item-name {
  font-size: 1rem;
  font-weight: bold;
  color: var(--color-text-primary, #e0e0e0);
}

.item-rarity {
  font-size: 0.75rem;
  text-transform: capitalize;
}

.close-btn {
  background: transparent;
  border: none;
  color: var(--color-text-muted, #9e9e9e);
  font-size: 1.2rem;
  cursor: pointer;
  padding: 0 0.3rem;
}

.close-btn:hover {
  color: var(--color-text-primary, #e0e0e0);
}

.modal-body {
  padding: 0.8rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.info-row {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.85rem;
}

.info-label {
  color: var(--color-text-muted, #9e9e9e);
}

.info-value {
  color: var(--color-secondary, #4a9eff);
}

.info-value.score {
  color: var(--color-gold, #ffd700);
  font-weight: bold;
}

.score-diff {
  font-size: 0.8rem;
  margin-left: 0.3rem;
}

.score-diff.positive { color: #4caf50; }
.score-diff.negative { color: #f44336; }

.set-info {
  background: var(--color-bg-dark, #1a1a2e);
  border-radius: var(--border-radius-sm, 4px);
  padding: 0.5rem;
}

.set-name {
  color: var(--color-gold, #ffd700);
  font-size: 0.85rem;
  font-weight: bold;
}

.set-bonus {
  margin-top: 0.3rem;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.bonus-item {
  font-size: 0.75rem;
  color: var(--color-text-secondary, #9e9e9e);
}

.set-bonus-panel {
  background: var(--color-bg-dark, #1a1a2e);
  border-radius: var(--border-radius-sm, 4px);
  padding: 0.5rem;
}

.set-bonus-panel h4 {
  font-size: 0.8rem;
  color: var(--color-gold, #ffd700);
  margin: 0 0 0.4rem 0;
}

.set-bonus-item {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.2rem 0;
  font-size: 0.75rem;
  flex-wrap: wrap;
}

.set-bonus-item .set-name {
  color: var(--color-secondary, #4a9eff);
  font-weight: bold;
}

.set-bonus-item .set-tier {
  color: var(--color-gold, #ffd700);
  background: rgba(255, 215, 0, 0.15);
  padding: 0.05rem 0.3rem;
  border-radius: 3px;
  font-size: 0.7rem;
}

.set-bonus-item .set-desc {
  color: var(--color-text-secondary, #9e9e9e);
}

.no-sets {
  font-size: 0.75rem;
  color: var(--color-text-muted, #9e9e9e);
  font-style: italic;
}

.stats-section h4 {
  font-size: 0.8rem;
  color: var(--color-text-muted, #9e9e9e);
  margin: 0.3rem 0;
}

.compare-hint {
  font-size: 0.7rem;
  color: var(--color-text-disabled, #666);
  margin-bottom: 0.3rem;
}

.stat-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.25rem 0.3rem;
  border-radius: 3px;
  font-size: 0.8rem;
  flex-wrap: wrap;
  gap: 0.3rem;
}

.stat-row.stat-better {
  background: rgba(76, 175, 80, 0.15);
}

.stat-row.stat-worse {
  background: rgba(244, 67, 54, 0.1);
  opacity: 0.7;
}

.stat-name {
  color: var(--color-text-secondary, #9e9e9e);
}

.stat-values {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  flex-wrap: wrap;
}

.stat-val.current {
  color: var(--color-secondary, #4a9eff);
  font-weight: bold;
}

.stat-val.compare {
  color: var(--color-text-muted, #9e9e9e);
  font-size: 0.7rem;
}

.diff-arrow {
  font-size: 0.7rem;
}

.diff-arrow.up { color: #4caf50; }
.diff-arrow.down { color: #f44336; }

.upgrade-level {
  font-size: 0.7rem;
  color: var(--color-gold, #ffd700);
  background: rgba(255, 215, 0, 0.15);
  padding: 0.1rem 0.3rem;
  border-radius: 3px;
}

.upgrade-btn {
  font-size: 0.65rem;
  padding: 0.15rem 0.4rem;
  background: var(--color-gold, #ffd700);
  color: #1a1a2e;
  border: none;
  border-radius: 3px;
  cursor: pointer;
  font-weight: bold;
  transition: filter 0.2s;
}

.upgrade-btn:hover:not(:disabled) {
  filter: brightness(1.1);
}

.upgrade-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.locked-badge {
  font-size: 0.65rem;
  padding: 0.1rem 0.3rem;
  background: rgba(158, 158, 158, 0.2);
  color: var(--color-text-muted, #9e9e9e);
  border-radius: 3px;
}

.modal-footer {
  display: flex;
  gap: 0.5rem;
  padding: 0.8rem;
  border-top: 1px solid var(--color-bg-dark, #1a1a2e);
}

.action-btn {
  flex: 1;
  padding: 0.5rem;
  border: none;
  border-radius: var(--border-radius-sm, 4px);
  cursor: pointer;
  font-size: 0.85rem;
  transition: background var(--transition-fast, 0.2s);
}

.action-btn.unequip {
  background: var(--color-bg-dark, #1a1a2e);
  color: var(--color-text-secondary, #9e9e9e);
}

.action-btn.unequip:hover {
  background: #2a2a3e;
}

.action-btn.equip {
  background: var(--color-primary, #4a9eff);
  color: white;
}

.action-btn.equip:hover {
  filter: brightness(1.1);
}

.refining-panel {
  background: var(--color-bg-dark, #1a1a2e);
  border-radius: var(--border-radius-sm, 4px);
  padding: 0.5rem;
  margin-top: 0.3rem;
}

.refining-panel h4 {
  font-size: 0.8rem;
  color: var(--color-gold, #ffd700);
  margin: 0 0 0.4rem 0;
}

.refining-slots {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.refining-slot {
  font-size: 0.8rem;
  color: var(--color-secondary, #4a9eff);
  padding: 0.15rem 0.3rem;
  background: rgba(74, 158, 255, 0.1);
  border-radius: 3px;
}

.no-slots {
  font-size: 0.75rem;
  color: var(--color-text-muted, #9e9e9e);
  font-style: italic;
}

.max-badge {
  font-size: 0.75rem;
  color: var(--color-gold, #ffd700);
  background: rgba(255, 215, 0, 0.15);
  padding: 0.2rem 0.5rem;
  border-radius: 3px;
  text-align: center;
}
</style>
