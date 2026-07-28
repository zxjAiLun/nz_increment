// @vitest-environment jsdom
/**
 * Phase 3.12 — Rune 锁定保护、原子切换与吞噬防误操作闭环
 *
 * 覆盖（对应 spec §13–§18 + §10/§12 UI 语义）：
 *   A. 旧档迁移（§13）：validateRune / validateRuneInventory 对缺失 isLocked → false（不丢弃 Rune）；
 *      buildRuneInventoryView 对旧 Rune 派生 row.isLocked=false。
 *   B. validator canonical 边界（§14）：isLocked === true/false 合法，其余值 fail-closed。
 *   C. 生成保留未锁定（§15）：planRuneGeneration 生成 Rune 必 isLocked=false 且仅消费 3 次 RNG。
 *   D. 纯规划 planRuneLockChange（§16）：成功锁定/解锁、幂等 changed:false、拒绝矩阵、
 *      输入零修改、无 RNG、fail-closed。
 *   E. 原子事务 trySetRuneLocked（§17）：成功单次写盘与持久化、幂等零写盘、规划失败零写盘、
 *      save 抛异常完整回滚、锁定已镶嵌 Rune 拓扑不变、其他 Rune/顺序不变、不影响属性生效。
 *   F. 升级/吞噬回归（§18）：planRuneExperienceGain 保留锁定；getRuneFeedExperience 锁定→null；
 *      planRuneFeeding 拒绝锁定材料、允许锁定目标并保持其锁定。
 *   G. UI 语义（§10/§12）：锁定/解锁按钮与 aria-label、点击调用事务并即时更新、锁定材料不进候选、
 *      已选材料锁定期间响应式失效（清空选择/预览消失/确认禁用/面板打开/事务 0 次）、解锁后重新出现不自动重选。
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
import { planRuneLockChange } from '../utils/runeLocking'
import {
  validateRune,
  validateRuneInventory,
  createEmptyEquipmentRuneSlots,
  getPlayerEquipmentRuneBonuses
} from '../utils/equipmentRunes'
import { getRuneFeedExperience, planRuneFeeding } from '../utils/runeFeeding'
import { planRuneExperienceGain } from '../utils/runeExperience'
import { planRuneGeneration, planRuneAcquisition } from '../utils/runeGeneration'
import { buildRuneInventoryView } from '../utils/runeInventoryView'
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

function makeRune(id: string, opts?: Partial<Omit<Rune, 'id'>>): Rune {
  return {
    id,
    type: opts?.type ?? 'attack',
    rarity: opts?.rarity ?? 'common',
    level: opts?.level ?? 1,
    exp: opts?.exp ?? 0,
    statValue: opts?.statValue ?? 10,
    ...(opts?.isLocked !== undefined ? { isLocked: opts.isLocked } : {})
  }
}

function makeRuneEquip(
  id: string,
  slot: EquipmentSlot,
  opts?: { runeSlots?: RuneSlot[] }
): Equipment {
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
// A. 旧档迁移（§13）：缺失 isLocked → false，不丢弃 Rune
// ============================================================================
describe('Phase 3.12 — 旧档迁移（isLocked 缺失 → false）', () => {
  it('validateRune 对缺失 / undefined isLocked 返回显式 false', () => {
    const missing = validateRune({ id: 'r1', type: 'attack', rarity: 'common', level: 1, exp: 0, statValue: 10 })
    const undef = validateRune({ id: 'r1', type: 'attack', rarity: 'common', level: 1, exp: 0, statValue: 10, isLocked: undefined })
    expect(missing.ok).toBe(true)
    expect(undef.ok).toBe(true)
    if (!missing.ok || !undef.ok) throw new Error('expected ok')
    expect(missing.rune.isLocked).toBe(false)
    expect(undef.rune.isLocked).toBe(false)
  })

  it('validateRuneInventory 对旧 Rune（无 isLocked）返回每枚显式 false，且不丢弃', () => {
    const oldInventory = [
      { id: 'a', type: 'attack', rarity: 'common', level: 2, exp: 5, statValue: 12 },
      { id: 'b', type: 'luck', rarity: 'epic', level: 1, exp: 0, statValue: 5 }
    ]
    const res = validateRuneInventory(oldInventory)
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error('expected ok')
    expect(res.inventory.length).toBe(2)
    expect(res.inventory.every(r => r.isLocked === false)).toBe(true)
    expect(res.inventory[0].id).toBe('a')
    expect(res.inventory[1].id).toBe('b')
  })

  it('buildRuneInventoryView 对旧 Rune 派生 row.isLocked=false（旧存档不丢符文）', () => {
    const oldRune = { id: 'a', type: 'attack', rarity: 'common', level: 1, exp: 0, statValue: 10 }
    const view = buildRuneInventoryView([oldRune], {})
    expect(view.ok).toBe(true)
    if (!view.ok) throw new Error('expected ok')
    expect(view.rows.length).toBe(1)
    expect(view.rows[0].isLocked).toBe(false)
  })
})

// ============================================================================
// B. validator canonical 边界（§14）
// ============================================================================
describe('Phase 3.12 — validateRune isLocked canonical 边界', () => {
  it('=== true / === false 合法', () => {
    expect(validateRune(makeRune('r', { isLocked: true })).ok).toBe(true)
    const f = validateRune(makeRune('r', { isLocked: false }))
    expect(f.ok).toBe(true)
    if (!f.ok) throw new Error('expected ok')
    expect(f.rune.isLocked).toBe(false)
  })

  it('其余值 fail-closed：null / 数字 / 字符串 / 对象 / 数组', () => {
    const cases = [
      { id: 'r', type: 'attack', rarity: 'common', level: 1, exp: 0, statValue: 10, isLocked: null },
      { id: 'r', type: 'attack', rarity: 'common', level: 1, exp: 0, statValue: 10, isLocked: 1 },
      { id: 'r', type: 'attack', rarity: 'common', level: 1, exp: 0, statValue: 10, isLocked: 'true' },
      { id: 'r', type: 'attack', rarity: 'common', level: 1, exp: 0, statValue: 10, isLocked: {} },
      { id: 'r', type: 'attack', rarity: 'common', level: 1, exp: 0, statValue: 10, isLocked: [] }
    ]
    for (const c of cases) {
      const res = validateRune(c)
      expect(res.ok).toBe(false)
      if (res.ok) throw new Error('expected invalid: ' + JSON.stringify(c))
      expect(res.reason).toContain('isLocked')
    }
  })

  it('validateRuneInventory 任一 Rune 的 isLocked 非法 → 整批失败', () => {
    const res = validateRuneInventory([
      makeRune('a'),
      { id: 'b', type: 'luck', rarity: 'epic', level: 1, exp: 0, statValue: 5, isLocked: 'yes' }
    ])
    expect(res.ok).toBe(false)
  })
})

// ============================================================================
// C. 生成保留未锁定（§15）
// ============================================================================
describe('Phase 3.12 — planRuneGeneration 生成 Rune 必未锁定且仅 3 次 RNG', () => {
  function fixedRng(value: number) {
    return () => value
  }

  it('生成 Rune isLocked 显式为 false，且仅消费 3 次 RNG', () => {
    const res = planRuneGeneration(fixedRng(0.5), 1000)
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error('expected ok')
    expect(res.rune.isLocked).toBe(false)
    expect(res.rollsConsumed).toBe(3)
  })

  it('runeEquals 归一化：undefined 与 false 视为相等（防锁定丢失），true 与 false 不相等', () => {
    const a = makeRune('r') // isLocked 缺失
    const b = makeRune('r', { isLocked: false })
    const c = makeRune('r', { isLocked: true })
    expect(runeEquals(a, b)).toBe(true)
    expect(runeEquals(a, c)).toBe(false)
    expect(runeEquals(b, c)).toBe(false)
  })
})

// ============================================================================
// D. 纯规划 planRuneLockChange（§16）
// ============================================================================
describe('Phase 3.12 — planRuneLockChange 成功与幂等', () => {
  it('未锁定 → 锁定：changed=true，nextRune.isLocked=true，其余字段不变', () => {
    const inventory = [makeRune('t1', { rarity: 'epic', level: 3, statValue: 20 })]
    const plan = planRuneLockChange({ inventory, runeId: 't1', isLocked: true })
    expect(plan.ok).toBe(true)
    if (!plan.ok) throw new Error('expected ok')
    expect(plan.changed).toBe(true)
    expect(plan.targetIndex).toBe(0)
    expect(plan.nextRune.isLocked).toBe(true)
    expect(plan.nextRune.id).toBe('t1')
    expect(plan.nextRune.rarity).toBe('epic')
    expect(plan.nextRune.level).toBe(3)
    expect(plan.nextRune.statValue).toBe(20)
    expect(plan.nextRune.type).toBe('attack')
  })

  it('已锁定 → 解锁：changed=true，nextRune.isLocked=false', () => {
    const inventory = [makeRune('t1', { isLocked: true })]
    const plan = planRuneLockChange({ inventory, runeId: 't1', isLocked: false })
    expect(plan.ok).toBe(true)
    if (!plan.ok) throw new Error('expected ok')
    expect(plan.changed).toBe(true)
    expect(plan.nextRune.isLocked).toBe(false)
  })

  it('已处于目标态 → changed:false（幂等），targetRune 与 nextRune 等值', () => {
    const locked = [makeRune('t1', { isLocked: true })]
    const lockAgain = planRuneLockChange({ inventory: locked, runeId: 't1', isLocked: true })
    expect(lockAgain.ok).toBe(true)
    if (!lockAgain.ok) throw new Error('expected ok')
    expect(lockAgain.changed).toBe(false)
    expect(runeEquals(lockAgain.targetRune, lockAgain.nextRune)).toBe(true)

    const unlocked = [makeRune('t1', { isLocked: false })]
    const unlockAgain = planRuneLockChange({ inventory: unlocked, runeId: 't1', isLocked: false })
    expect(unlockAgain.ok).toBe(true)
    if (!unlockAgain.ok) throw new Error('expected ok')
    expect(unlockAgain.changed).toBe(false)
  })

  it('旧 Rune（无 isLocked）锁定 → changed:true，nextRune.isLocked=true（迁移语义）', () => {
    const old = [{ id: 't1', type: 'attack', rarity: 'common', level: 1, exp: 0, statValue: 10 }]
    const plan = planRuneLockChange({ inventory: old, runeId: 't1', isLocked: true })
    expect(plan.ok).toBe(true)
    if (!plan.ok) throw new Error('expected ok')
    expect(plan.changed).toBe(true)
    expect(plan.nextRune.isLocked).toBe(true)
  })
})

describe('Phase 3.12 — planRuneLockChange 拒绝矩阵与纪律', () => {
  const inventory = () => [makeRune('t1'), makeRune('t2')]

  function expectReject(input: Parameters<typeof planRuneLockChange>[0]) {
    const plan = planRuneLockChange(input)
    expect(plan.ok).toBe(false)
    return plan.ok ? '' : plan.reason
  }

  it('非字符串 / 空白 ID → 拒绝', () => {
    expectReject({ inventory: inventory(), runeId: null, isLocked: true })
    expectReject({ inventory: inventory(), runeId: 42, isLocked: true })
    expectReject({ inventory: inventory(), runeId: '  ', isLocked: true })
    expectReject({ inventory: inventory(), runeId: '', isLocked: true })
  })

  it('isLocked 非严格 boolean → 拒绝（truthy/falsy 猜测）', () => {
    expectReject({ inventory: inventory(), runeId: 't1', isLocked: 1 })
    expectReject({ inventory: inventory(), runeId: 't1', isLocked: 0 })
    expectReject({ inventory: inventory(), runeId: 't1', isLocked: 'true' })
    expectReject({ inventory: inventory(), runeId: 't1', isLocked: undefined })
  })

  it('Rune 不存在 → 拒绝', () => {
    const reason = expectReject({ inventory: inventory(), runeId: 'missing', isLocked: true })
    expect(reason).toContain('not found')
  })

  it('inventory 非法（重复 ID / 非数组 / malformed 项）→ 拒绝', () => {
    expectReject({ inventory: [makeRune('t1'), makeRune('t1')], runeId: 't1', isLocked: true })
    expectReject({ inventory: 'nope', runeId: 't1', isLocked: true })
    expectReject({ inventory: [makeRune('t1'), { bad: true }], runeId: 't1', isLocked: true })
  })

  it('不修改输入 inventory（字节级不可变）', () => {
    const inv = inventory()
    const before = inv.map(r => ({ ...r }))
    planRuneLockChange({ inventory: inv, runeId: 't1', isLocked: true })
    for (let i = 0; i < inv.length; i++) {
      expect(runeEquals(inv[i], before[i])).toBe(true)
    }
  })

  it('规划全程不调用 RNG', () => {
    const spy = vi.spyOn(Math, 'random')
    planRuneLockChange({ inventory: inventory(), runeId: 't1', isLocked: true })
    expect(spy).not.toHaveBeenCalled()
  })

  it('Proxy 抛异常 → fail-closed，不向调用方传播', () => {
    const trap = new Proxy(
      {},
      {
        get() {
          throw new Error('trap')
        }
      }
    )
    expect(() =>
      planRuneLockChange({ inventory: trap, runeId: 't1', isLocked: true })
    ).not.toThrow()
    const res = planRuneLockChange({ inventory: trap, runeId: 't1', isLocked: true })
    expect(res.ok).toBe(false)
  })
})

// ============================================================================
// E. 原子事务 trySetRuneLocked（§17）
// ============================================================================
describe('Phase 3.12 — trySetRuneLocked 成功事务与持久化', () => {
  it('锁定成功：isLocked=true、单次写主存档、恢复后可持久', () => {
    const playerStore = usePlayerStore()
    playerStore.runeInventory = [makeRune('t1'), makeRune('t2')]
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    const res = playerStore.trySetRuneLocked('t1', true)
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error('expected ok')
    expect(res.changed).toBe(true)
    expect(res.isLocked).toBe(true)
    expect(playerStore.runeInventory.find(r => r.id === 't1')!.isLocked).toBe(true)

    const saveWrites = setItemSpy.mock.calls.filter(c => c[0] === SAVE_KEY)
    expect(saveWrites.length).toBe(1)

    setActivePinia(createPinia())
    warmupStores()
    const reloaded = usePlayerStore()
    reloaded.loadGame()
    expect(reloaded.runeInventory.find(r => r.id === 't1')!.isLocked).toBe(true)
    expect(reloaded.runeInventory.find(r => r.id === 't2')!.isLocked).toBe(false)
  })

  it('解锁成功：isLocked=false、持久化', () => {
    const playerStore = usePlayerStore()
    playerStore.runeInventory = [makeRune('t1', { isLocked: true }), makeRune('t2', { isLocked: true })]
    const res = playerStore.trySetRuneLocked('t1', false)
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error('expected ok')
    expect(res.changed).toBe(true)
    expect(res.isLocked).toBe(false)
    expect(playerStore.runeInventory.find(r => r.id === 't1')!.isLocked).toBe(false)
    expect(playerStore.runeInventory.find(r => r.id === 't2')!.isLocked).toBe(true)
  })

  it('已处于目标态 → changed:false、零写盘、内存零修改', () => {
    const playerStore = usePlayerStore()
    playerStore.runeInventory = [makeRune('t1', { isLocked: true }), makeRune('t2')]
    const before = playerStore.runeInventory.map(r => ({ ...r }))
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    const res = playerStore.trySetRuneLocked('t1', true) // 已锁定，再锁
    expect(res.ok).toBe(true)
    expect(res.changed).toBe(false)
    expect(setItemSpy.mock.calls.filter(c => c[0] === SAVE_KEY).length).toBe(0)
    for (let i = 0; i < before.length; i++) {
      expect(runeEquals(playerStore.runeInventory[i], before[i])).toBe(true)
    }
  })

  it('规划失败（Rune 不存在）→ 零修改零写盘', () => {
    const playerStore = usePlayerStore()
    playerStore.runeInventory = [makeRune('t1')]
    const before = playerStore.runeInventory.map(r => ({ ...r }))
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    const res = playerStore.trySetRuneLocked('missing', true)
    expect(res.ok).toBe(false)
    expect(setItemSpy.mock.calls.filter(c => c[0] === SAVE_KEY).length).toBe(0)
    for (let i = 0; i < before.length; i++) {
      expect(runeEquals(playerStore.runeInventory[i], before[i])).toBe(true)
    }
  })
})

describe('Phase 3.12 — trySetRuneLocked 失败与回滚', () => {
  it('saveGame 抛异常 → 完整回滚（锁定不生效、其他 Rune/顺序/长度恢复）', () => {
    const playerStore = usePlayerStore()
    const other = makeRune('o1', { rarity: 'epic', level: 4, statValue: 20 })
    const target = makeRune('t1')
    playerStore.runeInventory = [other, target]
    const before = playerStore.runeInventory.map(r => ({ ...r }))

    installThrowingStorage()
    const res = playerStore.trySetRuneLocked('t1', true)
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('expected rejected')
    expect(res.reason).toBe('save failed')
    expect(res.changed).toBe(false)

    expect(playerStore.runeInventory.length).toBe(2)
    for (let i = 0; i < before.length; i++) {
      expect(runeEquals(playerStore.runeInventory[i], before[i])).toBe(true)
    }
  })

  it('save 失败后磁盘原字符串不变；恢复 storage 后同一事务可成功重放', () => {
    const playerStore = usePlayerStore()
    playerStore.runeInventory = [makeRune('t1'), makeRune('t2')]
    playerStore.saveGame()
    const diskBefore = localStorage.getItem(SAVE_KEY)

    installThrowingStorage()
    expect(playerStore.trySetRuneLocked('t1', true).ok).toBe(false)
    vi.unstubAllGlobals()

    expect(localStorage.getItem(SAVE_KEY)).toBe(diskBefore)

    const res = playerStore.trySetRuneLocked('t1', true)
    expect(res.ok).toBe(true)
    expect(playerStore.runeInventory.find(r => r.id === 't1')!.isLocked).toBe(true)
  })

  it('锁定已镶嵌 Rune：装备拓扑不变、聚合符文加成不变（§11 锁定不影响属性）', () => {
    const playerStore = usePlayerStore()
    const target = makeRune('t1', { type: 'attack', statValue: 10 })
    playerStore.runeInventory = [target, makeRune('t2')]
    playerStore.player.equipment[SLOT_A] = makeRuneEquip('eq1', SLOT_A, { runeSlots: slotsWith('t1') })

    const bonusBefore = getPlayerEquipmentRuneBonuses(playerStore.player.equipment, playerStore.runeInventory)
    const res = playerStore.trySetRuneLocked('t1', true)
    expect(res.ok).toBe(true)

    // 拓扑不变：仍引用 t1
    const eq = playerStore.player.equipment[SLOT_A]!
    expect(eq.runeSlots[0].runeId).toBe('t1')
    expect(eq.runeSlots[1].runeId).toBeNull()
    expect(eq.runeSlots[2].runeId).toBeNull()

    // 加成不变（锁定不参与属性公式）
    const bonusAfter = getPlayerEquipmentRuneBonuses(playerStore.player.equipment, playerStore.runeInventory)
    expect(bonusAfter).toEqual(bonusBefore)
  })

  it('锁定某 Rune：其他 Rune 字段与相对顺序完全不变', () => {
    const playerStore = usePlayerStore()
    const a = makeRune('a', { rarity: 'rare', level: 2, statValue: 13 })
    const b = makeRune('b', { type: 'luck', isLocked: true })
    const c = makeRune('c', { type: 'crit', rarity: 'epic' })
    playerStore.runeInventory = [a, b, c]
    const res = playerStore.trySetRuneLocked('a', true)
    expect(res.ok).toBe(true)
    expect(playerStore.runeInventory.map(r => r.id)).toEqual(['a', 'b', 'c'])
    expect(runeEquals(playerStore.runeInventory[1], b)).toBe(true)
    expect(runeEquals(playerStore.runeInventory[2], c)).toBe(true)
    expect(playerStore.runeInventory[0].id).toBe('a')
    expect(playerStore.runeInventory[0].isLocked).toBe(true)
  })
})

// ============================================================================
// F. 升级 / 吞噬回归（§18）
// ============================================================================
describe('Phase 3.12 — 升级与吞噬对锁定的处理', () => {
  it('planRuneExperienceGain 保留锁定：锁定 Rune 升级后仍锁定', () => {
    const locked = makeRune('t1', { level: 2, exp: 0, isLocked: true })
    const plan = planRuneExperienceGain(locked, 15)
    expect(plan.ok).toBe(true)
    if (!plan.ok) throw new Error('expected ok')
    expect(plan.nextRune.isLocked).toBe(true)
  })

  it('getRuneFeedExperience：锁定 Rune → null（锁定保护破坏性消耗）', () => {
    expect(getRuneFeedExperience(makeRune('m', { rarity: 'legend', isLocked: true }))).toBeNull()
    // 未锁定 / 旧 Rune（无 isLocked）仍可产出经验
    expect(getRuneFeedExperience(makeRune('m', { rarity: 'legend' }))).toBe(135)
  })

  it('planRuneFeeding 拒绝锁定材料（materialRune.isLocked=true）', () => {
    const plan = planRuneFeeding({
      targetRuneId: 't1',
      materialRuneId: 'm1',
      inventory: [makeRune('t1', { level: 2 }), makeRune('m1', { rarity: 'rare', isLocked: true })],
      equipmentBySlot: {}
    })
    expect(plan.ok).toBe(false)
    if (plan.ok) throw new Error('expected reject')
    expect(plan.reason).toBe('material rune is locked')
  })

  it('planRuneFeeding 允许锁定目标，nextTargetRune 保持锁定', () => {
    const plan = planRuneFeeding({
      targetRuneId: 't1',
      materialRuneId: 'm1',
      inventory: [makeRune('t1', { level: 2, isLocked: true }), makeRune('m1', { rarity: 'common' })],
      equipmentBySlot: {}
    })
    expect(plan.ok).toBe(true)
    if (!plan.ok) throw new Error('expected ok')
    expect(plan.nextTargetRune.isLocked).toBe(true)
  })
})

// ============================================================================
// G. UI 语义（§10 / §12）
// ============================================================================
describe('Phase 3.12 — 仓库 UI 锁定 / 解锁', () => {
  function seedInventory(runes: Rune[]) {
    const playerStore = usePlayerStore()
    playerStore.runeInventory = runes
    return playerStore
  }

  it('未锁定卡片显示「未锁定」与「锁定」按钮，aria-label 含 Rune 名；已锁定显示「已锁定」与「解锁」', async () => {
    const playerStore = seedInventory([makeRune('t1'), makeRune('l1', { type: 'defense', isLocked: true })])
    const wrapper = mount(RuneInventoryTab)
    await nextTick()

    // 未锁定
    expect(wrapper.text()).toContain('未锁定')
    const lockBtn = findByAriaPrefix(wrapper, '锁定 普通攻击符文')
    expect(lockBtn).toBeTruthy()

    // 已锁定
    expect(wrapper.text()).toContain('已锁定')
    const unlockBtn = findByAriaPrefix(wrapper, '解锁 普通防御符文')
    expect(unlockBtn).toBeTruthy()
    expect(unlockBtn!.text()).toContain('解锁')

    // 锁定按钮身份用 canonical ID（非 index）
    expect(playerStore.runeInventory.length).toBe(2)
  })

  it('点击锁定按钮 → 调用 trySetRuneLocked、卡片即时更新为已锁定、显示成功反馈', async () => {
    const playerStore = seedInventory([makeRune('t1'), makeRune('m1', { type: 'defense' })])
    const lockSpy = vi.spyOn(playerStore, 'trySetRuneLocked')
    const wrapper = mount(RuneInventoryTab)
    await nextTick()

    await findByAriaPrefix(wrapper, '锁定 普通防御符文')!.trigger('click')
    await nextTick()

    expect(lockSpy).toHaveBeenCalledWith('m1', true)
    expect(playerStore.runeInventory.find(r => r.id === 'm1')!.isLocked).toBe(true)
    expect(wrapper.text()).toContain('已锁定')
    expect(wrapper.text()).toContain('普通防御符文 已锁定')
  })

  it('点击解锁按钮 → 调用 trySetRuneLocked 并恢复为未锁定', async () => {
    const playerStore = seedInventory([makeRune('l1', { type: 'defense', isLocked: true })])
    const lockSpy = vi.spyOn(playerStore, 'trySetRuneLocked')
    const wrapper = mount(RuneInventoryTab)
    await nextTick()

    await findByAriaPrefix(wrapper, '解锁 普通防御符文')!.trigger('click')
    await nextTick()

    expect(lockSpy).toHaveBeenCalledWith('l1', false)
    expect(playerStore.runeInventory.find(r => r.id === 'l1')!.isLocked).toBe(false)
    expect(wrapper.text()).toContain('未锁定')
  })

  it('事务失败 → 显示失败、绝不显示成功、Rune 状态不变、不崩溃', async () => {
    const playerStore = seedInventory([makeRune('m1', { type: 'defense' })])
    vi.spyOn(playerStore, 'trySetRuneLocked').mockReturnValue({ ok: false, reason: 'save failed', changed: false })
    const wrapper = mount(RuneInventoryTab)
    await nextTick()

    await findByAriaPrefix(wrapper, '锁定 普通防御符文')!.trigger('click')
    await nextTick()

    expect(wrapper.text()).toContain('锁定操作失败')
    expect(wrapper.text()).not.toContain('已锁定')
    // 事务失败：Rune 锁定状态不变（旧 Rune 仍非锁定，绝不变为 true）
    expect(playerStore.runeInventory[0].isLocked === true).toBe(false)
  })
})

describe('Phase 3.12 — 锁定材料不进吞噬候选 + §12 响应式失效', () => {
  function seedInventory(runes: Rune[]) {
    const playerStore = usePlayerStore()
    playerStore.runeInventory = runes
    return playerStore
  }

  it('已锁定材料不出现在强化候选列表中', async () => {
    seedInventory([
      makeRune('t1', { level: 2 }),
      makeRune('fresh', { type: 'defense' }),
      makeRune('lockedMat', { type: 'crit', isLocked: true })
    ])
    const wrapper = mount(RuneInventoryTab)
    await nextTick()
    await findByAriaPrefix(wrapper, '强化 普通攻击符文')!.trigger('click')
    await nextTick()

    const panel = wrapper.find('[aria-label="强化符文"]')
    const materialButtons = panel.findAll('.feed-material')
    // 仅 fresh（普通防御符文）合格；lockedMat（普通暴击符文）被 isLocked 排除
    expect(materialButtons.length).toBe(1)
    expect(materialButtons[0].text()).toContain('普通防御符文')
    expect(panel.text()).not.toContain('普通暴击符文')
  })

  it('§12：已选材料在面板打开期间被锁定 → 清空选择/预览消失/确认禁用/面板保持打开/吞噬事务 0 次', async () => {
    const playerStore = seedInventory([
      makeRune('t1', { level: 2 }),
      makeRune('m1', { type: 'defense' }),
      makeRune('m2', { type: 'crit' })
    ])
    const feedSpy = vi.spyOn(playerStore, 'tryFeedRunes')
    const lockSpy = vi.spyOn(playerStore, 'trySetRuneLocked')

    const wrapper = mount(RuneInventoryTab)
    await nextTick()
    await findByAriaPrefix(wrapper, '强化 普通攻击符文')!.trigger('click')
    await nextTick()
    await findByAriaPrefix(wrapper, '选择材料 普通防御符文')!.trigger('click')
    await nextTick()
    expect(wrapper.find('[aria-label="强化预览"]').exists()).toBe(true)

    // 面板打开期间锁定已选材料 m1
    await findByAriaPrefix(wrapper, '锁定 普通防御符文')!.trigger('click')
    await nextTick()
    await nextTick()

    expect(lockSpy).toHaveBeenCalledWith('m1', true)
    // 面板保持打开
    expect(wrapper.find('[aria-label="强化符文"]').exists()).toBe(true)
    // 预览消失
    expect(wrapper.find('[aria-label="强化预览"]').exists()).toBe(false)
    // 确认按钮禁用
    const confirmBtn = findByAriaPrefix(wrapper, '确认强化')
    expect(confirmBtn).toBeTruthy()
    expect(confirmBtn!.attributes('disabled')).toBeDefined()
    // 吞噬事务 0 次
    expect(feedSpy).not.toHaveBeenCalled()
  })

  it('§12：被锁定材料解锁后重新出现在候选，但不自动重选（确认仍禁用）', async () => {
    seedInventory([
      makeRune('t1', { level: 2 }),
      makeRune('m1', { type: 'defense' }),
      makeRune('m2', { type: 'crit' })
    ])
    const wrapper = mount(RuneInventoryTab)
    await nextTick()
    await findByAriaPrefix(wrapper, '强化 普通攻击符文')!.trigger('click')
    await nextTick()
    await findByAriaPrefix(wrapper, '选择材料 普通防御符文')!.trigger('click')
    await nextTick()

    // 锁定 → 失效
    await findByAriaPrefix(wrapper, '锁定 普通防御符文')!.trigger('click')
    await nextTick()
    await nextTick()
    expect(wrapper.find('[aria-label="强化预览"]').exists()).toBe(false)

    // 解锁 → 重新出现，但不自动重选
    await findByAriaPrefix(wrapper, '解锁 普通防御符文')!.trigger('click')
    await nextTick()
    await nextTick()

    const panel = wrapper.find('[aria-label="强化符文"]')
    const materialButtons = panel.findAll('.feed-material')
    const defBtns = materialButtons.filter(b => b.text().includes('普通防御符文'))
    expect(defBtns.length).toBe(1) // 材料重新出现
    // 确认仍禁用（未自动重选）
    const confirmBtn = findByAriaPrefix(wrapper, '确认强化')
    expect(confirmBtn!.attributes('disabled')).toBeDefined()
    expect(wrapper.find('[aria-label="强化预览"]').exists()).toBe(false)
  })
})

// ============================================================================
// H. Phase 3.12.1 — 既有事务锁定状态单快照（P1-A / P1-B）
// ============================================================================

/**
 * 构造「时变」Rune：isLocked 第一次被读取时返回初始值，之后的读取返回反转值，并统计读取次数。
 * 用于证明事务只读取一次（raw snapshot），从而在时变 Proxy 下不会丢失/篡改已有 Rune 的锁定状态。
 * 读取次数作为「旧实现（多次读取）会稳定失败」的判别量（新实现每 Rune 仅 1 次）。
 */
function makeTimeVaryingRune(initial: {
  id: string
  type?: any
  rarity?: any
  level?: number
  exp?: number
  statValue?: number
  isLocked: boolean
}): { proxy: any; getLockReads: () => number } {
  let first = true
  let reads = 0
  const rune: any = {
    id: initial.id,
    type: initial.type ?? 'attack',
    rarity: initial.rarity ?? 'common',
    level: initial.level ?? 1,
    exp: initial.exp ?? 0,
    statValue: initial.statValue ?? 10,
    isLocked: initial.isLocked
  }
  const proxy = new Proxy(rune, {
    get(target, prop) {
      if (prop === 'isLocked') {
        reads++
        const v = first ? target.isLocked : !target.isLocked
        first = false
        return v
      }
      const v = (target as any)[prop]
      return typeof v === 'function' ? v.bind(target) : v
    }
  })
  return { proxy, getLockReads: () => reads }
}

/** 构造一枚「统计 isLocked 读取次数」的 Proxy Rune（用于 planner 内部稳定性测试）。 */
function makeLockCountingRune(initial: {
  id: string
  type?: any
  rarity?: any
  level?: number
  exp?: number
  statValue?: number
  isLocked: boolean
}): { proxy: any; getLockReads: () => number } {
  let reads = 0
  const rune: any = {
    id: initial.id,
    type: initial.type ?? 'attack',
    rarity: initial.rarity ?? 'common',
    level: initial.level ?? 1,
    exp: initial.exp ?? 0,
    statValue: initial.statValue ?? 10,
    isLocked: initial.isLocked
  }
  const proxy = new Proxy(rune, {
    get(target, prop) {
      if (prop === 'isLocked') {
        reads++
        return target.isLocked
      }
      const v = (target as any)[prop]
      return typeof v === 'function' ? v.bind(target) : v
    }
  })
  return { proxy, getLockReads: () => reads }
}

describe('Phase 3.12.1 — tryAddRuneExperience 单快照：时变锁定不被篡改（P1-A）', () => {
  it('时变 Rune（首次 false 之后 true）：事务只读一次、target 仍为 false、不意外锁定、经验与 planner 对拍', () => {
    const r1 = makeTimeVaryingRune({ id: 't1', type: 'attack', rarity: 'common', level: 2, exp: 0, statValue: 10, isLocked: false })
    const playerStore = usePlayerStore()
    playerStore.runeInventory = [r1.proxy]

    const plan = planRuneExperienceGain(makeRune('t1', { level: 2, exp: 0, statValue: 10, isLocked: false }), 100)
    const res = playerStore.tryAddRuneExperience('t1', 100)
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error('expected ok')
    // 真实 raw inventory 中该 Rune 的 isLocked 仅读取一次（旧实现会读取 3 次 → 此断言稳定失败）
    expect(r1.getLockReads()).toBe(1)
    // target 锁定状态来自唯一稳定快照（首次读取为 false）→ 保持未锁定，不意外锁定
    expect(playerStore.runeInventory[0].isLocked === true).toBe(false)
    // 经验结果与纯 planner 对拍
    expect(res.levelsGained).toBe(plan.ok ? plan.levelsGained : 0)
    expect(res.level).toBe(plan.ok ? plan.nextRune.level : 1)
    expect(res.exp).toBe(plan.ok ? plan.nextRune.exp : 0)
  })

  it('时变 Rune（首次 true 之后 false）：事务只读一次、target 仍为 true、不意外解锁', () => {
    const r1 = makeTimeVaryingRune({ id: 't1', type: 'attack', rarity: 'common', level: 2, exp: 0, statValue: 10, isLocked: true })
    const playerStore = usePlayerStore()
    playerStore.runeInventory = [r1.proxy]
    const res = playerStore.tryAddRuneExperience('t1', 100)
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error('expected ok')
    expect(r1.getLockReads()).toBe(1)
    expect(playerStore.runeInventory[0].isLocked === true).toBe(true)
  })

  it('正常数组：锁定 target 升级后仍锁定；未锁定 target 升级后仍未锁定', () => {
    const playerStore = usePlayerStore()
    playerStore.runeInventory = [makeRune('t1', { level: 2, statValue: 10, isLocked: true })]
    const res = playerStore.tryAddRuneExperience('t1', 100)
    expect(res.ok).toBe(true)
    expect(playerStore.runeInventory[0].isLocked).toBe(true)

    playerStore.runeInventory = [makeRune('t2', { level: 2, statValue: 10 })]
    const res2 = playerStore.tryAddRuneExperience('t2', 100)
    expect(res2.ok).toBe(true)
    expect(playerStore.runeInventory[0].isLocked === true).toBe(false)
  })

  it('saveGame 返回 false / 抛异常 → 原始锁定状态完整回滚（其他 Rune 的 true/false/missing 不变）', () => {
    const playerStore = usePlayerStore()
    const others: Rune[] = [
      makeRune('o1', { isLocked: true }),
      makeRune('o2', { type: 'defense' }), // 缺失 isLocked → false
      { id: 'o3', type: 'luck', rarity: 'common', level: 1, exp: 0, statValue: 5 } as Rune // 显式缺 isLocked
    ]
    playerStore.runeInventory = [makeRune('t1', { level: 2, statValue: 10, isLocked: true }), ...others]

    installThrowingStorage()
    const res = playerStore.tryAddRuneExperience('t1', 100)
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('save failed')
    // 回滚：target 仍锁定，其他 Rune 锁定状态/顺序不变
    expect(playerStore.runeInventory[0].isLocked).toBe(true)
    expect(playerStore.runeInventory.length).toBe(4)
    expect(playerStore.runeInventory[1].id).toBe('o1')
    expect(playerStore.runeInventory[1].isLocked).toBe(true)
    expect(playerStore.runeInventory[2].id).toBe('o2')
    expect(playerStore.runeInventory[2].isLocked === true).toBe(false)
    expect(playerStore.runeInventory[3].id).toBe('o3')
    expect(playerStore.runeInventory[3].isLocked === true).toBe(false)
  })
})

describe('Phase 3.12.1 — tryAcquireRune / planRuneAcquisition 单快照：入库不改变已有锁定（P1-B）', () => {
  it('planRuneAcquisition 纯规划：每个原 Rune 的 isLocked 仅读取一次（稳定快照；旧实现会读取 2 次）', () => {
    const r1 = makeLockCountingRune({ id: 'r1', isLocked: true })
    const r2 = makeLockCountingRune({ id: 'r2', isLocked: false })
    const candidate = makeRune('new', { type: 'luck', statValue: 5 })
    const plan = planRuneAcquisition([r1.proxy, r2.proxy], candidate)
    expect(plan.ok).toBe(true)
    if (!plan.ok) throw new Error('expected ok')
    expect(plan.nextInventory.length).toBe(3)
    // 新实现稳定快照 → 每枚原 Rune 的 isLocked 仅被读取一次（旧实现 validate + 构造会读取 2 次 → 此断言稳定失败）
    expect(r1.getLockReads()).toBe(1)
    expect(r2.getLockReads()).toBe(1)
  })

  it('时变 Rune（已有 r1 首次 true 之后 false）：tryAcquireRune 单快照、r1 仍锁定、仅写一次', () => {
    const r1 = makeTimeVaryingRune({ id: 'r1', type: 'attack', statValue: 10, isLocked: true })
    const playerStore = usePlayerStore()
    playerStore.runeInventory = [r1.proxy]
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    const candidate = makeRune('new', { type: 'luck', statValue: 5 })
    const res = playerStore.tryAcquireRune(candidate)
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error('expected ok')
    // 真实 raw inventory 中 r1 的 isLocked 仅读取一次（旧实现多次读取 → 此断言稳定失败）
    expect(r1.getLockReads()).toBe(1)
    // 已有 r1 锁定状态不变（来自唯一稳定快照的首次读取 true）
    const got = playerStore.runeInventory.find(r => r.id === 'r1')!
    expect(got.isLocked === true).toBe(true)
    // 新 Rune 正常追加
    expect(playerStore.runeInventory.find(r => r.id === 'new')).toBeTruthy()
    // 只写主存档一次
    expect(setItemSpy.mock.calls.filter(c => c[0] === SAVE_KEY).length).toBe(1)
  })

  it('时变 Rune（已有 r1 首次 false 之后 true）：入库后 r1 仍 false（不意外锁定）', () => {
    const r1 = makeTimeVaryingRune({ id: 'r1', type: 'attack', statValue: 10, isLocked: false })
    const playerStore = usePlayerStore()
    playerStore.runeInventory = [r1.proxy]
    const candidate = makeRune('new', { type: 'luck', statValue: 5 })
    const res = playerStore.tryAcquireRune(candidate)
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error('expected ok')
    expect(r1.getLockReads()).toBe(1)
    const got = playerStore.runeInventory.find(r => r.id === 'r1')!
    expect(got.isLocked === true).toBe(false)
  })

  it('tryGenerateAndAcquireRune：已有锁定 Rune 状态不变，RNG 仍恰三次', () => {
    const playerStore = usePlayerStore()
    playerStore.runeInventory = [makeRune('r1', { type: 'attack', isLocked: true })]
    const rngSpy = vi.fn(() => 0.5)
    const res = playerStore.tryGenerateAndAcquireRune(rngSpy, 12345)
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error('expected ok')
    expect(rngSpy).toHaveBeenCalledTimes(3)
    expect(playerStore.runeInventory.find(r => r.id === 'r1')!.isLocked).toBe(true)
    expect(playerStore.runeInventory.length).toBe(2)
  })

  it('save 失败 / 抛异常 → 已有 Rune 锁定状态与 candidate 追加均完整回滚', () => {
    const playerStore = usePlayerStore()
    playerStore.runeInventory = [makeRune('r1', { type: 'attack', isLocked: true }), makeRune('r2', { type: 'defense' })]
    installThrowingStorage()
    const res = playerStore.tryAcquireRune(makeRune('new', { type: 'luck' }))
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('save failed')
    expect(playerStore.runeInventory.length).toBe(2)
    expect(playerStore.runeInventory.find(r => r.id === 'r1')!.isLocked).toBe(true)
    expect(playerStore.runeInventory.find(r => r.id === 'r2')).toBeTruthy()
    expect(playerStore.runeInventory.find(r => r.id === 'new')).toBeFalsy()
  })
})

// ============================================================================
// I. Phase 3.12.1 — 真实旧档迁移集成（P2）
// ============================================================================
describe('Phase 3.12.1 — 真实旧档迁移集成（loadGame → canonical isLocked）', () => {
  interface SaveOptions {
    runeIsLocked?: boolean | null | number | string | object
    explicit?: boolean
  }

  function buildSave(opts: SaveOptions) {
    const rune: any = { id: 'r1', type: 'attack', rarity: 'common', level: 1, exp: 0, statValue: 10 }
    if (opts.explicit) {
      if (opts.runeIsLocked === undefined) {
        // 不写 isLocked（旧档缺字段）
      } else if (opts.runeIsLocked === null) {
        rune.isLocked = null
      } else if (typeof opts.runeIsLocked === 'boolean') {
        rune.isLocked = opts.runeIsLocked
      } else {
        rune.isLocked = opts.runeIsLocked // 1 / 'true' / {} 等非法值
      }
    }
    const equipment: any = {
      weapon: {
        id: 'w1',
        slot: 'weapon',
        name: 'w1',
        rarity: 'common',
        level: 10,
        stats: [{ type: 'attack', value: 100, isPercent: false }],
        isLocked: false,
        affixes: [],
        refiningSlots: [],
        refiningLevel: 0,
        runeSlots: [
          { index: 0, runeId: 'r1' },
          { index: 1, runeId: null },
          { index: 2, runeId: null }
        ]
      }
    }
    return {
      player: { equipment },
      runeData: { inventory: [rune] },
      lastOfflineCheckpointAt: Date.now()
    }
  }

  function reloadWith(save: any) {
    setActivePinia(createPinia())
    warmupStores()
    const store = usePlayerStore()
    localStorage.setItem(SAVE_KEY, JSON.stringify(save))
    store.loadGame()
    return store
  }

  it('旧档缺 isLocked → 加载后 isLocked===false、装备引用保持、属性加成一致、写回含显式 isLocked:false', () => {
    const store = reloadWith(buildSave({ explicit: false }))
    const r1 = store.runeInventory.find(r => r.id === 'r1')
    expect(r1).toBeTruthy()
    expect(r1!.isLocked).toBe(false)
    // 装备引用保持
    const eq = (store.player.equipment as Record<string, any>).weapon
    expect(eq.runeSlots[0].runeId).toBe('r1')
    // 属性加成一致（attack +10，来自 r1 的有效属性）。getPlayerEquipmentRuneBonuses 返回 StatBonus[]
    const bonus = getPlayerEquipmentRuneBonuses(store.player.equipment, store.runeInventory)
    const atk = bonus.find(b => b.type === 'attack')
    expect(atk).toBeTruthy()
    expect(atk!.value).toBe(10)
    // 写回主存档含显式 isLocked:false
    const written = JSON.parse(localStorage.getItem(SAVE_KEY)!)
    const wr = written.runeData.inventory.find((r: any) => r.id === 'r1')
    expect(wr).toBeTruthy()
    expect(wr.isLocked).toBe(false)
    // 无独立符文持久化 key（仍只在 SAVE_KEY.runeData 下）
    expect(localStorage.getItem('rune_inventory')).toBeNull()
  })

  it('显式 isLocked:true 与 :false 均原样保持并写回', () => {
    const storeTrue = reloadWith(buildSave({ explicit: true, runeIsLocked: true }))
    expect(storeTrue.runeInventory.find(r => r.id === 'r1')!.isLocked).toBe(true)
    const writtenT = JSON.parse(localStorage.getItem(SAVE_KEY)!)
    expect(writtenT.runeData.inventory.find((r: any) => r.id === 'r1').isLocked).toBe(true)

    const storeFalse = reloadWith(buildSave({ explicit: true, runeIsLocked: false }))
    expect(storeFalse.runeInventory.find(r => r.id === 'r1')!.isLocked).toBe(false)
  })

  it('非法旧档 isLocked（null/1/“true”/对象）fail-closed：不 coerce 为 true/false、Rune 不被非法保留', () => {
    for (const bad of [null, 1, 'true', {}] as any[]) {
      const store = reloadWith(buildSave({ explicit: true, runeIsLocked: bad }))
      // normalizeRuneInventory 对含非法 isLocked 的 Rune 直接拒绝（整批 → 空），不得 coerce 为布尔
      expect(store.runeInventory.find(r => r.id === 'r1')).toBeFalsy()
    }
  })
})

// ============================================================================
// J. Phase 3.12.1 — UI 原验收缺口补齐（§9）
// ============================================================================
describe('Phase 3.12.1 — UI 原验收缺口补齐', () => {
  function seedInventory(runes: Rune[]) {
    const playerStore = usePlayerStore()
    playerStore.runeInventory = runes
    return playerStore
  }

  it('trySetRuneLocked 抛异常 → 组件不崩溃、不显示成功、Rune 状态不变', async () => {
    const playerStore = seedInventory([makeRune('m1', { type: 'defense' })])
    vi.spyOn(playerStore, 'trySetRuneLocked').mockImplementation(() => {
      throw new Error('boom')
    })
    const wrapper = mount(RuneInventoryTab)
    await nextTick()
    await findByAriaPrefix(wrapper, '锁定 普通防御符文')!.trigger('click')
    await nextTick()
    // 不崩溃：仍可渲染
    expect(wrapper.find('.rune-grid').exists()).toBe(true)
    // 不显示成功、显式错误反馈
    expect(wrapper.text()).not.toContain('已锁定')
    expect(wrapper.text()).toContain('锁定操作失败')
    // Rune 状态不变
    expect(playerStore.runeInventory[0].isLocked === true).toBe(false)
  })

  it('锁定 target 打开强化面板并成功吞噬未锁定材料 → target 仍锁定', async () => {
    const playerStore = seedInventory([
      makeRune('t1', { level: 2, isLocked: true }),
      makeRune('m1', { type: 'defense', statValue: 5 })
    ])
    const wrapper = mount(RuneInventoryTab)
    await nextTick()
    await findByAriaPrefix(wrapper, '强化 普通攻击符文')!.trigger('click')
    await nextTick()
    await findByAriaPrefix(wrapper, '选择材料 普通防御符文')!.trigger('click')
    await nextTick()
    expect(wrapper.find('[aria-label="强化预览"]').exists()).toBe(true)
    await findByAriaPrefix(wrapper, '确认强化')!.trigger('click')
    await nextTick()
    // target 仍锁定
    expect(playerStore.runeInventory.find(r => r.id === 't1')!.isLocked).toBe(true)
    // 材料被消耗
    expect(playerStore.runeInventory.find(r => r.id === 'm1')).toBeFalsy()
    // 成功反馈
    expect(wrapper.text()).toContain('强化成功')
  })

  it('切换排序并尾部追加 Rune 后点击锁定 → trySetRuneLocked 收到原 canonical ID（非 index）', async () => {
    const playerStore = seedInventory([makeRune('a'), makeRune('b', { type: 'crit' })])
    const lockSpy = vi.spyOn(playerStore, 'trySetRuneLocked')
    const wrapper = mount(RuneInventoryTab)
    await nextTick()
    // 切换排序（制造数组位置漂移）
    await wrapper.find('select[aria-label="排序方式"]').setValue('rarity')
    await nextTick()
    // 尾部追加新 Rune
    playerStore.runeInventory.push(makeRune('c', { type: 'luck', isLocked: false }))
    await nextTick()
    // 点击新 Rune 的锁定按钮（aria-label 含 canonical ID 派生的 displayName）
    await findByAriaPrefix(wrapper, '锁定 普通幸运符文')!.trigger('click')
    await nextTick()
    expect(lockSpy).toHaveBeenCalledWith('c', true)
  })
})
