<script setup lang="ts">
import { computed, ref } from 'vue'
import { usePlayerStore } from '../stores/playerStore'
import { STAT_NAMES, STAT_CATEGORY, EQUIPMENT_SLOTS, EQUIPMENT_SLOT_NAMES, RARITY_COLORS, PHASE_UNLOCK, type EquipmentSlot, type StatType, type Equipment } from '../types'
import { EQUIPMENT_SETS } from '../utils/constants'
import { formatNumber } from '../utils/format'
import { calculateEquipmentScore } from '../utils/calc'
import { getEquipmentDecisionSummary, recommendStatUpgrades } from '../utils/combatInsights'
import EquipmentDetailModal from './EquipmentDetailModal.vue'

const playerStore = usePlayerStore()
const props = withDefaults(defineProps<{
  section?: 'all' | 'stats' | 'equipment'
}>(), {
  section: 'all'
})

// 详情弹窗状态
const showDetailModal = ref(false)
const selectedEquip = ref<Equipment | null>(null)
const selectedCompareEquip = ref<Equipment | null>(null)

function openEquipDetail(slot: EquipmentSlot) {
  const equip = playerStore.player.equipment[slot]
  if (equip) {
    selectedEquip.value = equip
    // 传入当前已装备的同槽位装备作为对比（可能就是自身）
    selectedCompareEquip.value = null // 对比时显示为null表示无对比
    showDetailModal.value = true
  }
}

function closeDetailModal() {
  showDetailModal.value = false
  selectedEquip.value = null
  selectedCompareEquip.value = null
}

function onEquipItem(_equip: Equipment) {
  // 装备已在父组件逻辑中处理，关闭弹窗
  closeDetailModal()
}

function onUnequipItem() {
  if (selectedEquip.value) {
    playerStore.unequipItem(selectedEquip.value.slot)
  }
  closeDetailModal()
}

function getSetName(setId: string | undefined): string {
  if (!setId) return ''
  const set = EQUIPMENT_SETS.find(s => s.id === setId)
  return set ? set.name : ''
}

const basicStats: StatType[] = ['attack', 'defense', 'maxHp', 'speed']
const advancedStats: StatType[] = ['critRate', 'critDamage', 'penetration', 'dodge', 'accuracy', 'critResist', 'damageBonusI']
const sustainStats: StatType[] = ['lifesteal', 'hpRegenPercent', 'killHealPercent', 'hitHealFlat', 'blockChance', 'blockReduction', 'damageReduction', 'cooldownReduction', 'skillDamageBonus']
const highStats: StatType[] = ['luck', 'voidDamage', 'trueDamage', 'gravityRange', 'gravityStrength', 'combo', 'damageBonusII']
const ultimateStats: StatType[] = ['timeWarp', 'massCollapse', 'dimensionTear', 'damageBonusIII']

const totalStats = computed(() => playerStore.totalStats)
const upgradeStats: StatType[] = ['attack', 'defense', 'maxHp', 'speed', 'penetration']

const statUpgradeRecommendations = computed(() => recommendStatUpgrades(
  totalStats.value,
  upgradeStats,
  stat => playerStore.getUpgradeCost(stat),
  stat => playerStore.getPointsForGold(stat),
  stat => playerStore.isStatUnlocked(stat) && playerStore.canUpgradeStat(stat)
).slice(0, 3))

const equipmentDecision = computed(() => getEquipmentDecisionSummary(totalStats.value))
const primaryBuildScore = computed(() => equipmentDecision.value.topBuildScores[0] ?? null)

const unlockedPhase = computed(() =>
  playerStore.player.unlockedPhases[playerStore.player.unlockedPhases.length - 1] || 1
)

function getUpgradeCost(stat: StatType): number {
  return playerStore.getUpgradeCost(stat)
}

function getPointsForGold(stat: StatType): number {
  return playerStore.getPointsForGold(stat)
}

function upgradeStat(stat: StatType) {
  const cost = playerStore.getUpgradeCost(stat)
  if (playerStore.player.gold >= cost) {
    playerStore.upgradeStat(stat, cost)
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

function formatDecisionNumber(value: number): string {
  if (!Number.isFinite(value)) return '--'
  return formatNumber(Math.round(value))
}

function formatDelta(value: number): string {
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(1)}%`
}
</script>

<template>
  <div class="role-tab">
    <!-- 角色属性 -->
    <section v-if="props.section !== 'equipment'" class="player-panel">
      <h2>角色属性</h2>
      <div class="phase-unlock">
        已解锁阶段: {{ unlockedPhase }}
      </div>

      <div class="decision-panel">
        <h3>升级收益推荐</h3>
        <div v-if="statUpgradeRecommendations.length" class="decision-list">
          <div v-for="item in statUpgradeRecommendations" :key="item.stat" class="decision-row">
            <div>
              <strong>优先升级 {{ item.label }}</strong>
              <span>{{ item.reason }}</span>
            </div>
            <div class="decision-metrics">
              <span>DPS {{ formatDelta(item.dpsDelta) }}</span>
              <span>生存 {{ formatDelta(item.survivalDelta) }}</span>
              <span>收益 {{ formatDelta(item.goldDelta) }}</span>
            </div>
          </div>
        </div>
        <div v-else class="decision-empty">金币不足或暂无可升级属性，先回到主线获取资源。</div>
      </div>

      <div class="stat-category">
        <h3>基础属性</h3>
        <div
          v-for="stat in basicStats"
          :key="stat"
          class="stat-row"
          :class="{ locked: !playerStore.isStatUnlocked(stat) }"
        >
          <span class="stat-name">{{ STAT_NAMES[stat] }}</span>
          <span class="stat-value">{{ formatStatValue(stat, totalStats[stat] ?? 0) }}</span>
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

      <div class="stat-category">
        <h3>进阶属性 (Ph.{{ PHASE_UNLOCK.advanced }}+)</h3>
        <div
          v-for="stat in advancedStats"
          :key="stat"
          class="stat-row"
          :class="{ locked: !playerStore.isStatUnlocked(stat) }"
        >
          <span class="stat-name">{{ STAT_NAMES[stat] }}</span>
          <span class="stat-value">{{ formatStatValue(stat, totalStats[stat] ?? 0) }}</span>
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

      <div class="stat-category">
        <h3>续航属性</h3>
        <div
          v-for="stat in sustainStats"
          :key="stat"
          class="stat-row"
          :class="{ locked: !playerStore.isStatUnlocked(stat) }"
        >
          <span class="stat-name">{{ STAT_NAMES[stat] }}</span>
          <span class="stat-value">{{ formatStatValue(stat, totalStats[stat] ?? 0) }}</span>
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

      <div class="stat-category">
        <h3>高级属性 (Ph.{{ PHASE_UNLOCK.high }}+)</h3>
        <div
          v-for="stat in highStats"
          :key="stat"
          class="stat-row"
          :class="{ locked: !playerStore.isStatUnlocked(stat) }"
        >
          <span class="stat-name">{{ STAT_NAMES[stat] }}</span>
          <span class="stat-value">{{ formatStatValue(stat, totalStats[stat] ?? 0) }}</span>
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

      <div class="stat-category">
        <h3>终极属性 (Ph.{{ PHASE_UNLOCK.ultimate }}+)</h3>
        <div
          v-for="stat in ultimateStats"
          :key="stat"
          class="stat-row"
          :class="{ locked: !playerStore.isStatUnlocked(stat) }"
        >
          <span class="stat-name">{{ STAT_NAMES[stat] }}</span>
          <span class="stat-value">{{ formatStatValue(stat, totalStats[stat] ?? 0) }}</span>
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
    </section>

    <!-- 装备栏 -->
    <section v-if="props.section !== 'stats'" class="equipment-panel">
      <div class="equipment-hero">
        <div>
          <span class="panel-kicker">Build</span>
          <h2>装备方案</h2>
          <p>当前主流派：<strong>{{ primaryBuildScore?.name || '未成型' }}</strong></p>
        </div>
        <div class="power-card">
          <span>装备战力</span>
          <strong>{{ formatNumber(getTotalPower()) }}</strong>
        </div>
      </div>

      <div class="decision-panel equipment-decision">
        <h3>装备后结果基线</h3>
        <div class="decision-kpis">
          <div><span>DPS 代理</span><strong>{{ formatDecisionNumber(equipmentDecision.dpsProxy) }}</strong></div>
          <div><span>生存代理</span><strong>{{ formatDecisionNumber(equipmentDecision.survivalProxy) }}</strong></div>
          <div><span>收益代理</span><strong>{{ formatDecisionNumber(equipmentDecision.goldPerMinuteProxy) }}</strong></div>
        </div>
        <div class="build-score-list">
          <span v-for="score in equipmentDecision.topBuildScores" :key="score.id" class="build-score-chip">
            {{ score.name }} {{ score.percent }}%
          </span>
        </div>
      </div>
      <div class="equipment-grid">
        <div
          v-for="slot in EQUIPMENT_SLOTS"
          :key="slot"
          class="equipment-slot"
          :class="{ empty: !playerStore.player.equipment[slot] }"
        >
          <div class="slot-name">{{ EQUIPMENT_SLOT_NAMES[slot] }}</div>
          <div
            v-if="playerStore.player.equipment[slot]"
            class="equipped-item"
            :style="{ borderColor: RARITY_COLORS[playerStore.player.equipment[slot]!.rarity] }"
            @click="openEquipDetail(slot)"
          >
            <div class="item-header">
              <span class="item-name">{{ playerStore.player.equipment[slot]!.name }}</span>
              <span v-if="playerStore.player.equipment[slot]!.isLocked" class="lock-icon">🔒</span>
            </div>
            <div v-if="getSetName(playerStore.player.equipment[slot]!.setId)" class="item-set">
              {{ getSetName(playerStore.player.equipment[slot]!.setId) }}
            </div>
            <div class="item-score">战力: {{ formatNumber(getEquipmentScore(slot)) }}</div>
            <div class="item-stats">
              <div v-for="stat in playerStore.player.equipment[slot]!.stats" :key="stat.type" class="item-stat">
                {{ STAT_NAMES[stat.type] }}: +{{ stat.isPercent ? stat.value.toFixed(1) + '%' : formatStatValue(stat.type, stat.value) }}
              </div>
            </div>
          </div>
          <div v-else class="empty-slot">空</div>
        </div>
      </div>
    </section>

    <!-- 装备详情弹窗 -->
    <EquipmentDetailModal
      v-if="showDetailModal && selectedEquip"
      :equipment="selectedEquip"
      :compare-to="selectedCompareEquip"
      @close="closeDetailModal"
      @equip="onEquipItem"
      @unequip="onUnequipItem"
    />
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
  border: 1px solid var(--color-border);
  background: var(--gradient-card);
  padding: 0.95rem;
  border-radius: var(--border-radius-lg);
  box-shadow: var(--shadow-sm);
}

.equipment-hero {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.8rem;
  align-items: stretch;
  margin-bottom: 0.8rem;
}

.panel-kicker {
  display: block;
  margin-bottom: 0.18rem;
  color: var(--color-text-muted);
  font-size: 0.66rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.equipment-hero h2 {
  margin: 0;
  color: var(--color-text-primary);
  font-size: var(--font-size-xl);
}

.equipment-hero p {
  margin: 0.3rem 0 0;
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
}

.equipment-hero p strong {
  color: var(--color-secondary-light);
}

.power-card {
  min-width: 8rem;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 0.2rem;
  border: 1px solid rgba(255, 209, 102, 0.24);
  border-radius: var(--border-radius-md);
  padding: 0.75rem 0.9rem;
  background: rgba(255, 209, 102, 0.08);
}

.power-card span {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.power-card strong {
  color: var(--color-gold);
  font-size: var(--font-size-lg);
  line-height: 1.1;
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

.decision-panel {
  background: rgba(7, 10, 18, 0.56);
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius-md);
  padding: 0.7rem;
  margin-bottom: 0.7rem;
}

.decision-panel h3 {
  margin: 0 0 0.5rem;
  font-size: var(--font-size-sm);
  color: var(--color-text-primary);
}

.decision-list {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.decision-row {
  display: flex;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.5rem;
  background: var(--color-bg-panel);
  border-radius: var(--border-radius-sm);
}

.decision-row div:first-child {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.decision-row strong {
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
}

.decision-row span,
.decision-empty {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.decision-metrics {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.35rem;
  min-width: 150px;
}

.decision-metrics span {
  color: var(--color-secondary);
}

.decision-kpis {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.45rem;
}

.decision-kpis div {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  padding: 0.45rem;
  border: 1px solid var(--color-border);
  background: rgba(255, 255, 255, 0.045);
  border-radius: var(--border-radius-md);
}

.decision-kpis span {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.decision-kpis strong {
  color: var(--color-secondary-light);
  font-size: var(--font-size-sm);
}

.build-score-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin-top: 0.55rem;
}

.build-score-chip {
  border: 1px solid rgba(143, 122, 255, 0.32);
  border-radius: 999px;
  padding: 0.22rem 0.5rem;
  background: rgba(143, 122, 255, 0.1);
  color: var(--color-accent-light);
  font-size: var(--font-size-xs);
  font-weight: 800;
}

.stat-category {
  margin-bottom: 0.5rem;
}

.stat-category h3 {
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  border-bottom: 1px dashed var(--color-bg-dark);
  padding-bottom: 0.2rem;
  margin-bottom: 0.3rem;
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

.equipment-panel h2 {
  margin-bottom: 0.5rem;
}

.total-power {
  font-size: var(--font-size-xs);
  color: var(--color-secondary);
  font-weight: normal;
  margin-left: 0.5rem;
}

.equipment-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
  gap: 0.65rem;
}

.equipment-slot {
  min-height: 11rem;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  border: 1px solid var(--color-border);
  background: rgba(7, 10, 18, 0.54);
  padding: 0.6rem;
  border-radius: var(--border-radius-md);
  text-align: left;
}

.equipment-slot.empty {
  opacity: 0.5;
}

.slot-name {
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  font-weight: 800;
}

.equipped-item {
  flex: 1;
  border: 1px solid;
  border-radius: var(--border-radius-md);
  padding: 0.55rem;
  background: rgba(255, 255, 255, 0.04);
  cursor: pointer;
  transition: transform var(--transition-fast), background var(--transition-fast);
}

.equipped-item:hover {
  transform: translateY(-1px);
  background: rgba(255, 255, 255, 0.065);
}

.item-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.item-name {
  color: var(--color-text-primary);
  font-weight: bold;
  font-size: var(--font-size-xs);
  overflow-wrap: anywhere;
}

.lock-icon {
  font-size: 0.5rem;
}

.item-score {
  color: var(--color-gold);
  font-size: var(--font-size-xs);
  margin-top: 0.1rem;
}

.item-stats {
  margin-top: 0.1rem;
}

.item-stat {
  color: var(--color-secondary-light);
  font-size: var(--font-size-xs);
  line-height: 1.35;
}

.item-set {
  color: var(--color-gold);
  font-size: var(--font-size-xs);
  font-weight: bold;
}

.unequip-btn {
  background: var(--color-primary);
  color: white;
  border: none;
  padding: 0.15rem;
  margin-top: 0.2rem;
  cursor: pointer;
  border-radius: var(--border-radius-sm);
  font-size: var(--font-size-xs);
  width: 100%;
}

.empty-slot {
  color: var(--color-text-disabled);
  font-size: var(--font-size-sm);
  display: grid;
  min-height: 6rem;
  place-items: center;
  border: 1px dashed var(--color-border);
  border-radius: var(--border-radius-sm);
}

@media (max-width: 720px) {
  .equipment-hero,
  .decision-kpis {
    grid-template-columns: 1fr;
  }
}
</style>
