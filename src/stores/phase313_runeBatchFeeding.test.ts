// @vitest-environment jsdom
/**
 * Phase 3.13 + Phase 3.13.1 — Rune 手动多材料吞噬、批量原子消费与锁定保护闭环
 *
 * 本文件仅覆盖批量吞噬核心（planner / 事务 / 单材料委托 / 锁定保护）与 UI 多选；
 * 不修改生产 planner / 事务（runeFeeding.ts / playerStore.ts），不修改 balance 公式与报告。
 *
 * 覆盖（§24-§32）：
 *   A. planRuneBatchFeeding 成功矩阵（2/3/N 材料混合稀有度精确求和 / 输入乱序等价 /
 *      planRuneExperienceGain 恰一次 / 锁定目标保持锁定 / 已镶嵌目标拓扑快照 /
 *      材料位置矩阵（全前/全后/夹杂）/ 输出数组冻结副本）
 *   B. 拒绝矩阵（materialRuneIds 非数组/空/非 string/空白/重复/含目标/稀疏 hole /
 *      targetRuneId 非法 / 目标或材料缺失 / 材料 level>1 / exp>0 / 锁定 / 已镶嵌 /
 *      目标满级 / inventory 损坏 / Proxy 抛异常不抛 / 无 RNG / 输入零修改 /
 *      任一材料不合格整体失败禁止跳过）
 *   C. 单材料兼容（planRuneFeeding 投影一致 / tryFeedRune 与 tryFeedRunes([m]) 行为等价）
 *   D. tryFeedRunes 批量原子事务成功（多材料消失目标正确前移 / 单次写盘 / 持久化 /
 *      乱序输入 consumedRuneIds 升序 / 锁定目标保持锁定 / 已镶嵌目标加成生效拓扑不变）
 *   E. 失败与回滚（单个坏材料整批零消耗 / save 抛异常完整回滚含锁定状态 / 恢复后重放成功）
 *   F. 事务级时变 inventory Proxy（每 raw index 至多读一次 / 第二次读取抛异常仍成功）
 *   G. 受控 planner override（批量 index 非法 / 非升序 / 同 ID 异字段 / 拓扑漂移 → 拒绝零写盘）
 *   H. UI 多选（逐枚勾选与取消 / aria-pressed / 摘要行 / 批量预览 / 确认恰一次批量事务 /
 *      失败保持面板与选择 / 单材料失效仅移除该 ID / 目标锁定切换面板保持 /
 *      追加 Rune 选择不漂移 / 无全选控件）
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
  planRuneBatchFeeding,
  planRuneFeeding,
  buildRuneTopologySnapshot,
  type RuneBatchFeedingPlan
} from '../utils/runeFeeding'
import { createEmptyEquipmentRuneSlots, getPlayerEquipmentRuneBonuses } from '../utils/equipmentRunes'
import { planRuneExperienceGain, RUNE_MAX_LEVEL } from '../utils/runeExperience'
import type { Equipment, EquipmentSlot, RuneSlot } from '../types'

// 批量 planner 受控 override（§G 对拍门测试用）：默认 null → 直通真实实现。
const plannerMockState = vi.hoisted(() => ({
  batchOverride: null as ((input: unknown) => unknown) | null
}))

// planRuneExperienceGain 调用计数（§8：批量规划恰好调用一次，禁止逐材料循环注入）。
const expGainCounter = vi.hoisted(() => ({ count: 0 }))

vi.mock('../utils/runeFeeding', async importOriginal => {
  const actual = await importOriginal<typeof import('../utils/runeFeeding')>()
  const patched: typeof actual = {
    ...actual,
    planRuneBatchFeeding: input =>
      plannerMockState.batchOverride
        ? (plannerMockState.batchOverride(input) as ReturnType<typeof actual.planRuneBatchFeeding>)
        : actual.planRuneBatchFeeding(input)
  }
  return patched
})

vi.mock('../utils/runeExperience', async importOriginal => {
  const actual = await importOriginal<typeof import('../utils/runeExperience')>()
  const patched: typeof actual = {
    ...actual,
    planRuneExperienceGain: (...args: Parameters<typeof actual.planRuneExperienceGain>) => {
      expGainCounter.count++
      return actual.planRuneExperienceGain(...args)
    }
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

/** 全字段对拍（含 Phase 3.12 isLocked 归一化：undefined 与 false 等价为未锁定）。 */
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
  expGainCounter.count = 0
})

afterEach(() => {
  plannerMockState.batchOverride = null
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

// ============================================================================
// A. planRuneBatchFeeding 成功矩阵
// ============================================================================
describe('Phase 3.13 — planRuneBatchFeeding 成功矩阵', () => {
  it('2 材料混合稀有度：expAdded 精确求和、materialIndices 升序、与升级公式对拍、输出冻结', () => {
    const target = makeRune('t1', { level: 2, exp: 0 })
    const inventory = [makeRune('m1', { rarity: 'rare' }), target, makeRune('m2', { rarity: 'epic' })]
    const plan = planRuneBatchFeeding({
      targetRuneId: 't1',
      materialRuneIds: ['m2', 'm1'],
      inventory,
      equipmentBySlot: {}
    })
    expect(plan.ok).toBe(true)
    if (!plan.ok) throw new Error('expected plan ok')

    expect(plan.expAdded).toBe(15 + 45)
    expect(plan.targetIndex).toBe(1)
    expect(plan.materialIndices).toEqual([0, 2])
    expect(plan.consumedRuneIds).toEqual(['m1', 'm2'])
    expect(plan.materialRunes.map(r => r.id)).toEqual(['m1', 'm2'])
    expect(plan.topologySnapshot.length).toBe(0)

    // 与唯一升级公式来源对拍
    const expected = planRuneExperienceGain(target, 60)
    if (!expected.ok) throw new Error('expected exp plan ok')
    expect(plan.nextTargetRune.level).toBe(expected.nextRune.level)
    expect(plan.nextTargetRune.exp).toBe(expected.nextRune.exp)
    expect(plan.nextTargetRune.statValue).toBe(expected.nextRune.statValue)
    expect(plan.levelsGained).toBe(expected.levelsGained)

    // 输出数组为冻结副本
    expect(Object.isFrozen(plan.materialIndices)).toBe(true)
    expect(Object.isFrozen(plan.materialRunes)).toBe(true)
    expect(Object.isFrozen(plan.consumedRuneIds)).toBe(true)
    expect(() => {
      ;(plan.materialIndices as number[]).push(99)
    }).toThrow()
  })

  it('输入乱序等价：["m3","m1","m2"] 与 ["m1","m2","m3"] 产出完全一致', () => {
    const inventory = [
      makeRune('m1', { rarity: 'common' }),
      makeRune('t1', { level: 3 }),
      makeRune('m2', { rarity: 'rare' }),
      makeRune('m3', { rarity: 'epic' })
    ]
    const planShuffled = planRuneBatchFeeding({
      targetRuneId: 't1',
      materialRuneIds: ['m3', 'm1', 'm2'],
      inventory,
      equipmentBySlot: {}
    })
    const planSorted = planRuneBatchFeeding({
      targetRuneId: 't1',
      materialRuneIds: ['m1', 'm2', 'm3'],
      inventory,
      equipmentBySlot: {}
    })
    expect(planShuffled.ok).toBe(true)
    expect(planSorted.ok).toBe(true)
    expect(planShuffled).toEqual(planSorted)
    if (!planShuffled.ok) throw new Error('expected plan ok')
    expect(planShuffled.materialIndices).toEqual([0, 2, 3])
    expect(planShuffled.consumedRuneIds).toEqual(['m1', 'm2', 'm3'])
    expect(planShuffled.expAdded).toBe(5 + 15 + 45)
  })

  it('N 材料：6 枚 common 精确求和 30，planRuneExperienceGain 恰好调用一次（禁止逐材料注入）', () => {
    const inventory: Rune[] = [makeRune('t1', { level: 1, exp: 0 })]
    const ids: string[] = []
    for (let i = 1; i <= 6; i++) {
      inventory.push(makeRune(`m${i}`, { rarity: 'common' }))
      ids.push(`m${i}`)
    }
    expGainCounter.count = 0
    const plan = planRuneBatchFeeding({
      targetRuneId: 't1',
      materialRuneIds: ids,
      inventory,
      equipmentBySlot: {}
    })
    expect(plan.ok).toBe(true)
    if (!plan.ok) throw new Error('expected plan ok')
    expect(plan.expAdded).toBe(30)
    expect(plan.materialIndices).toEqual([1, 2, 3, 4, 5, 6])
    // §8 核心门：唯一升级公式来源恰好调用一次
    expect(expGainCounter.count).toBe(1)
  })

  it('锁定目标允许强化且 nextTargetRune 保持锁定；未锁定目标不得被顺带加锁', () => {
    const lockedTarget = makeRune('t1', { level: 3, isLocked: true })
    const planLocked = planRuneBatchFeeding({
      targetRuneId: 't1',
      materialRuneIds: ['m1', 'm2'],
      inventory: [lockedTarget, makeRune('m1'), makeRune('m2', { rarity: 'rare' })],
      equipmentBySlot: {}
    })
    expect(planLocked.ok).toBe(true)
    if (!planLocked.ok) throw new Error('expected plan ok')
    expect(planLocked.nextTargetRune.isLocked).toBe(true)
    expect(planLocked.expAdded).toBe(20)

    const planUnlocked = planRuneBatchFeeding({
      targetRuneId: 't2',
      materialRuneIds: ['m3'],
      inventory: [makeRune('t2', { level: 2 }), makeRune('m3')],
      equipmentBySlot: {}
    })
    expect(planUnlocked.ok).toBe(true)
    if (!planUnlocked.ok) throw new Error('expected plan ok')
    expect(planUnlocked.nextTargetRune.isLocked === true).toBe(false)
  })

  it('已镶嵌目标允许强化，topologySnapshot 精确记录引用位置', () => {
    const inventory = [makeRune('t1', { level: 2 }), makeRune('m1'), makeRune('m2', { rarity: 'rare' })]
    const equipment = { [SLOT_A]: makeRuneEquip('eq1', SLOT_A, { runeSlots: slotsWith('t1') }) }
    const plan = planRuneBatchFeeding({
      targetRuneId: 't1',
      materialRuneIds: ['m1', 'm2'],
      inventory,
      equipmentBySlot: equipment
    })
    expect(plan.ok).toBe(true)
    if (!plan.ok) throw new Error('expected plan ok')
    expect(plan.topologySnapshot).toEqual([{ runeId: 't1', equipmentSlot: SLOT_A, runeSlotIndex: 0 }])
  })

  it('材料位置矩阵：全在目标前 / 全在目标后 / 前后夹杂，index 全部正确', () => {
    // 全在目标前
    const before = planRuneBatchFeeding({
      targetRuneId: 't1',
      materialRuneIds: ['m1', 'm2'],
      inventory: [makeRune('m1'), makeRune('m2', { type: 'crit' }), makeRune('t1', { level: 2 })],
      equipmentBySlot: {}
    })
    expect(before.ok).toBe(true)
    if (!before.ok) throw new Error('expected plan ok')
    expect(before.targetIndex).toBe(2)
    expect(before.materialIndices).toEqual([0, 1])

    // 全在目标后
    const after = planRuneBatchFeeding({
      targetRuneId: 't1',
      materialRuneIds: ['m1', 'm2'],
      inventory: [makeRune('t1', { level: 2 }), makeRune('m1'), makeRune('m2', { type: 'crit' })],
      equipmentBySlot: {}
    })
    expect(after.ok).toBe(true)
    if (!after.ok) throw new Error('expected plan ok')
    expect(after.targetIndex).toBe(0)
    expect(after.materialIndices).toEqual([1, 2])

    // 前后夹杂
    const split = planRuneBatchFeeding({
      targetRuneId: 't1',
      materialRuneIds: ['m2', 'm1'],
      inventory: [makeRune('m1'), makeRune('t1', { level: 2 }), makeRune('m2', { type: 'crit' })],
      equipmentBySlot: {}
    })
    expect(split.ok).toBe(true)
    if (!split.ok) throw new Error('expected plan ok')
    expect(split.targetIndex).toBe(1)
    expect(split.materialIndices).toEqual([0, 2])
  })
})

// ============================================================================
// B. 拒绝矩阵
// ============================================================================
describe('Phase 3.13 — planRuneBatchFeeding 拒绝矩阵', () => {
  function baseInventory(): Rune[] {
    return [makeRune('t1', { level: 2 }), makeRune('m1'), makeRune('m2', { rarity: 'rare' })]
  }

  function expectFail(materialRuneIds: unknown, reason?: string, inventory?: unknown) {
    const plan = planRuneBatchFeeding({
      targetRuneId: 't1',
      materialRuneIds,
      inventory: inventory ?? baseInventory(),
      equipmentBySlot: {}
    })
    expect(plan.ok).toBe(false)
    if (plan.ok) throw new Error('expected rejection')
    if (reason !== undefined) expect(plan.reason).toBe(reason)
  }

  it('materialRuneIds 非数组 / 空数组 → 拒绝', () => {
    expectFail(null, 'materialRuneIds must be an array')
    expectFail(undefined, 'materialRuneIds must be an array')
    expectFail('m1', 'materialRuneIds must be an array')
    expectFail({ 0: 'm1', length: 1 }, 'materialRuneIds must be an array')
    expectFail([], 'materialRuneIds must contain at least one id')
  })

  it('元素非 string / trim 空 / 重复 / 含目标 / 稀疏 hole → 拒绝', () => {
    expectFail([42], 'material rune id must be a string')
    expectFail([null], 'material rune id must be a string')
    expectFail([undefined], 'material rune id must be a string')
    expectFail(['m1', 7], 'material rune id must be a string')
    expectFail(['   '], 'material rune id must be non-empty after trim')
    expectFail(['m1', 'm1'], 'materialRuneIds contains duplicate canonical id')
    expectFail([' m1 ', 'm1'], 'materialRuneIds contains duplicate canonical id')
    expectFail(['t1'], 'target and material must be different runes')
    expectFail(['m1', ' t1 '], 'target and material must be different runes')
    const sparse = new Array<string>(2)
    sparse[1] = 'm1'
    expectFail(sparse, 'material rune id must be a string')
  })

  it('targetRuneId 非法 / 目标缺失 / 材料缺失 → 拒绝', () => {
    const plan1 = planRuneBatchFeeding({
      targetRuneId: 42,
      materialRuneIds: ['m1'],
      inventory: baseInventory(),
      equipmentBySlot: {}
    })
    expect(plan1.ok).toBe(false)
    if (plan1.ok) throw new Error('expected rejection')
    expect(plan1.reason).toBe('targetRuneId must be a string')

    const plan2 = planRuneBatchFeeding({
      targetRuneId: '  ',
      materialRuneIds: ['m1'],
      inventory: baseInventory(),
      equipmentBySlot: {}
    })
    expect(plan2.ok).toBe(false)
    if (plan2.ok) throw new Error('expected rejection')
    expect(plan2.reason).toBe('targetRuneId must be non-empty after trim')

    const plan3 = planRuneBatchFeeding({
      targetRuneId: 'missing',
      materialRuneIds: ['m1'],
      inventory: baseInventory(),
      equipmentBySlot: {}
    })
    expect(plan3.ok).toBe(false)
    if (plan3.ok) throw new Error('expected rejection')
    expect(plan3.reason).toBe('target rune not found in inventory')

    expectFail(['ghost'], 'material rune not found in inventory')
    expectFail(['m1', 'ghost'], 'material rune not found in inventory')
  })

  it('材料资格：level>1 / exp>0 / 锁定 / 已镶嵌 → 拒绝；任一材料不合格整体失败（禁止跳过）', () => {
    expectFail(['bad'], 'material rune must be level 1', [
      makeRune('t1', { level: 2 }),
      makeRune('bad', { level: 2 })
    ])
    expectFail(['bad'], 'material rune must have zero exp', [
      makeRune('t1', { level: 2 }),
      makeRune('bad', { exp: 1 })
    ])
    expectFail(['bad'], 'material rune is locked', [
      makeRune('t1', { level: 2 }),
      makeRune('bad', { isLocked: true })
    ])

    // 已镶嵌材料
    const embeddedPlan = planRuneBatchFeeding({
      targetRuneId: 't1',
      materialRuneIds: ['bad'],
      inventory: [makeRune('t1', { level: 2 }), makeRune('bad')],
      equipmentBySlot: { [SLOT_A]: makeRuneEquip('eq1', SLOT_A, { runeSlots: slotsWith('bad') }) }
    })
    expect(embeddedPlan.ok).toBe(false)
    if (embeddedPlan.ok) throw new Error('expected rejection')
    expect(embeddedPlan.reason).toBe('material rune is embedded in equipment')

    // 两好一坏 → 整体失败（禁止只消费好材料）
    expectFail(['m1', 'm2', 'bad'], 'material rune is locked', [
      makeRune('t1', { level: 2 }),
      makeRune('m1'),
      makeRune('m2', { rarity: 'rare' }),
      makeRune('bad', { isLocked: true })
    ])
  })

  it('目标满级 / inventory 损坏 → 拒绝', () => {
    expectFail(['m1'], 'target rune already at max level', [
      makeRune('t1', { level: RUNE_MAX_LEVEL }),
      makeRune('m1')
    ])
    // inventory 重复 ID → validateRuneInventory 拒绝
    const plan = planRuneBatchFeeding({
      targetRuneId: 't1',
      materialRuneIds: ['m1'],
      inventory: [makeRune('t1', { level: 2 }), makeRune('m1'), makeRune('m1')],
      equipmentBySlot: {}
    })
    expect(plan.ok).toBe(false)
    if (plan.ok) throw new Error('expected rejection')
    expect(plan.reason.startsWith('rune inventory invalid')).toBe(true)
  })

  it('Proxy 抛异常输入 → 不抛且 fail-closed', () => {
    const trapInventory = new Proxy(
      {},
      {
        get() {
          throw new Error('trap')
        }
      }
    )
    expect(() =>
      planRuneBatchFeeding({
        targetRuneId: 't1',
        materialRuneIds: ['m1'],
        inventory: trapInventory,
        equipmentBySlot: {}
      })
    ).not.toThrow()

    const trapIds = new Proxy(['m1'], {
      get(t, prop, receiver) {
        if (prop === '0') throw new Error('trap')
        return Reflect.get(t, prop, receiver)
      }
    })
    let plan: RuneBatchFeedingPlan | null = null
    expect(() => {
      plan = planRuneBatchFeeding({
        targetRuneId: 't1',
        materialRuneIds: trapIds,
        inventory: baseInventory(),
        equipmentBySlot: {}
      })
    }).not.toThrow()
    expect(plan!.ok).toBe(false)
  })

  it('成功规划无 RNG 且零修改输入（inventory / materialRuneIds）', () => {
    const inventory = baseInventory()
    const ids = ['m2', 'm1']
    const invBefore = inventory.map(r => ({ ...r }))
    const idsBefore = ids.slice()
    const randomSpy = vi.spyOn(Math, 'random')

    const plan = planRuneBatchFeeding({
      targetRuneId: 't1',
      materialRuneIds: ids,
      inventory,
      equipmentBySlot: {}
    })
    expect(plan.ok).toBe(true)
    expect(randomSpy).not.toHaveBeenCalled()
    expect(ids).toEqual(idsBefore)
    expect(inventory.length).toBe(invBefore.length)
    for (let i = 0; i < inventory.length; i++) {
      expect(runeEquals(inventory[i], invBefore[i])).toBe(true)
    }
  })
})

// ============================================================================
// C. 单材料兼容（§10/§12 收口）
// ============================================================================
describe('Phase 3.13 — 单材料 API 收口兼容', () => {
  it('planRuneFeeding 与 planRuneBatchFeeding([m]) 投影字段完全一致', () => {
    const inventory = [makeRune('m1', { rarity: 'epic' }), makeRune('t1', { level: 2 })]
    const single = planRuneFeeding({
      targetRuneId: 't1',
      materialRuneId: 'm1',
      inventory,
      equipmentBySlot: {}
    })
    const batch = planRuneBatchFeeding({
      targetRuneId: 't1',
      materialRuneIds: ['m1'],
      inventory,
      equipmentBySlot: {}
    })
    expect(single.ok).toBe(true)
    expect(batch.ok).toBe(true)
    if (!single.ok || !batch.ok) throw new Error('expected plans ok')
    expect(single.targetIndex).toBe(batch.targetIndex)
    expect(single.materialIndex).toBe(batch.materialIndices[0])
    expect(runeEquals(single.targetRune, batch.targetRune)).toBe(true)
    expect(runeEquals(single.materialRune, batch.materialRunes[0])).toBe(true)
    expect(runeEquals(single.nextTargetRune, batch.nextTargetRune)).toBe(true)
    expect(single.expAdded).toBe(batch.expAdded)
    expect(single.levelsGained).toBe(batch.levelsGained)
    expect(single.topologySnapshot).toEqual(batch.topologySnapshot)
  })

  it('planRuneFeeding 拒绝语义不变：锁定材料 / 自吞 / 非法 materialRuneId', () => {
    const inventory = [makeRune('t1', { level: 2 }), makeRune('m1', { isLocked: true })]
    const locked = planRuneFeeding({ targetRuneId: 't1', materialRuneId: 'm1', inventory, equipmentBySlot: {} })
    expect(locked.ok).toBe(false)
    if (locked.ok) throw new Error('expected rejection')
    expect(locked.reason).toBe('material rune is locked')

    const self = planRuneFeeding({ targetRuneId: 't1', materialRuneId: 't1', inventory, equipmentBySlot: {} })
    expect(self.ok).toBe(false)

    const bad = planRuneFeeding({ targetRuneId: 't1', materialRuneId: 42, inventory, equipmentBySlot: {} })
    expect(bad.ok).toBe(false)
    if (bad.ok) throw new Error('expected rejection')
    expect(bad.reason).toBe('materialRuneId must be a string')
  })

  it('tryFeedRune 与 tryFeedRunes(target, [m]) 行为完全等价（结果投影 + 终态 inventory）', () => {
    // 第一轮：tryFeedRune
    const store1 = usePlayerStore()
    store1.runeInventory = [makeRune('t1', { level: 2 }), makeRune('m1', { rarity: 'rare' })]
    const res1 = store1.tryFeedRune('t1', 'm1')
    expect(res1.ok).toBe(true)
    const final1 = store1.runeInventory.map(r => ({ ...r }))

    // 第二轮：全新 Pinia 相同初态，tryFeedRunes 单材料
    setActivePinia(createPinia())
    localStorage.clear()
    warmupStores()
    const store2 = usePlayerStore()
    store2.runeInventory = [makeRune('t1', { level: 2 }), makeRune('m1', { rarity: 'rare' })]
    const res2 = store2.tryFeedRunes('t1', ['m1'])
    expect(res2.ok).toBe(true)
    if (!res2.ok) throw new Error('expected ok')
    expect(res2.expAdded).toBe(res1.expAdded)
    expect(res2.levelsGained).toBe(res1.levelsGained)
    expect(res2.level).toBe(res1.level)
    expect(res2.exp).toBe(res1.exp)
    expect(res2.materialsConsumed).toBe(1)
    expect(res2.consumedRuneIds).toEqual(['m1'])

    const final2 = store2.runeInventory
    expect(final2.length).toBe(final1.length)
    for (let i = 0; i < final1.length; i++) {
      expect(runeEquals(final2[i], final1[i])).toBe(true)
    }
  })
})

// ============================================================================
// D. tryFeedRunes 批量原子事务成功
// ============================================================================
describe('Phase 3.13 — tryFeedRunes 批量事务成功', () => {
  it('3 材料前后夹杂：全部消失、目标正确前移替换、其他不变、单次写盘、持久化、乱序输入 consumedRuneIds 升序', () => {
    const playerStore = usePlayerStore()
    const target = makeRune('t1', { level: 2, exp: 0 })
    const other = makeRune('o1', { type: 'defense', level: 5, statValue: 8 })
    playerStore.runeInventory = [
      makeRune('m1', { rarity: 'common' }), // idx0（目标前 → 目标前移 1）
      other, // idx1
      target, // idx2 → 终态 idx1
      makeRune('m2', { rarity: 'rare', type: 'crit' }), // idx3
      makeRune('m3', { rarity: 'epic', type: 'speed' }) // idx4
    ]

    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    const res = playerStore.tryFeedRunes('t1', ['m3', 'm1', 'm2'])
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error('expected ok')
    expect(res.expAdded).toBe(5 + 15 + 45)
    expect(res.materialsConsumed).toBe(3)
    expect(res.consumedRuneIds).toEqual(['m1', 'm2', 'm3'])

    const expected = planRuneExperienceGain(target, 65)
    if (!expected.ok) throw new Error('expected exp plan ok')
    expect(res.levelsGained).toBe(expected.levelsGained)
    expect(res.level).toBe(expected.nextRune.level)
    expect(res.exp).toBe(expected.nextRune.exp)

    // 终态：长度 5-3=2、目标前移到 idx1、other 保持 idx0
    expect(playerStore.runeInventory.length).toBe(2)
    expect(runeEquals(playerStore.runeInventory[0], other)).toBe(true)
    expect(runeEquals(playerStore.runeInventory[1], expected.nextRune)).toBe(true)
    expect(playerStore.runeInventory.some(r => r.id.startsWith('m'))).toBe(false)

    // 主存档恰好写一次
    expect(setItemSpy.mock.calls.filter(c => c[0] === SAVE_KEY).length).toBe(1)

    // 持久化：重建 Pinia 后 loadGame 恢复吞噬后状态
    setActivePinia(createPinia())
    warmupStores()
    const reloaded = usePlayerStore()
    reloaded.loadGame()
    expect(reloaded.runeInventory.length).toBe(2)
    const reloadedTarget = reloaded.runeInventory.find(r => r.id === 't1')
    expect(reloadedTarget).toBeTruthy()
    expect(reloadedTarget!.level).toBe(expected.nextRune.level)
    expect(reloadedTarget!.exp).toBe(expected.nextRune.exp)
  })

  it('材料全在目标后：目标 index 不前移；锁定目标批量强化成功且保持锁定', () => {
    const playerStore = usePlayerStore()
    const target = makeRune('t1', { level: 3, isLocked: true })
    playerStore.runeInventory = [target, makeRune('m1'), makeRune('m2', { rarity: 'legend' })]

    const res = playerStore.tryFeedRunes('t1', ['m1', 'm2'])
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error('expected ok')
    expect(res.expAdded).toBe(5 + 135)
    expect(playerStore.runeInventory.length).toBe(1)
    expect(playerStore.runeInventory[0].id).toBe('t1')
    // 锁定目标保持锁定
    expect(playerStore.runeInventory[0].isLocked).toBe(true)
    expect(playerStore.runeInventory[0].level).toBeGreaterThan(3)
  })

  it('已镶嵌目标批量升级：聚合符文加成立即变化、装备拓扑完全不变', () => {
    const playerStore = usePlayerStore()
    playerStore.runeInventory = [
      makeRune('t1', { type: 'attack', level: 1, statValue: 10 }),
      makeRune('m1', { rarity: 'legend' }),
      makeRune('m2', { rarity: 'epic' })
    ]
    playerStore.player.equipment[SLOT_A] = makeRuneEquip('eq1', SLOT_A, { runeSlots: slotsWith('t1') })

    const bonusBefore = getPlayerEquipmentRuneBonuses(playerStore.player.equipment, playerStore.runeInventory)
    const res = playerStore.tryFeedRunes('t1', ['m1', 'm2'])
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error('expected ok')
    expect(res.levelsGained).toBeGreaterThan(0)

    const bonusAfter = getPlayerEquipmentRuneBonuses(playerStore.player.equipment, playerStore.runeInventory)
    const attackBefore = bonusBefore.find(b => b.type === 'attack')?.value ?? 0
    const attackAfter = bonusAfter.find(b => b.type === 'attack')?.value ?? 0
    expect(attackAfter).toBeGreaterThan(attackBefore)

    const eq = playerStore.player.equipment[SLOT_A]!
    expect(eq.runeSlots[0].runeId).toBe('t1')
    expect(eq.runeSlots[1].runeId).toBeNull()
    expect(eq.runeSlots[2].runeId).toBeNull()
  })
})

// ============================================================================
// E. tryFeedRunes 失败与回滚
// ============================================================================
describe('Phase 3.13 — tryFeedRunes 失败与整批回滚', () => {
  it('任一材料不合格（锁定）→ 整批零消耗零写盘（好材料也绝不被消费）', () => {
    const playerStore = usePlayerStore()
    playerStore.runeInventory = [
      makeRune('t1', { level: 2 }),
      makeRune('m1'),
      makeRune('m2', { isLocked: true })
    ]
    const before = playerStore.runeInventory.map(r => ({ ...r }))
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')

    const res = playerStore.tryFeedRunes('t1', ['m1', 'm2'])
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('expected rejection')
    expect(res.reason).toBe('material rune is locked')
    expect(res.expAdded).toBe(0)
    expect(res.levelsGained).toBe(0)
    expect(res.materialsConsumed).toBe(0)
    expect(res.consumedRuneIds).toEqual([])

    expect(playerStore.runeInventory.length).toBe(3)
    for (let i = 0; i < before.length; i++) {
      expect(runeEquals(playerStore.runeInventory[i], before[i])).toBe(true)
    }
    expect(setItemSpy.mock.calls.filter(c => c[0] === SAVE_KEY).length).toBe(0)
  })

  it('空数组 / 重复 ID / 含目标 → 拒绝零写盘', () => {
    const playerStore = usePlayerStore()
    playerStore.runeInventory = [makeRune('t1', { level: 2 }), makeRune('m1')]
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')

    expect(playerStore.tryFeedRunes('t1', []).ok).toBe(false)
    expect(playerStore.tryFeedRunes('t1', ['m1', 'm1']).ok).toBe(false)
    expect(playerStore.tryFeedRunes('t1', ['t1']).ok).toBe(false)

    expect(playerStore.runeInventory.length).toBe(2)
    expect(setItemSpy.mock.calls.filter(c => c[0] === SAVE_KEY).length).toBe(0)
  })

  it('saveGame 抛异常 → 完整回滚（材料全回原位置、目标与锁定状态还原、顺序还原）', () => {
    const playerStore = usePlayerStore()
    playerStore.runeInventory = [
      makeRune('m1', { rarity: 'common' }),
      makeRune('t1', { level: 2, isLocked: true }),
      makeRune('o1', { type: 'defense', level: 4 }),
      makeRune('m2', { rarity: 'legend' })
    ]
    const before = playerStore.runeInventory.map(r => ({ ...r }))

    installThrowingStorage()
    const res = playerStore.tryFeedRunes('t1', ['m2', 'm1'])
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('expected rejection')
    expect(res.reason).toBe('save failed')
    expect(res.materialsConsumed).toBe(0)
    expect(res.consumedRuneIds).toEqual([])

    expect(playerStore.runeInventory.length).toBe(4)
    for (let i = 0; i < before.length; i++) {
      expect(runeEquals(playerStore.runeInventory[i], before[i])).toBe(true)
    }
    // 锁定状态精确还原
    expect(playerStore.runeInventory[1].isLocked).toBe(true)
  })

  it('save 失败后磁盘原字符串不变；恢复 storage 后同一批事务可成功重放', () => {
    const playerStore = usePlayerStore()
    playerStore.runeInventory = [makeRune('t1', { level: 2 }), makeRune('m1'), makeRune('m2', { rarity: 'rare' })]
    playerStore.saveGame()
    const diskBefore = localStorage.getItem(SAVE_KEY)

    installThrowingStorage()
    expect(playerStore.tryFeedRunes('t1', ['m1', 'm2']).ok).toBe(false)
    vi.unstubAllGlobals()

    expect(localStorage.getItem(SAVE_KEY)).toBe(diskBefore)

    const res = playerStore.tryFeedRunes('t1', ['m1', 'm2'])
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error('expected ok')
    expect(res.materialsConsumed).toBe(2)
    expect(playerStore.runeInventory.length).toBe(1)
    expect(playerStore.runeInventory[0].id).toBe('t1')
  })
})

// ============================================================================
// F. 事务级时变 inventory Proxy（§13 单稳定快照）
// ============================================================================
describe('Phase 3.13 — tryFeedRunes 时变 inventory Proxy', () => {
  it('legend→common 时变材料：每个 raw index 恰读一次，按第一次稳定快照结算 150 EXP', () => {
    const playerStore = usePlayerStore()
    const target = makeRune('t1', { level: 1, exp: 0 })
    const m1 = makeRune('m1', { rarity: 'rare' })
    const legendM2 = makeRune('m2', { rarity: 'legend' })
    const commonM2 = makeRune('m2', { rarity: 'common' })
    const reads: Record<string, number> = {}
    const proxy = new Proxy([target, m1, legendM2], {
      get(t, prop, receiver) {
        if (typeof prop === 'string' && /^\d+$/.test(prop)) {
          reads[prop] = (reads[prop] ?? 0) + 1
          if (prop === '2' && reads[prop] > 1) return commonM2
        }
        return Reflect.get(t, prop, receiver)
      }
    })
    playerStore.runeInventory = proxy as unknown as Rune[]

    const res = playerStore.tryFeedRunes('t1', ['m1', 'm2'])
    expect(reads['0']).toBe(1)
    expect(reads['1']).toBe(1)
    expect(reads['2']).toBe(1)
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error('expected ok')
    // 基于第一次快照：rare 15 + legend 135 = 150（绝不出现「消耗 common、获得 135」）
    expect(res.expAdded).toBe(150)
    expect(playerStore.runeInventory.length).toBe(1)
    expect(playerStore.runeInventory[0].id).toBe('t1')
  })

  it('第二次 raw 读取直接抛异常：事务不抛且等价于单次快照成功', () => {
    const playerStore = usePlayerStore()
    const target = makeRune('t1', { level: 2 })
    const m1 = makeRune('m1', { rarity: 'common' })
    const m2 = makeRune('m2', { rarity: 'rare' })
    const counts: Record<string, number> = {}
    const proxy = new Proxy([target, m1, m2], {
      get(t, prop, receiver) {
        if (typeof prop === 'string' && /^\d+$/.test(prop)) {
          counts[prop] = (counts[prop] ?? 0) + 1
          if (counts[prop] > 1) throw new Error(`second raw read of index ${prop}`)
        }
        return Reflect.get(t, prop, receiver)
      }
    })
    playerStore.runeInventory = proxy as unknown as Rune[]

    let res: ReturnType<typeof playerStore.tryFeedRunes> | null = null
    expect(() => {
      res = playerStore.tryFeedRunes('t1', ['m1', 'm2'])
    }).not.toThrow()
    expect(res!.ok).toBe(true)
    expect(res!.expAdded).toBe(20)
    expect(playerStore.runeInventory.length).toBe(1)
    expect(playerStore.runeInventory[0].id).toBe('t1')
  })
})

// ============================================================================
// G. planner index / 快照 / 拓扑对拍门（受控批量 override）
// ============================================================================
describe('Phase 3.13 — 批量 planner 对拍门（受控 override）', () => {
  type OkBatchPlan = Extract<RuneBatchFeedingPlan, { ok: true }>

  function seedAndRealPlan() {
    const playerStore = usePlayerStore()
    playerStore.runeInventory = [
      makeRune('m1', { rarity: 'common' }),
      makeRune('t1', { level: 2 }),
      makeRune('m2', { rarity: 'rare' })
    ]
    const real = planRuneBatchFeeding({
      targetRuneId: 't1',
      materialRuneIds: ['m1', 'm2'],
      inventory: playerStore.runeInventory.map(r => ({ ...r })),
      equipmentBySlot: playerStore.player.equipment
    })
    expect(real.ok).toBe(true)
    if (!real.ok) throw new Error('expected real plan ok')
    return { playerStore, real: real as OkBatchPlan }
  }

  function expectRejected(
    playerStore: ReturnType<typeof usePlayerStore>,
    crafted: RuneBatchFeedingPlan,
    reason: string
  ) {
    const before = playerStore.runeInventory.map(r => ({ ...r }))
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    plannerMockState.batchOverride = () => crafted
    const res = playerStore.tryFeedRunes('t1', ['m1', 'm2'])
    plannerMockState.batchOverride = null
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('expected rejection')
    expect(res.reason).toBe(reason)
    expect(res.materialsConsumed).toBe(0)
    expect(playerStore.runeInventory.length).toBe(before.length)
    for (let i = 0; i < before.length; i++) {
      expect(runeEquals(playerStore.runeInventory[i], before[i]!)).toBe(true)
    }
    expect(setItemSpy.mock.calls.filter(c => c[0] === SAVE_KEY).length).toBe(0)
    setItemSpy.mockRestore()
  }

  it('materialIndices 含 targetIndex → 拒绝零写盘', () => {
    const { playerStore, real } = seedAndRealPlan()
    expectRejected(
      playerStore,
      { ...real, materialIndices: [real.targetIndex, real.materialIndices[1]] },
      'plan index invalid'
    )
  })

  it('materialIndices 非严格升序 → 拒绝零写盘', () => {
    const { playerStore, real } = seedAndRealPlan()
    expectRejected(
      playerStore,
      {
        ...real,
        materialIndices: [real.materialIndices[1], real.materialIndices[0]],
        materialRunes: [real.materialRunes[1], real.materialRunes[0]],
        consumedRuneIds: [real.consumedRuneIds[1], real.consumedRuneIds[0]]
      },
      'plan index invalid'
    )
  })

  it('materialRunes 同 ID 异字段（planner 见 legend、快照为 rare）→ 拒绝零写盘', () => {
    const { playerStore, real } = seedAndRealPlan()
    expectRejected(
      playerStore,
      {
        ...real,
        materialRunes: [real.materialRunes[0], { ...real.materialRunes[1], rarity: 'legend' }],
        expAdded: 5 + 135
      },
      'plan material rune does not match snapshot'
    )
  })

  it('targetRune 同 ID 异字段 → 拒绝零写盘', () => {
    const { playerStore, real } = seedAndRealPlan()
    expectRejected(
      playerStore,
      { ...real, targetRune: { ...real.targetRune, statValue: 999 } },
      'plan target rune does not match snapshot'
    )
  })

  it('拓扑快照漂移（planner 快照含幽灵引用）→ 拒绝零写盘', () => {
    const { playerStore, real } = seedAndRealPlan()
    expectRejected(
      playerStore,
      {
        ...real,
        topologySnapshot: buildRuneTopologySnapshot(new Map([['t1', [{ slot: SLOT_A, index: 0 }]]]))
      },
      'rune reference topology changed since planning'
    )
  })
})

// ============================================================================
// H. UI 多选（§18-§23）与 Phase 3.13.1 收口（§7-§12：单一经验来源 / 0 选择展示 / 动态 aria-label / 筛选隐藏后 canonical 选择 / 事务抛异常）
// ============================================================================
describe('Phase 3.13 — 强化面板多选 UI', () => {
  function seedInventory(runes: Rune[]) {
    const playerStore = usePlayerStore()
    playerStore.runeInventory = runes
    return playerStore
  }

  /** 默认三件套：目标 t1（普通攻击 Lv.2）+ 候选 c1（稀有暴击）/ c2（史诗速度）。 */
  function seedDefault() {
    return seedInventory([
      makeRune('t1', { level: 2 }),
      makeRune('c1', { type: 'crit', rarity: 'rare' }),
      makeRune('c2', { type: 'speed', rarity: 'epic' })
    ])
  }

  async function openPanel(wrapper: ReturnType<typeof mount>) {
    await findByAriaPrefix(wrapper, '强化 普通攻击符文')!.trigger('click')
    await nextTick()
  }

  it('逐枚勾选/取消：aria-pressed 与 aria-label 状态语义完整、无全选控件', async () => {
    seedDefault()
    const wrapper = mount(RuneInventoryTab)
    await nextTick()
    await openPanel(wrapper)

    const selectBtn = findByAriaPrefix(wrapper, '选择材料 稀有暴击符文')!
    expect(selectBtn.attributes('aria-label')).toBe('选择材料 稀有暴击符文，提供 15 经验，当前未选中')
    expect(selectBtn.attributes('aria-pressed')).toBe('false')
    expect(selectBtn.attributes('data-selected')).toBe('false')

    await selectBtn.trigger('click')
    await nextTick()
    const unselectBtn = findByAriaPrefix(wrapper, '取消选择材料 稀有暴击符文')!
    expect(unselectBtn.attributes('aria-label')).toBe('取消选择材料 稀有暴击符文，提供 15 经验，当前已选中')
    expect(unselectBtn.attributes('aria-pressed')).toBe('true')
    expect(unselectBtn.attributes('data-selected')).toBe('true')

    await unselectBtn.trigger('click')
    await nextTick()
    expect(findByAriaPrefix(wrapper, '选择材料 稀有暴击符文')!.attributes('aria-pressed')).toBe('false')
    // §7 修正：取消最后一枚后摘要仍存在（§4/§22：count=0 仍显示，不得从 DOM 消失）
    const cleared = wrapper.find('.feed-selection-summary')
    expect(cleared.exists()).toBe(true)
    expect(cleared.text()).toContain('已选 0 枚')
    expect(cleared.text()).toContain('总计 +0 EXP')
    const confirmAfter = findByAriaPrefix(wrapper, '确认强化')!
    expect(confirmAfter.attributes('disabled')).toBeDefined()
    expect(confirmAfter.attributes('aria-label')).toBe('确认强化，将永久消耗 0 枚材料')

    // §19：无全选 / 一键 / 自动选择控件
    expect(wrapper.text()).not.toContain('全选')
    expect(wrapper.text()).not.toContain('一键')
  })

  it('多选两枚：摘要行显示枚数/总经验/永久消耗警示，预览按批量计划求和且消耗名单按仓库顺序', async () => {
    seedDefault()
    const wrapper = mount(RuneInventoryTab)
    await nextTick()
    await openPanel(wrapper)

    // 先选 c2（史诗速度）再选 c1（稀有暴击）——顺序故意与仓库顺序相反
    await findByAriaPrefix(wrapper, '选择材料 史诗速度符文')!.trigger('click')
    await nextTick()
    await findByAriaPrefix(wrapper, '选择材料 稀有暴击符文')!.trigger('click')
    await nextTick()

    const summary = wrapper.find('.feed-selection-summary')
    expect(summary.exists()).toBe(true)
    expect(summary.text()).toContain('已选 2 枚')
    expect(summary.text()).toContain('总计 +60 EXP')
    expect(summary.text()).toContain('确认后将永久消耗 2 枚材料')

    const preview = wrapper.find('[aria-label="强化预览"]')
    expect(preview.exists()).toBe(true)
    expect(preview.text()).toContain('获得：+60 EXP')
    // 消耗名单按 inventoryIndex 升序：c1（稀有暴击）在 c2（史诗速度）之前
    expect(preview.text()).toContain('消耗：稀有暴击符文、史诗速度符文')
  })

  it('确认 → 恰好一次批量事务（选择顺序原样传递）、成功后面板关闭、材料全部消失', async () => {
    const playerStore = seedDefault()
    const feedSpy = vi.spyOn(playerStore, 'tryFeedRunes')
    const wrapper = mount(RuneInventoryTab)
    await nextTick()
    await openPanel(wrapper)

    await findByAriaPrefix(wrapper, '选择材料 史诗速度符文')!.trigger('click')
    await nextTick()
    await findByAriaPrefix(wrapper, '选择材料 稀有暴击符文')!.trigger('click')
    await nextTick()
    await findByAriaPrefix(wrapper, '确认强化')!.trigger('click')
    await nextTick()

    expect(feedSpy).toHaveBeenCalledTimes(1)
    expect(feedSpy).toHaveBeenCalledWith('t1', ['c2', 'c1'])

    expect(wrapper.text()).toContain('强化成功')
    expect(wrapper.text()).toContain('消耗 2 枚材料')
    expect(wrapper.find('[aria-label="强化符文"]').exists()).toBe(false)
    expect(playerStore.runeInventory.length).toBe(1)
    expect(playerStore.runeInventory[0].id).toBe('t1')

    const expected = planRuneExperienceGain(makeRune('t1', { level: 2 }), 60)
    if (!expected.ok) throw new Error('expected exp plan ok')
    expect(playerStore.runeInventory[0].level).toBe(expected.nextRune.level)
    expect(playerStore.runeInventory[0].exp).toBe(expected.nextRune.exp)
  })

  it('事务失败（mock ok:false）→ 面板保持打开、选择完整保留、绝不显示成功', async () => {
    const playerStore = seedDefault()
    vi.spyOn(playerStore, 'tryFeedRunes').mockReturnValue({
      ok: false,
      reason: 'save failed',
      expAdded: 0,
      levelsGained: 0,
      materialsConsumed: 0,
      consumedRuneIds: []
    })
    const wrapper = mount(RuneInventoryTab)
    await nextTick()
    await openPanel(wrapper)

    await findByAriaPrefix(wrapper, '选择材料 稀有暴击符文')!.trigger('click')
    await nextTick()
    await findByAriaPrefix(wrapper, '选择材料 史诗速度符文')!.trigger('click')
    await nextTick()
    await findByAriaPrefix(wrapper, '确认强化')!.trigger('click')
    await nextTick()

    expect(wrapper.text()).toContain('强化失败')
    expect(wrapper.text()).not.toContain('强化成功')
    expect(wrapper.find('[aria-label="强化符文"]').exists()).toBe(true)
    // 选择完整保留（两枚均仍处于已选中状态）
    expect(findByAriaPrefix(wrapper, '取消选择材料 稀有暴击符文')!.attributes('aria-pressed')).toBe('true')
    expect(findByAriaPrefix(wrapper, '取消选择材料 史诗速度符文')!.attributes('aria-pressed')).toBe('true')
    expect(playerStore.runeInventory.length).toBe(3)
  })

  it('单个已选材料失效 → 仅移除该 ID，其余选择保留、面板保持打开、预览随之更新', async () => {
    const playerStore = seedDefault()
    const wrapper = mount(RuneInventoryTab)
    await nextTick()
    await openPanel(wrapper)

    await findByAriaPrefix(wrapper, '选择材料 稀有暴击符文')!.trigger('click')
    await nextTick()
    await findByAriaPrefix(wrapper, '选择材料 史诗速度符文')!.trigger('click')
    await nextTick()
    expect(wrapper.find('.feed-selection-summary').text()).toContain('已选 2 枚')

    // c1 失效（升级为 Lv.2），c2 保持有效
    playerStore.runeInventory = [
      makeRune('t1', { level: 2 }),
      makeRune('c1', { type: 'crit', rarity: 'rare', level: 2 }),
      makeRune('c2', { type: 'speed', rarity: 'epic' })
    ]
    await nextTick()
    await nextTick()

    expect(wrapper.find('[aria-label="强化符文"]').exists()).toBe(true)
    // c2 仍选中、c1 不再出现在候选
    expect(findByAriaPrefix(wrapper, '取消选择材料 史诗速度符文')!.attributes('aria-pressed')).toBe('true')
    expect(findByAriaPrefix(wrapper, '选择材料 稀有暴击符文')).toBeNull()
    expect(findByAriaPrefix(wrapper, '取消选择材料 稀有暴击符文')).toBeNull()
    const summary = wrapper.find('.feed-selection-summary')
    expect(summary.text()).toContain('已选 1 枚')
    expect(summary.text()).toContain('总计 +45 EXP')
    expect(wrapper.find('[aria-label="强化预览"]').text()).toContain('获得：+45 EXP')
  })

  it('目标被锁定 → 面板保持打开、预览保持可用（锁定目标允许强化）', async () => {
    const playerStore = seedDefault()
    const wrapper = mount(RuneInventoryTab)
    await nextTick()
    await openPanel(wrapper)
    await findByAriaPrefix(wrapper, '选择材料 稀有暴击符文')!.trigger('click')
    await nextTick()
    expect(wrapper.find('[aria-label="强化预览"]').exists()).toBe(true)

    playerStore.runeInventory = [
      makeRune('t1', { level: 2, isLocked: true }),
      makeRune('c1', { type: 'crit', rarity: 'rare' }),
      makeRune('c2', { type: 'speed', rarity: 'epic' })
    ]
    await nextTick()
    await nextTick()

    expect(wrapper.find('[aria-label="强化符文"]').exists()).toBe(true)
    expect(findByAriaPrefix(wrapper, '取消选择材料 稀有暴击符文')!.attributes('aria-pressed')).toBe('true')
    expect(wrapper.find('[aria-label="强化预览"]').exists()).toBe(true)
  })

  it('追加新 Rune 不漂移选择（canonical ID 身份）；未选材料保持未选中', async () => {
    const playerStore = seedDefault()
    const wrapper = mount(RuneInventoryTab)
    await nextTick()
    await openPanel(wrapper)
    await findByAriaPrefix(wrapper, '选择材料 稀有暴击符文')!.trigger('click')
    await nextTick()

    playerStore.runeInventory = [
      makeRune('t1', { level: 2 }),
      makeRune('c1', { type: 'crit', rarity: 'rare' }),
      makeRune('c2', { type: 'speed', rarity: 'epic' }),
      makeRune('c3', { type: 'luck', rarity: 'legend' })
    ]
    await nextTick()
    await nextTick()

    expect(wrapper.find('[aria-label="强化符文"]').exists()).toBe(true)
    expect(findByAriaPrefix(wrapper, '取消选择材料 稀有暴击符文')!.attributes('aria-pressed')).toBe('true')
    expect(findByAriaPrefix(wrapper, '选择材料 史诗速度符文')!.attributes('aria-pressed')).toBe('false')
    expect(findByAriaPrefix(wrapper, '选择材料 传说幸运符文')!.attributes('aria-pressed')).toBe('false')
    expect(wrapper.find('.feed-selection-summary').text()).toContain('已选 1 枚')
  })

  it('未选择任何材料时确认按钮禁用；目标满级面板不可打开', async () => {
    seedInventory([
      makeRune('t1', { level: 2 }),
      makeRune('c1', { type: 'crit' }),
      makeRune('max1', { type: 'luck', level: RUNE_MAX_LEVEL })
    ])
    const wrapper = mount(RuneInventoryTab)
    await nextTick()

    // 满级目标：强化按钮为禁用「已满级」
    const maxBtn = findByAriaPrefix(wrapper, '普通幸运符文 已满级')
    expect(maxBtn).toBeTruthy()
    expect(maxBtn!.attributes('disabled')).toBeDefined()

    await openPanel(wrapper)
    const confirmBtn = findByAriaPrefix(wrapper, '确认强化')!
    expect(confirmBtn.attributes('disabled')).toBeDefined()
  })

  // ---- Phase 3.13.1 UI 收口（§7-§12）----

  it('§8 选择摘要总经验来自批量规划器（单一事实来源）：planner.expAdded 覆盖组件重算', async () => {
    const playerStore = seedDefault()
    // 真实候选经验：c1(rare)=15 + c2(epic)=45 = 60；用受控 override 把批量规划器篡改为 61
    const base = planRuneBatchFeeding({
      targetRuneId: 't1',
      materialRuneIds: ['c1', 'c2'],
      inventory: playerStore.runeInventory.map(r => ({ ...r })),
      equipmentBySlot: playerStore.player.equipment
    })
    expect(base.ok).toBe(true)
    if (!base.ok) throw new Error('expected base ok')
    expect(base.expAdded).toBe(60) // 真实 helper 逐项和为 60
    plannerMockState.batchOverride = () => ({ ...base, expAdded: 61 } as RuneBatchFeedingPlan)

    const wrapper = mount(RuneInventoryTab)
    await nextTick()
    await openPanel(wrapper)

    await findByAriaPrefix(wrapper, '选择材料 稀有暴击符文')!.trigger('click')
    await nextTick()
    await findByAriaPrefix(wrapper, '选择材料 史诗速度符文')!.trigger('click')
    await nextTick()

    const summary = wrapper.find('.feed-selection-summary')
    expect(summary.exists()).toBe(true)
    expect(summary.text()).toContain('已选 2 枚')
    // 必须显示 61（来自 planner.expAdded），而非组件自算的 60
    expect(summary.text()).toContain('总计 +61 EXP')
    expect(summary.text()).not.toContain('总计 +60 EXP')
    const preview = wrapper.find('[aria-label="强化预览"]')
    expect(preview.text()).toContain('获得：+61 EXP')
  })

  it('§9 初始 0 选择状态：摘要始终存在并显示已选 0 枚 / 总计 +0 EXP / 尚未选择可消耗材料 / 确认禁用', async () => {
    seedDefault()
    const wrapper = mount(RuneInventoryTab)
    await nextTick()
    await openPanel(wrapper)

    const summary = wrapper.find('.feed-selection-summary')
    expect(summary.exists()).toBe(true)
    expect(summary.text()).toContain('已选 0 枚')
    expect(summary.text()).toContain('总计 +0 EXP')
    expect(summary.text()).toContain('尚未选择可消耗材料')

    const confirmBtn = findByAriaPrefix(wrapper, '确认强化')!
    expect(confirmBtn.attributes('disabled')).toBeDefined()
    expect(confirmBtn.attributes('aria-label')).toBe('确认强化，将永久消耗 0 枚材料')
  })

  it('§9 选中两枚后全部失效（锁定 + 升级，两种不同原因）：选择清空、摘要回到 0 枚、预览消失、确认禁用、面板保持、事务 0 次', async () => {
    // 三枚候选：选中 c1/c2，使两者各自失效（锁定 / 升级），c3 保持为合法候选
    // → candidates 非空，确认按钮存在但禁用（与 §5 动态 aria-label 一致）
    const playerStore = usePlayerStore()
    playerStore.runeInventory = [
      makeRune('t1', { level: 2 }),
      makeRune('c1', { type: 'crit', rarity: 'rare' }),
      makeRune('c2', { type: 'speed', rarity: 'epic' }),
      makeRune('c3', { type: 'luck', rarity: 'legend' })
    ]
    const feedSpy = vi.spyOn(playerStore, 'tryFeedRunes')
    const wrapper = mount(RuneInventoryTab)
    await nextTick()
    await openPanel(wrapper)

    await findByAriaPrefix(wrapper, '选择材料 稀有暴击符文')!.trigger('click')
    await nextTick()
    await findByAriaPrefix(wrapper, '选择材料 史诗速度符文')!.trigger('click')
    await nextTick()
    expect(wrapper.find('.feed-selection-summary').text()).toContain('已选 2 枚')

    // c1 锁定（原因一）、c2 升为 Lv.2（原因二）→ 两者均不再是合法材料，watch 清空选择
    playerStore.runeInventory = [
      makeRune('t1', { level: 2 }),
      makeRune('c1', { type: 'crit', rarity: 'rare', isLocked: true }),
      makeRune('c2', { type: 'speed', rarity: 'epic', level: 2 }),
      makeRune('c3', { type: 'luck', rarity: 'legend' })
    ]
    await nextTick()
    await nextTick()

    // 两个 ID 均被移除
    expect(findByAriaPrefix(wrapper, '取消选择材料 稀有暴击符文')).toBeNull()
    expect(findByAriaPrefix(wrapper, '取消选择材料 史诗速度符文')).toBeNull()
    // c3 仍为合法候选（未选）
    expect(findByAriaPrefix(wrapper, '选择材料 传说幸运符文')).toBeTruthy()
    // 摘要回到 0 枚
    const summary = wrapper.find('.feed-selection-summary')
    expect(summary.exists()).toBe(true)
    expect(summary.text()).toContain('已选 0 枚')
    expect(summary.text()).toContain('总计 +0 EXP')
    // 预览消失
    expect(wrapper.find('[aria-label="强化预览"]').exists()).toBe(false)
    // 确认禁用（存在但 disabled，动态 aria-label 仍说明消耗 0 枚）
    const confirmBtn = findByAriaPrefix(wrapper, '确认强化')!
    expect(confirmBtn).toBeTruthy()
    expect(confirmBtn!.attributes('disabled')).toBeDefined()
    expect(confirmBtn!.attributes('aria-label')).toBe('确认强化，将永久消耗 0 枚材料')
    // 面板保持打开
    expect(wrapper.find('[aria-label="强化符文"]').exists()).toBe(true)
    // 事务 0 次
    expect(feedSpy).toHaveBeenCalledTimes(0)
  })

  it('§10 确认按钮动态 aria-label：0/1/2 枚分别说明消耗数量，disabled 与预览有效性一致', async () => {
    seedDefault()
    const wrapper = mount(RuneInventoryTab)
    await nextTick()
    await openPanel(wrapper)

    // 0 枚
    let confirmBtn = findByAriaPrefix(wrapper, '确认强化')!
    expect(confirmBtn.attributes('aria-label')).toBe('确认强化，将永久消耗 0 枚材料')
    expect(confirmBtn.attributes('disabled')).toBeDefined()

    // 选 1 枚
    await findByAriaPrefix(wrapper, '选择材料 稀有暴击符文')!.trigger('click')
    await nextTick()
    confirmBtn = findByAriaPrefix(wrapper, '确认强化')!
    expect(confirmBtn.attributes('aria-label')).toBe('确认强化，将永久消耗 1 枚材料')
    expect(confirmBtn.attributes('disabled')).toBeUndefined()

    // 选 2 枚
    await findByAriaPrefix(wrapper, '选择材料 史诗速度符文')!.trigger('click')
    await nextTick()
    confirmBtn = findByAriaPrefix(wrapper, '确认强化')!
    expect(confirmBtn.attributes('aria-label')).toBe('确认强化，将永久消耗 2 枚材料')
    expect(confirmBtn.attributes('disabled')).toBeUndefined()

    // 取消 1 枚 → 恢复为消耗 1 枚
    await findByAriaPrefix(wrapper, '取消选择材料 稀有暴击符文')!.trigger('click')
    await nextTick()
    confirmBtn = findByAriaPrefix(wrapper, '确认强化')!
    expect(confirmBtn.attributes('aria-label')).toBe('确认强化，将永久消耗 1 枚材料')
  })

  it('§11 四类外层视图变化（类型/稀有度/状态筛选 + 排序）下批量材料 canonical-ID 选择保持：仓库卡片隐藏但选择/摘要/预览/确认不变', async () => {
    const playerStore = seedDefault()
    vi.spyOn(playerStore, 'tryFeedRunes') // 仅计数，不拦截——证明筛选操作本身不触发任何事务
    const wrapper = mount(RuneInventoryTab)
    await nextTick()
    await openPanel(wrapper)

    // 选中 c1 = 稀有暴击符文（rare / crit / 未镶嵌 / +15 EXP）
    await findByAriaPrefix(wrapper, '选择材料 稀有暴击符文')!.trigger('click')
    await nextTick()
    expect(wrapper.find('.feed-selection-summary').text()).toContain('已选 1 枚')
    expect(wrapper.find('.feed-selection-summary').text()).toContain('总计 +15 EXP')

    const selBtn = () => findByAriaPrefix(wrapper, '取消选择材料 稀有暴击符文')!
    // 仓库网格卡片隐藏的判据：卡片内的 强化 / 锁定 按钮不再渲染
    const warehouseHidden = () =>
      findByAriaPrefix(wrapper, '强化 稀有暴击符文') === null &&
      findByAriaPrefix(wrapper, '锁定 稀有暴击符文') === null
    const confirmBtn = () => findByAriaPrefix(wrapper, '确认强化')!
    const summaryText = () => wrapper.find('.feed-selection-summary').text()

    // —— ① 类型筛选 = attack（c1 为 crit）→ 仓库卡片隐藏，选择保留 ——
    const typeSelect = wrapper.find('select[aria-label="按类型筛选"]')
    await typeSelect.setValue('attack')
    await nextTick()
    expect(warehouseHidden()).toBe(true)
    expect(selBtn().attributes('aria-pressed')).toBe('true')
    expect(summaryText()).toContain('已选 1 枚')
    expect(summaryText()).toContain('总计 +15 EXP')
    expect(wrapper.find('[aria-label="强化预览"]').text()).toContain('获得：+15 EXP')
    await typeSelect.setValue('all')
    await nextTick()
    expect(warehouseHidden()).toBe(false)
    expect(selBtn().attributes('aria-pressed')).toBe('true')

    // —— ② 稀有度筛选 = epic（c1 为 rare）→ 仓库卡片隐藏，选择/摘要/预览/确认保持 ——
    const raritySelect = wrapper.find('select[aria-label="按稀有度筛选"]')
    await raritySelect.setValue('epic')
    await nextTick()
    expect(warehouseHidden()).toBe(true)
    expect(selBtn().attributes('aria-pressed')).toBe('true')
    expect(summaryText()).toContain('已选 1 枚')
    expect(summaryText()).toContain('总计 +15 EXP')
    const rarityConfirm = confirmBtn()
    expect(rarityConfirm.exists()).toBe(true)
    expect(rarityConfirm.attributes('disabled')).toBeFalsy()
    expect(wrapper.find('[aria-label="强化预览"]').text()).toContain('获得：+15 EXP')
    await raritySelect.setValue('all')
    await nextTick()
    expect(warehouseHidden()).toBe(false)
    expect(selBtn().attributes('aria-pressed')).toBe('true')

    // —— ③ 状态筛选 = 已镶嵌（c1 为未镶嵌）→ 仓库卡片隐藏，选择/摘要/预览/确认保持，事务 0 次 ——
    const statusSelect = wrapper.find('select[aria-label="按状态筛选"]')
    await statusSelect.setValue('embedded')
    await nextTick()
    expect(warehouseHidden()).toBe(true)
    expect(selBtn().attributes('aria-pressed')).toBe('true')
    expect(summaryText()).toContain('已选 1 枚')
    expect(summaryText()).toContain('总计 +15 EXP')
    expect(wrapper.find('[aria-label="强化预览"]').exists()).toBe(true)
    const statusConfirm = confirmBtn()
    expect(statusConfirm.exists()).toBe(true)
    expect(statusConfirm.attributes('disabled')).toBeFalsy()
    expect(playerStore.tryFeedRunes).toHaveBeenCalledTimes(0)
    await statusSelect.setValue('all')
    await nextTick()
    expect(warehouseHidden()).toBe(false)
    expect(selBtn().attributes('aria-pressed')).toBe('true')
    expect(summaryText()).toContain('已选 1 枚')
    expect(summaryText()).toContain('总计 +15 EXP')

    // —— ④ 排序 = 稀有度 → 卡片顺序变化，选择仍绑定 canonical ID（非 sorted index） ——
    const sortSelect = wrapper.find('select[aria-label="排序方式"]')
    await sortSelect.setValue('rarity')
    await nextTick()
    expect(selBtn().attributes('aria-pressed')).toBe('true')
    expect(summaryText()).toContain('已选 1 枚')

    // 全程仅做外层视图切换，从未触发任何批量吞噬事务
    expect(playerStore.tryFeedRunes).toHaveBeenCalledTimes(0)
  })

  it('§12 tryFeedRunes 抛异常：组件不崩溃、面板保持、选择保留、不伪报成功、显示安全失败信息、inventory 不变化', async () => {
    const playerStore = seedDefault()
    vi.spyOn(playerStore, 'tryFeedRunes').mockImplementation(() => {
      throw new Error('boom')
    })
    const wrapper = mount(RuneInventoryTab)
    await nextTick()
    await openPanel(wrapper)

    await findByAriaPrefix(wrapper, '选择材料 稀有暴击符文')!.trigger('click')
    await nextTick()
    await findByAriaPrefix(wrapper, '选择材料 史诗速度符文')!.trigger('click')
    await nextTick()

    // 组件必须捕获异常，不向上抛出
    let threw = false
    try {
      await findByAriaPrefix(wrapper, '确认强化')!.trigger('click')
    } catch {
      threw = true
    }
    await nextTick()
    expect(threw).toBe(false)

    // 面板保持打开
    expect(wrapper.find('[aria-label="强化符文"]').exists()).toBe(true)
    // 选择完整保留
    expect(findByAriaPrefix(wrapper, '取消选择材料 稀有暴击符文')!.attributes('aria-pressed')).toBe('true')
    expect(findByAriaPrefix(wrapper, '取消选择材料 史诗速度符文')!.attributes('aria-pressed')).toBe('true')
    // 不显示成功
    expect(wrapper.text()).not.toContain('强化成功')
    // 显示安全失败信息
    expect(wrapper.text()).toContain('强化操作失败')
    // inventory 不变化（两枚材料仍在）
    expect(playerStore.runeInventory.length).toBe(3)
  })
})
