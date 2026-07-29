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
 * 不修改生产事务 / planner / balance 公式与报告；不触及 phase312/phase314 之外的实现。
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
  setActivePinia(createPinia())
  localStorage.clear()
  warmupStores()
})

afterEach(() => {
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

  it('saveGame 抛异常 → 完整回滚（长度/顺序/字段恢复）+ 磁盘原内容不变；恢复后可重放成功', () => {
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

  it('目标态切到解锁：已锁定的 b 变、未锁定的 a 不变（§20/§24）', async () => {
    setupInventory([
      makeRune('a', { isLocked: false }),
      makeRune('b', { type: 'luck', isLocked: true })
    ])
    const wrapper = mount(RuneInventoryTab)
    await findByAriaPrefix(wrapper, '打开批量锁定管理')!.trigger('click')
    await nextTick()
    await wrapper.find('select[aria-label="选择批量锁定目标状态"]').setValue('false')
    await nextTick()
    const list = cands(wrapper)
    await list[0].trigger('click') // a 未锁定 → 变
    await list[1].trigger('click') // b 已锁定 → 不变
    await nextTick()
    expect(wrapper.find('.batch-lock-summary').text()).toContain('将改变 1 枚')
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

  it('互斥：打开批量面板时镶嵌 picker 与强化面板关闭（§27）', async () => {
    setupInventory([makeRune('a', { isLocked: false })])
    const wrapper = mount(RuneInventoryTab)
    await findByAriaPrefix(wrapper, '打开批量锁定管理')!.trigger('click')
    await nextTick()
    expect(wrapper.find('.batch-lock-panel').exists()).toBe(true)
    expect(wrapper.find('.picker').exists()).toBe(false)
    expect(wrapper.find('.feed-panel').exists()).toBe(false)
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
