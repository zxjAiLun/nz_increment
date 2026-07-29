// @vitest-environment jsdom
/**
 * Phase 3.15 — Rune 手动多选批量锁定／解锁、单事务应用与身份稳定闭环
 *
 * 仅覆盖（§28-§37）：
 *   A. planRuneBatchLockChange 成功矩阵（§3/§4/§5/§6/§7/§8/§9）
 *   B. planRuneBatchLockChange 拒绝矩阵（§3/§4/§5）
 *   C. 单 Rune 规划器等于批量核心一元投影（§10）＋ reason 不回归
 *   D. trySetRunesLocked 批量原子事务（§11-§19）：成功/部分/幂等/拒绝/保存失败回滚/
 *      拓扑不变/单原始快照有界读取
 *   E. trySetRuneLocked 一元委托（§19）：成功/reason 措辞映射/幂等零写盘
 *   F. RuneInventoryTab 批量锁定面板（§20-§27）：手动多选/无全选/目标态/单事务确认/
 *      失败保持面板/互斥/身份稳定不被筛选清除
 *
 * Phase 3.15.1 验收收口（仅测试文件改动）：
 *   G. planner 输出防篡改矩阵（受控 planner override，§3）
 *   H. planner 输入异常 Proxy fail-closed 矩阵（§4）
 *   I. Store raw snapshot 时变 Proxy（第二读抛异常/变值不混入事务，§5）
 *   J. topology 非法/漂移/抛异常回滚（真实触达对应门，§6）
 *   K. 保存失败双分支（saveGame 返回 false / 异常进入 outer catch，§7）
 *   L. 旧档缺字段与额外字段形状保留（Object.keys / hasOwnProperty 级断言，§8）
 *   M. UI 目标态真实切换（changed identity 交换）/ 无障碍 / 失败与异常（§9-§11）
 *   N. UI 真实双向面板互斥 / identity 完整矩阵 / 响应式变化（§12-§14）
 *
 * 不修改生产事务 / planner / balance 公式与报告；不触及 phase312/phase314 之外的实现。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'

// ---------------------------------------------------------------------------
// Phase 3.15.1 §2：受控 planner / topology override（hoisted mock）。
// 默认全部走真实实现；beforeEach/afterEach 清空 override。
// 不给生产代码增加任何全局 test hook。
// ---------------------------------------------------------------------------
const plannerMockState = vi.hoisted(() => ({
  batchOverride: null as
    | null
    | ((input: unknown, actual: typeof import('../utils/runeLocking')) => unknown)
}))

const topoMockState = vi.hoisted(() => ({
  override: null as
    | null
    | ((
        equipment: unknown,
        inventory: unknown,
        actual: typeof import('../utils/equipmentRunes')
      ) => unknown)
}))

const snapMockState = vi.hoisted(() => ({
  override: null as
    | null
    | ((refs: unknown, actual: typeof import('../utils/runeFeeding')) => unknown)
}))

vi.mock('../utils/runeLocking', async importOriginal => {
  const actual = await importOriginal<typeof import('../utils/runeLocking')>()
  return {
    ...actual,
    planRuneBatchLockChange: (
      input: Parameters<typeof actual.planRuneBatchLockChange>[0]
    ): ReturnType<typeof actual.planRuneBatchLockChange> =>
      plannerMockState.batchOverride
        ? (plannerMockState.batchOverride(input, actual) as ReturnType<
            typeof actual.planRuneBatchLockChange
          >)
        : actual.planRuneBatchLockChange(input)
  }
})

vi.mock('../utils/equipmentRunes', async importOriginal => {
  const actual = await importOriginal<typeof import('../utils/equipmentRunes')>()
  return {
    ...actual,
    validatePlayerRuneReferenceTopology: (
      ...args: Parameters<typeof actual.validatePlayerRuneReferenceTopology>
    ): ReturnType<typeof actual.validatePlayerRuneReferenceTopology> =>
      topoMockState.override
        ? (topoMockState.override(args[0], args[1], actual) as ReturnType<
            typeof actual.validatePlayerRuneReferenceTopology
          >)
        : actual.validatePlayerRuneReferenceTopology(...args)
  }
})

vi.mock('../utils/runeFeeding', async importOriginal => {
  const actual = await importOriginal<typeof import('../utils/runeFeeding')>()
  return {
    ...actual,
    buildRuneTopologySnapshot: (
      ...args: Parameters<typeof actual.buildRuneTopologySnapshot>
    ): ReturnType<typeof actual.buildRuneTopologySnapshot> =>
      snapMockState.override
        ? (snapMockState.override(args[0], actual) as ReturnType<
            typeof actual.buildRuneTopologySnapshot
          >)
        : actual.buildRuneTopologySnapshot(...args)
  }
})
import { createPinia, setActivePinia } from 'pinia'
import { usePlayerStore, type RuneBatchLockTransactionResult } from './playerStore'
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
  planRuneBatchLockChange,
  planRuneLockChange
} from '../utils/runeLocking'
import { createEmptyEquipmentRuneSlots, getPlayerEquipmentRuneBonuses } from '../utils/equipmentRunes'
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
}

function runeEquals(a: Rune, b: Rune): boolean {
  return (
    a.id === b.id &&
    a.type === b.type &&
    a.rarity === b.rarity &&
    a.level === b.level &&
    a.exp === b.exp &&
    a.statValue === b.statValue &&
    (a.isLocked === true) === (b.isLocked === true)
  )
}

const lockSelect = 'select[aria-label="按锁定状态筛选"]'

beforeEach(() => {
  plannerMockState.batchOverride = null
  topoMockState.override = null
  snapMockState.override = null
  setActivePinia(createPinia())
  localStorage.clear()
  warmupStores()
})

afterEach(() => {
  plannerMockState.batchOverride = null
  topoMockState.override = null
  snapMockState.override = null
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

// ============================================================================
// A. planRuneBatchLockChange 成功矩阵（§3/§4/§5/§6/§7/§8/§9）
// ============================================================================
describe('Phase 3.15 — planRuneBatchLockChange 成功矩阵', () => {
  const inventory = () => [
    makeRune('r0', { type: 'attack', rarity: 'epic', statValue: 20, isLocked: false }),
    makeRune('r1', { type: 'defense', rarity: 'common', statValue: 12, isLocked: false }),
    makeRune('r2', { type: 'luck', rarity: 'rare', statValue: 15, isLocked: true }),
    makeRune('r3', { type: 'crit', rarity: 'epic', statValue: 30, isLocked: true })
  ]

  it('批量锁定若干未锁定符文：ok、changedCount、nextRunes 仅 isLocked=true、其余字段不变', () => {
    const inv = inventory()
    const plan = planRuneBatchLockChange({ inventory: inv, runeIds: ['r0', 'r1'], isLocked: true })
    expect(plan.ok).toBe(true)
    if (!plan.ok) throw new Error('expected ok')
    expect(plan.isLocked).toBe(true)
    expect(plan.selectedCount).toBe(2)
    expect(plan.changedCount).toBe(2)
    expect(plan.unchangedCount).toBe(0)
    expect(plan.selectedIndices).toEqual([0, 1])
    expect(plan.changedIndices).toEqual([0, 1])
    expect(plan.changedRuneIds).toEqual(['r0', 'r1'])
    // nextRune 仅 isLocked 变化，其余字段与原始一致（排除 isLocked 对拍）
    for (let i = 0; i < plan.selectedIndices.length; i++) {
      const nxt = plan.nextRunes[i]
      const orig = inv[plan.selectedIndices[i]]
      expect(nxt.isLocked).toBe(true)
      expect(nxt.id).toBe(orig.id)
      expect(nxt.type).toBe(orig.type)
      expect(nxt.rarity).toBe(orig.rarity)
      expect(nxt.level).toBe(orig.level)
      expect(nxt.exp).toBe(orig.exp)
      expect(nxt.statValue).toBe(orig.statValue)
    }
  })

  it('批量解锁若干已锁定符文：nextRunes isLocked=false、changedCount 正确', () => {
    const inv = inventory()
    const plan = planRuneBatchLockChange({ inventory: inv, runeIds: ['r2', 'r3'], isLocked: false })
    expect(plan.ok).toBe(true)
    if (!plan.ok) throw new Error('expected ok')
    expect(plan.isLocked).toBe(false)
    expect(plan.selectedCount).toBe(2)
    expect(plan.changedCount).toBe(2)
    expect(plan.selectedIndices).toEqual([2, 3])
    expect(plan.changedRuneIds).toEqual(['r2', 'r3'])
    for (const nxt of plan.nextRunes) expect(nxt.isLocked).toBe(false)
  })

  it('混合：部分已处于目标态 → changed/unchanged 分类正确（§7）', () => {
    const inv = inventory()
    // 目标锁定：r0(未锁→变)、r1(未锁→变)、r2(已锁→不变)、r3(已锁→不变)
    const plan = planRuneBatchLockChange({ inventory: inv, runeIds: ['r0', 'r1', 'r2', 'r3'], isLocked: true })
    expect(plan.ok).toBe(true)
    if (!plan.ok) throw new Error('expected ok')
    expect(plan.selectedCount).toBe(4)
    expect(plan.changedCount).toBe(2)
    expect(plan.unchangedCount).toBe(2)
    expect(plan.selectedIndices).toEqual([0, 1, 2, 3])
    expect(plan.changedIndices).toEqual([0, 1])
    expect(plan.changedRuneIds).toEqual(['r0', 'r1'])
    expect(plan.unchangedRuneIds).toEqual(['r2', 'r3'])
    // unchanged 位置 nextRune 与 selectedRune 等值
    expect(plan.nextRunes[2].isLocked).toBe(true)
    expect(plan.nextRunes[3].isLocked).toBe(true)
  })

  it('全部已处于目标态 → ok、changedCount=0、unchangedCount=selectedCount（幂等，§7/§16）', () => {
    const inv = inventory()
    const plan = planRuneBatchLockChange({ inventory: inv, runeIds: ['r2', 'r3'], isLocked: true })
    expect(plan.ok).toBe(true)
    if (!plan.ok) throw new Error('expected ok')
    expect(plan.changedCount).toBe(0)
    expect(plan.unchangedCount).toBe(2)
    expect(plan.changedRuneIds).toEqual([])
    expect(plan.unchangedRuneIds).toEqual(['r2', 'r3'])
  })

  it('调用方 ID 顺序无关：倒序传入 → selectedIndices 仍按 inventoryIndex 升序（§6）', () => {
    const inv = inventory()
    const forward = planRuneBatchLockChange({ inventory: inv, runeIds: ['r3', 'r1', 'r2', 'r0'], isLocked: true })
    const backward = planRuneBatchLockChange({ inventory: inv, runeIds: ['r0', 'r2', 'r1', 'r3'], isLocked: true })
    expect(forward.ok && backward.ok).toBe(true)
    if (!forward.ok || !backward.ok) throw new Error('expected ok')
    expect(forward.selectedIndices).toEqual([0, 1, 2, 3])
    expect(backward.selectedIndices).toEqual([0, 1, 2, 3])
    expect(forward.changedRuneIds).toEqual(backward.changedRuneIds)
    expect(forward.unchangedRuneIds).toEqual(backward.unchangedRuneIds)
  })

  it('输出数组全部冻结且为深拷贝（不共享输入对象引用，§9）', () => {
    const inv = inventory()
    const plan = planRuneBatchLockChange({ inventory: inv, runeIds: ['r0', 'r1'], isLocked: true })
    expect(plan.ok).toBe(true)
    if (!plan.ok) throw new Error('expected ok')
    for (const arr of [
      plan.selectedIndices,
      plan.selectedRunes,
      plan.nextRunes,
      plan.selectedRuneIds,
      plan.changedIndices,
      plan.changedRuneIds,
      plan.unchangedRuneIds
    ] as readonly unknown[]) {
      expect(Object.isFrozen(arr)).toBe(true)
    }
    // nextRunes 不与原始 rune 共享引用
    expect(plan.nextRunes[0]).not.toBe(inv[0])
    expect(plan.nextRunes[0].id).toBe(inv[0].id)
  })

  it('纯函数：不修改入参 inventory / runeIds / rune 对象（§3/§5）', () => {
    const inv = inventory()
    const runeIds = ['r0', 'r1']
    const invSnapshot = JSON.stringify(inv)
    const idsSnapshot = JSON.stringify(runeIds)
    planRuneBatchLockChange({ inventory: inv, runeIds, isLocked: true })
    expect(JSON.stringify(inv)).toBe(invSnapshot)
    expect(JSON.stringify(runeIds)).toBe(idsSnapshot)
  })
})

// ============================================================================
// B. planRuneBatchLockChange 拒绝矩阵（§3/§4/§5）
// ============================================================================
describe('Phase 3.15 — planRuneBatchLockChange 拒绝矩阵', () => {
  const inventory = () => [
    makeRune('r0', { isLocked: false }),
    makeRune('r1', { isLocked: true })
  ]
  function reject(input: Parameters<typeof planRuneBatchLockChange>[0], reason: string) {
    const plan = planRuneBatchLockChange(input)
    expect(plan.ok).toBe(false)
    if (plan.ok) throw new Error('expected rejected')
    expect(plan.reason).toBe(reason)
  }

  it('runeIds 非数组 → 拒绝', () => {
    reject({ inventory: inventory(), runeIds: 'r0', isLocked: true }, 'runeIds must be an array')
  })
  it('空数组 → 拒绝', () => {
    reject({ inventory: inventory(), runeIds: [], isLocked: true }, 'runeIds must contain at least one id')
  })
  it('稀疏数组（含空洞）→ 拒绝', () => {
    const sparse = new Array(3) as string[]
    sparse[0] = 'r0'
    sparse[2] = 'r1'
    reject({ inventory: inventory(), runeIds: sparse, isLocked: true }, 'runeIds must not contain sparse holes')
  })
  it('非字符串项 → 拒绝', () => {
    reject({ inventory: inventory(), runeIds: ['r0', 42 as unknown as string], isLocked: true }, 'runeIds items must be strings')
  })
  it('空白字符串项 → 拒绝', () => {
    reject({ inventory: inventory(), runeIds: ['r0', '   '], isLocked: true }, 'runeIds items must be non-empty after trim')
  })
  it('canonical 重复（"r0" 与 " r0 "）→ 拒绝', () => {
    reject({ inventory: inventory(), runeIds: ['r0', ' r0 '], isLocked: true }, 'runeIds contain duplicate canonical id')
  })
  it('isLocked 非严格 boolean 一律拒绝（1/0/"true"/null/undefined）', () => {
    reject({ inventory: inventory(), runeIds: ['r0'], isLocked: 1 as unknown as boolean }, 'isLocked must be a boolean')
    reject({ inventory: inventory(), runeIds: ['r0'], isLocked: 0 as unknown as boolean }, 'isLocked must be a boolean')
    reject({ inventory: inventory(), runeIds: ['r0'], isLocked: 'true' as unknown as boolean }, 'isLocked must be a boolean')
    reject({ inventory: inventory(), runeIds: ['r0'], isLocked: null as unknown as boolean }, 'isLocked must be a boolean')
    reject({ inventory: inventory(), runeIds: ['r0'], isLocked: undefined as unknown as boolean }, 'isLocked must be a boolean')
  })
  it('Rune ID 不在 inventory → 拒绝', () => {
    reject({ inventory: inventory(), runeIds: ['missing'], isLocked: true }, 'rune not found in inventory')
  })
  it('inventory 含重复 ID（校验失败）→ 拒绝', () => {
    const dup = [makeRune('d', { isLocked: false }), makeRune('d', { isLocked: false })]
    const plan = planRuneBatchLockChange({ inventory: dup, runeIds: ['d'], isLocked: true })
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.reason.startsWith('inventory invalid')).toBe(true)
  })
  it('inventory 非法（非数组）→ 拒绝', () => {
    const plan = planRuneBatchLockChange({ inventory: 'nope', runeIds: ['r0'], isLocked: true })
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.reason.startsWith('inventory invalid')).toBe(true)
  })
  it('入参非对象 → 拒绝', () => {
    const plan = planRuneBatchLockChange(null as unknown as Parameters<typeof planRuneBatchLockChange>[0])
    expect(plan.ok).toBe(false)
    if (plan.ok) throw new Error('expected rejected')
    expect(plan.reason).toBe('input must be a non-null object')
  })
  it('length 读取一次、每个 raw index 至多读取一次（§3 有界读取，时变 Proxy 计数）', () => {
    const items = ['r0', 'r1']
    const getReads: Record<string, number> = { length: 0 }
    const proxy = new Proxy(items, {
      get(target, prop, receiver) {
        if (prop === 'length') {
          getReads.length++
        } else if (typeof prop === 'string' && /^\d+$/.test(prop)) {
          getReads[prop] = (getReads[prop] ?? 0) + 1
        }
        return Reflect.get(target, prop, receiver)
      }
    })
    const plan = planRuneBatchLockChange({ inventory: inventory(), runeIds: proxy as unknown as string[], isLocked: true })
    expect(plan.ok).toBe(true)
    expect(getReads.length).toBe(1)
    expect(getReads['0']).toBe(1)
    expect(getReads['1']).toBe(1)
  })
  it('inventory 仅 canonical 读取一次（§5：canonical 单次校验，数组 Proxy 计数为每元素 1 次）', () => {
    const raw = inventory()
    const invReads: Record<string, number> = { length: 0 }
    const proxy = new Proxy(raw, {
      get(target, prop, receiver) {
        if (prop === 'length') {
          invReads.length++
        } else if (typeof prop === 'string' && /^\d+$/.test(prop)) {
          invReads[prop] = (invReads[prop] ?? 0) + 1
        }
        return Reflect.get(target, prop, receiver)
      }
    })
    const plan = planRuneBatchLockChange({ inventory: proxy as unknown as Rune[], runeIds: ['r0', 'r1'], isLocked: true })
    expect(plan.ok).toBe(true)
    // §5 canonical 单次校验：每个 Rune 元素仅被读取一次（validateRuneInventory 只整体遍历一遍；
    // length 由循环多次读取，此处只断言有界且每元素恰好一次，证明无逐元素重复/无限读取）
    expect(invReads.length).toBeGreaterThanOrEqual(1)
    expect(invReads.length).toBeLessThanOrEqual(4)
    expect(invReads['0']).toBe(1)
    expect(invReads['1']).toBe(1)
  })
})

// ============================================================================
// C. 单 Rune 规划器等于批量核心一元投影（§10）＋ reason 不回归
// ============================================================================
describe('Phase 3.15 — planRuneLockChange 与 planRuneBatchLockChange 一致性', () => {
  const inventory = () => [
    makeRune('r0', { type: 'attack', rarity: 'epic', statValue: 20, isLocked: false }),
    makeRune('r1', { type: 'defense', rarity: 'common', statValue: 12, isLocked: true })
  ]
  it('单 Rune 规划结果等于批量[runeId] 投影（changed/targetIndex/targetRune/nextRune）', () => {
    const inv = inventory()
    const single = planRuneLockChange({ inventory: inv, runeId: 'r0', isLocked: true })
    const batch = planRuneBatchLockChange({ inventory: inv, runeIds: ['r0'], isLocked: true })
    expect(single.ok && batch.ok).toBe(true)
    if (!single.ok || !batch.ok) throw new Error('expected ok')
    expect(single.changed).toBe(true)
    expect(single.targetIndex).toBe(0)
    expect(single.targetRune.id).toBe(batch.selectedRunes[0].id)
    expect(single.nextRune.id).toBe(batch.nextRunes[0].id)
    expect(single.nextRune.isLocked).toBe(batch.nextRunes[0].isLocked)
    expect(runeEquals(single.nextRune, batch.nextRunes[0])).toBe(true)
  })
  it('单 Rune 拒绝 reason 措辞不回归（与 3.12 一致）', () => {
    expect(planRuneLockChange({ inventory: inventory(), runeId: 42 as unknown as string, isLocked: true }).ok).toBe(false)
    const r1 = planRuneLockChange({ inventory: inventory(), runeId: 'missing', isLocked: true })
    expect(r1.ok).toBe(false)
    if (r1.ok) throw new Error('expected rejected')
    expect(r1.reason).toBe('rune not found in inventory')
    const r2 = planRuneLockChange({ inventory: inventory(), runeId: 'r0', isLocked: 1 as unknown as boolean })
    expect(r2.ok).toBe(false)
    if (r2.ok) throw new Error('expected rejected')
    expect(r2.reason).toBe('isLocked must be a boolean')
  })
})

// ============================================================================
// D. trySetRunesLocked 批量原子事务（§11-§19）
// ============================================================================
describe('Phase 3.15 — trySetRunesLocked 批量原子事务', () => {
  it('批量锁定多枚：ok、changedCount、单次写主存档、持久化、他者不变、顺序不变', () => {
    const playerStore = usePlayerStore()
    const a = makeRune('a', { rarity: 'rare', level: 2, statValue: 13, isLocked: false })
    const b = makeRune('b', { type: 'luck', isLocked: false })
    const c = makeRune('c', { type: 'crit', rarity: 'epic', isLocked: true })
    playerStore.runeInventory = [a, b, c]
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    const res = playerStore.trySetRunesLocked(['a', 'b'], true)
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error('expected ok')
    expect(res.isLocked).toBe(true)
    expect(res.selectedCount).toBe(2)
    expect(res.changedCount).toBe(2)
    expect(res.unchangedCount).toBe(0)
    expect(playerStore.runeInventory.map(r => r.id)).toEqual(['a', 'b', 'c'])
    expect(playerStore.runeInventory.find(r => r.id === 'a')!.isLocked).toBe(true)
    expect(playerStore.runeInventory.find(r => r.id === 'b')!.isLocked).toBe(true)
    expect(playerStore.runeInventory.find(r => r.id === 'c')!.isLocked).toBe(true)
    const saveWrites = setItemSpy.mock.calls.filter(c => c[0] === SAVE_KEY)
    expect(saveWrites.length).toBe(1)

    setActivePinia(createPinia())
    warmupStores()
    const reloaded = usePlayerStore()
    reloaded.loadGame()
    expect(reloaded.runeInventory.find(r => r.id === 'a')!.isLocked).toBe(true)
    expect(reloaded.runeInventory.find(r => r.id === 'b')!.isLocked).toBe(true)
    expect(reloaded.runeInventory.find(r => r.id === 'c')!.isLocked).toBe(true)
  })

  it('批量解锁多枚已锁定符文：isLocked=false、持久化', () => {
    const playerStore = usePlayerStore()
    playerStore.runeInventory = [
      makeRune('a', { isLocked: true }),
      makeRune('b', { isLocked: true }),
      makeRune('c', { isLocked: false })
    ]
    const res = playerStore.trySetRunesLocked(['a', 'b'], false)
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error('expected ok')
    expect(res.isLocked).toBe(false)
    expect(res.changedCount).toBe(2)
    expect(res.unchangedCount).toBe(0)
    expect(playerStore.runeInventory.find(r => r.id === 'a')!.isLocked).toBe(false)
    expect(playerStore.runeInventory.find(r => r.id === 'b')!.isLocked).toBe(false)
    expect(playerStore.runeInventory.find(r => r.id === 'c')!.isLocked).toBe(false)
  })

  it('混合部分已处于目标态：changedCount 仅计实际变化、changed/unchanged ID 正确', () => {
    const playerStore = usePlayerStore()
    playerStore.runeInventory = [
      makeRune('a', { isLocked: false }),
      makeRune('b', { isLocked: false }),
      makeRune('c', { isLocked: true })
    ]
    const res = playerStore.trySetRunesLocked(['a', 'b', 'c'], true)
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error('expected ok')
    expect(res.changedCount).toBe(2)
    expect(res.unchangedCount).toBe(1)
    expect([...res.changedRuneIds]).toEqual(['a', 'b'])
    expect([...res.unchangedRuneIds]).toEqual(['c'])
  })

  it('全部已处于目标态 → ok、changedCount=0、零写盘、内存零修改（§16）', () => {
    const playerStore = usePlayerStore()
    playerStore.runeInventory = [makeRune('a', { isLocked: true }), makeRune('b', { isLocked: true })]
    const before = playerStore.runeInventory.map(r => ({ ...r }))
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    const res = playerStore.trySetRunesLocked(['a', 'b'], true)
    expect(res.ok).toBe(true)
    expect(res.changedCount).toBe(0)
    expect(setItemSpy.mock.calls.filter(c => c[0] === SAVE_KEY).length).toBe(0)
    for (let i = 0; i < before.length; i++) {
      expect(runeEquals(playerStore.runeInventory[i], before[i])).toBe(true)
    }
  })

  it('规划失败（Rune 不存在）→ ok:false、零修改零写盘', () => {
    const playerStore = usePlayerStore()
    playerStore.runeInventory = [makeRune('a')]
    const before = playerStore.runeInventory.map(r => ({ ...r }))
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    const res = playerStore.trySetRunesLocked(['missing'], true)
    expect(res.ok).toBe(false)
    expect(setItemSpy.mock.calls.filter(c => c[0] === SAVE_KEY).length).toBe(0)
    for (let i = 0; i < before.length; i++) {
      expect(runeEquals(playerStore.runeInventory[i], before[i])).toBe(true)
    }
  })

  it('saveGame 返回 false（setItem 抛异常被 saveGame 内部捕获）→ 完整回滚 + 磁盘原内容不变；恢复后可重放成功', () => {
    const playerStore = usePlayerStore()
    const other = makeRune('o1', { rarity: 'epic', level: 4, statValue: 20, isLocked: false })
    const t1 = makeRune('t1', { isLocked: false })
    const t2 = makeRune('t2', { isLocked: false })
    playerStore.runeInventory = [other, t1, t2]
    playerStore.saveGame()
    const diskBefore = localStorage.getItem(SAVE_KEY)
    const before = playerStore.runeInventory.map(r => ({ ...r }))

    installThrowingStorage()
    const res = playerStore.trySetRunesLocked(['t1', 't2'], true)
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('expected rejected')
    expect(res.changedCount).toBe(0)
    expect(playerStore.runeInventory.length).toBe(3)
    for (let i = 0; i < before.length; i++) {
      expect(runeEquals(playerStore.runeInventory[i], before[i])).toBe(true)
    }
    expect(localStorage.getItem(SAVE_KEY)).toBe(diskBefore)

    vi.unstubAllGlobals()
    const okRes = playerStore.trySetRunesLocked(['t1', 't2'], true)
    expect(okRes.ok).toBe(true)
    if (!okRes.ok) throw new Error('expected ok')
    expect(playerStore.runeInventory.find(r => r.id === 't1')!.isLocked).toBe(true)
    expect(playerStore.runeInventory.find(r => r.id === 't2')!.isLocked).toBe(true)
  })

  it('锁定已镶嵌 Rune：装备拓扑不变、聚合符文加成不变（§11 锁定不影响属性）', () => {
    const playerStore = usePlayerStore()
    const target = makeRune('t1', { type: 'attack', statValue: 10, isLocked: false })
    playerStore.runeInventory = [target, makeRune('t2', { isLocked: false })]
    playerStore.player.equipment[SLOT_A] = makeRuneEquip('eq1', SLOT_A, { runeSlots: slotsWith('t1') })
    const bonusBefore = getPlayerEquipmentRuneBonuses(playerStore.player.equipment, playerStore.runeInventory)
    const res = playerStore.trySetRunesLocked(['t1'], true)
    expect(res.ok).toBe(true)
    const eq = playerStore.player.equipment[SLOT_A]!
    expect(eq.runeSlots[0].runeId).toBe('t1')
    expect(eq.runeSlots[1].runeId).toBeNull()
    const bonusAfter = getPlayerEquipmentRuneBonuses(playerStore.player.equipment, playerStore.runeInventory)
    expect(bonusAfter).toEqual(bonusBefore)
  })

  it('他枚 Rune 字段与相对顺序完全不变（单事务一次性应用，§12/§15）', () => {
    const playerStore = usePlayerStore()
    const a = makeRune('a', { rarity: 'rare', level: 2, statValue: 13, isLocked: true })
    const b = makeRune('b', { type: 'luck', isLocked: false })
    const c = makeRune('c', { type: 'crit', rarity: 'epic', statValue: 25, isLocked: false })
    playerStore.runeInventory = [a, b, c]
    const res = playerStore.trySetRunesLocked(['b', 'c'], true)
    expect(res.ok).toBe(true)
    expect(playerStore.runeInventory.map(r => r.id)).toEqual(['a', 'b', 'c'])
    expect(runeEquals(playerStore.runeInventory[0], a)).toBe(true)
    expect(runeEquals(playerStore.runeInventory[1], { ...b, isLocked: true })).toBe(true)
    expect(runeEquals(playerStore.runeInventory[2], { ...c, isLocked: true })).toBe(true)
  })
})

// ============================================================================
// E. trySetRuneLocked 一元委托（§19）
// ============================================================================
describe('Phase 3.15 — trySetRuneLocked 委托 trySetRunesLocked', () => {
  it('单 Rune 锁定成功：changed/isLocked 正确、单次写盘', () => {
    const playerStore = usePlayerStore()
    playerStore.runeInventory = [makeRune('a', { isLocked: false }), makeRune('b', { isLocked: false })]
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    const res = playerStore.trySetRuneLocked('a', true)
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error('expected ok')
    expect(res.changed).toBe(true)
    expect(res.isLocked).toBe(true)
    expect(setItemSpy.mock.calls.filter(c => c[0] === SAVE_KEY).length).toBe(1)
    expect(playerStore.runeInventory.find(r => r.id === 'a')!.isLocked).toBe(true)
  })

  it('reason 措辞映射回 3.12 文案（单值入参语义不变）', () => {
    const playerStore = usePlayerStore()
    playerStore.runeInventory = [makeRune('a')]
    const r1 = playerStore.trySetRuneLocked(42 as unknown as string, true)
    expect(r1.ok).toBe(false)
    if (r1.ok) throw new Error('expected rejected')
    expect(r1.reason).toBe('runeId must be a string')

    const r2 = playerStore.trySetRuneLocked('  ', true)
    expect(r2.ok).toBe(false)
    if (r2.ok) throw new Error('expected rejected')
    expect(r2.reason).toBe('runeId must be non-empty after trim')

    const r3 = playerStore.trySetRuneLocked('missing', true)
    expect(r3.ok).toBe(false)
    if (r3.ok) throw new Error('expected rejected')
    expect(r3.reason).toBe('rune not found in inventory')
  })

  it('单 Rune 已处于目标态 → changed:false、零写盘', () => {
    const playerStore = usePlayerStore()
    playerStore.runeInventory = [makeRune('a', { isLocked: true })]
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    const res = playerStore.trySetRuneLocked('a', true)
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error('expected ok')
    expect(res.changed).toBe(false)
    expect(setItemSpy.mock.calls.filter(c => c[0] === SAVE_KEY).length).toBe(0)
  })
})

// ============================================================================
// F. RuneInventoryTab 批量锁定面板（§20-§27）
// ============================================================================
describe('Phase 3.15 — RuneInventoryTab 批量锁定面板', () => {
  function setupInventory(runes: Rune[]) {
    const playerStore = usePlayerStore()
    playerStore.runeInventory = runes
    return playerStore
  }

  /** 批量面板内的候选逐枚选择按钮（按 inventoryIndex 升序）；每次交互后需重新查询（wrapper 快照不可变）。 */
  function cands(wrapper: ReturnType<typeof mount>) {
    const list = wrapper.find('.batch-lock-list')
    return list.exists() ? list.findAll('button') : []
  }

  it('入口按钮打开面板；候选=完整仓库（不受外层筛选）；无全选/反选/自动选择（§20/§22）', async () => {
    const playerStore = setupInventory([
      makeRune('a', { isLocked: false }),
      makeRune('b', { type: 'luck', isLocked: true }),
      makeRune('c', { type: 'crit', isLocked: false })
    ])
    const wrapper = mount(RuneInventoryTab)
    // 外层筛选只显示未锁定，但批量面板候选应是完整仓库
    await wrapper.find(lockSelect).setValue('unlocked')
    await nextTick()

    const entry = findByAriaPrefix(wrapper, '打开批量锁定管理')
    expect(entry).not.toBeNull()
    await entry!.trigger('click')
    await nextTick()

    const panel = wrapper.find('.batch-lock-panel')
    expect(panel.exists()).toBe(true)
    const candidateButtons = cands(wrapper)
    // 候选按钮数 = 仓库符文数（手动逐枚选择按钮）
    expect(candidateButtons.length).toBe(3)
    // 无全选 / 反选 / 自动选择控件
    for (const btn of candidateButtons) {
      const label = btn.attributes('aria-label') ?? ''
      expect(label.includes('全选')).toBe(false)
      expect(label.includes('反选')).toBe(false)
      expect(label.includes('自动选择')).toBe(false)
    }
    void playerStore
  })

  it('手动逐枚选择 + 预览 changedCount + 确认不禁用（§22/§24）', async () => {
    setupInventory([
      makeRune('a', { isLocked: false }),
      makeRune('b', { type: 'luck', isLocked: true })
    ])
    const wrapper = mount(RuneInventoryTab)
    await findByAriaPrefix(wrapper, '打开批量锁定管理')!.trigger('click')
    await nextTick()

    // 选择未锁定的 a → 目标默认锁定 → changedCount=1
    let list = cands(wrapper)
    await list[0].trigger('click')
    await nextTick()
    expect(cands(wrapper)[0].attributes('data-selected')).toBe('true')

    expect(wrapper.find('.batch-lock-summary').text()).toContain('将改变 1 枚')
    expect(findByAriaPrefix(wrapper, '确认批量操作')!.attributes('disabled')).toBeUndefined()

    // 再选已锁定的 b，目标锁定 → b 不变 → changedCount 仍为 1
    list = cands(wrapper)
    await list[1].trigger('click')
    await nextTick()
    expect(wrapper.find('.batch-lock-summary').text()).toContain('将改变 1 枚')
  })

  it('目标态真实切换（3.15.1 §9）：锁定→解锁后实际变化 identity 从 a 交换为 b，选择保持，再切回锁定', async () => {
    // a = 未锁定（普通攻击符文），b = 已锁定（普通幸运符文）
    setupInventory([
      makeRune('a', { isLocked: false }),
      makeRune('b', { type: 'luck', isLocked: true })
    ])
    const wrapper = mount(RuneInventoryTab)
    await findByAriaPrefix(wrapper, '打开批量锁定管理')!.trigger('click')
    await nextTick()

    // 先选中 a、b
    let list = cands(wrapper)
    await list[0].trigger('click')
    await nextTick()
    list = cands(wrapper)
    await list[1].trigger('click')
    await nextTick()

    // 默认目标「锁定」：a(未锁)→changed、b(已锁)→unchanged
    let summaryEl = wrapper.find('.batch-lock-summary')
    expect(summaryEl.text()).toContain('已选择 2 枚')
    expect(summaryEl.text()).toContain('目标状态：锁定')
    expect(summaryEl.text()).toContain('将改变 1 枚')
    expect(summaryEl.text()).toContain('已处于目标状态 1 枚')
    expect(summaryEl.text()).toContain('实际变化：普通攻击符文')
    expect(summaryEl.text()).not.toContain('幸运符文')
    let confirm = findByAriaPrefix(wrapper, '确认批量操作')!
    expect(confirm.attributes('aria-label')).toBe('确认批量操作，将锁定 1 枚符文')

    // 不清空选择，真实 select 交互切换目标态为「解锁」
    await wrapper.find('select[aria-label="选择批量锁定目标状态"]').setValue('false')
    await nextTick()

    // 选择保持：a、b 均 aria-pressed=true
    list = cands(wrapper)
    expect(list[0].attributes('aria-pressed')).toBe('true')
    expect(list[1].attributes('aria-pressed')).toBe('true')
    // identity 交换：目标解锁下 b(已锁)→changed、a(未锁)→unchanged
    summaryEl = wrapper.find('.batch-lock-summary')
    expect(summaryEl.text()).toContain('目标状态：解锁')
    expect(summaryEl.text()).toContain('将改变 1 枚')
    expect(summaryEl.text()).toContain('已处于目标状态 1 枚')
    expect(summaryEl.text()).toContain('实际变化：普通幸运符文')
    expect(summaryEl.text()).not.toContain('攻击符文')
    confirm = findByAriaPrefix(wrapper, '确认批量操作')!
    expect(confirm.attributes('aria-label')).toBe('确认批量操作，将解锁 1 枚符文')

    // 再切回「锁定」：选择仍不得清空，实际变化回到 a
    await wrapper.find('select[aria-label="选择批量锁定目标状态"]').setValue('true')
    await nextTick()
    list = cands(wrapper)
    expect(list[0].attributes('aria-pressed')).toBe('true')
    expect(list[1].attributes('aria-pressed')).toBe('true')
    summaryEl = wrapper.find('.batch-lock-summary')
    expect(summaryEl.text()).toContain('目标状态：锁定')
    expect(summaryEl.text()).toContain('实际变化：普通攻击符文')
    expect(summaryEl.text()).not.toContain('幸运符文')
  })

  it('所选均已处于目标态 → 预览 changedCount=0 → 确认按钮 disabled（§24/§25）', async () => {
    setupInventory([
      makeRune('a', { isLocked: true }),
      makeRune('b', { type: 'luck', isLocked: true })
    ])
    const wrapper = mount(RuneInventoryTab)
    await findByAriaPrefix(wrapper, '打开批量锁定管理')!.trigger('click')
    await nextTick()
    let list = cands(wrapper)
    await list[0].trigger('click')
    await list[1].trigger('click')
    await nextTick()
    expect(wrapper.find('.batch-lock-summary').text()).toContain('将改变 0 枚')
    const confirm = findByAriaPrefix(wrapper, '确认批量操作')!
    expect(confirm.attributes('disabled')).toBeDefined()
  })

  it('确认恰好调用一次批量原子事务；成功后面板关闭（§25）', async () => {
    const playerStore = setupInventory([makeRune('a', { isLocked: false }), makeRune('b', { isLocked: false })])
    const spy = vi.spyOn(playerStore, 'trySetRunesLocked')
    const wrapper = mount(RuneInventoryTab)
    await findByAriaPrefix(wrapper, '打开批量锁定管理')!.trigger('click')
    await nextTick()

    let list = cands(wrapper)
    await list[0].trigger('click')
    await list[1].trigger('click')
    await nextTick()

    const confirm = findByAriaPrefix(wrapper, '确认批量操作')!
    expect(confirm.attributes('disabled')).toBeUndefined()
    await confirm.trigger('click')
    await nextTick()

    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0][0]).toEqual(['a', 'b'])
    expect(spy.mock.calls[0][1]).toBe(true)
    expect(wrapper.find('.batch-lock-panel').exists()).toBe(false)
    expect(wrapper.find('.feedback').text()).toContain('成功')
  })

  it('确认失败（保存抛异常）→ 面板保持、选择保持、不显示成功（§25 失败保持）', async () => {
    setupInventory([makeRune('a', { isLocked: false })])
    const wrapper = mount(RuneInventoryTab)
    await findByAriaPrefix(wrapper, '打开批量锁定管理')!.trigger('click')
    await nextTick()

    let list = cands(wrapper)
    await list[0].trigger('click')
    await nextTick()
    expect(cands(wrapper)[0].attributes('data-selected')).toBe('true')

    installThrowingStorage()
    const confirm = findByAriaPrefix(wrapper, '确认批量操作')!
    await confirm.trigger('click')
    await nextTick()

    // 面板与选择仍在
    expect(wrapper.find('.batch-lock-panel').exists()).toBe(true)
    expect(cands(wrapper)[0].attributes('data-selected')).toBe('true')
    // 失败反馈（无成功）
    expect(wrapper.find('.feedback').exists()).toBe(true)
    expect(wrapper.find('.feedback').text()).toContain('失败')
    expect(wrapper.find('.feedback').text()).not.toContain('成功')
  })

  it('真实互斥①（3.15.1 §12）：picker 已打开 → 打开批量锁定面板 → picker 关闭、零事务', async () => {
    const playerStore = setupInventory([makeRune('a', { isLocked: false })])
    const lockSpy = vi.spyOn(playerStore, 'trySetRunesLocked')
    const feedSpy = vi.spyOn(playerStore, 'tryFeedRunes')
    const wrapper = mount(RuneInventoryTab)

    // 先真正打开 picker
    await findByAriaPrefix(wrapper, '镶嵌或移动 ')!.trigger('click')
    await nextTick()
    expect(wrapper.find('.picker').exists()).toBe(true)

    // 打开批量锁定面板 → picker 必须关闭
    await findByAriaPrefix(wrapper, '打开批量锁定管理')!.trigger('click')
    await nextTick()
    expect(wrapper.find('.batch-lock-panel').exists()).toBe(true)
    expect(wrapper.find('.picker').exists()).toBe(false)
    expect(lockSpy).not.toHaveBeenCalled()
    expect(feedSpy).not.toHaveBeenCalled()
  })

  it('真实互斥②（3.15.1 §12）：强化面板已打开且已有材料选择 → 打开批量面板 → 强化关闭清空、重开为 0 选择', async () => {
    const playerStore = setupInventory([
      makeRune('t', { isLocked: false }),
      makeRune('m', { type: 'luck', isLocked: false })
    ])
    const lockSpy = vi.spyOn(playerStore, 'trySetRunesLocked')
    const feedSpy = vi.spyOn(playerStore, 'tryFeedRunes')
    const wrapper = mount(RuneInventoryTab)

    // 真正打开强化面板（目标 t）并选择材料 m
    await findByAriaPrefix(wrapper, '强化 ')!.trigger('click')
    await nextTick()
    expect(wrapper.find('.feed-panel').exists()).toBe(true)
    const matBtn = wrapper.find('.feed-materials button')
    expect(matBtn.exists()).toBe(true)
    await matBtn.trigger('click')
    await nextTick()
    expect(wrapper.find('.feed-materials button').attributes('data-selected')).toBe('true')

    // 打开批量锁定面板 → 强化面板关闭
    await findByAriaPrefix(wrapper, '打开批量锁定管理')!.trigger('click')
    await nextTick()
    expect(wrapper.find('.batch-lock-panel').exists()).toBe(true)
    expect(wrapper.find('.feed-panel').exists()).toBe(false)

    // 重新打开强化面板 → 材料选择必须从 0 开始
    await findByAriaPrefix(wrapper, '强化 ')!.trigger('click')
    await nextTick()
    expect(wrapper.find('.feed-panel').exists()).toBe(true)
    expect(wrapper.find('.batch-lock-panel').exists()).toBe(false)
    expect(wrapper.find('.feed-materials button').attributes('data-selected')).toBe('false')
    expect(lockSpy).not.toHaveBeenCalled()
    expect(feedSpy).not.toHaveBeenCalled()
  })

  it('真实互斥③（3.15.1 §12）：批量面板已打开且已有选择 → 打开 picker → 批量关闭清空、重开为 0 选择', async () => {
    const playerStore = setupInventory([
      makeRune('a', { isLocked: false }),
      makeRune('b', { type: 'luck', isLocked: false })
    ])
    const lockSpy = vi.spyOn(playerStore, 'trySetRunesLocked')
    const wrapper = mount(RuneInventoryTab)

    await findByAriaPrefix(wrapper, '打开批量锁定管理')!.trigger('click')
    await nextTick()
    await cands(wrapper)[0].trigger('click')
    await nextTick()
    expect(cands(wrapper)[0].attributes('data-selected')).toBe('true')

    // 打开 picker → 批量面板关闭
    await findByAriaPrefix(wrapper, '镶嵌或移动 ')!.trigger('click')
    await nextTick()
    expect(wrapper.find('.picker').exists()).toBe(true)
    expect(wrapper.find('.batch-lock-panel').exists()).toBe(false)

    // 重新打开批量面板 → 从 0 选择开始
    await findByAriaPrefix(wrapper, '打开批量锁定管理')!.trigger('click')
    await nextTick()
    const reopened = cands(wrapper)
    expect(reopened.length).toBe(2)
    for (const btn of reopened) expect(btn.attributes('data-selected')).toBe('false')
    expect(wrapper.find('.batch-lock-summary').text()).toContain('已选择 0 枚')
    expect(lockSpy).not.toHaveBeenCalled()
  })

  it('真实互斥④（3.15.1 §12）：批量面板已打开且已有选择 → 打开强化面板 → 批量关闭清空、重开为 0 选择', async () => {
    const playerStore = setupInventory([
      makeRune('a', { isLocked: false }),
      makeRune('b', { type: 'luck', isLocked: false })
    ])
    const lockSpy = vi.spyOn(playerStore, 'trySetRunesLocked')
    const feedSpy = vi.spyOn(playerStore, 'tryFeedRunes')
    const wrapper = mount(RuneInventoryTab)

    await findByAriaPrefix(wrapper, '打开批量锁定管理')!.trigger('click')
    await nextTick()
    await cands(wrapper)[0].trigger('click')
    await nextTick()
    await cands(wrapper)[1].trigger('click')
    await nextTick()
    expect(cands(wrapper)[0].attributes('data-selected')).toBe('true')
    expect(cands(wrapper)[1].attributes('data-selected')).toBe('true')

    // 打开强化面板 → 批量面板关闭
    await findByAriaPrefix(wrapper, '强化 ')!.trigger('click')
    await nextTick()
    expect(wrapper.find('.feed-panel').exists()).toBe(true)
    expect(wrapper.find('.batch-lock-panel').exists()).toBe(false)

    // 重新打开批量面板 → 从 0 选择开始
    await findByAriaPrefix(wrapper, '打开批量锁定管理')!.trigger('click')
    await nextTick()
    for (const btn of cands(wrapper)) expect(btn.attributes('data-selected')).toBe('false')
    expect(wrapper.find('.batch-lock-summary').text()).toContain('已选择 0 枚')
    expect(lockSpy).not.toHaveBeenCalled()
    expect(feedSpy).not.toHaveBeenCalled()
  })

  it('身份稳定：外层筛选隐藏已选符文，批量面板选择仍保持（§26）', async () => {
    setupInventory([
      makeRune('a', { isLocked: false }),
      makeRune('b', { type: 'luck', isLocked: false }),
      makeRune('c', { type: 'crit', isLocked: true })
    ])
    const wrapper = mount(RuneInventoryTab)
    await findByAriaPrefix(wrapper, '打开批量锁定管理')!.trigger('click')
    await nextTick()

    let list = cands(wrapper)
    // 选择 a（未锁定）
    await list[0].trigger('click')
    await nextTick()
    expect(cands(wrapper)[0].attributes('data-selected')).toBe('true')

    // 外层筛选切到 locked：主网格隐藏 a，但批量面板候选不受控（按 inventoryIndex）、选择保持
    await wrapper.find(lockSelect).setValue('locked')
    await nextTick()
    const afterList = cands(wrapper)
    expect(afterList.length).toBe(3)
    // a 在 inventoryIndex=0，筛选后仍位于候选首位且保持选中
    expect(afterList[0].attributes('data-selected')).toBe('true')
  })
})

// ============================================================================
// G. Store planner 输出防篡改矩阵（3.15.1 §3）
// 受控 planner override：先取真实计划，再精确篡改单一维度，事务 §14 对拍门必须
// 全量拒绝（ok:false、计数全 0、内存/拓扑/磁盘零变化、零部分成功）。
// ============================================================================
type BatchPlanOk = Extract<ReturnType<typeof planRuneBatchLockChange>, { ok: true }>

describe('Phase 3.15.1 — trySetRunesLocked planner 输出防篡改矩阵（§3）', () => {
  function withTamperedPlan(tamper: (plan: BatchPlanOk) => unknown) {
    plannerMockState.batchOverride = (input, actual) => {
      const plan = actual.planRuneBatchLockChange(
        input as Parameters<typeof actual.planRuneBatchLockChange>[0]
      )
      if (!plan.ok) return plan
      return tamper(plan as BatchPlanOk)
    }
  }

  /** 固定基线：a(未锁,embedded)/b(已锁)/c(未锁)；目标锁定 → changed=[0,2]、unchanged=[1]。 */
  function setupG() {
    const playerStore = usePlayerStore()
    const a = makeRune('a', { type: 'attack', rarity: 'common', statValue: 10, isLocked: false })
    const b = makeRune('b', { type: 'luck', rarity: 'rare', level: 2, statValue: 15, isLocked: true })
    const c = makeRune('c', { type: 'crit', rarity: 'epic', level: 3, statValue: 30, isLocked: false })
    playerStore.runeInventory = [a, b, c]
    playerStore.player.equipment[SLOT_A] = makeRuneEquip('eq1', SLOT_A, { runeSlots: slotsWith('a') })
    playerStore.saveGame()
    const diskBefore = localStorage.getItem(SAVE_KEY)
    const before = playerStore.runeInventory.map(r => ({ ...r }))
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    return { playerStore, before, diskBefore, setItemSpy }
  }

  function expectAtomicReject(
    res: ReturnType<ReturnType<typeof usePlayerStore>['trySetRunesLocked']>,
    ctx: ReturnType<typeof setupG>
  ) {
    // ok:false 且计数全 0、ID 名单全空（零部分成功）
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('expected rejected')
    expect(res.selectedCount).toBe(0)
    expect(res.changedCount).toBe(0)
    expect(res.unchangedCount).toBe(0)
    expect(res.changedRuneIds).toEqual([])
    expect(res.unchangedRuneIds).toEqual([])
    // 内存 inventory 完全不变（顺序 + 全字段）
    expect(ctx.playerStore.runeInventory.map(r => r.id)).toEqual(['a', 'b', 'c'])
    for (let i = 0; i < ctx.before.length; i++) {
      expect(runeEquals(ctx.playerStore.runeInventory[i], ctx.before[i])).toBe(true)
    }
    // 装备拓扑不变
    const eq = ctx.playerStore.player.equipment[SLOT_A]!
    expect(eq.runeSlots[0].runeId).toBe('a')
    expect(eq.runeSlots[1].runeId).toBeNull()
    expect(eq.runeSlots[2].runeId).toBeNull()
    // 磁盘零写入、内容不变
    expect(ctx.setItemSpy.mock.calls.filter(call => call[0] === SAVE_KEY).length).toBe(0)
    expect(localStorage.getItem(SAVE_KEY)).toBe(ctx.diskBefore)
  }

  const tamperCases: Array<{ name: string; tamper: (p: BatchPlanOk) => unknown }> = [
    {
      name: 'selectedIndices 越界',
      tamper: p => ({ ...p, selectedIndices: [0, 1, 99] })
    },
    {
      name: 'selectedIndices 非严格递增',
      tamper: p => ({ ...p, selectedIndices: [0, 2, 1] })
    },
    {
      name: 'selectedIndices 重复',
      tamper: p => ({ ...p, selectedIndices: [0, 1, 1] })
    },
    {
      name: 'selectedIndices 非整数',
      tamper: p => ({ ...p, selectedIndices: [0, 1.5, 2] })
    },
    {
      name: 'changedIndices 含非 selected 成员（越界 index）',
      tamper: p => ({ ...p, changedIndices: [0, 3] })
    },
    {
      name: 'changedIndices 非严格递增',
      tamper: p => ({ ...p, changedIndices: [2, 0] })
    },
    {
      name: 'changedIndices 重复',
      tamper: p => ({ ...p, changedIndices: [0, 0] })
    },
    {
      name: 'changedIndices 分类错误（把 unchanged 的 b 归入 changed）',
      tamper: p => ({ ...p, changedIndices: [0, 1] })
    },
    {
      name: 'selectedRune rarity 篡改',
      tamper: p => ({
        ...p,
        selectedRunes: p.selectedRunes.map((r, i) => (i === 0 ? { ...r, rarity: 'legend' as const } : r))
      })
    },
    {
      name: 'selectedRune isLocked 与快照不符',
      tamper: p => ({
        ...p,
        selectedRunes: p.selectedRunes.map((r, i) => (i === 0 ? { ...r, isLocked: true } : r))
      })
    },
    {
      name: 'nextRune level 篡改',
      tamper: p => ({
        ...p,
        nextRunes: p.nextRunes.map((r, i) => (i === 0 ? { ...r, level: r.level + 1 } : r))
      })
    },
    {
      name: 'nextRune statValue 篡改',
      tamper: p => ({
        ...p,
        nextRunes: p.nextRunes.map((r, i) => (i === 0 ? { ...r, statValue: r.statValue + 100 } : r))
      })
    },
    {
      name: 'nextRune rarity 篡改',
      tamper: p => ({
        ...p,
        nextRunes: p.nextRunes.map((r, i) => (i === 0 ? { ...r, rarity: 'legend' as const } : r))
      })
    },
    {
      name: 'nextRune isLocked ≠ 目标状态',
      tamper: p => ({
        ...p,
        nextRunes: p.nextRunes.map((r, i) => (i === 0 ? { ...r, isLocked: false } : r))
      })
    },
    {
      name: 'selectedRuneIds 身份错误',
      tamper: p => ({ ...p, selectedRuneIds: ['a', 'b', 'x'] })
    },
    {
      name: 'changedRuneIds 身份错误',
      tamper: p => ({ ...p, changedRuneIds: ['a', 'x'] })
    },
    {
      name: 'unchangedRuneIds 身份错误',
      tamper: p => ({ ...p, unchangedRuneIds: ['x'] })
    },
    {
      name: 'selectedCount 与数组长度不符',
      tamper: p => ({ ...p, selectedCount: 2 })
    },
    {
      name: 'changedCount 与 changedIndices 不符',
      tamper: p => ({ ...p, changedCount: 1 })
    },
    {
      name: 'unchangedCount 与 unchangedRuneIds 不符',
      tamper: p => ({ ...p, unchangedCount: 5 })
    },
    {
      name: 'selectedRunes 数组长度缺一',
      tamper: p => ({ ...p, selectedRunes: p.selectedRunes.slice(0, 2) })
    },
    {
      name: 'nextRunes 数组长度多一',
      tamper: p => ({ ...p, nextRunes: [...p.nextRunes, { ...p.nextRunes[0], id: 'ghost' }] })
    },
    {
      name: 'plan.isLocked 与请求目标不符',
      tamper: p => ({ ...p, isLocked: false })
    }
  ]

  for (const tc of tamperCases) {
    it(`篡改维度「${tc.name}」→ ok:false、计数全 0、内存/拓扑/磁盘零变化`, () => {
      const ctx = setupG()
      withTamperedPlan(tc.tamper)
      const res = ctx.playerStore.trySetRunesLocked(['a', 'b', 'c'], true)
      expectAtomicReject(res, ctx)
    })
  }

  it('对照组：override 原样透传真实计划 → 事务成功（证明矩阵失败非环境噪声）', () => {
    const ctx = setupG()
    withTamperedPlan(p => p)
    const res = ctx.playerStore.trySetRunesLocked(['a', 'b', 'c'], true)
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error('expected ok')
    expect(res.changedCount).toBe(2)
    expect(res.unchangedCount).toBe(1)
    expect(ctx.playerStore.runeInventory.find(r => r.id === 'a')!.isLocked).toBe(true)
    expect(ctx.playerStore.runeInventory.find(r => r.id === 'c')!.isLocked).toBe(true)
    expect(ctx.setItemSpy.mock.calls.filter(call => call[0] === SAVE_KEY).length).toBe(1)
  })
})

// ============================================================================
// H. planner 输入异常 Proxy fail-closed 矩阵（3.15.1 §4）
// 直接调用 planRuneBatchLockChange：任何陷阱抛异常 / 损坏 Rune / isLocked 非法形状
// 均 ok:false、绝不外抛、不修改输入、零 RNG、不返回部分计划。
// ============================================================================
describe('Phase 3.15.1 — planner 输入异常 Proxy fail-closed 矩阵（§4）', () => {
  const baseInventory = () => [
    makeRune('r0', { isLocked: false }),
    makeRune('r1', { type: 'luck', isLocked: true })
  ]

  /** 断言：不外抛、ok:false、失败对象仅 {ok, reason}（零部分计划）、零 RNG。 */
  function expectFailClosed(run: () => ReturnType<typeof planRuneBatchLockChange>) {
    const rngSpy = vi.spyOn(Math, 'random')
    let plan: ReturnType<typeof planRuneBatchLockChange> | null = null
    expect(() => {
      plan = run()
    }).not.toThrow()
    expect(plan).not.toBeNull()
    const p = plan! as ReturnType<typeof planRuneBatchLockChange>
    expect(p.ok).toBe(false)
    expect(Object.keys(p).sort()).toEqual(['ok', 'reason'])
    expect(rngSpy).not.toHaveBeenCalled()
    return p as { ok: false; reason: string }
  }

  it('runeIds length 陷阱抛异常 → fail-closed', () => {
    const target = ['r0']
    const proxy = new Proxy(target, {
      get(t, prop, receiver) {
        if (prop === 'length') throw new Error('length trap boom')
        return Reflect.get(t, prop, receiver)
      }
    })
    const targetSnapshot = JSON.stringify(target)
    expectFailClosed(() =>
      planRuneBatchLockChange({ inventory: baseInventory(), runeIds: proxy, isLocked: true })
    )
    expect(JSON.stringify(target)).toBe(targetSnapshot)
  })

  it('runeIds index get 陷阱抛异常 → fail-closed', () => {
    const target = ['r0', 'r1']
    const proxy = new Proxy(target, {
      get(t, prop, receiver) {
        if (prop === '1') throw new Error('index trap boom')
        return Reflect.get(t, prop, receiver)
      }
    })
    const targetSnapshot = JSON.stringify(target)
    expectFailClosed(() =>
      planRuneBatchLockChange({ inventory: baseInventory(), runeIds: proxy, isLocked: true })
    )
    expect(JSON.stringify(target)).toBe(targetSnapshot)
  })

  it('runeIds getOwnPropertyDescriptor 陷阱抛异常（hasOwnProperty 路径）→ fail-closed', () => {
    const target = ['r0']
    const proxy = new Proxy(target, {
      getOwnPropertyDescriptor(t, prop) {
        if (prop === '0') throw new Error('descriptor trap boom')
        return Reflect.getOwnPropertyDescriptor(t, prop)
      }
    })
    expectFailClosed(() =>
      planRuneBatchLockChange({ inventory: baseInventory(), runeIds: proxy, isLocked: true })
    )
  })

  it('inventory length 陷阱抛异常 → fail-closed', () => {
    const target = baseInventory()
    const proxy = new Proxy(target, {
      get(t, prop, receiver) {
        if (prop === 'length') throw new Error('inv length boom')
        return Reflect.get(t, prop, receiver)
      }
    })
    expectFailClosed(() =>
      planRuneBatchLockChange({ inventory: proxy, runeIds: ['r0'], isLocked: true })
    )
  })

  it('inventory index get 陷阱抛异常 → fail-closed', () => {
    const target = baseInventory()
    const proxy = new Proxy(target, {
      get(t, prop, receiver) {
        if (prop === '1') throw new Error('inv index boom')
        return Reflect.get(t, prop, receiver)
      }
    })
    expectFailClosed(() =>
      planRuneBatchLockChange({ inventory: proxy, runeIds: ['r0'], isLocked: true })
    )
  })

  it('Rune 字段 getter 抛异常 → fail-closed（inventory invalid）', () => {
    const bad = {
      id: 'r0',
      get type(): string {
        throw new Error('field getter boom')
      },
      rarity: 'common',
      level: 1,
      exp: 0,
      statValue: 10,
      isLocked: false
    }
    const p = expectFailClosed(() =>
      planRuneBatchLockChange({ inventory: [bad], runeIds: ['r0'], isLocked: true })
    )
    expect(p.reason.startsWith('inventory invalid')).toBe(true)
  })

  it('isLocked 为对象 → fail-closed（不做 truthy 猜测）', () => {
    const bad = { ...makeRune('r0'), isLocked: {} as unknown as boolean }
    const p = expectFailClosed(() =>
      planRuneBatchLockChange({ inventory: [bad], runeIds: ['r0'], isLocked: true })
    )
    expect(p.reason.startsWith('inventory invalid')).toBe(true)
  })

  it('isLocked 为数组 → fail-closed', () => {
    const bad = { ...makeRune('r0'), isLocked: [true] as unknown as boolean }
    const p = expectFailClosed(() =>
      planRuneBatchLockChange({ inventory: [bad], runeIds: ['r0'], isLocked: true })
    )
    expect(p.reason.startsWith('inventory invalid')).toBe(true)
  })

  it('损坏 Rune（level 越界）→ fail-closed', () => {
    const bad = { ...makeRune('r0'), level: 999 }
    const p = expectFailClosed(() =>
      planRuneBatchLockChange({ inventory: [bad], runeIds: ['r0'], isLocked: true })
    )
    expect(p.reason.startsWith('inventory invalid')).toBe(true)
  })
})

// ============================================================================
// I. Store raw snapshot 时变 Proxy（3.15.1 §5）
// rune 对象级 Proxy（数组级 index trap 经 Pinia ref 不可靠——既有踩坑纪律）：
// 第二次字段读取抛异常 → 事务仍成功（证明快照单次读取）；
// 第二次读取返回不同值 → 只有第一次快照进入事务。
// ============================================================================
describe('Phase 3.15.1 — Store raw snapshot 时变 Proxy（§5）', () => {
  it('rune 字段第二次读取抛异常 → 事务仍成功（每字段恰好读取一次）', () => {
    const playerStore = usePlayerStore()
    const reads: Record<string, number> = {}
    function onceRune(base: Rune): Rune {
      return new Proxy(base, {
        get(t, prop, receiver) {
          if (typeof prop === 'string' && Object.prototype.hasOwnProperty.call(t, prop)) {
            const key = `${base.id}.${prop}`
            reads[key] = (reads[key] ?? 0) + 1
            if (reads[key] > 1) throw new Error(`second read of ${key}`)
          }
          return Reflect.get(t, prop, receiver)
        }
      }) as Rune
    }
    const t1 = onceRune(makeRune('t1', { isLocked: false }))
    const t2 = onceRune(makeRune('t2', { type: 'luck', isLocked: false }))
    playerStore.runeInventory = [t1, t2]

    const res = playerStore.trySetRunesLocked(['t1', 't2'], true)
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error('expected ok')
    expect(res.changedCount).toBe(2)
    // 快照期间每个 rune 的 isLocked 恰好读取一次
    expect(reads['t1.isLocked']).toBe(1)
    expect(reads['t2.isLocked']).toBe(1)
    // 应用后 inventory 为 plain 对象（非 Proxy），读取不再抛异常
    expect(playerStore.runeInventory.find(r => r.id === 't1')!.isLocked).toBe(true)
    expect(playerStore.runeInventory.find(r => r.id === 't2')!.isLocked).toBe(true)
  })

  it('rune 字段第二次读取返回不同值（isLocked/rarity/level 漂移）→ 只采用第一次快照', () => {
    const playerStore = usePlayerStore()
    function timeVaryingRune(base: Rune, secondReads: Partial<Rune>): Rune {
      const reads: Record<string, number> = {}
      return new Proxy({ ...base }, {
        get(t, prop, receiver) {
          if (typeof prop === 'string' && Object.prototype.hasOwnProperty.call(t, prop)) {
            reads[prop] = (reads[prop] ?? 0) + 1
            if (reads[prop] > 1 && Object.prototype.hasOwnProperty.call(secondReads, prop)) {
              return (secondReads as Record<string, unknown>)[prop]
            }
          }
          return Reflect.get(t, prop, receiver)
        }
      }) as Rune
    }
    // 第一次读取：t1 未锁定/common/level1；第二次读取伪装成 已锁定/legend/level50
    const t1 = timeVaryingRune(makeRune('t1', { isLocked: false, rarity: 'common', level: 1 }), {
      isLocked: true,
      rarity: 'legend',
      level: 50
    })
    const stable = makeRune('s1', { type: 'luck', isLocked: false })
    playerStore.runeInventory = [t1, stable]

    const res = playerStore.trySetRunesLocked(['t1'], true)
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error('expected ok')
    // 分类基于第一次快照（未锁定 → changed），漂移值不得混入
    expect(res.changedCount).toBe(1)
    expect([...res.changedRuneIds]).toEqual(['t1'])
    const applied = playerStore.runeInventory.find(r => r.id === 't1')!
    expect(applied.isLocked).toBe(true) // 目标态
    expect(applied.rarity).toBe('common') // 第一次快照值，非漂移 legend
    expect(applied.level).toBe(1) // 第一次快照值，非漂移 50
  })

  it('runeIds 在 Store 入口整链路：每个 ID index 至多读取一次、length 读取一次', () => {
    const playerStore = usePlayerStore()
    playerStore.runeInventory = [makeRune('t1', { isLocked: false }), makeRune('t2', { isLocked: false })]
    const idReads: Record<string, number> = { length: 0 }
    const idsProxy = new Proxy(['t1', 't2'], {
      get(t, prop, receiver) {
        if (prop === 'length') {
          idReads.length++
        } else if (typeof prop === 'string' && /^\d+$/.test(prop)) {
          idReads[prop] = (idReads[prop] ?? 0) + 1
        }
        return Reflect.get(t, prop, receiver)
      }
    })
    const res = playerStore.trySetRunesLocked(idsProxy as unknown as string[], true)
    expect(res.ok).toBe(true)
    expect(idReads.length).toBe(1)
    expect(idReads['0']).toBe(1)
    expect(idReads['1']).toBe(1)
  })
})

// ============================================================================
// J. topology 门与回滚（3.15.1 §6）
// 受控 topology / snapshot override：真实触达对应门（inventory 合法、plan ok、
// changedCount>0），断言完整回滚 + 装备不变 + 零写盘 + 零部分成功。
// ============================================================================
describe('Phase 3.15.1 — topology 非法/漂移/抛异常回滚（§6）', () => {
  /** o1 已镶嵌（真实拓扑非空）；t1/t2 为锁定目标。 */
  function setupJ() {
    const playerStore = usePlayerStore()
    const o1 = makeRune('o1', { type: 'attack', isLocked: false })
    const t1 = makeRune('t1', { type: 'luck', isLocked: false })
    const t2 = makeRune('t2', { type: 'crit', isLocked: false })
    playerStore.runeInventory = [o1, t1, t2]
    playerStore.player.equipment[SLOT_A] = makeRuneEquip('eq1', SLOT_A, { runeSlots: slotsWith('o1') })
    playerStore.saveGame()
    const diskBefore = localStorage.getItem(SAVE_KEY)
    const before = playerStore.runeInventory.map(r => ({ ...r }))
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    return { playerStore, before, diskBefore, setItemSpy }
  }

  function expectRolledBack(
    res: ReturnType<ReturnType<typeof usePlayerStore>['trySetRunesLocked']>,
    ctx: ReturnType<typeof setupJ>,
    expectedReason: string | RegExp
  ) {
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('expected rejected')
    if (typeof expectedReason === 'string') {
      expect(res.reason).toBe(expectedReason)
    } else {
      expect(res.reason).toMatch(expectedReason)
    }
    expect(res.changedCount).toBe(0)
    expect(res.changedRuneIds).toEqual([])
    // 内存完全恢复（顺序 + 全字段）
    expect(ctx.playerStore.runeInventory.map(r => r.id)).toEqual(['o1', 't1', 't2'])
    for (let i = 0; i < ctx.before.length; i++) {
      expect(runeEquals(ctx.playerStore.runeInventory[i], ctx.before[i])).toBe(true)
    }
    // 装备不变
    const eq = ctx.playerStore.player.equipment[SLOT_A]!
    expect(eq.runeSlots[0].runeId).toBe('o1')
    // 零写盘、磁盘不变
    expect(ctx.setItemSpy.mock.calls.filter(call => call[0] === SAVE_KEY).length).toBe(0)
    expect(localStorage.getItem(SAVE_KEY)).toBe(ctx.diskBefore)
  }

  it('应用前 topology 非法 → 拒绝、零修改（真实触达 §17 前置门）', () => {
    const ctx = setupJ()
    topoMockState.override = () => ({ ok: false as const, reason: 'forced pre invalid' })
    const res = ctx.playerStore.trySetRunesLocked(['t1', 't2'], true)
    expectRolledBack(res, ctx, 'rune reference topology invalid before apply: forced pre invalid')
  })

  it('应用后 topology 非法 → 已应用候选被完整回滚', () => {
    const ctx = setupJ()
    let calls = 0
    topoMockState.override = (equipment, inventory, actual) => {
      calls++
      if (calls === 1) {
        return actual.validatePlayerRuneReferenceTopology(
          equipment as Parameters<typeof actual.validatePlayerRuneReferenceTopology>[0],
          inventory as Parameters<typeof actual.validatePlayerRuneReferenceTopology>[1]
        )
      }
      return { ok: false as const, reason: 'forced post invalid' }
    }
    const res = ctx.playerStore.trySetRunesLocked(['t1', 't2'], true)
    expect(calls).toBe(2)
    expectRolledBack(res, ctx, 'rune reference topology invalid after apply: forced post invalid')
  })

  it('应用前后拓扑均合法但快照漂移 → 拒绝并完整回滚', () => {
    const ctx = setupJ()
    let snapCalls = 0
    snapMockState.override = (refs, actual) => {
      snapCalls++
      const real = actual.buildRuneTopologySnapshot(
        refs as Parameters<typeof actual.buildRuneTopologySnapshot>[0]
      )
      if (snapCalls === 1) return real
      // 第二次快照伪装漂移：多出一条 ghost 引用（两次拓扑本身均合法）
      return Object.freeze([
        ...real,
        { runeId: 'ghost', equipmentSlot: SLOT_A, runeSlotIndex: 2 }
      ])
    }
    const res = ctx.playerStore.trySetRunesLocked(['t1', 't2'], true)
    expect(snapCalls).toBe(2)
    expectRolledBack(res, ctx, 'rune reference topology drifted during apply')
  })

  it('应用后 topology validator 抛异常 → outer catch 完整回滚', () => {
    const ctx = setupJ()
    let calls = 0
    topoMockState.override = (equipment, inventory, actual) => {
      calls++
      if (calls === 1) {
        return actual.validatePlayerRuneReferenceTopology(
          equipment as Parameters<typeof actual.validatePlayerRuneReferenceTopology>[0],
          inventory as Parameters<typeof actual.validatePlayerRuneReferenceTopology>[1]
        )
      }
      throw new Error('topology validator exploded')
    }
    const res = ctx.playerStore.trySetRunesLocked(['t1', 't2'], true)
    expect(calls).toBe(2)
    expectRolledBack(res, ctx, 'rune batch lock transaction threw')
  })
})

// ============================================================================
// K. 保存失败双分支（3.15.1 §7）
// 分支一：saveGame 返回 false（setItem 抛异常被 saveGame 内部捕获）→ reason 'save failed'
//        （D 段既有用例已覆盖回滚与重放，此处补 reason 判别）
// 分支二：应用后异常逃逸至 outer catch → reason 'rune batch lock transaction threw'
// 两分支 reason 不同、注入点不同，不得用一个场景同时声称覆盖两个分支。
// ============================================================================
describe('Phase 3.15.1 — 保存失败双分支判别（§7）', () => {
  it('分支一：saveGame 返回 false → reason=save failed（非 outer catch 文案）', () => {
    const playerStore = usePlayerStore()
    playerStore.runeInventory = [makeRune('t1', { isLocked: false })]
    playerStore.saveGame()
    installThrowingStorage()
    const res = playerStore.trySetRunesLocked(['t1'], true)
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('expected rejected')
    expect(res.reason).toBe('save failed')
    expect(res.reason).not.toBe('rune batch lock transaction threw')
    expect(playerStore.runeInventory[0].isLocked).toBe(false)
  })

  it('分支二：应用后 buildRuneTopologySnapshot 第二次调用抛异常 → outer catch 回滚，恢复后可重放', () => {
    const playerStore = usePlayerStore()
    const t1 = makeRune('t1', { isLocked: false })
    const t2 = makeRune('t2', { type: 'luck', isLocked: false })
    playerStore.runeInventory = [t1, t2]
    playerStore.saveGame()
    const diskBefore = localStorage.getItem(SAVE_KEY)
    const before = playerStore.runeInventory.map(r => ({ ...r }))
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')

    let snapCalls = 0
    snapMockState.override = (refs, actual) => {
      snapCalls++
      if (snapCalls === 1) {
        return actual.buildRuneTopologySnapshot(
          refs as Parameters<typeof actual.buildRuneTopologySnapshot>[0]
        )
      }
      throw new Error('snapshot builder exploded')
    }
    const res = playerStore.trySetRunesLocked(['t1', 't2'], true)
    expect(snapCalls).toBe(2)
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('expected rejected')
    // outer catch 文案，区别于分支一的 save failed
    expect(res.reason).toBe('rune batch lock transaction threw')
    expect(res.changedCount).toBe(0)
    // 完整回滚：内存恢复、磁盘零写入
    for (let i = 0; i < before.length; i++) {
      expect(runeEquals(playerStore.runeInventory[i], before[i])).toBe(true)
    }
    expect(setItemSpy.mock.calls.filter(call => call[0] === SAVE_KEY).length).toBe(0)
    expect(localStorage.getItem(SAVE_KEY)).toBe(diskBefore)

    // 清除注入后重放成功（证明失败仅由注入造成、状态未残留）
    snapMockState.override = null
    const okRes = playerStore.trySetRunesLocked(['t1', 't2'], true)
    expect(okRes.ok).toBe(true)
    if (!okRes.ok) throw new Error('expected ok')
    expect(okRes.changedCount).toBe(2)
    expect(playerStore.runeInventory.find(r => r.id === 't1')!.isLocked).toBe(true)
    expect(playerStore.runeInventory.find(r => r.id === 't2')!.isLocked).toBe(true)
  })
})

// ============================================================================
// L. 旧档形状保留（3.15.1 §8）
// changed 目标 canonical 化（isLocked 显式写入）；unchanged-selected / 未选择 Rune
// 保留原始字节形状（缺失 isLocked 不补写、额外字段保留、padded ID 保留、顺序不变）。
// 断言用 Object.keys / hasOwnProperty / 可序列化快照，不用 runeEquals（其会归一化）。
// ============================================================================
describe('Phase 3.15.1 — 旧档缺字段与额外字段形状保留（§8）', () => {
  type LegacyRune = Rune & { legacyNote?: string }
  function legacyInventory(): LegacyRune[] {
    return [
      // 将被解锁的 changed 目标（isLocked:true 显式存在）
      { id: 'c1', type: 'attack', rarity: 'common', level: 1, exp: 0, statValue: 10, isLocked: true },
      // unchanged-selected：缺失 isLocked（canonical false；目标解锁 → 幂等）
      { id: 'u1', type: 'luck', rarity: 'rare', level: 2, exp: 3, statValue: 15 } as LegacyRune,
      // 未选择：缺失 isLocked
      { id: 'n1', type: 'crit', rarity: 'epic', level: 3, exp: 0, statValue: 30 } as LegacyRune,
      // 未选择：带额外可枚举字段
      {
        id: 'n2',
        type: 'speed',
        rarity: 'common',
        level: 1,
        exp: 0,
        statValue: 5,
        isLocked: true,
        legacyNote: 'keep'
      },
      // 未选择：padded ID 保留原始字节
      { id: '  p1  ', type: 'defense', rarity: 'common', level: 1, exp: 0, statValue: 8, isLocked: false }
    ]
  }
  const hasLocked = (r: unknown) => Object.prototype.hasOwnProperty.call(r, 'isLocked')

  it('批量解锁 [c1,u1]：仅 c1 canonical 化，u1/n1 缺失形状保留，n2 额外字段保留，顺序不变', () => {
    const playerStore = usePlayerStore()
    playerStore.runeInventory = legacyInventory() as Rune[]
    const res = playerStore.trySetRunesLocked(['c1', 'u1'], false)
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error('expected ok')
    // c1 实际变化；u1（缺失→canonical false === 目标 false）幂等
    expect(res.changedCount).toBe(1)
    expect([...res.changedRuneIds]).toEqual(['c1'])
    expect([...res.unchangedRuneIds]).toEqual(['u1'])

    const inv = playerStore.runeInventory as LegacyRune[]
    // 顺序不变
    expect(inv.map(r => r.id)).toEqual(['c1', 'u1', 'n1', 'n2', '  p1  '])
    // c1：changed → canonical 形状（isLocked 显式 false，恰好 7 个 canonical key）
    expect(hasLocked(inv[0])).toBe(true)
    expect(inv[0].isLocked).toBe(false)
    expect(Object.keys(inv[0]).sort()).toEqual(['exp', 'id', 'isLocked', 'level', 'rarity', 'statValue', 'type'])
    // u1：unchanged-selected → 缺失 isLocked 形状保留（不补写）
    expect(hasLocked(inv[1])).toBe(false)
    expect(inv[1].level).toBe(2)
    expect(inv[1].exp).toBe(3)
    // n1：未选择 → 缺失 isLocked 形状保留
    expect(hasLocked(inv[2])).toBe(false)
    // n2：未选择 → 额外字段与 isLocked 原值全部保留
    expect(hasLocked(inv[3])).toBe(true)
    expect(inv[3].isLocked).toBe(true)
    expect(inv[3].legacyNote).toBe('keep')
    // p1：未选择 → padded ID 原始字节保留
    expect(inv[4].id).toBe('  p1  ')
  })

  it('保存失败回滚：全部原始形状恢复（可序列化快照逐字节一致）', () => {
    const playerStore = usePlayerStore()
    playerStore.runeInventory = legacyInventory() as Rune[]
    const beforeJson = JSON.stringify(playerStore.runeInventory)

    installThrowingStorage()
    const res = playerStore.trySetRunesLocked(['c1', 'u1'], false)
    expect(res.ok).toBe(false)

    const inv = playerStore.runeInventory as LegacyRune[]
    // 可序列化快照逐字节一致（key 顺序、缺失字段、额外字段、padded ID 全部恢复）
    expect(JSON.stringify(playerStore.runeInventory)).toBe(beforeJson)
    expect(hasLocked(inv[1])).toBe(false)
    expect(hasLocked(inv[2])).toBe(false)
    expect(inv[0].isLocked).toBe(true)
    expect(inv[3].legacyNote).toBe('keep')
    expect(inv[4].id).toBe('  p1  ')
  })
})

// ============================================================================
// M. UI 无障碍与选择细节（§10）+ UI 失败与异常（§11）
// ============================================================================
describe('Phase 3.15.1 — 批量面板手动选择与无障碍（§10）', () => {
  function candButtons(wrapper: ReturnType<typeof mount>) {
    const list = wrapper.find('.batch-lock-list')
    return list.exists() ? list.findAll('button') : []
  }

  it('初始 0 选择：摘要/确认禁用/动态 aria-label=0 枚；逐枚选择与取消全链路', async () => {
    const playerStore = usePlayerStore()
    playerStore.runeInventory = [
      makeRune('a', { isLocked: false }),
      makeRune('b', { type: 'luck', isLocked: true })
    ]
    const wrapper = mount(RuneInventoryTab)
    await findByAriaPrefix(wrapper, '打开批量锁定管理')!.trigger('click')
    await nextTick()

    // 0 选择态
    let summaryEl = wrapper.find('.batch-lock-summary')
    expect(summaryEl.text()).toContain('已选择 0 枚')
    expect(summaryEl.text()).toContain('尚未选择符文')
    let confirm = findByAriaPrefix(wrapper, '确认批量操作')!
    expect(confirm.attributes('disabled')).toBeDefined()
    expect(confirm.attributes('aria-label')).toBe('确认批量操作，将锁定 0 枚符文')

    // 候选按钮完整 aria-label：名称 + 锁定状态 + 选中状态
    let list = candButtons(wrapper)
    expect(list[0].attributes('aria-pressed')).toBe('false')
    expect(list[0].attributes('data-selected')).toBe('false')
    expect(list[0].attributes('aria-label')).toBe('选择符文 普通攻击符文，当前未锁定，未选中')
    expect(list[1].attributes('aria-label')).toBe('选择符文 普通幸运符文，当前已锁定，未选中')

    // 选择 a → aria-pressed/data-selected/aria-label/确认 aria-label 全部更新
    await list[0].trigger('click')
    await nextTick()
    list = candButtons(wrapper)
    expect(list[0].attributes('aria-pressed')).toBe('true')
    expect(list[0].attributes('data-selected')).toBe('true')
    expect(list[0].attributes('aria-label')).toBe('取消选择符文 普通攻击符文，当前未锁定，已选中')
    confirm = findByAriaPrefix(wrapper, '确认批量操作')!
    expect(confirm.attributes('disabled')).toBeUndefined()
    expect(confirm.attributes('aria-label')).toBe('确认批量操作，将锁定 1 枚符文')

    // 再次点击取消选择 → 完全回到 0 选择态
    await list[0].trigger('click')
    await nextTick()
    list = candButtons(wrapper)
    expect(list[0].attributes('aria-pressed')).toBe('false')
    expect(list[0].attributes('data-selected')).toBe('false')
    expect(list[0].attributes('aria-label')).toBe('选择符文 普通攻击符文，当前未锁定，未选中')
    summaryEl = wrapper.find('.batch-lock-summary')
    expect(summaryEl.text()).toContain('已选择 0 枚')
    confirm = findByAriaPrefix(wrapper, '确认批量操作')!
    expect(confirm.attributes('disabled')).toBeDefined()
    expect(confirm.attributes('aria-label')).toBe('确认批量操作，将锁定 0 枚符文')
  })

  it('全幂等选择：确认禁用；即便强制触发点击，事务零调用', async () => {
    const playerStore = usePlayerStore()
    playerStore.runeInventory = [
      makeRune('a', { isLocked: true }),
      makeRune('b', { type: 'luck', isLocked: true })
    ]
    const spy = vi.spyOn(playerStore, 'trySetRunesLocked')
    const wrapper = mount(RuneInventoryTab)
    await findByAriaPrefix(wrapper, '打开批量锁定管理')!.trigger('click')
    await nextTick()
    const list = candButtons(wrapper)
    await list[0].trigger('click')
    await list[1].trigger('click')
    await nextTick()

    const confirm = findByAriaPrefix(wrapper, '确认批量操作')!
    expect(confirm.attributes('disabled')).toBeDefined()
    expect(wrapper.find('.batch-lock-summary').text()).toContain('将改变 0 枚')
    // 强制触发（绕过 disabled 视觉屏障）→ 组件防御分支拦截，事务不被调用
    await confirm.trigger('click')
    await nextTick()
    expect(spy).not.toHaveBeenCalled()
    expect(wrapper.find('.batch-lock-panel').exists()).toBe(true)
  })
})

describe('Phase 3.15.1 — UI 失败与异常反馈（§11）', () => {
  function candButtons(wrapper: ReturnType<typeof mount>) {
    const list = wrapper.find('.batch-lock-list')
    return list.exists() ? list.findAll('button') : []
  }
  const targetSelect = 'select[aria-label="选择批量锁定目标状态"]'

  /** b 已锁定；打开面板、选中 b、目标切到解锁（changed=1，确认可用）。 */
  async function setupFailureUI() {
    const playerStore = usePlayerStore()
    playerStore.runeInventory = [
      makeRune('a', { isLocked: false }),
      makeRune('b', { type: 'luck', isLocked: true })
    ]
    const wrapper = mount(RuneInventoryTab)
    await findByAriaPrefix(wrapper, '打开批量锁定管理')!.trigger('click')
    await nextTick()
    await candButtons(wrapper)[1].trigger('click')
    await nextTick()
    await wrapper.find(targetSelect).setValue('false')
    await nextTick()
    expect(wrapper.find('.batch-lock-summary').text()).toContain('将改变 1 枚')
    return { playerStore, wrapper }
  }

  it('Store 返回 ok:false → 面板/选择/目标态保持、错误反馈、无成功、inventory 不变', async () => {
    const { playerStore, wrapper } = await setupFailureUI()
    const failRes: RuneBatchLockTransactionResult = {
      ok: false,
      reason: '注入失败',
      selectedCount: 0,
      changedCount: 0,
      unchangedCount: 0,
      changedRuneIds: [],
      unchangedRuneIds: []
    }
    const spy = vi.spyOn(playerStore, 'trySetRunesLocked').mockReturnValue(failRes)

    await findByAriaPrefix(wrapper, '确认批量操作')!.trigger('click')
    await nextTick()

    expect(spy).toHaveBeenCalledTimes(1)
    // 面板保持、选择保持、目标态保持
    expect(wrapper.find('.batch-lock-panel').exists()).toBe(true)
    expect(candButtons(wrapper)[1].attributes('aria-pressed')).toBe('true')
    expect((wrapper.find(targetSelect).element as HTMLSelectElement).value).toBe('false')
    // 错误反馈、无成功
    expect(wrapper.find('.feedback').text()).toContain('批量锁定失败：注入失败')
    expect(wrapper.find('.feedback').text()).not.toContain('成功')
    // inventory 不变（mock 阻断了真实事务）
    expect(playerStore.runeInventory.find(r => r.id === 'b')!.isLocked).toBe(true)
  })

  it('Store 抛异常 → 组件不崩溃、面板/选择/目标态保持、安全失败反馈、inventory 不变', async () => {
    const { playerStore, wrapper } = await setupFailureUI()
    const spy = vi.spyOn(playerStore, 'trySetRunesLocked').mockImplementation(() => {
      throw new Error('store exploded')
    })

    await findByAriaPrefix(wrapper, '确认批量操作')!.trigger('click')
    await nextTick()

    expect(spy).toHaveBeenCalledTimes(1)
    expect(wrapper.find('.batch-lock-panel').exists()).toBe(true)
    expect(candButtons(wrapper)[1].attributes('aria-pressed')).toBe('true')
    expect((wrapper.find(targetSelect).element as HTMLSelectElement).value).toBe('false')
    expect(wrapper.find('.feedback').text()).toContain('批量锁定操作失败')
    expect(wrapper.find('.feedback').text()).not.toContain('成功')
    expect(playerStore.runeInventory.find(r => r.id === 'b')!.isLocked).toBe(true)
  })
})

// ============================================================================
// N. UI identity 完整矩阵（§13）+ 响应式变化（§14）
// ============================================================================
describe('Phase 3.15.1 — UI identity 完整矩阵与响应式变化（§13/§14）', () => {
  function candButtons(wrapper: ReturnType<typeof mount>) {
    const list = wrapper.find('.batch-lock-list')
    return list.exists() ? list.findAll('button') : []
  }
  const typeSelect = 'select[aria-label="按类型筛选"]'
  const raritySelect = 'select[aria-label="按稀有度筛选"]'
  const statusSelect = 'select[aria-label="按状态筛选"]'
  const sortSelect = 'select[aria-label="排序方式"]'

  function expectSelectionKept(wrapper: ReturnType<typeof mount>, candCount: number) {
    expect(wrapper.find('.batch-lock-panel').exists()).toBe(true)
    const list = candButtons(wrapper)
    expect(list.length).toBe(candCount)
    // a(index0)/b(index1) 保持选中，其余未选中
    expect(list[0].attributes('aria-pressed')).toBe('true')
    expect(list[1].attributes('aria-pressed')).toBe('true')
    for (let i = 2; i < list.length; i++) {
      expect(list[i].attributes('aria-pressed')).toBe('false')
    }
    // changed/unchanged 预览保持（目标锁定：a 未锁 → changed，b 已锁 → unchanged）
    const summaryText = wrapper.find('.batch-lock-summary').text()
    expect(summaryText).toContain('已选择 2 枚')
    expect(summaryText).toContain('将改变 1 枚')
    expect(summaryText).toContain('已处于目标状态 1 枚')
    expect(summaryText).toContain('实际变化：普通攻击符文')
  }

  it('§13：类型/稀有度/状态筛选、排序切换、尾部追加均保持面板/候选/选择/预览，零事务', async () => {
    const playerStore = usePlayerStore()
    playerStore.runeInventory = [
      makeRune('a', { type: 'attack', rarity: 'common', isLocked: false }),
      makeRune('b', { type: 'luck', rarity: 'rare', isLocked: true }),
      makeRune('c', { type: 'crit', rarity: 'epic', isLocked: false })
    ]
    playerStore.player.equipment[SLOT_A] = makeRuneEquip('eq1', SLOT_A, { runeSlots: slotsWith('a') })
    const spy = vi.spyOn(playerStore, 'trySetRunesLocked')
    const wrapper = mount(RuneInventoryTab)
    await findByAriaPrefix(wrapper, '打开批量锁定管理')!.trigger('click')
    await nextTick()
    await candButtons(wrapper)[0].trigger('click')
    await nextTick()
    await candButtons(wrapper)[1].trigger('click')
    await nextTick()
    expectSelectionKept(wrapper, 3)

    // 类型筛选（主网格只剩 luck，候选不受影响）
    await wrapper.find(typeSelect).setValue('luck')
    await nextTick()
    expectSelectionKept(wrapper, 3)
    await wrapper.find(typeSelect).setValue('all')
    await nextTick()

    // 稀有度筛选
    await wrapper.find(raritySelect).setValue('epic')
    await nextTick()
    expectSelectionKept(wrapper, 3)
    await wrapper.find(raritySelect).setValue('all')
    await nextTick()

    // 状态筛选（embedded：主网格只剩已镶嵌 a）
    await wrapper.find(statusSelect).setValue('embedded')
    await nextTick()
    expectSelectionKept(wrapper, 3)
    await wrapper.find(statusSelect).setValue('all')
    await nextTick()

    // 锁定筛选
    await wrapper.find(lockSelect).setValue('locked')
    await nextTick()
    expectSelectionKept(wrapper, 3)
    await wrapper.find(lockSelect).setValue('all')
    await nextTick()

    // 排序切换
    await wrapper.find(sortSelect).setValue('rarity')
    await nextTick()
    expectSelectionKept(wrapper, 3)

    // 尾部追加新 Rune → 候选 +1、选择保持
    playerStore.runeInventory = [
      ...playerStore.runeInventory.map(r => ({ ...r })),
      makeRune('d', { type: 'speed', rarity: 'common', isLocked: false })
    ]
    await nextTick()
    await nextTick()
    expectSelectionKept(wrapper, 4)

    expect(spy).not.toHaveBeenCalled()
  })

  it('§14：已选 Rune 从 inventory 消失 → 仅移除该 ID，其余选择保持、预览重算、零事务', async () => {
    const playerStore = usePlayerStore()
    playerStore.runeInventory = [
      makeRune('a', { type: 'attack', isLocked: false }),
      makeRune('b', { type: 'luck', isLocked: true }),
      makeRune('c', { type: 'crit', isLocked: false })
    ]
    const spy = vi.spyOn(playerStore, 'trySetRunesLocked')
    const wrapper = mount(RuneInventoryTab)
    await findByAriaPrefix(wrapper, '打开批量锁定管理')!.trigger('click')
    await nextTick()
    await candButtons(wrapper)[0].trigger('click')
    await nextTick()
    await candButtons(wrapper)[1].trigger('click')
    await nextTick()
    // 目标锁定：changed=a
    expect(wrapper.find('.batch-lock-summary').text()).toContain('将改变 1 枚')

    // a 从 inventory 真正消失（无装备引用，视图仍合法）
    playerStore.runeInventory = playerStore.runeInventory
      .filter(r => r.id !== 'a')
      .map(r => ({ ...r }))
    await nextTick()
    await nextTick()

    // 面板保持；候选只剩 b/c；b 选择保持、c 未选中
    expect(wrapper.find('.batch-lock-panel').exists()).toBe(true)
    const list = candButtons(wrapper)
    expect(list.length).toBe(2)
    expect(list[0].attributes('aria-pressed')).toBe('true') // b
    expect(list[1].attributes('aria-pressed')).toBe('false') // c
    // 预览重算：仅剩 b（已锁定，目标锁定）→ 幂等 0 枚
    const summaryText = wrapper.find('.batch-lock-summary').text()
    expect(summaryText).toContain('已选择 1 枚')
    expect(summaryText).toContain('将改变 0 枚')
    expect(findByAriaPrefix(wrapper, '确认批量操作')!.attributes('disabled')).toBeDefined()
    expect(spy).not.toHaveBeenCalled()
  })

  it('§14：外部锁定状态变化 → 选择完全保持、changed/unchanged 重分类（非选择失效）、零事务', async () => {
    const playerStore = usePlayerStore()
    playerStore.runeInventory = [
      makeRune('a', { type: 'attack', isLocked: false }),
      makeRune('b', { type: 'luck', isLocked: true })
    ]
    const spy = vi.spyOn(playerStore, 'trySetRunesLocked')
    const wrapper = mount(RuneInventoryTab)
    await findByAriaPrefix(wrapper, '打开批量锁定管理')!.trigger('click')
    await nextTick()
    await candButtons(wrapper)[0].trigger('click')
    await nextTick()
    await candButtons(wrapper)[1].trigger('click')
    await nextTick()
    // 目标锁定：changed=a（普通攻击符文）
    let summaryText = wrapper.find('.batch-lock-summary').text()
    expect(summaryText).toContain('实际变化：普通攻击符文')

    // 外部翻转两枚锁定状态（Rune 本体仍存在 → 不是选择失效）
    playerStore.runeInventory = [
      { ...playerStore.runeInventory[0], isLocked: true },
      { ...playerStore.runeInventory[1], isLocked: false }
    ]
    await nextTick()
    await nextTick()

    // 两枚选择完全保持
    const list = candButtons(wrapper)
    expect(list[0].attributes('aria-pressed')).toBe('true')
    expect(list[1].attributes('aria-pressed')).toBe('true')
    // 分类重算：目标锁定下 changed 从 a 交换为 b（普通幸运符文）
    summaryText = wrapper.find('.batch-lock-summary').text()
    expect(summaryText).toContain('已选择 2 枚')
    expect(summaryText).toContain('将改变 1 枚')
    expect(summaryText).toContain('实际变化：普通幸运符文')
    expect(summaryText).not.toContain('攻击符文')
    expect(spy).not.toHaveBeenCalled()
  })

  it('§14：视图损坏 → 面板关闭、损坏横幅、零事务；修复后重开为 0 选择', async () => {
    const playerStore = usePlayerStore()
    playerStore.runeInventory = [
      makeRune('a', { isLocked: false }),
      makeRune('b', { type: 'luck', isLocked: false })
    ]
    const spy = vi.spyOn(playerStore, 'trySetRunesLocked')
    const wrapper = mount(RuneInventoryTab)
    await findByAriaPrefix(wrapper, '打开批量锁定管理')!.trigger('click')
    await nextTick()
    await candButtons(wrapper)[0].trigger('click')
    await nextTick()
    expect(candButtons(wrapper)[0].attributes('data-selected')).toBe('true')

    // 损坏 inventory（level 越界 → 视图 ok:false）
    playerStore.runeInventory = [
      { ...playerStore.runeInventory[0] },
      { ...playerStore.runeInventory[1], level: 999 }
    ]
    await nextTick()
    await nextTick()

    // 面板关闭、损坏横幅、零事务
    expect(wrapper.find('.batch-lock-panel').exists()).toBe(false)
    expect(wrapper.find('.broken-banner').exists()).toBe(true)
    expect(spy).not.toHaveBeenCalled()

    // 修复后横幅消失，重开面板为 0 选择（选择已被清空）
    playerStore.runeInventory = [
      makeRune('a', { isLocked: false }),
      makeRune('b', { type: 'luck', isLocked: false })
    ]
    await nextTick()
    await nextTick()
    expect(wrapper.find('.broken-banner').exists()).toBe(false)
    await findByAriaPrefix(wrapper, '打开批量锁定管理')!.trigger('click')
    await nextTick()
    for (const btn of candButtons(wrapper)) {
      expect(btn.attributes('data-selected')).toBe('false')
    }
    expect(wrapper.find('.batch-lock-summary').text()).toContain('已选择 0 枚')
    expect(spy).not.toHaveBeenCalled()
  })
})
