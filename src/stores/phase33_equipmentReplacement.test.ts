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
import { planEquipmentReplacement, validateEquipmentForEconomy, planEquipmentRecycle } from '../utils/equipmentReplacement'
import type { Equipment, EquipmentSlot, Rarity } from '../types'

// SAVE_KEY 为 playerStore 内部常量（'lollipop_adventure_save'）；测试内复用同一字面量以对齐读写。
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

/** 用单条 attack 词条构造可手算评分的装备（common 稀有度倍率=1，attack 基础值=10）。 */
function makeEquip(
  id: string,
  slot: EquipmentSlot,
  attackValue: number,
  opts?: { rarity?: Rarity; isLocked?: boolean; setId?: string }
): Equipment {
  return {
    id,
    slot,
    name: id,
    rarity: opts?.rarity ?? 'common',
    level: 1,
    stats: [{ type: 'attack', value: attackValue, isPercent: false }],
    setId: opts?.setId,
    isLocked: opts?.isLocked ?? false,
    affixes: [],
    refiningSlots: [],
    refiningLevel: 0,
    runeSlots: []
  }
}

/**
 * 回收价（common 倍率=1，bonus=min(score/200,0.8)）：
 *   score 10 → 100*(1+0.05)=105
 *   score 20 → 200*(1+0.10)=220
 *   score 5  → 50*(1+0.025)=51
 */
const RECYCLE = { score5: 51, score10: 105, score20: 220 }

/** 构造一个"完整形状"装备对象（含经济校验所需全部字段），便于 patch 出损坏版本。 */
function fullEquip(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'x',
    slot: 'weapon' as EquipmentSlot,
    name: 'x',
    rarity: 'common' as Rarity,
    level: 1,
    stats: [{ type: 'attack', value: 100, isPercent: false }],
    isLocked: false,
    affixes: [],
    refiningSlots: [],
    refiningLevel: 0,
    runeSlots: []
  , ...overrides }
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

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  warmupStores()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('Phase 3.3 — 纯函数 planEquipmentReplacement（唯一决策）', () => {
  const slot: EquipmentSlot = 'weapon'

  it('空槽位 → equip-empty，回收金币为 0', () => {
    const next = makeEquip('new', slot, 100)
    const d = planEquipmentReplacement(next, null)
    expect(d.kind).toBe('equip-empty')
    if (d.kind !== 'equip-empty') throw new Error('expected equip-empty')
    expect(d.newScore).toBe(10)
    expect(d.recycleGold).toBe(0)
  })

  it('未锁定且更高分 → replace，回收价 = 旧装备回收价', () => {
    const current = makeEquip('old', slot, 100) // score 10
    const next = makeEquip('new', slot, 200) // score 20
    const d = planEquipmentReplacement(next, current)
    expect(d.kind).toBe('replace')
    if (d.kind !== 'replace') throw new Error('expected replace')
    expect(d.oldScore).toBe(10)
    expect(d.newScore).toBe(20)
    expect(d.recycleGold).toBe(RECYCLE.score10) // 旧装备（score10）回收价 105
  })

  it('相同分 → not-better', () => {
    const current = makeEquip('old', slot, 100)
    const next = makeEquip('new', slot, 100)
    const d = planEquipmentReplacement(next, current)
    expect(d.kind).toBe('not-better')
    if (d.kind !== 'not-better') throw new Error('expected not-better')
    expect(d.oldScore).toBe(10)
    expect(d.newScore).toBe(10)
  })

  it('较低分 → not-better', () => {
    const current = makeEquip('old', slot, 200) // score 20
    const next = makeEquip('new', slot, 100) // score 10
    const d = planEquipmentReplacement(next, current)
    expect(d.kind).toBe('not-better')
  })

  it('1.05 阈值：边界前 / 等于 / 超过', () => {
    const current = makeEquip('old', slot, 200) // score 20 → 20*1.05 = 21
    // 边界前：新分数 20（严格小于 21）→ not-better
    expect(planEquipmentReplacement(makeEquip('a', slot, 200), current, 1.05).kind).toBe('not-better')
    // 边界等于：新分数 = 21（floor(210)=21）→ 21 > 21 不成立 → not-better
    expect(planEquipmentReplacement(makeEquip('b', slot, 210), current, 1.05).kind).toBe('not-better')
    // 超过：新分数 = 22（floor(220)=22）→ 22 > 21 → replace
    expect(planEquipmentReplacement(makeEquip('c', slot, 220), current, 1.05).kind).toBe('replace')
  })

  it('当前装备锁定 → blocked-locked（无论分数高低）', () => {
    const current = makeEquip('old', slot, 10, { isLocked: true }) // score 1
    const next = makeEquip('new', slot, 200) // score 20，明显更高
    const d = planEquipmentReplacement(next, current)
    expect(d.kind).toBe('blocked-locked')
    if (d.kind !== 'blocked-locked') throw new Error('expected blocked-locked')
    expect(d.oldScore).toBe(1)
    expect(d.newScore).toBe(20)
  })

  it('非法 next → invalid（空 id / 非法稀有度 / null）', () => {
    const current = makeEquip('old', slot, 100)
    expect(planEquipmentReplacement({ ...makeEquip('x', slot, 100), id: '' }, current).kind).toBe('invalid')
    expect(planEquipmentReplacement({ ...makeEquip('x', slot, 100), rarity: 'ultra' as Rarity }, current).kind).toBe('invalid')
    expect(planEquipmentReplacement(null as unknown as Equipment, current).kind).toBe('invalid')
  })
})

describe('Phase 3.3 — 三个旧入口委托权威事务（结果一致）', () => {
  const slot: EquipmentSlot = 'weapon'

  it('空槽位：equipItem / autoEquipIfBetter / equipNewEquipment 均成功装备', () => {
    const store = usePlayerStore()
    const next = makeEquip('new', slot, 100)
    expect(store.equipItem(next)).toBe(true)
    expect(store.player.equipment[slot]?.id).toBe('new')

    // 重新清空槽位，分别验证另两个入口
    store.player.equipment[slot] = undefined as unknown as Equipment
    expect(store.autoEquipIfBetter(makeEquip('auto', slot, 100))).toBe(true)
    expect(store.player.equipment[slot]?.id).toBe('auto')

    store.player.equipment[slot] = undefined as unknown as Equipment
    store.pendingEquipment = makeEquip('pending', slot, 50)
    expect(store.equipNewEquipment(makeEquip('new2', slot, 100))).toBe(true)
    expect(store.player.equipment[slot]?.id).toBe('new2')
    expect(store.pendingEquipment).toBeNull() // 成功后清除 pending
  })

  it('更高分：三入口都替换并发放一次回收金币', () => {
    const store = usePlayerStore()
    store.player.gold = 1000
    store.player.equipment[slot] = makeEquip('old', slot, 100) // score 10, 回收 105
    const better = makeEquip('better', slot, 200) // score 20

    expect(store.equipItem(better)).toBe(true)
    expect(store.player.equipment[slot]?.id).toBe('better')
    expect(store.player.gold).toBe(1000 + RECYCLE.score10)

    // 复位到旧装备，验证另两个入口
    store.player.equipment[slot] = makeEquip('old', slot, 100)
    store.player.gold = 1000
    expect(store.autoEquipIfBetter(better)).toBe(true)
    expect(store.player.gold).toBe(1000 + RECYCLE.score10)

    store.player.equipment[slot] = makeEquip('old', slot, 100)
    store.player.gold = 1000
    expect(store.equipNewEquipment(better)).toBe(true)
    expect(store.player.gold).toBe(1000 + RECYCLE.score10)
  })

  it('相同分 / 较低分：三入口都拒绝且不改动', () => {
    const store = usePlayerStore()
    const current = makeEquip('old', slot, 100) // score 10
    store.player.equipment[slot] = current
    store.player.gold = 1000

    for (const same of [makeEquip('same', slot, 100), makeEquip('worse', slot, 50)]) {
      const beforeId = store.player.equipment[slot]?.id
      expect(store.equipItem(same)).toBe(false)
      expect(store.autoEquipIfBetter(same)).toBe(false)
      expect(store.equipNewEquipment(same)).toBe(false)
      expect(store.player.equipment[slot]?.id).toBe(beforeId) // 装备未变
      expect(store.player.gold).toBe(1000) // 金币未变（无回收）
    }
  })
})

describe('Phase 3.3 — 锁定装备阻止四条入口', () => {
  const slot: EquipmentSlot = 'weapon'

  it('锁定当前装备：equipItem / autoEquipIfBetter / equipNewEquipment / tryRecycleEquippedItem 全部拒绝', () => {
    const store = usePlayerStore()
    store.player.gold = 1000
    store.player.equipment[slot] = makeEquip('locked', slot, 10, { isLocked: true })
    const better = makeEquip('better', slot, 200) // score 20，明显高于锁定件

    expect(store.equipItem(better)).toBe(false)
    expect(store.autoEquipIfBetter(better)).toBe(false)
    expect(store.equipNewEquipment(better)).toBe(false)
    expect(store.tryRecycleEquippedItem(slot)).toBe(false)

    // 装备与金币均不变；pending 未被误清除
    expect(store.player.equipment[slot]?.id).toBe('locked')
    expect(store.player.gold).toBe(1000)
  })

  it('锁定装备阻止 unequipItem（委托 tryRecycleEquippedItem）', () => {
    const store = usePlayerStore()
    store.player.equipment[slot] = makeEquip('locked', slot, 10, { isLocked: true })
    store.unequipItem(slot)
    expect(store.player.equipment[slot]?.id).toBe('locked')
  })
})

describe('Phase 3.3 — 较差装备重复尝试不产金币（修复复制漏洞）', () => {
  const slot: EquipmentSlot = 'weapon'

  it('当前高分装备，连续 10 次传入同一件较差装备：全部 false、id 不变、金币严格不变、磁盘不变', () => {
    const store = usePlayerStore()
    store.player.gold = 1000
    store.player.equipment[slot] = makeEquip('high', slot, 200) // score 20
    const worse = makeEquip('worse', slot, 100) // score 10

    // 先以真实 storage 落盘初始状态作为基准
    store.saveGame()
    const original = localStorage.getItem(SAVE_KEY)

    for (let i = 0; i < 10; i++) {
      const ok = store.equipItem(worse)
      expect(ok).toBe(false)
    }

    expect(store.player.equipment[slot]?.id).toBe('high') // 当前装备 id 不变
    expect(store.player.gold).toBe(1000) // 金币严格不变

    // 磁盘装备与金币严格不变（所有尝试均失败，未触发任何存档）
    expect(localStorage.getItem(SAVE_KEY)).toBe(original)
    const disk = readDisk()
    expect(disk.player.equipment[slot]?.id).toBe('high')
    expect(disk.player.gold).toBe(1000)
  })
})

describe('Phase 3.3 — 成功替换的回收价精确且只发一次', () => {
  const slot: EquipmentSlot = 'weapon'

  it('替换未锁定旧装备：回收价精确，再次传入同一新装备不再增加', () => {
    const store = usePlayerStore()
    store.player.gold = 1000
    store.player.equipment[slot] = makeEquip('old', slot, 100) // score 10, 回收 105
    const better = makeEquip('better', slot, 200) // score 20

    expect(store.equipItem(better)).toBe(true)
    expect(store.player.gold).toBe(1000 + RECYCLE.score10) // 恰好 1105
    expect(store.player.equipment[slot]?.id).toBe('better')

    // 再次传入同一新装备：当前已是 better，相同分 → not-better → false，金币不再增加
    expect(store.equipItem(better)).toBe(false)
    expect(store.player.gold).toBe(1000 + RECYCLE.score10)

    // 磁盘与内存一致
    const disk = readDisk()
    expect(disk.player.equipment[slot]?.id).toBe('better')
    expect(disk.player.gold).toBe(1000 + RECYCLE.score10)
  })
})

describe('Phase 3.3 — 保存失败必须完整回滚', () => {
  const slot: EquipmentSlot = 'weapon'

  it('替换旧装备保存失败：装备/金币/pending 恢复，磁盘保持原状', () => {
    const store = usePlayerStore()
    store.player.gold = 1000
    store.player.equipment[slot] = makeEquip('old', slot, 100) // score 10, 回收 105
    const better = makeEquip('better', slot, 200) // score 20
    store.pendingEquipment = makeEquip('pend', slot, 50)

    // 先以真实 storage 落盘当前状态作为基准
    store.saveGame()
    const original = localStorage.getItem(SAVE_KEY)

    const realStorage = installThrowingStorage()
    const result = store.tryReplaceEquipment(better)
    expect(result.ok).toBe(false)
    expect(result.kind).toBe('replace')

    // 内存已完整回滚
    expect(store.player.equipment[slot]?.id).toBe('old')
    expect(store.player.gold).toBe(1000)
    expect(store.pendingEquipment?.id).toBe('pend')

    // 恢复存储后断言磁盘未变
    vi.unstubAllGlobals()
    expect(realStorage.getItem(SAVE_KEY)).toBe(original)
  })

  it('恢复存储后重试：恰好替换一次、恰好获得一次回收金币', () => {
    const store = usePlayerStore()
    store.player.gold = 1000
    store.player.equipment[slot] = makeEquip('old', slot, 100) // score 10, 回收 105
    const better = makeEquip('better', slot, 200)

    // 第一次：保存失败
    installThrowingStorage()
    expect(store.tryReplaceEquipment(better).ok).toBe(false)
    vi.unstubAllGlobals()

    // 第二次：真实 storage，成功提交
    expect(store.tryReplaceEquipment(better).ok).toBe(true)
    expect(store.player.equipment[slot]?.id).toBe('better')
    expect(store.player.gold).toBe(1000 + RECYCLE.score10) // 仅一次回收

    const disk = readDisk()
    expect(disk.player.equipment[slot]?.id).toBe('better')
    expect(disk.player.gold).toBe(1000 + RECYCLE.score10)
  })

  it('空槽位装备保存失败：槽位仍空、金币不变、pending 保留', () => {
    const store = usePlayerStore()
    store.player.gold = 1000
    store.pendingEquipment = makeEquip('pend', slot, 50)
    const next = makeEquip('new', slot, 100) // 空槽位 → equip-empty

    store.saveGame()
    const original = localStorage.getItem(SAVE_KEY)

    installThrowingStorage()
    const result = store.tryReplaceEquipment(next)
    expect(result.ok).toBe(false)
    expect(result.kind).toBe('equip-empty')

    expect(store.player.equipment[slot]).toBeUndefined()
    expect(store.player.gold).toBe(1000)
    expect(store.pendingEquipment?.id).toBe('pend') // pending 未清

    vi.unstubAllGlobals()
    expect(localStorage.getItem(SAVE_KEY)).toBe(original)
  })

  it('equipNewEquipment 保存失败：pending 不清除；成功后清除', () => {
    const store = usePlayerStore()
    store.player.equipment[slot] = makeEquip('old', slot, 100)
    const better = makeEquip('better', slot, 200)
    store.pendingEquipment = better

    // 失败：pending 保留
    installThrowingStorage()
    expect(store.equipNewEquipment(better)).toBe(false)
    expect(store.pendingEquipment?.id).toBe('better')
    vi.unstubAllGlobals()

    // 成功：pending 清除
    expect(store.equipNewEquipment(better)).toBe(true)
    expect(store.pendingEquipment).toBeNull()
  })
})

describe('Phase 3.3 — 图鉴仅在成功 auto-equip 后登记', () => {
  const slot: EquipmentSlot = 'weapon'

  it('autoEquipIfBetter 成功 → 图鉴登记；保存失败 / 锁定 / 不够好 → 不登记', () => {
    const store = usePlayerStore()
    const collection = useCollectionStore()
    store.player.equipment[slot] = makeEquip('old', slot, 100)
    const better = makeEquip('better', slot, 200)

    // 成功：登记
    expect(store.autoEquipIfBetter(better)).toBe(true)
    expect(collection.collection.discoveredEquipments).toContain('better')

    // 复位，保存失败：不登记
    store.player.equipment[slot] = makeEquip('old', slot, 100)
    const better2 = makeEquip('better2', slot, 200)
    installThrowingStorage()
    expect(store.autoEquipIfBetter(better2)).toBe(false)
    vi.unstubAllGlobals()
    expect(collection.collection.discoveredEquipments).not.toContain('better2')

    // 锁定当前：不登记
    store.player.equipment[slot] = makeEquip('locked', slot, 10, { isLocked: true })
    const better3 = makeEquip('better3', slot, 200)
    expect(store.autoEquipIfBetter(better3)).toBe(false)
    expect(collection.collection.discoveredEquipments).not.toContain('better3')

    // 不够好：不登记
    store.player.equipment[slot] = makeEquip('old', slot, 200)
    const worse = makeEquip('worse', slot, 100)
    expect(store.autoEquipIfBetter(worse)).toBe(false)
    expect(collection.collection.discoveredEquipments).not.toContain('worse')
  })

  it('discoverEquipment 仅在 save 成功后调用（spy 验证）', () => {
    const store = usePlayerStore()
    const collection = useCollectionStore()
    const spy = vi.spyOn(collection, 'discoverEquipment')
    store.player.equipment[slot] = makeEquip('old', slot, 100)
    const better = makeEquip('better', slot, 200)

    installThrowingStorage()
    store.autoEquipIfBetter(better)
    vi.unstubAllGlobals()
    expect(spy).not.toHaveBeenCalled() // 保存失败则非关键副作用不发

    store.player.equipment[slot] = makeEquip('old', slot, 100)
    store.autoEquipIfBetter(better)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith('better')
  })
})

describe('Phase 3.3 — 卸下即原子回收（tryRecycleEquippedItem / unequipItem）', () => {
  const slot: EquipmentSlot = 'weapon'

  it('未锁定装备卸下：成功、发放一次回收金币、槽位清空', () => {
    const store = usePlayerStore()
    store.player.gold = 1000
    store.player.equipment[slot] = makeEquip('eq', slot, 100) // score 10, 回收 105

    expect(store.tryRecycleEquippedItem(slot)).toBe(true)
    expect(store.player.equipment[slot]).toBeUndefined()
    expect(store.player.gold).toBe(1000 + RECYCLE.score10)

    const disk = readDisk()
    expect(disk.player.equipment[slot]).toBeUndefined()
    expect(disk.player.gold).toBe(1000 + RECYCLE.score10)
  })

  it('空槽位卸下 → false，无改动', () => {
    const store = usePlayerStore()
    store.player.gold = 1000
    expect(store.tryRecycleEquippedItem(slot)).toBe(false)
    expect(store.player.gold).toBe(1000)
  })

  it('锁定装备卸下 → false，装备与金币不变', () => {
    const store = usePlayerStore()
    store.player.gold = 1000
    store.player.equipment[slot] = makeEquip('locked', slot, 100, { isLocked: true })
    expect(store.tryRecycleEquippedItem(slot)).toBe(false)
    expect(store.player.equipment[slot]?.id).toBe('locked')
    expect(store.player.gold).toBe(1000)
  })

  it('卸下保存失败：装备与金币完整回滚', () => {
    const store = usePlayerStore()
    store.player.gold = 1000
    store.player.equipment[slot] = makeEquip('eq', slot, 100) // 回收 105

    store.saveGame()
    const original = localStorage.getItem(SAVE_KEY)

    installThrowingStorage()
    expect(store.tryRecycleEquippedItem(slot)).toBe(false)
    vi.unstubAllGlobals()

    // 内存回滚
    expect(store.player.equipment[slot]?.id).toBe('eq')
    expect(store.player.gold).toBe(1000)
    // 磁盘不变
    expect(localStorage.getItem(SAVE_KEY)).toBe(original)
  })
})

describe('Phase 3.3.1 — 纯函数装备经济校验（validateEquipmentForEconomy）', () => {
  it('合法装备通过校验', () => {
    const ok = validateEquipmentForEconomy(makeEquip('ok', 'weapon', 100))
    expect(ok.ok).toBe(true)
  })

  it('null / 数字 / 空对象 / 数组 → invalid', () => {
    expect(validateEquipmentForEconomy(null).ok).toBe(false)
    expect(validateEquipmentForEconomy(42).ok).toBe(false)
    expect(validateEquipmentForEconomy({}).ok).toBe(false)
    expect(validateEquipmentForEconomy([]).ok).toBe(false)
  })

  it('非法 slot → invalid（含 __proto__ / constructor 原型键）', () => {
    for (const slot of ['', 'not-a-slot', '__proto__', 'constructor']) {
      const r = validateEquipmentForEconomy(fullEquip({ slot }))
      expect(r.ok).toBe(false)
    }
  })

  it('非法词条 → invalid', () => {
    expect(validateEquipmentForEconomy(fullEquip({ stats: [{ type: 'bogusStat', value: 100, isPercent: false }] })).ok).toBe(false)
    expect(validateEquipmentForEconomy(fullEquip({ stats: [{ type: 'attack', value: NaN, isPercent: false }] })).ok).toBe(false)
    expect(validateEquipmentForEconomy(fullEquip({ stats: [{ type: 'attack', value: Infinity, isPercent: false }] })).ok).toBe(false)
    expect(validateEquipmentForEconomy(fullEquip({ stats: [{ type: 'attack', value: -1, isPercent: false }] })).ok).toBe(false)
    expect(validateEquipmentForEconomy(fullEquip({ stats: [{ type: 'attack', value: 100 }] })).ok).toBe(false) // isPercent 缺失
    expect(validateEquipmentForEconomy(fullEquip({ stats: [{ type: 'attack', value: 100, isPercent: 'false' }] })).ok).toBe(false) // isPercent 非 boolean
    expect(validateEquipmentForEconomy(fullEquip({ stats: [null] })).ok).toBe(false)
    expect(validateEquipmentForEconomy(fullEquip({ stats: 'notarray' })).ok).toBe(false)
    expect(validateEquipmentForEconomy(fullEquip({ rarity: 'ultra' })).ok).toBe(false)
  })

  it('空槽位 + attack value=-10 → invalid（不是 equip-empty）', () => {
    const d = planEquipmentReplacement(makeEquip('bad', 'weapon', -10), null)
    expect(d.kind).toBe('invalid')
  })
})

describe('Phase 3.3.1 — Store 入口：非法/损坏输入不抛异常且不污染', () => {
  const slot: EquipmentSlot = 'weapon'

  it('非法 slot（含 __proto__ / constructor）经 tryReplaceEquipment / equipItem → invalid / false，不抛异常、不新增 key、金币与磁盘不变', () => {
    const store = usePlayerStore()
    store.player.gold = 1000
    store.saveGame()
    const original = localStorage.getItem(SAVE_KEY)

    for (const badSlot of ['', 'not-a-slot', '__proto__', 'constructor']) {
      const broken = fullEquip({ slot: badSlot, id: `eq-${badSlot}` }) as unknown as Equipment
      expect(() => store.equipItem(broken)).not.toThrow()
      expect(store.equipItem(broken)).toBe(false)
      const tryRes = store.tryReplaceEquipment(broken)
      expect(tryRes.ok).toBe(false)
      expect(tryRes.kind).toBe('invalid')
    }

    // Object 原型未被污染、player.equipment 未新增任意 key
    expect(Object.getPrototypeOf({})).toBe(Object.prototype)
    const equipKeys = Object.keys(store.player.equipment)
    for (const badSlot of ['', 'not-a-slot', '__proto__', 'constructor']) {
      expect(equipKeys).not.toContain(badSlot)
    }
    // 金币与 pending 不变
    expect(store.player.gold).toBe(1000)
    expect(store.pendingEquipment).toBeNull()
    // 磁盘未写入
    expect(localStorage.getItem(SAVE_KEY)).toBe(original)
  })

  it('非法词条经 Store 入口 → false / invalid，不抛异常、装备金币磁盘不变', () => {
    const store = usePlayerStore()
    store.player.gold = 1000
    store.saveGame()
    const original = localStorage.getItem(SAVE_KEY)

    const badInputs: Array<Record<string, unknown>> = [
      { stats: [{ type: 'bogusStat', value: 100, isPercent: false }] },
      { stats: [{ type: 'attack', value: NaN, isPercent: false }] },
      { stats: [{ type: 'attack', value: Infinity, isPercent: false }] },
      { stats: [{ type: 'attack', value: -1, isPercent: false }] },
      { stats: [{ type: 'attack', value: 100 }] },
      { stats: [{ type: 'attack', value: 100, isPercent: 'false' }] },
      { stats: [null] },
      { stats: 'notarray' },
      { rarity: 'ultra' }
    ]
    for (const overrides of badInputs) {
      const broken = fullEquip(overrides) as unknown as Equipment
      expect(() => store.equipItem(broken)).not.toThrow()
      expect(store.equipItem(broken)).toBe(false)
      const tryRes = store.tryReplaceEquipment(broken)
      expect(tryRes.ok).toBe(false)
      expect(tryRes.kind).toBe('invalid')
    }

    expect(store.player.gold).toBe(1000)
    expect(store.player.equipment[slot]).toBeUndefined()
    expect(store.pendingEquipment).toBeNull()
    expect(localStorage.getItem(SAVE_KEY)).toBe(original)
  })

  it('空槽位 + attack value=-10 → invalid（不是 equip-empty），无改动', () => {
    const store = usePlayerStore()
    store.player.gold = 1000
    const broken = makeEquip('bad', slot, -10) as unknown as Equipment
    expect(store.equipItem(broken)).toBe(false)
    const tryRes = store.tryReplaceEquipment(broken)
    expect(tryRes.ok).toBe(false)
    expect(tryRes.kind).toBe('invalid')
    expect(store.player.equipment[slot]).toBeUndefined()
    expect(store.player.gold).toBe(1000)
  })
})

describe('Phase 3.3.1 — 损坏当前装备替换不发生', () => {
  const slot: EquipmentSlot = 'weapon'

  function placeBrokenCurrent(overrides: Record<string, unknown>) {
    const store = usePlayerStore()
    store.player.gold = 1000
    store.player.equipment[slot] = fullEquip({ id: 'broken', ...overrides }) as unknown as Equipment
    store.saveGame()
    return store
  }

  it('stats 缺失 / stat value=Infinity / 非法 rarity / 非法 stat type：均 invalid、current 保持、金币磁盘不变', () => {
    const cases: Array<Record<string, unknown>> = [
      { stats: undefined },
      { stats: [{ type: 'attack', value: Infinity, isPercent: false }] },
      { rarity: 'ultra' },
      { stats: [{ type: 'bogusStat', value: 100, isPercent: false }] }
    ]
    for (const overrides of cases) {
      const store = placeBrokenCurrent(overrides)
      const original = localStorage.getItem(SAVE_KEY)
      const better = makeEquip('better', slot, 200) // score 20，明显高于

      const tryRes = store.tryReplaceEquipment(better)
      expect(tryRes.ok).toBe(false)
      expect(tryRes.kind).toBe('invalid')
      expect(store.equipItem(better)).toBe(false)

      // 损坏 current 保持原样（仍是 broken），金币不变
      expect(store.player.equipment[slot]?.id).toBe('broken')
      expect(store.player.gold).toBe(1000)
      expect(localStorage.getItem(SAVE_KEY)).toBe(original)
    }
  })

  it('锁定且合法的 current 仍返回 blocked-locked（优先于损坏判定之外的正常路径）', () => {
    const store = usePlayerStore()
    store.player.gold = 1000
    store.player.equipment[slot] = makeEquip('locked', slot, 10, { isLocked: true })
    const better = makeEquip('better', slot, 200)
    const tryRes = store.tryReplaceEquipment(better)
    expect(tryRes.ok).toBe(false)
    expect(tryRes.kind).toBe('blocked-locked')
    expect(store.player.equipment[slot]?.id).toBe('locked')
    expect(store.player.gold).toBe(1000)
  })
})

describe('Phase 3.3.1 — 损坏装备回收返回 false（不污染状态）', () => {
  const slot: EquipmentSlot = 'weapon'

  function placeBroken(overrides: Record<string, unknown>) {
    const store = usePlayerStore()
    store.player.gold = 1000
    store.player.equipment[slot] = fullEquip({ id: 'broken', ...overrides }) as unknown as Equipment
    store.saveGame()
    return store
  }

  it('score 为负 / NaN / Infinity：tryRecycleEquippedItem 与 unequipItem 均拒绝，装备不删、金币不变、磁盘不变', () => {
    const cases: Array<Record<string, unknown>> = [
      { stats: [{ type: 'attack', value: -10, isPercent: false }] },
      { stats: [{ type: 'attack', value: NaN, isPercent: false }] },
      { stats: [{ type: 'attack', value: Infinity, isPercent: false }] },
      { rarity: 'ultra' },
      { stats: [{ type: 'bogusStat', value: 100, isPercent: false }] }
    ]
    for (const overrides of cases) {
      const store = placeBroken(overrides)
      const original = localStorage.getItem(SAVE_KEY)

      expect(store.tryRecycleEquippedItem(slot)).toBe(false)
      store.unequipItem(slot) // wrapper 也应拒绝

      // 装备未删除、金币保持有限且不变、磁盘不变
      expect(store.player.equipment[slot]?.id).toBe('broken')
      expect(Number.isFinite(store.player.gold)).toBe(true)
      expect(store.player.gold).toBe(1000)
      expect(localStorage.getItem(SAVE_KEY)).toBe(original)

      // 纯函数规划也判非法
      const plan = planEquipmentRecycle(store.player.equipment[slot])
      expect(plan.ok).toBe(false)
    }
  })

  it('换回合法装备：正常回收价 + 保存失败完整回滚仍通过', () => {
    const store = usePlayerStore()
    store.player.gold = 1000

    // 正常回收成功
    store.player.equipment[slot] = makeEquip('eq', slot, 100) // score 10, 回收 105
    expect(store.tryRecycleEquippedItem(slot)).toBe(true)
    expect(store.player.equipment[slot]).toBeUndefined()
    expect(store.player.gold).toBe(1000 + RECYCLE.score10)

    // 重新装备，保存失败应完整回滚
    store.player.gold = 1000
    store.player.equipment[slot] = makeEquip('eq', slot, 100)
    store.saveGame()
    const original = localStorage.getItem(SAVE_KEY)
    installThrowingStorage()
    expect(store.tryRecycleEquippedItem(slot)).toBe(false)
    vi.unstubAllGlobals()
    expect(store.player.equipment[slot]?.id).toBe('eq')
    expect(store.player.gold).toBe(1000)
    expect(localStorage.getItem(SAVE_KEY)).toBe(original)
  })
})

describe('Phase 3.3 — shouldPromptEquipReplace 与权威决策一致', () => {
  const slot: EquipmentSlot = 'weapon'

  it('空槽位或新分严格超过 105% → 提示；锁定/不够好 → 不提示', () => {
    const store = usePlayerStore()
    // 空槽位
    expect(store.shouldPromptEquipReplace(makeEquip('n', slot, 100), null)).toBe(true)
    // 超过 105%
    expect(store.shouldPromptEquipReplace(makeEquip('n', slot, 220), makeEquip('o', slot, 200), )).toBe(true)
    // 等于 105%（21 vs 20*1.05=21）→ 不提示
    expect(store.shouldPromptEquipReplace(makeEquip('n', slot, 210), makeEquip('o', slot, 200))).toBe(false)
    // 不够好
    expect(store.shouldPromptEquipReplace(makeEquip('n', slot, 100), makeEquip('o', slot, 200))).toBe(false)
    // 锁定当前
    expect(store.shouldPromptEquipReplace(makeEquip('n', slot, 200), makeEquip('o', slot, 10, { isLocked: true }))).toBe(false)
  })
})
