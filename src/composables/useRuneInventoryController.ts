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
import { EQUIPMENT_SLOT_NAMES, STAT_NAMES } from '../types'
import { getRuneFeedExperience } from '../utils/runeFeeding'
import { useRuneEmbedPanel } from './useRuneEmbedPanel'
import { useRuneFeedPanel } from './useRuneFeedPanel'
import { useRuneBatchLockPanel } from './useRuneBatchLockPanel'

/**
 * Phase 3.24 / 3.25：RuneInventoryTab 的全部视图派生、面板状态、watch、预览与事务协调。
 *
 * Phase 3.25 拆分：三个面板（镶嵌 picker / 强化 / 批量锁定）已迁入子 composable——
 * useRuneEmbedPanel / useRuneFeedPanel / useRuneBatchLockPanel。本 controller 只负责：
 * - 共享状态：playerStore、只读 view、rows、筛选 / 排序 / 摘要 / 反馈；
 * - 单卡操作：confirmRemove / toggleLock；
 * - 三个子 composable 的接线（依赖注入 view / rows / feedback / playerStore）；
 * - 面板互斥协调：公开的 openPicker / openFeedPanel / openBatchLockPanel 先关闭其他面板，
 *   再调用对应子模块的内部 openPanel（互斥不放进子 composable 相互调用）；
 * - 对模板暴露的原有 40 个成员（名称 / 类型 / 行为与拆分前一致）。
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

  // 只读视图：inventory + 装备 topology 派生；损坏时 ok:false。
  // 这是管理 UI 的唯一安全边界——组件与面板不再直接遍历原始 inventory/equipment。
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

  // ---------------------------------------------------------------------------
  // 单卡操作（留在顶层）：移除已镶嵌 Rune / 切换单 Rune 锁定状态。
  // 以 canonical Rune ID 为身份，只调 playerStore.try*。
  // 安全边界守卫：视图损坏或目标 Rune 不存在，绝不调用事务、绝不伪报成功。
  // ---------------------------------------------------------------------------
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
  // 三个面板子 composable 接线（Phase 3.25）。
  // 依赖注入：共享 view / rows / feedback / playerStore，各自持有面板本地状态与失效 watch。
  // 面板互斥不放进子 composable 相互调用——统一由下方公开 wrapper 协调。
  // ---------------------------------------------------------------------------
  const embedPanel = useRuneEmbedPanel({ playerStore, view, rows, feedback })
  const feedPanel = useRuneFeedPanel({ playerStore, view, rows, feedback })
  const batchLockPanel = useRuneBatchLockPanel({ playerStore, view, rows, feedback })

  // 面板互斥协调（§27）：先验证打开请求有效（guard-before-mutex），再关闭其余面板（清空其本地选择），
  // 最后调用对应子模块的内部 openPanel——无效/过期请求不会意外关闭当前面板或清空选择。
  // openPicker / openFeedPanel / openBatchLockPanel 为对模板公开的唯一入口。
  function openPicker(runeId: string) {
    if (!embedPanel.canOpenPanel(runeId)) return
    batchLockPanel.closePanel()
    embedPanel.openPanel(runeId)
  }

  function openFeedPanel(runeId: string) {
    if (!feedPanel.canOpenPanel(runeId)) return
    batchLockPanel.closePanel()
    feedPanel.openPanel(runeId)
  }

  function openBatchLockPanel() {
    if (!batchLockPanel.canOpenPanel()) return
    embedPanel.closePanel()
    feedPanel.closePanel()
    batchLockPanel.openPanel()
  }

  return {
    // 状态
    filter,
    sortKey,
    feedback,
    showPicker: embedPanel.showPicker,
    feedMaterialRuneIds: feedPanel.feedMaterialRuneIds,
    showFeedPanel: feedPanel.showFeedPanel,
    showBatchLockPanel: batchLockPanel.showBatchLockPanel,
    batchLockRuneIds: batchLockPanel.batchLockRuneIds,
    batchLockDesiredState: batchLockPanel.batchLockDesiredState,
    // 视图派生
    isBroken,
    rows,
    sorted,
    summary,
    isDefaultFilterSort,
    equippedTargets: embedPanel.equippedTargets,
    pickerRune: embedPanel.pickerRune,
    feedTarget: feedPanel.feedTarget,
    feedCandidates: feedPanel.feedCandidates,
    feedSelectionSummary: feedPanel.feedSelectionSummary,
    feedPreviewModel: feedPanel.feedPreviewModel,
    batchLockCandidates: batchLockPanel.batchLockCandidates,
    batchLockPreview: batchLockPanel.batchLockPreview,
    batchLockChangedNames: batchLockPanel.batchLockChangedNames,
    // 事件 / 动作
    resetFilterSort,
    openPicker,
    closePicker: embedPanel.closePanel,
    confirmEmbed: embedPanel.confirmEmbed,
    confirmRemove,
    toggleLock,
    openFeedPanel,
    closeFeedPanel: feedPanel.closePanel,
    toggleFeedMaterial: feedPanel.toggleMaterial,
    confirmFeed: feedPanel.confirmFeed,
    openBatchLockPanel,
    closeBatchLockPanel: batchLockPanel.closePanel,
    toggleBatchLockRune: batchLockPanel.toggleRune,
    confirmBatchLock: batchLockPanel.confirm,
    // 展示辅助（模板表达式专用，保持 DOM/aria/文本不变）
    statNames: STAT_NAMES,
    slotNames: EQUIPMENT_SLOT_NAMES,
    feedExp: getRuneFeedExperience
  }
}
