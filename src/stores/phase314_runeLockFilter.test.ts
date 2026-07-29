// @vitest-environment jsdom
/**
 * Phase 3.14 — Rune 锁定状态筛选、仓库摘要统计与交互身份稳定闭环
 *
 * 只覆盖锁定筛选纯函数扩展、全仓库摘要 locked/unlocked、UI 第四筛选维度、
 * 锁定事务与筛选联动、筛选隐藏期间 picker / 强化面板 canonical-ID 身份保持。
 * 不修改生产事务 / planner / balance 公式与报告。
 *
 * 覆盖（§19-§24）：
 *   A. filterRuneRows lock 维度（all/locked/unlocked / undefined→all 兼容 /
 *      四维正交组合 / 空结果 / 顺序保持 / 输入零修改 / 无 RNG 无写盘 /
 *      canonical row.isLocked 与 row.rune.isLocked 故意不一致时以 row.isLocked 为准）
 *   B. summarizeRuneRows locked/unlocked（混合 / 全锁 / 全未锁 / 空 / 已镶嵌交叉 /
 *      旧档缺失 isLocked 归一化计入 unlocked / 不随筛选变化 / 后置不变量）
 *   C. UI 锁定筛选（真实 select 交互 / 默认 all / 组合 / 空状态 / 摘要不受筛选影响 /
 *      筛选零写盘零事务）
 *   D. 锁定事务与筛选联动（unlocked filter 下锁定卡片消失 / locked filter 下解锁消失 /
 *      失败与异常时卡片摘要筛选保持 / 主存档恰好写一次）
 *   E. picker / 强化面板身份保持（锁定筛选隐藏仓库卡片不关闭 / canonical ID 不漂移 /
 *      材料选择保持 / 排序切换与尾部追加不漂移 / 恢复筛选后状态正确）
 *   F. 材料真实锁定失效回归（只移除被锁定材料 / 解锁后重回候选不自动重选）
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { usePlayerStore } from './playerStore'
import { useMonsterStore } from './monsterStore'
import { useGameStore } from './gameStore'
import { useTrainingStore } from './trainingStore'
import { useCultivationStore } from './cultivationStore'
import { useTitleStore } from './titleStore'
import { usePetStore } from './petStore'
import { useRebirthStore } from './rebirthStore'
import { useTalentStore } from './talentStore'
import { useBattlePassStore } from './battlePassStore'
import { useCollectionStore } from './collectionStore'
import type { Rune } from './runeStore'
import RuneInventoryTab from '../components/RuneInventoryTab.vue'
import {
  buildRuneInventoryView,
  filterRuneRows,
  summarizeRuneRows,
  type RuneInventoryFilter,
  type RuneInventoryRow
} from '../utils/runeInventoryView'
import { createEmptyEquipmentRuneSlots } from '../utils/equipmentRunes'
import type { Equipment, EquipmentSlot, RuneSlot } from '../types'

const SAVE_KEY = 'lollipop_adventure_save'
const SLOT_A: EquipmentSlot = 'weapon'

function warmupStores() {
  usePlayerStore()
  useMonsterStore()
  useGameStore()
  useTrainingStore()
  useCultivationStore()
  useTitleStore()
  usePetStore()
  useRebirthStore()
  useTalentStore()
  useBattlePassStore()
  useCollectionStore()
}

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

function findByAriaPrefix(wrapper: ReturnType<typeof mount>, prefix: string) {
  const buttons = wrapper.findAll('button')
  for (const btn of buttons) {
    const label = btn.attributes('aria-label')
    if (label && label.startsWith(prefix)) return btn
  }
  return null
}

/** 仓库卡片网格中当前可见的 Rune 名称（不含 picker / 强化面板内的名称）。 */
function gridNames(wrapper: ReturnType<typeof mount>): string[] {
  return wrapper.findAll('.rune-card .rune-name').map(n => n.text())
}

/** 顶部全仓库摘要文本。 */
function summaryText(wrapper: ReturnType<typeof mount>): string {
  return wrapper.find('.summary').text()
}

const lockSelect = 'select[aria-label="按锁定状态筛选"]'
const typeSelect = 'select[aria-label="按类型筛选"]'
const raritySelect = 'select[aria-label="按稀有度筛选"]'
const statusSelect = 'select[aria-label="按状态筛选"]'
const sortSelect = 'select[aria-label="排序方式"]'

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  warmupStores()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

// ============================================================================
// A. filterRuneRows 锁定维度（§19）
// ============================================================================
describe('Phase 3.14 — filterRuneRows 锁定筛选', () => {
  /**
   * 五枚 Rune 四维张开：
   *   r0 attack/epic/未镶嵌/锁定   r1 attack/epic/未镶嵌/未锁定
   *   r2 attack/epic/已镶嵌/锁定   r3 attack/common/未镶嵌/锁定
   *   r4 defense/epic/未镶嵌/锁定
   */
  function buildRows(): RuneInventoryRow[] {
    const inventory = [
      makeRune('r0', { type: 'attack', rarity: 'epic', isLocked: true }),
      makeRune('r1', { type: 'attack', rarity: 'epic', isLocked: false }),
      makeRune('r2', { type: 'attack', rarity: 'epic', isLocked: true }),
      makeRune('r3', { type: 'attack', rarity: 'common', isLocked: true }),
      makeRune('r4', { type: 'defense', rarity: 'epic', isLocked: true })
    ]
    const equipment = { [SLOT_A]: makeRuneEquip('w1', SLOT_A, { runeSlots: slotsWith('r2') }) }
    const view = buildRuneInventoryView(inventory, equipment)
    if (!view.ok) throw new Error('expected ok')
    return view.rows
  }

  const F = (over?: Partial<RuneInventoryFilter>): RuneInventoryFilter => ({
    type: 'all',
    rarity: 'all',
    status: 'all',
    lock: 'all',
    ...over
  })

  it('lock=all 返回全部；lock=locked 只返回锁定；lock=unlocked 只返回未锁定（顺序保持）', () => {
    const rows = buildRows()
    expect(filterRuneRows(rows, F()).map(r => r.rune.id)).toEqual(['r0', 'r1', 'r2', 'r3', 'r4'])
    expect(filterRuneRows(rows, F({ lock: 'locked' })).map(r => r.rune.id)).toEqual(['r0', 'r2', 'r3', 'r4'])
    expect(filterRuneRows(rows, F({ lock: 'unlocked' })).map(r => r.rune.id)).toEqual(['r1'])
  })

  it('undefined lock 向后兼容为 all（旧调用方 / 历史 JS 输入）', () => {
    const rows = buildRows()
    const legacy = { type: 'all', rarity: 'all', status: 'all' } as unknown as RuneInventoryFilter
    expect(filterRuneRows(rows, legacy).map(r => r.rune.id)).toEqual(['r0', 'r1', 'r2', 'r3', 'r4'])
    const explicitUndefined = { type: 'all', rarity: 'all', status: 'all', lock: undefined } as unknown as RuneInventoryFilter
    expect(filterRuneRows(rows, explicitUndefined).map(r => r.rune.id)).toEqual(['r0', 'r1', 'r2', 'r3', 'r4'])
  })

  it('锁定 + 类型 / 稀有度 / 镶嵌状态两两组合、四维组合必须同时满足', () => {
    const rows = buildRows()
    // 类型 + 锁定
    expect(filterRuneRows(rows, F({ type: 'attack', lock: 'locked' })).map(r => r.rune.id)).toEqual(['r0', 'r2', 'r3'])
    // 稀有度 + 锁定
    expect(filterRuneRows(rows, F({ rarity: 'epic', lock: 'locked' })).map(r => r.rune.id)).toEqual(['r0', 'r2', 'r4'])
    // 镶嵌状态 + 锁定
    expect(filterRuneRows(rows, F({ status: 'unequipped', lock: 'locked' })).map(r => r.rune.id)).toEqual(['r0', 'r3', 'r4'])
    expect(filterRuneRows(rows, F({ status: 'embedded', lock: 'locked' })).map(r => r.rune.id)).toEqual(['r2'])
    // 四维组合：attack + epic + unequipped + locked → 仅 r0
    expect(
      filterRuneRows(rows, F({ type: 'attack', rarity: 'epic', status: 'unequipped', lock: 'locked' })).map(r => r.rune.id)
    ).toEqual(['r0'])
  })

  it('无匹配返回 []（合法空集合而非错误）', () => {
    const rows = buildRows()
    expect(filterRuneRows(rows, F({ type: 'defense', lock: 'unlocked' }))).toEqual([])
    expect(filterRuneRows(rows, F({ status: 'embedded', lock: 'unlocked' }))).toEqual([])
  })

  it('返回新数组、不修改 rows/filter/row、无 RNG、无写盘、不读取 Pinia 之外新增副作用', () => {
    const rows = buildRows()
    const filter = F({ lock: 'locked' })
    const rowsSnapshot = JSON.stringify(rows)
    const filterSnapshot = JSON.stringify(filter)
    const rngSpy = vi.spyOn(Math, 'random')
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')

    const out = filterRuneRows(rows, filter)
    expect(out).not.toBe(rows)
    expect(JSON.stringify(rows)).toBe(rowsSnapshot)
    expect(JSON.stringify(filter)).toBe(filterSnapshot)
    expect(rngSpy).not.toHaveBeenCalled()
    expect(setItemSpy).not.toHaveBeenCalled()
  })

  it('防回归：row.rune.isLocked 与 row.isLocked 故意不一致 → 筛选以 canonical row.isLocked 为准', () => {
    const rows = buildRows()
    // r1 canonical 未锁定：伪造 row.isLocked=true 而 raw rune.isLocked=false
    const forgedLocked: RuneInventoryRow = {
      ...rows[1],
      isLocked: true,
      rune: { ...rows[1].rune, isLocked: false }
    }
    // r0 canonical 锁定：伪造 row.isLocked=false 而 raw rune.isLocked=true
    const forgedUnlocked: RuneInventoryRow = {
      ...rows[0],
      isLocked: false,
      rune: { ...rows[0].rune, isLocked: true }
    }
    const forged = [forgedLocked, forgedUnlocked]
    // 只信 row.isLocked：locked → forgedLocked；unlocked → forgedUnlocked
    expect(filterRuneRows(forged, F({ lock: 'locked' })).map(r => r.rune.id)).toEqual(['r1'])
    expect(filterRuneRows(forged, F({ lock: 'unlocked' })).map(r => r.rune.id)).toEqual(['r0'])
  })
})

// ============================================================================
// B. summarizeRuneRows locked/unlocked（§20）
// ============================================================================
describe('Phase 3.14 — summarizeRuneRows 锁定统计', () => {
  it('locked/unlocked 混合 + 已镶嵌交叉：计数正确且满足后置不变量', () => {
    const inventory = [
      makeRune('r0', { type: 'attack', rarity: 'epic', isLocked: true }),
      makeRune('r1', { type: 'defense', rarity: 'common', isLocked: false }),
      makeRune('r2', { type: 'luck', rarity: 'rare', isLocked: true }),
      makeRune('r3', { type: 'speed', rarity: 'common' })
    ]
    // r0（锁定）与 r1（未锁定）均已镶嵌 → 锁定 × 镶嵌交叉组合
    const equipment = { [SLOT_A]: makeRuneEquip('w1', SLOT_A, { runeSlots: slotsWith('r0', 'r1') }) }
    const view = buildRuneInventoryView(inventory, equipment)
    if (!view.ok) throw new Error('expected ok')
    const s = summarizeRuneRows(view.rows)
    expect(s.total).toBe(4)
    expect(s.embedded).toBe(2)
    expect(s.unequipped).toBe(2)
    expect(s.locked).toBe(2)
    expect(s.unlocked).toBe(2)
    expect(s.locked + s.unlocked).toBe(s.total)
    expect(s.embedded + s.unequipped).toBe(s.total)
  })

  it('全部锁定 / 全部未锁定 / 空仓库', () => {
    const allLocked = buildRuneInventoryView(
      [makeRune('a', { isLocked: true }), makeRune('b', { type: 'defense', isLocked: true })],
      {}
    )
    if (!allLocked.ok) throw new Error('expected ok')
    expect(summarizeRuneRows(allLocked.rows)).toMatchObject({ total: 2, locked: 2, unlocked: 0 })

    const allUnlocked = buildRuneInventoryView(
      [makeRune('a', { isLocked: false }), makeRune('b', { type: 'defense' })],
      {}
    )
    if (!allUnlocked.ok) throw new Error('expected ok')
    expect(summarizeRuneRows(allUnlocked.rows)).toMatchObject({ total: 2, locked: 0, unlocked: 2 })

    expect(summarizeRuneRows([])).toEqual({
      total: 0,
      embedded: 0,
      unequipped: 0,
      locked: 0,
      unlocked: 0,
      byRarity: { common: 0, rare: 0, epic: 0, legend: 0 }
    })
  })

  it('旧档缺失 isLocked 的 Rune 经 buildRuneInventoryView 归一化后计入 unlocked', () => {
    // makeRune 不带 isLocked → 对象上没有该 key（旧档形状）
    const legacy = makeRune('old1')
    expect('isLocked' in legacy).toBe(false)
    const view = buildRuneInventoryView([legacy, makeRune('new1', { type: 'defense', isLocked: true })], {})
    if (!view.ok) throw new Error('expected ok')
    const s = summarizeRuneRows(view.rows)
    expect(s.locked).toBe(1)
    expect(s.unlocked).toBe(1)
    expect(s.locked + s.unlocked).toBe(s.total)
  })

  it('摘要统计完整合法 rows：切换任何筛选不改变 summarizeRuneRows(rows) 结果', () => {
    const inventory = [
      makeRune('r0', { type: 'attack', rarity: 'epic', isLocked: true }),
      makeRune('r1', { type: 'defense', rarity: 'common' }),
      makeRune('r2', { type: 'luck', rarity: 'rare', isLocked: true })
    ]
    const view = buildRuneInventoryView(inventory, {})
    if (!view.ok) throw new Error('expected ok')
    const before = summarizeRuneRows(view.rows)
    // 各种筛选（含 lock）只作用于 filterRuneRows 结果，不影响全仓库摘要
    filterRuneRows(view.rows, { type: 'attack', rarity: 'all', status: 'all', lock: 'locked' })
    filterRuneRows(view.rows, { type: 'all', rarity: 'rare', status: 'unequipped', lock: 'unlocked' })
    filterRuneRows(view.rows, { type: 'all', rarity: 'all', status: 'all', lock: 'locked' })
    const after = summarizeRuneRows(view.rows)
    expect(after).toEqual(before)
    expect(after).toEqual({
      total: 3,
      embedded: 0,
      unequipped: 3,
      locked: 2,
      unlocked: 1,
      byRarity: { common: 1, rare: 1, epic: 1, legend: 0 }
    })
  })
})

// ============================================================================
// C. UI 锁定筛选（§21）
// ============================================================================
describe('Phase 3.14 — UI 锁定状态筛选', () => {
  function seedInventory(runes: Rune[]) {
    const playerStore = usePlayerStore()
    playerStore.runeInventory = runes
    return playerStore
  }

  /**
   * 标准 UI 种子（展示名互不相同）：
   *   a1 普通攻击符文 未锁定 未镶嵌
   *   a2 史诗攻击符文 已锁定 未镶嵌
   *   d1 普通防御符文 已锁定 已镶嵌（weapon 孔 0）
   *   l1 稀有幸运符文 未锁定 未镶嵌
   */
  function seedStandard() {
    const playerStore = seedInventory([
      makeRune('a1', { type: 'attack', rarity: 'common' }),
      makeRune('a2', { type: 'attack', rarity: 'epic', isLocked: true }),
      makeRune('d1', { type: 'defense', rarity: 'common', isLocked: true }),
      makeRune('l1', { type: 'luck', rarity: 'rare' })
    ])
    playerStore.player.equipment[SLOT_A] = makeRuneEquip('w1', SLOT_A, { runeSlots: slotsWith('d1') })
    return playerStore
  }

  it('默认 lock=all：显示全部卡片，锁定筛选可见、有标签与选项文案', async () => {
    seedStandard()
    const wrapper = mount(RuneInventoryTab)
    await nextTick()

    const sel = wrapper.find(lockSelect)
    expect(sel.exists()).toBe(true)
    expect((sel.element as HTMLSelectElement).value).toBe('all')
    expect(wrapper.text()).toContain('锁定状态')
    const options = sel.findAll('option').map(o => o.text())
    expect(options).toEqual(['全部', '已锁定', '未锁定'])
    expect(gridNames(wrapper)).toEqual(['普通攻击符文', '史诗攻击符文', '普通防御符文', '稀有幸运符文'])
  })

  it('切换 locked / unlocked / 恢复 all：卡片正确、摘要不受筛选影响、零写盘零事务', async () => {
    const playerStore = seedStandard()
    const wrapper = mount(RuneInventoryTab)
    await nextTick()

    const lockSpy = vi.spyOn(playerStore, 'trySetRuneLocked')
    const feedSpy = vi.spyOn(playerStore, 'tryFeedRunes')
    const embedSpy = vi.spyOn(playerStore, 'tryEmbedEquipmentRune')
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')

    const summaryBefore = summaryText(wrapper)
    expect(summaryBefore).toContain('已锁定 2')
    expect(summaryBefore).toContain('未锁定 2')

    await wrapper.find(lockSelect).setValue('locked')
    expect(gridNames(wrapper)).toEqual(['史诗攻击符文', '普通防御符文'])
    expect(summaryText(wrapper)).toBe(summaryBefore)

    await wrapper.find(lockSelect).setValue('unlocked')
    expect(gridNames(wrapper)).toEqual(['普通攻击符文', '稀有幸运符文'])
    expect(summaryText(wrapper)).toBe(summaryBefore)

    await wrapper.find(lockSelect).setValue('all')
    expect(gridNames(wrapper)).toEqual(['普通攻击符文', '史诗攻击符文', '普通防御符文', '稀有幸运符文'])
    expect(summaryText(wrapper)).toBe(summaryBefore)

    // 筛选操作零写盘、零事务
    expect(setItemSpy.mock.calls.filter(c => c[0] === SAVE_KEY).length).toBe(0)
    expect(lockSpy).not.toHaveBeenCalled()
    expect(feedSpy).not.toHaveBeenCalled()
    expect(embedSpy).not.toHaveBeenCalled()
  })

  it('与类型 / 稀有度 / 镶嵌状态组合及四维组合：不重置其他维度、不改变排序', async () => {
    seedStandard()
    const wrapper = mount(RuneInventoryTab)
    await nextTick()

    // 类型 + 锁定
    await wrapper.find(typeSelect).setValue('attack')
    await wrapper.find(lockSelect).setValue('locked')
    expect(gridNames(wrapper)).toEqual(['史诗攻击符文'])
    expect((wrapper.find(typeSelect).element as HTMLSelectElement).value).toBe('attack')

    // 稀有度 + 锁定（type 复位为 all，rarity=common + locked → 普通防御符文）
    await wrapper.find(typeSelect).setValue('all')
    await wrapper.find(raritySelect).setValue('common')
    expect(gridNames(wrapper)).toEqual(['普通防御符文'])

    // 镶嵌状态 + 锁定
    await wrapper.find(raritySelect).setValue('all')
    await wrapper.find(statusSelect).setValue('unequipped')
    expect(gridNames(wrapper)).toEqual(['史诗攻击符文'])

    // 四维组合：attack + epic + unequipped + locked → 史诗攻击符文
    await wrapper.find(typeSelect).setValue('attack')
    await wrapper.find(raritySelect).setValue('epic')
    expect(gridNames(wrapper)).toEqual(['史诗攻击符文'])

    // 切换 lock 不重置其他维度、不改变 sortKey
    await wrapper.find(lockSelect).setValue('all')
    expect((wrapper.find(typeSelect).element as HTMLSelectElement).value).toBe('attack')
    expect((wrapper.find(raritySelect).element as HTMLSelectElement).value).toBe('epic')
    expect((wrapper.find(statusSelect).element as HTMLSelectElement).value).toBe('unequipped')
    expect((wrapper.find(sortSelect).element as HTMLSelectElement).value).toBe('inventory')
  })

  it('锁定筛选无匹配 → 「无匹配筛选结果」；合法空仓库 → 「尚未获得符文」', async () => {
    seedInventory([makeRune('a1', { type: 'attack' })]) // 仅未锁定
    const wrapper = mount(RuneInventoryTab)
    await nextTick()

    await wrapper.find(lockSelect).setValue('locked')
    expect(gridNames(wrapper)).toEqual([])
    expect(wrapper.text()).toContain('无匹配筛选结果')
    expect(wrapper.text()).not.toContain('尚未获得符文')
    // 不误判为损坏
    expect(wrapper.find('.broken-banner').exists()).toBe(false)

    const emptyWrapper = mount(RuneInventoryTab)
    usePlayerStore().runeInventory = []
    await nextTick()
    expect(emptyWrapper.text()).toContain('尚未获得符文')
  })

  it('组件卸载重挂载后 lock filter 恢复为 all（仅组件本地状态，无持久化）', async () => {
    seedStandard()
    const wrapper = mount(RuneInventoryTab)
    await nextTick()
    await wrapper.find(lockSelect).setValue('locked')
    wrapper.unmount()

    const remounted = mount(RuneInventoryTab)
    await nextTick()
    expect((remounted.find(lockSelect).element as HTMLSelectElement).value).toBe('all')
    expect(gridNames(remounted).length).toBe(4)
  })

  it('损坏状态：不显示锁定筛选、不显示摘要、只显示损坏横幅', async () => {
    const playerStore = seedInventory([makeRune('r1'), makeRune('r1', { type: 'defense' })]) // 重复 ID → 损坏
    const wrapper = mount(RuneInventoryTab)
    await nextTick()
    expect(playerStore.runeInventory.length).toBe(2)
    expect(wrapper.find('.broken-banner').exists()).toBe(true)
    expect(wrapper.find(lockSelect).exists()).toBe(false)
    expect(wrapper.find('.summary').exists()).toBe(false)
    expect(wrapper.findAll('.rune-card').length).toBe(0)
  })
})

// ============================================================================
// D. 锁定事务与筛选联动（§22）
// ============================================================================
describe('Phase 3.14 — 锁定事务与当前筛选联动', () => {
  function seedStandard() {
    const playerStore = usePlayerStore()
    playerStore.runeInventory = [
      makeRune('a1', { type: 'attack', rarity: 'common' }),
      makeRune('a2', { type: 'attack', rarity: 'epic', isLocked: true }),
      makeRune('l1', { type: 'luck', rarity: 'rare' })
    ]
    return playerStore
  }

  it('unlocked filter 下锁定可见 Rune → 卡片消失、摘要更新、筛选保持、真实成功反馈、主存档恰好写一次', async () => {
    const playerStore = seedStandard()
    const lockSpy = vi.spyOn(playerStore, 'trySetRuneLocked')
    const wrapper = mount(RuneInventoryTab)
    await nextTick()

    await wrapper.find(lockSelect).setValue('unlocked')
    expect(gridNames(wrapper)).toEqual(['普通攻击符文', '稀有幸运符文'])
    expect(summaryText(wrapper)).toContain('已锁定 1')
    expect(summaryText(wrapper)).toContain('未锁定 2')

    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    await findByAriaPrefix(wrapper, '锁定 普通攻击符文')!.trigger('click')
    await nextTick()

    // 事务恰好一次、收到 canonical Rune ID
    expect(lockSpy).toHaveBeenCalledTimes(1)
    expect(lockSpy).toHaveBeenCalledWith('a1', true)
    // 卡片因不再匹配「未锁定」筛选而消失
    expect(gridNames(wrapper)).toEqual(['稀有幸运符文'])
    // 摘要全局计数更新
    expect(summaryText(wrapper)).toContain('已锁定 2')
    expect(summaryText(wrapper)).toContain('未锁定 1')
    // 筛选值保持
    expect((wrapper.find(lockSelect).element as HTMLSelectElement).value).toBe('unlocked')
    // 真实成功反馈
    expect(wrapper.find('.feedback.success').exists()).toBe(true)
    expect(wrapper.find('.feedback.success').text()).toContain('普通攻击符文 已锁定')
    // 主存档由既有事务恰好写一次
    expect(setItemSpy.mock.calls.filter(c => c[0] === SAVE_KEY).length).toBe(1)
  })

  it('locked filter 下解锁可见 Rune → 卡片消失、摘要同步、筛选保持', async () => {
    const playerStore = seedStandard()
    const lockSpy = vi.spyOn(playerStore, 'trySetRuneLocked')
    const wrapper = mount(RuneInventoryTab)
    await nextTick()

    await wrapper.find(lockSelect).setValue('locked')
    expect(gridNames(wrapper)).toEqual(['史诗攻击符文'])

    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    await findByAriaPrefix(wrapper, '解锁 史诗攻击符文')!.trigger('click')
    await nextTick()

    expect(lockSpy).toHaveBeenCalledTimes(1)
    expect(lockSpy).toHaveBeenCalledWith('a2', false)
    expect(gridNames(wrapper)).toEqual([])
    expect(wrapper.text()).toContain('无匹配筛选结果')
    expect(summaryText(wrapper)).toContain('已锁定 0')
    expect(summaryText(wrapper)).toContain('未锁定 3')
    expect((wrapper.find(lockSelect).element as HTMLSelectElement).value).toBe('locked')
    expect(wrapper.find('.feedback.success').text()).toContain('史诗攻击符文 已解锁')
    expect(setItemSpy.mock.calls.filter(c => c[0] === SAVE_KEY).length).toBe(1)
  })

  it('trySetRuneLocked 返回 ok:false → 卡片保留、摘要不变、筛选保持、不显示成功', async () => {
    const playerStore = seedStandard()
    vi.spyOn(playerStore, 'trySetRuneLocked').mockReturnValue({ ok: false, reason: 'save failed', changed: false })
    const wrapper = mount(RuneInventoryTab)
    await nextTick()

    await wrapper.find(lockSelect).setValue('unlocked')
    const summaryBefore = summaryText(wrapper)
    const namesBefore = gridNames(wrapper)

    await findByAriaPrefix(wrapper, '锁定 普通攻击符文')!.trigger('click')
    await nextTick()

    expect(gridNames(wrapper)).toEqual(namesBefore)
    expect(summaryText(wrapper)).toBe(summaryBefore)
    expect((wrapper.find(lockSelect).element as HTMLSelectElement).value).toBe('unlocked')
    expect(wrapper.find('.feedback.success').exists()).toBe(false)
    expect(wrapper.text()).toContain('锁定操作失败')
    expect(playerStore.runeInventory.find(r => r.id === 'a1')!.isLocked === true).toBe(false)
  })

  it('trySetRuneLocked 抛异常 → 卡片保留、摘要不变、筛选保持、不显示成功、不崩溃', async () => {
    const playerStore = seedStandard()
    vi.spyOn(playerStore, 'trySetRuneLocked').mockImplementation(() => {
      throw new Error('boom')
    })
    const wrapper = mount(RuneInventoryTab)
    await nextTick()

    await wrapper.find(lockSelect).setValue('unlocked')
    const summaryBefore = summaryText(wrapper)
    const namesBefore = gridNames(wrapper)

    await findByAriaPrefix(wrapper, '锁定 普通攻击符文')!.trigger('click')
    await nextTick()

    expect(wrapper.find('.rune-grid').exists()).toBe(true)
    expect(gridNames(wrapper)).toEqual(namesBefore)
    expect(summaryText(wrapper)).toBe(summaryBefore)
    expect((wrapper.find(lockSelect).element as HTMLSelectElement).value).toBe('unlocked')
    expect(wrapper.find('.feedback.success').exists()).toBe(false)
    expect(wrapper.text()).toContain('锁定操作失败')
    expect(playerStore.runeInventory.find(r => r.id === 'a1')!.isLocked === true).toBe(false)
  })
})

// ============================================================================
// E. picker / 强化面板身份保持（§23）
// ============================================================================
describe('Phase 3.14 — 筛选隐藏期间 picker / 强化面板身份保持', () => {
  function seedForPicker() {
    const playerStore = usePlayerStore()
    playerStore.runeInventory = [
      makeRune('a1', { type: 'attack', rarity: 'common' }),
      makeRune('d1', { type: 'defense', rarity: 'common', isLocked: true })
    ]
    playerStore.player.equipment[SLOT_A] = makeRuneEquip('w1', SLOT_A)
    return playerStore
  }

  it('打开 picker 后锁定筛选隐藏目标卡片 → picker 保持、canonical ID 不漂移、确认镶嵌仍传原 ID', async () => {
    const playerStore = seedForPicker()
    const embedSpy = vi.spyOn(playerStore, 'tryEmbedEquipmentRune')
    const wrapper = mount(RuneInventoryTab)
    await nextTick()

    // 打开 a1（未锁定）的镶嵌 picker
    await findByAriaPrefix(wrapper, '镶嵌或移动 普通攻击符文')!.trigger('click')
    expect(wrapper.find('.picker').exists()).toBe(true)
    expect(wrapper.find('.picker-head').text()).toContain('普通攻击符文')

    // 切到「已锁定」筛选 → a1 仓库卡片隐藏
    await wrapper.find(lockSelect).setValue('locked')
    expect(gridNames(wrapper)).toEqual(['普通防御符文'])
    // picker 保持打开、目标身份保持、镶嵌目标列表保持
    expect(wrapper.find('.picker').exists()).toBe(true)
    expect(wrapper.find('.picker-head').text()).toContain('普通攻击符文')
    expect(wrapper.findAll('.picker-slots button').length).toBe(3)
    expect(embedSpy).not.toHaveBeenCalled()

    // 确认镶嵌仍把原 Rune canonical ID 传给事务
    await wrapper.findAll('.picker-slots button')[0].trigger('click')
    await nextTick()
    expect(embedSpy).toHaveBeenCalledTimes(1)
    expect(embedSpy).toHaveBeenCalledWith(SLOT_A, 0, 'a1')
  })

  function seedForFeed() {
    const playerStore = usePlayerStore()
    playerStore.runeInventory = [
      makeRune('t1', { type: 'attack', rarity: 'common', level: 2 }), // 强化目标（非候选）
      makeRune('m1', { type: 'defense', rarity: 'common' }), // 材料 +5
      makeRune('m2', { type: 'luck', rarity: 'rare' }) // 材料 +15
    ]
    return playerStore
  }

  it('打开强化面板后锁定筛选隐藏目标卡片 → 面板保持、目标 ID 不漂移、材料选择与预览保持', async () => {
    const playerStore = seedForFeed()
    const feedSpy = vi.spyOn(playerStore, 'tryFeedRunes')
    const wrapper = mount(RuneInventoryTab)
    await nextTick()

    await findByAriaPrefix(wrapper, '强化 普通攻击符文')!.trigger('click')
    expect(wrapper.find('.feed-panel').exists()).toBe(true)

    // 选择未锁定材料 m1
    await findByAriaPrefix(wrapper, '选择材料 普通防御符文')!.trigger('click')
    expect(wrapper.find('.feed-selection-summary').text()).toContain('已选 1 枚')
    expect(wrapper.find('.feed-selection-summary').text()).toContain('总计 +5 EXP')

    // 切到「已锁定」筛选 → 全部仓库卡片隐藏（无锁定 Rune）
    await wrapper.find(lockSelect).setValue('locked')
    expect(gridNames(wrapper)).toEqual([])
    expect(wrapper.text()).toContain('无匹配筛选结果')

    // 面板保持、目标身份保持、材料选择保持（材料自身仍合法）
    expect(wrapper.find('.feed-panel').exists()).toBe(true)
    expect(wrapper.find('.feed-head').text()).toContain('普通攻击符文')
    const m1Btn = findByAriaPrefix(wrapper, '取消选择材料 普通防御符文')
    expect(m1Btn).toBeTruthy()
    expect(m1Btn!.attributes('aria-pressed')).toBe('true')
    expect(wrapper.find('.feed-selection-summary').text()).toContain('已选 1 枚')
    expect(wrapper.find('.feed-selection-summary').text()).toContain('总计 +5 EXP')
    expect(wrapper.find('.feed-preview').exists()).toBe(true)
    expect((wrapper.find('.feed-confirm').element as HTMLButtonElement).disabled).toBe(false)

    // 筛选隐藏期间切换排序、尾部追加 Rune → 身份与选择不漂移
    await wrapper.find(sortSelect).setValue('rarity')
    playerStore.runeInventory = [...playerStore.runeInventory, makeRune('z9', { type: 'speed', rarity: 'epic' })]
    await nextTick()
    expect(wrapper.find('.feed-head').text()).toContain('普通攻击符文')
    expect(findByAriaPrefix(wrapper, '取消选择材料 普通防御符文')!.attributes('aria-pressed')).toBe('true')
    expect(wrapper.find('.feed-selection-summary').text()).toContain('已选 1 枚')

    // 恢复筛选 → 仓库卡片恢复、选择仍保持
    await wrapper.find(lockSelect).setValue('all')
    expect(gridNames(wrapper).length).toBe(4)
    expect(findByAriaPrefix(wrapper, '取消选择材料 普通防御符文')!.attributes('aria-pressed')).toBe('true')

    // 全程未触发事务
    expect(feedSpy).not.toHaveBeenCalled()
  })

  it('强化面板打开时切换目标锁定状态 → 面板保持打开、锁定目标仍可强化；外层筛选只隐藏仓库卡片', async () => {
    const playerStore = seedForFeed()
    const feedSpy = vi.spyOn(playerStore, 'tryFeedRunes')
    const wrapper = mount(RuneInventoryTab)
    await nextTick()

    await findByAriaPrefix(wrapper, '强化 普通攻击符文')!.trigger('click')
    await findByAriaPrefix(wrapper, '选择材料 普通防御符文')!.trigger('click')
    expect(wrapper.find('.feed-preview').exists()).toBe(true)

    // 真实锁定目标（外部既有唯一事务）
    const res = playerStore.trySetRuneLocked('t1', true)
    expect(res.ok).toBe(true)
    await nextTick()

    // 面板保持打开、预览保持（锁定目标允许强化）
    expect(wrapper.find('.feed-panel').exists()).toBe(true)
    expect(wrapper.find('.feed-head').text()).toContain('普通攻击符文')
    expect(wrapper.find('.feed-preview').exists()).toBe(true)
    expect((wrapper.find('.feed-confirm').element as HTMLButtonElement).disabled).toBe(false)

    // 外层筛选切到「未锁定」→ 目标卡片消失，但面板不得关闭
    await wrapper.find(lockSelect).setValue('unlocked')
    expect(gridNames(wrapper)).not.toContain('普通攻击符文')
    expect(wrapper.find('.feed-panel').exists()).toBe(true)
    expect(wrapper.find('.feed-head').text()).toContain('普通攻击符文')
    expect(feedSpy).not.toHaveBeenCalled()
  })
})

// ============================================================================
// F. 材料真实锁定失效回归（§24）
// ============================================================================
describe('Phase 3.14 — 材料真实锁定时按既有规则失效', () => {
  it('已选两枚材料其中一枚被锁定 → 只移除该材料；解锁后重回候选且不自动重选', async () => {
    const playerStore = usePlayerStore()
    playerStore.runeInventory = [
      makeRune('t1', { type: 'attack', rarity: 'common', level: 2 }),
      makeRune('m1', { type: 'defense', rarity: 'common' }), // +5
      makeRune('m2', { type: 'luck', rarity: 'rare' }) // +15
    ]
    const feedSpy = vi.spyOn(playerStore, 'tryFeedRunes')
    const wrapper = mount(RuneInventoryTab)
    await nextTick()

    await findByAriaPrefix(wrapper, '强化 普通攻击符文')!.trigger('click')
    await findByAriaPrefix(wrapper, '选择材料 普通防御符文')!.trigger('click')
    await findByAriaPrefix(wrapper, '选择材料 稀有幸运符文')!.trigger('click')
    expect(wrapper.find('.feed-selection-summary').text()).toContain('已选 2 枚')
    expect(wrapper.find('.feed-selection-summary').text()).toContain('总计 +20 EXP')

    // m1 真正被锁定 → 材料资格失效（非外层筛选隐藏）
    const res = playerStore.trySetRuneLocked('m1', true)
    expect(res.ok).toBe(true)
    await nextTick()

    // 只移除被锁定材料；另一枚保持选中；预览按剩余材料更新
    expect(findByAriaPrefix(wrapper, '选择材料 普通防御符文')).toBeNull()
    expect(findByAriaPrefix(wrapper, '取消选择材料 普通防御符文')).toBeNull()
    const m2Btn = findByAriaPrefix(wrapper, '取消选择材料 稀有幸运符文')
    expect(m2Btn).toBeTruthy()
    expect(m2Btn!.attributes('aria-pressed')).toBe('true')
    expect(wrapper.find('.feed-selection-summary').text()).toContain('已选 1 枚')
    expect(wrapper.find('.feed-selection-summary').text()).toContain('总计 +15 EXP')
    expect(wrapper.find('.feed-panel').exists()).toBe(true)
    expect(wrapper.find('.feed-preview').exists()).toBe(true)
    expect(feedSpy).not.toHaveBeenCalled()

    // 解锁 m1 → 重回候选、aria-pressed=false、不自动重选
    const res2 = playerStore.trySetRuneLocked('m1', false)
    expect(res2.ok).toBe(true)
    await nextTick()
    const m1Btn = findByAriaPrefix(wrapper, '选择材料 普通防御符文')
    expect(m1Btn).toBeTruthy()
    expect(m1Btn!.attributes('aria-pressed')).toBe('false')
    expect(wrapper.find('.feed-selection-summary').text()).toContain('已选 1 枚')
    expect(feedSpy).not.toHaveBeenCalled()
  })

  it('全部已选材料被锁定 → 回到已选 0 枚、面板保持、不调用吞噬事务', async () => {
    const playerStore = usePlayerStore()
    playerStore.runeInventory = [
      makeRune('t1', { type: 'attack', rarity: 'common', level: 2 }),
      makeRune('m1', { type: 'defense', rarity: 'common' })
    ]
    const feedSpy = vi.spyOn(playerStore, 'tryFeedRunes')
    const wrapper = mount(RuneInventoryTab)
    await nextTick()

    await findByAriaPrefix(wrapper, '强化 普通攻击符文')!.trigger('click')
    await findByAriaPrefix(wrapper, '选择材料 普通防御符文')!.trigger('click')
    expect(wrapper.find('.feed-selection-summary').text()).toContain('已选 1 枚')

    expect(playerStore.trySetRuneLocked('m1', true).ok).toBe(true)
    await nextTick()

    expect(wrapper.find('.feed-panel').exists()).toBe(true)
    expect(wrapper.find('.feed-selection-summary').text()).toContain('已选 0 枚')
    expect(wrapper.find('.feed-selection-summary').text()).toContain('总计 +0 EXP')
    expect(wrapper.find('.feed-selection-summary').text()).toContain('尚未选择可消耗材料')
    expect(feedSpy).not.toHaveBeenCalled()
  })
})
