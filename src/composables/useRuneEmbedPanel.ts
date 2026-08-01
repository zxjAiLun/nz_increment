import { computed, ref, watch, type ComputedRef, type Ref } from 'vue'
import type { RuneEquipmentTargetView, RuneInventoryRow, RuneInventoryViewResult } from '../utils/runeInventoryView'
import type { EquipmentSlot } from '../types'
import type { RunePanelFeedback } from './runePanelTypes'

/**
 * Phase 3.25：镶嵌 picker 子 composable（原 useRuneInventoryController 中 embed 面板部分）。
 *
 * - picker 状态（pickerRuneId / showPicker）与失效 watch（Phase 3.10.2）；
 * - 目标数据完全来自纯视图 targets 快照（canonical Rune ID，无 raw 遍历）；
 * - openPanel 为内部打开（不含面板互斥——互斥由顶层 controller 协调）；
 * - confirmEmbed 唯一调用 playerStore.tryEmbedEquipmentRune，失败保持 dialog 打开不伪报成功。
 *
 * 依赖经 context 注入（view / rows / feedback / playerStore），不自行构建视图。
 */
export interface RuneEmbedPanelContext {
  playerStore: {
    tryEmbedEquipmentRune(
      equipmentSlot: EquipmentSlot,
      runeSlotIndex: number,
      runeId: string
    ): { ok: boolean; reason?: string }
  }
  view: ComputedRef<RuneInventoryViewResult>
  rows: ComputedRef<RuneInventoryRow[]>
  feedback: Ref<RunePanelFeedback>
}

export function useRuneEmbedPanel(context: RuneEmbedPanelContext) {
  const { playerStore, view, rows, feedback } = context

  // picker 以 Rune canonical ID 为身份，避免筛选/排序/追加导致数组位置漂移
  const pickerRuneId = ref<string | null>(null)
  const showPicker = ref(false)

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
        closePanel()
      }
    }
  )

  /** 内部打开（互斥由顶层 controller 协调）。 */
  function openPanel(runeId: string) {
    // 安全边界守卫：视图损坏或目标 Rune 不存在，绝不打开空白 dialog
    if (!view.value.ok) return
    if (!rows.value.some(row => row.rune.id === runeId)) return
    pickerRuneId.value = runeId
    showPicker.value = true
    feedback.value = null
  }

  function closePanel() {
    showPicker.value = false
    pickerRuneId.value = null
  }

  function confirmEmbed(slot: EquipmentSlot, index: number) {
    // 安全边界守卫：视图损坏或目标 Rune 已不存在，绝不调用事务、绝不伪报成功
    if (!view.value.ok) {
      closePanel()
      return
    }
    const rune = pickerRune.value
    if (!rune) {
      closePanel()
      return
    }
    try {
      const res = playerStore.tryEmbedEquipmentRune(slot, index, rune.rune.id)
      if (res.ok) {
        feedback.value = { kind: 'success', message: `已镶嵌：${rune.displayName}` }
        closePanel()
      } else {
        feedback.value = { kind: 'error', message: `镶嵌失败：${res.reason ?? '未知原因'}` }
      }
    } catch {
      feedback.value = { kind: 'error', message: '镶嵌操作失败' }
    }
  }

  return {
    showPicker,
    pickerRune,
    equippedTargets,
    openPanel,
    closePanel,
    confirmEmbed
  }
}
