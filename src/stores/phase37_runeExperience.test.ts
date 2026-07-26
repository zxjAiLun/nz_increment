import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { usePlayerStore, type RuneExperienceTransactionResult } from './playerStore'
import { useRuneStore } from './runeStore'
import type { Rune } from './runeStore'
import {
  RUNE_EXP_TABLE,
  RUNE_MAX_LEVEL,
  RUNE_EXP_BASE,
  RUNE_EXP_GROWTH,
  RUNE_STAT_GROWTH,
  getRuneExpRequiredForNextLevel,
  validateRuneProgressionState,
  planRuneExperienceGain,
  getRuneExperienceProgress
} from '../utils/runeExperience'
import { createEmptyEquipmentRuneSlots, validateRune, validateRuneInventory } from '../utils/equipmentRunes'
import { calculateTotalStats } from '../utils/calc'
import type { Equipment, EquipmentSlot, RuneSlot } from '../types'

const SAVE_KEY = 'lollipop_adventure_save'

function readDisk() {
  const raw = localStorage.getItem(SAVE_KEY)
  return raw ? JSON.parse(raw) : null
}

/** 让主存档 setItem 抛错、读取委托真实 storage 的失败注入器（与历史阶段一致）。 */
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

/** 统计主存档 setItem 调用次数的注入器（委托真实 storage 实际写入）。 */
function installCountingStorage() {
  const realStorage = localStorage
  const counter = { count: 0 }
  const countingStorage = {
    get length() {
      return realStorage.length
    },
    clear: () => realStorage.clear(),
    getItem: (k: string) => realStorage.getItem(k),
    key: (i: number) => realStorage.key(i),
    removeItem: (k: string) => realStorage.removeItem(k),
    setItem: (k: string, v: string) => {
      counter.count++
      realStorage.setItem(k, v)
    }
  }
  vi.stubGlobal('localStorage', countingStorage)
  return counter
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

/** 尝试修改冻结数组（严格模式下赋值会抛，符合“只读”预期）；忽略异常后由调用方断言内容不变。 */
function mutateFrozenNoop(arr: readonly number[], index: number, value: number): void {
  try {
    ;(arr as number[])[index] = value
  } catch {
    /* 冻结数组赋值抛出属预期 */
  }
}

/** 尝试 push 到冻结数组（严格模式下会抛）；忽略后断言长度不变。 */
function pushFrozenNoop(arr: readonly number[]): void {
  try {
    ;(arr as number[]).push(0)
  } catch {
    /* 冻结数组 push 抛出属预期 */
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
    refiningSlots?: RuneSlot[]
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
    refiningSlots: (opts?.refiningSlots as unknown as Equipment['refiningSlots']) ?? [],
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

/** 把一枚 Rune 嵌入指定装备槽位第 0 孔，并加入 inventory。 */
function embedRuneIn(
  store: ReturnType<typeof usePlayerStore>,
  slot: EquipmentSlot,
  runeId: string,
  runeOpts?: Partial<Omit<Rune, 'id'>>
) {
  store.player.equipment[slot] = makeRuneEquip(slot, slot, { runeSlots: slotsWith(runeId, null, null) })
  store.runeInventory.push(makeRune(runeId, runeOpts))
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// =====================================================================
// Phase 3.7 — runeExperience 纯模块
// =====================================================================
describe('Phase 3.7 — runeExperience 经验表与纯规划', () => {
  it('经验表固定值：table[0]=0 / table[1]=22 / table[2]=46', () => {
    expect(RUNE_EXP_TABLE[0]).toBe(0)
    expect(RUNE_EXP_TABLE[1]).toBe(22)
    expect(RUNE_EXP_TABLE[2]).toBe(46)
  })

  it('经验表全部有限整数且严格递增', () => {
    expect(RUNE_EXP_TABLE).toHaveLength(RUNE_MAX_LEVEL + 1)
    for (let i = 0; i <= RUNE_MAX_LEVEL; i++) {
      const v = RUNE_EXP_TABLE[i]
      expect(Number.isFinite(v)).toBe(true)
      expect(Number.isInteger(v)).toBe(true)
      expect(v).toBeGreaterThanOrEqual(0)
      if (i >= 1) expect(v).toBeGreaterThan(RUNE_EXP_TABLE[i - 1])
    }
  })

  it('常量与既有公式一致（base=20 / growth=1.1 / stat 成长=1.1）', () => {
    expect(RUNE_EXP_BASE).toBe(20)
    expect(RUNE_EXP_GROWTH).toBeCloseTo(1.1, 9)
    expect(RUNE_STAT_GROWTH).toBeCloseTo(1.1, 9)
    // table[3] = 46 + floor(20*1.1^3) = 46 + floor(26.62) = 46 + 26 = 72
    expect(RUNE_EXP_TABLE[3]).toBe(72)
  })

  it('getRuneExpRequiredForNextLevel：1..49 有限正整数，50 与非法返回 null', () => {
    for (let level = 1; level <= 49; level++) {
      const req = getRuneExpRequiredForNextLevel(level)
      expect(req).toBe(RUNE_EXP_TABLE[level])
      expect(typeof req === 'number' && Number.isFinite(req) && req > 0).toBe(true)
    }
    expect(getRuneExpRequiredForNextLevel(50)).toBeNull()
    expect(getRuneExpRequiredForNextLevel(0)).toBeNull()
    expect(getRuneExpRequiredForNextLevel(-1)).toBeNull()
    expect(getRuneExpRequiredForNextLevel(51)).toBeNull()
    expect(getRuneExpRequiredForNextLevel(NaN)).toBeNull()
    expect(getRuneExpRequiredForNextLevel(1.5)).toBeNull()
  })

  it('validateRuneProgressionState：非满级 exp 必须 < 阈值；满级任意有限非负 exp 通过', () => {
    expect(validateRuneProgressionState(makeRune('r1', { level: 1, exp: 21 })).ok).toBe(true)
    expect(validateRuneProgressionState(makeRune('r1', { level: 1, exp: 22 })).ok).toBe(false)
    expect(validateRuneProgressionState(makeRune('r1', { level: 1, exp: 0 })).ok).toBe(true)
    // 满级：exp 可为余量
    expect(validateRuneProgressionState(makeRune('r1', { level: 50, exp: 999 })).ok).toBe(true)
    // 非法 Rune 结构
    expect(validateRuneProgressionState({ id: 'x', type: 'attack', rarity: 'common', level: 1, exp: 0, statValue: 10 } as unknown).ok).toBe(true) // valid
    expect(validateRuneProgressionState(null).ok).toBe(false)
  })

  it('升级边界：Lv.1 exp=0 +21 → Lv.1 exp=21（statValue 不变）', () => {
    const p = planRuneExperienceGain(makeRune('r1', { level: 1, exp: 0, statValue: 10 }), 21)
    expect(p.ok).toBe(true)
    if (!p.ok) return
    expect(p.nextRune.level).toBe(1)
    expect(p.nextRune.exp).toBe(21)
    expect(p.nextRune.statValue).toBe(10)
    expect(p.levelsGained).toBe(0)
  })

  it('升级边界：Lv.1 exp=0 +22 → Lv.2 exp=0', () => {
    const p = planRuneExperienceGain(makeRune('r1', { level: 1, exp: 0, statValue: 10 }), 22)
    expect(p.ok).toBe(true)
    if (!p.ok) return
    expect(p.nextRune.level).toBe(2)
    expect(p.nextRune.exp).toBe(0)
    expect(p.levelsGained).toBe(1)
  })

  it('升级边界：Lv.1 exp=0 +68 → Lv.3 exp=0', () => {
    const p = planRuneExperienceGain(makeRune('r1', { level: 1, exp: 0, statValue: 10 }), 68)
    expect(p.ok).toBe(true)
    if (!p.ok) return
    expect(p.nextRune.level).toBe(3)
    expect(p.nextRune.exp).toBe(0)
    expect(p.levelsGained).toBe(2)
  })

  it('升级边界：Lv.1 exp=5 +17 → Lv.2 exp=0（余量正确）', () => {
    const p = planRuneExperienceGain(makeRune('r1', { level: 1, exp: 5, statValue: 10 }), 17)
    expect(p.ok).toBe(true)
    if (!p.ok) return
    expect(p.nextRune.level).toBe(2)
    expect(p.nextRune.exp).toBe(0)
  })

  it('超过阈值后的余量正确保留（Lv.1 exp=0 +23 → Lv.2 exp=1）', () => {
    const p = planRuneExperienceGain(makeRune('r1', { level: 1, exp: 0, statValue: 10 }), 23)
    expect(p.ok).toBe(true)
    if (!p.ok) return
    expect(p.nextRune.level).toBe(2)
    expect(p.nextRune.exp).toBe(1)
  })

  it('一次大额经验可连续升级（Lv.1 +200 → 多级）', () => {
    const p = planRuneExperienceGain(makeRune('r1', { level: 1, exp: 0, statValue: 10 }), 200)
    expect(p.ok).toBe(true)
    if (!p.ok) return
    expect(p.nextRune.level).toBeGreaterThan(1)
    expect(p.levelsGained).toBeGreaterThan(1)
    expect(p.nextRune.exp).toBeGreaterThanOrEqual(0)
    expect(p.nextRune.exp).toBeLessThan(getRuneExpRequiredForNextLevel(p.nextRune.level) ?? Infinity)
  })

  it('达到 Lv.50 后循环停止且有界', () => {
    const p = planRuneExperienceGain(makeRune('r1', { level: 1, exp: 0, statValue: 10 }), 1e9)
    expect(p.ok).toBe(true)
    if (!p.ok) return
    expect(p.nextRune.level).toBe(50)
    expect(p.levelsGained).toBe(49)
  })

  it('Lv.50 再加经验失败', () => {
    const p = planRuneExperienceGain(makeRune('r1', { level: 50, exp: 5, statValue: 100 }), 22)
    expect(p.ok).toBe(false)
  })

  it('statValue 逐级 floor(statValue×1.1)：10 → 11 → 12', () => {
    const p = planRuneExperienceGain(makeRune('r1', { level: 1, exp: 0, statValue: 10 }), 200)
    expect(p.ok).toBe(true)
    if (!p.ok) return
    // 10 → 11 (lv2) → 12 (lv3)
    const lv3 = planRuneExperienceGain(makeRune('r1', { level: 1, exp: 0, statValue: 10 }), 68)
    expect(lv3.ok && lv3.nextRune.statValue).toBe(12)
  })

  it('statValue 严格逐级 floor，不得一次性计算 1.1^N（25 → 27 → 29，而非 floor(25*1.21)=30）', () => {
    // 25 → floor(25*1.1)=27 → floor(27*1.1)=29
    const lv3 = planRuneExperienceGain(makeRune('r1', { level: 1, exp: 0, statValue: 25 }), 68)
    expect(lv3.ok && lv3.nextRune.statValue).toBe(29)
  })

  it('损坏与溢出：非法 Rune / 非 canonical exp / 非法 expAmount 全部失败且不抛', () => {
    expect(planRuneExperienceGain(null, 22).ok).toBe(false)
    expect(planRuneExperienceGain(makeRune('r1', { level: 1, exp: 22 }), 22).ok).toBe(false) // non-canonical
    expect(planRuneExperienceGain(makeRune('r1', { level: 1, exp: 0 }), 0).ok).toBe(false)
    expect(planRuneExperienceGain(makeRune('r1', { level: 1, exp: 0 }), -5).ok).toBe(false)
    expect(planRuneExperienceGain(makeRune('r1', { level: 1, exp: 0 }), 1.5).ok).toBe(false)
    expect(planRuneExperienceGain(makeRune('r1', { level: 1, exp: 0 }), NaN).ok).toBe(false)
    expect(planRuneExperienceGain(makeRune('r1', { level: 1, exp: 0 }), Infinity).ok).toBe(false)
    expect(planRuneExperienceGain(makeRune('r1', { level: 1, exp: 0 }), '22' as unknown).ok).toBe(false)
    expect(planRuneExperienceGain(makeRune('r1', { level: 1, exp: 0 }), null as unknown).ok).toBe(false)
  })

  it('exp 溢出防御：极大有限 expAmount 不抛、输入不变、结果有限且 canonical', () => {
    // 说明：canonical 约束下 rune.exp < 阈值（≤22），expAmount 为有限整数，
    // 故 rune.exp + expAmount 不会真正达到 Infinity（会就近舍入到 MAX_VALUE 仍有限）。
    // 该用例验证溢出防御不会让规划产生 NaN/Infinity/部分升级，且不修改输入。
    const rune = makeRune('r1', { level: 1, exp: 0, statValue: 10 })
    const before = JSON.stringify(rune)
    const p = planRuneExperienceGain(rune, Number.MAX_SAFE_INTEGER)
    expect(p.ok).toBe(true)
    if (!p.ok) return
    expect(Number.isFinite(p.nextRune.level)).toBe(true)
    expect(Number.isFinite(p.nextRune.exp)).toBe(true)
    expect(Number.isFinite(p.nextRune.statValue)).toBe(true)
    expect(p.nextRune.level).toBe(50)
    expect(JSON.stringify(rune)).toBe(before)
  })

  it('派生溢出：statValue×1.1 溢出（statValue=Number.MAX_VALUE）失败且不抛', () => {
    const p = planRuneExperienceGain(makeRune('r1', { level: 1, exp: 0, statValue: Number.MAX_VALUE }), 22)
    expect(p.ok).toBe(false)
  })

  it('规划不修改输入 Rune，且不调用 RNG', () => {
    const spy = vi.spyOn(Math, 'random')
    const rune = makeRune('r1', { level: 1, exp: 0, statValue: 10 })
    const before = JSON.stringify(rune)
    const p = planRuneExperienceGain(rune, 22)
    expect(p.ok).toBe(true)
    expect(JSON.stringify(rune)).toBe(before)
    expect(spy).not.toHaveBeenCalled()
  })

  it('getRuneExperienceProgress：非满级返回 currentExp/requiredExp/percent，满级 isMax/percent=100', () => {
    const np = getRuneExperienceProgress(makeRune('r1', { level: 1, exp: 11, statValue: 10 }))
    expect(np).not.toBeNull()
    if (!np) return
    expect(np.level).toBe(1)
    expect(np.currentExp).toBe(11)
    expect(np.requiredExp).toBe(22)
    expect(np.percent).toBeCloseTo(50, 9)
    expect(np.isMax).toBe(false)

    const max = getRuneExperienceProgress(makeRune('r1', { level: 50, exp: 5, statValue: 100 }))
    expect(max).not.toBeNull()
    if (!max) return
    expect(max.isMax).toBe(true)
    expect(max.requiredExp).toBeNull()
    expect(max.percent).toBe(100)

    expect(getRuneExperienceProgress(null)).toBeNull()
  })

  it('规划返回 nextRune 的 id/type/rarity 完全不变', () => {
    const p = planRuneExperienceGain(makeRune('r1', { level: 1, exp: 0, statValue: 10, type: 'attack', rarity: 'legend' }), 68)
    expect(p.ok).toBe(true)
    if (!p.ok) return
    expect(p.nextRune.id).toBe('r1')
    expect(p.nextRune.type).toBe('attack')
    expect(p.nextRune.rarity).toBe('legend')
  })
})

// =====================================================================
// Phase 3.7 — playerStore.tryAddRuneExperience 原子事务与真实属性
// =====================================================================
describe('Phase 3.7 — 原子事务与已镶嵌 Rune 属性即时生效', () => {
  it('未镶嵌 Rune 只增加经验，不改变 totalStats', () => {
    const store = usePlayerStore()
    store.runeInventory.push(makeRune('r1', { level: 1, exp: 0, statValue: 100, type: 'attack' }))
    const before = calculateTotalStats(store.player, undefined, store.runeInventory)
    const res = store.tryAddRuneExperience('r1', 22)
    const after = calculateTotalStats(store.player, undefined, store.runeInventory)
    expect(res.ok).toBe(true)
    expect(res.levelsGained).toBe(1)
    expect(after.attack).toBe(before.attack)
    expect(store.runeInventory[0].level).toBe(2)
    expect(store.runeInventory[0].statValue).toBe(110)
  })

  it('已镶嵌 attack Rune 升级后 attack 精确变化（+15）', () => {
    const store = usePlayerStore()
    embedRuneIn(store, 'weapon', 'r1', { type: 'attack', statValue: 100, level: 1, exp: 0 })
    const before = calculateTotalStats(store.player, undefined, store.runeInventory)
    const res = store.tryAddRuneExperience('r1', 22)
    const after = calculateTotalStats(store.player, undefined, store.runeInventory)
    expect(res.ok).toBe(true)
    expect(after.attack - before.attack).toBe(15) // floor(110*1.05)=115 - floor(100*1)=100
    expect(store.runeInventory[0].level).toBe(2)
  })

  it('已镶嵌 health Rune 升级后 maxHp 变化（+15）', () => {
    const store = usePlayerStore()
    embedRuneIn(store, 'weapon', 'r1', { type: 'health', statValue: 100, level: 1, exp: 0 })
    const before = calculateTotalStats(store.player, undefined, store.runeInventory)
    store.tryAddRuneExperience('r1', 22)
    const after = calculateTotalStats(store.player, undefined, store.runeInventory)
    expect(after.maxHp - before.maxHp).toBe(15)
  })

  it('已镶嵌 crit Rune 升级后 critRate 变化（+7，避开 80 上限）', () => {
    const store = usePlayerStore()
    embedRuneIn(store, 'weapon', 'r1', { type: 'crit', statValue: 50, level: 1, exp: 0 })
    const before = calculateTotalStats(store.player, undefined, store.runeInventory)
    store.tryAddRuneExperience('r1', 22)
    const after = calculateTotalStats(store.player, undefined, store.runeInventory)
    // floor(50*1.05)=50 → floor(55*1.05)=57；base 5 不触 80 上限；delta = 7
    expect(after.critRate - before.critRate).toBe(7)
  })

  it('已镶嵌 luck Rune 升级后 luck 变化（+15）', () => {
    const store = usePlayerStore()
    embedRuneIn(store, 'weapon', 'r1', { type: 'luck', statValue: 100, level: 1, exp: 0 })
    const before = calculateTotalStats(store.player, undefined, store.runeInventory)
    store.tryAddRuneExperience('r1', 22)
    const after = calculateTotalStats(store.player, undefined, store.runeInventory)
    expect(after.luck - before.luck).toBe(15)
  })

  it('一次多级升级后的最终属性准确（Lv.1 +68 → Lv.3 statValue 121，attack +33）', () => {
    const store = usePlayerStore()
    embedRuneIn(store, 'weapon', 'r1', { type: 'attack', statValue: 100, level: 1, exp: 0 })
    const before = calculateTotalStats(store.player, undefined, store.runeInventory)
    const res = store.tryAddRuneExperience('r1', 68)
    const after = calculateTotalStats(store.player, undefined, store.runeInventory)
    expect(res.ok).toBe(true)
    expect(res.levelsGained).toBe(2)
    expect(store.runeInventory[0].level).toBe(3)
    expect(store.runeInventory[0].statValue).toBe(121) // 100→110→121
    expect(after.attack - before.attack).toBe(33) // floor(121*1.10)=133 - 100
  })

  it('装备基础 stats 不变、Rune 拓扑不变、inventory 顺序/其他 Rune 不变、refining 不重复', () => {
    const store = usePlayerStore()
    // 武器带精炼 defense+15（验证精炼 bonus 不被升级影响/复制）
    store.player.equipment.weapon = makeRuneEquip('w1', 'weapon', {
      runeSlots: slotsWith('r1', null, null),
      refiningSlots: [{ index: 0, stat: 'defense', value: 15, type: 'flat' }] as unknown as RuneSlot[]
    })
    store.runeInventory.push(makeRune('r1', { type: 'attack', statValue: 100, level: 1, exp: 0 }))
    store.runeInventory.push(makeRune('other', { type: 'health', statValue: 50, level: 1, exp: 0 }))

    const before = calculateTotalStats(store.player, undefined, store.runeInventory)
    const beforeRefining = before.defense
    const beforeWeaponStats = store.player.equipment.weapon.stats[0].value
    const beforeRefiningSlots = JSON.stringify(store.player.equipment.weapon.refiningSlots)
    const beforeTopo = JSON.stringify(store.player.equipment.weapon.runeSlots)
    const beforeOrder = store.runeInventory.map(r => r.id)

    store.tryAddRuneExperience('r1', 22)

    const after = calculateTotalStats(store.player, undefined, store.runeInventory)
    // 精炼 defense 不变（rune 是 attack，不影响 defense）
    expect(after.defense).toBe(beforeRefining)
    // 装备基础 stats 不变
    expect(store.player.equipment.weapon.stats[0].value).toBe(beforeWeaponStats)
    // 精炼槽位结构不变
    expect(JSON.stringify(store.player.equipment.weapon.refiningSlots)).toBe(beforeRefiningSlots)
    // Rune 拓扑不变
    expect(JSON.stringify(store.player.equipment.weapon.runeSlots)).toBe(beforeTopo)
    // inventory 顺序与其他 Rune 不变，仅目标 Rune 升级
    expect(store.runeInventory.map(r => r.id)).toEqual(beforeOrder)
    const other = store.runeInventory.find(r => r.id === 'other')!
    expect(other.level).toBe(1)
    expect(other.statValue).toBe(50)
    const target = store.runeInventory.find(r => r.id === 'r1')!
    expect(target.level).toBe(2)
  })

  it('成功写盘：磁盘 runeData.inventory 与内存一致', () => {
    const store = usePlayerStore()
    embedRuneIn(store, 'weapon', 'r1', { type: 'attack', statValue: 100, level: 1, exp: 0 })
    store.tryAddRuneExperience('r1', 22)
    const disk = readDisk()
    expect(disk.runeData.inventory).toHaveLength(1)
    expect(disk.runeData.inventory[0].id).toBe('r1')
    expect(disk.runeData.inventory[0].level).toBe(2)
    expect(disk.runeData.inventory[0].statValue).toBe(110)
  })

  it('重新创建 Pinia + loadGame 后 level/exp/statValue 保留', () => {
    const store = usePlayerStore()
    embedRuneIn(store, 'weapon', 'r1', { type: 'attack', statValue: 100, level: 1, exp: 0 })
    store.tryAddRuneExperience('r1', 22)

    setActivePinia(createPinia())
    const reloaded = usePlayerStore()
    reloaded.loadGame()
    const r = reloaded.runeInventory.find(x => x.id === 'r1')
    expect(r).toBeDefined()
    expect(r!.level).toBe(2)
    expect(r!.statValue).toBe(110)
    expect(r!.exp).toBe(0)
  })

  it('保存失败完整回滚（inventory / 拓扑 / 磁盘不变）', () => {
    const store = usePlayerStore()
    embedRuneIn(store, 'weapon', 'r1', { type: 'attack', statValue: 100, level: 1, exp: 0 })
    store.saveGame() // 基准盘
    const baselineDisk = JSON.parse(JSON.stringify(readDisk()))

    installThrowingStorage()
    const res = store.tryAddRuneExperience('r1', 22)
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('save failed')
    // 内存：Rune 仍是 level 1
    expect(store.runeInventory[0].level).toBe(1)
    expect(store.runeInventory[0].statValue).toBe(100)
    // 拓扑不变
    expect(store.player.equipment.weapon!.runeSlots[0].runeId).toBe('r1')
    // 磁盘未变
    expect(readDisk()).toEqual(baselineDisk)
  })

  it('恢复真实存储后重试只提交一次（不重复升级）', () => {
    const store = usePlayerStore()
    embedRuneIn(store, 'weapon', 'r1', { type: 'attack', statValue: 100, level: 1, exp: 0 })
    store.saveGame()
    installThrowingStorage()
    const first = store.tryAddRuneExperience('r1', 22)
    expect(first.ok).toBe(false)
    // 恢复存储
    vi.unstubAllGlobals()
    const second = store.tryAddRuneExperience('r1', 22)
    expect(second.ok).toBe(true)
    // 仅一次升级：level 2（而非因重试叠加到 3）
    expect(store.runeInventory[0].level).toBe(2)
    expect(store.runeInventory[0].statValue).toBe(110)
  })

  it('锁定装备中的 Rune 允许升级（升级目标是 inventory Rune）', () => {
    const store = usePlayerStore()
    store.player.equipment.weapon = makeRuneEquip('w1', 'weapon', {
      runeSlots: slotsWith('r1', null, null),
      isLocked: true
    })
    store.runeInventory.push(makeRune('r1', { type: 'attack', statValue: 100, level: 1, exp: 0 }))
    const res = store.tryAddRuneExperience('r1', 22)
    expect(res.ok).toBe(true)
    expect(store.runeInventory[0].level).toBe(2)
  })

  it('损坏/溢出场景：事务零修改零写盘', () => {
    // 满级 Rune
    const s1 = usePlayerStore()
    embedRuneIn(s1, 'weapon', 'r1', { type: 'attack', statValue: 100, level: 50, exp: 5 })
    const inv1Before = JSON.stringify(s1.runeInventory)
    expect(s1.tryAddRuneExperience('r1', 22).ok).toBe(false)
    expect(JSON.stringify(s1.runeInventory)).toBe(inv1Before)

    // 非 canonical exp
    const s2 = usePlayerStore()
    embedRuneIn(s2, 'weapon', 'r1', { type: 'attack', statValue: 100, level: 1, exp: 22 })
    const inv2Before = JSON.stringify(s2.runeInventory)
    expect(s2.tryAddRuneExperience('r1', 22).ok).toBe(false)
    expect(JSON.stringify(s2.runeInventory)).toBe(inv2Before)

    // inventory 重复 id
    const s3 = usePlayerStore()
    s3.runeInventory = [makeRune('r1'), makeRune('r1')]
    expect(s3.tryAddRuneExperience('r1', 22).ok).toBe(false)

    // inventory 含非法 Rune
    const s4 = usePlayerStore()
    s4.runeInventory = [{ id: 'r1', type: 'bogus' as never, rarity: 'common', level: 1, exp: 0, statValue: 10 }] as Rune[]
    expect(s4.tryAddRuneExperience('r1', 22).ok).toBe(false)

    // runeId 不存在
    const s5 = usePlayerStore()
    s5.runeInventory.push(makeRune('r1'))
    expect(s5.tryAddRuneExperience('nope', 22).ok).toBe(false)

    // 空白 runeId
    const s6 = usePlayerStore()
    s6.runeInventory.push(makeRune('r1'))
    expect(s6.tryAddRuneExperience('   ', 22).ok).toBe(false)

    // 派生溢出（满级 statValue 溢出）
    const s7 = usePlayerStore()
    embedRuneIn(s7, 'weapon', 'r1', { type: 'attack', statValue: Number.MAX_VALUE, level: 1, exp: 0 })
    const inv7Before = JSON.stringify(s7.runeInventory)
    expect(s7.tryAddRuneExperience('r1', 22).ok).toBe(false)
    expect(JSON.stringify(s7.runeInventory)).toBe(inv7Before)
  })

  it('tryAddRuneExperience 不调用 Math.random', () => {
    const store = usePlayerStore()
    embedRuneIn(store, 'weapon', 'r1', { type: 'attack', statValue: 100, level: 1, exp: 0 })
    const spy = vi.spyOn(Math, 'random')
    store.tryAddRuneExperience('r1', 22)
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('Phase 3.7 — generateRune 经验/升级相关结构不变', () => {
  it('generateRune 原 RNG 次数（3 次）与顺序（类型/稀有度/ID）不变，初始 level=1 exp=0', () => {
    const rs = useRuneStore()
    const calls: number[] = []
    const spy = vi.spyOn(Math, 'random').mockImplementation(() => {
      calls.push(0)
      return 0
    })
    const rune = rs.generateRune()!
    expect(calls.length).toBe(3) // type, rarity, id 后缀
    expect(rune.type).toBe('attack') // floor(0*6)=0
    expect(rune.rarity).toBe('common') // 0 < 0.6
    expect(rune.statValue).toBe(10) // floor(10 * 1)
    expect(rune.level).toBe(1)
    expect(rune.exp).toBe(0)
    expect(rune.id.startsWith('rune_')).toBe(true)
    spy.mockRestore()
  })

  it('generateRune 在罕见 roll 下仍保持公式（luck / legend / statValue=15）', () => {
    const rs = useRuneStore()
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.99)
    const rune = rs.generateRune()!
    expect(rune.type).toBe('luck') // floor(0.99*6)=5
    expect(rune.rarity).toBe('legend') // 0.99 不 < 0.97
    expect(rune.statValue).toBe(15) // floor(5 * 3)
    expect(rune.level).toBe(1)
    expect(rune.exp).toBe(0)
    spy.mockRestore()
  })

  it('runeStore 仅暴露只读 expTable（委托 runeExperience），无第二份公式', () => {
    const rs = useRuneStore()
    expect(rs.expTable).toBeDefined()
    expect(rs.expTable).toEqual(RUNE_EXP_TABLE)
    expect(rs.expTable[1]).toBe(22)
  })
})

// =====================================================================
// Phase 3.7.1 — canonical ID 提交、经验表只读性、异常 fail-closed 收口
// =====================================================================
describe('Phase 3.7.1 — canonical ID 提交与异常 fail-closed', () => {
  it('P1-A：inventory 中目标 Rune.id="  r1  "，调用 tryAddRuneExperience("r1",22) 成功升级并 canonical 化', () => {
    const store = usePlayerStore()
    store.runeInventory.push(makeRune('  r1  ', { type: 'attack', statValue: 100, level: 1, exp: 0 }))
    const res = store.tryAddRuneExperience('r1', 22)
    expect(res.ok).toBe(true)
    expect(res.levelsGained).toBe(1)
    // 目标 Rune 升至 Lv.2、exp=0、statValue 按公式增长（floor(100*1.1)=110）
    const r = store.runeInventory[0]
    expect(r.level).toBe(2)
    expect(r.exp).toBe(0)
    expect(r.statValue).toBe(110)
    // 目标 id 落为 canonical 'r1'
    expect(r.id).toBe('r1')
    // inventory 数量与顺序不变
    expect(store.runeInventory).toHaveLength(1)
    // 磁盘与内存一致
    const disk = readDisk()
    expect(disk.runeData.inventory[0].id).toBe('r1')
    expect(disk.runeData.inventory[0].level).toBe(2)
    expect(disk.runeData.inventory[0].statValue).toBe(110)
  })

  it('P1-A：调用参数 "  r1  " 结果相同（padded 参数也能匹配并 canonical 化）', () => {
    const store = usePlayerStore()
    store.runeInventory.push(makeRune('  r1  ', { type: 'attack', statValue: 100, level: 1, exp: 0 }))
    const res = store.tryAddRuneExperience('  r1  ', 22)
    expect(res.ok).toBe(true)
    expect(store.runeInventory[0].level).toBe(2)
    expect(store.runeInventory[0].statValue).toBe(110)
    expect(store.runeInventory[0].id).toBe('r1')
  })

  it('P1-A：padded ID 成功写盘只调用一次 localStorage.setItem', () => {
    const store = usePlayerStore()
    store.runeInventory.push(makeRune('  r1  ', { type: 'attack', statValue: 100, level: 1, exp: 0 }))
    const counter = installCountingStorage()
    store.tryAddRuneExperience('r1', 22)
    expect(counter.count).toBe(1)
  })

  it('P1-A：padded ID 保存失败恢复事务前原始字节（含空白 id），磁盘不变', () => {
    const store = usePlayerStore()
    store.runeInventory.push(makeRune('  r1  ', { type: 'attack', statValue: 100, level: 1, exp: 0 }))
    store.saveGame() // 基准盘，含 '  r1  '
    const baselineDisk = JSON.parse(JSON.stringify(readDisk()))
    installThrowingStorage()
    const res = store.tryAddRuneExperience('r1', 22)
    expect(res.ok).toBe(false)
    // 内存恢复：仍为带空白 id 的 Lv.1
    expect(store.runeInventory[0].id).toBe('  r1  ')
    expect(store.runeInventory[0].level).toBe(1)
    expect(store.runeInventory[0].statValue).toBe(100)
    // 顺序不变
    expect(store.runeInventory.map(r => r.id)).toEqual(['  r1  '])
    // 磁盘字节未变
    expect(readDisk()).toEqual(baselineDisk)
  })

  it('P1-A：padded ID 保存失败恢复真实存储后重试只提交一次（不重复升级，id 被 canonical 化）', () => {
    const store = usePlayerStore()
    store.runeInventory.push(makeRune('  r1  ', { type: 'attack', statValue: 100, level: 1, exp: 0 }))
    store.saveGame()
    installThrowingStorage()
    const first = store.tryAddRuneExperience('r1', 22)
    expect(first.ok).toBe(false)
    vi.unstubAllGlobals()
    const second = store.tryAddRuneExperience('r1', 22)
    expect(second.ok).toBe(true)
    expect(store.runeInventory[0].level).toBe(2)
    expect(store.runeInventory[0].statValue).toBe(110)
    expect(store.runeInventory[0].id).toBe('r1') // canonical 化只发生一次
  })

  it('P1：候选已应用但 saveGame 直接抛异常（Date.now 抛），事务失败且内存/拓扑/磁盘零修改、setItem 0 次、重试只提交一次', () => {
    const store = usePlayerStore()
    embedRuneIn(store, 'weapon', 'r1', { type: 'attack', statValue: 100, level: 1, exp: 0 })
    // 合法基准盘
    store.saveGame()
    const baselineInventory = JSON.parse(JSON.stringify(store.runeInventory))
    const baselineTopology = JSON.parse(JSON.stringify(store.player.equipment.weapon?.runeSlots))
    const baselineDisk = JSON.parse(JSON.stringify(readDisk()))
    const counter = installCountingStorage()
    // saveGame 的默认参数 Date.now() 会在候选已应用后直接抛出
    const dateSpy = vi.spyOn(Date, 'now').mockImplementation(() => {
      throw new Error('clock unavailable')
    })
    let threw = false
    let res: RuneExperienceTransactionResult | undefined
    try {
      res = store.tryAddRuneExperience('r1', 22)
    } catch {
      threw = true
    }
    // 调用不向外抛
    expect(threw).toBe(false)
    expect(res?.ok).toBe(false)
    expect(res?.levelsGained).toBe(0)
    // 内存完全恢复：r1 仍为 Lv.1 / exp=0 / statValue=100
    expect(store.runeInventory).toEqual(baselineInventory)
    expect(store.runeInventory[0].level).toBe(1)
    expect(store.runeInventory[0].exp).toBe(0)
    expect(store.runeInventory[0].statValue).toBe(100)
    // 装备拓扑完全一致
    expect(store.player.equipment.weapon?.runeSlots).toEqual(baselineTopology)
    // 磁盘原字节完全一致
    expect(readDisk()).toEqual(baselineDisk)
    // 零写盘
    expect(counter.count).toBe(0)
    // 恢复时钟后重试只提交一次、不重复升级（从 Lv.1 到 Lv.2，不跳 Lv.3）
    dateSpy.mockRestore()
    const retry = store.tryAddRuneExperience('r1', 22)
    expect(retry.ok).toBe(true)
    expect(store.runeInventory[0].level).toBe(2)
    expect(store.runeInventory[0].statValue).toBe(110)
    expect(counter.count).toBe(1)
  })

  it('P1：padded ID 应用后 saveGame 直接抛异常（Date.now 抛），回滚保留原空白 id 与磁盘、重试只提交一次并 canonical 化', () => {
    const store = usePlayerStore()
    store.runeInventory.push(makeRune('  r1  ', { type: 'attack', statValue: 100, level: 1, exp: 0 }))
    store.saveGame()
    const baselineDisk = JSON.parse(JSON.stringify(readDisk()))
    const counter = installCountingStorage()
    const dateSpy = vi.spyOn(Date, 'now').mockImplementation(() => {
      throw new Error('clock unavailable')
    })
    const res = store.tryAddRuneExperience('r1', 22)
    expect(res.ok).toBe(false)
    // 失败回滚后保留 padded ID 与原始字段
    expect(store.runeInventory[0].id).toBe('  r1  ')
    expect(store.runeInventory[0].level).toBe(1)
    expect(store.runeInventory[0].statValue).toBe(100)
    expect(store.runeInventory.map(r => r.id)).toEqual(['  r1  '])
    // 磁盘仍保留 padded ID 原字节
    expect(readDisk()).toEqual(baselineDisk)
    expect(readDisk().runeData.inventory[0].id).toBe('  r1  ')
    // 零写盘
    expect(counter.count).toBe(0)
    // 恢复时钟后重试成功升级、canonical 化、只提交一次
    dateSpy.mockRestore()
    const retry = store.tryAddRuneExperience('r1', 22)
    expect(retry.ok).toBe(true)
    expect(store.runeInventory[0].level).toBe(2)
    expect(store.runeInventory[0].statValue).toBe(110)
    expect(store.runeInventory[0].id).toBe('r1') // canonical 化只发生一次
    expect(counter.count).toBe(1)
  })

  it('P2-A：RUNE_EXP_TABLE 编译期/运行时只读，修改尝试无效', () => {
    expect(Array.isArray(RUNE_EXP_TABLE)).toBe(true)
    expect(Object.isFrozen(RUNE_EXP_TABLE)).toBe(true)
    mutateFrozenNoop(RUNE_EXP_TABLE, 1, 999999)
    expect(RUNE_EXP_TABLE[1]).toBe(22)
    mutateFrozenNoop(RUNE_EXP_TABLE, 2, 999999)
    expect(RUNE_EXP_TABLE[2]).toBe(46)
    pushFrozenNoop(RUNE_EXP_TABLE)
    expect(RUNE_EXP_TABLE).toHaveLength(RUNE_MAX_LEVEL + 1)
    // 修改无效后升级结果不受影响
    expect(getRuneExpRequiredForNextLevel(1)).toBe(22)
    const p = planRuneExperienceGain(makeRune('r1', { level: 1, exp: 0 }), 22)
    expect(p.ok).toBe(true)
  })

  it('P2-A：runeStore.expTable 委托同一冻结数组，运行时只读且内容不变', () => {
    const rs = useRuneStore()
    expect(Array.isArray(rs.expTable)).toBe(true)
    expect(Object.isFrozen(rs.expTable)).toBe(true)
    expect(rs.expTable).toEqual(RUNE_EXP_TABLE)
    expect(rs.expTable[1]).toBe(22)
    expect(rs.expTable[2]).toBe(46)
    mutateFrozenNoop(rs.expTable, 1, 999999)
    expect(rs.expTable[1]).toBe(22)
    expect(RUNE_EXP_TABLE[1]).toBe(22)
  })

  it('Section 5：getRuneExperienceProgress 非 canonical 进度返回 null（不显示 100%/isMax:false）', () => {
    // Lv.1 exp=22（已达阈值却未升级）→ null
    expect(getRuneExperienceProgress(makeRune('r1', { level: 1, exp: 22 }))).toBeNull()
    // Lv.2 exp>=table[2](46) → null
    expect(getRuneExperienceProgress(makeRune('r1', { level: 2, exp: 46 }))).toBeNull()
    expect(getRuneExperienceProgress(makeRune('r1', { level: 2, exp: 50 }))).toBeNull()
    // 合法 canonical 仍正常
    const ok = getRuneExperienceProgress(makeRune('r1', { level: 1, exp: 0 }))
    expect(ok).not.toBeNull()
    if (ok) expect(ok.isMax).toBe(false)
    // 满级余量仍合法并显示 MAX
    const max = getRuneExperienceProgress(makeRune('r1', { level: 50, exp: 999 }))
    expect(max).not.toBeNull()
    if (max) expect(max.isMax).toBe(true)
  })

  describe('Section 8 — 异常矩阵：throwing getter / Proxy 不抛且 Store 零修改零写盘', () => {
    function throwingGetterRune(prop: string): unknown {
      const base: Record<string, unknown> = {
        id: 'r1', type: 'attack', rarity: 'common', level: 1, exp: 0, statValue: 10
      }
      return new Proxy(base, {
        get(target, key) {
          if (key === prop) throw new Error('getter exploded')
          return (target as Record<string, unknown>)[key as string]
        }
      })
    }

    function throwingProxyArray(): unknown {
      const target: unknown[] = []
      return new Proxy(target, {
        get(t, key) {
          if (key === 'length') return 1
          if (key === '0') throw new Error('element getter exploded')
          return (t as unknown as Record<string | number, unknown>)[key as string | number]
        }
      })
    }

    function throwingGetProxyArray(): unknown {
      return new Proxy(
        [{ id: 'r1', type: 'attack', rarity: 'common', level: 1, exp: 0, statValue: 10 }],
        { get() { throw new Error('proxy get exploded') } }
      )
    }

    it('Rune.id getter 抛异常：validateRune / validateRuneInventory / validateRuneProgressionState / planRuneExperienceGain / getRuneExperienceProgress 均不抛', () => {
      const rune = throwingGetterRune('id')
      expect(() => validateRune(rune)).not.toThrow()
      expect(validateRune(rune).ok).toBe(false)
      expect(() => validateRuneInventory([rune])).not.toThrow()
      expect(validateRuneInventory([rune]).ok).toBe(false)
      expect(() => validateRuneProgressionState(rune)).not.toThrow()
      expect(validateRuneProgressionState(rune).ok).toBe(false)
      expect(() => planRuneExperienceGain(rune, 22)).not.toThrow()
      expect(planRuneExperienceGain(rune, 22).ok).toBe(false)
      expect(() => getRuneExperienceProgress(rune)).not.toThrow()
      expect(getRuneExperienceProgress(rune)).toBeNull()
    })

    it('Rune.level getter 抛异常：各纯 API 不抛', () => {
      const rune = throwingGetterRune('level')
      expect(() => validateRune(rune)).not.toThrow()
      expect(validateRune(rune).ok).toBe(false)
      expect(() => validateRuneInventory([rune])).not.toThrow()
      expect(() => validateRuneProgressionState(rune)).not.toThrow()
      expect(() => planRuneExperienceGain(rune, 22)).not.toThrow()
      expect(() => getRuneExperienceProgress(rune)).not.toThrow()
    })

    it('inventory 数组元素 getter 抛异常：validateRuneInventory 不抛', () => {
      const arr = throwingProxyArray()
      expect(() => validateRuneInventory(arr)).not.toThrow()
      expect(validateRuneInventory(arr).ok).toBe(false)
    })

    it('inventory 为 Proxy 且 get 陷阱抛异常：validateRuneInventory 不抛', () => {
      const arr = throwingGetProxyArray()
      expect(() => validateRuneInventory(arr)).not.toThrow()
      expect(validateRuneInventory(arr).ok).toBe(false)
    })

    it('Store 层：异常 inventory 调用 tryAddRuneExperience 不抛、零修改零写盘、拓扑与磁盘不变、setItem 0 次', () => {
      const store = usePlayerStore()
      embedRuneIn(store, 'weapon', 'r1', { type: 'attack', statValue: 100, level: 1, exp: 0 })
      store.saveGame()
      const baselineDisk = JSON.parse(JSON.stringify(readDisk()))
      // 把 inventory 替换为元素 getter 抛异常的 Proxy 数组
      store.runeInventory = throwingProxyArray() as unknown as Rune[]
      // 使用可靠的计数 storage（vi.spyOn 无法拦截 store 内部持有的全局 localStorage 引用）
      const counter = installCountingStorage()
      let threw = false
      let res: RuneExperienceTransactionResult | undefined
      try {
        res = store.tryAddRuneExperience('r1', 22)
      } catch {
        threw = true
      }
      expect(threw).toBe(false)
      expect(res?.ok).toBe(false)
      expect(res?.levelsGained).toBe(0)
      // 装备拓扑未变
      expect(store.player.equipment.weapon?.runeSlots[0].runeId).toBe('r1')
      // 磁盘字节未变
      expect(readDisk()).toEqual(baselineDisk)
      // setItem 0 次（零写盘）
      expect(counter.count).toBe(0)
    })
  })
})
