import { computed, ref, watch, type ComputedRef, type Ref } from 'vue'
import type { RuneInventoryRow, RuneInventoryViewResult } from '../utils/runeInventoryView'
import { STAT_NAMES } from '../types'
import { getRuneFeedExperience, planRuneBatchFeeding } from '../utils/runeFeeding'
import { getRuneExperienceProgress } from '../utils/runeExperience'
import { getRuneEffectiveValue } from '../utils/equipmentRunes'
import type { Rune } from '../stores/runeStore'
import type { RuneBatchFeedingTransactionResult } from '../stores/playerStore'
import type { RunePanelFeedback } from './runePanelTypes'

/**
 * Phase 3.25：强化面板子 composable（原 useRuneInventoryController 中 feed 面板部分）。
 *
 * - 面板以 canonical Rune ID 为身份（选择状态只存 ID，不存 index / 对象引用）；
 * - 材料候选完全派生自纯视图 rows；预览复用 planRuneBatchFeeding（纯规划，零修改零写盘）；
 * - 经验求和唯一来源为 planRuneBatchFeeding.expAdded（组件/面板侧不维护第二份求和）；
 * - 确认唯一调用 playerStore.tryFeedRunes 批量原子事务；
 * - 失效 watch：视图损坏/目标消失/满级 → 关闭；已选材料失效 → 仅移除该 ID；
 * - openPanel 为内部打开（不含面板互斥——互斥由顶层 controller 协调）。
 */
export interface RuneFeedPanelContext {
  playerStore: {
    runeInventory: Rune[]
    player: { equipment: unknown }
    tryFeedRunes(targetRuneId: string, materialRuneIds: readonly string[]): RuneBatchFeedingTransactionResult
  }
  view: ComputedRef<RuneInventoryViewResult>
  rows: ComputedRef<RuneInventoryRow[]>
  feedback: Ref<RunePanelFeedback>
}

export function useRuneFeedPanel(context: RuneFeedPanelContext) {
  const { playerStore, view, rows, feedback } = context

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

  // 选择摘要：枚数来自 canonical ID 数组；总经验唯一来源为批量规划器 feedPreview
  //（planRuneBatchFeeding.expAdded）——面板侧不维护第二份经验求和。
  const feedSelectionSummary = computed(() => {
    const count = feedMaterialRuneIds.value.length
    if (count === 0) return { count: 0, totalExp: 0 as number | null }
    const plan = feedPreview.value
    // 规划器暂不可用（例如某个已选材料瞬间失效）：显示"不可用"占位，绝不伪显示 +0 EXP
    return { count, totalExp: plan ? (plan.expAdded as number | null) : null }
  })

  // 预览：完全复用批量纯规划器；任何不满足 → null（不显示预览、不允许确认）
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

  // 强化预览展示模型：把纯 helper 结果整理为完整展示字段，全部数值复用既有唯一来源
  //（planRuneFeeding / getRuneExperienceProgress / getRuneEffectiveValue / STAT_NAMES）。
  // 不复制经验阈值 / 升级循环 / statValue 成长 / 有效属性公式 / type→stat 映射。
  const feedPreviewModel = computed(() => {
    const plan = feedPreview.value
    if (plan === null) return null
    const target = feedTarget.value
    const materials = feedMaterials.value
    if (target === null || materials.length === 0) return null
    const currentProgress = getRuneExperienceProgress(plan.targetRune)
    const nextProgress = getRuneExperienceProgress(plan.nextTargetRune)
    if (currentProgress === null || nextProgress === null) return null
    // 消耗名单：按 plan.consumedRuneIds（inventoryIndex 升序）映射 displayName；
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
        closePanel()
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

  /**
   * 打开前检查（供顶层互斥 wrapper 在关闭其他面板前调用）：
   * 视图有效、目标存在且未满级。与 openPanel 的守卫一致。
   */
  function canOpenPanel(runeId: string): boolean {
    if (!view.value.ok) return false
    const target = rows.value.find(row => row.rune.id === runeId)
    if (!target) return false
    if (target.experience.isMax) return false
    return true
  }

  /** 内部打开（互斥由顶层 controller 协调）。canOpenPanel 是唯一打开资格判断。 */
  function openPanel(runeId: string) {
    if (!canOpenPanel(runeId)) return
    feedTargetRuneId.value = runeId
    feedMaterialRuneIds.value = []
    showFeedPanel.value = true
    feedback.value = null
  }

  function closePanel() {
    showFeedPanel.value = false
    feedTargetRuneId.value = null
    feedMaterialRuneIds.value = []
  }

  // §19：逐枚手动勾选 / 取消勾选；无全选、无自动选择
  function toggleMaterial(runeId: string) {
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
      closePanel()
      return
    }
    const target = feedTarget.value
    if (!target || target.experience.isMax) {
      closePanel()
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
        closePanel()
      } else {
        // 失败：整批零消耗，面板与选择保持不变，绝不显示成功（无 alert）
        feedback.value = { kind: 'error', message: `强化失败：${res.reason ?? '未知原因'}` }
      }
    } catch {
      feedback.value = { kind: 'error', message: '强化操作失败' }
    }
  }

  return {
    showFeedPanel,
    feedTarget,
    feedCandidates,
    feedMaterialRuneIds,
    feedSelectionSummary,
    feedPreviewModel,
    canOpenPanel,
    openPanel,
    closePanel,
    toggleMaterial,
    confirmFeed
  }
}
