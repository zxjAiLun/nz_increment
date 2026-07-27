<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { usePlayerStore } from '../stores/playerStore'
import {
  buildRuneInventoryView,
  filterRuneRows,
  sortRuneRows,
  summarizeRuneRows,
  type RuneInventoryFilter,
  type RuneInventoryRow,
  type RuneInventorySortKey,
  type RuneEquipmentTargetView
} from '../utils/runeInventoryView'
import { EQUIPMENT_SLOT_NAMES, STAT_NAMES } from '../types'
import type { EquipmentSlot } from '../types'
import { getRuneFeedExperience, planRuneFeeding } from '../utils/runeFeeding'

const playerStore = usePlayerStore()

const filter = ref<RuneInventoryFilter>({ type: 'all', rarity: 'all', status: 'all' })
const sortKey = ref<RuneInventorySortKey>('inventory')
const feedback = ref<{ kind: 'success' | 'error'; message: string } | null>(null)
// picker 以 Rune canonical ID 为身份，避免筛选/排序/追加导致数组位置漂移
const pickerRuneId = ref<string | null>(null)
const showPicker = ref(false)

// 只读视图：inventory + 装备 topology 派生；损坏时 ok:false。
// 这是管理 UI 的唯一安全边界——组件不再直接遍历原始 inventory/equipment。
const view = computed(() => buildRuneInventoryView(playerStore.runeInventory, playerStore.player.equipment))
const isBroken = computed(() => !view.value.ok)
const rows = computed(() => (view.value.ok ? view.value.rows : []))
const filtered = computed(() => filterRuneRows(rows.value, filter.value))
const sorted = computed(() => sortRuneRows(filtered.value, sortKey.value))
const summary = computed(() => summarizeRuneRows(rows.value))
// picker 目标数据完全来自纯视图的 targets 快照（canonical Rune ID，无 raw 遍历）
const equippedTargets = computed<RuneEquipmentTargetView[]>(() =>
  view.value.ok ? view.value.targets : []
)

const pickerRune = computed(() =>
  pickerRuneId.value === null ? null : rows.value.find(row => row.rune.id === pickerRuneId.value) ?? null
)

// picker 失效自动关闭（Phase 3.10.2）：
// 打开期间若视图损坏（view.ok=false）或目标 Rune 从合法 inventory 消失（pickerRune=null），
// 立即从 DOM 移除并清空身份，绝不保留空白 dialog，绝不调用事务、绝不伪报成功。
watch(
  [showPicker, () => view.value.ok, pickerRune],
  ([open, validView, rune]) => {
    if (open && (!validView || rune === null)) {
      closePicker()
    }
  }
)

function openPicker(runeId: string) {
  // 安全边界守卫：视图损坏或目标 Rune 不存在，绝不打开空白 dialog
  if (!view.value.ok) return
  if (!rows.value.some(row => row.rune.id === runeId)) return
  pickerRuneId.value = runeId
  showPicker.value = true
  feedback.value = null
}

function closePicker() {
  showPicker.value = false
  pickerRuneId.value = null
}

function confirmEmbed(slot: EquipmentSlot, index: number) {
  // 安全边界守卫：视图损坏或目标 Rune 已不存在，绝不调用事务、绝不伪报成功
  if (!view.value.ok) {
    closePicker()
    return
  }
  const rune = pickerRune.value
  if (!rune) {
    closePicker()
    return
  }
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
  if (!view.value.ok) return
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

// ---------------------------------------------------------------------------
// 强化（单材料吞噬，Phase 3.11）
// 面板以 Rune canonical ID 为身份；材料候选完全派生自纯视图 rows，
// 预览复用 planRuneFeeding（纯规划，零修改零写盘），确认走 playerStore.tryFeedRune 原子事务。
// ---------------------------------------------------------------------------
const feedTargetRuneId = ref<string | null>(null)
const feedMaterialRuneId = ref<string | null>(null)
const showFeedPanel = ref(false)

const feedTarget = computed(() =>
  feedTargetRuneId.value === null
    ? null
    : rows.value.find(row => row.rune.id === feedTargetRuneId.value) ?? null
)

// 材料候选：非目标自身、未镶嵌、level===1、exp===0、可产出吞噬经验；按 inventoryIndex 升序
const feedCandidates = computed<RuneInventoryRow[]>(() => {
  if (!view.value.ok || feedTargetRuneId.value === null) return []
  return rows.value
    .filter(
      row =>
        row.rune.id !== feedTargetRuneId.value &&
        row.binding === null &&
        row.rune.level === 1 &&
        row.rune.exp === 0 &&
        getRuneFeedExperience(row.rune) !== null
    )
    .slice()
    .sort((a, b) => a.inventoryIndex - b.inventoryIndex)
})

const feedMaterial = computed(() =>
  feedMaterialRuneId.value === null
    ? null
    : feedCandidates.value.find(row => row.rune.id === feedMaterialRuneId.value) ?? null
)

// 预览：完全复用纯规划器；任何不满足 → null（不显示预览、不允许确认）
const feedPreview = computed(() => {
  if (!view.value.ok) return null
  if (feedTargetRuneId.value === null || feedMaterialRuneId.value === null) return null
  if (feedMaterial.value === null) return null
  const plan = planRuneFeeding({
    targetRuneId: feedTargetRuneId.value,
    materialRuneId: feedMaterialRuneId.value,
    inventory: playerStore.runeInventory,
    equipmentBySlot: playerStore.player.equipment
  })
  return plan.ok ? plan : null
})

// 面板失效自动关闭 / 清空（Phase 3.11）：
//   - 视图损坏 / 目标 Rune 消失 / 目标已满级 → 立即关闭面板（从 DOM 移除，事务 0 次）
//   - 已选材料失效（被消耗 / 被镶嵌 / 升级）→ 仅清空材料选择，面板保持打开
watch(
  [showFeedPanel, () => view.value.ok, feedTarget],
  ([open, validView, target]) => {
    if (open && (!validView || target === null || target.experience.isMax)) {
      closeFeedPanel()
    }
  }
)
watch([feedMaterialRuneId, feedMaterial], ([selectedId, material]) => {
  if (selectedId !== null && material === null) {
    feedMaterialRuneId.value = null
  }
})

function openFeedPanel(runeId: string) {
  // 安全边界守卫：视图损坏、目标不存在或已满级，绝不打开空白面板
  if (!view.value.ok) return
  const target = rows.value.find(row => row.rune.id === runeId)
  if (!target || target.experience.isMax) return
  feedTargetRuneId.value = runeId
  feedMaterialRuneId.value = null
  showFeedPanel.value = true
  feedback.value = null
}

function closeFeedPanel() {
  showFeedPanel.value = false
  feedTargetRuneId.value = null
  feedMaterialRuneId.value = null
}

function selectFeedMaterial(runeId: string) {
  if (!feedCandidates.value.some(row => row.rune.id === runeId)) return
  feedMaterialRuneId.value = runeId
}

function confirmFeed() {
  // 安全边界守卫：视图损坏 / 目标或材料失效，绝不调用事务、绝不伪报成功
  if (!view.value.ok) {
    closeFeedPanel()
    return
  }
  const target = feedTarget.value
  if (!target || target.experience.isMax) {
    closeFeedPanel()
    return
  }
  const material = feedMaterial.value
  if (!material) {
    feedback.value = { kind: 'error', message: '强化失败：请选择有效材料' }
    return
  }
  try {
    const res = playerStore.tryFeedRune(target.rune.id, material.rune.id)
    if (res.ok) {
      feedback.value = {
        kind: 'success',
        message: `强化成功：${target.displayName} 获得 ${res.expAdded} 经验${res.levelsGained > 0 ? `，升至 Lv.${res.level}` : ''}`
      }
      closeFeedPanel()
    } else {
      // 失败：面板保持打开，绝不显示成功
      feedback.value = { kind: 'error', message: `强化失败：${res.reason ?? '未知原因'}` }
    }
  } catch {
    feedback.value = { kind: 'error', message: '强化操作失败' }
  }
}
</script>

<template>
  <section class="rune-inventory" aria-label="符文仓库">
    <!-- 损坏状态：只显示异常横幅，不显示摘要/筛选/卡片/picker/操作按钮 -->
    <div v-if="isBroken" class="broken-banner" role="alert">
      符文数据或装备拓扑异常，当前无法管理
    </div>

    <template v-else>
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
            <span class="rune-rarity">{{ row.rarityLabel }}</span>
          </div>
          <div class="rune-stat">属性：{{ STAT_NAMES[row.stat] }}</div>
          <div class="rune-level">{{ row.experience.isMax ? `Lv.${row.rune.level} MAX` : `Lv.${row.rune.level}` }}</div>
          <div class="rune-base">基础 {{ STAT_NAMES[row.stat] }} +{{ row.rune.statValue }}</div>
          <div class="rune-effective">当前 {{ STAT_NAMES[row.stat] }} +{{ row.effectiveValue }}</div>
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
              @click="openPicker(row.rune.id)"
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
            <button
              v-if="!row.experience.isMax"
              type="button"
              class="feed-button"
              :aria-label="`强化 ${row.displayName}`"
              @click="openFeedPanel(row.rune.id)"
            >
              强化
            </button>
            <button
              v-else
              type="button"
              class="feed-button"
              disabled
              :aria-label="`${row.displayName} 已满级`"
            >
              已满级
            </button>
          </div>
        </li>
      </ul>

      <!-- 镶嵌目标选择（数据来自 view.targets 快照，组件不再触碰原始 inventory/equipment） -->
      <div v-if="showPicker" class="picker" role="dialog" aria-label="选择镶嵌目标">
        <div class="picker-head">
          <span>镶嵌目标：{{ pickerRune?.displayName }}</span>
          <button type="button" aria-label="关闭镶嵌目标选择" @click="closePicker">关闭</button>
        </div>
        <div v-for="target in equippedTargets" :key="target.equipmentSlot" class="picker-target">
          <div class="picker-target-name">{{ EQUIPMENT_SLOT_NAMES[target.equipmentSlot] }} · {{ target.equipmentName }}</div>
          <div class="picker-slots">
            <button
              v-for="slotView in target.slots"
              :key="slotView.index"
              type="button"
              :aria-label="`镶嵌到 ${EQUIPMENT_SLOT_NAMES[target.equipmentSlot]} 孔位 ${slotView.index + 1}${slotView.currentRuneDisplayName ? '，当前 ' + slotView.currentRuneDisplayName : ''}`"
              @click="confirmEmbed(target.equipmentSlot, slotView.index)"
            >
              孔位 {{ slotView.index + 1 }}
              <span v-if="slotView.currentRuneDisplayName">（{{ slotView.currentRuneDisplayName }}）</span>
              <span v-else>（空）</span>
            </button>
          </div>
        </div>
      </div>

      <!-- 强化面板（Phase 3.11）：材料候选派生自纯视图 rows，预览复用 planRuneFeeding -->
      <div v-if="showFeedPanel" class="feed-panel" role="dialog" aria-label="强化符文">
        <div class="feed-head">
          <span>强化目标：{{ feedTarget?.displayName }}（Lv.{{ feedTarget?.rune.level }}）</span>
          <button type="button" aria-label="关闭强化面板" @click="closeFeedPanel">关闭</button>
        </div>

        <div v-if="feedCandidates.length === 0" class="feed-empty">
          没有可用的强化材料（需要未镶嵌且未使用过的 Lv.1 符文）
        </div>

        <template v-else>
          <ul class="feed-materials" aria-label="强化材料候选">
            <li v-for="candidate in feedCandidates" :key="candidate.rune.id">
              <button
                type="button"
                class="feed-material"
                :data-selected="candidate.rune.id === feedMaterialRuneId ? 'true' : 'false'"
                :aria-label="`选择材料 ${candidate.displayName}，提供 ${getRuneFeedExperience(candidate.rune)} 经验`"
                :aria-pressed="candidate.rune.id === feedMaterialRuneId"
                @click="selectFeedMaterial(candidate.rune.id)"
              >
                <span class="feed-material-name">{{ candidate.displayName }}</span>
                <span class="feed-material-rarity">{{ candidate.rarityLabel }}</span>
                <span class="feed-material-exp">+{{ getRuneFeedExperience(candidate.rune) }} 经验</span>
              </button>
            </li>
          </ul>

          <div v-if="feedPreview" class="feed-preview" role="status" aria-label="强化预览">
            <span>获得经验 +{{ feedPreview.expAdded }}</span>
            <span v-if="feedPreview.levelsGained > 0">
              Lv.{{ feedPreview.targetRune.level }} → Lv.{{ feedPreview.nextTargetRune.level }}
            </span>
            <span v-else>经验 {{ feedPreview.targetRune.exp }} → {{ feedPreview.nextTargetRune.exp }}</span>
            <span>消耗：{{ feedMaterial?.displayName }}</span>
          </div>

          <button
            type="button"
            class="feed-confirm"
            :disabled="!feedPreview"
            aria-label="确认强化"
            @click="confirmFeed"
          >
            确认强化
          </button>
        </template>
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

.feed-panel {
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius-md);
  padding: 0.7rem;
  background: var(--color-bg-panel);
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.feed-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 600;
}

.feed-head button,
.feed-confirm {
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius-sm);
  padding: 0.35rem 0.55rem;
  background: var(--color-bg-dark, #2a2a35);
  color: #fff;
  cursor: pointer;
}

.feed-confirm:disabled,
.feed-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.feed-empty {
  padding: 0.8rem;
  text-align: center;
  color: var(--color-text-secondary);
  background: var(--color-bg-panel);
  border: 1px dashed var(--color-border);
  border-radius: var(--border-radius-sm);
  font-size: var(--font-size-sm);
}

.feed-materials {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.feed-material {
  width: 100%;
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius-sm);
  padding: 0.4rem 0.6rem;
  background: var(--color-bg-panel);
  color: var(--color-text);
  cursor: pointer;
  font-size: var(--font-size-sm);
}

.feed-material[data-selected='true'] {
  border-color: var(--color-accent, #5b8cff);
  outline: 2px solid var(--color-accent, #5b8cff);
}

.feed-preview {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

.feed-preview span {
  background: var(--color-bg-panel);
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius-sm);
  padding: 0.25rem 0.5rem;
}
</style>
