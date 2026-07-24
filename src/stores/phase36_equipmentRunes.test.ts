import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
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
import { useRuneStore } from './runeStore'
import type { Rune, RuneType } from './runeStore'
import {
  EQUIPMENT_RUNE_SLOT_COUNT,
  RUNE_TYPE_TO_STAT,
  getRuneEffectiveValue,
  getRuneDisplayName,
  getRuneColorClass,
  createEmptyEquipmentRuneSlots,
  validateRune,
  validateRuneInventory,
  normalizeRuneInventory,
  validateEquipmentRuneSlots,
  normalizeEquipmentRuneSlots,
  scanRuneReferences,
  reconcileRuneReferences,
  planEmbedEquipmentRune,
  planRemoveEquipmentRune,
  getEquipmentRuneBonuses
} from '../utils/equipmentRunes'
import { generateEquipment } from '../utils/equipmentGenerator'
import { calculateTotalStats } from '../utils/calc'
import { RUNES } from '../data/runes'
import type { Equipment, EquipmentSlot, RuneSlot, PlayerStats } from '../types'

const SAVE_KEY = 'lollipop_adventure_save'

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

function readDisk() {
  const raw = localStorage.getItem(SAVE_KEY)
  return raw ? JSON.parse(raw) : null
}

function writeDisk(data: unknown) {
  localStorage.setItem(SAVE_KEY, JSON.stringify(data))
}

/** 让主存档 setItem 抛错、读取委托真实 storage 的失败注入器（与 Phase 3.2.3/3.4/3.5 一致）。 */
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

/** 构造合法动态 Rune（生产模型，无 slotIndex）。 */
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

/** 构造经济合法、三孔可配的装备。 */
function makeRuneEquip(
  id: string,
  slot: EquipmentSlot,
  opts?: {
    runeSlots?: RuneSlot[]
    isLocked?: boolean
    statsAttack?: number
    level?: number
  }
): Equipment {
  return {
    id,
    slot,
    name: id,
    rarity: 'common',
    level: opts?.level ?? 10,
    stats: [{ type: 'attack', value: opts?.statsAttack ?? 100, isPercent: false }],
    isLocked: opts?.isLocked ?? false,
    affixes: [],
    refiningSlots: [],
    refiningLevel: 0,
    runeSlots: opts?.runeSlots ?? createEmptyEquipmentRuneSlots()
  }
}

/** 三孔快捷构造：按位置塞 runeId。 */
function slotsWith(...runeIds: (string | null)[]): RuneSlot[] {
  const slots = createEmptyEquipmentRuneSlots()
  for (let i = 0; i < Math.min(3, runeIds.length); i++) {
    slots[i] = { index: i, runeId: runeIds[i] }
  }
  return slots
}

/** 可追踪固定序列 RNG。 */
function makeSeqRng(seq: number[]): { rng: () => number; calls: () => number } {
  let i = 0
  const rng = () => {
    const v = seq[i % seq.length]
    i++
    return v
  }
  return { rng, calls: () => i }
}

const RNG_SEQ = Array.from({ length: 64 }, (_, i) => ((i * 37 + 11) % 97) / 97)

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
// A. 纯模块：常量、公式与 helper
// ============================================================================
describe('Phase 3.6 — 纯模块常量与公式（唯一来源）', () => {
  it('EQUIPMENT_RUNE_SLOT_COUNT = 3，RUNE_TYPE_TO_STAT 六种映射完整', () => {
    expect(EQUIPMENT_RUNE_SLOT_COUNT).toBe(3)
    expect(RUNE_TYPE_TO_STAT).toEqual({
      attack: 'attack',
      defense: 'defense',
      health: 'maxHp',
      crit: 'critRate',
      speed: 'speed',
      luck: 'luck'
    })
  })

  it('getRuneEffectiveValue 保留公式 floor(statValue×(1+(level-1)×0.05))', () => {
    expect(getRuneEffectiveValue(10, 1)).toBe(10) // 1 级无加成
    expect(getRuneEffectiveValue(10, 5)).toBe(12) // floor(10*1.2)
    expect(getRuneEffectiveValue(40, 3)).toBe(44) // floor(40*1.1)
    expect(getRuneEffectiveValue(3, 2)).toBe(3) // floor(3*1.05)
  })

  it('getRuneEffectiveValue 非法输入 fail-closed（不产生 NaN/负数）', () => {
    expect(getRuneEffectiveValue(NaN, 1)).toBe(0)
    expect(getRuneEffectiveValue(Infinity, 1)).toBe(0)
    expect(getRuneEffectiveValue(-5, 1)).toBe(0)
    expect(getRuneEffectiveValue(10, NaN)).toBe(10) // level 非法 → 按 1 级 floor(statValue)
    expect(getRuneEffectiveValue(10, 0)).toBe(10)
  })

  it('createEmptyEquipmentRuneSlots 恰好返回三个空孔且 index === 位置', () => {
    const slots = createEmptyEquipmentRuneSlots()
    expect(slots).toEqual([
      { index: 0, runeId: null },
      { index: 1, runeId: null },
      { index: 2, runeId: null }
    ])
    // 每次返回新数组（不共享引用）
    expect(createEmptyEquipmentRuneSlots()).not.toBe(slots)
  })

  it('createEmptyEquipmentRuneSlots 不调用 RNG（纯确定性）', () => {
    const spy = vi.spyOn(Math, 'random')
    createEmptyEquipmentRuneSlots()
    createEmptyEquipmentRuneSlots()
    expect(spy).not.toHaveBeenCalled()
  })

  it('展示名与颜色由动态 Rune 类型派生（不依赖静态 RUNES）', () => {
    expect(getRuneDisplayName({ type: 'attack', rarity: 'legend' })).toBe('传说攻击符文')
    expect(getRuneDisplayName({ type: 'health', rarity: 'common' })).toBe('普通生命符文')
    expect(getRuneColorClass({ type: 'attack' })).toBe('red')
    expect(getRuneColorClass({ type: 'luck' })).toBe('purple')
  })
})

// ============================================================================
// B. Rune / inventory 校验
// ============================================================================
describe('Phase 3.6 — validateRune / validateRuneInventory / normalizeRuneInventory', () => {
  it('合法 Rune 通过并 trim id', () => {
    const v = validateRune({ ...makeRune('r1'), id: '  r1  ' })
    expect(v.ok).toBe(true)
    if (!v.ok) throw new Error('expected ok')
    expect(v.rune.id).toBe('r1')
  })

  it('非对象 / null / undefined → 拒绝且不抛异常', () => {
    for (const bad of [null, undefined, 42, 'rune', []]) {
      expect(() => validateRune(bad)).not.toThrow()
      expect(validateRune(bad).ok).toBe(false)
    }
  })

  it('id 非字符串 / 空串 / 纯空白 → 拒绝', () => {
    expect(validateRune({ ...makeRune('r1'), id: 5 }).ok).toBe(false)
    expect(validateRune({ ...makeRune('r1'), id: '' }).ok).toBe(false)
    expect(validateRune({ ...makeRune('r1'), id: '   ' }).ok).toBe(false)
  })

  it('type / rarity 非法 → 拒绝', () => {
    expect(validateRune({ ...makeRune('r1'), type: 'fire' }).ok).toBe(false)
    expect(validateRune({ ...makeRune('r1'), type: 42 }).ok).toBe(false)
    expect(validateRune({ ...makeRune('r1'), rarity: 'mythic' }).ok).toBe(false)
  })

  it('level 越界 / 非整数 / NaN → 拒绝（合法域 1..50）', () => {
    for (const bad of [0, 51, 1.5, NaN, Infinity, -1, '10']) {
      expect(validateRune({ ...makeRune('r1'), level: bad }).ok).toBe(false)
    }
    expect(validateRune(makeRune('r1', { level: 50 })).ok).toBe(true)
  })

  it('exp / statValue 负数、非整数、非有限 → 拒绝', () => {
    for (const bad of [-1, 1.5, NaN, Infinity, '0']) {
      expect(validateRune({ ...makeRune('r1'), exp: bad }).ok).toBe(false)
      expect(validateRune({ ...makeRune('r1'), statValue: bad }).ok).toBe(false)
    }
  })

  it('inventory 非数组 → 拒绝；normalize → []', () => {
    for (const bad of [null, undefined, {}, 'x', 42]) {
      expect(validateRuneInventory(bad).ok).toBe(false)
      expect(normalizeRuneInventory(bad)).toEqual([])
    }
  })

  it('inventory 含损坏 Rune 或重复 id → 拒绝；normalize → []（不注入非法 Rune）', () => {
    const dupe = [makeRune('r1'), makeRune('r1', { type: 'defense' })]
    expect(validateRuneInventory(dupe).ok).toBe(false)
    expect(normalizeRuneInventory(dupe)).toEqual([])
    const broken = [makeRune('r1'), { ...makeRune('r2'), level: NaN }]
    expect(validateRuneInventory(broken).ok).toBe(false)
    expect(normalizeRuneInventory(broken)).toEqual([])
  })

  it('合法 inventory 完整通过', () => {
    const inv = [makeRune('r1'), makeRune('r2', { type: 'health', statValue: 50 })]
    const v = validateRuneInventory(inv)
    expect(v.ok).toBe(true)
    expect(normalizeRuneInventory(inv)).toHaveLength(2)
  })
})

// ============================================================================
// C. 装备三孔校验与旧装备迁移
// ============================================================================
describe('Phase 3.6 — validateEquipmentRuneSlots / normalizeEquipmentRuneSlots', () => {
  it('合法三孔（含镶嵌）通过', () => {
    const eq = makeRuneEquip('w1', 'weapon', { runeSlots: slotsWith('r1', null, 'r2') })
    expect(validateEquipmentRuneSlots(eq).ok).toBe(true)
  })

  it('长度 0/1/2/4 → 拒绝（长度必须严格 = 3）', () => {
    for (const len of [0, 1, 2, 4]) {
      const slots: RuneSlot[] = Array.from({ length: len }, (_, i) => ({ index: i, runeId: null }))
      const eq = makeRuneEquip('w1', 'weapon', { runeSlots: slots })
      expect(validateEquipmentRuneSlots(eq).ok).toBe(false)
    }
  })

  it('index ≠ 数组位置 / index 非法 → 拒绝', () => {
    const wrongIndex = makeRuneEquip('w1', 'weapon', {
      runeSlots: [{ index: 1, runeId: null }, { index: 0, runeId: null }, { index: 2, runeId: null }]
    })
    expect(validateEquipmentRuneSlots(wrongIndex).ok).toBe(false)
    for (const bad of [NaN, Infinity, -1, 0.5, '0']) {
      const eq = makeRuneEquip('w1', 'weapon')
      ;(eq.runeSlots[0] as unknown as Record<string, unknown>).index = bad
      expect(validateEquipmentRuneSlots(eq).ok).toBe(false)
    }
  })

  it('runeId 空串 / 空白串 / 非字符串非 null / slot 为 null → 拒绝', () => {
    for (const bad of ['', '   ', 42, {}, undefined]) {
      const eq = makeRuneEquip('w1', 'weapon')
      ;(eq.runeSlots[1] as unknown as Record<string, unknown>).runeId = bad
      expect(validateEquipmentRuneSlots(eq).ok).toBe(false)
    }
    const eqNull = makeRuneEquip('w1', 'weapon')
    ;(eqNull.runeSlots as unknown as unknown[])[2] = null
    expect(validateEquipmentRuneSlots(eqNull).ok).toBe(false)
  })

  it('同一装备内重复 runeId → 拒绝', () => {
    const eq = makeRuneEquip('w1', 'weapon', { runeSlots: slotsWith('r1', 'r1', null) })
    expect(validateEquipmentRuneSlots(eq).ok).toBe(false)
  })

  it('经济损坏装备 → validate 拒绝、normalize 跳过不迁移', () => {
    const eq = makeRuneEquip('w1', 'weapon')
    ;(eq as unknown as Record<string, unknown>).stats = 'broken'
    expect(validateEquipmentRuneSlots(eq).ok).toBe(false)
    const before = eq.runeSlots
    expect(() => normalizeEquipmentRuneSlots(eq)).not.toThrow()
    expect(eq.runeSlots).toBe(before) // 未被触碰
  })

  it('迁移：缺失 runeSlots → 三个空孔', () => {
    const eq = makeRuneEquip('w1', 'weapon')
    delete (eq as unknown as Record<string, unknown>).runeSlots
    normalizeEquipmentRuneSlots(eq)
    expect(eq.runeSlots).toEqual(createEmptyEquipmentRuneSlots())
  })

  it('迁移：空数组 → 三个空孔', () => {
    const eq = makeRuneEquip('w1', 'weapon', { runeSlots: [] })
    normalizeEquipmentRuneSlots(eq)
    expect(eq.runeSlots).toEqual(createEmptyEquipmentRuneSlots())
  })

  it('迁移：合法三孔保持原引用不变', () => {
    const slots = slotsWith('r1', null, null)
    const eq = makeRuneEquip('w1', 'weapon', { runeSlots: slots })
    normalizeEquipmentRuneSlots(eq)
    expect(eq.runeSlots).toBe(slots)
    expect(eq.runeSlots[0].runeId).toBe('r1')
  })

  it('迁移：非空但损坏（长度 2 且带 runeId）→ 整体清空，不保留部分 runeId', () => {
    const eq = makeRuneEquip('w1', 'weapon', {
      runeSlots: [{ index: 0, runeId: 'r1' }, { index: 1, runeId: null }]
    })
    normalizeEquipmentRuneSlots(eq)
    expect(eq.runeSlots).toEqual(createEmptyEquipmentRuneSlots())
  })

  it('迁移：重复 runeId 损坏 → 整体清空（不按顺序保留第一个）', () => {
    const eq = makeRuneEquip('w1', 'weapon', { runeSlots: slotsWith('r1', 'r1', 'r2') })
    normalizeEquipmentRuneSlots(eq)
    expect(eq.runeSlots).toEqual(createEmptyEquipmentRuneSlots())
  })
})

// ============================================================================
// D. 装备生成：三空孔 + RNG 顺序不变
// ============================================================================
describe('Phase 3.6 — 装备生成与 RNG 顺序', () => {
  it('generateEquipment 新装备恰好三个空符文孔', () => {
    const { rng } = makeSeqRng(RNG_SEQ)
    const eq = generateEquipment('weapon', 'epic', 100, rng)
    expect(eq.runeSlots).toEqual(createEmptyEquipmentRuneSlots())
    expect(validateEquipmentRuneSlots(eq).ok).toBe(true)
  })

  it('同一 RNG 序列两次生成：除 id 外完全一致（runeSlots 初始化未消费 RNG）', () => {
    const a = makeSeqRng(RNG_SEQ)
    const b = makeSeqRng(RNG_SEQ)
    const eqA = generateEquipment('weapon', 'legend', 120, a.rng)
    const eqB = generateEquipment('weapon', 'legend', 120, b.rng)
    expect(a.calls()).toBe(b.calls()) // RNG 消费次数一致
    const { id: _idA, ...restA } = eqA
    const { id: _idB, ...restB } = eqB
    expect(restA).toEqual(restB) // stats/name/rarity/level/affixes/runeSlots 全一致
  })

  it('多稀有度/槽位生成均得三空孔且 RNG 调用次数与 runeSlots 无关', () => {
    const a = makeSeqRng(RNG_SEQ)
    const eq1 = generateEquipment('chest', 'common', 60, a.rng)
    const callsAfterFirst = a.calls()
    expect(eq1.runeSlots).toEqual(createEmptyEquipmentRuneSlots())
    const eq2 = generateEquipment('boots', 'good', 60, a.rng)
    expect(eq2.runeSlots).toEqual(createEmptyEquipmentRuneSlots())
    expect(a.calls()).toBeGreaterThan(callsAfterFirst)
  })
})

// ============================================================================
// E. 全局拓扑扫描与对账
// ============================================================================
describe('Phase 3.6 — scanRuneReferences / reconcileRuneReferences', () => {
  it('scan：正确构建 runeId → 位置[] 拓扑，不修改输入', () => {
    const weapon = makeRuneEquip('w1', 'weapon', { runeSlots: slotsWith('r1', null, 'r2') })
    const chest = makeRuneEquip('c1', 'chest', { runeSlots: slotsWith(null, 'r1', null) })
    const bySlot = { weapon, chest }
    const map = scanRuneReferences(bySlot)
    expect(map.get('r1')).toEqual(
      expect.arrayContaining([
        { slot: 'weapon', index: 0 },
        { slot: 'chest', index: 1 }
      ])
    )
    expect(map.get('r1')).toHaveLength(2)
    expect(map.get('r2')).toEqual([{ slot: 'weapon', index: 2 }])
    expect(weapon.runeSlots[0].runeId).toBe('r1') // 未修改
  })

  it('reconcile：悬空引用清空、合法引用保持、inventory 不被修改', () => {
    const weapon = makeRuneEquip('w1', 'weapon', { runeSlots: slotsWith('r1', 'ghost', null) })
    const inventory = [makeRune('r1')]
    reconcileRuneReferences({ weapon }, inventory)
    expect(weapon.runeSlots[0].runeId).toBe('r1')
    expect(weapon.runeSlots[1].runeId).toBeNull()
    expect(inventory).toEqual([makeRune('r1')])
  })

  it('reconcile：跨装备重复引用 → 全部清空（不按遍历顺序选第一个），顺序无关', () => {
    // 方向一：weapon 在前
    const weaponA = makeRuneEquip('w1', 'weapon', { runeSlots: slotsWith('r1', null, null) })
    const chestA = makeRuneEquip('c1', 'chest', { runeSlots: slotsWith(null, null, 'r1') })
    reconcileRuneReferences({ weapon: weaponA, chest: chestA }, [makeRune('r1')])
    expect(weaponA.runeSlots[0].runeId).toBeNull()
    expect(chestA.runeSlots[2].runeId).toBeNull()
    // 方向二：chest 在前（对象键序不同）
    const weaponB = makeRuneEquip('w1', 'weapon', { runeSlots: slotsWith('r1', null, null) })
    const chestB = makeRuneEquip('c1', 'chest', { runeSlots: slotsWith(null, null, 'r1') })
    reconcileRuneReferences({ chest: chestB, weapon: weaponB }, [makeRune('r1')])
    expect(weaponB.runeSlots[0].runeId).toBeNull()
    expect(chestB.runeSlots[2].runeId).toBeNull()
  })

  it('reconcile：缺失 runeSlots / 空装备表不抛异常', () => {
    const broken = makeRuneEquip('w1', 'weapon')
    delete (broken as unknown as Record<string, unknown>).runeSlots
    expect(() => reconcileRuneReferences({ weapon: broken }, [])).not.toThrow()
    expect(() => reconcileRuneReferences({}, [])).not.toThrow()
  })
})

// ============================================================================
// F. 纯规划：planEmbedEquipmentRune / planRemoveEquipmentRune
// ============================================================================
describe('Phase 3.6 — 纯镶嵌/移除规划', () => {
  it('未镶嵌 Rune → 单条 slotUpdate 放入目标位置', () => {
    const weapon = makeRuneEquip('w1', 'weapon')
    const plan = planEmbedEquipmentRune({
      targetEquipment: weapon,
      slotIndex: 1,
      runeId: 'r1',
      inventory: [makeRune('r1')],
      equipmentBySlot: { weapon }
    })
    expect(plan.ok).toBe(true)
    if (!plan.ok) throw new Error('expected ok')
    expect(plan.slotUpdates).toEqual([{ equipmentSlot: 'weapon', slotIndex: 1, newRuneId: 'r1' }])
  })

  it('已镶嵌于其他装备 → 原位置清空 + 目标写入（原子移动，两条 update）', () => {
    const weapon = makeRuneEquip('w1', 'weapon', { runeSlots: slotsWith('r1', null, null) })
    const chest = makeRuneEquip('c1', 'chest')
    const plan = planEmbedEquipmentRune({
      targetEquipment: chest,
      slotIndex: 2,
      runeId: 'r1',
      inventory: [makeRune('r1')],
      equipmentBySlot: { weapon, chest }
    })
    expect(plan.ok).toBe(true)
    if (!plan.ok) throw new Error('expected ok')
    expect(plan.slotUpdates).toEqual(
      expect.arrayContaining([
        { equipmentSlot: 'chest', slotIndex: 2, newRuneId: 'r1' },
        { equipmentSlot: 'weapon', slotIndex: 0, newRuneId: null }
      ])
    )
    expect(plan.slotUpdates).toHaveLength(2)
  })

  it('同装备内移动位置 → 原位置清空 + 新位置写入', () => {
    const weapon = makeRuneEquip('w1', 'weapon', { runeSlots: slotsWith('r1', null, null) })
    const plan = planEmbedEquipmentRune({
      targetEquipment: weapon,
      slotIndex: 2,
      runeId: 'r1',
      inventory: [makeRune('r1')],
      equipmentBySlot: { weapon }
    })
    expect(plan.ok).toBe(true)
    if (!plan.ok) throw new Error('expected ok')
    expect(plan.slotUpdates).toEqual(
      expect.arrayContaining([
        { equipmentSlot: 'weapon', slotIndex: 2, newRuneId: 'r1' },
        { equipmentSlot: 'weapon', slotIndex: 0, newRuneId: null }
      ])
    )
  })

  it('目标位置已有另一 Rune → 覆盖写入（被替换 Rune 自动未镶嵌，无额外 update）', () => {
    const weapon = makeRuneEquip('w1', 'weapon', { runeSlots: slotsWith('r2', null, null) })
    const plan = planEmbedEquipmentRune({
      targetEquipment: weapon,
      slotIndex: 0,
      runeId: 'r1',
      inventory: [makeRune('r1'), makeRune('r2')],
      equipmentBySlot: { weapon }
    })
    expect(plan.ok).toBe(true)
    if (!plan.ok) throw new Error('expected ok')
    expect(plan.slotUpdates).toEqual([{ equipmentSlot: 'weapon', slotIndex: 0, newRuneId: 'r1' }])
  })

  it('Rune 已在目标同一位置 → no-op 失败', () => {
    const weapon = makeRuneEquip('w1', 'weapon', { runeSlots: slotsWith('r1', null, null) })
    const plan = planEmbedEquipmentRune({
      targetEquipment: weapon,
      slotIndex: 0,
      runeId: 'r1',
      inventory: [makeRune('r1')],
      equipmentBySlot: { weapon }
    })
    expect(plan.ok).toBe(false)
    if (plan.ok) throw new Error('expected fail')
    expect(plan.reason).toBe('rune already embedded at target slot')
  })

  it('runeId 不在 inventory（含静态 RUNES id）→ 失败', () => {
    const weapon = makeRuneEquip('w1', 'weapon')
    for (const badId of ['nope', RUNES[0].id]) {
      const plan = planEmbedEquipmentRune({
        targetEquipment: weapon,
        slotIndex: 0,
        runeId: badId,
        inventory: [makeRune('r1')],
        equipmentBySlot: { weapon }
      })
      expect(plan.ok).toBe(false)
      if (plan.ok) throw new Error('expected fail')
      expect(plan.reason).toBe('rune not found in inventory')
    }
  })

  it('slotIndex 非法（-1/3/1.5/NaN/Infinity）→ 失败', () => {
    const weapon = makeRuneEquip('w1', 'weapon')
    for (const bad of [-1, 3, 1.5, NaN, Infinity]) {
      const plan = planEmbedEquipmentRune({
        targetEquipment: weapon,
        slotIndex: bad,
        runeId: 'r1',
        inventory: [makeRune('r1')],
        equipmentBySlot: { weapon }
      })
      expect(plan.ok).toBe(false)
    }
  })

  it('损坏 inventory / 损坏三孔 / 经济损坏装备 → 失败且不抛异常', () => {
    const weapon = makeRuneEquip('w1', 'weapon')
    const dupInv = [makeRune('r1'), makeRune('r1')]
    expect(
      planEmbedEquipmentRune({ targetEquipment: weapon, slotIndex: 0, runeId: 'r1', inventory: dupInv, equipmentBySlot: { weapon } }).ok
    ).toBe(false)
    const badSlots = makeRuneEquip('w2', 'weapon', { runeSlots: [] })
    expect(
      planEmbedEquipmentRune({ targetEquipment: badSlots, slotIndex: 0, runeId: 'r1', inventory: [makeRune('r1')], equipmentBySlot: { weapon: badSlots } }).ok
    ).toBe(false)
    const badEcon = makeRuneEquip('w3', 'weapon')
    ;(badEcon as unknown as Record<string, unknown>).stats = null
    expect(() =>
      planEmbedEquipmentRune({ targetEquipment: badEcon, slotIndex: 0, runeId: 'r1', inventory: [makeRune('r1')], equipmentBySlot: { weapon: badEcon } })
    ).not.toThrow()
  })

  it('全局拓扑悬空 / 重复引用 → fail-closed', () => {
    const weapon = makeRuneEquip('w1', 'weapon', { runeSlots: slotsWith('ghost', null, null) })
    const target = makeRuneEquip('c1', 'chest')
    const dangling = planEmbedEquipmentRune({
      targetEquipment: target,
      slotIndex: 0,
      runeId: 'r1',
      inventory: [makeRune('r1')],
      equipmentBySlot: { weapon, chest: target }
    })
    expect(dangling.ok).toBe(false)
    if (dangling.ok) throw new Error('expected fail')
    expect(dangling.reason).toBe('dangling rune reference in topology')

    const w2 = makeRuneEquip('w1', 'weapon', { runeSlots: slotsWith('r1', null, null) })
    const c2 = makeRuneEquip('c1', 'chest', { runeSlots: slotsWith('r1', null, null) })
    const dup = planEmbedEquipmentRune({
      targetEquipment: c2,
      slotIndex: 1,
      runeId: 'r2',
      inventory: [makeRune('r1'), makeRune('r2')],
      equipmentBySlot: { weapon: w2, chest: c2 }
    })
    expect(dup.ok).toBe(false)
    if (dup.ok) throw new Error('expected fail')
    expect(dup.reason).toBe('duplicate rune reference in topology')
  })

  it('planEmbed 纯规划不修改任何输入', () => {
    const weapon = makeRuneEquip('w1', 'weapon', { runeSlots: slotsWith('r1', null, null) })
    const chest = makeRuneEquip('c1', 'chest')
    const inventory = [makeRune('r1')]
    const weaponSlotsRef = weapon.runeSlots
    const chestSlotsRef = chest.runeSlots
    planEmbedEquipmentRune({ targetEquipment: chest, slotIndex: 0, runeId: 'r1', inventory, equipmentBySlot: { weapon, chest } })
    expect(weapon.runeSlots).toBe(weaponSlotsRef)
    expect(weapon.runeSlots[0].runeId).toBe('r1')
    expect(chest.runeSlots).toBe(chestSlotsRef)
    expect(chest.runeSlots.every(s => s.runeId === null)).toBe(true)
    expect(inventory).toEqual([makeRune('r1')])
  })

  it('planRemove：合法移除 → 单条清空 update；空槽 → no-op 失败；不修改输入', () => {
    const weapon = makeRuneEquip('w1', 'weapon', { runeSlots: slotsWith('r1', null, null) })
    const inventory = [makeRune('r1')]
    const ok = planRemoveEquipmentRune({ targetEquipment: weapon, slotIndex: 0, inventory, equipmentBySlot: { weapon } })
    expect(ok.ok).toBe(true)
    if (!ok.ok) throw new Error('expected ok')
    expect(ok.slotUpdates).toEqual([{ equipmentSlot: 'weapon', slotIndex: 0, newRuneId: null }])
    expect(weapon.runeSlots[0].runeId).toBe('r1') // 未修改输入

    const empty = planRemoveEquipmentRune({ targetEquipment: weapon, slotIndex: 1, inventory, equipmentBySlot: { weapon } })
    expect(empty.ok).toBe(false)
    if (empty.ok) throw new Error('expected fail')
    expect(empty.reason).toBe('slot is empty')
  })

  it('planRemove：slotIndex 非法 / 悬空拓扑 / 损坏 inventory → fail-closed', () => {
    const weapon = makeRuneEquip('w1', 'weapon', { runeSlots: slotsWith('r1', null, null) })
    for (const bad of [-1, 3, 0.5, NaN]) {
      expect(planRemoveEquipmentRune({ targetEquipment: weapon, slotIndex: bad, inventory: [makeRune('r1')], equipmentBySlot: { weapon } }).ok).toBe(false)
    }
    const ghostEq = makeRuneEquip('w1', 'weapon', { runeSlots: slotsWith('ghost', null, null) })
    const ghost = planRemoveEquipmentRune({ targetEquipment: ghostEq, slotIndex: 0, inventory: [], equipmentBySlot: { weapon: ghostEq } })
    expect(ghost.ok).toBe(false)
    expect(planRemoveEquipmentRune({ targetEquipment: weapon, slotIndex: 0, inventory: [makeRune('r1'), makeRune('r1')], equipmentBySlot: { weapon } }).ok).toBe(false)
  })
})

// ============================================================================
// G. Store 原子事务：tryEmbedEquipmentRune / tryRemoveEquipmentRune
// ============================================================================
describe('Phase 3.6 — Store 原子事务', () => {
  it('镶嵌成功：装备槽位更新、inventory 不变、磁盘一致（runeData + 装备拓扑）', () => {
    const store = usePlayerStore()
    store.player.equipment.weapon = makeRuneEquip('w1', 'weapon')
    store.runeInventory.push(makeRune('r1'))
    const res = store.tryEmbedEquipmentRune('weapon', 0, 'r1')
    expect(res.ok).toBe(true)
    expect(store.player.equipment.weapon!.runeSlots[0].runeId).toBe('r1')
    expect(store.runeInventory).toHaveLength(1) // Rune 对象不变，仍在 inventory
    const disk = readDisk()
    expect(disk.player.equipment.weapon.runeSlots[0].runeId).toBe('r1')
    expect(disk.runeData.inventory).toHaveLength(1)
    expect(disk.runeData.inventory[0].id).toBe('r1')
  })

  it('跨装备原子移动：一次事务同时更新两件装备并一次写盘', () => {
    const store = usePlayerStore()
    store.player.equipment.weapon = makeRuneEquip('w1', 'weapon', { runeSlots: slotsWith('r1', null, null) })
    store.player.equipment.chest = makeRuneEquip('c1', 'chest')
    store.runeInventory.push(makeRune('r1'))
    const res = store.tryEmbedEquipmentRune('chest', 2, 'r1')
    expect(res.ok).toBe(true)
    expect(store.player.equipment.weapon!.runeSlots[0].runeId).toBeNull()
    expect(store.player.equipment.chest!.runeSlots[2].runeId).toBe('r1')
    const disk = readDisk()
    expect(disk.player.equipment.weapon.runeSlots[0].runeId).toBeNull()
    expect(disk.player.equipment.chest.runeSlots[2].runeId).toBe('r1')
  })

  it('目标已有 Rune → 覆盖后被替换 Rune 未镶嵌（拓扑无引用）但仍在 inventory', () => {
    const store = usePlayerStore()
    store.player.equipment.weapon = makeRuneEquip('w1', 'weapon', { runeSlots: slotsWith('r2', null, null) })
    store.runeInventory.push(makeRune('r1'), makeRune('r2'))
    const res = store.tryEmbedEquipmentRune('weapon', 0, 'r1')
    expect(res.ok).toBe(true)
    expect(store.player.equipment.weapon!.runeSlots[0].runeId).toBe('r1')
    const refs = scanRuneReferences(store.player.equipment)
    expect(refs.has('r2')).toBe(false) // r2 未镶嵌
    expect(store.runeInventory.map(r => r.id)).toEqual(['r1', 'r2'])
  })

  it('no-op（同位置重复镶嵌）→ 拒绝且零修改（磁盘字节不变）', () => {
    const store = usePlayerStore()
    store.player.equipment.weapon = makeRuneEquip('w1', 'weapon', { runeSlots: slotsWith('r1', null, null) })
    store.runeInventory.push(makeRune('r1'))
    store.saveGame()
    const before = localStorage.getItem(SAVE_KEY)
    const res = store.tryEmbedEquipmentRune('weapon', 0, 'r1')
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('rune already embedded at target slot')
    expect(localStorage.getItem(SAVE_KEY)).toBe(before)
    expect(store.player.equipment.weapon!.runeSlots[0].runeId).toBe('r1')
  })

  it('锁定装备允许镶嵌与移除（与 affix/refining 语义一致）', () => {
    const store = usePlayerStore()
    store.player.equipment.weapon = makeRuneEquip('w1', 'weapon', { isLocked: true })
    store.runeInventory.push(makeRune('r1'))
    expect(store.tryEmbedEquipmentRune('weapon', 1, 'r1').ok).toBe(true)
    expect(store.player.equipment.weapon!.runeSlots[1].runeId).toBe('r1')
    expect(store.tryRemoveEquipmentRune('weapon', 1).ok).toBe(true)
    expect(store.player.equipment.weapon!.runeSlots[1].runeId).toBeNull()
  })

  it('槽位无装备 / runeId 不存在 / slotIndex 非法 → 拒绝且零修改', () => {
    const store = usePlayerStore()
    expect(store.tryEmbedEquipmentRune('weapon', 0, 'r1').ok).toBe(false)
    expect(store.tryRemoveEquipmentRune('weapon', 0).ok).toBe(false)
    store.player.equipment.weapon = makeRuneEquip('w1', 'weapon')
    store.runeInventory.push(makeRune('r1'))
    store.saveGame()
    const before = localStorage.getItem(SAVE_KEY)
    expect(store.tryEmbedEquipmentRune('weapon', 0, 'nope').ok).toBe(false)
    expect(store.tryEmbedEquipmentRune('weapon', 5, 'r1').ok).toBe(false)
    expect(store.tryEmbedEquipmentRune('weapon', -1, 'r1').ok).toBe(false)
    expect(localStorage.getItem(SAVE_KEY)).toBe(before)
  })

  it('移除成功：槽位清空、Rune 保留在 inventory、磁盘一致', () => {
    const store = usePlayerStore()
    store.player.equipment.weapon = makeRuneEquip('w1', 'weapon', { runeSlots: slotsWith(null, 'r1', null) })
    store.runeInventory.push(makeRune('r1'))
    const res = store.tryRemoveEquipmentRune('weapon', 1)
    expect(res.ok).toBe(true)
    expect(store.player.equipment.weapon!.runeSlots[1].runeId).toBeNull()
    expect(store.runeInventory.map(r => r.id)).toEqual(['r1'])
    const disk = readDisk()
    expect(disk.player.equipment.weapon.runeSlots[1].runeId).toBeNull()
    expect(disk.runeData.inventory[0].id).toBe('r1')
  })

  it('空槽移除 → no-op 失败零修改', () => {
    const store = usePlayerStore()
    store.player.equipment.weapon = makeRuneEquip('w1', 'weapon')
    store.saveGame()
    const before = localStorage.getItem(SAVE_KEY)
    const res = store.tryRemoveEquipmentRune('weapon', 0)
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('slot is empty')
    expect(localStorage.getItem(SAVE_KEY)).toBe(before)
  })
})

// ============================================================================
// H. 保存失败完整回滚
// ============================================================================
describe('Phase 3.6 — 保存失败完整回滚与恢复重试', () => {
  it('镶嵌保存失败：目标装备回滚、磁盘不变，恢复后重试只提交一次', () => {
    const store = usePlayerStore()
    store.player.equipment.weapon = makeRuneEquip('w1', 'weapon')
    store.runeInventory.push(makeRune('r1'))
    store.saveGame() // 基准盘
    const baseline = localStorage.getItem(SAVE_KEY)

    installThrowingStorage()
    const res = store.tryEmbedEquipmentRune('weapon', 0, 'r1')
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('save failed')
    expect(store.player.equipment.weapon!.runeSlots[0].runeId).toBeNull() // 完整回滚
    vi.unstubAllGlobals()
    expect(localStorage.getItem(SAVE_KEY)).toBe(baseline) // 磁盘未被污染

    const retry = store.tryEmbedEquipmentRune('weapon', 0, 'r1')
    expect(retry.ok).toBe(true)
    expect(store.player.equipment.weapon!.runeSlots[0].runeId).toBe('r1')
    expect(readDisk().player.equipment.weapon.runeSlots[0].runeId).toBe('r1')
  })

  it('跨装备移动保存失败：两件装备的 runeSlots 全部回滚', () => {
    const store = usePlayerStore()
    store.player.equipment.weapon = makeRuneEquip('w1', 'weapon', { runeSlots: slotsWith('r1', null, null) })
    store.player.equipment.chest = makeRuneEquip('c1', 'chest')
    store.runeInventory.push(makeRune('r1'))
    store.saveGame()
    const baseline = localStorage.getItem(SAVE_KEY)

    installThrowingStorage()
    const res = store.tryEmbedEquipmentRune('chest', 1, 'r1')
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('save failed')
    expect(store.player.equipment.weapon!.runeSlots[0].runeId).toBe('r1') // 原位置未丢
    expect(store.player.equipment.chest!.runeSlots.every(s => s.runeId === null)).toBe(true)
    vi.unstubAllGlobals()
    expect(localStorage.getItem(SAVE_KEY)).toBe(baseline)
  })

  it('移除保存失败：槽位回滚、磁盘不变', () => {
    const store = usePlayerStore()
    store.player.equipment.weapon = makeRuneEquip('w1', 'weapon', { runeSlots: slotsWith('r1', null, null) })
    store.runeInventory.push(makeRune('r1'))
    store.saveGame()
    const baseline = localStorage.getItem(SAVE_KEY)

    installThrowingStorage()
    const res = store.tryRemoveEquipmentRune('weapon', 0)
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('save failed')
    expect(store.player.equipment.weapon!.runeSlots[0].runeId).toBe('r1')
    vi.unstubAllGlobals()
    expect(localStorage.getItem(SAVE_KEY)).toBe(baseline)
  })
})

// ============================================================================
// I. 符文属性真实生效（totalStats / calc）
// ============================================================================
describe('Phase 3.6 — 符文属性真实进入总属性', () => {
  const CASES: { type: RuneType; stat: keyof PlayerStats }[] = [
    { type: 'attack', stat: 'attack' },
    { type: 'defense', stat: 'defense' },
    { type: 'health', stat: 'maxHp' },
    { type: 'crit', stat: 'critRate' },
    { type: 'speed', stat: 'speed' },
    { type: 'luck', stat: 'luck' }
  ]

  for (const { type, stat } of CASES) {
    it(`${type} 符文 → ${String(stat)} 增加 floor(statValue×(1+(level-1)×0.05))`, () => {
      const store = usePlayerStore()
      store.player.equipment.weapon = makeRuneEquip('w1', 'weapon')
      store.runeInventory.push(makeRune('r1', { type, statValue: 40, level: 3 })) // → 44
      const before = store.totalStats[stat] as number
      const res = store.tryEmbedEquipmentRune('weapon', 0, 'r1')
      expect(res.ok).toBe(true)
      const after = store.totalStats[stat] as number
      expect(after - before).toBeCloseTo(44, 9)
    })
  }

  it('多枚符文同装备三孔 → 各自属性相加', () => {
    const store = usePlayerStore()
    store.player.equipment.weapon = makeRuneEquip('w1', 'weapon')
    store.runeInventory.push(
      makeRune('r1', { type: 'attack', statValue: 10, level: 1 }),
      makeRune('r2', { type: 'defense', statValue: 8, level: 1 }),
      makeRune('r3', { type: 'health', statValue: 50, level: 1 })
    )
    const beforeAtk = store.totalStats.attack
    const beforeDef = store.totalStats.defense
    const beforeHp = store.totalStats.maxHp
    expect(store.tryEmbedEquipmentRune('weapon', 0, 'r1').ok).toBe(true)
    expect(store.tryEmbedEquipmentRune('weapon', 1, 'r2').ok).toBe(true)
    expect(store.tryEmbedEquipmentRune('weapon', 2, 'r3').ok).toBe(true)
    expect(store.totalStats.attack - beforeAtk).toBeCloseTo(10, 9)
    expect(store.totalStats.defense - beforeDef).toBeCloseTo(8, 9)
    expect(store.totalStats.maxHp - beforeHp).toBeCloseTo(50, 9)
  })

  it('移除符文后总属性立即恢复', () => {
    const store = usePlayerStore()
    store.player.equipment.weapon = makeRuneEquip('w1', 'weapon')
    store.runeInventory.push(makeRune('r1', { type: 'attack', statValue: 25, level: 1 }))
    const baseline = store.totalStats.attack
    expect(store.tryEmbedEquipmentRune('weapon', 0, 'r1').ok).toBe(true)
    expect(store.totalStats.attack - baseline).toBeCloseTo(25, 9)
    expect(store.tryRemoveEquipmentRune('weapon', 0).ok).toBe(true)
    expect(store.totalStats.attack).toBeCloseTo(baseline, 9)
  })

  it('刷新 loadGame 后符文属性仍生效（inventory + 拓扑 + 属性完整保留）', () => {
    const store = usePlayerStore()
    store.player.equipment.weapon = makeRuneEquip('w1', 'weapon')
    store.runeInventory.push(makeRune('r1', { type: 'attack', statValue: 30, level: 1 }))
    expect(store.tryEmbedEquipmentRune('weapon', 0, 'r1').ok).toBe(true)

    setActivePinia(createPinia())
    warmupStores()
    const store2 = usePlayerStore()
    store2.loadGame()
    expect(store2.runeInventory.map(r => r.id)).toEqual(['r1'])
    expect(store2.player.equipment.weapon!.runeSlots[0].runeId).toBe('r1')
    const withRune = store2.totalStats.attack
    store2.player.equipment.weapon!.runeSlots[0] = { index: 0, runeId: null } // 移除对比
    const without = store2.totalStats.attack
    expect(withRune - without).toBeCloseTo(30, 9)
  })

  it('calculateTotalStats 不传 runeInventory → 跳过符文加成（向后兼容 combatInsights）', () => {
    const store = usePlayerStore()
    store.player.equipment.weapon = makeRuneEquip('w1', 'weapon', { runeSlots: slotsWith('r1', null, null) })
    const inv = [makeRune('r1', { type: 'attack', statValue: 20, level: 1 })]
    const withInv = calculateTotalStats(store.player, undefined, inv)
    const withoutInv = calculateTotalStats(store.player)
    expect(withInv.attack - withoutInv.attack).toBeCloseTo(20, 9)
  })

  it('getEquipmentRuneBonuses：悬空引用 / 同装备重复引用 / 损坏 inventory → []（不注入部分属性）', () => {
    const ghostEq = makeRuneEquip('w1', 'weapon', { runeSlots: slotsWith('r1', 'ghost', null) })
    expect(getEquipmentRuneBonuses(ghostEq, [makeRune('r1')])).toEqual([])
    const dupEq = makeRuneEquip('w2', 'weapon', { runeSlots: slotsWith('r1', 'r1', null) })
    expect(getEquipmentRuneBonuses(dupEq, [makeRune('r1')])).toEqual([])
    const okEq = makeRuneEquip('w3', 'weapon', { runeSlots: slotsWith('r1', null, null) })
    expect(getEquipmentRuneBonuses(okEq, [makeRune('r1'), makeRune('r1')])).toEqual([]) // inventory 重复
    expect(getEquipmentRuneBonuses(okEq, 'broken')).toEqual([])
    // 合法基线
    expect(getEquipmentRuneBonuses(okEq, [makeRune('r1', { statValue: 10, level: 1 })])).toEqual([
      { type: 'attack', value: 10, isPercent: false }
    ])
  })

  it('损坏三孔装备不产生任何符文属性（totalStats 无污染、无 NaN）', () => {
    const store = usePlayerStore()
    const eq = makeRuneEquip('w1', 'weapon')
    ;(eq.runeSlots[0] as unknown as Record<string, unknown>).runeId = 42
    store.player.equipment.weapon = eq
    store.runeInventory.push(makeRune('r1'))
    const stats = store.totalStats
    expect(Number.isFinite(stats.attack)).toBe(true)
    expect(Number.isFinite(stats.maxHp)).toBe(true)
  })
})

// ============================================================================
// J. loadGame 集成：水合 / 三孔迁移 / 拓扑对账 / 落盘
// ============================================================================
describe('Phase 3.6 — loadGame 水合、迁移与对账', () => {
  /** 建立基准存档后按 mutator 篡改磁盘，再用全新 pinia loadGame。 */
  function corruptAndReload(mutate: (disk: Record<string, unknown>) => void) {
    const store = usePlayerStore()
    store.player.equipment.weapon = makeRuneEquip('w1', 'weapon')
    store.saveGame()
    const disk = readDisk()
    mutate(disk)
    writeDisk(disk)
    setActivePinia(createPinia())
    warmupStores()
    const fresh = usePlayerStore()
    fresh.loadGame()
    return fresh
  }

  it('旧存档缺失 runeData → inventory 水合为 []，不抛异常', () => {
    const fresh = corruptAndReload(disk => {
      delete (disk as Record<string, unknown>).runeData
    })
    expect(fresh.runeInventory).toEqual([])
  })

  it('损坏 runeData.inventory（重复 id / 非法 Rune / 非数组）→ []，不注入非法 Rune、不抛异常', () => {
    const dup = corruptAndReload(disk => {
      ;(disk as Record<string, any>).runeData = { inventory: [makeRune('r1'), makeRune('r1')] }
    })
    expect(dup.runeInventory).toEqual([])

    const bad = corruptAndReload(disk => {
      ;(disk as Record<string, any>).runeData = { inventory: [{ id: 'r1', type: 'fire', rarity: 'common', level: 1, exp: 0, statValue: 10 }] }
    })
    expect(bad.runeInventory).toEqual([])

    const notArray = corruptAndReload(disk => {
      ;(disk as Record<string, any>).runeData = { inventory: 'broken' }
    })
    expect(notArray.runeInventory).toEqual([])
  })

  it('合法 inventory 完整水合并保留', () => {
    const store = usePlayerStore()
    store.runeInventory.push(makeRune('r1'), makeRune('r2', { type: 'luck' }))
    store.saveGame()
    setActivePinia(createPinia())
    warmupStores()
    const fresh = usePlayerStore()
    fresh.loadGame()
    expect(fresh.runeInventory.map(r => r.id)).toEqual(['r1', 'r2'])
  })

  it('旧装备 runeSlots = [] → loadGame 迁移为三个空孔并落盘', () => {
    const fresh = corruptAndReload(disk => {
      ;(disk as Record<string, any>).player.equipment.weapon.runeSlots = []
    })
    expect(fresh.player.equipment.weapon!.runeSlots).toEqual(createEmptyEquipmentRuneSlots())
    // loadGame 末尾 saveGame(now) 已把迁移结果落盘
    expect(readDisk().player.equipment.weapon.runeSlots).toEqual(createEmptyEquipmentRuneSlots())
  })

  it('旧装备缺失 runeSlots → loadGame 迁移为三个空孔并落盘', () => {
    const fresh = corruptAndReload(disk => {
      delete (disk as Record<string, any>).player.equipment.weapon.runeSlots
    })
    expect(fresh.player.equipment.weapon!.runeSlots).toEqual(createEmptyEquipmentRuneSlots())
    expect(readDisk().player.equipment.weapon.runeSlots).toEqual(createEmptyEquipmentRuneSlots())
  })

  it('非空损坏三孔（长度 2 带 runeId）→ 整体清空为三空孔并落盘', () => {
    const fresh = corruptAndReload(disk => {
      ;(disk as Record<string, any>).player.equipment.weapon.runeSlots = [
        { index: 0, runeId: 'r1' },
        { index: 1, runeId: null }
      ]
      ;(disk as Record<string, any>).runeData = { inventory: [makeRune('r1')] }
    })
    expect(fresh.player.equipment.weapon!.runeSlots).toEqual(createEmptyEquipmentRuneSlots())
    expect(readDisk().player.equipment.weapon.runeSlots).toEqual(createEmptyEquipmentRuneSlots())
  })

  it('悬空引用（runeId 不在 inventory，含静态 RUNES id）→ 对账清空并落盘', () => {
    const fresh = corruptAndReload(disk => {
      ;(disk as Record<string, any>).player.equipment.weapon.runeSlots = slotsWith('r1', RUNES[0].id, null)
      ;(disk as Record<string, any>).runeData = { inventory: [makeRune('r1')] }
    })
    expect(fresh.player.equipment.weapon!.runeSlots[0].runeId).toBe('r1') // 合法保留
    expect(fresh.player.equipment.weapon!.runeSlots[1].runeId).toBeNull() // 静态 id 悬空清空
    expect(readDisk().player.equipment.weapon.runeSlots[1].runeId).toBeNull()
  })

  it('跨装备重复引用 → 全部清空并落盘（与遍历顺序无关）', () => {
    const store = usePlayerStore()
    store.player.equipment.weapon = makeRuneEquip('w1', 'weapon', { runeSlots: slotsWith('r1', null, null) })
    store.player.equipment.chest = makeRuneEquip('c1', 'chest', { runeSlots: slotsWith(null, 'r1', null) })
    store.runeInventory.push(makeRune('r1'))
    // 绕过事务直接落一个重复引用的盘（模拟损坏存档）
    store.saveGame()
    setActivePinia(createPinia())
    warmupStores()
    const fresh = usePlayerStore()
    fresh.loadGame()
    expect(fresh.player.equipment.weapon!.runeSlots[0].runeId).toBeNull()
    expect(fresh.player.equipment.chest!.runeSlots[1].runeId).toBeNull()
    expect(fresh.runeInventory.map(r => r.id)).toEqual(['r1']) // inventory 不受影响
    const disk = readDisk()
    expect(disk.player.equipment.weapon.runeSlots[0].runeId).toBeNull()
    expect(disk.player.equipment.chest.runeSlots[1].runeId).toBeNull()
  })

  it('损坏 inventory + 装备引用 → inventory 清空后引用整体成为悬空并被清空（不残留半绑定）', () => {
    const fresh = corruptAndReload(disk => {
      ;(disk as Record<string, any>).player.equipment.weapon.runeSlots = slotsWith('r1', null, null)
      ;(disk as Record<string, any>).runeData = { inventory: [makeRune('r1'), makeRune('r1')] } // 重复 → 整体作废
    })
    expect(fresh.runeInventory).toEqual([])
    expect(fresh.player.equipment.weapon!.runeSlots[0].runeId).toBeNull()
  })
})

// ============================================================================
// K. 静态/动态模型断链 + runeStore 收口
// ============================================================================
describe('Phase 3.6 — 双模型收口与静态断链', () => {
  it('runeStore 不再暴露全局 5 槽镶嵌路径与 mutating API', () => {
    const rs = useRuneStore() as unknown as Record<string, unknown>
    for (const legacy of [
      'equippedRunes', 'equipRune', 'unequipRune', 'activeSetEffects',
      'totalRuneStats', 'embedRune', 'removeRune', 'getRuneStats', 'inventory'
    ]) {
      expect(rs[legacy]).toBeUndefined()
    }
    expect(typeof rs.generateRune).toBe('function')
    expect(rs.expTable).toBeDefined()
  })

  it('generateRune 产出的动态 Rune 无 slotIndex 且通过 validateRune', () => {
    const rs = useRuneStore()
    const rune = rs.generateRune()
    expect('slotIndex' in rune).toBe(false)
    expect('equippedTo' in rune).toBe(false)
    const v = validateRune(rune)
    expect(v.ok).toBe(true)
  })

  it('静态 RUNES id 不再解析为动态 Rune：store 级镶嵌请求直接失败零修改', () => {
    const store = usePlayerStore()
    store.player.equipment.weapon = makeRuneEquip('w1', 'weapon')
    store.runeInventory.push(makeRune('r1'))
    store.saveGame()
    const before = localStorage.getItem(SAVE_KEY)
    const res = store.tryEmbedEquipmentRune('weapon', 0, RUNES[0].id)
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('rune not found in inventory')
    expect(localStorage.getItem(SAVE_KEY)).toBe(before)
  })

  it('静态 RUNES id 不产生任何属性加成（getEquipmentRuneBonuses 视为悬空）', () => {
    const eq = makeRuneEquip('w1', 'weapon', { runeSlots: slotsWith(RUNES[0].id, null, null) })
    expect(getEquipmentRuneBonuses(eq, [makeRune('r1')])).toEqual([])
  })

  it('套装效果延期：动态 Rune 模型无 setId/套装字段，属性只来自六种 type 映射', () => {
    const rune = makeRune('r1', { type: 'attack', statValue: 10 })
    expect('setId' in rune).toBe(false)
    const eq = makeRuneEquip('w1', 'weapon', { runeSlots: slotsWith('r1', null, null) })
    const bonuses = getEquipmentRuneBonuses(eq, [rune])
    expect(bonuses).toHaveLength(1) // 仅一条 flat 主属性，无任何 set bonus
    expect(bonuses[0]).toEqual({ type: 'attack', value: 10, isPercent: false })
  })
})
