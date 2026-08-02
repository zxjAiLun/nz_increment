import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useRuneInventoryController } from './useRuneInventoryController'
import { usePlayerStore } from '../stores/playerStore'
import type { Rune } from '../stores/runeStore'
import { createEmptyEquipmentRuneSlots } from '../utils/equipmentRunes'
import type { Equipment, EquipmentSlot, RuneSlot } from '../types'
import type { RuneBindingView, RuneInventoryRow } from '../utils/runeInventoryView'

/**
 * Phase 3.27：useRuneInventoryController 直接行为契约（真实 Pinia + playerStore fixture）。
 *
 * 覆盖顶层共享状态、单 Rune 操作（confirmRemove / toggleLock）与反馈行为；
 * 通过 vi.spyOn 控制 Store 事务结果。不扫描源码；不重复测试子面板
 * （watcher / preview / confirm 事务 / guard-before-mutex）与 40 个返回成员——
 * 这些已由 Phase 3.25–3.26 覆盖。
 */
const SLOT_A: EquipmentSlot = 'weapon'

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

function makeRuneEquip(id: string, slot: EquipmentSlot, opts?: { runeSlots?: RuneSlot[] }): Equipment {
  return {
    id,
    slot,
    name: id,
    rarity: 'common',
    level: 10,
    stats: [{ type: 'attack', value: 100, isPercent: false }],
    isLocked: false,
    affixes: [],
    refiningSlots: [],
    refiningLevel: 0,
    runeSlots: opts?.runeSlots ?? createEmptyEquipmentRuneSlots()
  }
}

function slotsWith(...runeIds: (string | null)[]): RuneSlot[] {
  const slots = createEmptyEquipmentRuneSlots()
  for (let i = 0; i < Math.min(3, runeIds.length); i++) {
    slots[i] = { index: i, runeId: runeIds[i] }
  }
  return slots
}

/** 构造 RuneInventoryRow stub（仅提供顶层单卡操作消费的字段）。 */
function makeRow(id: string, opts?: { isLocked?: boolean; binding?: RuneBindingView | null }): RuneInventoryRow {
  const rune = makeRune(id, { level: 1, exp: 0, ...(opts?.isLocked !== undefined ? { isLocked: opts.isLocked } : {}) })
  return {
    inventoryIndex: 0,
    rune,
    displayName: `符文${id}`,
    colorClass: '',
    rarityLabel: '普通',
    effectiveValue: 10,
    stat: 'attack',
    experience: { level: 1, currentExp: 0, requiredExp: 20, percent: 0, isMax: false },
    binding: opts?.binding ?? null,
    isLocked: opts?.isLocked ?? false
  } as RuneInventoryRow
}

/** 标准夹具（5 枚）：r3/r4 可嵌入 weapon（runeSlots: r3@0, r4@1），其余未镶嵌。 */
const STANDARD = (): Rune[] => [
  makeRune('r0', { type: 'attack', rarity: 'common', isLocked: false }),
  makeRune('r1', { type: 'attack', rarity: 'rare', isLocked: true }),
  makeRune('r2', { type: 'luck', rarity: 'common', isLocked: false }),
  makeRune('r3', { type: 'crit', rarity: 'epic', isLocked: false }),
  makeRune('r4', { type: 'luck', rarity: 'legend', isLocked: true })
]

function setupFixture(runes: Rune[], opts?: { embed?: boolean; broken?: boolean }) {
  setActivePinia(createPinia())
  localStorage.clear()
  const playerStore = usePlayerStore()
  playerStore.runeInventory = runes
  if (opts?.embed) {
    playerStore.player.equipment[SLOT_A] = makeRuneEquip('w1', SLOT_A, { runeSlots: slotsWith('r3', 'r4', null) })
  }
  if (opts?.broken) {
    playerStore.player.equipment[SLOT_A] = makeRuneEquip('w1', SLOT_A, { runeSlots: slotsWith('ghost', null, null) })
  }
  const controller = useRuneInventoryController()
  return { controller, playerStore }
}

beforeEach(() => {
  vi.restoreAllMocks()
})

// ============================================================================
// 1. 共享视图与筛选状态
// ============================================================================
describe('useRuneInventoryController 共享视图与筛选', () => {
  it('初始 filter / sortKey / isDefaultFilterSort / rows / sorted 正确', () => {
    const { controller } = setupFixture(STANDARD())
    expect(controller.filter.value).toEqual({ type: 'all', rarity: 'all', status: 'all', lock: 'all' })
    expect(controller.sortKey.value).toBe('inventory')
    expect(controller.isDefaultFilterSort.value).toBe(true)
    expect(controller.isBroken.value).toBe(false)
    expect(controller.rows.value).toHaveLength(5)
    expect(controller.sorted.value).toHaveLength(5)
  })

  it('修改筛选/排序后 sorted 与默认态正确更新', () => {
    const { controller } = setupFixture(STANDARD())
    controller.filter.value = { type: 'attack', rarity: 'all', status: 'all', lock: 'all' }
    expect(controller.isDefaultFilterSort.value).toBe(false)
    expect(controller.sorted.value.map(r => r.rune.id)).toEqual(['r0', 'r1'])

    controller.sortKey.value = 'locked-first'
    // 筛选仍生效；locked-first 使 r1（已锁定）排在 r0 前
    expect(controller.sorted.value.map(r => r.rune.id)).toEqual(['r1', 'r0'])
  })

  it('resetFilterSort 只恢复筛选与排序，不动其他状态', () => {
    const { controller } = setupFixture(STANDARD())
    controller.filter.value = { type: 'luck', rarity: 'all', status: 'all', lock: 'all' }
    controller.sortKey.value = 'rarity'
    expect(controller.isDefaultFilterSort.value).toBe(false)

    controller.resetFilterSort()

    expect(controller.filter.value).toEqual({ type: 'all', rarity: 'all', status: 'all', lock: 'all' })
    expect(controller.sortKey.value).toBe('inventory')
    expect(controller.isDefaultFilterSort.value).toBe(true)
    expect(controller.sorted.value.map(r => r.rune.id)).toEqual(['r0', 'r1', 'r2', 'r3', 'r4'])
  })

  it('resetFilterSort 不关闭 picker 也不清空其身份', () => {
    const { controller } = setupFixture(STANDARD())
    controller.openPicker('r0')
    controller.filter.value = { type: 'attack', rarity: 'all', status: 'all', lock: 'all' }

    controller.resetFilterSort()

    expect(controller.showPicker.value).toBe(true)
    expect(controller.pickerRune.value?.rune.id).toBe('r0')
  })

  it('resetFilterSort 不关闭强化面板也不清空材料选择', () => {
    const { controller } = setupFixture(STANDARD())
    controller.openFeedPanel('r2')
    controller.toggleFeedMaterial('r0')
    controller.filter.value = { type: 'luck', rarity: 'all', status: 'all', lock: 'all' }
    expect(controller.feedMaterialRuneIds.value).toEqual(['r0'])

    controller.resetFilterSort()

    expect(controller.showFeedPanel.value).toBe(true)
    expect(controller.feedMaterialRuneIds.value).toEqual(['r0'])
  })

  it('resetFilterSort 不关闭批量锁定面板也不清空选择', () => {
    const { controller } = setupFixture(STANDARD())
    controller.openBatchLockPanel()
    controller.toggleBatchLockRune('r1')
    controller.sortKey.value = 'rarity'

    controller.resetFilterSort()

    expect(controller.showBatchLockPanel.value).toBe(true)
    expect(controller.batchLockRuneIds.value).toEqual(['r1'])
  })

  it('view 损坏：isBroken=true，rows/sorted/summary 安全降级为空', () => {
    const { controller } = setupFixture(STANDARD(), { broken: true })
    expect(controller.isBroken.value).toBe(true)
    expect(controller.rows.value).toEqual([])
    expect(controller.sorted.value).toEqual([])
    expect(controller.summary.value.total).toBe(0)
  })
})

// ============================================================================
// 2. confirmRemove
// ============================================================================
describe('useRuneInventoryController confirmRemove', () => {
  it('row 未镶嵌：不调用 Store', () => {
    const { controller, playerStore } = setupFixture(STANDARD())
    const spy = vi.spyOn(playerStore, 'tryRemoveEquipmentRune')
    const row = controller.rows.value.find(r => r.rune.id === 'r0')!
    expect(row.binding).toBeNull()

    controller.confirmRemove(row)

    expect(spy).not.toHaveBeenCalled()
    expect(controller.feedback.value).toBeNull()
  })

  it('view 损坏：不调用 Store', () => {
    const { controller, playerStore } = setupFixture(STANDARD(), { broken: true })
    const spy = vi.spyOn(playerStore, 'tryRemoveEquipmentRune')
    const row = makeRow('r3', { binding: { equipmentSlot: SLOT_A, runeSlotIndex: 0 } })

    controller.confirmRemove(row)

    expect(spy).not.toHaveBeenCalled()
  })

  it('合法绑定：恰好调用一次 tryRemoveEquipmentRune(slot, index)，成功反馈', () => {
    const { controller, playerStore } = setupFixture(STANDARD(), { embed: true })
    const spy = vi.spyOn(playerStore, 'tryRemoveEquipmentRune').mockReturnValue({ ok: true })
    const row = controller.rows.value.find(r => r.rune.id === 'r3')!
    expect(row.binding).not.toBeNull()

    controller.confirmRemove(row)

    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith('weapon', 0)
    expect(controller.feedback.value?.kind).toBe('success')
    // 反馈使用行的真实 displayName（buildRuneInventoryView 派生）
    expect(controller.feedback.value?.message).toContain('已移除：')
    expect(controller.feedback.value?.message).toContain(row.displayName)
  })

  it('Store 返回失败：错误反馈，绝不伪报成功', () => {
    const { controller, playerStore } = setupFixture(STANDARD(), { embed: true })
    const spy = vi.spyOn(playerStore, 'tryRemoveEquipmentRune').mockReturnValue({ ok: false, reason: 'stale topology' })
    const row = controller.rows.value.find(r => r.rune.id === 'r3')!

    controller.confirmRemove(row)

    expect(spy).toHaveBeenCalledTimes(1)
    expect(controller.feedback.value?.kind).toBe('error')
    expect(controller.feedback.value?.message).toContain('stale topology')
  })

  it('Store 抛异常：错误反馈', () => {
    const { controller, playerStore } = setupFixture(STANDARD(), { embed: true })
    vi.spyOn(playerStore, 'tryRemoveEquipmentRune').mockImplementation(() => {
      throw new Error('boom')
    })
    const row = controller.rows.value.find(r => r.rune.id === 'r3')!

    controller.confirmRemove(row)

    expect(controller.feedback.value?.kind).toBe('error')
    expect(controller.feedback.value?.message).toBe('移除操作失败')
  })

  // ==========================================================================
  // Phase 3.28：stale-row 安全边界（canonical identity + 当前绑定校验，fail-closed）
  // ==========================================================================
  it('stale row 的 Rune ID 已不存在：不调用 Store 且不改 feedback', () => {
    const { controller, playerStore } = setupFixture(STANDARD(), { embed: true })
    const spy = vi.spyOn(playerStore, 'tryRemoveEquipmentRune')
    controller.feedback.value = { kind: 'error', message: '旧错误' }
    const stale = makeRow('ghost', { binding: { equipmentSlot: SLOT_A, runeSlotIndex: 0 } })

    controller.confirmRemove(stale)

    expect(spy).not.toHaveBeenCalled()
    expect(controller.feedback.value).toEqual({ kind: 'error', message: '旧错误' })
  })

  it('Rune 仍存在但当前已未镶嵌：不调用 Store', () => {
    const { controller, playerStore } = setupFixture(STANDARD()) // 无 embed → r3 未镶嵌
    const spy = vi.spyOn(playerStore, 'tryRemoveEquipmentRune')
    const stale = makeRow('r3', { binding: { equipmentSlot: SLOT_A, runeSlotIndex: 0 } })

    controller.confirmRemove(stale)

    expect(spy).not.toHaveBeenCalled()
  })

  it('同一 Rune 已移动到其他孔位：旧 row 不调用 Store', () => {
    const { controller, playerStore } = setupFixture(STANDARD(), { embed: true })
    // r3 从 weapon@0 移到 weapon@1（r4 占 @0）
    playerStore.player.equipment[SLOT_A] = makeRuneEquip('w1', SLOT_A, { runeSlots: slotsWith('r4', 'r3', null) })
    const spy = vi.spyOn(playerStore, 'tryRemoveEquipmentRune')
    const stale = makeRow('r3', { binding: { equipmentSlot: SLOT_A, runeSlotIndex: 0 } })

    controller.confirmRemove(stale)

    expect(spy).not.toHaveBeenCalled()
  })

  it('原孔位已被其他 Rune 占用：旧 row 不调用 Store，且新 Rune 不被移除', () => {
    const { controller, playerStore } = setupFixture(STANDARD(), { embed: true })
    playerStore.player.equipment[SLOT_A] = makeRuneEquip('w1', SLOT_A, { runeSlots: slotsWith('r4', 'r3', null) })
    const spy = vi.spyOn(playerStore, 'tryRemoveEquipmentRune')
    // 旧 row 认为 r3 在 weapon@0（实际 r4 已占 @0）
    const stale = makeRow('r3', { binding: { equipmentSlot: SLOT_A, runeSlotIndex: 0 } })

    controller.confirmRemove(stale)

    expect(spy).not.toHaveBeenCalled()
    const slots = playerStore.player.equipment[SLOT_A].runeSlots
    expect(slots[0].runeId).toBe('r4')
    expect(slots[1].runeId).toBe('r3')
  })

  it('canonical row 与传入 binding 一致：仍恰好调用一次正确事务', () => {
    const { controller, playerStore } = setupFixture(STANDARD(), { embed: true })
    const spy = vi.spyOn(playerStore, 'tryRemoveEquipmentRune').mockReturnValue({ ok: true })
    const row = controller.rows.value.find(r => r.rune.id === 'r3')!
    expect(row.binding).toEqual({ equipmentSlot: SLOT_A, runeSlotIndex: 0 })

    controller.confirmRemove(row)

    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith('weapon', 0)
  })

  it('成功反馈使用 current row 的 displayName（不沿用过期 displayName）', () => {
    const { controller, playerStore } = setupFixture(STANDARD(), { embed: true })
    const spy = vi.spyOn(playerStore, 'tryRemoveEquipmentRune').mockReturnValue({ ok: true })
    // 传入构造的过期 row：displayName 为「符文r3」，current row displayName 为 buildRuneInventoryView 派生值
    const staleDisplay = makeRow('r3', { binding: { equipmentSlot: SLOT_A, runeSlotIndex: 0 } })

    controller.confirmRemove(staleDisplay)

    expect(spy).toHaveBeenCalledTimes(1)
    const currentDisplay = controller.rows.value.find(r => r.rune.id === 'r3')!.displayName
    expect(currentDisplay).not.toBe('符文r3')
    expect(controller.feedback.value?.message).toContain(currentDisplay)
    expect(controller.feedback.value?.message).not.toContain('符文r3')
  })

  it('所有无效请求都不修改原 feedback，不伪报成功', () => {
    const { controller, playerStore } = setupFixture(STANDARD(), { embed: true })
    const spy = vi.spyOn(playerStore, 'tryRemoveEquipmentRune')
    // 场景 A：Rune ID 不存在
    controller.feedback.value = { kind: 'error', message: '旧A' }
    controller.confirmRemove(makeRow('ghost', { binding: { equipmentSlot: SLOT_A, runeSlotIndex: 0 } }))
    expect(controller.feedback.value).toEqual({ kind: 'error', message: '旧A' })
    // 场景 B：Rune 存在但当前未镶嵌（r0）
    controller.feedback.value = { kind: 'error', message: '旧B' }
    controller.confirmRemove(makeRow('r0', { binding: { equipmentSlot: SLOT_A, runeSlotIndex: 0 } }))
    expect(controller.feedback.value).toEqual({ kind: 'error', message: '旧B' })
    // 场景 C：绑定不一致（r4 实际在 weapon@1，旧 row 认为 @0）
    controller.feedback.value = { kind: 'error', message: '旧C' }
    controller.confirmRemove(makeRow('r4', { binding: { equipmentSlot: SLOT_A, runeSlotIndex: 0 } }))
    expect(controller.feedback.value).toEqual({ kind: 'error', message: '旧C' })
    expect(spy).not.toHaveBeenCalled()
  })

  it('合法成功才允许覆盖旧 feedback，且被 mock 截断时不直接改 inventory、不自行保存', () => {
    const { controller, playerStore } = setupFixture(STANDARD(), { embed: true })
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    const spy = vi.spyOn(playerStore, 'tryRemoveEquipmentRune').mockReturnValue({ ok: true })
    controller.feedback.value = { kind: 'error', message: '旧错误' }
    const row = controller.rows.value.find(r => r.rune.id === 'r3')!
    setItemSpy.mockClear()

    controller.confirmRemove(row)

    expect(spy).toHaveBeenCalledTimes(1)
    // 合法成功覆盖旧 feedback 为 success
    expect(controller.feedback.value?.kind).toBe('success')
    // mock 未执行真实事务：装备未被直接改写，且无保存写入
    expect(playerStore.player.equipment[SLOT_A]!.runeSlots[0].runeId).toBe('r3')
    expect(setItemSpy).not.toHaveBeenCalled()
  })
})

// ============================================================================
// 3. toggleLock
// ============================================================================
describe('useRuneInventoryController toggleLock', () => {
  it('stale row（不在合法 inventory）：不调用 Store 且不改已有 feedback', () => {
    const { controller, playerStore } = setupFixture(STANDARD())
    const spy = vi.spyOn(playerStore, 'trySetRuneLocked')
    controller.feedback.value = { kind: 'error', message: '旧错误' }
    const stale = makeRow('ghost')

    controller.toggleLock(stale)

    expect(spy).not.toHaveBeenCalled()
    expect(controller.feedback.value).toEqual({ kind: 'error', message: '旧错误' })
  })

  it('view 损坏：不调用 Store', () => {
    const { controller, playerStore } = setupFixture(STANDARD(), { broken: true })
    const spy = vi.spyOn(playerStore, 'trySetRuneLocked')

    controller.toggleLock(makeRow('r0'))

    expect(spy).not.toHaveBeenCalled()
  })

  it('合法 row：用 canonical Rune ID 恰好调用一次 trySetRuneLocked，changed=true 反馈', () => {
    const { controller, playerStore } = setupFixture(STANDARD())
    const spy = vi.spyOn(playerStore, 'trySetRuneLocked').mockReturnValue({ ok: true, changed: true, isLocked: true })
    const row = controller.rows.value.find(r => r.rune.id === 'r0')! // r0 未锁定 → 请求锁定

    controller.toggleLock(row)

    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith('r0', true)
    expect(controller.feedback.value?.kind).toBe('success')
    expect(controller.feedback.value?.message).toContain('已锁定')
  })

  it('changed=false（Store 幂等结果）：反馈为已处于锁定状态，使用 current row 名称', () => {
    const { controller, playerStore } = setupFixture(STANDARD())
    const spy = vi.spyOn(playerStore, 'trySetRuneLocked').mockReturnValue({ ok: true, changed: false, isLocked: true })
    // 调用前传入 row 与 current row 状态一致（r0 未锁定）→ 请求锁定；
    // Store 防御性返回 changed=false（幂等结果）→ 反馈「已处于锁定状态」且用 current 名称
    const row = controller.rows.value.find(r => r.rune.id === 'r0')!

    controller.toggleLock(row)

    expect(spy).toHaveBeenCalledWith('r0', true)
    expect(controller.feedback.value?.kind).toBe('success')
    expect(controller.feedback.value?.message).toContain('已处于锁定状态')
    expect(controller.feedback.value?.message).toContain(row.displayName)
  })

  it('Store 返回失败：错误反馈，绝不伪报成功', () => {
    const { controller, playerStore } = setupFixture(STANDARD())
    vi.spyOn(playerStore, 'trySetRuneLocked').mockReturnValue({ ok: false, reason: 'stale', changed: false })
    const row = controller.rows.value.find(r => r.rune.id === 'r0')!

    controller.toggleLock(row)

    expect(controller.feedback.value?.kind).toBe('error')
    expect(controller.feedback.value?.message).toContain('stale')
  })

  it('Store 抛异常：错误反馈', () => {
    const { controller, playerStore } = setupFixture(STANDARD())
    vi.spyOn(playerStore, 'trySetRuneLocked').mockImplementation(() => {
      throw new Error('boom')
    })
    const row = controller.rows.value.find(r => r.rune.id === 'r0')!

    controller.toggleLock(row)

    expect(controller.feedback.value?.kind).toBe('error')
    expect(controller.feedback.value?.message).toBe('锁定操作失败')
  })

  it('不直接修改 Rune 且不触发保存（localStorage.setItem 未被调用）', () => {
    const { controller, playerStore } = setupFixture(STANDARD())
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    vi.spyOn(playerStore, 'trySetRuneLocked').mockReturnValue({ ok: true, changed: true, isLocked: true })
    const row = controller.rows.value.find(r => r.rune.id === 'r0')!
    setItemSpy.mockClear() // 排除 setup 阶段可能的历史写入

    controller.toggleLock(row)

    // mock 未执行真实事务：inventory 中的 r0 不应被 toggleLock 直接改写（保持原 false）
    expect(playerStore.runeInventory.find(r => r.id === 'r0')?.isLocked).toBe(false)
    // 未触发保存：toggleLock 期间无任何 localStorage.setItem 写入
    expect(setItemSpy).not.toHaveBeenCalled()
  })

  // ==========================================================================
  // Phase 3.29：stale lock-state fail-closed（与 confirmRemove 对齐）
  // ==========================================================================
  it('stale row 认为已锁定但 current 实际未锁定：不调 Store、不保存、不改 Rune、不改 feedback', () => {
    const { controller, playerStore } = setupFixture(STANDARD()) // canonical r0 未锁定
    const spy = vi.spyOn(playerStore, 'trySetRuneLocked')
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    controller.feedback.value = { kind: 'error', message: '旧错误' }
    const stale = makeRow('r0', { isLocked: true }) // 过期：误判已锁定

    controller.toggleLock(stale)

    expect(spy).not.toHaveBeenCalled()
    expect(setItemSpy).not.toHaveBeenCalled()
    expect(playerStore.runeInventory.find(r => r.id === 'r0')?.isLocked).toBe(false)
    expect(controller.feedback.value).toEqual({ kind: 'error', message: '旧错误' })
  })

  it('stale row 认为未锁定但 current 实际已锁定：静默 return', () => {
    const { controller, playerStore } = setupFixture(STANDARD()) // canonical r1 已锁定
    const spy = vi.spyOn(playerStore, 'trySetRuneLocked')
    controller.feedback.value = { kind: 'error', message: '旧错误' }
    const stale = makeRow('r1', { isLocked: false }) // 过期：误判未锁定

    controller.toggleLock(stale)

    expect(spy).not.toHaveBeenCalled()
    expect(controller.feedback.value).toEqual({ kind: 'error', message: '旧错误' })
  })

  it('状态一致且当前已锁定：恰好调用 trySetRuneLocked(id, false)（请求解锁）', () => {
    const { controller, playerStore } = setupFixture(STANDARD()) // r1 已锁定
    const spy = vi.spyOn(playerStore, 'trySetRuneLocked').mockReturnValue({ ok: true, changed: true, isLocked: false })
    const row = controller.rows.value.find(r => r.rune.id === 'r1')!
    expect(row.isLocked).toBe(true)

    controller.toggleLock(row)

    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith('r1', false)
    expect(controller.feedback.value?.kind).toBe('success')
    expect(controller.feedback.value?.message).toContain('已解锁')
  })

  it('传入 row 的 displayName 已过期但 ID 与状态一致：事务执行，反馈用 current 名称', () => {
    const { controller, playerStore } = setupFixture(STANDARD())
    const spy = vi.spyOn(playerStore, 'trySetRuneLocked').mockReturnValue({ ok: true, changed: true, isLocked: true })
    // 构造过期 row：displayName 为「符文r0」，状态与 current 一致（未锁定）
    const staleDisplay = makeRow('r0', { isLocked: false })

    controller.toggleLock(staleDisplay)

    expect(spy).toHaveBeenCalledTimes(1)
    const currentDisplay = controller.rows.value.find(r => r.rune.id === 'r0')!.displayName
    expect(currentDisplay).not.toBe('符文r0')
    expect(controller.feedback.value?.message).toContain(currentDisplay)
    expect(controller.feedback.value?.message).not.toContain('符文r0')
  })

  it('Store 幂等结果（changed=false，解锁方向）：反馈为已处于解锁状态，使用 current row 名称', () => {
    const { controller, playerStore } = setupFixture(STANDARD()) // r1 已锁定 → 请求解锁(false)
    const spy = vi.spyOn(playerStore, 'trySetRuneLocked').mockReturnValue({ ok: true, changed: false, isLocked: false })
    const row = controller.rows.value.find(r => r.rune.id === 'r1')!

    controller.toggleLock(row)

    expect(spy).toHaveBeenCalledWith('r1', false)
    expect(controller.feedback.value?.kind).toBe('success')
    // 符合 Store 成功结果契约：请求 false 且 changed=false → isLocked:false（已处于解锁状态）
    expect(controller.feedback.value?.message).toContain('已处于解锁状态')
    expect(controller.feedback.value?.message).toContain(row.displayName)
  })

  it('合法成功才允许覆盖旧 feedback（changed=true）', () => {
    const { controller, playerStore } = setupFixture(STANDARD())
    vi.spyOn(playerStore, 'trySetRuneLocked').mockReturnValue({ ok: true, changed: true, isLocked: true })
    controller.feedback.value = { kind: 'error', message: '旧错误' }
    const row = controller.rows.value.find(r => r.rune.id === 'r0')!

    controller.toggleLock(row)

    expect(controller.feedback.value?.kind).toBe('success')
    expect(controller.feedback.value?.message).toContain('已锁定')
  })
})

// ============================================================================
// 4. 面板打开与 feedback
// ============================================================================
describe('useRuneInventoryController 面板打开清空旧 feedback', () => {
  it('openPicker 合法打开并清空预置非空旧 feedback', () => {
    const { controller } = setupFixture(STANDARD())
    controller.feedback.value = { kind: 'error', message: '旧错误' }

    controller.openPicker('r0')

    expect(controller.showPicker.value).toBe(true)
    expect(controller.feedback.value).toBeNull()
  })

  it('openFeedPanel 合法打开并清空预置非空旧 feedback', () => {
    const { controller } = setupFixture(STANDARD())
    controller.feedback.value = { kind: 'error', message: '旧错误' }

    controller.openFeedPanel('r2')

    expect(controller.showFeedPanel.value).toBe(true)
    expect(controller.feedback.value).toBeNull()
  })

  it('openBatchLockPanel 合法打开并清空预置非空旧 feedback', () => {
    const { controller } = setupFixture(STANDARD())
    controller.feedback.value = { kind: 'error', message: '旧错误' }

    controller.openBatchLockPanel()

    expect(controller.showBatchLockPanel.value).toBe(true)
    expect(controller.feedback.value).toBeNull()
  })
})
