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
import {
  planEquipmentRefinement,
  calculateRefiningCost,
  MAX_REFINING_LEVEL,
  MAX_REFINING_SLOTS,
  REFINING_STAT_POOL
} from '../utils/equipmentRefining'
import type { Equipment, EquipmentSlot, RefiningSlot } from '../types'

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

/** 让主存档 setItem 抛错、读取委托真实 storage 的失败注入器（与 Phase 3.2.3/3.4 一致）。 */
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

/** 构造合法精炼装备（双模型 / 基础 stats 完整，精炼字段可配）。 */
function makeRefiningEquip(
  id: string,
  slot: EquipmentSlot,
  opts?: {
    level?: number
    refiningLevel?: number
    refiningSlots?: RefiningSlot[]
    isLocked?: boolean
    statsAttack?: number
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
    refiningSlots: opts?.refiningSlots ?? [],
    refiningLevel: opts?.refiningLevel ?? 0,
    runeSlots: []
  }
}

/** 可追踪 RNG：按序列返回值并记录调用次数。 */
function makeTracingRng(sequence: number[]): { rng: () => number; calls: () => number } {
  let i = 0
  const rng = () => {
    const v = sequence[Math.min(i, sequence.length - 1)]
    i++
    return v
  }
  return { rng, calls: () => i }
}

/** 固定 RNG：始终返回给定值。 */
function fixedRng(value: number): () => number {
  return () => value
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

describe('Phase 3.5 — 纯模块：常量唯一来源与规划', () => {
  it('常量与公式唯一来源（不复制第二份）', () => {
    expect(MAX_REFINING_LEVEL).toBe(15)
    expect(MAX_REFINING_SLOTS).toBe(3)
    expect(calculateRefiningCost(0)).toBe(100) // floor(100 * 1.2^0)
    expect(calculateRefiningCost(1)).toBe(120) // floor(100 * 1.2)
    expect(REFINING_STAT_POOL).toEqual(['attack', 'defense', 'maxHp', 'critRate', 'critDamage', 'lifesteal'])
  })

  it('新增槽位：确定性校验通过后调用 RNG 恰好一次，stat 与 roll 对应、index 递增', () => {
    const equip = makeRefiningEquip('w1', 'weapon', { level: 10, refiningLevel: 0 })
    let calls = 0
    const rng = () => {
      calls++
      return 0.34 // floor(0.34*6)=2 → maxHp
    }
    const plan = planEquipmentRefinement(equip, 1000, rng)
    expect(plan.ok).toBe(true)
    if (!plan.ok) throw new Error('expected ok')
    expect(calls).toBe(1)
    expect(plan.rngCalls).toBe(1)
    expect(plan.nextSlots).toHaveLength(1)
    expect(plan.nextSlots[0].index).toBe(0)
    expect(plan.nextSlots[0].stat).toBe('maxHp')
    expect(plan.nextSlots[0].value).toBe(6) // floor(10*0.5)+1
    expect(plan.nextSlots[0].type).toBe('flat')
    expect(plan.cost).toBe(calculateRefiningCost(0))
  })

  it('强化（3 槽）：不调用 RNG，每个 value 按 floor(value*1.1)，无增长则失败', () => {
    const slots: RefiningSlot[] = [
      { index: 0, stat: 'attack', value: 100, type: 'flat' },
      { index: 1, stat: 'maxHp', value: 50, type: 'flat' },
      { index: 2, stat: 'critRate', value: 20, type: 'flat' }
    ]
    const equip = makeRefiningEquip('w1', 'weapon', { refiningLevel: 5, refiningSlots: slots })
    let calls = 0
    const rng = () => {
      calls++
      return 0
    }
    const plan = planEquipmentRefinement(equip, 1000, rng)
    expect(plan.ok).toBe(true)
    if (!plan.ok) throw new Error('expected ok')
    expect(calls).toBe(0)
    expect(plan.rngCalls).toBe(0)
    expect(plan.nextSlots).toHaveLength(3)
    expect(plan.nextSlots[0].value).toBe(110) // floor(100*1.1)
    expect(plan.nextSlots[1].value).toBe(55) // floor(50*1.1)
    expect(plan.nextSlots[2].value).toBe(22) // floor(20*1.1)
  })

  it('强化但所有槽位 nextValue 不增 → 失败、不收钱', () => {
    const slots: RefiningSlot[] = [
      { index: 0, stat: 'attack', value: 1, type: 'flat' },
      { index: 1, stat: 'maxHp', value: 1, type: 'flat' },
      { index: 2, stat: 'critRate', value: 1, type: 'flat' }
    ]
    const equip = makeRefiningEquip('w1', 'weapon', { refiningLevel: 5, refiningSlots: slots })
    const plan = planEquipmentRefinement(equip, 1000, fixedRng(0))
    expect(plan.ok).toBe(false)
    if (plan.ok) throw new Error('expected fail')
    expect(plan.reason).toBe('no refining slot would strictly improve')
  })

  it('纯规划不修改输入（原数组/对象不变）', () => {
    const equip = makeRefiningEquip('w1', 'weapon', { level: 10, refiningLevel: 0 })
    const snapshotSlots = equip.refiningSlots
    const plan = planEquipmentRefinement(equip, 1000, fixedRng(0))
    expect(plan.ok).toBe(true)
    // 输入装备的 slots 数组与内容均未被改动
    expect(equip.refiningSlots).toBe(snapshotSlots)
    expect(equip.refiningSlots).toHaveLength(0)
    expect(equip.refiningLevel).toBe(0)
  })

  it('RNG 返回 NaN / -0.1 / 1 → 拒绝且不抛异常', () => {
    for (const bad of [NaN, -0.1, 1]) {
      const equip = makeRefiningEquip('w1', 'weapon', { level: 10, refiningLevel: 0 })
      expect(() => planEquipmentRefinement(equip, 1000, fixedRng(bad))).not.toThrow()
      const plan = planEquipmentRefinement(equip, 1000, fixedRng(bad))
      expect(plan.ok).toBe(false)
    }
  })
})

describe('Phase 3.5 — 原子事务 tryRefineEquipment + 旧扣钱漏洞回归', () => {
  const slot: EquipmentSlot = 'weapon'

  it('gold=cost（100）旧漏洞：成功，gold 100→0，level 0→1，新增恰好一个槽位，内存与磁盘一致', () => {
    const store = usePlayerStore()
    store.player.gold = 100
    store.player.equipment[slot] = makeRefiningEquip('w1', slot, { level: 10, refiningLevel: 0 })

    const res = store.tryRefineEquipment(slot, fixedRng(0)) // roll 0 → attack
    expect(res.ok).toBe(true)
    expect(res.cost).toBe(100)
    expect(res.level).toBe(1)

    expect(store.player.gold).toBe(0)
    const eq = store.player.equipment[slot]!
    expect(eq.refiningLevel).toBe(1)
    expect(eq.refiningSlots).toHaveLength(1)
    expect(eq.refiningSlots[0].index).toBe(0)
    expect(eq.refiningSlots[0].stat).toBe('attack')
    expect(eq.refiningSlots[0].value).toBe(6)

    const disk = readDisk()
    expect(disk.player.equipment[slot].refiningLevel).toBe(1)
    expect(disk.player.equipment[slot].refiningSlots).toHaveLength(1)
    expect(disk.player.equipment[slot].refiningSlots[0].value).toBe(6)
  })

  it('gold=99 → 失败且金币不变', () => {
    const store = usePlayerStore()
    store.player.gold = 99
    store.player.equipment[slot] = makeRefiningEquip('w1', slot, { refiningLevel: 0 })
    const res = store.tryRefineEquipment(slot, fixedRng(0))
    expect(res.ok).toBe(false)
    expect(store.player.gold).toBe(99)
    expect(store.player.equipment[slot]!.refiningLevel).toBe(0)
    expect(store.player.equipment[slot]!.refiningSlots).toHaveLength(0)
  })

  it('gold=101 → 成功且剩余 1', () => {
    const store = usePlayerStore()
    store.player.gold = 101
    store.player.equipment[slot] = makeRefiningEquip('w1', slot, { refiningLevel: 0 })
    const res = store.tryRefineEquipment(slot, fixedRng(0))
    expect(res.ok).toBe(true)
    expect(store.player.gold).toBe(1)
  })

  it('连续 10 次金币不足尝试：零扣款、零装备变化、零存档写入', () => {
    const store = usePlayerStore()
    store.player.gold = 50 // < cost 100
    store.player.equipment[slot] = makeRefiningEquip('w1', slot, { refiningLevel: 0 })
    for (let i = 0; i < 10; i++) {
      const res = store.tryRefineEquipment(slot, fixedRng(0))
      expect(res.ok).toBe(false)
    }
    expect(store.player.gold).toBe(50)
    expect(store.player.equipment[slot]!.refiningLevel).toBe(0)
    expect(store.player.equipment[slot]!.refiningSlots).toHaveLength(0)
    // 失败路径不写盘
    expect(readDisk()).toBeNull()
  })
})

describe('Phase 3.5 — 前三次精炼 RNG 调用次数与槽位结果', () => {
  const slot: EquipmentSlot = 'weapon'

  it('0→1→2→3 槽：每次 RNG 恰好 1 次，index 0/1/2，第 4 次强化不调用 RNG', () => {
    const store = usePlayerStore()
    store.player.gold = 100000
    store.player.equipment[slot] = makeRefiningEquip('w1', slot, { level: 20, refiningLevel: 0 })

    // roll: 0 → attack(idx0), 0.34 → maxHp(idx2), 0.84 → lifesteal(idx5)
    const tracer = makeTracingRng([0.0, 0.34, 0.84])
    const expectedStats = ['attack', 'maxHp', 'lifesteal']

    for (let step = 0; step < 3; step++) {
      const before = tracer.calls()
      const res = store.tryRefineEquipment(slot, tracer.rng)
      expect(res.ok).toBe(true)
      expect(tracer.calls() - before).toBe(1) // 每次新增恰好调用 1 次 RNG
      const eq = store.player.equipment[slot]!
      expect(eq.refiningSlots).toHaveLength(step + 1)
      expect(eq.refiningSlots[step].index).toBe(step)
      expect(eq.refiningSlots[step].stat).toBe(expectedStats[step])
      expect(eq.refiningSlots[step].value).toBe(11) // floor(20*0.5)+1
      expect(eq.refiningLevel).toBe(step + 1)
    }

    // 第 4 次：已有 3 槽，进入强化，不得调用 RNG
    const before4 = tracer.calls()
    const res4 = store.tryRefineEquipment(slot, tracer.rng)
    expect(res4.ok).toBe(true)
    expect(tracer.calls() - before4).toBe(0)
    const eq = store.player.equipment[slot]!
    expect(eq.refiningSlots).toHaveLength(3)
    // 每个槽位按 floor(value*1.1) 强化一次：11 → 12
    expect(eq.refiningSlots[0].value).toBe(12)
    expect(eq.refiningSlots[1].value).toBe(12)
    expect(eq.refiningSlots[2].value).toBe(12)
    expect(eq.refiningLevel).toBe(4)

    // 磁盘持久化
    const disk = readDisk()
    expect(disk.player.equipment[slot].refiningLevel).toBe(4)
    expect(disk.player.equipment[slot].refiningSlots).toHaveLength(3)
  })
})

describe('Phase 3.5 — 三槽后强化', () => {
  const slot: EquipmentSlot = 'weapon'

  it('强化成功：RNG=0 次、长度仍 3、value 按 floor(value*1.1)、金币只扣一次', () => {
    const store = usePlayerStore()
    store.player.gold = 100000
    const slots: RefiningSlot[] = [
      { index: 0, stat: 'attack', value: 100, type: 'flat' },
      { index: 1, stat: 'maxHp', value: 50, type: 'flat' },
      { index: 2, stat: 'critRate', value: 20, type: 'flat' }
    ]
    store.player.equipment[slot] = makeRefiningEquip('w1', slot, { refiningLevel: 5, refiningSlots: slots })

    let calls = 0
    const rng = () => {
      calls++
      return 0
    }
    const res = store.tryRefineEquipment(slot, rng)
    expect(res.ok).toBe(true)
    expect(calls).toBe(0)
    const eq = store.player.equipment[slot]!
    expect(eq.refiningSlots).toHaveLength(3)
    expect(eq.refiningSlots[0].value).toBe(110)
    expect(eq.refiningSlots[1].value).toBe(55)
    expect(eq.refiningSlots[2].value).toBe(22)
    expect(eq.refiningLevel).toBe(6)
    expect(store.player.gold).toBe(100000 - calculateRefiningCost(5))
    const disk = readDisk()
    expect(disk.player.equipment[slot].refiningSlots[0].value).toBe(110)
  })

  it('三槽 value 全部太小（=1）导致无增长：返回失败、不扣金币、level/slots/磁盘不变', () => {
    const store = usePlayerStore()
    store.player.gold = 100000
    const slots: RefiningSlot[] = [
      { index: 0, stat: 'attack', value: 1, type: 'flat' },
      { index: 1, stat: 'maxHp', value: 1, type: 'flat' },
      { index: 2, stat: 'critRate', value: 1, type: 'flat' }
    ]
    store.player.equipment[slot] = makeRefiningEquip('w1', slot, { refiningLevel: 5, refiningSlots: slots })
    const beforeGold = store.player.gold
    const res = store.tryRefineEquipment(slot, fixedRng(0))
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('expected fail')
    expect(store.player.gold).toBe(beforeGold)
    const eq = store.player.equipment[slot]!
    expect(eq.refiningLevel).toBe(5)
    expect(eq.refiningSlots).toHaveLength(3)
    expect(eq.refiningSlots[0].value).toBe(1)
    expect(readDisk()).toBeNull()
  })
})

describe('Phase 3.5 — 精炼属性真实进入 totalStats', () => {
  const slot: EquipmentSlot = 'weapon'

  it('attack / maxHp / critRate / lifesteal 精炼槽位精确增加对应属性', () => {
    for (const stat of ['attack', 'maxHp', 'critRate', 'lifesteal'] as const) {
      const store = usePlayerStore()
      store.player.equipment[slot] = makeRefiningEquip('w1', slot, { refiningLevel: 5 })
      const without = store.totalStats[stat]
      store.player.equipment[slot]!.refiningSlots = [
        { index: 0, stat, value: 5, type: 'flat' }
      ]
      const withBonus = store.totalStats[stat]
      expect(withBonus - without).toBeCloseTo(5, 9) // 精确增加，不翻倍、不重复
    }
  })

  it('基础 equipment.stats 未被偷偷改写', () => {
    const store = usePlayerStore()
    store.player.equipment[slot] = makeRefiningEquip('w1', slot, { refiningLevel: 5, statsAttack: 100 })
    store.player.equipment[slot]!.refiningSlots = [
      { index: 0, stat: 'attack', value: 5, type: 'flat' }
    ]
    expect(store.player.equipment[slot]!.stats[0].value).toBe(100)
  })

  it('两个相同 attack 精炼槽位：两个 value 相加一次（不得只取第一个、不得重复两轮）', () => {
    const store = usePlayerStore()
    store.player.equipment[slot] = makeRefiningEquip('w1', slot, { refiningLevel: 5 })
    const without = store.totalStats.attack
    store.player.equipment[slot]!.refiningSlots = [
      { index: 0, stat: 'attack', value: 5, type: 'flat' },
      { index: 1, stat: 'attack', value: 5, type: 'flat' }
    ]
    const withBonus = store.totalStats.attack
    expect(withBonus - without).toBeCloseTo(10, 9) // 5 + 5
  })

  it('刷新 loadGame 后精炼属性仍生效', () => {
    setActivePinia(createPinia())
    warmupStores()
    const store = usePlayerStore()
    store.player.equipment[slot] = makeRefiningEquip('w1', slot, { refiningLevel: 5 })
    store.player.equipment[slot]!.refiningSlots = [
      { index: 0, stat: 'attack', value: 7, type: 'flat' }
    ]
    store.saveGame()

    setActivePinia(createPinia())
    warmupStores()
    const store2 = usePlayerStore()
    store2.loadGame()
    const without = store2.totalStats.attack
    store2.player.equipment[slot]!.refiningSlots = [] // 移除对比
    const base = store2.totalStats.attack
    expect(without - base).toBeCloseTo(7, 9)
  })
})

describe('Phase 3.5 — 保存失败完整回滚与恢复重试', () => {
  const slot: EquipmentSlot = 'weapon'

  it('新增第一个精炼槽位时保存失败：gold/level/slots 完整回滚、磁盘不变，恢复后重试只提交一次', () => {
    const store = usePlayerStore()
    store.player.gold = 100000
    store.player.equipment[slot] = makeRefiningEquip('w1', slot, { level: 10, refiningLevel: 0 })
    store.saveGame() // 基准盘

    installThrowingStorage()
    const res = store.tryRefineEquipment(slot, fixedRng(0))
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('save failed')

    // 内存完整回滚
    expect(store.player.gold).toBe(100000)
    const eq = store.player.equipment[slot]!
    expect(eq.refiningLevel).toBe(0)
    expect(eq.refiningSlots).toHaveLength(0)

    // 磁盘不变
    vi.unstubAllGlobals()
    const disk = readDisk()
    expect(disk.player.equipment[slot].refiningLevel).toBe(0)
    expect(disk.player.equipment[slot].refiningSlots).toHaveLength(0)

    // 恢复后重试仅提交一次
    const res2 = store.tryRefineEquipment(slot, fixedRng(0))
    expect(res2.ok).toBe(true)
    expect(store.player.gold).toBe(100000 - 100)
    expect(store.player.equipment[slot]!.refiningLevel).toBe(1)
    expect(store.player.equipment[slot]!.refiningSlots).toHaveLength(1)
  })

  it('已有三个槽位强化时保存失败：完整回滚、磁盘不变，恢复后重试只强化一次', () => {
    const store = usePlayerStore()
    store.player.gold = 100000
    const slots: RefiningSlot[] = [
      { index: 0, stat: 'attack', value: 100, type: 'flat' },
      { index: 1, stat: 'maxHp', value: 50, type: 'flat' },
      { index: 2, stat: 'critRate', value: 20, type: 'flat' }
    ]
    store.player.equipment[slot] = makeRefiningEquip('w1', slot, { refiningLevel: 5, refiningSlots: slots })
    store.saveGame() // 基准盘

    installThrowingStorage()
    const res = store.tryRefineEquipment(slot, fixedRng(0))
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('save failed')

    expect(store.player.gold).toBe(100000)
    const eq = store.player.equipment[slot]!
    expect(eq.refiningLevel).toBe(5)
    expect(eq.refiningSlots[0].value).toBe(100)
    expect(eq.refiningSlots[1].value).toBe(50)
    expect(eq.refiningSlots[2].value).toBe(20)

    vi.unstubAllGlobals()
    const disk = readDisk()
    expect(disk.player.equipment[slot].refiningLevel).toBe(5)
    expect(disk.player.equipment[slot].refiningSlots[0].value).toBe(100)

    const before = store.player.gold
    const res2 = store.tryRefineEquipment(slot, fixedRng(0))
    expect(res2.ok).toBe(true)
    expect(store.player.gold).toBe(before - calculateRefiningCost(5))
    expect(store.player.equipment[slot]!.refiningSlots[0].value).toBe(110)
    expect(store.player.equipment[slot]!.refiningLevel).toBe(6)
  })
})

describe('Phase 3.5 — 损坏状态拒绝矩阵', () => {
  const slot: EquipmentSlot = 'weapon'

  function expectRejectNoSideEffect(make: () => Equipment, gold: number, rng?: () => number) {
    const store = usePlayerStore()
    store.player.gold = gold
    const eq = make()
    store.player.equipment[slot] = eq

    const goldBefore = store.player.gold
    const lvlBefore = eq.refiningLevel
    const slotsBefore = eq.refiningSlots

    const res = store.tryRefineEquipment(slot, rng ?? fixedRng(0))
    expect(res.ok).toBe(false)

    // 零扣款 / 零装备变化
    expect(store.player.gold).toBe(goldBefore)
    expect(eq.refiningLevel).toBe(lvlBefore)
    if (Array.isArray(slotsBefore)) {
      expect(eq.refiningSlots).toHaveLength(slotsBefore.length)
      for (let i = 0; i < slotsBefore.length; i++) {
        expect(eq.refiningSlots[i].value).toBe(slotsBefore[i].value)
        expect(eq.refiningSlots[i].stat).toBe(slotsBefore[i].stat)
      }
    } else {
      // 非数组损坏：引用保持原样（不猜测、不改写）
      expect(eq.refiningSlots).toBe(slotsBefore)
    }
    // 零存档写入
    expect(readDisk()).toBeNull()
  }

  it('refiningLevel = NaN', () => {
    expectRejectNoSideEffect(() => makeRefiningEquip('w1', slot, { refiningLevel: NaN as unknown as number }), 100000)
  })
  it('refiningLevel = Infinity', () => {
    expectRejectNoSideEffect(() => makeRefiningEquip('w1', slot, { refiningLevel: Infinity }), 100000)
  })
  it('refiningLevel = -1', () => {
    expectRejectNoSideEffect(() => makeRefiningEquip('w1', slot, { refiningLevel: -1 }), 100000)
  })
  it('refiningLevel = 1.5', () => {
    expectRejectNoSideEffect(() => makeRefiningEquip('w1', slot, { refiningLevel: 1.5 }), 100000)
  })
  it('refiningLevel > 15 (16)', () => {
    expectRejectNoSideEffect(() => makeRefiningEquip('w1', slot, { refiningLevel: 16 }), 100000)
  })
  it('refiningSlots 非数组', () => {
    const eq = makeRefiningEquip('w1', slot, { refiningLevel: 0 }) as unknown as Record<string, unknown>
    eq.refiningSlots = 'oops'
    expectRejectNoSideEffect(() => eq as unknown as Equipment, 100000)
  })
  it('refiningSlots 超过 3 个', () => {
    const slots: RefiningSlot[] = [
      { index: 0, stat: 'attack', value: 1, type: 'flat' },
      { index: 1, stat: 'maxHp', value: 1, type: 'flat' },
      { index: 2, stat: 'critRate', value: 1, type: 'flat' },
      { index: 3, stat: 'defense', value: 1, type: 'flat' }
    ]
    expectRejectNoSideEffect(() => makeRefiningEquip('w1', slot, { refiningLevel: 0, refiningSlots: slots }), 100000)
  })
  it('重复 index', () => {
    const slots: RefiningSlot[] = [
      { index: 0, stat: 'attack', value: 1, type: 'flat' },
      { index: 0, stat: 'maxHp', value: 1, type: 'flat' }
    ]
    expectRejectNoSideEffect(() => makeRefiningEquip('w1', slot, { refiningLevel: 0, refiningSlots: slots }), 100000)
  })
  it('index 不连续', () => {
    const slots: RefiningSlot[] = [
      { index: 0, stat: 'attack', value: 1, type: 'flat' },
      { index: 2, stat: 'maxHp', value: 1, type: 'flat' }
    ]
    expectRejectNoSideEffect(() => makeRefiningEquip('w1', slot, { refiningLevel: 0, refiningSlots: slots }), 100000)
  })
  it('非法 stat（speed 不在精炼池）', () => {
    const slots: RefiningSlot[] = [{ index: 0, stat: 'speed', value: 1, type: 'flat' }]
    expectRejectNoSideEffect(() => makeRefiningEquip('w1', slot, { refiningLevel: 0, refiningSlots: slots }), 100000)
  })
  it('value = NaN', () => {
    const slots: RefiningSlot[] = [{ index: 0, stat: 'attack', value: NaN as unknown as number, type: 'flat' }]
    expectRejectNoSideEffect(() => makeRefiningEquip('w1', slot, { refiningLevel: 0, refiningSlots: slots }), 100000)
  })
  it('value = Infinity', () => {
    const slots: RefiningSlot[] = [{ index: 0, stat: 'attack', value: Infinity, type: 'flat' }]
    expectRejectNoSideEffect(() => makeRefiningEquip('w1', slot, { refiningLevel: 0, refiningSlots: slots }), 100000)
  })
  it('value < 0', () => {
    const slots: RefiningSlot[] = [{ index: 0, stat: 'attack', value: -5, type: 'flat' }]
    expectRejectNoSideEffect(() => makeRefiningEquip('w1', slot, { refiningLevel: 0, refiningSlots: slots }), 100000)
  })
  it('value 非整数', () => {
    const slots: RefiningSlot[] = [{ index: 0, stat: 'attack', value: 5.5, type: 'flat' }]
    expectRejectNoSideEffect(() => makeRefiningEquip('w1', slot, { refiningLevel: 0, refiningSlots: slots }), 100000)
  })
  it('type 非 flat', () => {
    const slots: RefiningSlot[] = [{ index: 0, stat: 'attack', value: 5, type: 'percent' } as unknown as RefiningSlot]
    expectRejectNoSideEffect(() => makeRefiningEquip('w1', slot, { refiningLevel: 0, refiningSlots: slots }), 100000)
  })
  it('player.gold 非有限（NaN）', () => {
    expectRejectNoSideEffect(() => makeRefiningEquip('w1', slot, { refiningLevel: 0 }), NaN)
  })
  it('player.gold 负数', () => {
    expectRejectNoSideEffect(() => makeRefiningEquip('w1', slot, { refiningLevel: 0 }), -1)
  })
  it('RNG 返回 NaN', () => {
    expectRejectNoSideEffect(() => makeRefiningEquip('w1', slot, { level: 10, refiningLevel: 0 }), 100000, fixedRng(NaN))
  })
  it('RNG 返回 -0.1', () => {
    expectRejectNoSideEffect(() => makeRefiningEquip('w1', slot, { level: 10, refiningLevel: 0 }), 100000, fixedRng(-0.1))
  })
  it('RNG 返回 1', () => {
    expectRejectNoSideEffect(() => makeRefiningEquip('w1', slot, { level: 10, refiningLevel: 0 }), 100000, fixedRng(1))
  })
})
