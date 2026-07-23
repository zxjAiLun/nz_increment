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
import { calculateEquipmentScore } from '../utils/calc'
import { planEquipmentAffixUpgrade, calculateUpgradeCost } from '../utils/equipmentAffixUpgrade'
import type { Equipment, EquipmentSlot, Rarity, StatAffix } from '../types'

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

/** 让主存档 setItem 抛错、读取委托真实 storage 的失败注入器（与 Phase 3.2.3 一致）。 */
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

/** 构造带可升级 attack 词缀的合法装备（affix.value 与 stats.value 一致，双模型无分叉）。 */
function makeAffixEquip(
  id: string,
  slot: EquipmentSlot,
  attackValue: number,
  opts?: { rarity?: Rarity; isLocked?: boolean; upgradeLevel?: number; isUpgradeable?: boolean }
): Equipment {
  return {
    id,
    slot,
    name: id,
    rarity: opts?.rarity ?? 'common',
    level: 1,
    stats: [{ type: 'attack', value: attackValue, isPercent: false }],
    isLocked: opts?.isLocked ?? false,
    affixes: [
      {
        stat: 'attack',
        value: attackValue,
        isUpgradeable: opts?.isUpgradeable ?? true,
        upgradeLevel: opts?.upgradeLevel ?? 0
      }
    ],
    refiningSlots: [],
    refiningLevel: 0,
    runeSlots: []
  }
}

/** 构造带多个 attack 词缀的装备（用于 Phase 3.4.1 重复 affix 测试）。 */
function makeMultiAffixEquip(
  id: string,
  slot: EquipmentSlot,
  attackValue: number,
  affixSpecs: Array<{ stat?: string; value: number; isUpgradeable?: boolean; upgradeLevel?: number }>
): Equipment {
  return {
    id,
    slot,
    name: id,
    rarity: 'common',
    level: 1,
    stats: [{ type: 'attack', value: attackValue, isPercent: false }],
    isLocked: false,
    affixes: affixSpecs.map(a => ({
      stat: (a.stat ?? 'attack') as StatAffix['stat'],
      value: a.value,
      isUpgradeable: a.isUpgradeable ?? true,
      upgradeLevel: a.upgradeLevel ?? 0
    })),
    refiningSlots: [],
    refiningLevel: 0,
    runeSlots: []
  }
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

describe('Phase 3.4 — 纯函数 planEquipmentAffixUpgrade（校验与规划）', () => {
  const slot: EquipmentSlot = 'weapon'

  it('合法 attack affix → ok，成本= floor(value × 1.15^level)', () => {
    const eq = makeAffixEquip('w1', slot, 100)
    const plan = planEquipmentAffixUpgrade(eq, 0, 1000)
    expect(plan.ok).toBe(true)
    if (!plan.ok) throw new Error('expected ok')
    expect(plan.cost).toBe(100) // floor(100 * 1)
    expect(plan.currentValue).toBe(100)
    expect(plan.nextValue).toBe(110) // 100 + floor(100*0.1)
    expect(plan.currentLevel).toBe(0)
    expect(plan.nextLevel).toBe(1)
    expect(plan.statIndex).toBe(0)
  })

  it('金币不足 → 拒绝且不修改输入', () => {
    const eq = makeAffixEquip('w1', slot, 100)
    const plan = planEquipmentAffixUpgrade(eq, 0, 50)
    expect(plan.ok).toBe(false)
    if (plan.ok) throw new Error('expected fail')
    expect(plan.reason).toBe('not enough gold')
    // 输入未被修改
    expect(eq.stats[0].value).toBe(100)
    expect(eq.affixes[0].value).toBe(100)
    expect(eq.affixes[0].upgradeLevel).toBe(0)
  })

  it('affix.value 与 stats.value 不一致 → 拒绝', () => {
    const eq = makeAffixEquip('w1', slot, 100)
    eq.affixes[0].value = 200 // 制造分叉
    const plan = planEquipmentAffixUpgrade(eq, 0, 1000)
    expect(plan.ok).toBe(false)
    if (plan.ok) throw new Error('expected fail')
    expect(plan.reason).toBe('affix.value must equal stats.value')
  })

  it('affix/stat 类型不匹配（stats 无对应词条）→ 拒绝', () => {
    const eq = makeAffixEquip('w1', slot, 100)
    eq.affixes[0].stat = 'defense' as StatAffix['stat']
    const plan = planEquipmentAffixUpgrade(eq, 0, 1000)
    expect(plan.ok).toBe(false)
    if (plan.ok) throw new Error('expected fail')
    expect(plan.reason).toBe('stats must contain exactly one matching stat')
  })

  it('nextValue 不增（value=5）→ 拒绝购买', () => {
    const eq = makeAffixEquip('w1', slot, 5)
    const plan = planEquipmentAffixUpgrade(eq, 0, 1000)
    expect(plan.ok).toBe(false)
    if (plan.ok) throw new Error('expected fail')
    expect(plan.reason).toBe('nextValue must strictly exceed currentValue')
  })

  it('损坏装备（非法 slot）→ 拒绝且不抛异常', () => {
    const broken = { ...makeAffixEquip('w1', slot, 100), slot: 'not-a-slot' }
    const plan = planEquipmentAffixUpgrade(broken, 0, 1000)
    expect(plan.ok).toBe(false)
  })
})

describe('Phase 3.4 — 原子事务 tryUpgradeEquipmentAffix', () => {
  const slot: EquipmentSlot = 'weapon'

  it('合法升级：gold 精确扣除一次、stats/affix 同步增加、level+1、totalStats 与 score 增加', () => {
    const store = usePlayerStore()
    store.player.gold = 100000
    const attack0 = 100
    store.player.equipment[slot] = makeAffixEquip('w1', slot, attack0)

    const beforeScore = calculateEquipmentScore(store.player.equipment[slot]!)
    const beforeTotalAttack = store.totalStats.attack

    const res = store.tryUpgradeEquipmentAffix(slot, 0)

    expect(res.ok).toBe(true)
    expect(res.cost).toBe(calculateUpgradeCost(attack0, 0)) // 100

    // 金币精确扣除一次
    expect(store.player.gold).toBe(100000 - 100)

    const eq = store.player.equipment[slot]!
    // stats 与 affix 同时增加
    expect(eq.stats[0].value).toBe(110)
    expect(eq.affixes[0].value).toBe(110)
    expect(eq.affixes[0].upgradeLevel).toBe(1)

    // totalStats 立即反映新 attack（110 - 100 = +10）
    expect(store.totalStats.attack).toBe(beforeTotalAttack + 10)
    // score 使用新值
    expect(calculateEquipmentScore(eq)).toBeGreaterThan(beforeScore)
  })

  it('磁盘 stats/affixes 一致，刷新 loadGame 后升级仍存在', () => {
    setActivePinia(createPinia())
    warmupStores()
    const store = usePlayerStore()
    store.player.gold = 100000
    store.player.equipment[slot] = makeAffixEquip('w1', slot, 100)

    const res = store.tryUpgradeEquipmentAffix(slot, 0)
    expect(res.ok).toBe(true)

    // 磁盘一致
    const disk = readDisk()
    expect(disk.player.equipment[slot].stats[0].value).toBe(110)
    expect(disk.player.equipment[slot].affixes[0].value).toBe(110)
    expect(disk.player.equipment[slot].affixes[0].upgradeLevel).toBe(1)

    // 刷新
    setActivePinia(createPinia())
    warmupStores()
    const store2 = usePlayerStore()
    store2.loadGame()
    const eq2 = store2.player.equipment[slot]!
    expect(eq2.stats[0].value).toBe(110)
    expect(eq2.affixes[0].value).toBe(110)
    expect(eq2.affixes[0].upgradeLevel).toBe(1)
  })

  it('第二次升级按新 value 与新 level 计算 cost', () => {
    const store = usePlayerStore()
    store.player.gold = 100000
    store.player.equipment[slot] = makeAffixEquip('w1', slot, 100)
    expect(store.tryUpgradeEquipmentAffix(slot, 0).ok).toBe(true) // 100→110, lv 0→1

    const cost2 = calculateUpgradeCost(110, 1) // floor(110 * 1.15)
    expect(cost2).toBe(Math.floor(110 * 1.15))

    const before = store.player.gold
    const res = store.tryUpgradeEquipmentAffix(slot, 0)
    expect(res.ok).toBe(true)
    expect(res.cost).toBe(cost2)
    expect(store.player.gold).toBe(before - cost2)

    const eq = store.player.equipment[slot]!
    expect(eq.stats[0].value).toBe(121) // 110 + floor(110*0.1)
    expect(eq.affixes[0].value).toBe(121)
    expect(eq.affixes[0].upgradeLevel).toBe(2)
  })

  it('保存失败：gold/stats/affix/level 完整回滚、磁盘不变、恢复重试仅提交一次', () => {
    const store = usePlayerStore()
    store.player.gold = 100000
    store.player.equipment[slot] = makeAffixEquip('w1', slot, 100)
    store.saveGame() // 基准落盘

    installThrowingStorage()
    const res = store.tryUpgradeEquipmentAffix(slot, 0)
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('save failed')

    // 内存完整回滚
    expect(store.player.gold).toBe(100000)
    const eq = store.player.equipment[slot]!
    expect(eq.stats[0].value).toBe(100)
    expect(eq.affixes[0].value).toBe(100)
    expect(eq.affixes[0].upgradeLevel).toBe(0)

    // 磁盘不变（恢复真实 storage 后读取）
    vi.unstubAllGlobals()
    const disk = readDisk()
    expect(disk.player.equipment[slot].stats[0].value).toBe(100)
    expect(disk.player.equipment[slot].affixes[0].upgradeLevel).toBe(0)

    // 恢复后重试仅提交一次
    const before = store.player.gold
    const res2 = store.tryUpgradeEquipmentAffix(slot, 0)
    expect(res2.ok).toBe(true)
    expect(store.player.gold).toBe(before - calculateUpgradeCost(100, 0))
    expect(store.player.equipment[slot]!.stats[0].value).toBe(110)
  })

  // —— 拒绝测试：零扣款 / 零属性变化 / 零存档写入 ——
  function expectRejectNoSideEffect(make: () => Equipment, idx: number, gold: number) {
    const store = usePlayerStore()
    store.player.gold = gold
    const eq = make()
    store.player.equipment[slot] = eq
    store.saveGame() // 基准落盘，用于验证磁盘不变

    const goldBefore = store.player.gold
    const vStats = eq.stats[0].value
    const vAffix = eq.affixes[0].value
    const lv = eq.affixes[0].upgradeLevel

    const res = store.tryUpgradeEquipmentAffix(slot, idx)
    expect(res.ok).toBe(false)

    // 零扣款 / 零属性变化
    expect(store.player.gold).toBe(goldBefore)
    expect(eq.stats[0].value).toBe(vStats)
    expect(eq.affixes[0].value).toBe(vAffix)
    expect(eq.affixes[0].upgradeLevel).toBe(lv)

    // 零存档写入（磁盘等于基准）
    const disk = readDisk()
    expect(disk.player.equipment[slot].stats[0].value).toBe(vStats)
    expect(disk.player.equipment[slot].affixes[0].upgradeLevel).toBe(lv)
  }

  it('拒绝-金币不足：零副作用', () => {
    expectRejectNoSideEffect(() => makeAffixEquip('w1', slot, 100), 0, 50)
  })

  it('拒绝-非法 affixIndex（-1）', () => {
    expectRejectNoSideEffect(() => makeAffixEquip('w1', slot, 100), -1, 1000)
  })

  it('拒绝-非法 affixIndex（越界）', () => {
    expectRejectNoSideEffect(() => makeAffixEquip('w1', slot, 100), 99, 1000)
  })

  it('拒绝-不可升级词条', () => {
    expectRejectNoSideEffect(() => makeAffixEquip('w1', slot, 100, { isUpgradeable: false }), 0, 1000)
  })

  it('拒绝-affix/stat 类型不匹配', () => {
    expectRejectNoSideEffect(() => {
      const eq = makeAffixEquip('w1', slot, 100)
      eq.affixes[0].stat = 'defense' as StatAffix['stat']
      return eq
    }, 0, 1000)
  })

  it('拒绝-affix.value 与 stats.value 不一致', () => {
    expectRejectNoSideEffect(() => {
      const eq = makeAffixEquip('w1', slot, 100)
      eq.affixes[0].value = 200
      return eq
    }, 0, 1000)
  })

  it('拒绝-affix.value 为 NaN', () => {
    expectRejectNoSideEffect(() => {
      const eq = makeAffixEquip('w1', slot, 100)
      eq.affixes[0].value = NaN
      return eq
    }, 0, 1000)
  })

  it('拒绝-affix.value 为 Infinity', () => {
    expectRejectNoSideEffect(() => {
      const eq = makeAffixEquip('w1', slot, 100)
      eq.affixes[0].value = Infinity
      return eq
    }, 0, 1000)
  })

  it('拒绝-affix.value 为负', () => {
    expectRejectNoSideEffect(() => {
      const eq = makeAffixEquip('w1', slot, 100)
      eq.affixes[0].value = -5
      return eq
    }, 0, 1000)
  })

  it('拒绝-非法 upgradeLevel（非整数）', () => {
    expectRejectNoSideEffect(() => makeAffixEquip('w1', slot, 100, { upgradeLevel: 1.5 }), 0, 1000)
  })

  it('拒绝-非法 upgradeLevel（负数）', () => {
    expectRejectNoSideEffect(() => makeAffixEquip('w1', slot, 100, { upgradeLevel: -1 }), 0, 1000)
  })

  it('拒绝-nextValue 不增（value=5）', () => {
    expectRejectNoSideEffect(() => makeAffixEquip('w1', slot, 5), 0, 1000)
  })

  it('拒绝-损坏装备（非法 slot）', () => {
    expectRejectNoSideEffect(() => {
      const eq = makeAffixEquip('w1', slot, 100)
      ;(eq as unknown as { slot: string }).slot = 'not-a-slot'
      return eq
    }, 0, 1000)
  })

  it('拒绝-affixes 非数组', () => {
    expectRejectNoSideEffect(() => {
      const eq = makeAffixEquip('w1', slot, 100) as unknown as Record<string, unknown>
      eq.affixes = 'oops'
      return eq as unknown as Equipment
    }, 0, 1000)
  })
})

describe('Phase 3.4 — loadGame 旧存档迁移（stats ↔ affixes 规范）', () => {
  const slot: EquipmentSlot = 'weapon'

  function legacyEquip(over: Record<string, unknown>): Equipment {
    return {
      id: 'w',
      slot,
      name: 'w',
      rarity: 'common',
      level: 1,
      stats: [{ type: 'attack', value: 100, isPercent: false }],
      isLocked: false,
      affixes: [{ stat: 'attack', value: 100, isUpgradeable: true, upgradeLevel: 0 }],
      refiningSlots: [],
      refiningLevel: 0,
      runeSlots: [],
      ...over
    } as Equipment
  }

  it('迁移 A：upgradeLevel>0 且 affix.value 合法 → stats 同步 affix（补偿已付费）', () => {
    setActivePinia(createPinia())
    warmupStores()
    const store = usePlayerStore()
    store.player.equipment[slot] = legacyEquip({
      stats: [{ type: 'attack', value: 100, isPercent: false }],
      affixes: [{ stat: 'attack', value: 121, isUpgradeable: true, upgradeLevel: 2 }]
    })
    store.saveGame()

    setActivePinia(createPinia())
    warmupStores()
    const store2 = usePlayerStore()
    store2.loadGame()

    const eq = store2.player.equipment[slot]!
    expect(eq.stats[0].value).toBe(121)
    expect(eq.affixes[0].value).toBe(121)

    // totalStats 使用 121（与 stats=100 时差值恰为 21）
    eq.stats[0].value = 100
    const totalAt100 = store2.totalStats.attack
    eq.stats[0].value = 121
    expect(store2.totalStats.attack - totalAt100).toBe(21)

    // 磁盘已规范化
    const disk = readDisk()
    expect(disk.player.equipment[slot].stats[0].value).toBe(121)
    expect(disk.player.equipment[slot].affixes[0].value).toBe(121)
  })

  it('迁移 B：upgradeLevel=0 且值不一致 → affix 同步回 stats（不凭空赠送）', () => {
    setActivePinia(createPinia())
    warmupStores()
    const store = usePlayerStore()
    store.player.equipment[slot] = legacyEquip({
      stats: [{ type: 'attack', value: 100, isPercent: false }],
      affixes: [{ stat: 'attack', value: 999, isUpgradeable: true, upgradeLevel: 0 }]
    })
    store.saveGame()

    setActivePinia(createPinia())
    warmupStores()
    const store2 = usePlayerStore()
    store2.loadGame()

    const eq = store2.player.equipment[slot]!
    expect(eq.stats[0].value).toBe(100)
    expect(eq.affixes[0].value).toBe(100) // 被拉回，未赠送 999

    const disk = readDisk()
    expect(disk.player.equipment[slot].affixes[0].value).toBe(100)
  })

  it('迁移安全：stats 中多个同类型词条匹配 → 不猜测修改，禁止该词缀后续升级', () => {
    setActivePinia(createPinia())
    warmupStores()
    const store = usePlayerStore()
    store.player.equipment[slot] = legacyEquip({
      stats: [
        { type: 'attack', value: 100, isPercent: false },
        { type: 'attack', value: 50, isPercent: false }
      ],
      affixes: [{ stat: 'attack', value: 100, isUpgradeable: true, upgradeLevel: 0 }]
    })
    store.saveGame()

    setActivePinia(createPinia())
    warmupStores()
    const store2 = usePlayerStore()
    store2.loadGame()

    const eq = store2.player.equipment[slot]!
    // 数值保持原样（不猜测）
    expect(eq.affixes[0].value).toBe(100)
    // 禁止后续升级
    expect(eq.affixes[0].isUpgradeable).toBe(false)
  })
})

describe('Phase 3.4.1 — 纯函数：重复 affix 双向唯一映射（不根据 index 选第一条）', () => {
  const slot: EquipmentSlot = 'weapon'

  it('重复 affix、相同值：index 0 与 index 1 均拒绝，输入完全不变', () => {
    const eq = makeMultiAffixEquip('w1', slot, 100, [{ value: 100 }, { value: 100 }])
    const p0 = planEquipmentAffixUpgrade(eq, 0, 1000)
    const p1 = planEquipmentAffixUpgrade(eq, 1, 1000)
    expect(p0.ok).toBe(false)
    expect(p1.ok).toBe(false)
    if (p0.ok) throw new Error('expected fail')
    expect(p0.reason).toBe('affixes must contain exactly one matching affix')
    // 输入完全不变
    expect(eq.stats[0].value).toBe(100)
    expect(eq.affixes[0].value).toBe(100)
    expect(eq.affixes[1].value).toBe(100)
    expect(eq.affixes[0].upgradeLevel).toBe(0)
    expect(eq.affixes[1].upgradeLevel).toBe(0)
  })

  it('重复 affix、不同值：必须拒绝，不能根据传入 index 选择其一', () => {
    const eq = makeMultiAffixEquip('w1', slot, 100, [{ value: 100 }, { value: 121 }])
    const p0 = planEquipmentAffixUpgrade(eq, 0, 1000)
    const p1 = planEquipmentAffixUpgrade(eq, 1, 1000)
    expect(p0.ok).toBe(false)
    expect(p1.ok).toBe(false)
    if (p0.ok) throw new Error('expected fail')
    expect(p0.reason).toBe('affixes must contain exactly one matching affix')
    // 不修改、不根据 index 选 100 或 121
    expect(eq.stats[0].value).toBe(100)
    expect(eq.affixes[0].value).toBe(100)
    expect(eq.affixes[1].value).toBe(121)
  })

  it('重复 affix 但其中一个 isUpgradeable=false：仍属模糊映射，必须拒绝', () => {
    const eq = makeMultiAffixEquip('w1', slot, 100, [
      { value: 100, isUpgradeable: false },
      { value: 100, isUpgradeable: true }
    ])
    const p0 = planEquipmentAffixUpgrade(eq, 0, 1000)
    const p1 = planEquipmentAffixUpgrade(eq, 1, 1000)
    expect(p0.ok).toBe(false)
    expect(p1.ok).toBe(false)
  })
})

describe('Phase 3.4.1 — 原子事务：重复 affix 零副作用', () => {
  const slot: EquipmentSlot = 'weapon'

  it('重复 affix（相同值）：两次升级均失败，gold/两个 affix/level/stats/磁盘均不变', () => {
    const store = usePlayerStore()
    store.player.gold = 100000
    const eq = makeMultiAffixEquip('w1', slot, 100, [{ value: 100 }, { value: 100 }])
    store.player.equipment[slot] = eq
    store.saveGame() // 基准盘

    const res0 = store.tryUpgradeEquipmentAffix(slot, 0)
    const res1 = store.tryUpgradeEquipmentAffix(slot, 1)
    expect(res0.ok).toBe(false)
    expect(res1.ok).toBe(false)

    // 内存零副作用
    expect(store.player.gold).toBe(100000)
    expect(eq.stats[0].value).toBe(100)
    expect(eq.affixes[0].value).toBe(100)
    expect(eq.affixes[1].value).toBe(100)
    expect(eq.affixes[0].upgradeLevel).toBe(0)
    expect(eq.affixes[1].upgradeLevel).toBe(0)

    // 磁盘不变（等于基准，未把任一 value 写入）
    const disk = readDisk()
    expect(disk.player.equipment[slot].stats[0].value).toBe(100)
    expect(disk.player.equipment[slot].affixes[0].value).toBe(100)
    expect(disk.player.equipment[slot].affixes[1].value).toBe(100)
    expect(disk.player.equipment[slot].affixes[0].upgradeLevel).toBe(0)
    expect(disk.player.equipment[slot].affixes[1].upgradeLevel).toBe(0)
  })
})

describe('Phase 3.4.1 — loadGame 旧存档迁移：重复 affix 顺序无关、不赠送属性', () => {
  const slot: EquipmentSlot = 'weapon'

  it('重复 affix 不得把 121 或 999999 选为权威 stats', () => {
    setActivePinia(createPinia())
    warmupStores()
    const store = usePlayerStore()
    store.player.equipment[slot] = makeMultiAffixEquip('w1', slot, 100, [
      { value: 121, upgradeLevel: 2 },
      { value: 999999, upgradeLevel: 1 }
    ])
    store.saveGame()

    setActivePinia(createPinia())
    warmupStores()
    const store2 = usePlayerStore()
    store2.loadGame()

    const eq = store2.player.equipment[slot]!
    expect(eq.stats[0].value).toBe(100) // 未被任一 affix 覆盖
    expect(eq.affixes[0].value).toBe(121)
    expect(eq.affixes[1].value).toBe(999999)
    expect(eq.affixes[0].isUpgradeable).toBe(false)
    expect(eq.affixes[1].isUpgradeable).toBe(false)

    const disk = readDisk()
    expect(disk.player.equipment[slot].stats[0].value).toBe(100)
    expect(disk.player.equipment[slot].affixes[0].value).toBe(121)
    expect(disk.player.equipment[slot].affixes[1].value).toBe(999999)
    expect(disk.player.equipment[slot].affixes[0].isUpgradeable).toBe(false)
    expect(disk.player.equipment[slot].affixes[1].isUpgradeable).toBe(false)
  })

  function expectDupMigratedToSafe(order: 'A' | 'B') {
    setActivePinia(createPinia())
    warmupStores()
    const store = usePlayerStore()
    const specs =
      order === 'A'
        ? [{ value: 121, upgradeLevel: 2 }, { value: 999999, upgradeLevel: 1 }]
        : [{ value: 999999, upgradeLevel: 1 }, { value: 121, upgradeLevel: 2 }]
    store.player.equipment[slot] = makeMultiAffixEquip('w1', slot, 100, specs)
    store.saveGame()

    setActivePinia(createPinia())
    warmupStores()
    const store2 = usePlayerStore()
    store2.loadGame()

    const eq = store2.player.equipment[slot]!
    // stats 都保持 100（不依赖数组顺序）
    expect(eq.stats[0].value).toBe(100)
    // 所有重复 affix 都被禁止升级
    expect(eq.affixes[0].isUpgradeable).toBe(false)
    expect(eq.affixes[1].isUpgradeable).toBe(false)
    // 任何 affix.value 都不被迁移到 stats（原值保持）
    expect(eq.affixes[0].value).toBe(specs[0].value)
    expect(eq.affixes[1].value).toBe(specs[1].value)
  }

  it('顺序无关 A：121, 999999', () => expectDupMigratedToSafe('A'))
  it('顺序无关 B：999999, 121', () => expectDupMigratedToSafe('B'))

  it('一个合法 + 一个损坏（同 stat）：不挑选合法的，stats 不变、不抛异常', () => {
    setActivePinia(createPinia())
    warmupStores()
    const store = usePlayerStore()
    const broken = { stat: 'attack', value: NaN, upgradeLevel: 1.5 } as unknown as StatAffix
    const eq = {
      id: 'w1',
      slot,
      name: 'w1',
      rarity: 'common',
      level: 1,
      stats: [{ type: 'attack', value: 100, isPercent: false }],
      isLocked: false,
      affixes: [
        { stat: 'attack', value: 121, isUpgradeable: true, upgradeLevel: 2 },
        broken
      ],
      refiningSlots: [],
      refiningLevel: 0,
      runeSlots: []
    } as unknown as Equipment
    store.player.equipment[slot] = eq
    store.saveGame()

    setActivePinia(createPinia())
    warmupStores()
    const store2 = usePlayerStore()
    expect(() => store2.loadGame()).not.toThrow()

    const eq2 = store2.player.equipment[slot]!
    expect(eq2.stats[0].value).toBe(100) // 合法 affix 的 121 未被写入权威 stats
    expect(eq2.affixes[0].isUpgradeable).toBe(false)
    expect(eq2.affixes[1].isUpgradeable).toBe(false)
  })
})
