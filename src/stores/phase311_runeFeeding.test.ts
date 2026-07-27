// @vitest-environment jsdom
/**
 * Phase 3.11 — Rune 单材料吞噬强化、原子消费与仓库 UI 闭环
 * Phase 3.11.1 — 吞噬事务稳定快照、拓扑一致性与完整强化预览收口
 *
 * 覆盖：
 *   A. 固定经验配置冻结（数值 / Object.freeze / 无 RNG）
 *   B. getRuneFeedExperience 矩阵（四稀有度 / 非全新 / malformed / Proxy 抛 → null）
 *   C. planRuneFeeding 纯规划（成功计划与升级公式对拍 / 拒绝矩阵 / 输入零修改 / 无 RNG 不抛 /
 *      稀有度×材料位置×目标镶嵌态×升级档矩阵）
 *   D. tryFeedRune 原子事务（成功单次写盘 / 材料消失目标替换其他不变 / 镶嵌属性生效 /
 *      save 失败与异常完整回滚 / 规划失败零修改零写盘）
 *   E. UI 集成（强化按钮 / 已满级禁用 / 材料候选派生与排序（含真实 exp>0 排除）/
 *      完整预览五项字段（不升级/一次升级/多级升级 helper 对拍）/ 确认成功 /
 *      失败面板保持打开 / 无材料两行文案 / 面板失效自动关闭 /
 *      材料被镶嵌/获得经验/升级/消失后的失效语义与事务 0 次）
 *   F. 拓扑快照 helper（确定性排序 / 不依赖 Map 插入顺序 / 比较语义）
 *   G. 事务级时变 inventory Proxy（raw 只读一次 / legend→common 不错发经验 /
 *      交换位置 / 第二次读取抛异常）
 *   H. planner index 与事务快照对拍（mock planner：index 非法 / 同 ID 异字段拒绝）
 *   I. 时变装备拓扑（两份拓扑均合法但不一致 → 拒绝零写盘）
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
  RUNE_FEED_EXP_BY_RARITY,
  getRuneFeedExperience,
  planRuneFeeding,
  buildRuneTopologySnapshot,
  sameRuneTopologySnapshot,
  type RuneFeedingPlan
} from '../utils/runeFeeding'
import {
  createEmptyEquipmentRuneSlots,
  getPlayerEquipmentRuneBonuses,
  getRuneEffectiveValue,
  validatePlayerRuneReferenceTopology,
  type EquipmentRuneSlotRef
} from '../utils/equipmentRunes'
import {
  planRuneExperienceGain,
  getRuneExperienceProgress,
  RUNE_MAX_LEVEL
} from '../utils/runeExperience'
import { EQUIPMENT_SLOTS, STAT_NAMES } from '../types'
import type { Equipment, EquipmentSlot, RuneSlot } from '../types'

// planner 受控 override（§H index/快照对拍测试用）：
// 默认 override 为 null → 直通真实实现（不用 vi.fn，避免 restoreAllMocks 把真实实现清空）。
const plannerMockState = vi.hoisted(() => ({
  override: null as ((input: unknown) => unknown) | null
}))

vi.mock('../utils/runeFeeding', async importOriginal => {
  const actual = await importOriginal<typeof import('../utils/runeFeeding')>()
  const patched: typeof actual = {
    ...actual,
    planRuneFeeding: input =>
      plannerMockState.override
        ? (plannerMockState.override(input) as ReturnType<typeof actual.planRuneFeeding>)
        : actual.planRuneFeeding(input)
  }
  return patched
})

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

/** 主存档 setItem 抛错、读取委托真实 storage（与既有阶段测试一致）。 */
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

function runeEquals(a: Rune, b: Rune): boolean {
  return (
    a.id === b.id &&
    a.type === b.type &&
    a.rarity === b.rarity &&
    a.level === b.level &&
    a.exp === b.exp &&
    a.statValue === b.statValue
  )
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
  plannerMockState.override = null
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

// ============================================================================
// A. 固定经验配置
// ============================================================================
describe('Phase 3.11 — RUNE_FEED_EXP_BY_RARITY 冻结配置', () => {
  it('数值恰为 common=5 / rare=15 / epic=45 / legend=135，且没有多余键', () => {
    expect(RUNE_FEED_EXP_BY_RARITY.common).toBe(5)
    expect(RUNE_FEED_EXP_BY_RARITY.rare).toBe(15)
    expect(RUNE_FEED_EXP_BY_RARITY.epic).toBe(45)
    expect(RUNE_FEED_EXP_BY_RARITY.legend).toBe(135)
    expect(Object.keys(RUNE_FEED_EXP_BY_RARITY).sort()).toEqual(['common', 'epic', 'legend', 'rare'])
  })

  it('配置对象已 Object.freeze，运行时篡改不生效', () => {
    expect(Object.isFrozen(RUNE_FEED_EXP_BY_RARITY)).toBe(true)
    expect(() => {
      ;(RUNE_FEED_EXP_BY_RARITY as Record<string, number>).common = 999
    }).toThrow()
    expect(RUNE_FEED_EXP_BY_RARITY.common).toBe(5)
  })
})

// ============================================================================
// B. getRuneFeedExperience
// ============================================================================
describe('Phase 3.11 — getRuneFeedExperience 矩阵', () => {
  it('四稀有度全新 Rune（level=1 / exp=0）→ 对应固定经验', () => {
    expect(getRuneFeedExperience(makeRune('a', { rarity: 'common' }))).toBe(5)
    expect(getRuneFeedExperience(makeRune('b', { rarity: 'rare' }))).toBe(15)
    expect(getRuneFeedExperience(makeRune('c', { rarity: 'epic' }))).toBe(45)
    expect(getRuneFeedExperience(makeRune('d', { rarity: 'legend' }))).toBe(135)
  })

  it('经验与类型 / statValue / 等级无关：只有非全新状态返回 null', () => {
    // 类型与数值不影响经验
    expect(getRuneFeedExperience(makeRune('a', { type: 'luck', statValue: 9999, rarity: 'rare' }))).toBe(15)
    // level > 1 → null
    expect(getRuneFeedExperience(makeRune('b', { level: 2 }))).toBeNull()
    // exp > 0 → null
    expect(getRuneFeedExperience(makeRune('c', { exp: 1 }))).toBeNull()
    // 满级 → null
    expect(getRuneFeedExperience(makeRune('d', { level: RUNE_MAX_LEVEL }))).toBeNull()
  })

  it('malformed 输入一律 null 且不抛：null / 原始值 / 数组 / 缺字段 / 非法字段 / 抛异常 getter', () => {
    expect(getRuneFeedExperience(null)).toBeNull()
    expect(getRuneFeedExperience(undefined)).toBeNull()
    expect(getRuneFeedExperience(42)).toBeNull()
    expect(getRuneFeedExperience('rune')).toBeNull()
    expect(getRuneFeedExperience([])).toBeNull()
    expect(getRuneFeedExperience({})).toBeNull()
    expect(getRuneFeedExperience({ ...makeRune('a'), rarity: 'mythic' })).toBeNull()
    expect(getRuneFeedExperience({ ...makeRune('a'), level: 1.5 })).toBeNull()
    expect(getRuneFeedExperience({ ...makeRune('a'), exp: -1 })).toBeNull()
    const trap = new Proxy(
      {},
      {
        get() {
          throw new Error('trap')
        }
      }
    )
    expect(() => getRuneFeedExperience(trap)).not.toThrow()
    expect(getRuneFeedExperience(trap)).toBeNull()
  })
})

// ============================================================================
// C. planRuneFeeding 纯规划
// ============================================================================
describe('Phase 3.11 — planRuneFeeding 成功计划', () => {
  it('成功计划与 planRuneExperienceGain 对拍（不复制第二套升级公式）', () => {
    const target = makeRune('t1', { level: 3, exp: 10, statValue: 13 })
    const material = makeRune('m1', { rarity: 'legend' })
    const inventory = [target, material]
    const plan = planRuneFeeding({
      targetRuneId: 't1',
      materialRuneId: 'm1',
      inventory,
      equipmentBySlot: {}
    })
    expect(plan.ok).toBe(true)
    if (!plan.ok) throw new Error('expected ok')
    const expPlan = planRuneExperienceGain(target, 135)
    if (!expPlan.ok) throw new Error('expected exp plan ok')
    expect(plan.expAdded).toBe(135)
    expect(plan.targetIndex).toBe(0)
    expect(plan.materialIndex).toBe(1)
    expect(runeEquals(plan.nextTargetRune, expPlan.nextRune)).toBe(true)
    expect(plan.levelsGained).toBe(expPlan.levelsGained)
    expect(plan.targetRune.id).toBe('t1')
    expect(plan.materialRune.id).toBe('m1')
  })

  it('目标可以是已镶嵌 Rune（材料未镶嵌即可）', () => {
    const playerStore = usePlayerStore()
    const target = makeRune('t1', { level: 2, exp: 0 })
    const material = makeRune('m1', { rarity: 'common' })
    playerStore.player.equipment[SLOT_A] = makeRuneEquip('eq1', SLOT_A, {
      runeSlots: slotsWith('t1')
    })
    const plan = planRuneFeeding({
      targetRuneId: 't1',
      materialRuneId: 'm1',
      inventory: [target, material],
      equipmentBySlot: playerStore.player.equipment
    })
    expect(plan.ok).toBe(true)
  })

  it('ID trim 后按 canonical 匹配，且不修改输入 inventory', () => {
    const target = makeRune('t1')
    const material = makeRune('m1', { rarity: 'rare' })
    const inventory = [target, material]
    const before = inventory.map(r => ({ ...r }))
    const plan = planRuneFeeding({
      targetRuneId: '  t1  ',
      materialRuneId: ' m1 ',
      inventory,
      equipmentBySlot: {}
    })
    expect(plan.ok).toBe(true)
    expect(inventory.length).toBe(2)
    for (let i = 0; i < inventory.length; i++) {
      expect(runeEquals(inventory[i], before[i])).toBe(true)
    }
  })

  it('规划全程不调用 RNG', () => {
    const spy = vi.spyOn(Math, 'random')
    planRuneFeeding({
      targetRuneId: 't1',
      materialRuneId: 'm1',
      inventory: [makeRune('t1'), makeRune('m1')],
      equipmentBySlot: {}
    })
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('Phase 3.11 — planRuneFeeding 拒绝矩阵', () => {
  const baseInventory = () => [makeRune('t1', { level: 2 }), makeRune('m1')]

  function expectReject(input: Parameters<typeof planRuneFeeding>[0]) {
    const plan = planRuneFeeding(input)
    expect(plan.ok).toBe(false)
    return plan.ok ? '' : plan.reason
  }

  it('非字符串 / 空白 ID → 拒绝', () => {
    expectReject({ targetRuneId: null, materialRuneId: 'm1', inventory: baseInventory(), equipmentBySlot: {} })
    expectReject({ targetRuneId: 't1', materialRuneId: 42, inventory: baseInventory(), equipmentBySlot: {} })
    expectReject({ targetRuneId: '   ', materialRuneId: 'm1', inventory: baseInventory(), equipmentBySlot: {} })
    expectReject({ targetRuneId: 't1', materialRuneId: '', inventory: baseInventory(), equipmentBySlot: {} })
  })

  it('相同 canonical ID（自吞，含空白变体）→ 拒绝', () => {
    expectReject({ targetRuneId: 't1', materialRuneId: 't1', inventory: baseInventory(), equipmentBySlot: {} })
    expectReject({ targetRuneId: ' t1 ', materialRuneId: 't1', inventory: baseInventory(), equipmentBySlot: {} })
  })

  it('inventory 非法（重复 ID / 非数组 / malformed 项）→ 拒绝', () => {
    expectReject({
      targetRuneId: 't1',
      materialRuneId: 'm1',
      inventory: [makeRune('t1'), makeRune('t1'), makeRune('m1')],
      equipmentBySlot: {}
    })
    expectReject({ targetRuneId: 't1', materialRuneId: 'm1', inventory: 'nope', equipmentBySlot: {} })
    expectReject({
      targetRuneId: 't1',
      materialRuneId: 'm1',
      inventory: [makeRune('t1'), { bad: true }],
      equipmentBySlot: {}
    })
  })

  it('拓扑非法（悬空引用）→ 拒绝', () => {
    const equipment = {
      [SLOT_A]: makeRuneEquip('eq1', SLOT_A, { runeSlots: slotsWith('ghost') })
    }
    expectReject({
      targetRuneId: 't1',
      materialRuneId: 'm1',
      inventory: baseInventory(),
      equipmentBySlot: equipment
    })
  })

  it('目标 / 材料不存在 → 拒绝', () => {
    expectReject({ targetRuneId: 'missing', materialRuneId: 'm1', inventory: baseInventory(), equipmentBySlot: {} })
    expectReject({ targetRuneId: 't1', materialRuneId: 'missing', inventory: baseInventory(), equipmentBySlot: {} })
  })

  it('目标已满级（Lv.50）→ 拒绝', () => {
    expectReject({
      targetRuneId: 't1',
      materialRuneId: 'm1',
      inventory: [makeRune('t1', { level: RUNE_MAX_LEVEL }), makeRune('m1')],
      equipmentBySlot: {}
    })
  })

  it('材料非全新（level>1 / exp>0）→ 拒绝', () => {
    expectReject({
      targetRuneId: 't1',
      materialRuneId: 'm1',
      inventory: [makeRune('t1', { level: 2 }), makeRune('m1', { level: 2 })],
      equipmentBySlot: {}
    })
    expectReject({
      targetRuneId: 't1',
      materialRuneId: 'm1',
      inventory: [makeRune('t1', { level: 2 }), makeRune('m1', { exp: 3 })],
      equipmentBySlot: {}
    })
  })

  it('材料已被装备孔引用 → 拒绝（目标已镶嵌则允许）', () => {
    const inventory = [makeRune('t1', { level: 2 }), makeRune('m1')]
    const equipment = {
      [SLOT_A]: makeRuneEquip('eq1', SLOT_A, { runeSlots: slotsWith('m1') })
    }
    const reason = expectReject({
      targetRuneId: 't1',
      materialRuneId: 'm1',
      inventory,
      equipmentBySlot: equipment
    })
    expect(reason).toContain('embedded')
  })

  it('拒绝路径不抛异常且不修改输入（Proxy 陷阱 → fail-closed）', () => {
    const trap = new Proxy(
      {},
      {
        get() {
          throw new Error('trap')
        }
      }
    )
    expect(() =>
      planRuneFeeding({ targetRuneId: 't1', materialRuneId: 'm1', inventory: trap, equipmentBySlot: {} })
    ).not.toThrow()
    const inventory = baseInventory()
    const before = inventory.map(r => ({ ...r }))
    planRuneFeeding({ targetRuneId: 't1', materialRuneId: 't1', inventory, equipmentBySlot: {} })
    for (let i = 0; i < inventory.length; i++) {
      expect(runeEquals(inventory[i], before[i])).toBe(true)
    }
  })
})

// ============================================================================
// D. tryFeedRune 原子事务
// ============================================================================
describe('Phase 3.11 — tryFeedRune 成功事务', () => {
  it('材料消失、目标替换、其他 Rune 字节级不变、单次写主存档、结果持久化', () => {
    const playerStore = usePlayerStore()
    const other = makeRune('o1', { rarity: 'epic', level: 4, statValue: 20 })
    const target = makeRune('t1', { level: 2, exp: 0 })
    const material = makeRune('m1', { rarity: 'rare' })
    playerStore.runeInventory = [other, target, material]

    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    const res = playerStore.tryFeedRune('t1', 'm1')
    expect(res.ok).toBe(true)
    expect(res.expAdded).toBe(15)

    // 与唯一公式来源对拍
    const expPlan = planRuneExperienceGain(target, 15)
    if (!expPlan.ok) throw new Error('expected exp plan ok')
    expect(res.levelsGained).toBe(expPlan.levelsGained)
    expect(res.level).toBe(expPlan.nextRune.level)
    expect(res.exp).toBe(expPlan.nextRune.exp)

    // inventory：长度 -1、材料消失、目标替换、other 不变、相对顺序不变
    expect(playerStore.runeInventory.length).toBe(2)
    expect(playerStore.runeInventory.some(r => r.id === 'm1')).toBe(false)
    expect(runeEquals(playerStore.runeInventory[0], other)).toBe(true)
    expect(runeEquals(playerStore.runeInventory[1], expPlan.nextRune)).toBe(true)

    // 主存档恰好写一次
    const saveWrites = setItemSpy.mock.calls.filter(c => c[0] === SAVE_KEY)
    expect(saveWrites.length).toBe(1)

    // 持久化：重建 Pinia 后 loadGame 恢复吞噬后状态
    setActivePinia(createPinia())
    warmupStores()
    const reloaded = usePlayerStore()
    reloaded.loadGame()
    expect(reloaded.runeInventory.length).toBe(2)
    expect(reloaded.runeInventory.some(r => r.id === 'm1')).toBe(false)
    const reloadedTarget = reloaded.runeInventory.find(r => r.id === 't1')
    expect(reloadedTarget).toBeTruthy()
    expect(reloadedTarget!.level).toBe(expPlan.nextRune.level)
    expect(reloadedTarget!.exp).toBe(expPlan.nextRune.exp)
  })

  it('材料在目标之前：index 前移后目标仍被正确替换', () => {
    const playerStore = usePlayerStore()
    const material = makeRune('m1', { rarity: 'common' })
    const target = makeRune('t1', { level: 2, exp: 0 })
    playerStore.runeInventory = [material, target]

    const res = playerStore.tryFeedRune('t1', 'm1')
    expect(res.ok).toBe(true)
    expect(playerStore.runeInventory.length).toBe(1)
    expect(playerStore.runeInventory[0].id).toBe('t1')
    expect(playerStore.runeInventory[0].exp).toBe(5) // Lv.2 exp 0 + 5 < 46，不升级
  })

  it('已镶嵌目标升级后聚合符文加成立即变化；装备拓扑完全不变', () => {
    const playerStore = usePlayerStore()
    // legend 材料保证升级（135 exp 从 Lv.1 至少升 2 级）
    const target = makeRune('t1', { type: 'attack', level: 1, exp: 0, statValue: 10 })
    const material = makeRune('m1', { rarity: 'legend' })
    playerStore.runeInventory = [target, material]
    playerStore.player.equipment[SLOT_A] = makeRuneEquip('eq1', SLOT_A, {
      runeSlots: slotsWith('t1')
    })

    const bonusBefore = getPlayerEquipmentRuneBonuses(playerStore.player.equipment, playerStore.runeInventory)
    const res = playerStore.tryFeedRune('t1', 'm1')
    expect(res.ok).toBe(true)
    expect(res.levelsGained).toBeGreaterThan(0)

    const bonusAfter = getPlayerEquipmentRuneBonuses(playerStore.player.equipment, playerStore.runeInventory)
    const attackBefore = bonusBefore.find(b => b.type === 'attack')?.value ?? 0
    const attackAfter = bonusAfter.find(b => b.type === 'attack')?.value ?? 0
    expect(attackAfter).toBeGreaterThan(attackBefore)

    // 装备拓扑不变：仍然引用 t1
    const eq = playerStore.player.equipment[SLOT_A]!
    expect(eq.runeSlots[0].runeId).toBe('t1')
    expect(eq.runeSlots[1].runeId).toBeNull()
    expect(eq.runeSlots[2].runeId).toBeNull()
  })

  it('未镶嵌目标升级：聚合符文加成不变（不影响 totalStats 语义）', () => {
    const playerStore = usePlayerStore()
    playerStore.runeInventory = [makeRune('t1', { level: 2 }), makeRune('m1', { rarity: 'epic' })]
    const bonusBefore = getPlayerEquipmentRuneBonuses(playerStore.player.equipment, playerStore.runeInventory)
    const res = playerStore.tryFeedRune('t1', 'm1')
    expect(res.ok).toBe(true)
    const bonusAfter = getPlayerEquipmentRuneBonuses(playerStore.player.equipment, playerStore.runeInventory)
    expect(bonusAfter).toEqual(bonusBefore)
  })
})

describe('Phase 3.11 — tryFeedRune 失败与回滚', () => {
  it('规划失败（自吞 / 材料已镶嵌 / 目标满级）→ 零修改零写盘', () => {
    const playerStore = usePlayerStore()
    const target = makeRune('t1', { level: RUNE_MAX_LEVEL })
    const material = makeRune('m1')
    playerStore.runeInventory = [target, material]
    const before = playerStore.runeInventory.map(r => ({ ...r }))
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')

    expect(playerStore.tryFeedRune('t1', 't1').ok).toBe(false)
    expect(playerStore.tryFeedRune('t1', 'm1').ok).toBe(false) // 满级
    expect(playerStore.tryFeedRune('missing', 'm1').ok).toBe(false)

    expect(playerStore.runeInventory.length).toBe(2)
    for (let i = 0; i < before.length; i++) {
      expect(runeEquals(playerStore.runeInventory[i], before[i])).toBe(true)
    }
    expect(setItemSpy.mock.calls.filter(c => c[0] === SAVE_KEY).length).toBe(0)
  })

  it('saveGame 抛异常 → 完整回滚（材料不消耗、目标不升级、数量顺序恢复）', () => {
    const playerStore = usePlayerStore()
    const other = makeRune('o1', { rarity: 'rare', level: 3, statValue: 15 })
    const target = makeRune('t1', { level: 2 })
    const material = makeRune('m1', { rarity: 'legend' })
    playerStore.runeInventory = [other, target, material]
    const before = playerStore.runeInventory.map(r => ({ ...r }))

    installThrowingStorage()
    const res = playerStore.tryFeedRune('t1', 'm1')
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('save failed')
    expect(res.expAdded).toBe(0)
    expect(res.levelsGained).toBe(0)

    expect(playerStore.runeInventory.length).toBe(3)
    for (let i = 0; i < before.length; i++) {
      expect(runeEquals(playerStore.runeInventory[i], before[i])).toBe(true)
    }
  })

  it('save 失败后磁盘原字符串不变；恢复 storage 后同一事务可成功重放', () => {
    const playerStore = usePlayerStore()
    playerStore.runeInventory = [makeRune('t1', { level: 2 }), makeRune('m1')]
    playerStore.saveGame()
    const diskBefore = localStorage.getItem(SAVE_KEY)

    installThrowingStorage()
    expect(playerStore.tryFeedRune('t1', 'm1').ok).toBe(false)
    vi.unstubAllGlobals()

    expect(localStorage.getItem(SAVE_KEY)).toBe(diskBefore)

    const res = playerStore.tryFeedRune('t1', 'm1')
    expect(res.ok).toBe(true)
    expect(playerStore.runeInventory.length).toBe(1)
    expect(playerStore.runeInventory[0].id).toBe('t1')
  })
})

// ============================================================================
// E. UI 集成
// ============================================================================
describe('Phase 3.11 — 强化 UI', () => {
  function seedInventory(runes: Rune[]) {
    const playerStore = usePlayerStore()
    playerStore.runeInventory = runes
    return playerStore
  }

  it('非满级 Rune 显示可用的强化按钮；满级 Rune 显示禁用的「已满级」', async () => {
    seedInventory([
      makeRune('t1', { level: 2 }),
      makeRune('max1', { type: 'luck', level: RUNE_MAX_LEVEL })
    ])
    const wrapper = mount(RuneInventoryTab)
    await nextTick()

    const feedBtn = findByAriaPrefix(wrapper, '强化 普通攻击符文')
    expect(feedBtn).toBeTruthy()
    expect(feedBtn!.attributes('disabled')).toBeUndefined()

    const maxBtn = findByAriaPrefix(wrapper, '普通幸运符文 已满级')
    expect(maxBtn).toBeTruthy()
    expect(maxBtn!.attributes('disabled')).toBeDefined()
    expect(maxBtn!.text()).toContain('已满级')
  })

  it('材料候选：排除目标自身 / 已镶嵌 / level>1 / 真实 exp>0，按仓库顺序排列并显示名称+稀有度+经验', async () => {
    const playerStore = seedInventory([
      makeRune('t1', { level: 2 }),
      makeRune('used1', { type: 'defense', level: 2 }), // level>1 → 排除
      makeRune('cand2', { type: 'speed', rarity: 'epic' }),
      makeRune('embedded1', { type: 'health' }), // 已镶嵌 → 排除
      makeRune('cand1', { type: 'crit', rarity: 'rare' }),
      makeRune('experienced', { type: 'luck', level: 1, exp: 1 }), // 真实 exp>0 → 排除（Phase 3.11.1 §13）
      makeRune('cand3', { type: 'luck', exp: 0, level: 1, statValue: 5 }) // 合法 Lv.1/0EXP common 候选保留
    ])
    playerStore.player.equipment[SLOT_A] = makeRuneEquip('eq1', SLOT_A, {
      runeSlots: slotsWith('embedded1')
    })

    const wrapper = mount(RuneInventoryTab)
    await nextTick()
    await findByAriaPrefix(wrapper, '强化 普通攻击符文')!.trigger('click')
    await nextTick()

    const panel = wrapper.find('[aria-label="强化符文"]')
    expect(panel.exists()).toBe(true)
    const materialButtons = panel.findAll('.feed-material')
    // cand2(epic speed, idx2)、cand1(rare crit, idx4)、cand3(common luck, idx6)
    expect(materialButtons.length).toBe(3)
    expect(materialButtons[0].text()).toContain('史诗速度符文')
    expect(materialButtons[0].text()).toContain('+45 经验')
    expect(materialButtons[1].text()).toContain('稀有暴击符文')
    expect(materialButtons[1].text()).toContain('+15 经验')
    expect(materialButtons[2].text()).toContain('普通幸运符文')
    expect(materialButtons[2].text()).toContain('+5 经验')
    // 排除项不出现在候选按钮中（experienced 与 cand3 同为普通幸运符文，须按按钮个数+经验值区分：
    // 候选恰 3 个按钮，且不存在 exp=1 的第四个幸运候选）
    expect(panel.text()).not.toContain('普通防御符文')
    expect(panel.text()).not.toContain('普通生命符文')
    const luckButtons = materialButtons.filter(btn => btn.text().includes('普通幸运符文'))
    expect(luckButtons.length).toBe(1)
  })

  it('真实 exp>0 材料（level=1, exp=1）不出现在候选列表（Phase 3.11.1 §13）', async () => {
    seedInventory([
      makeRune('t1', { level: 2 }),
      makeRune('experienced', { type: 'defense', level: 1, exp: 1 }),
      makeRune('fresh', { type: 'crit', level: 1, exp: 0 })
    ])
    const wrapper = mount(RuneInventoryTab)
    await nextTick()
    await findByAriaPrefix(wrapper, '强化 普通攻击符文')!.trigger('click')
    await nextTick()

    const panel = wrapper.find('[aria-label="强化符文"]')
    const materialButtons = panel.findAll('.feed-material')
    expect(materialButtons.length).toBe(1)
    expect(materialButtons[0].text()).toContain('普通暴击符文')
    expect(panel.text()).not.toContain('普通防御符文')
  })

  it('无可用材料 → 显示两行明确文案（含 0 EXP 条件），无确认按钮', async () => {
    seedInventory([makeRune('t1', { level: 2 }), makeRune('used1', { level: 3 })])
    const wrapper = mount(RuneInventoryTab)
    await nextTick()
    await findByAriaPrefix(wrapper, '强化 普通攻击符文')!.trigger('click')
    await nextTick()

    const panel = wrapper.find('[aria-label="强化符文"]')
    expect(panel.exists()).toBe(true)
    expect(panel.text()).toContain('暂无可用材料符文')
    expect(panel.text()).toContain('仅可消耗未镶嵌的 Lv.1 / 0 EXP 符文')
    expect(findByAriaPrefix(wrapper, '确认强化')).toBeNull()
  })

  it('选择材料 → 预览显示完整字段；确认 → 事务成功、面板关闭、材料消失', async () => {
    const playerStore = seedInventory([
      makeRune('t1', { level: 1, exp: 0 }),
      makeRune('m1', { type: 'speed', rarity: 'legend' })
    ])
    const wrapper = mount(RuneInventoryTab)
    await nextTick()
    await findByAriaPrefix(wrapper, '强化 普通攻击符文')!.trigger('click')
    await nextTick()

    // 未选材料时确认按钮禁用
    const confirmBtn = findByAriaPrefix(wrapper, '确认强化')!
    expect(confirmBtn.attributes('disabled')).toBeDefined()

    await findByAriaPrefix(wrapper, '选择材料 传说速度符文')!.trigger('click')
    await nextTick()

    // 预览：完整字段（当前 / 获得 / 强化后 / 提升级数 / 有效属性 / 消耗）
    const preview = wrapper.find('[aria-label="强化预览"]')
    expect(preview.exists()).toBe(true)
    expect(preview.text()).toContain('获得：+135 EXP')
    expect(preview.text()).toContain('当前：Lv.1')
    expect(preview.text()).toMatch(/强化后：Lv\.[2-9]/)
    expect(preview.text()).toMatch(/预计提升：[1-9]\d* 级/)
    expect(preview.text()).toContain('强化后有效属性：攻击力 +')
    expect(preview.text()).toContain('消耗：传说速度符文')
    expect(confirmBtn.attributes('disabled')).toBeUndefined()

    await confirmBtn.trigger('click')
    await nextTick()

    expect(wrapper.text()).toContain('强化成功')
    expect(wrapper.find('[aria-label="强化符文"]').exists()).toBe(false)
    expect(playerStore.runeInventory.length).toBe(1)
    expect(playerStore.runeInventory[0].id).toBe('t1')
    expect(playerStore.runeInventory[0].level).toBeGreaterThan(1)
  })

  it('事务失败（mock ok:false）→ 面板保持打开、显示失败、绝不显示成功、store 不变', async () => {
    const playerStore = seedInventory([makeRune('t1', { level: 2 }), makeRune('m1')])
    vi.spyOn(playerStore, 'tryFeedRune').mockReturnValue({
      ok: false,
      reason: 'save failed',
      expAdded: 0,
      levelsGained: 0
    })
    const wrapper = mount(RuneInventoryTab)
    await nextTick()
    await findByAriaPrefix(wrapper, '强化 普通攻击符文')!.trigger('click')
    await nextTick()
    await findByAriaPrefix(wrapper, '选择材料 普通攻击符文')!.trigger('click')
    await nextTick()
    await findByAriaPrefix(wrapper, '确认强化')!.trigger('click')
    await nextTick()

    expect(wrapper.text()).toContain('强化失败')
    expect(wrapper.text()).not.toContain('强化成功')
    expect(wrapper.find('[aria-label="强化符文"]').exists()).toBe(true)
    expect(playerStore.runeInventory.length).toBe(2)
  })

  it('事务抛异常 → 不崩溃、显示失败、面板保持打开', async () => {
    const playerStore = seedInventory([makeRune('t1', { level: 2 }), makeRune('m1')])
    vi.spyOn(playerStore, 'tryFeedRune').mockImplementation(() => {
      throw new Error('boom')
    })
    const wrapper = mount(RuneInventoryTab)
    await nextTick()
    await findByAriaPrefix(wrapper, '强化 普通攻击符文')!.trigger('click')
    await nextTick()
    await findByAriaPrefix(wrapper, '选择材料 普通攻击符文')!.trigger('click')
    await nextTick()
    await findByAriaPrefix(wrapper, '确认强化')!.trigger('click')
    await nextTick()

    expect(wrapper.text()).toContain('强化操作失败')
    expect(wrapper.find('[aria-label="强化符文"]').exists()).toBe(true)
  })

  it('面板打开期间视图损坏 → 面板立即关闭，只显示损坏横幅', async () => {
    const playerStore = seedInventory([makeRune('t1', { level: 2 }), makeRune('m1')])
    const wrapper = mount(RuneInventoryTab)
    await nextTick()
    await findByAriaPrefix(wrapper, '强化 普通攻击符文')!.trigger('click')
    await nextTick()
    expect(wrapper.find('[aria-label="强化符文"]').exists()).toBe(true)

    // 注入重复 ID 破坏 inventory
    playerStore.runeInventory = [makeRune('dup'), makeRune('dup')]
    await nextTick()

    expect(wrapper.find('[aria-label="强化符文"]').exists()).toBe(false)
    expect(wrapper.find('.broken-banner').exists()).toBe(true)
  })

  it('面板打开期间目标消失 → 面板立即关闭；材料失效 → 仅清空选择、面板保持打开', async () => {
    const playerStore = seedInventory([
      makeRune('t1', { level: 2 }),
      makeRune('m1'),
      makeRune('m2', { type: 'crit' })
    ])
    const wrapper = mount(RuneInventoryTab)
    await nextTick()
    await findByAriaPrefix(wrapper, '强化 普通攻击符文')!.trigger('click')
    await nextTick()
    await findByAriaPrefix(wrapper, '选择材料 普通攻击符文')!.trigger('click')
    await nextTick()
    expect(wrapper.find('[aria-label="强化预览"]').exists()).toBe(true)

    // 材料 m1 失效（升级为 level 2）→ 选择清空、面板保持打开
    playerStore.runeInventory = [
      makeRune('t1', { level: 2 }),
      makeRune('m1', { level: 2 }),
      makeRune('m2', { type: 'crit' })
    ]
    await nextTick()
    await nextTick()
    expect(wrapper.find('[aria-label="强化符文"]').exists()).toBe(true)
    expect(wrapper.find('[aria-label="强化预览"]').exists()).toBe(false)

    // 目标 t1 消失 → 面板关闭
    playerStore.runeInventory = [makeRune('m2', { type: 'crit' })]
    await nextTick()
    await nextTick()
    expect(wrapper.find('[aria-label="强化符文"]').exists()).toBe(false)
  })

  it('目标升至满级 → 面板立即关闭', async () => {
    const playerStore = seedInventory([makeRune('t1', { level: 2 }), makeRune('m1')])
    const wrapper = mount(RuneInventoryTab)
    await nextTick()
    await findByAriaPrefix(wrapper, '强化 普通攻击符文')!.trigger('click')
    await nextTick()
    expect(wrapper.find('[aria-label="强化符文"]').exists()).toBe(true)

    playerStore.runeInventory = [makeRune('t1', { level: RUNE_MAX_LEVEL }), makeRune('m1')]
    await nextTick()
    await nextTick()
    expect(wrapper.find('[aria-label="强化符文"]').exists()).toBe(false)
  })
})

// ============================================================================
// C+. planRuneFeeding 稀有度 × 材料位置 × 目标镶嵌态 × 升级档矩阵（Phase 3.11.1 §16）
// ============================================================================
describe('Phase 3.11.1 — planRuneFeeding 完整矩阵', () => {
  it('四稀有度 × 材料位置（前/后）× 目标镶嵌态（是/否）全部成功且与升级公式对拍', () => {
    for (const rarity of ['common', 'rare', 'epic', 'legend'] as const) {
      for (const materialFirst of [false, true]) {
        for (const embedded of [false, true]) {
          const target = makeRune('t1', { level: 2, exp: 0 })
          const material = makeRune('m1', { rarity })
          const inventory = materialFirst ? [material, target] : [target, material]
          const equipmentBySlot = embedded
            ? { [SLOT_A]: makeRuneEquip('eq1', SLOT_A, { runeSlots: slotsWith('t1') }) }
            : {}
          const plan = planRuneFeeding({ targetRuneId: 't1', materialRuneId: 'm1', inventory, equipmentBySlot })
          expect(plan.ok).toBe(true)
          if (!plan.ok) throw new Error(`expected ok: ${rarity}/${materialFirst}/${embedded}`)
          expect(plan.expAdded).toBe(RUNE_FEED_EXP_BY_RARITY[rarity])
          expect(plan.targetIndex).toBe(materialFirst ? 1 : 0)
          expect(plan.materialIndex).toBe(materialFirst ? 0 : 1)
          const expected = planRuneExperienceGain(target, RUNE_FEED_EXP_BY_RARITY[rarity])
          if (!expected.ok) throw new Error('expected exp plan ok')
          expect(runeEquals(plan.nextTargetRune, expected.nextRune)).toBe(true)
          expect(plan.levelsGained).toBe(expected.levelsGained)
        }
      }
    }
  })

  it('升级档矩阵：不升级 / 一次升级 / 多级升级（与公式对拍，显式断言 0 / 1 / ≥2 级）', () => {
    // 不升级：Lv.2 exp0 + common(5)
    const noLevel = planRuneFeeding({
      targetRuneId: 't1',
      materialRuneId: 'm1',
      inventory: [makeRune('t1', { level: 2, exp: 0 }), makeRune('m1', { rarity: 'common' })],
      equipmentBySlot: {}
    })
    expect(noLevel.ok).toBe(true)
    if (!noLevel.ok) throw new Error('expected ok')
    expect(noLevel.levelsGained).toBe(0)
    expect(noLevel.nextTargetRune.level).toBe(2)

    // 一次升级：Lv.1 exp20 + common(5)（20+5 ≥ 首级阈值）
    const oneLevelTarget = makeRune('t1', { level: 1, exp: 20 })
    const oneLevel = planRuneFeeding({
      targetRuneId: 't1',
      materialRuneId: 'm1',
      inventory: [oneLevelTarget, makeRune('m1', { rarity: 'common' })],
      equipmentBySlot: {}
    })
    expect(oneLevel.ok).toBe(true)
    if (!oneLevel.ok) throw new Error('expected ok')
    const oneExpected = planRuneExperienceGain(oneLevelTarget, 5)
    if (!oneExpected.ok) throw new Error('expected exp plan ok')
    expect(oneLevel.levelsGained).toBe(1)
    expect(runeEquals(oneLevel.nextTargetRune, oneExpected.nextRune)).toBe(true)

    // 多级升级：Lv.1 exp0 + legend(135)
    const multiTarget = makeRune('t1', { level: 1, exp: 0 })
    const multi = planRuneFeeding({
      targetRuneId: 't1',
      materialRuneId: 'm1',
      inventory: [multiTarget, makeRune('m1', { rarity: 'legend' })],
      equipmentBySlot: {}
    })
    expect(multi.ok).toBe(true)
    if (!multi.ok) throw new Error('expected ok')
    const multiExpected = planRuneExperienceGain(multiTarget, 135)
    if (!multiExpected.ok) throw new Error('expected exp plan ok')
    expect(multi.levelsGained).toBeGreaterThanOrEqual(2)
    expect(multi.levelsGained).toBe(multiExpected.levelsGained)
    expect(runeEquals(multi.nextTargetRune, multiExpected.nextRune)).toBe(true)
  })
})

// ============================================================================
// F. 拓扑快照 helper（Phase 3.11.1 §5）
// ============================================================================
describe('Phase 3.11.1 — 拓扑快照 helper', () => {
  it('buildRuneTopologySnapshot：按 EQUIPMENT_SLOTS 顺序再按孔位升序，不依赖 Map 插入顺序', () => {
    const sa = EQUIPMENT_SLOTS[0]
    const sb = EQUIPMENT_SLOTS[1]
    const entries: [string, EquipmentRuneSlotRef[]][] = [
      ['r1', [{ slot: sa, index: 0 }]],
      ['r2', [{ slot: sa, index: 2 }]],
      ['r3', [{ slot: sb, index: 1 }]]
    ]
    const forward = buildRuneTopologySnapshot(new Map(entries))
    const reverse = buildRuneTopologySnapshot(new Map([...entries].reverse()))
    expect(forward).toEqual([
      { runeId: 'r1', equipmentSlot: sa, runeSlotIndex: 0 },
      { runeId: 'r2', equipmentSlot: sa, runeSlotIndex: 2 },
      { runeId: 'r3', equipmentSlot: sb, runeSlotIndex: 1 }
    ])
    expect(sameRuneTopologySnapshot(forward, reverse)).toBe(true)
  })

  it('plan.topologySnapshot 与真实 validatePlayerRuneReferenceTopology 派生快照一致', () => {
    const inventory = [makeRune('t1', { level: 2 }), makeRune('m1'), makeRune('r9', { type: 'luck' })]
    const equipment = {
      [SLOT_A]: makeRuneEquip('eq1', SLOT_A, { runeSlots: slotsWith('t1', null, 'r9') })
    }
    const topo = validatePlayerRuneReferenceTopology(equipment, inventory)
    expect(topo.ok).toBe(true)
    if (!topo.ok) throw new Error('expected topo ok')
    const derived = buildRuneTopologySnapshot(topo.references)

    const plan = planRuneFeeding({ targetRuneId: 't1', materialRuneId: 'm1', inventory, equipmentBySlot: equipment })
    expect(plan.ok).toBe(true)
    if (!plan.ok) throw new Error('expected plan ok')
    expect(sameRuneTopologySnapshot(plan.topologySnapshot, derived)).toBe(true)
    // 快照只含标量位置信息（canonical runeId + slot + index）
    for (const ref of plan.topologySnapshot) {
      expect(Object.keys(ref).sort()).toEqual(['equipmentSlot', 'runeId', 'runeSlotIndex'])
    }
  })

  it('sameRuneTopologySnapshot：引用消失 / 新增 / 位置变化 / 换 Rune → false', () => {
    const sa = EQUIPMENT_SLOTS[0]
    const base = buildRuneTopologySnapshot(new Map([['r1', [{ slot: sa, index: 0 }]]]))
    const empty = buildRuneTopologySnapshot(new Map())
    const moved = buildRuneTopologySnapshot(new Map([['r1', [{ slot: sa, index: 1 }]]]))
    const swapped = buildRuneTopologySnapshot(new Map([['r2', [{ slot: sa, index: 0 }]]]))
    const extra = buildRuneTopologySnapshot(
      new Map([
        ['r1', [{ slot: sa, index: 0 }]],
        ['r2', [{ slot: sa, index: 1 }]]
      ])
    )
    expect(sameRuneTopologySnapshot(base, empty)).toBe(false)
    expect(sameRuneTopologySnapshot(base, moved)).toBe(false)
    expect(sameRuneTopologySnapshot(base, swapped)).toBe(false)
    expect(sameRuneTopologySnapshot(base, extra)).toBe(false)
    expect(sameRuneTopologySnapshot(base, buildRuneTopologySnapshot(new Map([['r1', [{ slot: sa, index: 0 }]]])))).toBe(true)
  })
})

// ============================================================================
// G. 事务级时变 inventory Proxy（Phase 3.11.1 §8 / P1-A）
// ============================================================================
describe('Phase 3.11.1 — tryFeedRune 时变 inventory Proxy（单一稳定快照）', () => {
  it('legend→common 时变材料：raw material index 只读取一次，绝不出现「消耗 common、获得 135」', () => {
    const playerStore = usePlayerStore()
    const target = makeRune('t1', { level: 1, exp: 0 })
    const legendMaterial = makeRune('m1', { rarity: 'legend' })
    const commonMaterial = makeRune('m1', { rarity: 'common' })
    let materialReads = 0
    const proxy = new Proxy([target, legendMaterial], {
      get(t, prop, receiver) {
        if (prop === '1') {
          materialReads++
          return materialReads === 1 ? legendMaterial : commonMaterial
        }
        return Reflect.get(t, prop, receiver)
      }
    })
    playerStore.runeInventory = proxy as unknown as Rune[]

    const res = playerStore.tryFeedRune('t1', 'm1')

    // 关键断言：raw material index 恰好被读取一次（旧实现 planner + snapshot 两次读取 → 稳定失败）
    expect(materialReads).toBe(1)
    // 合法实现：基于第一次稳定快照成功——消费 legend、注入 135
    expect(res.ok).toBe(true)
    expect(res.expAdded).toBe(135)
    const expected = planRuneExperienceGain(target, 135)
    if (!expected.ok) throw new Error('expected exp plan ok')
    expect(playerStore.runeInventory.length).toBe(1)
    expect(playerStore.runeInventory[0].id).toBe('t1')
    expect(playerStore.runeInventory[0].level).toBe(expected.nextRune.level)
    expect(playerStore.runeInventory[0].exp).toBe(expected.nextRune.exp)
  })

  it('第二次读取交换 target/material 位置：每个 raw index 只读一次，目标/材料语义不混淆', () => {
    const playerStore = usePlayerStore()
    const target = makeRune('t1', { level: 2, exp: 0 })
    const material = makeRune('m1', { rarity: 'rare' })
    const swapped = [material, target]
    const reads: Record<string, number> = {}
    const proxy = new Proxy([target, material], {
      get(t, prop, receiver) {
        if (typeof prop === 'string' && /^\d+$/.test(prop)) {
          reads[prop] = (reads[prop] ?? 0) + 1
          if (reads[prop] > 1) return swapped[Number(prop)]
        }
        return Reflect.get(t, prop, receiver)
      }
    })
    playerStore.runeInventory = proxy as unknown as Rune[]

    const res = playerStore.tryFeedRune('t1', 'm1')
    expect(reads['0']).toBe(1)
    expect(reads['1']).toBe(1)
    expect(res.ok).toBe(true)
    expect(res.expAdded).toBe(15)
    // 目标获得经验、材料被消耗——不可能反向
    expect(playerStore.runeInventory.length).toBe(1)
    expect(playerStore.runeInventory[0].id).toBe('t1')
    expect(playerStore.runeInventory[0].exp).toBe(15)
  })

  it('第二次读取返回同 ID 不同字段的 Rune：单次快照不受影响', () => {
    const playerStore = usePlayerStore()
    const target = makeRune('t1', { level: 2, exp: 0 })
    const material = makeRune('m1', { rarity: 'epic' })
    const altered = makeRune('m1', { rarity: 'epic', statValue: 9999, exp: 0 })
    let materialReads = 0
    const proxy = new Proxy([target, material], {
      get(t, prop, receiver) {
        if (prop === '1') {
          materialReads++
          return materialReads === 1 ? material : altered
        }
        return Reflect.get(t, prop, receiver)
      }
    })
    playerStore.runeInventory = proxy as unknown as Rune[]

    const res = playerStore.tryFeedRune('t1', 'm1')
    expect(materialReads).toBe(1)
    expect(res.ok).toBe(true)
    expect(res.expAdded).toBe(45)
  })

  it('第二次 raw 读取直接抛异常：事务不抛且行为等价于单次快照成功', () => {
    const playerStore = usePlayerStore()
    const target = makeRune('t1', { level: 2, exp: 0 })
    const material = makeRune('m1', { rarity: 'common' })
    const counts: Record<string, number> = {}
    const proxy = new Proxy([target, material], {
      get(t, prop, receiver) {
        if (typeof prop === 'string' && /^\d+$/.test(prop)) {
          counts[prop] = (counts[prop] ?? 0) + 1
          if (counts[prop] > 1) throw new Error(`second raw read of index ${prop}`)
        }
        return Reflect.get(t, prop, receiver)
      }
    })
    playerStore.runeInventory = proxy as unknown as Rune[]

    let res: ReturnType<typeof playerStore.tryFeedRune> | null = null
    expect(() => {
      res = playerStore.tryFeedRune('t1', 'm1')
    }).not.toThrow()
    // 单次快照实现：第二次读取从不发生 → 事务成功
    expect(res!.ok).toBe(true)
    expect(res!.expAdded).toBe(5)
    expect(playerStore.runeInventory.length).toBe(1)
    expect(playerStore.runeInventory[0].id).toBe('t1')
  })
})

// ============================================================================
// H. planner index 与事务快照对拍（Phase 3.11.1 §4/§9，受控 planner override）
// ============================================================================
describe('Phase 3.11.1 — planner index / 快照对拍门（受控 override）', () => {
  type OkPlan = Extract<RuneFeedingPlan, { ok: true }>

  function seedAndRealPlan() {
    const playerStore = usePlayerStore()
    playerStore.runeInventory = [makeRune('t1', { level: 2 }), makeRune('m1', { rarity: 'common' })]
    const real = planRuneFeeding({
      targetRuneId: 't1',
      materialRuneId: 'm1',
      inventory: playerStore.runeInventory.map(r => ({ ...r })),
      equipmentBySlot: playerStore.player.equipment
    })
    expect(real.ok).toBe(true)
    if (!real.ok) throw new Error('expected real plan ok')
    return { playerStore, real: real as OkPlan }
  }

  function expectRejected(
    playerStore: ReturnType<typeof usePlayerStore>,
    crafted: RuneFeedingPlan,
    reason: string
  ) {
    const before = playerStore.runeInventory.map(r => ({ ...r }))
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    plannerMockState.override = () => crafted
    const res = playerStore.tryFeedRune('t1', 'm1')
    plannerMockState.override = null
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('expected rejection')
    expect(res.reason).toBe(reason)
    expect(res.expAdded).toBe(0)
    expect(res.levelsGained).toBe(0)
    expect(playerStore.runeInventory.length).toBe(before.length)
    for (let i = 0; i < before.length; i++) {
      expect(runeEquals(playerStore.runeInventory[i], before[i]!)).toBe(true)
    }
    expect(setItemSpy.mock.calls.filter(c => c[0] === SAVE_KEY).length).toBe(0)
    setItemSpy.mockRestore()
  }

  it('materialRune 同 ID 不同 rarity（planner 见 legend、快照为 common）→ 拒绝零写盘', () => {
    const { playerStore, real } = seedAndRealPlan()
    expectRejected(
      playerStore,
      { ...real, materialRune: { ...real.materialRune, rarity: 'legend' }, expAdded: 135 },
      'plan material rune does not match snapshot'
    )
  })

  it('targetRune 同 ID 不同字段（statValue / level）→ 拒绝零写盘', () => {
    const { playerStore, real } = seedAndRealPlan()
    expectRejected(
      playerStore,
      { ...real, targetRune: { ...real.targetRune, statValue: 999 } },
      'plan target rune does not match snapshot'
    )
    expectRejected(
      playerStore,
      { ...real, targetRune: { ...real.targetRune, level: 3 } },
      'plan target rune does not match snapshot'
    )
  })

  it('targetIndex === materialIndex → 拒绝零写盘', () => {
    const { playerStore, real } = seedAndRealPlan()
    expectRejected(playerStore, { ...real, materialIndex: real.targetIndex }, 'plan index invalid')
  })

  it('index 越界 / 非整数 / 负数 → 拒绝零写盘', () => {
    const { playerStore, real } = seedAndRealPlan()
    expectRejected(playerStore, { ...real, targetIndex: 99 }, 'plan index invalid')
    expectRejected(playerStore, { ...real, materialIndex: 1.5 }, 'plan index invalid')
    expectRejected(playerStore, { ...real, targetIndex: -1 }, 'plan index invalid')
  })
})

// ============================================================================
// I. 时变拓扑一致性门（Phase 3.11.1 §6/§10 / P1-B）
// ============================================================================
describe('Phase 3.11.1 — 应用前拓扑一致性门', () => {
  it('planner 见目标在孔位 1、应用前移到孔位 2（两份拓扑均合法）→ 拒绝且零写盘', () => {
    const playerStore = usePlayerStore()
    const target = makeRune('t1', { level: 2 })
    playerStore.runeInventory = [target, makeRune('m1')]
    playerStore.player.equipment[SLOT_A] = makeRuneEquip('eq1', SLOT_A, { runeSlots: slotsWith('t1') })

    // planner 阶段所见拓扑：t1 @ 孔位 1（index 0）
    const stale = planRuneFeeding({
      targetRuneId: 't1',
      materialRuneId: 'm1',
      inventory: playerStore.runeInventory.map(r => ({ ...r })),
      equipmentBySlot: playerStore.player.equipment
    })
    expect(stale.ok).toBe(true)
    if (!stale.ok) throw new Error('expected stale plan ok')

    // 应用前拓扑：t1 移到孔位 2（index 1）——本身仍完全合法
    playerStore.player.equipment[SLOT_A] = makeRuneEquip('eq1', SLOT_A, { runeSlots: slotsWith(null, 't1') })
    const movedTopo = validatePlayerRuneReferenceTopology(playerStore.player.equipment, playerStore.runeInventory)
    expect(movedTopo.ok).toBe(true)

    const before = playerStore.runeInventory.map(r => ({ ...r }))
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    plannerMockState.override = () => stale
    const res = playerStore.tryFeedRune('t1', 'm1')
    plannerMockState.override = null

    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('expected rejection')
    expect(res.reason).toBe('rune reference topology changed since planning')
    expect(res.expAdded).toBe(0)
    expect(res.levelsGained).toBe(0)
    expect(playerStore.runeInventory.length).toBe(2)
    for (let i = 0; i < before.length; i++) {
      expect(runeEquals(playerStore.runeInventory[i], before[i]!)).toBe(true)
    }
    expect(setItemSpy.mock.calls.filter(c => c[0] === SAVE_KEY).length).toBe(0)
  })

  it('材料 planner 时未镶嵌、应用前被镶嵌（拓扑仍合法）→ 拒绝且零写盘', () => {
    const playerStore = usePlayerStore()
    playerStore.runeInventory = [makeRune('t1', { level: 2 }), makeRune('m1')]

    // planner 阶段：材料未镶嵌
    const stale = planRuneFeeding({
      targetRuneId: 't1',
      materialRuneId: 'm1',
      inventory: playerStore.runeInventory.map(r => ({ ...r })),
      equipmentBySlot: playerStore.player.equipment
    })
    expect(stale.ok).toBe(true)
    if (!stale.ok) throw new Error('expected stale plan ok')

    // 应用前：材料被镶嵌（合法拓扑：m1 仍在 inventory）
    playerStore.player.equipment[SLOT_A] = makeRuneEquip('eq1', SLOT_A, { runeSlots: slotsWith('m1') })
    const embeddedTopo = validatePlayerRuneReferenceTopology(playerStore.player.equipment, playerStore.runeInventory)
    expect(embeddedTopo.ok).toBe(true)

    const before = playerStore.runeInventory.map(r => ({ ...r }))
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    plannerMockState.override = () => stale
    const res = playerStore.tryFeedRune('t1', 'm1')
    plannerMockState.override = null

    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('expected rejection')
    expect(res.reason).toBe('rune reference topology changed since planning')
    for (let i = 0; i < before.length; i++) {
      expect(runeEquals(playerStore.runeInventory[i], before[i]!)).toBe(true)
    }
    expect(setItemSpy.mock.calls.filter(c => c[0] === SAVE_KEY).length).toBe(0)
  })
})

// ============================================================================
// J. 完整强化预览（Phase 3.11.1 §11/§14）
// ============================================================================
describe('Phase 3.11.1 — 强化预览完整字段（helper 对拍）', () => {
  async function openPanelAndSelect(runes: Rune[], materialAria: string) {
    const playerStore = usePlayerStore()
    playerStore.runeInventory = runes
    const wrapper = mount(RuneInventoryTab)
    await nextTick()
    await findByAriaPrefix(wrapper, '强化 普通攻击符文')!.trigger('click')
    await nextTick()
    await findByAriaPrefix(wrapper, materialAria)!.trigger('click')
    await nextTick()
    const preview = wrapper.find('[aria-label="强化预览"]')
    expect(preview.exists()).toBe(true)
    return { playerStore, wrapper, preview }
  }

  it('不升级：当前/强化后等级与经验、提升 0 级、强化后有效属性（与 helper 对拍）', async () => {
    const target = makeRune('t1', { level: 2, exp: 0, statValue: 10 })
    const { preview } = await openPanelAndSelect(
      [target, makeRune('m1', { type: 'defense', rarity: 'common' })],
      '选择材料 普通防御符文'
    )
    const cur = getRuneExperienceProgress(target)
    if (cur === null) throw new Error('expected progress')
    const expPlan = planRuneExperienceGain(target, 5)
    if (!expPlan.ok) throw new Error('expected exp plan ok')
    const nxt = getRuneExperienceProgress(expPlan.nextRune)
    if (nxt === null) throw new Error('expected next progress')

    expect(expPlan.levelsGained).toBe(0)
    expect(preview.text()).toContain(`当前：Lv.${cur.level} · EXP ${cur.currentExp} / ${cur.requiredExp}`)
    expect(preview.text()).toContain('获得：+5 EXP')
    expect(preview.text()).toContain(`强化后：Lv.${nxt.level} · EXP ${nxt.currentExp} / ${nxt.requiredExp}`)
    expect(nxt.level).toBe(cur.level) // 强化后等级不变
    expect(preview.text()).toContain('预计提升：0 级')
    expect(preview.text()).toContain(
      `强化后有效属性：${STAT_NAMES.attack} +${getRuneEffectiveValue(expPlan.nextRune.statValue, expPlan.nextRune.level)}`
    )
    expect(preview.text()).toContain('消耗：普通防御符文')
  })

  it('一次升级：当前/强化后等级与经验、提升 1 级、强化后有效属性', async () => {
    const target = makeRune('t1', { level: 1, exp: 20, statValue: 10 })
    const { preview } = await openPanelAndSelect(
      [target, makeRune('m1', { type: 'defense', rarity: 'common' })],
      '选择材料 普通防御符文'
    )
    const cur = getRuneExperienceProgress(target)
    if (cur === null) throw new Error('expected progress')
    const expPlan = planRuneExperienceGain(target, 5)
    if (!expPlan.ok) throw new Error('expected exp plan ok')
    const nxt = getRuneExperienceProgress(expPlan.nextRune)
    if (nxt === null) throw new Error('expected next progress')

    expect(expPlan.levelsGained).toBe(1)
    expect(preview.text()).toContain(`当前：Lv.${cur.level} · EXP ${cur.currentExp} / ${cur.requiredExp}`)
    expect(preview.text()).toContain('获得：+5 EXP')
    expect(preview.text()).toContain(`强化后：Lv.${nxt.level} · EXP ${nxt.currentExp} / ${nxt.requiredExp}`)
    expect(preview.text()).toContain('预计提升：1 级')
    expect(preview.text()).toContain(
      `强化后有效属性：${STAT_NAMES.attack} +${getRuneEffectiveValue(expPlan.nextRune.statValue, expPlan.nextRune.level)}`
    )
  })

  it('多级升级：当前/强化后等级与经验、精确 levelsGained、强化后有效属性与 helper 对拍', async () => {
    const target = makeRune('t1', { level: 1, exp: 0, statValue: 10 })
    const { preview } = await openPanelAndSelect(
      [target, makeRune('m1', { type: 'defense', rarity: 'legend' })],
      '选择材料 传说防御符文'
    )
    const cur = getRuneExperienceProgress(target)
    if (cur === null) throw new Error('expected progress')
    const expPlan = planRuneExperienceGain(target, 135)
    if (!expPlan.ok) throw new Error('expected exp plan ok')
    const nxt = getRuneExperienceProgress(expPlan.nextRune)
    if (nxt === null) throw new Error('expected next progress')

    expect(expPlan.levelsGained).toBeGreaterThanOrEqual(2)
    expect(preview.text()).toContain(`当前：Lv.${cur.level} · EXP ${cur.currentExp} / ${cur.requiredExp}`)
    expect(preview.text()).toContain('获得：+135 EXP')
    expect(preview.text()).toContain(`强化后：Lv.${nxt.level} · EXP ${nxt.currentExp} / ${nxt.requiredExp ?? 'MAX'}`)
    expect(preview.text()).toContain(`预计提升：${expPlan.levelsGained} 级`)
    expect(preview.text()).toContain(
      `强化后有效属性：${STAT_NAMES.attack} +${getRuneEffectiveValue(expPlan.nextRune.statValue, expPlan.nextRune.level)}`
    )
  })
})

// ============================================================================
// K. 材料失效语义补齐（Phase 3.11.1 §15）
// ============================================================================
describe('Phase 3.11.1 — 已选材料失效语义', () => {
  async function setupPanelWithSelectedMaterial() {
    const playerStore = usePlayerStore()
    playerStore.runeInventory = [
      makeRune('t1', { level: 2 }),
      makeRune('m1', { type: 'defense' }),
      makeRune('m2', { type: 'crit' })
    ]
    const feedSpy = vi.spyOn(playerStore, 'tryFeedRune')
    const wrapper = mount(RuneInventoryTab)
    await nextTick()
    await findByAriaPrefix(wrapper, '强化 普通攻击符文')!.trigger('click')
    await nextTick()
    await findByAriaPrefix(wrapper, '选择材料 普通防御符文')!.trigger('click')
    await nextTick()
    expect(wrapper.find('[aria-label="强化预览"]').exists()).toBe(true)
    return { playerStore, wrapper, feedSpy }
  }

  async function expectMaterialInvalidated(
    wrapper: ReturnType<typeof mount>,
    feedSpy: ReturnType<typeof vi.spyOn>
  ) {
    await nextTick()
    await nextTick()
    // 面板保持打开、预览消失、确认禁用、事务 0 次
    expect(wrapper.find('[aria-label="强化符文"]').exists()).toBe(true)
    expect(wrapper.find('[aria-label="强化预览"]').exists()).toBe(false)
    const confirmBtn = findByAriaPrefix(wrapper, '确认强化')
    expect(confirmBtn).toBeTruthy()
    expect(confirmBtn!.attributes('disabled')).toBeDefined()
    expect(feedSpy).not.toHaveBeenCalled()
  }

  it('已选材料被镶嵌 → 清空选择、预览消失、确认禁用、面板保持打开、事务 0 次', async () => {
    const { playerStore, wrapper, feedSpy } = await setupPanelWithSelectedMaterial()
    playerStore.player.equipment[SLOT_A] = makeRuneEquip('eq1', SLOT_A, { runeSlots: slotsWith('m1') })
    await expectMaterialInvalidated(wrapper, feedSpy)
  })

  it('已选材料 exp 从 0 变为 1 → 清空选择、预览消失、确认禁用、事务 0 次', async () => {
    const { playerStore, wrapper, feedSpy } = await setupPanelWithSelectedMaterial()
    playerStore.runeInventory = [
      makeRune('t1', { level: 2 }),
      makeRune('m1', { type: 'defense', exp: 1 }),
      makeRune('m2', { type: 'crit' })
    ]
    await expectMaterialInvalidated(wrapper, feedSpy)
  })

  it('已选材料 level 从 1 变为 2 → 清空选择、预览消失、确认禁用、事务 0 次', async () => {
    const { playerStore, wrapper, feedSpy } = await setupPanelWithSelectedMaterial()
    playerStore.runeInventory = [
      makeRune('t1', { level: 2 }),
      makeRune('m1', { type: 'defense', level: 2 }),
      makeRune('m2', { type: 'crit' })
    ]
    await expectMaterialInvalidated(wrapper, feedSpy)
  })

  it('已选材料从 inventory 消失 → 清空选择、预览消失、确认禁用、事务 0 次', async () => {
    const { playerStore, wrapper, feedSpy } = await setupPanelWithSelectedMaterial()
    playerStore.runeInventory = [makeRune('t1', { level: 2 }), makeRune('m2', { type: 'crit' })]
    await expectMaterialInvalidated(wrapper, feedSpy)
  })
})
