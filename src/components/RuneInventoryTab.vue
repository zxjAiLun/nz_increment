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
import { getRuneFeedExperience, planRuneBatchFeeding } from '../utils/runeFeeding'
import { planRuneBatchLockChange } from '../utils/runeLocking'
import { getRuneExperienceProgress } from '../utils/runeExperience'
import { getRuneEffectiveValue } from '../utils/equipmentRunes'

const playerStore = usePlayerStore()

// Phase 3.23：筛选/排序默认值。状态仅组件本地，不持久化、不进 Store/URL/存档，
// 卸载重挂载后恢复为全部默认（type/rarity/status/lock='all'、sortKey='inventory'）。
const DEFAULT_FILTER: RuneInventoryFilter = { type: 'all', rarity: 'all', status: 'all', lock: 'all' }
const DEFAULT_SORT_KEY: RuneInventorySortKey = 'inventory'

// Phase 3.14：四维筛选（type/rarity/status/lock）显式初始化；lock 仅组件本地状态，
// 不持久化、不进 Store/URL/存档，卸载重挂载后恢复为 'all'。
const filter = ref<RuneInventoryFilter>({ ...DEFAULT_FILTER })
const sortKey = ref<RuneInventorySortKey>(DEFAULT_SORT_KEY)
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
// Phase 3.23：默认态判定（四维筛选全 all 且排序为 inventory）→ 重置按钮禁用。
// 只读 filter/sortKey，不触碰事务 / 面板状态 / canonical-ID 选择。
const isDefaultFilterSort = computed(
  () =>
    filter.value.type === 'all' &&
    filter.value.rarity === 'all' &&
    filter.value.status === 'all' &&
    filter.value.lock === 'all' &&
    sortKey.value === 'inventory'
)

// Phase 3.23：重置筛选与排序。仅改写 filter/sortKey 两个组件本地 ref，
// 不关闭 picker / 强化面板 / 批量锁定面板，不改动其中 canonical-ID 选择，
// 不调用事务、不写盘、不持久化。
function resetFilterSort() {
  filter.value = { ...DEFAULT_FILTER }
  sortKey.value = DEFAULT_SORT_KEY
}
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
  // §27 互斥：打开 picker 时关闭批量锁定面板（清空其本地选择）
  closeBatchLockPanel()
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

// 锁定 / 解锁（Phase 3.12）：以 canonical Rune ID 为身份，只调 playerStore.trySetRuneLocked。
// 安全边界守卫：视图损坏或目标 Rune 不存在，绝不调用事务、绝不伪报成功。
// 锁定语义（§11）：仅保护作为吞噬材料被消耗；不影响镶嵌 / 移除 / 作强化目标 / 属性生效。
// 因此锁定按钮对每一张卡片（已镶嵌 / 未镶嵌）都可用。
function toggleLock(row: RuneInventoryRow) {
  if (!view.value.ok) return
  if (!rows.value.some(r => r.rune.id === row.rune.id)) return
  try {
    const res = playerStore.trySetRuneLocked(row.rune.id, !row.isLocked)
    if (res.ok) {
      feedback.value = {
        kind: 'success',
        message:
          res.changed
            ? `${row.displayName} 已${res.isLocked ? '锁定' : '解锁'}`
            : `${row.displayName} 已处于${res.isLocked ? '锁定' : '解锁'}状态`
      }
    } else {
      feedback.value = { kind: 'error', message: `锁定操作失败：${res.reason ?? '未知原因'}` }
    }
  } catch {
    feedback.value = { kind: 'error', message: '锁定操作失败' }
  }
}

// ---------------------------------------------------------------------------
// 强化（手动多材料吞噬，Phase 3.13；原 Phase 3.11 单选升级为多选）
// 面板以 Rune canonical ID 为身份（§18/§23：选择状态只存 canonical ID，
// 不存 index / 对象引用，筛选/排序/新增 Rune 不会使选择漂移）；
// 材料候选完全派生自纯视图 rows，预览复用 planRuneBatchFeeding（纯规划，零修改零写盘），
// 确认走 playerStore.tryFeedRunes 批量原子事务。
// 禁止任何自动选择 / 全选 / 按稀有度自动填充（§1/§19）。
// ---------------------------------------------------------------------------
const feedTargetRuneId = ref<string | null>(null)
const feedMaterialRuneIds = ref<string[]>([])
const showFeedPanel = ref(false)

const feedTarget = computed(() =>
  feedTargetRuneId.value === null
    ? null
    : rows.value.find(row => row.rune.id === feedTargetRuneId.value) ?? null
)

// 材料候选：非目标自身、未镶嵌、level===1、exp===0、未锁定、可产出吞噬经验；按 inventoryIndex 升序
// §8/§12：锁定 Rune 不能作为吞噬材料，故从候选中排除（已选材料被锁定时将触发下方 watch 清空选择）。
const feedCandidates = computed<RuneInventoryRow[]>(() => {
  if (!view.value.ok || feedTargetRuneId.value === null) return []
  return rows.value
    .filter(
      row =>
        row.rune.id !== feedTargetRuneId.value &&
        row.binding === null &&
        row.rune.level === 1 &&
        row.rune.exp === 0 &&
        row.isLocked === false &&
        getRuneFeedExperience(row.rune) !== null
    )
    .slice()
    .sort((a, b) => a.inventoryIndex - b.inventoryIndex)
})

// 已选材料行（按 inventoryIndex 升序，仅保留仍在候选中的选择；display 用）
const feedMaterials = computed<RuneInventoryRow[]>(() => {
  if (feedMaterialRuneIds.value.length === 0) return []
  const selected = new Set(feedMaterialRuneIds.value)
  return feedCandidates.value.filter(row => selected.has(row.rune.id))
})

// 选择摘要（§3/§19）：枚数来自 canonical ID 数组；总经验唯一来源为批量规划器
// feedPreview（planRuneBatchFeeding.expAdded）——组件不再维护第二份经验求和，
// 避免未来 helper / planner 后置门 / 材料规则变化时摘要与确认预览分叉。
const feedSelectionSummary = computed(() => {
  const count = feedMaterialRuneIds.value.length
  if (count === 0) return { count: 0, totalExp: 0 as number | null }
  const plan = feedPreview.value
  // 规划器暂不可用（例如某个已选材料瞬间失效）：显示"不可用"占位，绝不伪显示 +0 EXP
  return { count, totalExp: plan ? (plan.expAdded as number | null) : null }
})

// 预览：完全复用批量纯规划器（§20）；任何不满足 → null（不显示预览、不允许确认）
const feedPreview = computed(() => {
  if (!view.value.ok) return null
  if (feedTargetRuneId.value === null || feedMaterialRuneIds.value.length === 0) return null
  if (feedMaterials.value.length !== feedMaterialRuneIds.value.length) return null
  const plan = planRuneBatchFeeding({
    targetRuneId: feedTargetRuneId.value,
    materialRuneIds: feedMaterialRuneIds.value,
    inventory: playerStore.runeInventory,
    equipmentBySlot: playerStore.player.equipment
  })
  return plan.ok ? plan : null
})

// 强化预览展示模型（Phase 3.11.1）：把纯 helper 结果整理为完整展示字段。
// 全部数值复用既有唯一来源：planRuneFeeding（计划）、getRuneExperienceProgress
//（当前/强化后等级与经验进度）、getRuneEffectiveValue（强化后有效属性）、
// STAT_NAMES（属性名）。不复制经验阈值 / 升级循环 / statValue 成长 / 有效属性公式 /
// type→stat 映射。任何 helper 返回 null → 整体 null（不显示错误预览、确认按钮禁用）。
const feedPreviewModel = computed(() => {
  const plan = feedPreview.value
  if (plan === null) return null
  const target = feedTarget.value
  const materials = feedMaterials.value
  if (target === null || materials.length === 0) return null
  const currentProgress = getRuneExperienceProgress(plan.targetRune)
  const nextProgress = getRuneExperienceProgress(plan.nextTargetRune)
  if (currentProgress === null || nextProgress === null) return null
  // 消耗名单（§20）：按 plan.consumedRuneIds（inventoryIndex 升序）映射 displayName；
  // 任何 ID 无法解析 → 整体 null（不显示错误预览、确认按钮禁用）
  const nameById = new Map(materials.map(row => [row.rune.id, row.displayName]))
  const materialNames: string[] = []
  for (const id of plan.consumedRuneIds) {
    const name = nameById.get(id)
    if (name === undefined) return null
    materialNames.push(name)
  }
  return {
    currentLevel: currentProgress.level,
    currentExp: currentProgress.currentExp,
    currentRequiredExp: currentProgress.requiredExp,
    expAdded: plan.expAdded,
    nextLevel: nextProgress.level,
    nextExp: nextProgress.currentExp,
    nextRequiredExp: nextProgress.requiredExp,
    levelsGained: plan.levelsGained,
    statName: STAT_NAMES[target.stat],
    nextEffectiveValue: getRuneEffectiveValue(plan.nextTargetRune.statValue, plan.nextTargetRune.level),
    materialName: materialNames.join('、')
  }
})

// 面板失效自动关闭 / 清空（Phase 3.13 §22）：
//   - 视图损坏 / 目标 Rune 消失 / 目标已满级 → 立即关闭面板（从 DOM 移除，事务 0 次）
//   - 某个已选材料失效（被消耗 / 被镶嵌 / 升级 / 被锁定）→ 仅从选择中移除该 ID，
//     其余选择保留、面板保持打开；全部失效 → 选择清空，确认自然禁用
//   - 目标被锁定 / 解锁 → 面板保持打开，预览随 canonical 状态自动更新（锁定目标允许强化）
watch(
  [showFeedPanel, () => view.value.ok, feedTarget],
  ([open, validView, target]) => {
    if (open && (!validView || target === null || target.experience.isMax)) {
      closeFeedPanel()
    }
  }
)
watch([feedMaterialRuneIds, feedCandidates], ([selectedIds, candidates]) => {
  if (selectedIds.length === 0) return
  const valid = new Set(candidates.map(row => row.rune.id))
  const kept = selectedIds.filter(id => valid.has(id))
  if (kept.length !== selectedIds.length) {
    feedMaterialRuneIds.value = kept
  }
})

function openFeedPanel(runeId: string) {
  // 安全边界守卫：视图损坏、目标不存在或已满级，绝不打开空白面板
  if (!view.value.ok) return
  const target = rows.value.find(row => row.rune.id === runeId)
  if (!target || target.experience.isMax) return
  // §27 互斥：打开强化面板时关闭批量锁定面板（清空其本地选择）
  closeBatchLockPanel()
  feedTargetRuneId.value = runeId
  feedMaterialRuneIds.value = []
  showFeedPanel.value = true
  feedback.value = null
}

function closeFeedPanel() {
  showFeedPanel.value = false
  feedTargetRuneId.value = null
  feedMaterialRuneIds.value = []
}

// §19：逐枚手动勾选 / 取消勾选；无全选、无自动选择
function toggleFeedMaterial(runeId: string) {
  if (!feedCandidates.value.some(row => row.rune.id === runeId)) return
  if (feedMaterialRuneIds.value.includes(runeId)) {
    feedMaterialRuneIds.value = feedMaterialRuneIds.value.filter(id => id !== runeId)
  } else {
    feedMaterialRuneIds.value = [...feedMaterialRuneIds.value, runeId]
  }
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
  const materials = feedMaterials.value
  if (materials.length === 0 || materials.length !== feedMaterialRuneIds.value.length) {
    feedback.value = { kind: 'error', message: '强化失败：请选择有效材料' }
    return
  }
  // 预览展示模型不可用（任何 helper 返回 null）时不得调用事务
  if (!feedPreviewModel.value) {
    feedback.value = { kind: 'error', message: '强化失败：预览不可用' }
    return
  }
  try {
    // §21：确认恰好触发一次批量原子事务（禁止逐材料循环调用单材料事务）
    const res = playerStore.tryFeedRunes(target.rune.id, feedMaterialRuneIds.value)
    if (res.ok) {
      feedback.value = {
        kind: 'success',
        message: `强化成功：${target.displayName} 消耗 ${res.materialsConsumed} 枚材料，获得 ${res.expAdded} 经验${res.levelsGained > 0 ? `，升至 Lv.${res.level}` : ''}`
      }
      // 成功：清空选择并关闭面板（材料已被消耗，选择状态不得残留）
      closeFeedPanel()
    } else {
      // 失败：整批零消耗，面板与选择保持不变，绝不显示成功（无 alert）
      feedback.value = { kind: 'error', message: `强化失败：${res.reason ?? '未知原因'}` }
    }
  } catch {
    feedback.value = { kind: 'error', message: '强化操作失败' }
  }
}

// ---------------------------------------------------------------------------
// 批量锁定管理（Phase 3.15）
// 面板身份与候选全部来自未筛选 canonical rows（§20：不直接遍历 raw inventory）；
// 本地状态只存 canonical Rune ID 与目标 boolean（§21：不存 index / 对象引用 / 不持久化）；
// 预览唯一来源 planRuneBatchLockChange（§24：组件内不重新实现锁定分类）；
// 确认唯一调用 playerStore.trySetRunesLocked 批量原子事务（§25）。
// 禁止：全选 / 反选 / 选择当前筛选结果 / 自动选择（§22）。
// ---------------------------------------------------------------------------
const showBatchLockPanel = ref(false)
const batchLockRuneIds = ref<string[]>([])
const batchLockDesiredState = ref<boolean>(true)

// 候选：完整合法仓库（inventoryIndex 升序），不受外层筛选控制（§20/§26）
const batchLockCandidates = computed<RuneInventoryRow[]>(() => {
  if (!view.value.ok) return []
  return rows.value.slice().sort((a, b) => a.inventoryIndex - b.inventoryIndex)
})

// 预览：完全复用批量纯规划器；inventory 来自 canonical rows 快照（§24）
const batchLockPreview = computed(() => {
  if (!view.value.ok) return null
  if (batchLockRuneIds.value.length === 0) return null
  const plan = planRuneBatchLockChange({
    inventory: rows.value.map(row => row.rune),
    runeIds: batchLockRuneIds.value,
    isLocked: batchLockDesiredState.value
  })
  return plan.ok ? plan : null
})

// 实际会变化的 Rune 名称（来自 plan.changedRuneIds，不在组件内重新分类）
const batchLockChangedNames = computed(() => {
  const plan = batchLockPreview.value
  if (!plan || plan.changedCount === 0) return ''
  const nameById = new Map(rows.value.map(row => [row.rune.id, row.displayName]))
  const names: string[] = []
  for (const id of plan.changedRuneIds) {
    const name = nameById.get(id)
    if (name === undefined) return ''
    names.push(name)
  }
  return names.join('、')
})

// §26 identity 纪律：
//   - view 损坏 → 关闭面板、清空选择、不调用事务
//   - 某个已选 Rune 真正从 inventory 消失 → 只移除该 ID，其余选择保持
//   - 外层筛选 / 排序 / 尾部追加 / 其他 Rune 锁定状态变化 → 选择完全保持
//    （锁定状态变化不是选择资格失效，changed/unchanged 预览随 canonical 状态自动更新）
watch([showBatchLockPanel, () => view.value.ok], ([open, validView]) => {
  if (open && !validView) {
    closeBatchLockPanel()
  }
})
watch([batchLockRuneIds, rows], ([selectedIds, currentRows]) => {
  if (selectedIds.length === 0) return
  const valid = new Set(currentRows.map(row => row.rune.id))
  const kept = selectedIds.filter(id => valid.has(id))
  if (kept.length !== selectedIds.length) {
    batchLockRuneIds.value = kept
  }
})

function openBatchLockPanel() {
  // 安全边界守卫：视图损坏绝不打开
  if (!view.value.ok) return
  // §27 互斥：打开批量锁定面板时关闭强化面板与镶嵌 picker（清空其本地选择）
  closePicker()
  closeFeedPanel()
  batchLockRuneIds.value = []
  batchLockDesiredState.value = true
  showBatchLockPanel.value = true
  feedback.value = null
}

function closeBatchLockPanel() {
  // §21：关闭即清空选择并恢复目标状态默认值
  showBatchLockPanel.value = false
  batchLockRuneIds.value = []
  batchLockDesiredState.value = true
}

// §22：逐枚手动选择 / 取消；无全选、无反选、无自动选择
function toggleBatchLockRune(runeId: string) {
  if (!rows.value.some(row => row.rune.id === runeId)) return
  if (batchLockRuneIds.value.includes(runeId)) {
    batchLockRuneIds.value = batchLockRuneIds.value.filter(id => id !== runeId)
  } else {
    batchLockRuneIds.value = [...batchLockRuneIds.value, runeId]
  }
}

function confirmBatchLock() {
  // 安全边界守卫：视图损坏关闭面板、绝不调用事务
  if (!view.value.ok) {
    closeBatchLockPanel()
    return
  }
  const plan = batchLockPreview.value
  // §24/§25：选择为空 / planner 失败 / 全部幂等 → 确认禁用；此处防御性拦截，不调用 Store
  if (!plan || plan.changedCount === 0) return
  try {
    const res = playerStore.trySetRunesLocked([...batchLockRuneIds.value], batchLockDesiredState.value)
    if (res.ok && res.changedCount > 0) {
      feedback.value = {
        kind: 'success',
        message: `批量${res.isLocked ? '锁定' : '解锁'}成功：选择 ${res.selectedCount} 枚，实际${res.isLocked ? '锁定' : '解锁'} ${res.changedCount} 枚`
      }
      // 成功：关闭面板并清空选择（§25）
      closeBatchLockPanel()
    } else if (res.ok) {
      // 防御分支（确认禁用下不可达）：全部幂等，不显示成功切换、不关闭
      feedback.value = { kind: 'error', message: '批量锁定失败：所选符文已处于目标状态' }
    } else {
      // 失败：面板保持、选择保持、目标状态保持，不显示成功（无 alert）
      feedback.value = { kind: 'error', message: `批量锁定失败：${res.reason ?? '未知原因'}` }
    }
  } catch {
    feedback.value = { kind: 'error', message: '批量锁定操作失败' }
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
        <span>已锁定 {{ summary.locked }}</span>
        <span>未锁定 {{ summary.unlocked }}</span>
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
          锁定状态
          <select aria-label="按锁定状态筛选" v-model="filter.lock">
            <option value="all">全部</option>
            <option value="locked">已锁定</option>
            <option value="unlocked">未锁定</option>
          </select>
        </label>
        <label>
          排序
          <select aria-label="排序方式" v-model="sortKey">
            <option value="inventory">仓库顺序</option>
            <option value="rarity">稀有度</option>
            <option value="level">等级</option>
            <option value="effective">有效属性</option>
            <option value="locked-first">已锁定优先</option>
            <option value="unlocked-first">未锁定优先</option>
          </select>
        </label>

        <!-- Phase 3.23：筛选/排序匹配计数（X=当前筛选排序结果数，Y=合法仓库总数）与重置按钮。
             数据损坏时不渲染（整个 v-else 分支不可见）；仅组件本地状态，不持久化。 -->
        <div class="filter-meta">
          <span class="match-count" role="status" aria-label="筛选匹配计数">显示 {{ sorted.length }} / {{ rows.length }}</span>
          <button
            type="button"
            class="reset-filter-sort"
            :disabled="isDefaultFilterSort"
            aria-label="重置筛选与排序"
            @click="resetFilterSort"
          >
            重置筛选与排序
          </button>
        </div>
      </div>

      <!-- 批量锁定管理入口（Phase 3.15） -->
      <div class="batch-lock-entry">
        <button
          type="button"
          aria-label="打开批量锁定管理"
          @click="openBatchLockPanel"
        >
          批量设置锁定状态
        </button>
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
          <div class="rune-lock" :data-locked="row.isLocked ? 'true' : 'false'">
            {{ row.isLocked ? '已锁定' : '未锁定' }}
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
              type="button"
              class="lock-button"
              :aria-label="`${row.isLocked ? '解锁' : '锁定'} ${row.displayName}`"
              :data-locked="row.isLocked ? 'true' : 'false'"
              @click="toggleLock(row)"
            >
              {{ row.isLocked ? '解锁' : '锁定' }}
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

      <!-- 强化面板（Phase 3.13 多选）：材料候选派生自纯视图 rows，预览复用 planRuneBatchFeeding -->
      <div v-if="showFeedPanel" class="feed-panel" role="dialog" aria-label="强化符文">
        <div class="feed-head">
          <span>强化目标：{{ feedTarget?.displayName }}（Lv.{{ feedTarget?.rune.level }}）</span>
          <button type="button" aria-label="关闭强化面板" @click="closeFeedPanel">关闭</button>
        </div>

        <div v-if="feedCandidates.length === 0" class="feed-empty">
          <p>暂无可用材料符文</p>
          <p>仅可消耗未镶嵌的 Lv.1 / 0 EXP 符文</p>
        </div>

        <ul v-else class="feed-materials" aria-label="强化材料候选">
            <li v-for="candidate in feedCandidates" :key="candidate.rune.id">
              <button
                type="button"
                class="feed-material"
                :data-selected="feedMaterialRuneIds.includes(candidate.rune.id) ? 'true' : 'false'"
                :aria-label="`${feedMaterialRuneIds.includes(candidate.rune.id) ? '取消选择' : '选择'}材料 ${candidate.displayName}，提供 ${getRuneFeedExperience(candidate.rune)} 经验，当前${feedMaterialRuneIds.includes(candidate.rune.id) ? '已选中' : '未选中'}`"
                :aria-pressed="feedMaterialRuneIds.includes(candidate.rune.id)"
                @click="toggleFeedMaterial(candidate.rune.id)"
              >
                <span class="feed-material-name">{{ candidate.displayName }}</span>
                <span class="feed-material-rarity">{{ candidate.rarityLabel }}</span>
                <span class="feed-material-exp">+{{ getRuneFeedExperience(candidate.rune) }} 经验</span>
              </button>
            </li>
          </ul>

          <div class="feed-selection-summary" role="status" aria-label="已选材料摘要">
            <span>已选 {{ feedSelectionSummary.count }} 枚</span>
            <span v-if="feedSelectionSummary.totalExp !== null">总计 +{{ feedSelectionSummary.totalExp }} EXP</span>
            <span v-else>总计 不可用</span>
            <span v-if="feedSelectionSummary.count === 0">尚未选择可消耗材料</span>
            <span v-else-if="feedSelectionSummary.totalExp !== null">确认后将永久消耗 {{ feedSelectionSummary.count }} 枚材料</span>
          </div>

          <div v-if="feedPreviewModel" class="feed-preview" role="status" aria-label="强化预览">
            <span>当前：Lv.{{ feedPreviewModel.currentLevel }} · EXP {{ feedPreviewModel.currentExp }} / {{ feedPreviewModel.currentRequiredExp ?? 'MAX' }}</span>
            <span>获得：+{{ feedPreviewModel.expAdded }} EXP</span>
            <span>强化后：Lv.{{ feedPreviewModel.nextLevel }} · EXP {{ feedPreviewModel.nextExp }} / {{ feedPreviewModel.nextRequiredExp ?? 'MAX' }}</span>
            <span>预计提升：{{ feedPreviewModel.levelsGained }} 级</span>
            <span>强化后有效属性：{{ feedPreviewModel.statName }} +{{ feedPreviewModel.nextEffectiveValue }}</span>
            <span>消耗：{{ feedPreviewModel.materialName }}</span>
          </div>

          <button
            v-if="feedCandidates.length > 0"
            type="button"
            class="feed-confirm"
            :disabled="!feedPreviewModel"
            :aria-label="`确认强化，将永久消耗 ${feedSelectionSummary.count} 枚材料`"
            @click="confirmFeed"
          >
            确认强化
          </button>
      </div>

      <!-- 批量锁定管理面板（Phase 3.15）：候选=完整合法仓库（不受外层筛选控制），
           预览复用 planRuneBatchLockChange，确认走 trySetRunesLocked 批量原子事务 -->
      <div v-if="showBatchLockPanel" class="batch-lock-panel" role="dialog" aria-label="批量锁定符文">
        <div class="batch-lock-head">
          <span>批量设置锁定状态</span>
          <button type="button" aria-label="关闭批量锁定管理" @click="closeBatchLockPanel">关闭</button>
        </div>

        <label class="batch-lock-target">
          目标状态
          <select aria-label="选择批量锁定目标状态" v-model="batchLockDesiredState">
            <option :value="true">锁定所选符文</option>
            <option :value="false">解锁所选符文</option>
          </select>
        </label>

        <ul class="batch-lock-list" aria-label="批量锁定候选符文">
          <li v-for="row in batchLockCandidates" :key="row.rune.id">
            <button
              type="button"
              class="batch-lock-item"
              :data-selected="batchLockRuneIds.includes(row.rune.id) ? 'true' : 'false'"
              :data-locked="row.isLocked ? 'true' : 'false'"
              :aria-pressed="batchLockRuneIds.includes(row.rune.id)"
              :aria-label="`${batchLockRuneIds.includes(row.rune.id) ? '取消选择符文' : '选择符文'} ${row.displayName}，当前${row.isLocked ? '已锁定' : '未锁定'}，${batchLockRuneIds.includes(row.rune.id) ? '已选中' : '未选中'}`"
              @click="toggleBatchLockRune(row.rune.id)"
            >
              <span class="batch-lock-name">{{ row.displayName }}</span>
              <span class="batch-lock-state">{{ row.isLocked ? '已锁定' : '未锁定' }}</span>
              <span class="batch-lock-picked">{{ batchLockRuneIds.includes(row.rune.id) ? '已选中' : '未选中' }}</span>
            </button>
          </li>
        </ul>

        <div class="batch-lock-summary" role="status" aria-label="批量锁定预览">
          <span>已选择 {{ batchLockRuneIds.length }} 枚</span>
          <span>目标状态：{{ batchLockDesiredState ? '锁定' : '解锁' }}</span>
          <template v-if="batchLockPreview">
            <span>将改变 {{ batchLockPreview.changedCount }} 枚</span>
            <span>已处于目标状态 {{ batchLockPreview.unchangedCount }} 枚</span>
            <span v-if="batchLockPreview.changedCount > 0">实际变化：{{ batchLockChangedNames }}</span>
            <span v-else>所有所选符文已处于目标状态</span>
          </template>
          <span v-else-if="batchLockRuneIds.length === 0">尚未选择符文</span>
          <span v-else>预览不可用</span>
        </div>

        <button
          type="button"
          class="batch-lock-confirm"
          :disabled="!batchLockPreview || batchLockPreview.changedCount === 0"
          :aria-label="`确认批量操作，将${batchLockDesiredState ? '锁定' : '解锁'} ${batchLockPreview ? batchLockPreview.changedCount : 0} 枚符文`"
          @click="confirmBatchLock"
        >
          确认{{ batchLockDesiredState ? '锁定' : '解锁' }}
        </button>
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

.filter-meta {
  display: flex;
  align-items: flex-end;
  gap: 0.5rem;
}

.match-count {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  background: var(--color-bg-panel);
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius-sm);
  padding: 0.35rem 0.5rem;
}

.reset-filter-sort {
  padding: 0.35rem 0.6rem;
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius-sm);
  background: var(--color-bg-panel);
  color: var(--color-text);
  cursor: pointer;
}

.reset-filter-sort:disabled {
  opacity: 0.5;
  cursor: not-allowed;
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

.rune-lock {
  font-weight: 600;
  font-size: var(--font-size-xs);
}

.rune-lock[data-locked='true'] {
  color: var(--color-warning-text, #b8851c);
}

.rune-lock[data-locked='false'] {
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

.rune-actions .lock-button[data-locked='true'] {
  background: var(--color-warning-bg, #fbf1d8);
  color: var(--color-warning-text, #b8851c);
  border-color: var(--color-warning-border, #ecd28a);
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

.feed-empty p {
  margin: 0.15rem 0;
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

.feed-selection-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  font-size: var(--font-size-sm);
  color: var(--color-text);
}

.feed-selection-summary span {
  background: var(--color-bg-panel);
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius-sm);
  padding: 0.25rem 0.5rem;
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

.batch-lock-entry button,
.batch-lock-head button,
.batch-lock-confirm {
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius-sm);
  padding: 0.35rem 0.55rem;
  background: var(--color-bg-dark, #2a2a35);
  color: #fff;
  cursor: pointer;
}

.batch-lock-confirm:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.batch-lock-panel {
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius-md);
  padding: 0.7rem;
  background: var(--color-bg-panel);
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.batch-lock-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 600;
}

.batch-lock-target {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

.batch-lock-target select {
  padding: 0.35rem 0.5rem;
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius-sm);
  background: var(--color-bg-panel);
  color: var(--color-text);
}

.batch-lock-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.batch-lock-item {
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

.batch-lock-item[data-selected='true'] {
  border-color: var(--color-accent, #5b8cff);
  outline: 2px solid var(--color-accent, #5b8cff);
}

.batch-lock-item[data-locked='true'] .batch-lock-state {
  color: var(--color-warning-text, #b8851c);
}

.batch-lock-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  font-size: var(--font-size-sm);
  color: var(--color-text);
}

.batch-lock-summary span {
  background: var(--color-bg-panel);
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius-sm);
  padding: 0.25rem 0.5rem;
}
</style>
