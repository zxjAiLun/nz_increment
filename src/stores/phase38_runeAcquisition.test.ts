import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { usePlayerStore, type RuneAcquisitionResult } from './playerStore'
import { useRuneStore } from './runeStore'
import type { Rune } from './runeStore'
import {
  RUNE_GENERATION_TYPES,
  RUNE_GENERATION_RARITY_THRESHOLDS,
  RUNE_BASE_STAT_VALUES,
  RUNE_RARITY_MULTIPLIERS,
  planRuneGeneration,
  planRuneAcquisition
} from '../utils/runeGeneration'
import { validateRune, createEmptyEquipmentRuneSlots } from '../utils/equipmentRunes'
import { validateRuneProgressionState } from '../utils/runeExperience'
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

/** 构造合法动态 Rune。 */
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
  opts?: { runeSlots?: RuneSlot[]; statsAttack?: number; level?: number }
): Equipment {
  return {
    id,
    slot,
    name: id,
    rarity: 'common',
    level: opts?.level ?? 10,
    stats: [{ type: 'attack', value: opts?.statsAttack ?? 100, isPercent: false }],
    isLocked: false,
    affixes: [],
    refiningSlots: [],
    refiningLevel: 0,
    runeSlots: opts?.runeSlots ?? createEmptyEquipmentRuneSlots()
  }
}

/**
 * 顺序化假 RNG：按数组依次弹出，并记录调用次数与顺序。
 * 用于锁定 type roll → rarity roll → suffix roll 的顺序与消费次数。
 */
function seqRng(values: number[]) {
  const state = { calls: 0, order: [] as number[] }
  const rng = () => {
    const v = values[state.calls]
    state.order.push(v)
    state.calls++
    return v
  }
  return { rng, state }
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
// Section 1 — 常量单一来源（只读冻结）
// =====================================================================
describe('Phase 3.8 — Section 1 常量单一来源（冻结）', () => {
  it('RUNE_GENERATION_TYPES 顺序锁定且冻结', () => {
    expect(RUNE_GENERATION_TYPES).toEqual(['attack', 'defense', 'health', 'crit', 'speed', 'luck'])
    expect(Object.isFrozen(RUNE_GENERATION_TYPES)).toBe(true)
  })

  it('rarity 阈值锁定为 0.60 / 0.85 / 0.97 且冻结', () => {
    expect(RUNE_GENERATION_RARITY_THRESHOLDS).toEqual({ common: 0.6, rare: 0.85, epic: 0.97 })
    expect(Object.isFrozen(RUNE_GENERATION_RARITY_THRESHOLDS)).toBe(true)
  })

  it('baseStat 唯一来源 attack=10/defense=8/health=50/crit=3/speed=5/luck=5 且冻结', () => {
    expect(RUNE_BASE_STAT_VALUES).toEqual({ attack: 10, defense: 8, health: 50, crit: 3, speed: 5, luck: 5 })
    expect(Object.isFrozen(RUNE_BASE_STAT_VALUES)).toBe(true)
  })

  it('rarity 乘数唯一来源 common=1/rare=1.5/epic=2/legend=3 且冻结', () => {
    expect(RUNE_RARITY_MULTIPLIERS).toEqual({ common: 1, rare: 1.5, epic: 2, legend: 3 })
    expect(Object.isFrozen(RUNE_RARITY_MULTIPLIERS)).toBe(true)
  })
})

// =====================================================================
// Section 2 — planRuneGeneration：type 边界（index = floor(typeRoll × 6)）
// =====================================================================
describe('Phase 3.8 — Section 2 type 边界', () => {
  // rarityRoll 固定 0（common）、suffixRoll 固定 0.5，仅变 typeRoll。
  const cases: Array<[number, string]> = [
    [0, 'attack'],
    [0.05, 'attack'],
    [1 / 6 + 0.001, 'defense'],
    [0.2, 'defense'],
    [2 / 6 + 0.001, 'health'],
    [0.4, 'health'],
    [3 / 6 + 0.001, 'crit'],
    [0.55, 'crit'],
    [4 / 6 + 0.001, 'speed'],
    [0.7, 'speed'],
    [5 / 6 + 0.001, 'luck'],
    [0.9, 'luck'],
    [0.999999, 'luck']
  ]
  for (const [roll, type] of cases) {
    it(`typeRoll=${roll} → ${type}`, () => {
      const { rng } = seqRng([roll, 0, 0.5])
      const plan = planRuneGeneration(rng, 1000)
      expect(plan.ok).toBe(true)
      if (plan.ok) expect(plan.rune.type).toBe(type)
    })
  }

  it('typeRoll=1（非法 >=1）不派生越界类型而是失败', () => {
    const { rng } = seqRng([1, 0, 0.5])
    const plan = planRuneGeneration(rng, 1000)
    expect(plan.ok).toBe(false)
  })
})

// =====================================================================
// Section 3 — planRuneGeneration：rarity 边界（开区间）
// =====================================================================
describe('Phase 3.8 — Section 3 rarity 边界', () => {
  // typeRoll 固定 0（attack），suffixRoll 固定 0.5，仅变 rarityRoll。
  const cases: Array<[number, string]> = [
    [0, 'common'],
    [0.599999, 'common'],
    [0.6, 'rare'],
    [0.849999, 'rare'],
    [0.85, 'epic'],
    [0.969999, 'epic'],
    [0.97, 'legend'],
    [0.999999, 'legend']
  ]
  for (const [roll, rarity] of cases) {
    it(`rarityRoll=${roll} → ${rarity}`, () => {
      const { rng } = seqRng([0, roll, 0.5])
      const plan = planRuneGeneration(rng, 1000)
      expect(plan.ok).toBe(true)
      if (plan.ok) expect(plan.rune.rarity).toBe(rarity)
    })
  }
})

// =====================================================================
// Section 4 — planRuneGeneration：statValue 固定值 = floor(base × multiplier)
// =====================================================================
describe('Phase 3.8 — Section 4 statValue 固定值', () => {
  // [typeRoll, rarityRoll] → [type, rarity, statValue]
  const cases: Array<[number, number, string, string, number]> = [
    [0, 0, 'attack', 'common', 10], // floor(10*1)
    [1 / 6 + 0.001, 0.6, 'defense', 'rare', 12], // floor(8*1.5)=12
    [2 / 6 + 0.001, 0.85, 'health', 'epic', 100], // floor(50*2)=100
    [3 / 6 + 0.001, 0.97, 'crit', 'legend', 9], // floor(3*3)=9
    [4 / 6 + 0.001, 0.97, 'speed', 'legend', 15], // floor(5*3)=15
    [5 / 6 + 0.001, 0.97, 'luck', 'legend', 15] // floor(5*3)=15
  ]
  for (const [tRoll, rRoll, type, rarity, statValue] of cases) {
    it(`${rarity} ${type} → statValue=${statValue}`, () => {
      const { rng } = seqRng([tRoll, rRoll, 0.5])
      const plan = planRuneGeneration(rng, 1000)
      expect(plan.ok).toBe(true)
      if (plan.ok) {
        expect(plan.rune.type).toBe(type)
        expect(plan.rune.rarity).toBe(rarity)
        expect(plan.rune.statValue).toBe(statValue)
        expect(Number.isInteger(plan.rune.statValue)).toBe(true)
      }
    })
  }

  it('生成 Rune 初始 level=1 / exp=0', () => {
    const { rng } = seqRng([0, 0, 0.5])
    const plan = planRuneGeneration(rng, 1000)
    expect(plan.ok).toBe(true)
    if (plan.ok) {
      expect(plan.rune.level).toBe(1)
      expect(plan.rune.exp).toBe(0)
    }
  })
})

// =====================================================================
// Section 5 — RNG 顺序（type → rarity → suffix）、恰好 3 次、rollsConsumed
// =====================================================================
describe('Phase 3.8 — Section 5 RNG 顺序与次数', () => {
  it('成功生成恰好消费 3 次 RNG，顺序为 type → rarity → suffix', () => {
    // type 由第 1 个值决定（0.9→luck），rarity 由第 2 个值决定（0→common）。
    // 若顺序颠倒，type 将由 0 派生为 attack。
    const { rng, state } = seqRng([0.9, 0, 0.5])
    const plan = planRuneGeneration(rng, 1000)
    expect(plan.ok).toBe(true)
    if (plan.ok) {
      expect(plan.rune.type).toBe('luck') // 证明第 1 次 roll 是 type
      expect(plan.rune.rarity).toBe('common') // 证明第 2 次 roll 是 rarity
      expect(plan.rollsConsumed).toBe(3)
    }
    expect(state.calls).toBe(3)
    expect(state.order).toEqual([0.9, 0, 0.5])
  })

  it('rarity 分支不影响 RNG 次数（legend 仍恰好 3 次）', () => {
    const { rng, state } = seqRng([0, 0.99, 0.5])
    const plan = planRuneGeneration(rng, 1000)
    expect(plan.ok).toBe(true)
    if (plan.ok) expect(plan.rune.rarity).toBe('legend')
    expect(state.calls).toBe(3)
  })
})

// =====================================================================
// Section 6 — ID 格式与 timestamp 语义
// =====================================================================
describe('Phase 3.8 — Section 6 ID 格式与 timestamp', () => {
  it('ID 保持旧格式 rune_<timestamp>_<suffix>', () => {
    const { rng } = seqRng([0, 0, 0.123456])
    const plan = planRuneGeneration(rng, 1700000000000)
    expect(plan.ok).toBe(true)
    if (plan.ok) {
      const expectedSuffix = (0.123456).toString(36).substr(2, 5)
      expect(plan.rune.id).toBe(`rune_1700000000000_${expectedSuffix}`)
      expect(plan.rune.id).toMatch(/^rune_\d+_[0-9a-z]*$/)
    }
  })

  it('同 timestamp + 同 suffixRoll → 同 ID', () => {
    const a = planRuneGeneration(seqRng([0, 0, 0.42]).rng, 999)
    const b = planRuneGeneration(seqRng([0, 0, 0.42]).rng, 999)
    expect(a.ok && b.ok).toBe(true)
    if (a.ok && b.ok) expect(a.rune.id).toBe(b.rune.id)
  })

  it('不同 suffixRoll → 不同 ID', () => {
    const a = planRuneGeneration(seqRng([0, 0, 0.42]).rng, 999)
    const b = planRuneGeneration(seqRng([0, 0, 0.77]).rng, 999)
    expect(a.ok && b.ok).toBe(true)
    if (a.ok && b.ok) expect(a.rune.id).not.toBe(b.rune.id)
  })

  it('timestamp 不属于 RNG 消费（仅 3 次 RNG）', () => {
    const { rng, state } = seqRng([0, 0, 0.5])
    planRuneGeneration(rng, 1234567890)
    expect(state.calls).toBe(3)
  })
})

// =====================================================================
// Section 7 — planRuneGeneration 非法路径（不抛、不返回部分 Rune、rollsConsumed）
// =====================================================================
describe('Phase 3.8 — Section 7 生成非法路径', () => {
  it('rng 非函数 → 失败、rollsConsumed=0、不抛', () => {
    expect(() => planRuneGeneration(123 as unknown, 1000)).not.toThrow()
    const plan = planRuneGeneration(123 as unknown, 1000)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.rollsConsumed).toBe(0)
  })

  it('timestamp 非有限正整数 → 失败、rollsConsumed=0（消费 RNG 前校验）', () => {
    const invalidTs = [0, -1, 1.5, NaN, Infinity, -Infinity, '1000' as unknown, null, undefined]
    for (const ts of invalidTs) {
      const { rng, state } = seqRng([0, 0, 0.5])
      const plan = planRuneGeneration(rng, ts)
      expect(plan.ok).toBe(false)
      if (!plan.ok) expect(plan.rollsConsumed).toBe(0)
      expect(state.calls).toBe(0) // 未消费任何 RNG
    }
  })

  it('type roll 非法（NaN/Infinity/负/>=1）→ 失败、rollsConsumed=1、不返回部分 Rune', () => {
    for (const bad of [NaN, Infinity, -0.1, 1, 1.5]) {
      const { rng } = seqRng([bad, 0, 0.5])
      const plan = planRuneGeneration(rng, 1000)
      expect(plan.ok).toBe(false)
      if (!plan.ok) {
        expect(plan.rollsConsumed).toBe(1)
        expect((plan as { rune?: unknown }).rune).toBeUndefined()
      }
    }
  })

  it('rarity roll 非法 → 失败、rollsConsumed=2', () => {
    const { rng } = seqRng([0, NaN, 0.5])
    const plan = planRuneGeneration(rng, 1000)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.rollsConsumed).toBe(2)
  })

  it('suffix roll 非法 → 失败、rollsConsumed=3', () => {
    const { rng } = seqRng([0, 0, Infinity])
    const plan = planRuneGeneration(rng, 1000)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.rollsConsumed).toBe(3)
  })

  it('rng 抛异常 → 失败、不向外抛', () => {
    const rng = () => {
      throw new Error('rng exploded')
    }
    expect(() => planRuneGeneration(rng, 1000)).not.toThrow()
    expect(planRuneGeneration(rng, 1000).ok).toBe(false)
  })

  it('rng 返回非 number（字符串）→ 失败', () => {
    const rng = (() => '0.5') as unknown as () => number
    expect(planRuneGeneration(rng, 1000).ok).toBe(false)
  })
})

// =====================================================================
// Section 8 — runeStore.generateRune 委托 + 旧行为未回归
// =====================================================================
describe('Phase 3.8 — Section 8 generateRune 委托', () => {
  it('无参数调用恰好消费 3 次 Math.random，顺序 type → rarity → 后缀', () => {
    const rs = useRuneStore()
    const spy = vi.spyOn(Math, 'random')
    spy.mockReturnValueOnce(0.9) // type → luck
    spy.mockReturnValueOnce(0) // rarity → common
    spy.mockReturnValueOnce(0.5) // suffix
    const rune = rs.generateRune()
    expect(rune).not.toBeNull()
    expect(rune!.type).toBe('luck')
    expect(rune!.rarity).toBe('common')
    expect(spy).toHaveBeenCalledTimes(3)
  })

  it('生成结果通过 validateRune / validateRuneProgressionState', () => {
    const rs = useRuneStore()
    const rune = rs.generateRune()!
    expect(validateRune(rune).ok).toBe(true)
    expect(validateRuneProgressionState(rune).ok).toBe(true)
    expect(rune.level).toBe(1)
    expect(rune.exp).toBe(0)
  })

  it('可注入 rng 与 timestamp 得到确定性结果', () => {
    const rs = useRuneStore()
    const { rng } = seqRng([0, 0, 0.5])
    const rune = rs.generateRune(rng, 555)!
    expect(rune.id.startsWith('rune_555_')).toBe(true)
    expect(rune.type).toBe('attack')
    expect(rune.rarity).toBe('common')
    expect(rune.statValue).toBe(10)
  })

  it('显式 timestamp 时不读取 Date.now', () => {
    const rs = useRuneStore()
    const dateSpy = vi.spyOn(Date, 'now')
    rs.generateRune(seqRng([0, 0, 0.5]).rng, 777)
    expect(dateSpy).not.toHaveBeenCalled()
  })

  it('timestamp 缺失时读取 Date.now 一次', () => {
    const rs = useRuneStore()
    const dateSpy = vi.spyOn(Date, 'now').mockReturnValue(888)
    const rune = rs.generateRune(seqRng([0, 0, 0.5]).rng)!
    expect(dateSpy).toHaveBeenCalledTimes(1)
    expect(rune.id.startsWith('rune_888_')).toBe(true)
  })

  it('plan 失败（rng 抛）→ 返回 null，不抛', () => {
    const rs = useRuneStore()
    const rng = () => {
      throw new Error('boom')
    }
    expect(() => rs.generateRune(rng)).not.toThrow()
    expect(rs.generateRune(rng)).toBeNull()
  })

  it('Date.now 抛（timestamp 缺失）→ 返回 null，不抛', () => {
    const rs = useRuneStore()
    vi.spyOn(Date, 'now').mockImplementation(() => {
      throw new Error('clock unavailable')
    })
    expect(() => rs.generateRune(seqRng([0, 0, 0.5]).rng)).not.toThrow()
    expect(rs.generateRune(seqRng([0, 0, 0.5]).rng)).toBeNull()
  })
})

// =====================================================================
// Section 9 — planRuneAcquisition 纯规划
// =====================================================================
describe('Phase 3.8 — Section 9 planRuneAcquisition 纯规划', () => {
  it('空 inventory 追加得到长度 1，insertIndex=0', () => {
    const plan = planRuneAcquisition([], makeRune('r1'))
    expect(plan.ok).toBe(true)
    if (plan.ok) {
      expect(plan.nextInventory).toHaveLength(1)
      expect(plan.insertIndex).toBe(0)
      expect(plan.nextInventory[0].id).toBe('r1')
    }
  })

  it('非空 inventory 追加到末尾，原项字节级不变', () => {
    const original = [makeRune('a'), makeRune('b')]
    const snapshot = JSON.parse(JSON.stringify(original))
    const plan = planRuneAcquisition(original, makeRune('c'))
    expect(plan.ok).toBe(true)
    if (plan.ok) {
      expect(plan.nextInventory.map(r => r.id)).toEqual(['a', 'b', 'c'])
      expect(plan.insertIndex).toBe(2)
    }
    // 原 inventory 未被修改
    expect(original).toEqual(snapshot)
  })

  it('padded candidate id 被 canonical 化后追加', () => {
    const plan = planRuneAcquisition([], makeRune('  r1  '))
    expect(plan.ok).toBe(true)
    if (plan.ok) {
      expect(plan.acquiredRune.id).toBe('r1')
      expect(plan.nextInventory[0].id).toBe('r1')
    }
  })

  it('canonical 重复拒绝（inventory 已有同 id）', () => {
    const plan = planRuneAcquisition([makeRune('r1')], makeRune('r1'))
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.reason).toBe('duplicate rune id')
  })

  it('padded-vs-canonical 冲突拒绝（inventory 有 "  r1  " 会被 trim 为 r1；candidate "r1"）', () => {
    // inventory 内 id 经 validateRuneInventory 后为 canonical；此处直接以已 canonical 的项校验冲突
    const plan = planRuneAcquisition([makeRune('r1')], makeRune('  r1  '))
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.reason).toBe('duplicate rune id')
  })

  it('malformed candidate 拒绝，不抛', () => {
    expect(() => planRuneAcquisition([], { id: '' } as unknown)).not.toThrow()
    expect(planRuneAcquisition([], { id: '' } as unknown).ok).toBe(false)
    expect(planRuneAcquisition([], null).ok).toBe(false)
    expect(planRuneAcquisition([], makeRune('r1', { level: 0 })).ok).toBe(false)
  })

  it('malformed inventory 拒绝，不抛', () => {
    expect(() => planRuneAcquisition('nope' as unknown, makeRune('r1'))).not.toThrow()
    expect(planRuneAcquisition('nope' as unknown, makeRune('r1')).ok).toBe(false)
    // inventory 含重复 id → 失败
    expect(planRuneAcquisition([makeRune('x'), makeRune('x')], makeRune('r1')).ok).toBe(false)
  })

  it('不调用 RNG（Math.random 未被触发）', () => {
    const spy = vi.spyOn(Math, 'random')
    planRuneAcquisition([makeRune('a')], makeRune('b'))
    expect(spy).not.toHaveBeenCalled()
  })
})

// =====================================================================
// Section 10 — playerStore.tryAcquireRune 原子入库（成功路径）
// =====================================================================
describe('Phase 3.8 — Section 10 tryAcquireRune 成功', () => {
  it('空 inventory 入库成功：长度 1、末尾、只写盘一次', () => {
    const store = usePlayerStore()
    const counter = installCountingStorage()
    const res = store.tryAcquireRune(makeRune('r1'))
    expect(res.ok).toBe(true)
    expect(res.insertIndex).toBe(0)
    expect(store.runeInventory.map(r => r.id)).toEqual(['r1'])
    expect(counter.count).toBe(1)
  })

  it('非空 inventory 入库追加末尾、其他项字节级不变', () => {
    const store = usePlayerStore()
    store.runeInventory.push(makeRune('a', { statValue: 10 }))
    store.runeInventory.push(makeRune('b', { statValue: 12, rarity: 'rare' }))
    const before = JSON.parse(JSON.stringify(store.runeInventory))
    const res = store.tryAcquireRune(makeRune('c', { type: 'luck' }))
    expect(res.ok).toBe(true)
    expect(store.runeInventory.map(r => r.id)).toEqual(['a', 'b', 'c'])
    expect(store.runeInventory.slice(0, 2)).toEqual(before)
  })

  it('padded candidate 入库被 canonical 化', () => {
    const store = usePlayerStore()
    const res = store.tryAcquireRune(makeRune('  r1  '))
    expect(res.ok).toBe(true)
    expect(store.runeInventory[0].id).toBe('r1')
    expect(res.rune?.id).toBe('r1')
  })

  it('canonical 重复拒绝，零修改零写盘', () => {
    const store = usePlayerStore()
    store.runeInventory.push(makeRune('r1'))
    store.saveGame()
    const counter = installCountingStorage()
    const res = store.tryAcquireRune(makeRune('r1'))
    expect(res.ok).toBe(false)
    expect(store.runeInventory.map(r => r.id)).toEqual(['r1'])
    expect(counter.count).toBe(0)
  })

  it('malformed candidate 拒绝，不抛、零写盘', () => {
    const store = usePlayerStore()
    const counter = installCountingStorage()
    let threw = false
    let res: RuneAcquisitionResult | undefined
    try {
      res = store.tryAcquireRune({ id: '', type: 'attack' } as unknown)
    } catch {
      threw = true
    }
    expect(threw).toBe(false)
    expect(res?.ok).toBe(false)
    expect(store.runeInventory).toHaveLength(0)
    expect(counter.count).toBe(0)
  })

  it('新获得 Rune 默认未镶嵌：totalStats 不变', () => {
    const store = usePlayerStore()
    store.player.equipment.weapon = makeRuneEquip('weapon', 'weapon', { statsAttack: 100 })
    const before = calculateTotalStats(store.player, undefined, store.runeInventory)
    const res = store.tryAcquireRune(makeRune('r1', { type: 'attack', statValue: 999 }))
    expect(res.ok).toBe(true)
    const after = calculateTotalStats(store.player, undefined, store.runeInventory)
    expect(after).toEqual(before)
  })

  it('入库后刷新（重建 store + loadGame）Rune 仍保留', () => {
    const store = usePlayerStore()
    store.tryAcquireRune(makeRune('r1', { type: 'crit', statValue: 3 }))
    expect(readDisk().runeData.inventory.map((r: Rune) => r.id)).toEqual(['r1'])
    // 重建 pinia 并加载
    setActivePinia(createPinia())
    const store2 = usePlayerStore()
    store2.loadGame()
    expect(store2.runeInventory.map(r => r.id)).toEqual(['r1'])
  })

  it('装备 runeSlots 拓扑在入库后完全不变', () => {
    const store = usePlayerStore()
    store.player.equipment.weapon = makeRuneEquip('weapon', 'weapon')
    const topoBefore = JSON.parse(JSON.stringify(store.player.equipment.weapon.runeSlots))
    store.tryAcquireRune(makeRune('r1'))
    expect(store.player.equipment.weapon.runeSlots).toEqual(topoBefore)
  })
})

// =====================================================================
// Section 11 — tryAcquireRune 回滚（save false / Date.now 抛）
// =====================================================================
describe('Phase 3.8 — Section 11 tryAcquireRune 回滚', () => {
  it('saveGame 返回 false（setItem 抛）→ 完整回滚，inventory 与磁盘不变', () => {
    const store = usePlayerStore()
    store.runeInventory.push(makeRune('a'))
    store.saveGame()
    const baselineDisk = JSON.parse(JSON.stringify(readDisk()))
    installThrowingStorage()
    const res = store.tryAcquireRune(makeRune('b'))
    expect(res.ok).toBe(false)
    // 内存回滚：仅剩 a
    expect(store.runeInventory.map(r => r.id)).toEqual(['a'])
    // 磁盘字节不变
    expect(readDisk()).toEqual(baselineDisk)
  })

  it('save 失败恢复后重试只追加一枚（不重复入库）', () => {
    const store = usePlayerStore()
    store.runeInventory.push(makeRune('a'))
    store.saveGame()
    installThrowingStorage()
    const first = store.tryAcquireRune(makeRune('b'))
    expect(first.ok).toBe(false)
    vi.unstubAllGlobals()
    const second = store.tryAcquireRune(makeRune('b'))
    expect(second.ok).toBe(true)
    expect(store.runeInventory.map(r => r.id)).toEqual(['a', 'b'])
  })

  it('候选已应用但 saveGame 直接抛（Date.now 抛）→ 完整回滚、零写盘、重试只提交一次', () => {
    const store = usePlayerStore()
    store.runeInventory.push(makeRune('a'))
    store.saveGame()
    const baselineInventory = JSON.parse(JSON.stringify(store.runeInventory))
    const baselineDisk = JSON.parse(JSON.stringify(readDisk()))
    const counter = installCountingStorage()
    const dateSpy = vi.spyOn(Date, 'now').mockImplementation(() => {
      throw new Error('clock unavailable')
    })
    let threw = false
    let res: RuneAcquisitionResult | undefined
    try {
      res = store.tryAcquireRune(makeRune('b'))
    } catch {
      threw = true
    }
    expect(threw).toBe(false)
    expect(res?.ok).toBe(false)
    // 内存完全恢复
    expect(store.runeInventory).toEqual(baselineInventory)
    expect(store.runeInventory.map(r => r.id)).toEqual(['a'])
    // 磁盘原字节不变、零写盘
    expect(readDisk()).toEqual(baselineDisk)
    expect(counter.count).toBe(0)
    // 恢复时钟后重试只提交一次
    dateSpy.mockRestore()
    const retry = store.tryAcquireRune(makeRune('b'))
    expect(retry.ok).toBe(true)
    expect(store.runeInventory.map(r => r.id)).toEqual(['a', 'b'])
    expect(counter.count).toBe(1)
  })
})

// =====================================================================
// Section 12 — tryGenerateAndAcquireRune（生成并入库）
// =====================================================================
describe('Phase 3.8 — Section 12 tryGenerateAndAcquireRune', () => {
  it('可注入 rng + timestamp 成功生成并入库一枚', () => {
    const store = usePlayerStore()
    const counter = installCountingStorage()
    const res = store.tryGenerateAndAcquireRune(seqRng([0, 0, 0.5]).rng, 1000)
    expect(res.ok).toBe(true)
    expect(store.runeInventory).toHaveLength(1)
    expect(store.runeInventory[0].id.startsWith('rune_1000_')).toBe(true)
    expect(store.runeInventory[0].type).toBe('attack')
    expect(store.runeInventory[0].statValue).toBe(10)
    expect(counter.count).toBe(1)
  })

  it('生成失败（rng 抛）→ 事务失败、inventory 空、零写盘', () => {
    const store = usePlayerStore()
    const counter = installCountingStorage()
    const rng = () => {
      throw new Error('boom')
    }
    const res = store.tryGenerateAndAcquireRune(rng, 1000)
    expect(res.ok).toBe(false)
    expect(store.runeInventory).toHaveLength(0)
    expect(counter.count).toBe(0)
  })

  it('timestamp 缺失时 Date.now 抛 → 失败、RNG 0 次、inventory 空、零写盘', () => {
    const store = usePlayerStore()
    const counter = installCountingStorage()
    const { rng, state } = seqRng([0, 0, 0.5])
    vi.spyOn(Date, 'now').mockImplementation(() => {
      throw new Error('clock unavailable')
    })
    let threw = false
    let res: RuneAcquisitionResult | undefined
    try {
      res = store.tryGenerateAndAcquireRune(rng)
    } catch {
      threw = true
    }
    expect(threw).toBe(false)
    expect(res?.ok).toBe(false)
    expect(state.calls).toBe(0) // Date.now 抛在 planRuneGeneration 之前，RNG 未被调用
    expect(store.runeInventory).toHaveLength(0)
    expect(counter.count).toBe(0)
  })

  it('生成 ID 与既有 canonical ID 冲突 → 入库拒绝、不重 roll、只保留原一枚', () => {
    const store = usePlayerStore()
    // 先用固定 ts + suffix 生成入库一枚
    store.tryGenerateAndAcquireRune(seqRng([0, 0, 0.5]).rng, 1000)
    const existingId = store.runeInventory[0].id
    const counter = installCountingStorage()
    // 相同 ts + 相同 suffix → 相同 ID → 冲突拒绝
    const res = store.tryGenerateAndAcquireRune(seqRng([0, 0, 0.5]).rng, 1000)
    expect(res.ok).toBe(false)
    expect(store.runeInventory).toHaveLength(1)
    expect(store.runeInventory[0].id).toBe(existingId)
    expect(counter.count).toBe(0)
  })

  it('刷新后生成入库的 Rune 仍保留', () => {
    const store = usePlayerStore()
    store.tryGenerateAndAcquireRune(seqRng([0.9, 0.99, 0.5]).rng, 2000)
    const savedId = store.runeInventory[0].id
    setActivePinia(createPinia())
    const store2 = usePlayerStore()
    store2.loadGame()
    expect(store2.runeInventory.map(r => r.id)).toEqual([savedId])
    expect(store2.runeInventory[0].type).toBe('luck')
    expect(store2.runeInventory[0].rarity).toBe('legend')
  })
})

// =====================================================================
// Section 13 — 异常矩阵：malformed inventory / Proxy 不抛、零修改零写盘
// =====================================================================
describe('Phase 3.8 — Section 13 异常矩阵', () => {
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

  it('candidate 字段 getter 抛异常：planRuneAcquisition / tryAcquireRune 不抛且失败', () => {
    const rune = throwingGetterRune('statValue')
    expect(() => planRuneAcquisition([], rune)).not.toThrow()
    expect(planRuneAcquisition([], rune).ok).toBe(false)
    const store = usePlayerStore()
    const counter = installCountingStorage()
    let threw = false
    try {
      store.tryAcquireRune(rune)
    } catch {
      threw = true
    }
    expect(threw).toBe(false)
    expect(store.runeInventory).toHaveLength(0)
    expect(counter.count).toBe(0)
  })

  it('inventory 元素 getter 抛异常：Store 层 tryAcquireRune 不抛、零修改零写盘', () => {
    const store = usePlayerStore()
    store.runeInventory = throwingProxyArray() as unknown as Rune[]
    const counter = installCountingStorage()
    let threw = false
    let res: RuneAcquisitionResult | undefined
    try {
      res = store.tryAcquireRune(makeRune('r1'))
    } catch {
      threw = true
    }
    expect(threw).toBe(false)
    expect(res?.ok).toBe(false)
    expect(counter.count).toBe(0)
  })
})
