<script setup lang="ts">
import { computed, ref } from 'vue'
import { usePlayerStore } from '../stores/playerStore'
import {
  buildRuneInventoryView,
  filterRuneRows,
  sortRuneRows,
  summarizeRuneRows,
  type RuneInventoryFilter,
  type RuneInventoryRow,
  type RuneInventorySortKey
} from '../utils/runeInventoryView'
import { EQUIPMENT_SLOTS, EQUIPMENT_SLOT_NAMES, STAT_NAMES } from '../types'
import type { EquipmentSlot } from '../types'
import type { Rune } from '../stores/runeStore'
import { getRuneDisplayName } from '../utils/equipmentRunes'

const playerStore = usePlayerStore()

const filter = ref<RuneInventoryFilter>({ type: 'all', rarity: 'all', status: 'all' })
const sortKey = ref<RuneInventorySortKey>('inventory')
const feedback = ref<{ kind: 'success' | 'error'; message: string } | null>(null)
const pickerRuneIndex = ref<number | null>(null)
const showPicker = ref(false)

// 只读视图：inventory + 装备 topology 派生；损坏时 ok:false
const view = computed(() => buildRuneInventoryView(playerStore.runeInventory, playerStore.player.equipment))
const isBroken = computed(() => !view.value.ok)
const rows = computed(() => (view.value.ok ? view.value.rows : []))
const filtered = computed(() => filterRuneRows(rows.value, filter.value))
const sorted = computed(() => sortRuneRows(filtered.value, sortKey.value))
const summary = computed(() => summarizeRuneRows(rows.value))

const RARITY_LABELS: Record<string, string> = {
  common: '普通',
  rare: '稀有',
  epic: '史诗',
  legend: '传说'
}
const TYPE_LABELS: Record<string, string> = {
  attack: '攻击',
  defense: '防御',
  health: '生命',
  crit: '暴击',
  speed: '速度',
  luck: '幸运'
}

const pickerRune = computed(() =>
  pickerRuneIndex.value == null ? null : rows.value[pickerRuneIndex.value] ?? null
)

const inventoryById = computed(() => {
  const m = new Map<string, Rune>()
  for (const r of playerStore.runeInventory) m.set(r.id, r)
  return m
})

// 当前已装备物品的镶嵌目标（每件装备固定三孔），供目标选择区展示
const equippedTargets = computed(() => {
  const targets: {
    slot: EquipmentSlot
    name: string
    slots: { index: number; currentRuneId: string | null; currentRuneName: string | null }[]
  }[] = []
  for (const slot of EQUIPMENT_SLOTS) {
    const eq = playerStore.player.equipment[slot]
    if (!eq) continue
    const slotViews: { index: number; currentRuneId: string | null; currentRuneName: string | null }[] = []
    for (let i = 0; i < (eq.runeSlots?.length ?? 0); i++) {
      const s = eq.runeSlots[i]
      const rid = s?.runeId ?? null
      const r = rid ? inventoryById.value.get(rid) : null
      slotViews.push({ index: i, currentRuneId: rid, currentRuneName: r ? getRuneDisplayName(r) : null })
    }
    targets.push({ slot, name: eq.name ?? EQUIPMENT_SLOT_NAMES[slot], slots: slotViews })
  }
  return targets
})

function openPicker(inventoryIndex: number) {
  pickerRuneIndex.value = inventoryIndex
  showPicker.value = true
  feedback.value = null
}

function closePicker() {
  showPicker.value = false
  pickerRuneIndex.value = null
}

function confirmEmbed(slot: EquipmentSlot, index: number) {
  const rune = pickerRune.value
  if (!rune) return
  try {
    const res = playerStore.tryEmbedEquipmentRune(slot, index, rune.rune.id)
    if (res.ok) {
      feedback.value = { kind: 'success', message: `已镶嵌：${rune.displayName}` }
      closePicker()
    } else {
      feedback.value = { kind: 'error', message: `镶嵌失败：${res.reason ?? '未知原因'}` }
    }
  } catch {
    feedback.value = { kind: 'error', message: '镶嵌操作失败' }
  }
}

function confirmRemove(row: RuneInventoryRow) {
  if (!row.binding) return
  try {
    const res = playerStore.tryRemoveEquipmentRune(row.binding.equipmentSlot, row.binding.runeSlotIndex)
    if (res.ok) {
      feedback.value = { kind: 'success', message: `已移除：${row.displayName}` }
    } else {
      feedback.value = { kind: 'error', message: `移除失败：${res.reason ?? '未知原因'}` }
    }
  } catch {
    feedback.value = { kind: 'error', message: '移除操作失败' }
  }
}
</script>

<template>
  <section class="rune-inventory" aria-label="符文仓库">
    <!-- 摘要 -->
    <div class="summary" role="group" aria-label="符文仓库摘要">
      <span>总数 {{ summary.total }}</span>
      <span>已镶嵌 {{ summary.embedded }}</span>
      <span>未镶嵌 {{ summary.unequipped }}</span>
      <span>普通 {{ summary.byRarity.common }}</span>
      <span>稀有 {{ summary.byRarity.rare }}</span>
      <span>史诗 {{ summary.byRarity.epic }}</span>
      <span>传说 {{ summary.byRarity.legend }}</span>
    </div>

    <!-- 损坏状态：隐藏/禁用所有管理按钮，不调用 reconcile、不写盘 -->
    <div v-if="isBroken" class="broken-banner" role="alert">
      符文数据或装备拓扑异常，当前无法管理
    </div>

    <template v-else>
      <!-- 筛选 + 排序 -->
      <div class="controls">
        <label>
          类型
          <select aria-label="按类型筛选" v-model="filter.type">
            <option value="all">全部</option>
            <option value="attack">攻击</option>
            <option value="defense">防御</option>
            <option value="health">生命</option>
            <option value="crit">暴击</option>
            <option value="speed">速度</option>
            <option value="luck">幸运</option>
          </select>
        </label>
        <label>
          稀有度
          <select aria-label="按稀有度筛选" v-model="filter.rarity">
            <option value="all">全部</option>
            <option value="common">普通</option>
            <option value="rare">稀有</option>
            <option value="epic">史诗</option>
            <option value="legend">传说</option>
          </select>
        </label>
        <label>
          状态
          <select aria-label="按状态筛选" v-model="filter.status">
            <option value="all">全部</option>
            <option value="embedded">已镶嵌</option>
            <option value="unequipped">未镶嵌</option>
          </select>
        </label>
        <label>
          排序
          <select aria-label="排序方式" v-model="sortKey">
            <option value="inventory">仓库顺序</option>
            <option value="rarity">稀有度</option>
            <option value="level">等级</option>
            <option value="effective">有效属性</option>
          </select>
        </label>
      </div>

      <!-- 成功 / 失败反馈 -->
      <div v-if="feedback" :class="['feedback', feedback.kind]" role="status">{{ feedback.message }}</div>

      <!-- 空结果（区分：合法空仓库 / 筛选无匹配） -->
      <div v-if="sorted.length === 0" class="empty-state">
        {{ rows.length === 0 ? '尚未获得符文' : '无匹配筛选结果' }}
      </div>

      <ul v-else class="rune-grid">
        <li v-for="row in sorted" :key="row.rune.id" class="rune-card" :data-rarity="row.rune.rarity">
          <div class="rune-head">
            <span class="rune-name">{{ row.displayName }}</span>
            <span class="rune-rarity">{{ RARITY_LABELS[row.rune.rarity] }}</span>
          </div>
          <div class="rune-stat">属性：{{ TYPE_LABELS[row.rune.type] }}（{{ STAT_NAMES[row.stat] }}）</div>
          <div class="rune-level">{{ row.experience.isMax ? `Lv.${row.rune.level} MAX` : `Lv.${row.rune.level}` }}</div>
          <div class="rune-base">基础 {{ TYPE_LABELS[row.rune.type] }} +{{ row.rune.statValue }}</div>
          <div class="rune-effective">当前 {{ TYPE_LABELS[row.rune.type] }} +{{ row.effectiveValue }}</div>
          <div class="rune-exp">经验 {{ row.experience.currentExp }} / {{ row.experience.requiredExp ?? 'MAX' }}</div>
          <div class="rune-status" :data-status="row.binding ? 'embedded' : 'unequipped'">
            <template v-if="row.binding">
              已镶嵌：{{ EQUIPMENT_SLOT_NAMES[row.binding.equipmentSlot] }} · 孔位 {{ row.binding.runeSlotIndex + 1 }}
            </template>
            <template v-else>未镶嵌</template>
          </div>
          <div class="rune-actions">
            <button
              type="button"
              :aria-label="`镶嵌或移动 ${row.displayName}`"
              @click="openPicker(row.inventoryIndex)"
            >
              {{ row.binding ? '移动' : '镶嵌' }}
            </button>
            <button
              v-if="row.binding"
              type="button"
              :aria-label="`移除 ${row.displayName}`"
              @click="confirmRemove(row)"
            >
              移除
            </button>
          </div>
        </li>
      </ul>

      <!-- 镶嵌目标选择 -->
      <div v-if="showPicker" class="picker" role="dialog" aria-label="选择镶嵌目标">
        <div class="picker-head">
          <span>镶嵌目标：{{ pickerRune?.displayName }}</span>
          <button type="button" aria-label="关闭镶嵌目标选择" @click="closePicker">关闭</button>
        </div>
        <div v-for="target in equippedTargets" :key="target.slot" class="picker-target">
          <div class="picker-target-name">{{ EQUIPMENT_SLOT_NAMES[target.slot] }} · {{ target.name }}</div>
          <div class="picker-slots">
            <button
              v-for="slotView in target.slots"
              :key="slotView.index"
              type="button"
              :aria-label="`镶嵌到 ${EQUIPMENT_SLOT_NAMES[target.slot]} 孔位 ${slotView.index + 1}${slotView.currentRuneName ? '，当前 ' + slotView.currentRuneName : ''}`"
              @click="confirmEmbed(target.slot, slotView.index)"
            >
              孔位 {{ slotView.index + 1 }}
              <span v-if="slotView.currentRuneName">（{{ slotView.currentRuneName }}）</span>
              <span v-else>（空）</span>
            </button>
          </div>
        </div>
      </div>
    </template>
  </section>
</template>

<style scoped>
@import '../styles/design-system.css';

.rune-inventory {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.summary {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

.summary span {
  background: var(--color-bg-panel);
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius-sm);
  padding: 0.25rem 0.5rem;
}

.controls {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
}

.controls label {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

.controls select {
  padding: 0.35rem 0.5rem;
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius-sm);
  background: var(--color-bg-panel);
  color: var(--color-text);
}

.feedback {
  border-radius: var(--border-radius-sm);
  padding: 0.5rem 0.7rem;
  font-size: var(--font-size-sm);
}

.feedback.success {
  background: var(--color-success-bg, #e6f9ed);
  color: var(--color-success-text, #1c7a43);
  border: 1px solid var(--color-success-border, #9fe0bd);
}

.feedback.error {
  background: var(--color-error-bg, #fdecec);
  color: var(--color-error-text, #b42323);
  border: 1px solid var(--color-error-border, #f0b4b4);
}

.broken-banner {
  background: var(--color-error-bg, #fdecec);
  color: var(--color-error-text, #b42323);
  border: 1px solid var(--color-error-border, #f0b4b4);
  border-radius: var(--border-radius-md);
  padding: 0.8rem;
  font-weight: 600;
}

.empty-state {
  padding: 1.2rem;
  text-align: center;
  color: var(--color-text-secondary);
  background: var(--color-bg-panel);
  border: 1px dashed var(--color-border);
  border-radius: var(--border-radius-md);
}

.rune-grid {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 0.75rem;
}

.rune-card {
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius-md);
  padding: 0.7rem;
  background: var(--color-bg-panel);
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  font-size: var(--font-size-sm);
}

.rune-card[data-rarity='legend'] {
  border-color: var(--color-rarity-legend, #d9a441);
}

.rune-card[data-rarity='epic'] {
  border-color: var(--color-rarity-epic, #b06fe0);
}

.rune-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 700;
}

.rune-rarity {
  font-size: var(--font-size-xs);
  padding: 0.1rem 0.4rem;
  border-radius: var(--border-radius-sm);
  background: var(--color-bg-dark, #2a2a35);
  color: #fff;
}

.rune-status {
  font-weight: 600;
}

.rune-status[data-status='embedded'] {
  color: var(--color-accent, #5b8cff);
}

.rune-status[data-status='unequipped'] {
  color: var(--color-text-secondary);
}

.rune-actions {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.3rem;
}

.rune-actions button {
  flex: 1;
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius-sm);
  padding: 0.4rem 0.5rem;
  background: var(--color-bg-dark, #2a2a35);
  color: #fff;
  cursor: pointer;
}

.picker {
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius-md);
  padding: 0.7rem;
  background: var(--color-bg-panel);
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.picker-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 600;
}

.picker-head button,
.picker-slots button {
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius-sm);
  padding: 0.35rem 0.55rem;
  background: var(--color-bg-dark, #2a2a35);
  color: #fff;
  cursor: pointer;
}

.picker-target {
  border-top: 1px solid var(--color-border);
  padding-top: 0.4rem;
}

.picker-target-name {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  margin-bottom: 0.3rem;
}

.picker-slots {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}
</style>
