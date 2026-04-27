<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Equipment, StatType } from '../types'
import { EQUIPMENT_SLOT_NAMES, RARITY_COLORS, STAT_NAMES } from '../types'
import { EQUIPMENT_SETS } from '../data/equipmentSets'
import { RUNES, RUNE_SETS } from '../data/runes'
import { calculateEquipmentScore } from '../utils/calc'
import { formatNumber } from '../utils/format'
import { useEquipmentUpgradeStore } from '../stores/equipmentUpgradeStore'
import { usePlayerStore } from '../stores/playerStore'
import { useMonsterStore } from '../stores/monsterStore'
import { calculateActiveSets } from '../utils/equipmentSetCalculator'
import { compareEquipmentImpact, compareEquipmentPrecision, getEncounterMechanicInsight, getEquipmentMechanicFitRows } from '../utils/combatInsights'
import { useRefiningStore } from '../stores/refiningStore'
import { useRuneStore } from '../stores/runeStore'
import { useSetBreakthroughStore } from '../stores/setBreakthroughStore'
import { SET_BREAKTHROUGH } from '../data/equipmentSets'

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
const monsterStore = useMonsterStore()
const refiningStore = useRefiningStore()
const runeStore = useRuneStore()
const setBreakthroughStore = useSetBreakthroughStore()

// T31.4 符文镶嵌相关
const showRuneSelector = ref(false)
const selectedSlotIndex = ref(-1)

function openRuneSelector(slotIndex: number) {
  selectedSlotIndex.value = slotIndex
  showRuneSelector.value = true
}

function closeRuneSelector() {
  showRuneSelector.value = false
  selectedSlotIndex.value = -1
}

function doEmbedRune(runeId: string) {
  if (selectedSlotIndex.value < 0) return
  runeStore.embedRune(props.equipment, selectedSlotIndex.value, runeId)
  closeRuneSelector()
}

function doRemoveRune(slotIndex: number) {
  runeStore.removeRune(props.equipment, slotIndex)
}

function getRuneName(runeId: string): string {
  const rune = RUNES.find(r => r.id === runeId)
  return rune ? rune.name : runeId
}

function getRuneColor(runeId: string): string {
  const rune = RUNES.find(r => r.id === runeId)
  return rune ? rune.color : ''
}

function getRuneStat(rune: { type: string; statValue: number }): string {
  const statName = STAT_NAMES[rune.type as StatType] || rune.type
  return `${statName}+${rune.statValue}`
}

// T37.4 套装突破相关
const breakthroughSetIds = ['berserker', 'guardian', 'sorcerer', 'assassin', 'paladin']

const isBreakthroughSet = computed(() => {
  return props.equipment.setId ? breakthroughSetIds.includes(props.equipment.setId) : false
})

const breakthroughLevel = computed(() => {
  if (!props.equipment.setId) return 0
  return setBreakthroughStore.getBreakthroughLevel(props.equipment.setId)
})

const statMultiplier = computed(() => {
  if (!props.equipment.setId) return 1.0
  return setBreakthroughStore.getStatMultiplier(props.equipment.setId)
})

const nextBreakthrough = computed(() => {
  if (!props.equipment.setId || breakthroughLevel.value >= 3) return null
  return SET_BREAKTHROUGH[props.equipment.setId]?.[breakthroughLevel.value] ?? null
})

const canBreakthroughSet = computed(() => {
  if (!props.equipment.setId) return false
  return setBreakthroughStore.canBreakthrough(props.equipment.setId, playerStore.player.gold)
})

function doBreakthrough() {
  if (!props.equipment.setId || !canBreakthroughSet.value) return
  const cost = nextBreakthrough.value?.cost ?? 0
  playerStore.player.gold -= cost
  setBreakthroughStore.breakthrough(props.equipment.setId, playerStore.player.gold)
}

// T31.4 符文统计面板
const runeStats = computed(() => runeStore.getRuneStats(props.equipment))

// T31.4 符文套装统计
const runeSetCounts = computed(() => {
  const counts: Record<string, number> = {}
  for (const slot of props.equipment.runeSlots) {
    if (!slot.runeId) continue
    const rune = RUNES.find(r => r.id === slot.runeId)
    if (rune) {
      counts[rune.color] = (counts[rune.color] || 0) + 1
    }
  }
  return counts
})

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
  const percentStats = [
    'critRate',
    'critDamage',
    'lifesteal',
    'dodge',
    'accuracy',
    'critResist',
    'damageBonusI',
    'damageBonusII',
    'damageBonusIII',
    'timeWarp',
    'penetration',
    'hpRegenPercent',
    'killHealPercent',
    'blockChance',
    'blockReduction',
    'damageReduction',
    'cooldownReduction',
    'skillDamageBonus'
  ]
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

const impactRows = computed(() => compareEquipmentImpact(playerStore.player, props.equipment, props.compareTo))
const encounterInsight = computed(() =>
  getEncounterMechanicInsight(monsterStore.currentMonster, playerStore.totalStats)
)
const mechanicFitRows = computed(() =>
  getEquipmentMechanicFitRows(props.equipment, encounterInsight.value)
)
const precisionImpact = computed(() => compareEquipmentPrecision(
  playerStore.player,
  props.equipment,
  monsterStore.currentMonster,
  monsterStore.difficultyValue,
  props.compareTo,
  100
))

function formatImpactValue(value: number, suffix: string): string {
  const sign = value > 0 ? '+' : ''
  const rounded = Math.abs(value) >= 10 ? value.toFixed(0) : value.toFixed(1)
  return `${sign}${rounded}${suffix}`
}

function formatSeconds(value: number): string {
  if (!Number.isFinite(value)) return '--'
  if (value >= 60) return `${(value / 60).toFixed(1)}m`
  return `${value.toFixed(1)}s`
}

function formatSignedSeconds(value: number): string {
  const sign = value > 0 ? '+' : ''
  return `${sign}${formatSeconds(value)}`
}

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

        <div class="impact-panel">
          <h4>装备后结果</h4>
          <div
            v-for="row in impactRows"
            :key="row.label"
            class="impact-row"
            :class="{ positive: row.value > 0, negative: row.value < 0 }"
          >
            <span>{{ row.label }}</span>
            <strong>{{ formatImpactValue(row.value, row.suffix) }}</strong>
          </div>
        </div>

        <div class="impact-panel mechanic-fit-panel">
          <h4>当前机制适配</h4>
          <div class="mechanic-fit-head" :class="encounterInsight.fitTone">
            <span>{{ encounterInsight.title }}</span>
            <strong>{{ encounterInsight.fitLabel }}</strong>
          </div>

          <div v-if="mechanicFitRows.length" class="mechanic-fit-list">
            <div
              v-for="row in mechanicFitRows"
              :key="row.stat"
              class="mechanic-fit-row"
              :class="{ helpful: row.helpful, weak: !row.helpful }"
            >
              <span>{{ row.label }} +{{ formatStatValue(row.stat, row.value) }}</span>
              <strong>{{ row.reason }}</strong>
            </div>
          </div>

          <div v-else class="precision-empty">
            这件装备不直接针对当前机制，主要看 DPS / 生存 / 收益变化。
          </div>
        </div>

        <div class="impact-panel precision-panel">
          <h4>当前怪物战斗模拟</h4>
          <template v-if="precisionImpact">
            <div class="precision-grid">
              <div>
                <span>胜率</span>
                <strong :class="{ positive: precisionImpact.deltaWinRate > 0, negative: precisionImpact.deltaWinRate < 0 }">
                  {{ formatImpactValue(precisionImpact.deltaWinRate, '%') }}
                </strong>
              </div>
              <div>
                <span>TTK</span>
                <strong :class="{ positive: precisionImpact.deltaTtkSeconds > 0, negative: precisionImpact.deltaTtkSeconds < 0 }">
                  {{ formatSignedSeconds(precisionImpact.deltaTtkSeconds) }}
                </strong>
              </div>
              <div>
                <span>TTL</span>
                <strong :class="{ positive: precisionImpact.deltaTtlSeconds > 0, negative: precisionImpact.deltaTtlSeconds < 0 }">
                  {{ formatSignedSeconds(precisionImpact.deltaTtlSeconds) }}
                </strong>
              </div>
            </div>
            <div class="precision-baseline">
              <span>当前 {{ Math.round(precisionImpact.current.winRate * 100) }}% / {{ formatSeconds(precisionImpact.current.averageTtkSeconds) }}</span>
              <span>替换 {{ Math.round(precisionImpact.next.winRate * 100) }}% / {{ formatSeconds(precisionImpact.next.averageTtkSeconds) }}</span>
              <span>{{ precisionImpact.runs }} 次</span>
            </div>
          </template>
          <div v-else class="precision-empty">暂无当前怪物，先回到主线生成战斗目标。</div>
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

        <!-- T37.4 套装突破 -->
        <div v-if="isBreakthroughSet" class="set-breakthrough">
          <h4>套装突破</h4>
          <div class="breakthrough-info">
            当前突破等级: {{ breakthroughLevel }}/3
            <span class="multiplier">属性倍率: x{{ statMultiplier }}</span>
          </div>
          <div v-if="breakthroughLevel < 3" class="next-breakthrough">
            <p>下一级: {{ nextBreakthrough?.cost ?? 0 }}金币</p>
            <button class="upgrade-btn" @click="doBreakthrough()" :disabled="!canBreakthroughSet">
              突破 (+{{ breakthroughLevel + 1 }})
            </button>
          </div>
          <div v-else class="max-breakthrough">已满级</div>
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

        <!-- T31.4 符文镶嵌面板 -->
        <div class="rune-panel">
          <h4>符文镶嵌</h4>
          <div class="rune-slots">
            <div
              v-for="(slot, i) in equipment.runeSlots"
              :key="i"
              class="rune-slot"
              :class="{ empty: !slot.runeId }"
              @click="slot.runeId ? doRemoveRune(i) : openRuneSelector(i)"
            >
              <span v-if="slot.runeId" :class="getRuneColor(slot.runeId)">{{ getRuneName(slot.runeId) }}</span>
              <span v-else>+</span>
            </div>
          </div>
          <div v-if="runeStats.length > 0" class="rune-stats">
            <div v-for="s in runeStats" :key="s.stat" class="rune-stat-row">
              {{ STAT_NAMES[s.stat as StatType] || s.stat }}+{{ s.value }}
            </div>
          </div>
          <div v-if="Object.keys(runeSetCounts).length > 0" class="rune-set-info">
            <div v-for="(count, color) in runeSetCounts" :key="color" class="rune-set-item">
              <span :class="color">{{ color === 'red' ? '炽焰' : color === 'blue' ? '寒霜' : color === 'yellow' ? '雷霆' : '翡翠' }}</span>
              {{ count >= 2 ? (RUNE_SETS as Record<string, {name:string;pieces:number;effect:string}>)[color]?.effect || '' : `(${count}/2)` }}
            </div>
          </div>
        </div>
      </div>

      <div class="modal-footer">
        <button class="action-btn unequip" @click="emit('unequip')">回收</button>
        <button class="action-btn equip" @click="emit('equip', equipment)">穿戴</button>
      </div>
    </div>

    <!-- T31.4 符文选择器 -->
    <div v-if="showRuneSelector" class="rune-selector-overlay" @click.self="closeRuneSelector">
      <div class="rune-selector-modal">
        <div class="rune-selector-header">
          <span>选择符文</span>
          <button class="close-btn" @click="closeRuneSelector">x</button>
        </div>
        <div v-if="runeStore.inventory.length === 0" class="rune-selector-empty">背包中暂无符文</div>
        <div
          v-for="rune in runeStore.inventory"
          :key="rune.id"
          class="rune-item"
          :class="getRuneColor(rune.id)"
          @click="doEmbedRune(rune.id)"
        >
          <span class="rune-name">{{ getRuneName(rune.id) }}</span>
          <span class="rune-rarity">{{ rune.rarity }}</span>
          <span class="rune-stat">{{ getRuneStat(rune) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.72);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 1rem;
  backdrop-filter: blur(8px);
}

.modal-content {
  border: 1px solid var(--color-border);
  background: var(--gradient-panel);
  border-radius: var(--border-radius-lg);
  width: min(46rem, 100%);
  max-height: min(86vh, 54rem);
  overflow-y: auto;
  box-shadow: var(--shadow-lg);
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.95rem 1rem;
  border-bottom: 1px solid;
  border-color: inherit;
  background: rgba(7, 10, 18, 0.42);
}

.item-title {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.item-name {
  font-size: var(--font-size-lg);
  font-weight: bold;
  color: var(--color-text-primary, #e0e0e0);
  line-height: 1.25;
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
  padding: 0.95rem;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.7rem;
}

.info-row {
  grid-column: 1 / -1;
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

.impact-panel {
  border: 1px solid rgba(69, 230, 208, 0.24);
  border-radius: var(--border-radius-md);
  padding: 0.7rem;
  background: rgba(69, 230, 208, 0.07);
}

.impact-panel h4 {
  margin: 0 0 0.55rem;
  color: var(--color-secondary-light, #8cf4e6);
  font-size: var(--font-size-sm);
}

.impact-row {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.28rem 0;
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary, #9e9e9e);
}

.impact-row strong {
  color: var(--color-text-primary, #e0e0e0);
  font-size: var(--font-size-sm);
}

.impact-row.positive strong { color: var(--color-success); }
.impact-row.negative strong { color: var(--color-danger); }

.mechanic-fit-panel {
  border-color: rgba(143, 122, 255, 0.26);
  background: rgba(143, 122, 255, 0.07);
}

.mechanic-fit-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.7rem;
  margin-bottom: 0.5rem;
  padding: 0.48rem 0.55rem;
  border: 1px solid rgba(69, 230, 208, 0.28);
  border-radius: var(--border-radius-md);
  background: rgba(69, 230, 208, 0.08);
}

.mechanic-fit-head.warning {
  border-color: rgba(246, 173, 85, 0.34);
  background: rgba(246, 173, 85, 0.08);
}

.mechanic-fit-head.danger {
  border-color: rgba(255, 91, 110, 0.38);
  background: rgba(255, 91, 110, 0.1);
}

.mechanic-fit-head span {
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
  font-weight: 800;
  overflow-wrap: anywhere;
}

.mechanic-fit-head strong {
  color: var(--color-secondary-light);
  font-size: var(--font-size-xs);
  white-space: nowrap;
}

.mechanic-fit-head.warning strong {
  color: var(--color-warning);
}

.mechanic-fit-head.danger strong {
  color: var(--color-primary-light);
}

.mechanic-fit-list {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.mechanic-fit-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.55rem;
  padding: 0.42rem 0.5rem;
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius-sm);
  background: rgba(7, 10, 18, 0.46);
}

.mechanic-fit-row span {
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
}

.mechanic-fit-row strong {
  color: var(--color-secondary-light);
  font-size: var(--font-size-xs);
  text-align: right;
}

.mechanic-fit-row.weak strong {
  color: var(--color-warning);
}

.precision-panel {
  border-color: rgba(255, 209, 102, 0.26);
  background: rgba(255, 209, 102, 0.07);
}

.precision-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.35rem;
}

.precision-grid div {
  min-width: 0;
  padding: 0.5rem;
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius-md);
  background: rgba(7, 10, 18, 0.5);
}

.precision-grid span,
.precision-baseline,
.precision-empty {
  color: var(--color-text-muted, #9e9e9e);
  font-size: 0.72rem;
}

.precision-grid strong {
  display: block;
  margin-top: 0.2rem;
  color: var(--color-text-primary, #e0e0e0);
  font-size: var(--font-size-md);
}

.precision-grid strong.positive {
  color: var(--color-success);
}

.precision-grid strong.negative {
  color: var(--color-danger);
}

.precision-baseline {
  display: flex;
  justify-content: space-between;
  gap: 0.4rem;
  flex-wrap: wrap;
  margin-top: 0.4rem;
}

.set-info {
  border: 1px solid var(--color-border);
  background: rgba(7, 10, 18, 0.5);
  border-radius: var(--border-radius-md);
  padding: 0.65rem;
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
  border: 1px solid var(--color-border);
  background: rgba(7, 10, 18, 0.5);
  border-radius: var(--border-radius-md);
  padding: 0.65rem;
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

.stats-section,
.refining-panel,
.rune-panel,
.set-breakthrough {
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius-md);
  padding: 0.65rem;
  background: rgba(7, 10, 18, 0.42);
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

/* T37.4 套装突破 */
.set-breakthrough {
  background: var(--color-bg-dark, #1a1a2e);
  border-radius: var(--border-radius-sm, 4px);
  padding: 0.5rem;
  margin-top: 0.3rem;
}

.set-breakthrough h4 {
  font-size: 0.8rem;
  color: var(--color-gold, #ffd700);
  margin: 0 0 0.4rem 0;
}

.breakthrough-info {
  font-size: 0.8rem;
  color: var(--color-text-secondary, #9e9e9e);
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.multiplier {
  color: var(--color-secondary, #4a9eff);
  font-weight: bold;
}

.next-breakthrough {
  margin-top: 0.4rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.next-breakthrough p {
  font-size: 0.75rem;
  color: var(--color-text-muted, #9e9e9e);
  margin: 0;
}

.max-breakthrough {
  font-size: 0.8rem;
  color: var(--color-gold, #ffd700);
  background: rgba(255, 215, 0, 0.15);
  padding: 0.2rem 0.5rem;
  border-radius: 3px;
  text-align: center;
  margin-top: 0.3rem;
}

.max-badge {
  font-size: 0.75rem;
  color: var(--color-gold, #ffd700);
  background: rgba(255, 215, 0, 0.15);
  padding: 0.2rem 0.5rem;
  border-radius: 3px;
  text-align: center;
}

/* T31.4 符文镶嵌 */
.rune-panel {
  background: var(--color-bg-dark, #1a1a2e);
  border-radius: var(--border-radius-sm, 4px);
  padding: 0.5rem;
  margin-top: 0.3rem;
}

.rune-panel h4 {
  font-size: 0.8rem;
  color: var(--color-gold, #ffd700);
  margin: 0 0 0.4rem 0;
}

.rune-slots {
  display: flex;
  gap: 0.4rem;
  margin-bottom: 0.4rem;
}

.rune-slot {
  width: 48px;
  height: 48px;
  border: 1px solid var(--color-border, #2a2a4e);
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 1.2rem;
  color: var(--color-text-muted, #9e9e9e);
  background: var(--color-bg-panel, #16213e);
  transition: border-color 0.2s;
}

.rune-slot:not(.empty) {
  border-color: var(--color-secondary, #4a9eff);
}

.rune-slot.empty {
  border-style: dashed;
}

.rune-slot:hover {
  border-color: var(--color-primary, #4a9eff);
}

.rune-stats {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  margin-top: 0.3rem;
}

.rune-stat-row {
  font-size: 0.75rem;
  color: var(--color-secondary, #4a9eff);
}

.rune-set-info {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  margin-top: 0.3rem;
}

.rune-set-item {
  font-size: 0.75rem;
  color: var(--color-text-secondary, #9e9e9e);
}

/* 符文颜色 */
.rune-slot .red, .rune-item.red .rune-name { color: #ff6b6b; }
.rune-slot .blue, .rune-item.blue .rune-name { color: #74b9ff; }
.rune-slot .yellow, .rune-item.yellow .rune-name { color: #fdcb6e; }
.rune-slot .green, .rune-item.green .rune-name { color: #55efc4; }

/* T31.4 符文选择器 */
.rune-selector-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1001;
}

.rune-selector-modal {
  background: var(--color-bg-panel, #16213e);
  border-radius: var(--border-radius-md, 8px);
  width: 300px;
  max-height: 70vh;
  overflow-y: auto;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.6);
}

.rune-selector-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.6rem 0.8rem;
  border-bottom: 1px solid var(--color-bg-dark, #1a1a2e);
  color: var(--color-text-primary, #e0e0e0);
  font-weight: bold;
  font-size: 0.9rem;
}

.rune-selector-empty {
  padding: 1rem;
  text-align: center;
  color: var(--color-text-muted, #9e9e9e);
  font-size: 0.8rem;
}

.rune-item {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.5rem 0.8rem;
  cursor: pointer;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  transition: background 0.15s;
}

.rune-item:hover {
  background: rgba(74, 158, 255, 0.1);
}

.rune-item .rune-name {
  font-size: 0.85rem;
  font-weight: bold;
}

.rune-item .rune-rarity {
  font-size: 0.65rem;
  color: var(--color-text-muted, #9e9e9e);
  text-transform: capitalize;
}

.rune-item .rune-stat {
  font-size: 0.75rem;
  color: var(--color-secondary, #4a9eff);
  margin-left: auto;
}

@media (max-width: 720px) {
  .modal-overlay {
    align-items: flex-end;
    padding: 0;
  }

  .modal-content {
    width: 100%;
    max-height: 88vh;
    border-radius: var(--border-radius-lg) var(--border-radius-lg) 0 0;
  }

  .modal-body {
    grid-template-columns: 1fr;
  }

  .precision-grid {
    grid-template-columns: 1fr;
  }

  .mechanic-fit-head,
  .mechanic-fit-row {
    align-items: flex-start;
    flex-direction: column;
  }

  .mechanic-fit-row strong {
    text-align: left;
  }
}
</style>
