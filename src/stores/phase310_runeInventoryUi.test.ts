// @vitest-environment jsdom
/**
 * Phase 3.10 — Rune 仓库视图、全局镶嵌位置展示与原子管理 UI
 *
 * 覆盖：
 *   A. 纯视图模型 buildRuneInventoryView（只读派生、helper 对拍、输入不变、无 RNG / 无写盘）
 *   B. fail-closed（重复 ID / 悬空 / 重复引用 / 三孔损坏 / 进度非法 / getter & Proxy 抛 → ok:false 不抛）
 *   C. filterRuneRows / sortRuneRows / summarizeRuneRows（本地筛选、确定性排序、tie-breaker = inventoryIndex）
 *   D. UI 集成（空仓库 / 卡片展示 / 镶嵌 / 移动 / 覆盖 / 移除 / 重载持久化 / 筛选不写盘）
 *   E. 事务失败 UI（saveGame 失败 / mock ok:false / mock 抛异常 / 损坏拓扑页面 → 不崩溃、绝不显示成功）
 *   F. 导航回归（难度 0 即可进入 build/runes，配置与阶段系统一致）
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
import { useNavigationStore } from './navigationStore'
import type { Rune } from './runeStore'
import RuneInventoryTab from '../components/RuneInventoryTab.vue'
import {
  buildRuneInventoryView,
  filterRuneRows,
  sortRuneRows,
  summarizeRuneRows,
  type RuneInventoryRow
} from '../utils/runeInventoryView'
import {
  createEmptyEquipmentRuneSlots,
  getRuneDisplayName,
  getRuneColorClass,
  getRuneEffectiveValue,
  getRuneRarityLabel,
  RUNE_TYPE_TO_STAT
} from '../utils/equipmentRunes'
import { getRuneExperienceProgress } from '../utils/runeExperience'
import { SECONDARY_PAGES, MAINLINE_UNLOCK_STAGES } from '../types/navigation'
import { EQUIPMENT_SLOTS, EQUIPMENT_SLOT_NAMES } from '../types'
import type { Equipment, EquipmentSlot, RuneSlot } from '../types'

const SAVE_KEY = 'lollipop_adventure_save'
const SLOT_A: EquipmentSlot = 'weapon'
const SLOT_B: EquipmentSlot = EQUIPMENT_SLOTS.find(s => s !== 'weapon') as EquipmentSlot

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

/** 主存档 setItem 抛错、读取委托真实 storage（与 Phase 3.2.3/3.4/3.5/3.6 一致）。 */
function installThrowingStorage() {
  const realStorage = localStorage
  const throwingStorage = {
    get length() {
      return realStorage.length
    },
    clear: () => realStorage.clear(),
    getItem: (k: string) => realStorage.getItem(k),
    key: (i: number) => realStorage.key(i),
    removeItem: (k: string) => realStorage.removeItem(k),
    setItem: (_k: string, _v: string) => {
      throw new Error('quota exceeded')
    }
  }
  vi.stubGlobal('localStorage', throwingStorage)
  return realStorage
}

function makeRune(id: string, opts?: Partial<Omit<Rune, 'id'>>): Rune {
  return {
    id,
    type: opts?.type ?? 'attack',
    rarity: opts?.rarity ?? 'common',
    level: opts?.level ?? 1,
    exp: opts?.exp ?? 0,
    statValue: opts?.statValue ?? 10
  }
}

function makeRuneEquip(
  id: string,
  slot: EquipmentSlot,
  opts?: { runeSlots?: RuneSlot[]; isLocked?: boolean }
): Equipment {
  return {
    id,
    slot,
    name: id,
    rarity: 'common',
    level: 10,
    stats: [{ type: 'attack', value: 100, isPercent: false }],
    isLocked: opts?.isLocked ?? false,
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

/** 通过 aria-label 前缀找按钮。 */
function findByAriaPrefix(wrapper: ReturnType<typeof mount>, prefix: string) {
  const buttons = wrapper.findAll('button')
  for (const btn of buttons) {
    const label = btn.attributes('aria-label')
    if (label && label.startsWith(prefix)) return btn
  }
  return null
}

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
// A. 纯视图模型
// ============================================================================
describe('Phase 3.10 — buildRuneInventoryView 只读派生', () => {
  it('空仓库 + 空装备 → ok 且 rows 为空（合法空状态，不是错误）', () => {
    const view = buildRuneInventoryView([], {})
    expect(view.ok).toBe(true)
    if (!view.ok) throw new Error('expected ok')
    expect(view.rows).toEqual([])
  })

  it('未镶嵌 Rune：binding=null，展示值与既有 helper 对拍（不复制第二套公式）', () => {
    const rune = makeRune('r1', { type: 'health', rarity: 'epic', level: 5, statValue: 100 })
    const view = buildRuneInventoryView([rune], {})
    expect(view.ok).toBe(true)
    if (!view.ok) throw new Error('expected ok')
    expect(view.rows).toHaveLength(1)
    const row = view.rows[0]
    expect(row.inventoryIndex).toBe(0)
    expect(row.binding).toBeNull()
    expect(row.displayName).toBe(getRuneDisplayName(rune))
    expect(row.colorClass).toBe(getRuneColorClass(rune))
    expect(row.effectiveValue).toBe(getRuneEffectiveValue(rune.statValue, rune.level))
    expect(row.stat).toBe(RUNE_TYPE_TO_STAT.health) // maxHp
    expect(row.experience).toEqual(getRuneExperienceProgress(rune))
  })

  it('已镶嵌 Rune：binding 指向装备 slot 与孔位（由 topology 派生，非 Rune 自带字段）', () => {
    const inventory = [makeRune('r1'), makeRune('r2')]
    const equipment = { [SLOT_A]: makeRuneEquip('w1', SLOT_A, { runeSlots: slotsWith(null, 'r2', null) }) }
    const view = buildRuneInventoryView(inventory, equipment)
    expect(view.ok).toBe(true)
    if (!view.ok) throw new Error('expected ok')
    expect(view.rows[0].binding).toBeNull()
    expect(view.rows[1].binding).toEqual({ equipmentSlot: SLOT_A, runeSlotIndex: 1 })
  })

  it('拓扑变化后重建视图立即反映新位置（移动 + 覆盖后旧 Rune 回未镶嵌）', () => {
    const inventory = [makeRune('r1'), makeRune('r2')]
    const eqA = makeRuneEquip('w1', SLOT_A, { runeSlots: slotsWith('r1') })
    const view1 = buildRuneInventoryView(inventory, { [SLOT_A]: eqA })
    if (!view1.ok) throw new Error('expected ok')
    expect(view1.rows[0].binding).toEqual({ equipmentSlot: SLOT_A, runeSlotIndex: 0 })

    // r2 覆盖同一孔位 → r1 未镶嵌
    const eqA2 = makeRuneEquip('w1', SLOT_A, { runeSlots: slotsWith('r2') })
    const view2 = buildRuneInventoryView(inventory, { [SLOT_A]: eqA2 })
    if (!view2.ok) throw new Error('expected ok')
    expect(view2.rows[0].binding).toBeNull()
    expect(view2.rows[1].binding).toEqual({ equipmentSlot: SLOT_A, runeSlotIndex: 0 })
  })

  it('不修改输入、不调用 RNG、不写盘', () => {
    const inventory = [makeRune('r1'), makeRune('r2', { rarity: 'rare' })]
    const equipment = { [SLOT_A]: makeRuneEquip('w1', SLOT_A, { runeSlots: slotsWith('r1') }) }
    const invSnapshot = JSON.stringify(inventory)
    const eqSnapshot = JSON.stringify(equipment)
    const rngSpy = vi.spyOn(Math, 'random')
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')

    const view = buildRuneInventoryView(inventory, equipment)
    expect(view.ok).toBe(true)
    if (!view.ok) throw new Error('expected ok')
    filterRuneRows(view.rows, { type: 'all', rarity: 'rare', status: 'all', lock: 'all' })
    sortRuneRows(view.rows, 'rarity')
    summarizeRuneRows(view.rows)

    expect(JSON.stringify(inventory)).toBe(invSnapshot)
    expect(JSON.stringify(equipment)).toBe(eqSnapshot)
    expect(rngSpy).not.toHaveBeenCalled()
    expect(setItemSpy).not.toHaveBeenCalled()
  })
})

// ============================================================================
// B. fail-closed
// ============================================================================
describe('Phase 3.10 — buildRuneInventoryView fail-closed', () => {
  it('inventory 重复 canonical ID → ok:false', () => {
    const view = buildRuneInventoryView([makeRune('r1'), makeRune('r1', { type: 'defense' })], {})
    expect(view.ok).toBe(false)
  })

  it('inventory 非数组 / null / 含损坏 Rune → ok:false 且不抛', () => {
    for (const bad of [null, undefined, {}, 'x', 42, [makeRune('r1'), { id: 'r2' }]]) {
      expect(() => buildRuneInventoryView(bad, {})).not.toThrow()
      expect(buildRuneInventoryView(bad, {}).ok).toBe(false)
    }
  })

  it('悬空引用（装备指向不存在的 Rune）→ ok:false，不隐藏损坏项继续展示', () => {
    const equipment = { [SLOT_A]: makeRuneEquip('w1', SLOT_A, { runeSlots: slotsWith('ghost') }) }
    const view = buildRuneInventoryView([makeRune('r1')], equipment)
    expect(view.ok).toBe(false)
  })

  it('同装备两孔引用同一 Rune → ok:false', () => {
    const equipment = { [SLOT_A]: makeRuneEquip('w1', SLOT_A, { runeSlots: slotsWith('r1', 'r1') }) }
    expect(buildRuneInventoryView([makeRune('r1')], equipment).ok).toBe(false)
  })

  it('跨装备重复引用同一 Rune → ok:false', () => {
    const equipment = {
      [SLOT_A]: makeRuneEquip('w1', SLOT_A, { runeSlots: slotsWith('r1') }),
      [SLOT_B]: makeRuneEquip('a1', SLOT_B, { runeSlots: slotsWith(null, 'r1') })
    }
    expect(buildRuneInventoryView([makeRune('r1')], equipment).ok).toBe(false)
  })

  it('装备三孔损坏（长度≠3）→ ok:false', () => {
    const eq = makeRuneEquip('w1', SLOT_A)
    eq.runeSlots = [{ index: 0, runeId: null }, { index: 1, runeId: null }]
    expect(buildRuneInventoryView([makeRune('r1')], { [SLOT_A]: eq }).ok).toBe(false)
  })

  it('Rune 进度非法（非满级 exp ≥ 阈值）→ ok:false', () => {
    // level 1 阈值 = 22，exp = 22 为非 canonical 损坏态
    const broken = makeRune('r1', { level: 1, exp: 22 })
    expect(buildRuneInventoryView([broken], {}).ok).toBe(false)
  })

  it('inventory 为抛异常 Proxy / 装备为抛异常 Proxy → ok:false 且不抛', () => {
    const trapArray = new Proxy([], {
      get() {
        throw new Error('trap')
      }
    })
    expect(() => buildRuneInventoryView(trapArray, {})).not.toThrow()
    expect(buildRuneInventoryView(trapArray, {}).ok).toBe(false)

    const trapEquipment = new Proxy({}, {
      get() {
        throw new Error('trap')
      },
      ownKeys() {
        throw new Error('trap')
      }
    })
    expect(() => buildRuneInventoryView([makeRune('r1')], trapEquipment)).not.toThrow()
    expect(buildRuneInventoryView([makeRune('r1')], trapEquipment).ok).toBe(false)
  })

  it('装备字段 getter 抛异常 → ok:false 且不抛、不修改合法输入', () => {
    const inventory = [makeRune('r1')]
    const snapshot = JSON.stringify(inventory)
    const evilEq = {
      ...makeRuneEquip('w1', SLOT_A),
      get runeSlots(): RuneSlot[] {
        throw new Error('getter trap')
      }
    }
    expect(() => buildRuneInventoryView(inventory, { [SLOT_A]: evilEq })).not.toThrow()
    expect(buildRuneInventoryView(inventory, { [SLOT_A]: evilEq }).ok).toBe(false)
    expect(JSON.stringify(inventory)).toBe(snapshot)
  })
})

// ============================================================================
// C. 筛选 / 排序 / 摘要
// ============================================================================
describe('Phase 3.10 — filterRuneRows / sortRuneRows / summarizeRuneRows', () => {
  function buildRows(): RuneInventoryRow[] {
    const inventory = [
      makeRune('r0', { type: 'attack', rarity: 'common', level: 1, statValue: 10 }), // eff 10
      makeRune('r1', { type: 'defense', rarity: 'epic', level: 1, statValue: 20 }), // eff 20
      makeRune('r2', { type: 'attack', rarity: 'common', level: 5, statValue: 10 }), // eff 12
      makeRune('r3', { type: 'luck', rarity: 'epic', level: 1, statValue: 20 }) // eff 20（与 r1 全同级并列）
    ]
    const equipment = { [SLOT_A]: makeRuneEquip('w1', SLOT_A, { runeSlots: slotsWith('r0') }) }
    const view = buildRuneInventoryView(inventory, equipment)
    if (!view.ok) throw new Error('expected ok')
    return view.rows
  }

  it('type / rarity / status 三维筛选正确，返回新数组且不修改输入', () => {
    const rows = buildRows()
    const before = rows.map(r => r.rune.id)

    expect(filterRuneRows(rows, { type: 'attack', rarity: 'all', status: 'all', lock: 'all' }).map(r => r.rune.id)).toEqual(['r0', 'r2'])
    expect(filterRuneRows(rows, { type: 'all', rarity: 'epic', status: 'all', lock: 'all' }).map(r => r.rune.id)).toEqual(['r1', 'r3'])
    expect(filterRuneRows(rows, { type: 'all', rarity: 'all', status: 'embedded', lock: 'all' }).map(r => r.rune.id)).toEqual(['r0'])
    expect(filterRuneRows(rows, { type: 'all', rarity: 'all', status: 'unequipped', lock: 'all' }).map(r => r.rune.id)).toEqual(['r1', 'r2', 'r3'])
    expect(rows.map(r => r.rune.id)).toEqual(before)
  })

  it('筛选空结果是合法空集合，不是错误', () => {
    const rows = buildRows()
    const empty = filterRuneRows(rows, { type: 'speed', rarity: 'all', status: 'all', lock: 'all' })
    expect(empty).toEqual([])
  })

  it('inventory 排序保持仓库顺序；rarity/level/effective 排序 tie-breaker 严格 = inventoryIndex', () => {
    const rows = buildRows()

    expect(sortRuneRows(rows, 'inventory').map(r => r.rune.id)).toEqual(['r0', 'r1', 'r2', 'r3'])
    // rarity：epic 优先，epic 并列按 inventoryIndex（r1 在 r3 前）
    expect(sortRuneRows(rows, 'rarity').map(r => r.rune.id)).toEqual(['r1', 'r3', 'r0', 'r2'])
    // level：5 级优先；1 级中 epic 优先且并列按 inventoryIndex
    expect(sortRuneRows(rows, 'level').map(r => r.rune.id)).toEqual(['r2', 'r1', 'r3', 'r0'])
    // effective：20/20 并列（同 level）→ inventoryIndex；再 12、10
    expect(sortRuneRows(rows, 'effective').map(r => r.rune.id)).toEqual(['r1', 'r3', 'r2', 'r0'])
  })

  it('排序确定性：重复调用结果完全一致，且不修改输入数组', () => {
    const rows = buildRows()
    const before = rows.map(r => r.rune.id)
    const s1 = sortRuneRows(rows, 'rarity').map(r => r.rune.id)
    const s2 = sortRuneRows(rows, 'rarity').map(r => r.rune.id)
    expect(s1).toEqual(s2)
    expect(rows.map(r => r.rune.id)).toEqual(before)
    expect(sortRuneRows(rows, 'rarity')).not.toBe(rows)
  })

  it('summarizeRuneRows 统计来自同一份合法 rows', () => {
    const rows = buildRows()
    expect(summarizeRuneRows(rows)).toEqual({
      total: 4,
      embedded: 1,
      unequipped: 3,
      locked: 0,
      unlocked: 4,
      byRarity: { common: 2, rare: 0, epic: 2, legend: 0 }
    })
    expect(summarizeRuneRows([])).toEqual({
      total: 0,
      embedded: 0,
      unequipped: 0,
      locked: 0,
      unlocked: 0,
      byRarity: { common: 0, rare: 0, epic: 0, legend: 0 }
    })
  })
})

// ============================================================================
// D. UI 集成
// ============================================================================
describe('Phase 3.10 — RuneInventoryTab UI 集成', () => {
  it('空仓库显示「尚未获得符文」空状态', () => {
    const wrapper = mount(RuneInventoryTab)
    expect(wrapper.text()).toContain('尚未获得符文')
    expect(wrapper.text()).toContain('总数 0')
  })

  it('卡片展示：名称 / 等级 / 基础值 / 当前有效值 / 经验 / 未镶嵌状态', () => {
    const playerStore = usePlayerStore()
    playerStore.runeInventory = [makeRune('r1', { type: 'attack', rarity: 'epic', level: 5, statValue: 20 })]
    const wrapper = mount(RuneInventoryTab)
    expect(wrapper.text()).toContain('史诗攻击符文')
    expect(wrapper.text()).toContain('Lv.5')
    expect(wrapper.text()).toContain('基础 攻击力 +20')
    expect(wrapper.text()).toContain(`当前 攻击力 +${getRuneEffectiveValue(20, 5)}`) // 24
    expect(wrapper.text()).toContain('未镶嵌')
    expect(wrapper.find('.rune-card').attributes('data-rarity')).toBe('epic')
  })

  it('已镶嵌卡片显示装备位置与孔位，并渲染「移除」按钮', () => {
    const playerStore = usePlayerStore()
    playerStore.runeInventory = [makeRune('r1')]
    playerStore.player.equipment[SLOT_A] = makeRuneEquip('w1', SLOT_A, { runeSlots: slotsWith(null, 'r1') })
    const wrapper = mount(RuneInventoryTab)
    expect(wrapper.text()).toContain(`已镶嵌：${EQUIPMENT_SLOT_NAMES[SLOT_A]} · 孔位 2`)
    expect(findByAriaPrefix(wrapper, '移除 ')).not.toBeNull()
    expect(findByAriaPrefix(wrapper, '镶嵌或移动 ')!.text()).toContain('移动')
  })

  it('筛选无匹配显示「无匹配筛选结果」，切换筛选/排序不写盘', async () => {
    const playerStore = usePlayerStore()
    playerStore.runeInventory = [makeRune('r1', { type: 'attack' })]
    const wrapper = mount(RuneInventoryTab)
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')

    await wrapper.find('select[aria-label="按类型筛选"]').setValue('luck')
    expect(wrapper.text()).toContain('无匹配筛选结果')
    await wrapper.find('select[aria-label="排序方式"]').setValue('rarity')
    await wrapper.find('select[aria-label="按类型筛选"]').setValue('attack')
    expect(wrapper.text()).toContain('普通攻击符文')
    expect(setItemSpy).not.toHaveBeenCalled()
  })

  it('未镶嵌 Rune → 打开目标选择 → 镶嵌到空孔成功：拓扑更新、成功反馈、写盘', async () => {
    const playerStore = usePlayerStore()
    playerStore.runeInventory = [makeRune('r1')]
    playerStore.player.equipment[SLOT_A] = makeRuneEquip('w1', SLOT_A)
    const wrapper = mount(RuneInventoryTab)

    await findByAriaPrefix(wrapper, '镶嵌或移动 ')!.trigger('click')
    expect(wrapper.find('.picker').exists()).toBe(true)

    await findByAriaPrefix(wrapper, `镶嵌到 ${EQUIPMENT_SLOT_NAMES[SLOT_A]} 孔位 1`)!.trigger('click')
    expect(playerStore.player.equipment[SLOT_A]!.runeSlots[0].runeId).toBe('r1')
    expect(wrapper.text()).toContain('已镶嵌：普通攻击符文')
    expect(wrapper.find('.picker').exists()).toBe(false) // 成功后关闭
    const disk = JSON.parse(localStorage.getItem(SAVE_KEY)!)
    expect(JSON.stringify(disk)).toContain('r1')
  })

  it('移动到另一件装备：原位置清空，目标位置生效（原子移动）', async () => {
    const playerStore = usePlayerStore()
    playerStore.runeInventory = [makeRune('r1')]
    playerStore.player.equipment[SLOT_A] = makeRuneEquip('w1', SLOT_A, { runeSlots: slotsWith('r1') })
    playerStore.player.equipment[SLOT_B] = makeRuneEquip('a1', SLOT_B)
    const wrapper = mount(RuneInventoryTab)

    await findByAriaPrefix(wrapper, '镶嵌或移动 ')!.trigger('click')
    await findByAriaPrefix(wrapper, `镶嵌到 ${EQUIPMENT_SLOT_NAMES[SLOT_B]} 孔位 1`)!.trigger('click')

    expect(playerStore.player.equipment[SLOT_A]!.runeSlots[0].runeId).toBeNull()
    expect(playerStore.player.equipment[SLOT_B]!.runeSlots[0].runeId).toBe('r1')
    expect(wrapper.text()).toContain(`已镶嵌：${EQUIPMENT_SLOT_NAMES[SLOT_B]} · 孔位 1`)
  })

  it('镶嵌到被占用孔位：新 Rune 生效、旧 Rune 回到未镶嵌', async () => {
    const playerStore = usePlayerStore()
    playerStore.runeInventory = [makeRune('r1'), makeRune('r2', { type: 'defense' })]
    playerStore.player.equipment[SLOT_A] = makeRuneEquip('w1', SLOT_A, { runeSlots: slotsWith('r1') })
    const wrapper = mount(RuneInventoryTab)

    // r2 是未镶嵌行（按钮文本「镶嵌」）
    const embedBtn = findByAriaPrefix(wrapper, '镶嵌或移动 普通防御符文')
    expect(embedBtn).not.toBeNull()
    await embedBtn!.trigger('click')
    await findByAriaPrefix(wrapper, `镶嵌到 ${EQUIPMENT_SLOT_NAMES[SLOT_A]} 孔位 1`)!.trigger('click')

    expect(playerStore.player.equipment[SLOT_A]!.runeSlots[0].runeId).toBe('r2')
    const view = buildRuneInventoryView(playerStore.runeInventory, playerStore.player.equipment)
    if (!view.ok) throw new Error('expected ok')
    expect(view.rows[0].binding).toBeNull() // r1 回未镶嵌
    expect(view.rows[1].binding).toEqual({ equipmentSlot: SLOT_A, runeSlotIndex: 0 })
  })

  it('移除成功：装备孔位清空、Rune 仍在仓库、成功反馈', async () => {
    const playerStore = usePlayerStore()
    playerStore.runeInventory = [makeRune('r1')]
    playerStore.player.equipment[SLOT_A] = makeRuneEquip('w1', SLOT_A, { runeSlots: slotsWith('r1') })
    const wrapper = mount(RuneInventoryTab)

    await findByAriaPrefix(wrapper, '移除 ')!.trigger('click')
    expect(playerStore.player.equipment[SLOT_A]!.runeSlots[0].runeId).toBeNull()
    expect(playerStore.runeInventory).toHaveLength(1)
    expect(wrapper.text()).toContain('已移除：普通攻击符文')
    expect(wrapper.text()).toContain('未镶嵌')
  })

  it('重载持久化：保存 → 新 Pinia loadGame → 拓扑与仓库还原，UI 展示一致', () => {
    const playerStore = usePlayerStore()
    playerStore.runeInventory = [makeRune('r1'), makeRune('r2', { type: 'luck' })]
    playerStore.player.equipment[SLOT_A] = makeRuneEquip('w1', SLOT_A, { runeSlots: slotsWith(null, null, 'r1') })
    expect(playerStore.saveGame()).toBe(true)

    setActivePinia(createPinia())
    warmupStores()
    const fresh = usePlayerStore()
    fresh.loadGame()
    expect(fresh.runeInventory.map(r => r.id)).toEqual(['r1', 'r2'])
    expect(fresh.player.equipment[SLOT_A]?.runeSlots[2].runeId).toBe('r1')

    const wrapper = mount(RuneInventoryTab)
    expect(wrapper.text()).toContain(`已镶嵌：${EQUIPMENT_SLOT_NAMES[SLOT_A]} · 孔位 3`)
    expect(wrapper.text()).toContain('总数 2')
    expect(wrapper.text()).toContain('已镶嵌 1')
  })
})

// ============================================================================
// E. 事务失败 UI
// ============================================================================
describe('Phase 3.10 — 事务失败时的 UI 语义（绝不显示成功）', () => {
  it('saveGame 写盘失败：镶嵌事务回滚，UI 显示失败、picker 不关闭、拓扑不变', async () => {
    const playerStore = usePlayerStore()
    playerStore.runeInventory = [makeRune('r1')]
    playerStore.player.equipment[SLOT_A] = makeRuneEquip('w1', SLOT_A)
    const wrapper = mount(RuneInventoryTab)

    installThrowingStorage()
    await findByAriaPrefix(wrapper, '镶嵌或移动 ')!.trigger('click')
    await findByAriaPrefix(wrapper, `镶嵌到 ${EQUIPMENT_SLOT_NAMES[SLOT_A]} 孔位 1`)!.trigger('click')

    expect(playerStore.player.equipment[SLOT_A]!.runeSlots[0].runeId).toBeNull() // 回滚
    expect(wrapper.text()).toContain('镶嵌失败')
    expect(wrapper.text()).not.toContain('已镶嵌：普通攻击符文')
    expect(wrapper.find('.picker').exists()).toBe(true) // 失败不关闭
    expect(wrapper.find('.feedback.success').exists()).toBe(false)
  })

  it('事务返回 ok:false：显示失败原因，不显示成功', async () => {
    const playerStore = usePlayerStore()
    playerStore.runeInventory = [makeRune('r1')]
    playerStore.player.equipment[SLOT_A] = makeRuneEquip('w1', SLOT_A)
    vi.spyOn(playerStore, 'tryEmbedEquipmentRune').mockReturnValue({ ok: false, reason: 'mock rejected' })
    const wrapper = mount(RuneInventoryTab)

    await findByAriaPrefix(wrapper, '镶嵌或移动 ')!.trigger('click')
    await findByAriaPrefix(wrapper, `镶嵌到 ${EQUIPMENT_SLOT_NAMES[SLOT_A]} 孔位 1`)!.trigger('click')

    expect(wrapper.text()).toContain('镶嵌失败：mock rejected')
    expect(wrapper.find('.feedback.success').exists()).toBe(false)
    expect(playerStore.player.equipment[SLOT_A]!.runeSlots[0].runeId).toBeNull()
  })

  it('事务抛异常：组件不崩溃，显示失败反馈', async () => {
    const playerStore = usePlayerStore()
    playerStore.runeInventory = [makeRune('r1')]
    playerStore.player.equipment[SLOT_A] = makeRuneEquip('w1', SLOT_A)
    vi.spyOn(playerStore, 'tryEmbedEquipmentRune').mockImplementation(() => {
      throw new Error('boom')
    })
    const wrapper = mount(RuneInventoryTab)

    await findByAriaPrefix(wrapper, '镶嵌或移动 ')!.trigger('click')
    await findByAriaPrefix(wrapper, `镶嵌到 ${EQUIPMENT_SLOT_NAMES[SLOT_A]} 孔位 1`)!.trigger('click')

    expect(wrapper.text()).toContain('镶嵌操作失败')
    expect(wrapper.find('.feedback.success').exists()).toBe(false)
  })

  it('移除失败（ok:false / 抛异常）：不崩溃且不显示成功', async () => {
    const playerStore = usePlayerStore()
    playerStore.runeInventory = [makeRune('r1')]
    playerStore.player.equipment[SLOT_A] = makeRuneEquip('w1', SLOT_A, { runeSlots: slotsWith('r1') })
    const spy = vi.spyOn(playerStore, 'tryRemoveEquipmentRune').mockReturnValue({ ok: false, reason: 'mock rejected' })
    const wrapper = mount(RuneInventoryTab)

    await findByAriaPrefix(wrapper, '移除 ')!.trigger('click')
    expect(wrapper.text()).toContain('移除失败：mock rejected')
    expect(wrapper.find('.feedback.success').exists()).toBe(false)

    spy.mockImplementation(() => {
      throw new Error('boom')
    })
    await findByAriaPrefix(wrapper, '移除 ')!.trigger('click')
    expect(wrapper.text()).toContain('移除操作失败')
    expect(wrapper.find('.feedback.success').exists()).toBe(false)
  })

  it('非法目标（无装备的 slot / 越界孔位）事务拒绝，视图保持合法', () => {
    const playerStore = usePlayerStore()
    playerStore.runeInventory = [makeRune('r1')]
    playerStore.player.equipment[SLOT_A] = makeRuneEquip('w1', SLOT_A)

    expect(playerStore.tryEmbedEquipmentRune(SLOT_B, 0, 'r1').ok).toBe(false) // 目标装备缺失
    expect(playerStore.tryEmbedEquipmentRune(SLOT_A, 5, 'r1').ok).toBe(false) // 孔位越界
    expect(playerStore.tryEmbedEquipmentRune(SLOT_A, 0, 'nope').ok).toBe(false) // Rune 不存在

    expect(playerStore.player.equipment[SLOT_A]!.runeSlots.every(s => s.runeId === null)).toBe(true)
    expect(buildRuneInventoryView(playerStore.runeInventory, playerStore.player.equipment).ok).toBe(true)
  })

  it('损坏拓扑（悬空引用）：显示异常横幅，隐藏管理入口，不崩溃、不写盘、不自动 reconcile', () => {
    const playerStore = usePlayerStore()
    playerStore.runeInventory = [makeRune('r1')]
    playerStore.player.equipment[SLOT_A] = makeRuneEquip('w1', SLOT_A, { runeSlots: slotsWith('ghost') })
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    const wrapper = mount(RuneInventoryTab)

    expect(wrapper.find('.broken-banner').exists()).toBe(true)
    expect(wrapper.text()).toContain('符文数据或装备拓扑异常')
    expect(findByAriaPrefix(wrapper, '镶嵌或移动 ')).toBeNull()
    expect(findByAriaPrefix(wrapper, '移除 ')).toBeNull()
    // 不自动修复：悬空引用原样保留
    expect(playerStore.player.equipment[SLOT_A]!.runeSlots[0].runeId).toBe('ghost')
    expect(setItemSpy).not.toHaveBeenCalled()
  })
})

// ============================================================================
// F. 导航回归
// ============================================================================
describe('Phase 3.10 — 导航配置与回归', () => {
  it('runes 属于 build 二级页且 minDifficulty=0（普通主线怪从难度 0 起即可掉落）', () => {
    const buildPages = SECONDARY_PAGES.build.map(p => p.id)
    expect(buildPages).toContain('runes')
    expect(buildPages.indexOf('runes')).toBe(buildPages.indexOf('equipment') + 1)
    const runesPage = SECONDARY_PAGES.build.find(p => p.id === 'runes')!
    expect(runesPage.minDifficulty).toBe(0)
    expect(MAINLINE_UNLOCK_STAGES[0].systems).toContain('runes')
  })

  it('难度 0 即可导航到 build/runes；既有解锁序列不回退', () => {
    const nav = useNavigationStore()
    nav.selectPrimary('build')
    expect(nav.secondaryPages.map(p => p.id)).toContain('runes')
    nav.selectSecondary('runes')
    expect(nav.route.primary).toBe('build')
    expect(nav.route.secondary).toBe('runes')
  })

  it('难度 20 build 二级页顺序为 equipment/runes/skills/bonus（回归既有解锁）', () => {
    const monsterStore = useMonsterStore()
    monsterStore.setProgress(20, 1)
    const nav = useNavigationStore()
    nav.selectPrimary('build')
    expect(nav.secondaryPages.map(p => p.id)).toEqual(['equipment', 'runes', 'skills', 'bonus'])
  })
})

// ============================================================================
// G. Phase 3.10.1 — canonical 目标快照（P1-A：raw ID 与 canonical ID 不同）
// ============================================================================
describe('Phase 3.10.1 — canonical 目标快照（P1-A raw ID vs canonical ID）', () => {
  it('raw inventory ID 带空格、canonical 一致：row/binding/targets 全部使用 canonical ID', () => {
    const inventory = [makeRune(' r1 ')] // raw 带前导/后置空格
    const equipment = { [SLOT_A]: makeRuneEquip('w1', SLOT_A, { runeSlots: slotsWith('r1') }) }
    const view = buildRuneInventoryView(inventory, equipment)
    expect(view.ok).toBe(true)
    if (!view.ok) throw new Error('expected ok')
    expect(view.rows).toHaveLength(1)
    expect(view.rows[0].rune.id).toBe('r1') // canonical（trim 后）
    expect(view.rows[0].binding).toEqual({ equipmentSlot: SLOT_A, runeSlotIndex: 0 })
    const weaponTarget = view.targets.find(t => t.equipmentSlot === SLOT_A)!
    expect(weaponTarget.slots).toHaveLength(3) // 固定 3 孔
    expect(weaponTarget.slots[0].currentRuneId).toBe('r1') // canonical ID
    expect(weaponTarget.slots[0].currentRuneDisplayName).toBe(getRuneDisplayName(view.rows[0].rune))
  })

  it('UI：raw ID 已占用孔在 picker 中显示当前 Rune 名，不显示「空」', async () => {
    const playerStore = usePlayerStore()
    playerStore.runeInventory = [makeRune(' r1 ')]
    playerStore.player.equipment[SLOT_A] = makeRuneEquip('w1', SLOT_A, { runeSlots: slotsWith('r1') })
    const wrapper = mount(RuneInventoryTab)
    expect(wrapper.text()).toContain('已镶嵌')

    await findByAriaPrefix(wrapper, '镶嵌或移动 ')!.trigger('click')
    expect(wrapper.find('.picker').exists()).toBe(true)
    const slotBtn = findByAriaPrefix(wrapper, `镶嵌到 ${EQUIPMENT_SLOT_NAMES[SLOT_A]} 孔位 1`)
    expect(slotBtn).not.toBeNull()
    expect(slotBtn!.text()).toContain('普通攻击符文')
    expect(slotBtn!.text()).not.toContain('（空）')
  })

  it('UI：用另一枚 Rune 覆盖 raw-ID 已占用孔 → 事务执行一次、旧回未镶嵌、新占目标、raw 字段不被改写', async () => {
    const playerStore = usePlayerStore()
    playerStore.runeInventory = [makeRune(' r1 '), makeRune('r2', { type: 'defense' })]
    playerStore.player.equipment[SLOT_A] = makeRuneEquip('w1', SLOT_A, { runeSlots: slotsWith('r1') })
    const spy = vi.spyOn(playerStore, 'tryEmbedEquipmentRune')
    const wrapper = mount(RuneInventoryTab)

    const embedBtn = findByAriaPrefix(wrapper, '镶嵌或移动 普通防御符文')
    expect(embedBtn).not.toBeNull()
    await embedBtn!.trigger('click')
    await findByAriaPrefix(wrapper, `镶嵌到 ${EQUIPMENT_SLOT_NAMES[SLOT_A]} 孔位 1`)!.trigger('click')

    expect(spy).toHaveBeenCalledTimes(1) // 仅一次事务
    expect(playerStore.player.equipment[SLOT_A]!.runeSlots[0].runeId).toBe('r2') // 新 Rune 占用
    expect(playerStore.runeInventory[0].id).toBe(' r1 ') // raw 字段与顺序不被 UI 改写
    const view = buildRuneInventoryView(playerStore.runeInventory, playerStore.player.equipment)
    if (!view.ok) throw new Error('expected ok')
    expect(view.rows[0].binding).toBeNull() // 旧 r1 回未镶嵌
    expect(view.rows[1].binding).toEqual({ equipmentSlot: SLOT_A, runeSlotIndex: 0 })
  })
})

// ============================================================================
// H. Phase 3.10.1 — 组件不绕过纯视图边界（P1-B / TOCTOU getter）
// ============================================================================
describe('Phase 3.10.1 — 组件不绕过纯视图边界（P1-B / TOCTOU getter）', () => {
  function weaponToggleProxy(weaponA: Equipment, weaponB: Equipment | null, switchAfter = 3) {
    let reads = 0
    return new Proxy({} as Record<string, Equipment | undefined>, {
      get(_t, prop) {
        if (prop === SLOT_A) {
          reads++
          // 拓扑阶段对 equipmentBySlot[slot] 读两次（校验循环 + scanRuneReferences），
          // 第 3 次才是 targets 快照读取——此时才切换/抛，确保拓扑一致、targets 不一致。
          if (reads < switchAfter) return weaponA
          if (weaponB === null) throw new Error('TOCTOU second-read throw')
          return weaponB
        }
        return undefined
      }
    })
  }

  it('拓扑校验通过、目标快照读取抛异常 → 纯视图不抛、返回 ok:false', () => {
    const inventory = [makeRune('r1')]
    const proxy = weaponToggleProxy(makeRuneEquip('w1', SLOT_A), null) // 第二次读取抛
    expect(() => buildRuneInventoryView(inventory, proxy)).not.toThrow()
    expect(buildRuneInventoryView(inventory, proxy).ok).toBe(false)
  })

  it('第二次读取返回另一份仍合法但孔位不同的装备 → 引用不一致 fail-closed（ok:false）', () => {
    const inventory = [makeRune('r1')]
    const weaponA = makeRuneEquip('w1', SLOT_A, { runeSlots: slotsWith('r1') }) // slot0
    const weaponB = makeRuneEquip('w1', SLOT_A, { runeSlots: slotsWith(null, 'r1', null) }) // slot1
    const proxy = weaponToggleProxy(weaponA, weaponB)
    expect(buildRuneInventoryView(inventory, proxy).ok).toBe(false)
  })

  it('组件挂载（时变 getter 抛）→ 不崩溃、显示损坏横幅、不打开 picker、无管理按钮', () => {
    const playerStore = usePlayerStore()
    playerStore.runeInventory = [makeRune('r1')]
    let reads = 0
    playerStore.player.equipment = new Proxy(
      {} as Record<string, Equipment | undefined>,
      {
        get(_t, prop) {
          if (prop === SLOT_A) {
            reads++
            if (reads === 1) return makeRuneEquip('w1', SLOT_A) // 拓扑通过
            throw new Error('TOCTOU second-read throw') // picker 快照读取抛
          }
          return undefined
        }
      }
    ) as unknown as Partial<Record<EquipmentSlot, Equipment>>
    const wrapper = mount(RuneInventoryTab)
    expect(wrapper.find('.broken-banner').exists()).toBe(true)
    expect(wrapper.text()).toContain('符文数据或装备拓扑异常')
    expect(wrapper.find('.picker').exists()).toBe(false)
    expect(findByAriaPrefix(wrapper, '镶嵌或移动 ')).toBeNull()
    expect(findByAriaPrefix(wrapper, '移除 ')).toBeNull()
  })
})

// ============================================================================
// I. Phase 3.10.1 — raw inventory 二次读取防线（P1-B / section 12）
// ============================================================================
describe('Phase 3.10.1 — raw inventory 二次读取防线（组件只消费 view.targets）', () => {
  it('组件打开 picker 不二次迭代 raw inventory，目标 Rune 名正确', async () => {
    const baseInventory = [makeRune('r1')]
    let armed = false
    let threwDuringPicker = false
    const invProxy = new Proxy(baseInventory, {
      get(t, p, r) {
        if (p === Symbol.iterator && armed) {
          threwDuringPicker = true
          throw new Error('raw inventory iterated after mount (component bypassed view)')
        }
        return Reflect.get(t, p, r)
      }
    })
    const playerStore = usePlayerStore()
    playerStore.runeInventory = invProxy
    playerStore.player.equipment[SLOT_A] = makeRuneEquip('w1', SLOT_A, { runeSlots: slotsWith('r1') })
    const wrapper = mount(RuneInventoryTab)

    armed = true // 挂载完成后才武装：模拟 picker 打开期间若再次迭代 raw inventory 即失败
    await findByAriaPrefix(wrapper, '镶嵌或移动 ')!.trigger('click')
    expect(threwDuringPicker).toBe(false) // 组件未重新迭代 raw inventory
    expect(wrapper.find('.picker').exists()).toBe(true)
    expect(wrapper.text()).toContain('普通攻击符文')
  })
})

// ============================================================================
// J. Phase 3.10.1 — Rune 标签单一来源（P2）
// ============================================================================
describe('Phase 3.10.1 — Rune 标签单一来源（P2）', () => {
  it('row.rarityLabel 由权威 getRuneRarityLabel 生成，与展示一致', () => {
    const inventory = [
      makeRune('r1', { rarity: 'common' }),
      makeRune('r2', { rarity: 'legend' }),
      makeRune('r3', { rarity: 'epic' })
    ]
    const view = buildRuneInventoryView(inventory, {})
    if (!view.ok) throw new Error('expected ok')
    for (const row of view.rows) {
      expect(row.rarityLabel).toBe(getRuneRarityLabel(row.rune))
    }
    expect(view.rows.map(r => r.rarityLabel)).toEqual(['普通', '传说', '史诗'])
  })

  it('UI 卡片 rarity 来自 row.rarityLabel（不直接引用第二套映射）', () => {
    const playerStore = usePlayerStore()
    playerStore.runeInventory = [makeRune('r1', { rarity: 'legend', type: 'luck' })]
    const wrapper = mount(RuneInventoryTab)
    expect(wrapper.text()).toContain('传说')
    expect(wrapper.find('.rune-rarity').text()).toBe('传说')
  })

  it('UI 卡片属性名使用 STAT_NAMES[row.stat]（攻击符文显示「攻击力」而非第二套 TYPE_LABELS 的「攻击」）', () => {
    const playerStore = usePlayerStore()
    playerStore.runeInventory = [makeRune('r1', { type: 'attack', rarity: 'common', statValue: 10 })]
    const wrapper = mount(RuneInventoryTab)
    expect(wrapper.text()).toContain('属性：攻击力')
    expect(wrapper.text()).toContain('基础 攻击力 +10')
    // 第二套 TYPE_LABELS 会渲染「属性：攻击」（无「力」）；单一来源 STAT_NAMES 渲染「属性：攻击力」。
    // 负向前瞻确保「属性：攻击」之后必为「力」，不会单独出现旧标签。
    expect(wrapper.text()).not.toMatch(/属性：攻击(?!力)/)
  })
})

// ============================================================================
// K. Phase 3.10.2 — raw inventory 单次 canonical 快照（P1）+ picker 失效自动关闭（P2）
// ============================================================================
describe('Phase 3.10.2 — raw inventory 单次 canonical 快照（P1）', () => {
  it('raw inventory 仅在 validateRuneInventory 读取/校验一次（时变 Proxy 不混用两次状态）', () => {
    const r1 = makeRune('r1')
    let indexReads = 0
    const raw = new Proxy([r1], {
      get(target, prop, receiver) {
        if (prop === '0') {
          indexReads++
          if (indexReads > 1) throw new Error('raw inventory read twice')
        }
        return Reflect.get(target, prop, receiver)
      }
    })
    const view = buildRuneInventoryView(raw, {})
    expect(view.ok).toBe(true)
    expect(indexReads).toBe(1) // 只读取一次：拓扑校验复用 inv.inventory 快照
    if (!view.ok) throw new Error('expected ok')
    expect(view.rows).toHaveLength(1)
    expect(view.rows[0].rune.id).toBe('r1')
  })

  it('时变 Proxy 第二次读取返回另一枚合法 Rune → 仍只读取一次，rows 仅含 canonical r1、不得混用 r2', () => {
    const r1 = makeRune('r1')
    const r2 = makeRune('r2', { type: 'defense' })
    let indexReads = 0
    const raw = new Proxy([r1], {
      get(target, prop, receiver) {
        if (prop === '0') {
          indexReads++
          if (indexReads > 1) return r2 // 第二次读取（不得发生）返回不同 Rune
        }
        return Reflect.get(target, prop, receiver)
      }
    })
    const view = buildRuneInventoryView(raw, {})
    expect(view.ok).toBe(true)
    expect(indexReads).toBe(1)
    if (!view.ok) throw new Error('expected ok')
    expect(view.rows).toHaveLength(1)
    expect(view.rows[0].rune.id).toBe('r1')
    expect(view.rows[0].rune.type).toBe('attack')
  })

  it('带装备引用时 canonical snapshot topology 正确（raw inventory 仍只读取一次）', () => {
    const r1 = makeRune('r1')
    let indexReads = 0
    const raw = new Proxy([r1], {
      get(target, prop, receiver) {
        if (prop === '0') {
          indexReads++
          if (indexReads > 1) throw new Error('raw inventory read twice')
        }
        return Reflect.get(target, prop, receiver)
      }
    })
    const equipment = { [SLOT_A]: makeRuneEquip('w1', SLOT_A, { runeSlots: slotsWith('r1') }) }
    const view = buildRuneInventoryView(raw, equipment)
    expect(view.ok).toBe(true)
    expect(indexReads).toBe(1)
    if (!view.ok) throw new Error('expected ok')
    expect(view.rows[0].binding).toEqual({ equipmentSlot: SLOT_A, runeSlotIndex: 0 })
    const weaponTarget = view.targets.find(t => t.equipmentSlot === SLOT_A)!
    expect(weaponTarget.slots[0].currentRuneId).toBe('r1')
    expect(weaponTarget.slots[0].currentRuneDisplayName).toBe(getRuneDisplayName(view.rows[0].rune))
  })
})

describe('Phase 3.10.2 — picker 失效自动关闭（P2）', () => {
  it('picker 打开期间目标 Rune 从合法 inventory 消失 → picker 立即关闭、事务 0 次、空仓库状态正确', async () => {
    const playerStore = usePlayerStore()
    playerStore.runeInventory = [makeRune('r1')]
    playerStore.player.equipment[SLOT_A] = makeRuneEquip('w1', SLOT_A, { runeSlots: slotsWith('r1') })
    const spy = vi.spyOn(playerStore, 'tryEmbedEquipmentRune')
    const wrapper = mount(RuneInventoryTab)

    await findByAriaPrefix(wrapper, '镶嵌或移动 ')!.trigger('click')
    expect(wrapper.find('.picker').exists()).toBe(true)

    // 合法移除：清空装备引用 + 从 inventory 删除，保持 view.ok=true（非损坏）
    playerStore.player.equipment[SLOT_A]!.runeSlots[0].runeId = null
    playerStore.runeInventory = []
    await nextTick()

    expect(wrapper.find('.picker').exists()).toBe(false) // 立即从 DOM 消失
    expect(spy).toHaveBeenCalledTimes(0)
    expect(wrapper.find('.feedback.success').exists()).toBe(false)
    // 摘要与空仓库状态正确更新
    expect(wrapper.text()).toContain('尚未获得符文')
    expect(wrapper.text()).toContain('总数 0')
  })

  it('picker 打开期间拓扑损坏（ghost 引用）→ 显示损坏横幅、picker 自动关闭、事务 0 次、无成功反馈', async () => {
    const playerStore = usePlayerStore()
    playerStore.runeInventory = [makeRune('r1')]
    playerStore.player.equipment[SLOT_A] = makeRuneEquip('w1', SLOT_A, { runeSlots: slotsWith('r1') })
    const spy = vi.spyOn(playerStore, 'tryEmbedEquipmentRune')
    const wrapper = mount(RuneInventoryTab)

    await findByAriaPrefix(wrapper, '镶嵌或移动 ')!.trigger('click')
    expect(wrapper.find('.picker').exists()).toBe(true)

    // 改为 ghost 引用：删除 inventory 但保留装备孔引用 → 拓扑损坏
    playerStore.runeInventory = []
    await nextTick()

    expect(wrapper.find('.broken-banner').exists()).toBe(true)
    expect(wrapper.text()).toContain('符文数据或装备拓扑异常')
    expect(wrapper.find('.picker').exists()).toBe(false)
    expect(findByAriaPrefix(wrapper, '镶嵌或移动 ')).toBeNull()
    expect(spy).toHaveBeenCalledTimes(0)
    expect(wrapper.find('.feedback.success').exists()).toBe(false)
  })
})

describe('Phase 3.10.2 — picker 身份稳定性（canonical ID，不得因筛选/排序/追加漂移）', () => {
  it('打开 r2 picker 后切换排序并追加 r3 → picker 仍指向 r2、点击传给事务的 runeId 仍是 r2', async () => {
    const playerStore = usePlayerStore()
    playerStore.runeInventory = [makeRune('r1'), makeRune('r2', { type: 'defense' })]
    playerStore.player.equipment[SLOT_A] = makeRuneEquip('w1', SLOT_A) // 空孔
    const spy = vi.spyOn(playerStore, 'tryEmbedEquipmentRune').mockReturnValue({ ok: false, reason: 'mock' })
    const wrapper = mount(RuneInventoryTab)

    await findByAriaPrefix(wrapper, '镶嵌或移动 普通防御符文')!.trigger('click')
    expect(wrapper.find('.picker').exists()).toBe(true)
    expect(wrapper.text()).toContain('镶嵌目标：普通防御符文')

    await wrapper.find('select[aria-label="排序方式"]').setValue('rarity')
    playerStore.runeInventory = [...playerStore.runeInventory, makeRune('r3', { type: 'luck' })]
    await nextTick()

    expect(wrapper.find('.picker').exists()).toBe(true)
    expect(wrapper.text()).toContain('镶嵌目标：普通防御符文') // 标题仍是 r2

    await findByAriaPrefix(wrapper, `镶嵌到 ${EQUIPMENT_SLOT_NAMES[SLOT_A]} 孔位 1`)!.trigger('click')
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith(SLOT_A, 0, 'r2') // 身份未被漂移
  })
})
