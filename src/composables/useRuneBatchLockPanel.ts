import { computed, ref, watch, type ComputedRef, type Ref } from 'vue'
import type { RuneInventoryRow, RuneInventoryViewResult } from '../utils/runeInventoryView'
import { planRuneBatchLockChange } from '../utils/runeLocking'
import type { RuneBatchLockTransactionResult } from '../stores/playerStore'
import type { RunePanelFeedback } from './runePanelTypes'

/**
 * Phase 3.25：批量锁定面板子 composable（原 useRuneInventoryController 中 batchLock 面板部分）。
 *
 * - 面板身份与候选全部来自未筛选 canonical rows（不直接遍历 raw inventory）；
 * - 本地状态只存 canonical Rune ID 与目标 boolean（不存 index / 对象引用 / 不持久化）；
 * - 预览唯一来源 planRuneBatchLockChange（面板侧不重新实现锁定分类）；
 * - 确认唯一调用 playerStore.trySetRunesLocked 批量原子事务；
 * - 失效 watch：视图损坏 → 关闭；已选 Rune 从 inventory 消失 → 仅移除该 ID；
 * - openPanel 为内部打开（不含面板互斥——互斥由顶层 controller 协调）。
 */
export interface RuneBatchLockPanelContext {
  playerStore: {
    trySetRunesLocked(runeIds: readonly string[], isLocked: boolean): RuneBatchLockTransactionResult
  }
  view: ComputedRef<RuneInventoryViewResult>
  rows: ComputedRef<RuneInventoryRow[]>
  feedback: Ref<RunePanelFeedback>
}

export function useRuneBatchLockPanel(context: RuneBatchLockPanelContext) {
  const { playerStore, view, rows, feedback } = context

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

  // 实际会变化的 Rune 名称（来自 plan.changedRuneIds，不在面板内重新分类）
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
      closePanel()
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

  /**
   * 打开前检查（供顶层互斥 wrapper 在关闭其他面板前调用）：视图有效。
   * 与 openPanel 的守卫一致。
   */
  function canOpenPanel(): boolean {
    return view.value.ok
  }

  /** 内部打开（互斥由顶层 controller 协调）。canOpenPanel 是唯一打开资格判断。 */
  function openPanel() {
    if (!canOpenPanel()) return
    batchLockRuneIds.value = []
    batchLockDesiredState.value = true
    showBatchLockPanel.value = true
    feedback.value = null
  }

  function closePanel() {
    // §21：关闭即清空选择并恢复目标状态默认值
    showBatchLockPanel.value = false
    batchLockRuneIds.value = []
    batchLockDesiredState.value = true
  }

  // §22：逐枚手动选择 / 取消；无全选、无反选、无自动选择
  function toggleRune(runeId: string) {
    if (!rows.value.some(row => row.rune.id === runeId)) return
    if (batchLockRuneIds.value.includes(runeId)) {
      batchLockRuneIds.value = batchLockRuneIds.value.filter(id => id !== runeId)
    } else {
      batchLockRuneIds.value = [...batchLockRuneIds.value, runeId]
    }
  }

  function confirm() {
    // 安全边界守卫：视图损坏关闭面板、绝不调用事务
    if (!view.value.ok) {
      closePanel()
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
        closePanel()
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
    showBatchLockPanel,
    batchLockRuneIds,
    batchLockDesiredState,
    batchLockCandidates,
    batchLockPreview,
    batchLockChangedNames,
    canOpenPanel,
    openPanel,
    closePanel,
    toggleRune,
    confirm
  }
}
