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

/**
 * Phase 3.24：RuneInventoryTab 的全部视图派生、面板状态、watch、预览与事务协调。
 *
 * 从组件 <script setup> 完整迁入（无行为变化）：
 * - 只读视图 buildRuneInventoryView 是管理 UI 的唯一安全边界（组件不再直接遍历原始 inventory/equipment）；
 * - 所有面板以 canonical Rune ID 为身份（§18/§21/§26），筛选/排序/追加不使选择漂移；
 * - 预览全部复用纯规划器（planRuneBatchFeeding / planRuneBatchLockChange），组件侧不再实现第二份公式；
 * - 确认唯一调用 playerStore.try* 批量原子事务；任一失败完整保持面板与选择，不伪报成功。
 *
 * 返回对象即模板所需的全部绑定：ref / computed / 事件函数 / 展示辅助常量（statNames、slotNames、feedExp）。
 */
export function useRuneInventoryController() {
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

  return {
    // 状态
    filter,
    sortKey,
    feedback,
    showPicker,
    feedMaterialRuneIds,
    showFeedPanel,
    showBatchLockPanel,
    batchLockRuneIds,
    batchLockDesiredState,
    // 视图派生
    isBroken,
    rows,
    sorted,
    summary,
    isDefaultFilterSort,
    equippedTargets,
    pickerRune,
    feedTarget,
    feedCandidates,
    feedSelectionSummary,
    feedPreviewModel,
    batchLockCandidates,
    batchLockPreview,
    batchLockChangedNames,
    // 事件 / 动作
    resetFilterSort,
    openPicker,
    closePicker,
    confirmEmbed,
    confirmRemove,
    toggleLock,
    openFeedPanel,
    closeFeedPanel,
    toggleFeedMaterial,
    confirmFeed,
    openBatchLockPanel,
    closeBatchLockPanel,
    toggleBatchLockRune,
    confirmBatchLock,
    // 展示辅助（模板表达式专用，保持 DOM/aria/文本不变）
    statNames: STAT_NAMES,
    slotNames: EQUIPMENT_SLOT_NAMES,
    feedExp: getRuneFeedExperience
  }
}
