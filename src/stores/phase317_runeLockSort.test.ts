// @vitest-environment jsdom
/**
 * Phase 3.17 — Rune 锁定状态排序（locked-first / unlocked-first）
 *
 * 仅覆盖排序维度扩展：sortRuneRows 两个新 key、UI 排序下拉新选项、筛选 + 排序组合、
 * 切换排序不影响 picker / 强化 / 批量锁定的 canonical-ID 选择、外部单 Rune 锁定事务后
 * 列表自动重排但打开面板与选择不丢失。
 *
 * 不修改生产事务 / planner / 筛选 / balance 公式与报告；不持久化、不改 Store / 存档 /
 * localStorage / Rune 字段。
 *
 * 覆盖（§19-§22）：
 *   A. sortRuneRows locked-first / unlocked-first（两种方向 + tie-breaker=inventoryIndex /
 *      输入数组不变 / 零 RNG / 零写盘 / canonical row.isLocked 唯一来源 /
 *      旧档缺失 isLocked 经 canonical view 归一化为未锁定后再排序）
 *   B. UI 卡片顺序（默认 inventory 不变 / locked-first / unlocked-first 正确 /
 *      切换排序零写盘零事务 / 不重置其他筛选维度）
 *   C. 筛选 + 排序组合（lock + 排序 / type + 排序 / 四维组合）
 *   D. 打开 picker / 强化 / 批量锁定面板后切换排序，canonical-ID 选择身份保持
 *   E. 外部单 Rune 锁定事务后列表自动重排，但打开面板与选择不丢失（批量锁定 / picker）
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
  sortRuneRows,
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

function findByAriaPrefix(wrapper: ReturnType<typeof mount>, prefix: string) {
  const buttons = wrapper.findAll('button')
  for (const btn of buttons) {
    const label = btn.attributes('aria-label')
    if (label && label.startsWith(prefix)) return btn
  }
  return null
}

/** 仓库卡片网格中当前可见的 Rune 名称（不含 picker / 强化面板 / 批量锁定面板内的名称）。 */
function gridNames(wrapper: ReturnType<typeof mount>): string[] {
  return wrapper.findAll('.rune-card .rune-name').map(n => n.text())
}

/** 顶部全仓库摘要文本。 */
const lockSelect = 'select[aria-label="按锁定状态筛选"]'
const typeSelect = 'select[aria-label="按类型筛选"]'
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
// A. sortRuneRows 锁定状态排序（§19）
// ============================================================================
describe('Phase 3.17 — sortRuneRows 锁定状态排序', () => {
  /**
   * 六枚 Rune（展示名互不相同、inventoryIndex 为数组下标）：
   *   r0 attack/epic/锁定        r1 attack/common/未锁定
   *   r2 defense/epic/锁定        r3 luck/rare/未锁定
   *   r4 speed/common/未锁定      r5 health/legend/锁定
   * 锁定组 = {r0(idx0), r2(idx2), r5(idx5)}；未锁定组 = {r1(idx1), r3(idx3), r4(idx4)}
   */
  function buildRows(): RuneInventoryRow[] {
    const inventory = [
      makeRune('r0', { type: 'attack', rarity: 'epic', isLocked: true }),
      makeRune('r1', { type: 'attack', rarity: 'common' }),
      makeRune('r2', { type: 'defense', rarity: 'epic', isLocked: true }),
      makeRune('r3', { type: 'luck', rarity: 'rare' }),
      makeRune('r4', { type: 'speed', rarity: 'common' }),
      makeRune('r5', { type: 'health', rarity: 'legend', isLocked: true })
    ]
    const view = buildRuneInventoryView(inventory, {})
    if (!view.ok) throw new Error('expected ok')
    return view.rows
  }

  it('locked-first：锁定组在前、未锁定组在后，各组严格按 inventoryIndex 升序', () => {
    const rows = buildRows()
    expect(sortRuneRows(rows, 'locked-first').map(r => r.rune.id)).toEqual(['r0', 'r2', 'r5', 'r1', 'r3', 'r4'])
  })

  it('unlocked-first：未锁定组在前、锁定组在后，各组严格按 inventoryIndex 升序', () => {
    const rows = buildRows()
    expect(sortRuneRows(rows, 'unlocked-first').map(r => r.rune.id)).toEqual(['r1', 'r3', 'r4', 'r0', 'r2', 'r5'])
  })

  it('tie-breaker 严格基于 inventoryIndex（与输入数组顺序无关）：乱序输入归一化为 inventoryIndex 序', () => {
    const rows = buildRows()
    // 故意打乱输入数组顺序（r5,r0,r3,r2,r4,r1）
    const shuffled = [rows[5], rows[0], rows[3], rows[2], rows[4], rows[1]]
    expect(shuffled.map(r => r.rune.id)).toEqual(['r5', 'r0', 'r3', 'r2', 'r4', 'r1'])
    // 排序后回到 inventoryIndex 序：锁定组 [r0,r2,r5] 然后未锁定组 [r1,r3,r4]
    expect(sortRuneRows(shuffled, 'locked-first').map(r => r.rune.id)).toEqual(['r0', 'r2', 'r5', 'r1', 'r3', 'r4'])
    expect(sortRuneRows(shuffled, 'unlocked-first').map(r => r.rune.id)).toEqual(['r1', 'r3', 'r4', 'r0', 'r2', 'r5'])
  })

  it('全部锁定 / 全部未锁定：单组退化为 inventoryIndex 序（两种方向结果相同）', () => {
    const allLocked = buildRuneInventoryView(
      [
        makeRune('a', { type: 'attack', isLocked: true }),
        makeRune('b', { type: 'defense', rarity: 'rare', isLocked: true }),
        makeRune('c', { type: 'luck', rarity: 'epic', isLocked: true })
      ],
      {}
    )
    if (!allLocked.ok) throw new Error('expected ok')
    const lf = ['a', 'b', 'c']
    expect(sortRuneRows(allLocked.rows, 'locked-first').map(r => r.rune.id)).toEqual(lf)
    expect(sortRuneRows(allLocked.rows, 'unlocked-first').map(r => r.rune.id)).toEqual(lf)

    const allUnlocked = buildRuneInventoryView(
      [makeRune('a', { type: 'attack' }), makeRune('b', { type: 'defense', rarity: 'rare' })],
      {}
    )
    if (!allUnlocked.ok) throw new Error('expected ok')
    const uf = ['a', 'b']
    expect(sortRuneRows(allUnlocked.rows, 'locked-first').map(r => r.rune.id)).toEqual(uf)
    expect(sortRuneRows(allUnlocked.rows, 'unlocked-first').map(r => r.rune.id)).toEqual(uf)
  })

  it('输入数组不变、不修改 row、零 RNG、零写盘、不读取 Pinia 之外新增副作用', () => {
    const rows = buildRows()
    const rowsSnapshot = JSON.stringify(rows)
    const rngSpy = vi.spyOn(Math, 'random')
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')

    const out1 = sortRuneRows(rows, 'locked-first')
    const out2 = sortRuneRows(rows, 'unlocked-first')

    expect(out1).not.toBe(rows)
    expect(out2).not.toBe(rows)
    // 排序唯一改变顺序，不改写任何 row 字段
    expect(JSON.stringify(rows)).toBe(rowsSnapshot)
    expect(rngSpy).not.toHaveBeenCalled()
    expect(setItemSpy).not.toHaveBeenCalled()
  })

  it('防回归：row.rune.isLocked 与 row.isLocked 故意不一致 → 排序只信 canonical row.isLocked', () => {
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
    // 只信 row.isLocked：locked-first → forgedLocked 先；unlocked-first → forgedUnlocked 先
    expect(sortRuneRows(forged, 'locked-first').map(r => r.rune.id)).toEqual(['r1', 'r0'])
    expect(sortRuneRows(forged, 'unlocked-first').map(r => r.rune.id)).toEqual(['r0', 'r1'])
  })

  it('旧档缺失 isLocked 经 canonical view 归一化为未锁定后，按未锁定参与排序', () => {
    // makeRune 不带 isLocked → 对象上没有该 key（旧档形状）
    const legacy0 = makeRune('old0')
    const legacy2 = makeRune('old2')
    expect('isLocked' in legacy0).toBe(false)
    expect('isLocked' in legacy2).toBe(false)

    const inventory = [
      legacy0,
      makeRune('new1', { type: 'defense', rarity: 'epic', isLocked: true }),
      legacy2
    ]
    const view = buildRuneInventoryView(inventory, {})
    if (!view.ok) throw new Error('expected ok')
    // 归一化：old0/old2 canonical row.isLocked === false 计入未锁定
    expect(view.rows[0].isLocked).toBe(false)
    expect(view.rows[2].isLocked).toBe(false)
    expect(view.rows[1].isLocked).toBe(true)

    // locked-first：new1（锁定/idx1）先；old0（idx0）、old2（idx2）随后
    expect(sortRuneRows(view.rows, 'locked-first').map(r => r.rune.id)).toEqual(['new1', 'old0', 'old2'])
    // unlocked-first：old0、old2 先；new1 最后
    expect(sortRuneRows(view.rows, 'unlocked-first').map(r => r.rune.id)).toEqual(['old0', 'old2', 'new1'])
  })
})

// ============================================================================
// B. UI 卡片顺序（§20）
// ============================================================================
describe('Phase 3.17 — UI 锁定状态排序卡片顺序', () => {
  function seedStandard() {
    const playerStore = usePlayerStore()
    playerStore.runeInventory = [
      makeRune('a1', { type: 'attack', rarity: 'common' }), // 未锁定
      makeRune('a2', { type: 'attack', rarity: 'epic', isLocked: true }), // 锁定
      makeRune('d1', { type: 'defense', rarity: 'common', isLocked: true }), // 锁定
      makeRune('l1', { type: 'luck', rarity: 'rare' }) // 未锁定
    ]
    return playerStore
  }

  it('排序下拉新增两个选项，文案与值正确', async () => {
    seedStandard()
    const wrapper = mount(RuneInventoryTab)
    await nextTick()
    const sel = wrapper.find(sortSelect)
    const options = sel.findAll('option').map(o => ({ value: o.attributes('value'), text: o.text() }))
    expect(options).toContainEqual({ value: 'locked-first', text: '已锁定优先' })
    expect(options).toContainEqual({ value: 'unlocked-first', text: '未锁定优先' })
    expect(options.map(o => o.value)).toEqual([
      'inventory',
      'rarity',
      'level',
      'effective',
      'locked-first',
      'unlocked-first'
    ])
  })

  it('默认 inventory 排序不变；locked-first / unlocked-first 卡片顺序正确', async () => {
    seedStandard()
    const wrapper = mount(RuneInventoryTab)
    await nextTick()

    expect(gridNames(wrapper)).toEqual(['普通攻击符文', '史诗攻击符文', '普通防御符文', '稀有幸运符文'])

    await wrapper.find(sortSelect).setValue('locked-first')
    // 锁定组（idx1 a2、idx2 d1）→ 未锁定组（idx0 a1、idx3 l1）
    expect(gridNames(wrapper)).toEqual(['史诗攻击符文', '普通防御符文', '普通攻击符文', '稀有幸运符文'])

    await wrapper.find(sortSelect).setValue('unlocked-first')
    // 未锁定组（idx0 a1、idx3 l1）→ 锁定组（idx1 a2、idx2 d1）
    expect(gridNames(wrapper)).toEqual(['普通攻击符文', '稀有幸运符文', '史诗攻击符文', '普通防御符文'])
  })

  it('切换排序：卡片顺序改变、零写盘零事务、不重置其他筛选维度、sortKey 保持', async () => {
    seedStandard()
    const playerStore = usePlayerStore()
    const wrapper = mount(RuneInventoryTab)
    await nextTick()

    const lockSpy = vi.spyOn(playerStore, 'trySetRuneLocked')
    const feedSpy = vi.spyOn(playerStore, 'tryFeedRunes')
    const embedSpy = vi.spyOn(playerStore, 'tryEmbedEquipmentRune')
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')

    // 先设一个筛选（lock=locked），再切排序，筛选须保持（排序只重排、不过滤）
    await wrapper.find(lockSelect).setValue('locked')
    expect(gridNames(wrapper)).toEqual(['史诗攻击符文', '普通防御符文'])

    await wrapper.find(sortSelect).setValue('unlocked-first')
    // 筛选 lock=locked 仍生效 → 仍只显示锁定卡片（排序方向不改变集合）；过滤与排序正交
    expect(gridNames(wrapper)).toEqual(['史诗攻击符文', '普通防御符文'])
    expect(wrapper.find('.rune-grid').exists()).toBe(true)
    // 恢复 lock=all 后排序生效
    await wrapper.find(lockSelect).setValue('all')
    expect(gridNames(wrapper)).toEqual(['普通攻击符文', '稀有幸运符文', '史诗攻击符文', '普通防御符文'])

    // 排序切换未触发任何事务 / 写盘
    expect(setItemSpy.mock.calls.filter(c => c[0] === SAVE_KEY).length).toBe(0)
    expect(lockSpy).not.toHaveBeenCalled()
    expect(feedSpy).not.toHaveBeenCalled()
    expect(embedSpy).not.toHaveBeenCalled()
    // sortKey 保持为切换后的值
    expect((wrapper.find(sortSelect).element as HTMLSelectElement).value).toBe('unlocked-first')
  })
})

// ============================================================================
// C. 筛选 + 排序组合（§21）
// ============================================================================
describe('Phase 3.17 — 筛选 + 锁定排序组合', () => {
  function seedMixed() {
    const playerStore = usePlayerStore()
    playerStore.runeInventory = [
      makeRune('a1', { type: 'attack', rarity: 'common' }), // 未锁定
      makeRune('a2', { type: 'attack', rarity: 'epic', isLocked: true }), // 锁定
      makeRune('d1', { type: 'defense', rarity: 'common', isLocked: true }), // 锁定
      makeRune('l1', { type: 'luck', rarity: 'rare' }), // 未锁定
      makeRune('l2', { type: 'luck', rarity: 'epic', isLocked: true }) // 锁定
    ]
    return playerStore
  }

  it('lock 筛选 + 排序：只显示锁定卡片且按 inventoryIndex 序；切换排序不重置筛选', async () => {
    seedMixed()
    const wrapper = mount(RuneInventoryTab)
    await nextTick()

    await wrapper.find(lockSelect).setValue('locked')
    expect(gridNames(wrapper)).toEqual(['史诗攻击符文', '普通防御符文', '史诗幸运符文'])

    await wrapper.find(sortSelect).setValue('locked-first')
    // 锁定卡片内部顺序不变（单组退化为 inventoryIndex 序）
    expect(gridNames(wrapper)).toEqual(['史诗攻击符文', '普通防御符文', '史诗幸运符文'])
    expect((wrapper.find(lockSelect).element as HTMLSelectElement).value).toBe('locked')

    await wrapper.find(sortSelect).setValue('unlocked-first')
    // 仍只显示锁定卡片（筛选未重置）
    expect(gridNames(wrapper)).toEqual(['史诗攻击符文', '普通防御符文', '史诗幸运符文'])
    expect((wrapper.find(lockSelect).element as HTMLSelectElement).value).toBe('locked')
  })

  it('type 筛选 + 排序：attack 类下锁定优先把已锁定攻击符文顶到最前', async () => {
    seedMixed()
    const wrapper = mount(RuneInventoryTab)
    await nextTick()

    await wrapper.find(typeSelect).setValue('attack')
    // attack：a1(未锁定,idx0)、a2(锁定,idx1)
    await wrapper.find(sortSelect).setValue('locked-first')
    expect(gridNames(wrapper)).toEqual(['史诗攻击符文', '普通攻击符文'])
    await wrapper.find(sortSelect).setValue('unlocked-first')
    expect(gridNames(wrapper)).toEqual(['普通攻击符文', '史诗攻击符文'])
  })

  it('四维组合：attack + 全部状态 + 全部稀有度 + 锁定筛选 + 排序，不互相覆盖', async () => {
    seedMixed()
    const wrapper = mount(RuneInventoryTab)
    await nextTick()

    await wrapper.find(typeSelect).setValue('attack')
    await wrapper.find(lockSelect).setValue('locked')
    await wrapper.find(sortSelect).setValue('locked-first')
    // attack + locked → 仅 a2（史诗攻击符文）
    expect(gridNames(wrapper)).toEqual(['史诗攻击符文'])
    expect((wrapper.find(typeSelect).element as HTMLSelectElement).value).toBe('attack')
    expect((wrapper.find(lockSelect).element as HTMLSelectElement).value).toBe('locked')
    expect((wrapper.find(sortSelect).element as HTMLSelectElement).value).toBe('locked-first')
  })
})

// ============================================================================
// D. 打开面板后切换排序，canonical-ID 选择身份保持（§22）
// ============================================================================
describe('Phase 3.17 — 切换排序不影响面板 canonical-ID 选择', () => {
  it('打开镶嵌 picker 后切换排序 → picker 保持、目标身份保持、确认仍传原 ID', async () => {
    const playerStore = usePlayerStore()
    playerStore.runeInventory = [
      makeRune('a1', { type: 'attack', rarity: 'common' }),
      makeRune('d1', { type: 'defense', rarity: 'common', isLocked: true })
    ]
    playerStore.player.equipment[SLOT_A] = makeRuneEquip('w1', SLOT_A)
    const embedSpy = vi.spyOn(playerStore, 'tryEmbedEquipmentRune')
    const wrapper = mount(RuneInventoryTab)
    await nextTick()

    await findByAriaPrefix(wrapper, '镶嵌或移动 普通攻击符文')!.trigger('click')
    expect(wrapper.find('.picker').exists()).toBe(true)
    expect(wrapper.find('.picker-head').text()).toContain('普通攻击符文')

    // 切到「已锁定优先」排序（a1 未锁定应在后；但排序不影响 picker 身份）
    await wrapper.find(sortSelect).setValue('locked-first')
    expect(gridNames(wrapper)).toEqual(['普通防御符文', '普通攻击符文'])
    expect(wrapper.find('.picker').exists()).toBe(true)
    expect(wrapper.find('.picker-head').text()).toContain('普通攻击符文')
    expect(wrapper.findAll('.picker-slots button').length).toBe(3)

    await wrapper.findAll('.picker-slots button')[0].trigger('click')
    await nextTick()
    expect(embedSpy).toHaveBeenCalledTimes(1)
    expect(embedSpy).toHaveBeenCalledWith(SLOT_A, 0, 'a1')
  })

  it('打开强化面板并选择材料后切换排序 → 面板保持、材料选择保持、预览保持、确认仍传原 ID', async () => {
    const playerStore = usePlayerStore()
    playerStore.runeInventory = [
      makeRune('t1', { type: 'attack', rarity: 'common', level: 2 }), // 目标（未锁定）
      makeRune('m1', { type: 'defense', rarity: 'common' }), // 材料（未锁定）
      makeRune('m2', { type: 'luck', rarity: 'rare' }), // 材料（未锁定）
      makeRune('x1', { type: 'speed', rarity: 'rare', isLocked: true }) // 已锁定（非材料非目标，用于体现排序差异）
    ]
    const feedSpy = vi.spyOn(playerStore, 'tryFeedRunes')
    const wrapper = mount(RuneInventoryTab)
    await nextTick()

    await findByAriaPrefix(wrapper, '强化 普通攻击符文')!.trigger('click')
    await findByAriaPrefix(wrapper, '选择材料 普通防御符文')!.trigger('click')
    expect(wrapper.find('.feed-selection-summary').text()).toContain('已选 1 枚')
    expect(wrapper.find('.feed-preview').exists()).toBe(true)

    // 切换排序（先 locked-first 再 unlocked-first）：已锁定 x1 在前者顶部、在后者尾部
    await wrapper.find(sortSelect).setValue('locked-first')
    expect(gridNames(wrapper)).toEqual(['稀有速度符文', '普通攻击符文', '普通防御符文', '稀有幸运符文'])
    await wrapper.find(sortSelect).setValue('unlocked-first')
    expect(gridNames(wrapper)).toEqual(['普通攻击符文', '普通防御符文', '稀有幸运符文', '稀有速度符文'])

    // 面板 / 目标身份 / 材料选择 / 预览全部保持
    expect(wrapper.find('.feed-panel').exists()).toBe(true)
    expect(wrapper.find('.feed-head').text()).toContain('普通攻击符文')
    const m1Btn = findByAriaPrefix(wrapper, '取消选择材料 普通防御符文')
    expect(m1Btn).toBeTruthy()
    expect(m1Btn!.attributes('aria-pressed')).toBe('true')
    expect(wrapper.find('.feed-selection-summary').text()).toContain('已选 1 枚')
    expect(wrapper.find('.feed-preview').exists()).toBe(true)
    expect((wrapper.find('.feed-confirm').element as HTMLButtonElement).disabled).toBe(false)

    // 确认仍按原选择序传 canonical ID
    await wrapper.find('.feed-confirm').trigger('click')
    await nextTick()
    expect(feedSpy).toHaveBeenCalledTimes(1)
    expect(feedSpy).toHaveBeenCalledWith('t1', ['m1'])
  })

  it('打开批量锁定面板并选择后切换排序 → 面板保持、选择保持、预览保持、sortKey 保持', async () => {
    const playerStore = usePlayerStore()
    playerStore.runeInventory = [
      makeRune('a1', { type: 'attack', rarity: 'common' }),
      makeRune('a2', { type: 'attack', rarity: 'epic', isLocked: true }),
      makeRune('d1', { type: 'defense', rarity: 'common', isLocked: true })
    ]
    const wrapper = mount(RuneInventoryTab)
    await nextTick()

    await findByAriaPrefix(wrapper, '打开批量锁定管理')!.trigger('click')
    expect(wrapper.find('.batch-lock-panel').exists()).toBe(true)
    // 选择 a1（未锁定）与 d1（已锁定，但选择资格只看存在）
    await findByAriaPrefix(wrapper, '选择符文 普通攻击符文')!.trigger('click')
    await findByAriaPrefix(wrapper, '选择符文 普通防御符文')!.trigger('click')
    const a1Sel = findByAriaPrefix(wrapper, '取消选择符文 普通攻击符文')
    const d1Sel = findByAriaPrefix(wrapper, '取消选择符文 普通防御符文')
    expect(a1Sel!.attributes('aria-pressed')).toBe('true')
    expect(d1Sel!.attributes('aria-pressed')).toBe('true')

    // 切换排序不影响批量面板候选（候选来自完整 rows，按 inventoryIndex）
    await wrapper.find(sortSelect).setValue('locked-first')
    expect(wrapper.find('.batch-lock-panel').exists()).toBe(true)
    expect(findByAriaPrefix(wrapper, '取消选择符文 普通攻击符文')!.attributes('aria-pressed')).toBe('true')
    expect(findByAriaPrefix(wrapper, '取消选择符文 普通防御符文')!.attributes('aria-pressed')).toBe('true')
    expect(wrapper.find('.batch-lock-summary').text()).toContain('已选择 2 枚')
    expect((wrapper.find(sortSelect).element as HTMLSelectElement).value).toBe('locked-first')

    await wrapper.find(sortSelect).setValue('unlocked-first')
    expect(wrapper.find('.batch-lock-panel').exists()).toBe(true)
    expect(findByAriaPrefix(wrapper, '取消选择符文 普通攻击符文')!.attributes('aria-pressed')).toBe('true')
    expect(findByAriaPrefix(wrapper, '取消选择符文 普通防御符文')!.attributes('aria-pressed')).toBe('true')
  })
})

// ============================================================================
// E. 外部单 Rune 锁定事务后列表自动重排，但打开面板与选择不丢失（§23）
// ============================================================================
describe('Phase 3.17 — 外部锁定事务后自动重排、面板与选择保持', () => {
  it('批量锁定面板打开并选中某 Rune 后，外部锁定另一 Rune → 网格重排、面板保持、选择保持', async () => {
    const playerStore = usePlayerStore()
    playerStore.runeInventory = [
      makeRune('a1', { type: 'attack', rarity: 'common' }), // 未锁定
      makeRune('a2', { type: 'attack', rarity: 'epic', isLocked: true }), // 已锁定
      makeRune('d1', { type: 'defense', rarity: 'common' }), // 未锁定
      makeRune('l1', { type: 'luck', rarity: 'rare' }) // 未锁定
    ]
    const wrapper = mount(RuneInventoryTab)
    await nextTick()

    await wrapper.find(sortSelect).setValue('locked-first')
    // 锁定组：a2；未锁定组：a1,d1,l1（按 inventoryIndex）
    expect(gridNames(wrapper)).toEqual(['史诗攻击符文', '普通攻击符文', '普通防御符文', '稀有幸运符文'])

    // 打开批量锁定面板，选中 d1（非即将被锁定的 Rune）
    await findByAriaPrefix(wrapper, '打开批量锁定管理')!.trigger('click')
    await findByAriaPrefix(wrapper, '选择符文 普通防御符文')!.trigger('click')
    expect(findByAriaPrefix(wrapper, '取消选择符文 普通防御符文')!.attributes('aria-pressed')).toBe('true')

    // 外部单 Rune 锁定事务：锁定 l1（idx3）→ 进入锁定组并顶到前面（锁定组内 inventoryIndex 序：a2(1), l1(3)）
    const res = playerStore.trySetRuneLocked('l1', true)
    expect(res.ok).toBe(true)
    await nextTick()

    // 网格自动重排：锁定组 a2,l1 → 未锁定组 a1,d1
    expect(gridNames(wrapper)).toEqual(['史诗攻击符文', '稀有幸运符文', '普通攻击符文', '普通防御符文'])
    // 批量面板保持打开、选择保持、sortKey 保持
    expect(wrapper.find('.batch-lock-panel').exists()).toBe(true)
    expect(findByAriaPrefix(wrapper, '取消选择符文 普通防御符文')!.attributes('aria-pressed')).toBe('true')
    expect(wrapper.find('.batch-lock-summary').text()).toContain('已选择 1 枚')
    expect((wrapper.find(sortSelect).element as HTMLSelectElement).value).toBe('locked-first')
  })

  it('镶嵌 picker 打开后，外部锁定另一 Rune → 网格重排、picker 保持、目标身份保持', async () => {
    const playerStore = usePlayerStore()
    playerStore.runeInventory = [
      makeRune('a1', { type: 'attack', rarity: 'common' }), // 未锁定
      makeRune('d1', { type: 'defense', rarity: 'common', isLocked: true }), // 已锁定
      makeRune('l1', { type: 'luck', rarity: 'rare' }) // 未锁定
    ]
    playerStore.player.equipment[SLOT_A] = makeRuneEquip('w1', SLOT_A)
    const wrapper = mount(RuneInventoryTab)
    await nextTick()

    await wrapper.find(sortSelect).setValue('unlocked-first')
    // 未锁定组：a1,l1；锁定组：d1
    expect(gridNames(wrapper)).toEqual(['普通攻击符文', '稀有幸运符文', '普通防御符文'])

    // 打开 a1 的镶嵌 picker
    await findByAriaPrefix(wrapper, '镶嵌或移动 普通攻击符文')!.trigger('click')
    expect(wrapper.find('.picker').exists()).toBe(true)
    expect(wrapper.find('.picker-head').text()).toContain('普通攻击符文')

    // 外部锁定 l1 → 进入锁定组（unlocked-first 下被推到末尾）
    expect(playerStore.trySetRuneLocked('l1', true).ok).toBe(true)
    await nextTick()

    // 网格重排：未锁定组仅 a1；锁定组 d1,l1
    expect(gridNames(wrapper)).toEqual(['普通攻击符文', '普通防御符文', '稀有幸运符文'])
    // picker 保持打开、目标身份保持
    expect(wrapper.find('.picker').exists()).toBe(true)
    expect(wrapper.find('.picker-head').text()).toContain('普通攻击符文')
  })
})
