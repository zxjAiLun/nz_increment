import { describe, it, expect, vi, beforeEach } from 'vitest'
import { computed, nextTick, ref, type ComputedRef, type Ref } from 'vue'
import { useRuneEmbedPanel } from './useRuneEmbedPanel'
import { useRuneFeedPanel } from './useRuneFeedPanel'
import { useRuneBatchLockPanel } from './useRuneBatchLockPanel'
import type { RuneBindingView, RuneInventoryRow, RuneInventoryViewResult } from '../utils/runeInventoryView'
import type { Rune } from '../stores/runeStore'
import type { EquipmentSlot } from '../types'
import type { RuneBatchFeedingTransactionResult, RuneBatchLockTransactionResult } from '../stores/playerStore'
import { planRuneBatchFeeding } from '../utils/runeFeeding'

/**
 * Phase 3.26：三个 Rune 面板子 composable 的直接行为契约（ref/computed stub context）。
 *
 * 不检查返回成员、不扫描源码；直接构造最小 stub context 驱动状态与事务行为：
 * - view：viewOk ref 驱动（可切换合法/损坏）+ rowsArr 驱动 rows；
 * - playerStore：只 stub 该面板用到的 try* 方法（vi.fn）；
 * - feedback：真实 ref。
 *
 * 覆盖 spec 要求的全部行为：打开资格（canOpenPanel 唯一判断）、失效 watch、
 * 材料失效只移除失效 ID、幂等不调 Store、成功关闭/失败保持等。
 * 不导出任何面板内部 computed / 私有状态。
 */
type Feedback = { kind: 'success' | 'error'; message: string } | null

function makeRune(id: string, opts?: Partial<Omit<Rune, 'id'>>): Rune {
  const rune: Rune = {
    id,
    type: opts?.type ?? 'attack',
    rarity: opts?.rarity ?? 'common',
    level: opts?.level ?? 1,
    exp: opts?.exp ?? 0,
    statValue: opts?.statValue ?? 10
  }
  if (opts && 'isLocked' in opts) rune.isLocked = opts.isLocked
  return rune
}

/** 构造 RuneInventoryRow stub（仅提供面板逻辑消费的字段）。 */
function makeRow(id: string, opts?: { isMax?: boolean; isLocked?: boolean; binding?: RuneBindingView | null }): RuneInventoryRow {
  const isMax = opts?.isMax ?? false
  const level = isMax ? 50 : 1
  const rune = makeRune(id, { level, exp: 0, ...(opts?.isLocked !== undefined ? { isLocked: opts.isLocked } : {}) })
  return {
    inventoryIndex: 0,
    rune,
    displayName: `符文${id}`,
    colorClass: '',
    rarityLabel: '普通',
    effectiveValue: 10,
    stat: 'attack',
    experience: isMax
      ? { level: 50, currentExp: 0, requiredExp: null, percent: 100, isMax: true }
      : { level: 1, currentExp: 0, requiredExp: 20, percent: 0, isMax: false },
    binding: opts?.binding ?? null,
    isLocked: opts?.isLocked ?? false
  }
}

/** 可变 stub 视图 + rows：viewOk 切换合法/损坏，rowsArr 驱动行集合。 */
function makeViewStub(initialRows: RuneInventoryRow[]) {
  const viewOk = ref(true)
  const rowsArr = ref<RuneInventoryRow[]>(initialRows)
  const view: ComputedRef<RuneInventoryViewResult> = computed(() =>
    viewOk.value ? { ok: true, rows: rowsArr.value, targets: [] } : { ok: false, reason: 'stub broken' }
  )
  const rows: ComputedRef<RuneInventoryRow[]> = computed(() => rowsArr.value)
  return { viewOk, rowsArr, view, rows }
}

function makeFeedback() {
  return ref<Feedback>(null) as Ref<Feedback>
}

beforeEach(() => {
  vi.restoreAllMocks()
})

// ============================================================================
// Embed（镶嵌 picker）
// ============================================================================
describe('useRuneEmbedPanel 行为契约', () => {
  it('view 损坏或 ID 不存在：canOpenPanel=false，openPanel 不改变状态与 feedback', () => {
    const { viewOk, view, rows } = makeViewStub([makeRow('r0')])
    const feedback = makeFeedback()
    const embed = useRuneEmbedPanel({ playerStore: { tryEmbedEquipmentRune: vi.fn(() => ({ ok: true })) }, view, rows, feedback })

    // view 损坏
    viewOk.value = false
    expect(embed.canOpenPanel('r0')).toBe(false)
    embed.openPanel('r0')
    expect(embed.showPicker.value).toBe(false)
    expect(feedback.value).toBeNull()

    // view 恢复但 ID 不存在
    viewOk.value = true
    expect(embed.canOpenPanel('missing-id')).toBe(false)
    embed.openPanel('missing-id')
    expect(embed.showPicker.value).toBe(false)
    expect(feedback.value).toBeNull()
  })

  it('合法 ID 可以打开：showPicker=true、pickerRune 指向该行', () => {
    const { view, rows } = makeViewStub([makeRow('r0'), makeRow('r1')])
    const feedback = makeFeedback()
    const embed = useRuneEmbedPanel({ playerStore: { tryEmbedEquipmentRune: vi.fn(() => ({ ok: true })) }, view, rows, feedback })

    expect(embed.canOpenPanel('r1')).toBe(true)
    embed.openPanel('r1')
    expect(embed.showPicker.value).toBe(true)
    expect(embed.pickerRune.value?.rune.id).toBe('r1')
  })

  it('目标从 rows 消失或 view 损坏：失效 watch 自动关闭面板', async () => {
    const { viewOk, rowsArr, view, rows } = makeViewStub([makeRow('r0'), makeRow('r1')])
    const feedback = makeFeedback()
    const embed = useRuneEmbedPanel({ playerStore: { tryEmbedEquipmentRune: vi.fn(() => ({ ok: true })) }, view, rows, feedback })
    embed.openPanel('r1')
    expect(embed.showPicker.value).toBe(true)

    // 目标消失
    rowsArr.value = [makeRow('r0')]
    await nextTick()
    expect(embed.showPicker.value).toBe(false)

    // 重新打开后 view 损坏
    embed.openPanel('r0')
    expect(embed.showPicker.value).toBe(true)
    viewOk.value = false
    await nextTick()
    expect(embed.showPicker.value).toBe(false)
  })

  it('confirmEmbed 成功：关闭面板并显示成功反馈', () => {
    const { view, rows } = makeViewStub([makeRow('r0')])
    const feedback = makeFeedback()
    const tryEmbedEquipmentRune = vi.fn(() => ({ ok: true }))
    const embed = useRuneEmbedPanel({ playerStore: { tryEmbedEquipmentRune }, view, rows, feedback })
    embed.openPanel('r0')

    embed.confirmEmbed('weapon' as EquipmentSlot, 0)

    expect(tryEmbedEquipmentRune).toHaveBeenCalledWith('weapon', 0, 'r0')
    expect(embed.showPicker.value).toBe(false)
    expect(feedback.value?.kind).toBe('success')
    expect(feedback.value?.message).toContain('符文r0')
  })

  it('confirmEmbed Store 失败：面板保持打开并显示错误', () => {
    const { view, rows } = makeViewStub([makeRow('r0')])
    const feedback = makeFeedback()
    const tryEmbedEquipmentRune = vi.fn(() => ({ ok: false, reason: 'slot occupied' }))
    const embed = useRuneEmbedPanel({ playerStore: { tryEmbedEquipmentRune }, view, rows, feedback })
    embed.openPanel('r0')

    embed.confirmEmbed('weapon' as EquipmentSlot, 0)

    expect(embed.showPicker.value).toBe(true)
    expect(feedback.value?.kind).toBe('error')
    expect(feedback.value?.message).toContain('slot occupied')
  })

  it('confirmEmbed Store 抛异常：面板保持打开并显示错误', () => {
    const { view, rows } = makeViewStub([makeRow('r0')])
    const feedback = makeFeedback()
    const tryEmbedEquipmentRune = vi.fn(() => {
      throw new Error('boom')
    })
    const embed = useRuneEmbedPanel({ playerStore: { tryEmbedEquipmentRune }, view, rows, feedback })
    embed.openPanel('r0')

    embed.confirmEmbed('weapon' as EquipmentSlot, 0)

    expect(embed.showPicker.value).toBe(true)
    expect(feedback.value?.kind).toBe('error')
    expect(feedback.value?.message).toBe('镶嵌操作失败')
  })
})

// ============================================================================
// Feed（强化面板）
// ============================================================================
function feedRunes() {
  return [
    makeRune('t1', { level: 2 }),
    makeRune('m1', { level: 1, exp: 0, type: 'defense' }),
    makeRune('m2', { level: 1, exp: 0, type: 'luck' })
  ]
}

function feedContext(overrides?: { tryFeedRunes?: (t: string, m: readonly string[]) => RuneBatchFeedingTransactionResult }) {
  const { rowsArr, view, rows } = makeViewStub([makeRow('t1'), makeRow('m1'), makeRow('m2')])
  const feedback = makeFeedback()
  const playerStore = {
    runeInventory: feedRunes(),
    player: { equipment: {} },
    tryFeedRunes: vi.fn(
      overrides?.tryFeedRunes ??
        ((): RuneBatchFeedingTransactionResult => ({
          ok: true,
          expAdded: 10,
          levelsGained: 1,
          level: 3,
          exp: 10,
          materialsConsumed: 2,
          consumedRuneIds: ['m1', 'm2']
        }))
    )
  }
  const feed = useRuneFeedPanel({ playerStore, view, rows, feedback })
  return { feed, playerStore, rowsArr, feedback }
}

describe('useRuneFeedPanel 行为契约', () => {
  it('缺失目标 / 满级目标 / 损坏 view：canOpenPanel=false，openPanel 不打开', () => {
    const { feed } = feedContext()
    const broken = useRuneFeedPanel({
      playerStore: { runeInventory: [], player: { equipment: {} }, tryFeedRunes: vi.fn() },
      view: computed(() => ({ ok: false, reason: 'broken' } as RuneInventoryViewResult)),
      rows: computed(() => [] as RuneInventoryRow[]),
      feedback: makeFeedback()
    })

    // 缺失目标
    expect(feed.canOpenPanel('missing-id')).toBe(false)
    feed.openPanel('missing-id')
    expect(feed.showFeedPanel.value).toBe(false)

    // 满级目标（rows 中 t1 替换为满级行）
    const fullRows = [makeRow('t1', { isMax: true }), makeRow('m1'), makeRow('m2')]
    const view2 = computed(() => ({ ok: true, rows: fullRows, targets: [] }) as RuneInventoryViewResult)
    const feed2 = useRuneFeedPanel({
      playerStore: { runeInventory: feedRunes(), player: { equipment: {} }, tryFeedRunes: vi.fn() },
      view: view2,
      rows: computed(() => fullRows),
      feedback: makeFeedback()
    })
    expect(feed2.canOpenPanel('t1')).toBe(false)
    feed2.openPanel('t1')
    expect(feed2.showFeedPanel.value).toBe(false)

    // 损坏 view
    expect(broken.canOpenPanel('t1')).toBe(false)
    broken.openPanel('t1')
    expect(broken.showFeedPanel.value).toBe(false)
  })

  it('合法目标打开：清空旧材料选择与 feedback', () => {
    const { feed } = feedContext()
    feed.openPanel('t1')
    feed.toggleMaterial('m1')
    expect(feed.feedMaterialRuneIds.value).toEqual(['m1'])

    // 重新打开同一目标（或新目标）→ 材料选择与 feedback 清空
    feed.toggleMaterial('m2')
    feed.openPanel('t1')
    expect(feed.feedMaterialRuneIds.value).toEqual([])
    expect(feed.showFeedPanel.value).toBe(true)
  })

  it('材料失效：只移除失效 ID，其余选择保留', async () => {
    const { feed, rowsArr } = feedContext()
    feed.openPanel('t1')
    feed.toggleMaterial('m1')
    feed.toggleMaterial('m2')
    expect(feed.feedMaterialRuneIds.value).toEqual(['m1', 'm2'])

    // m2 被锁定 → 从候选消失 → watch 只移除 m2
    rowsArr.value = [makeRow('t1'), makeRow('m1'), makeRow('m2', { isLocked: true })]
    await nextTick()
    expect(feed.feedMaterialRuneIds.value).toEqual(['m1'])
    expect(feed.showFeedPanel.value).toBe(true)
  })

  it('Store 成功：关闭面板并清空材料选择', () => {
    const { feed, playerStore } = feedContext()
    feed.openPanel('t1')
    feed.toggleMaterial('m1')
    feed.toggleMaterial('m2')
    expect(feed.feedPreviewModel.value).not.toBeNull()

    feed.confirmFeed()

    expect(playerStore.tryFeedRunes).toHaveBeenCalledTimes(1)
    expect(feed.showFeedPanel.value).toBe(false)
    expect(feed.feedMaterialRuneIds.value).toEqual([])
  })

  it('Store 返回失败：面板与选择保持，显示错误', () => {
    const { feed, feedback } = feedContext({
      tryFeedRunes: (): RuneBatchFeedingTransactionResult => ({
        ok: false,
        reason: 'target gone',
        expAdded: 0,
        levelsGained: 0,
        materialsConsumed: 0,
        consumedRuneIds: []
      })
    })
    feed.openPanel('t1')
    feed.toggleMaterial('m1')

    feed.confirmFeed()

    expect(feed.showFeedPanel.value).toBe(true)
    expect(feed.feedMaterialRuneIds.value).toEqual(['m1'])
    expect(feedback.value?.kind).toBe('error')
    expect(feedback.value?.message).toContain('target gone')
  })

  it('Store 抛异常：面板与选择保持，显示错误', () => {
    const { feed, feedback } = feedContext({
      tryFeedRunes: (): RuneBatchFeedingTransactionResult => {
        throw new Error('boom')
      }
    })
    feed.openPanel('t1')
    feed.toggleMaterial('m1')

    feed.confirmFeed()

    expect(feed.showFeedPanel.value).toBe(true)
    expect(feed.feedMaterialRuneIds.value).toEqual(['m1'])
    expect(feedback.value?.kind).toBe('error')
    expect(feedback.value?.message).toBe('强化操作失败')
  })

  it('预览只复用既有 planner：feedPreviewModel 与 planRuneBatchFeeding 逐字段一致', () => {
    const { feed } = feedContext()
    feed.openPanel('t1')
    feed.toggleMaterial('m1')
    feed.toggleMaterial('m2')

    const model = feed.feedPreviewModel.value
    expect(model).not.toBeNull()
    const directPlan = planRuneBatchFeeding({
      targetRuneId: 't1',
      materialRuneIds: ['m1', 'm2'],
      inventory: feedRunes(),
      equipmentBySlot: {}
    })
    expect(directPlan.ok).toBe(true)
    if (model && directPlan.ok) {
      expect(model.expAdded).toBe(directPlan.expAdded)
      expect(model.levelsGained).toBe(directPlan.levelsGained)
      expect(model.currentLevel).toBe(directPlan.targetRune.level)
      expect(model.nextLevel).toBe(directPlan.nextTargetRune.level)
    }
  })
})

// ============================================================================
// BatchLock（批量锁定）
// ============================================================================
describe('useRuneBatchLockPanel 行为契约', () => {
  it('损坏 view：canOpenPanel=false，openPanel 不打开', () => {
    const { rows } = makeViewStub([makeRow('r0', { isLocked: false })])
    const feedback = makeFeedback()
    const batchLock = useRuneBatchLockPanel({
      playerStore: { trySetRunesLocked: vi.fn() },
      view: computed(() => ({ ok: false, reason: 'broken' } as RuneInventoryViewResult)),
      rows,
      feedback
    })
    expect(batchLock.canOpenPanel()).toBe(false)
    batchLock.openPanel()
    expect(batchLock.showBatchLockPanel.value).toBe(false)
  })

  it('Rune 从 rows 消失：只移除对应选择', async () => {
    const { rowsArr, view, rows } = makeViewStub([makeRow('r0', { isLocked: false }), makeRow('r1', { isLocked: false })])
    const feedback = makeFeedback()
    const batchLock = useRuneBatchLockPanel({ playerStore: { trySetRunesLocked: vi.fn() }, view, rows, feedback })
    batchLock.openPanel()
    batchLock.toggleRune('r0')
    batchLock.toggleRune('r1')
    expect(batchLock.batchLockRuneIds.value).toEqual(['r0', 'r1'])

    rowsArr.value = [makeRow('r0', { isLocked: false })]
    await nextTick()
    expect(batchLock.batchLockRuneIds.value).toEqual(['r0'])
    expect(batchLock.showBatchLockPanel.value).toBe(true)
  })

  it('锁定状态变化：不移除选择，只更新 preview', async () => {
    const { rowsArr, view, rows } = makeViewStub([makeRow('r0', { isLocked: false }), makeRow('r1', { isLocked: false })])
    const feedback = makeFeedback()
    const batchLock = useRuneBatchLockPanel({ playerStore: { trySetRunesLocked: vi.fn() }, view, rows, feedback })
    batchLock.openPanel()
    batchLock.toggleRune('r0')
    batchLock.toggleRune('r1')
    expect(batchLock.batchLockPreview.value?.changedCount).toBe(2)

    // r0 已被外部锁定 → 选择保持，preview 只剩 r1 变化
    rowsArr.value = [makeRow('r0', { isLocked: true }), makeRow('r1', { isLocked: false })]
    await nextTick()
    expect(batchLock.batchLockRuneIds.value).toEqual(['r0', 'r1'])
    expect(batchLock.batchLockPreview.value?.changedCount).toBe(1)
    expect(batchLock.batchLockPreview.value?.changedRuneIds).toEqual(['r1'])
  })

  it('全部幂等：confirm 不调用 Store', () => {
    const { view, rows } = makeViewStub([makeRow('r0', { isLocked: true })])
    const feedback = makeFeedback()
    const trySetRunesLocked = vi.fn()
    const batchLock = useRuneBatchLockPanel({ playerStore: { trySetRunesLocked }, view, rows, feedback })
    batchLock.openPanel()
    batchLock.toggleRune('r0') // r0 已锁定，目标态默认锁定 → changedCount=0

    expect(batchLock.batchLockPreview.value?.changedCount).toBe(0)
    batchLock.confirm()

    expect(trySetRunesLocked).not.toHaveBeenCalled()
    expect(batchLock.showBatchLockPanel.value).toBe(true)
  })

  it('Store 成功：关闭面板并清空选择、恢复目标状态默认', () => {
    const { view, rows } = makeViewStub([makeRow('r0', { isLocked: false }), makeRow('r1', { isLocked: false })])
    const feedback = makeFeedback()
    const trySetRunesLocked = vi.fn(
      (): RuneBatchLockTransactionResult => ({
        ok: true,
        isLocked: true,
        selectedCount: 1,
        changedCount: 1,
        unchangedCount: 0,
        changedRuneIds: ['r0'],
        unchangedRuneIds: []
      })
    )
    const batchLock = useRuneBatchLockPanel({ playerStore: { trySetRunesLocked }, view, rows, feedback })
    batchLock.openPanel()
    batchLock.toggleRune('r0')
    batchLock.batchLockDesiredState.value = true

    batchLock.confirm()

    expect(trySetRunesLocked).toHaveBeenCalledTimes(1)
    expect(batchLock.showBatchLockPanel.value).toBe(false)
    expect(batchLock.batchLockRuneIds.value).toEqual([])
    expect(batchLock.batchLockDesiredState.value).toBe(true)
  })

  it('Store 返回失败：面板、选择、目标状态保持，显示错误', () => {
    const { view, rows } = makeViewStub([makeRow('r0', { isLocked: false })])
    const feedback = makeFeedback()
    const trySetRunesLocked = vi.fn(
      (): RuneBatchLockTransactionResult => ({
        ok: false,
        reason: 'stale inventory',
        selectedCount: 0,
        changedCount: 0,
        unchangedCount: 0,
        changedRuneIds: [],
        unchangedRuneIds: []
      })
    )
    const batchLock = useRuneBatchLockPanel({ playerStore: { trySetRunesLocked }, view, rows, feedback })
    batchLock.openPanel()
    batchLock.toggleRune('r0')
    // r0 未锁定 → 目标态锁定（默认 true）有实际变化 → 会调用 Store
    expect(batchLock.batchLockPreview.value?.changedCount).toBe(1)

    batchLock.confirm()

    expect(trySetRunesLocked).toHaveBeenCalledTimes(1)
    expect(batchLock.showBatchLockPanel.value).toBe(true)
    expect(batchLock.batchLockRuneIds.value).toEqual(['r0'])
    expect(batchLock.batchLockDesiredState.value).toBe(true)
    expect(feedback.value?.kind).toBe('error')
    expect(feedback.value?.message).toContain('stale inventory')
  })

  it('Store 抛异常：面板、选择、目标状态保持，显示错误', () => {
    const { view, rows } = makeViewStub([makeRow('r0', { isLocked: false })])
    const feedback = makeFeedback()
    const trySetRunesLocked = vi.fn(() => {
      throw new Error('boom')
    })
    const batchLock = useRuneBatchLockPanel({ playerStore: { trySetRunesLocked }, view, rows, feedback })
    batchLock.openPanel()
    batchLock.toggleRune('r0')
    expect(batchLock.batchLockPreview.value?.changedCount).toBe(1)

    batchLock.confirm()

    expect(batchLock.showBatchLockPanel.value).toBe(true)
    expect(batchLock.batchLockRuneIds.value).toEqual(['r0'])
    expect(batchLock.batchLockDesiredState.value).toBe(true)
    expect(feedback.value?.kind).toBe('error')
    expect(feedback.value?.message).toBe('批量锁定操作失败')
  })
})
