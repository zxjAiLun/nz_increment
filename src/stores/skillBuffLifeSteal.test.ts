import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { usePlayerStore } from './playerStore'
import { useMonsterStore } from './monsterStore'
import { getSkillById, getSkillBuffEffects, createSkillInstance } from '../utils/skillSystem'
import { calculateAppliedLifesteal } from '../utils/calc'
import { applyDamageToMonster } from '../systems/combat/damage'
import type { Monster } from '../types'

const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value }),
    removeItem: vi.fn((key: string) => { delete store[key] }),
    clear: vi.fn(() => { store = {} }),
    get length() { return Object.keys(store).length },
    key: vi.fn((index: number) => Object.keys(store)[index] ?? null)
  }
})()

function makeMonster(over: Partial<Monster> = {}): Monster {
  return {
    id: 'm', name: '测试怪', level: 1, isBoss: false,
    maxHp: 1000, currentHp: 1000, attack: 10, defense: 0, speed: 10,
    goldReward: 1, expReward: 1, equipmentDropChance: 0, diamondDropChance: 0,
    ...over
  } as Monster
}

describe('Phase 2.2 — 统一 Buff Effect 规范化', () => {
  it('getSkillBuffEffects: 旧单个 buffEffect 规范化为 mode:"percent" 单效果', () => {
    const skill = getSkillById('skill_defense_stance')! // 旧格式只有 buffEffect
    const effects = getSkillBuffEffects(skill)
    expect(effects).toHaveLength(1)
    expect(effects[0]).toMatchObject({ stat: 'defense', value: 30, mode: 'percent', duration: 5 })
  })

  it('getSkillBuffEffects: 无 Buff 字段返回空数组', () => {
    const skill = getSkillById('skill_heavy_strike')!
    expect(getSkillBuffEffects(skill)).toEqual([])
  })

  it('createSkillInstance 深复制 buffEffects，不共享可变数组', () => {
    const src = getSkillById('skill_critical_boost')!
    const inst = createSkillInstance(src)
    expect(inst.buffEffects).not.toBe(src.buffEffects)
    inst.buffEffects![0].value = 999
    expect(src.buffEffects![0].value).toBe(30) // 源不被污染
  })
})

describe('Phase 2.2 — 暴击强化', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorageMock.clear()
    vi.stubGlobal('localStorage', localStorageMock)
  })

  it('技能数据包含两个 flat 效果（critRate +30, critDamage +50）', () => {
    const skill = getSkillById('skill_critical_boost')!
    const effects = getSkillBuffEffects(skill)
    expect(effects).toHaveLength(2)
    expect(effects[0]).toMatchObject({ stat: 'critRate', value: 30, mode: 'flat', duration: 6 })
    expect(effects[1]).toMatchObject({ stat: 'critDamage', value: 50, mode: 'flat', duration: 6 })
  })

  it('施放前 10/150 → 施放后 40/200（百分点叠加，非 13/225）', () => {
    const store = usePlayerStore()
    store.player.stats.critRate = 10
    store.player.stats.critDamage = 150
    store.applyBuff('critRate', 30, 6, 'flat')
    store.applyBuff('critDamage', 50, 6, 'flat')
    expect(store.totalStats.critRate).toBe(40)
    expect(store.totalStats.critDamage).toBe(200)
  })

  it('两项效果持续时间均为 6000ms', () => {
    const store = usePlayerStore()
    store.applyBuff('critRate', 30, 6, 'flat')
    store.applyBuff('critDamage', 50, 6, 'flat')
    expect(store.activeBuffs.get('critRate')!.totalDurationMs).toBe(6000)
    expect(store.activeBuffs.get('critDamage')!.totalDurationMs).toBe(6000)
  })

  it('推进 5999ms 仍生效；再推进 1ms 同时失效（同一 6 秒边界）', () => {
    const store = usePlayerStore()
    store.applyBuff('critRate', 30, 6, 'flat')
    store.applyBuff('critDamage', 50, 6, 'flat')
    store.updateActiveBuffs(5999)
    expect(store.activeBuffs.has('critRate')).toBe(true)
    expect(store.activeBuffs.has('critDamage')).toBe(true)
    expect(store.activeBuffs.get('critRate')!.remainingMs).toBe(1)
    store.updateActiveBuffs(1)
    expect(store.activeBuffs.has('critRate')).toBe(false)
    expect(store.activeBuffs.has('critDamage')).toBe(false)
  })

  it('重复施放刷新而非叠加（40 而非 70）', () => {
    const store = usePlayerStore()
    store.player.stats.critRate = 10
    store.applyBuff('critRate', 30, 6, 'flat')
    expect(store.totalStats.critRate).toBe(40)
    store.applyBuff('critRate', 30, 6, 'flat') // 再次施加
    expect(store.totalStats.critRate).toBe(40)
    expect(store.activeBuffs.get('critRate')!.value).toBe(30)
  })

  it('暴击率应用现有上限（base 70 + flat 30 → 收敛到 80）', () => {
    const store = usePlayerStore()
    store.player.stats.critRate = 70
    store.applyBuff('critRate', 30, 6, 'flat')
    expect(store.totalStats.critRate).toBe(80)
  })
})

describe('Phase 2.2 — 生命汲取共享结算 helper', () => {
  it('普通伤害 300，技能 30% → 技能治疗 90，属性 0', () => {
    const r = calculateAppliedLifesteal({ appliedDamage: 300, skillLifestealRate: 30, globalLifestealRate: 0 })
    expect(r).toEqual({ skillHeal: 90, globalHeal: 0, totalHeal: 90 })
  })

  it('未命中（appliedDamage 0）→ 治疗 0', () => {
    const r = calculateAppliedLifesteal({ appliedDamage: 0, skillLifestealRate: 30, globalLifestealRate: 0 })
    expect(r).toEqual({ skillHeal: 0, globalHeal: 0, totalHeal: 0 })
  })

  it('目标仅剩 50 HP（过量伤害）→ 治疗 15', () => {
    const r = calculateAppliedLifesteal({ appliedDamage: 50, skillLifestealRate: 30, globalLifestealRate: 0 })
    expect(r).toEqual({ skillHeal: 15, globalHeal: 0, totalHeal: 15 })
  })

  it('目标 50 HP + 100 护盾 → appliedDamage 150 → 治疗 45', () => {
    const r = calculateAppliedLifesteal({ appliedDamage: 150, skillLifestealRate: 30, globalLifestealRate: 0 })
    expect(r).toEqual({ skillHeal: 45, globalHeal: 0, totalHeal: 45 })
  })

  it('全局吸血 10%：技能 90 + 属性 30 = 总恢复 120，且各自向下取整不重复', () => {
    const r = calculateAppliedLifesteal({ appliedDamage: 300, skillLifestealRate: 30, globalLifestealRate: 10 })
    expect(r).toEqual({ skillHeal: 90, globalHeal: 30, totalHeal: 120 })
  })
})

describe('Phase 2.2 — applyDamageToMonster.appliedDamage', () => {
  it('dragon 无护盾：appliedDamage = 实际扣血', () => {
    const m = makeMonster({ currentHp: 1000 })
    const r = applyDamageToMonster({ monster: m, damage: 300 })
    expect(r.shieldDamage).toBe(0)
    expect(r.hpDamage).toBe(300)
    expect(r.appliedDamage).toBe(300)
  })

  it('过量伤害：目标仅 50 HP → appliedDamage = 50', () => {
    const m = makeMonster({ currentHp: 50 })
    const r = applyDamageToMonster({ monster: m, damage: 300 })
    expect(r.hpDamage).toBe(50)
    expect(r.appliedDamage).toBe(50)
  })

  it('带护盾：50 HP + 100 护盾 → shieldDamage 100, hpDamage 50, appliedDamage 150', () => {
    const m = makeMonster({ currentHp: 50, bossState: { shield: 100, enraged: false, healedOnce: false } as any })
    const r = applyDamageToMonster({ monster: m, damage: 300 })
    expect(r.shieldDamage).toBe(100)
    expect(r.hpDamage).toBe(50)
    expect(r.appliedDamage).toBe(150)
  })
})

describe('Phase 2.2 — monsterStore 转发 appliedDamage', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorageMock.clear()
    vi.stubGlobal('localStorage', localStorageMock)
  })

  it('damageMonster 返回 appliedDamage（与 applyDamageToMonster 一致）', () => {
    const ms = useMonsterStore()
    ms.initMonster()
    const mon = ms.currentMonster!
    // 用同一怪物的深复制在纯函数上算出期望值，证明 store 只是正确转发
    const expected = applyDamageToMonster({ monster: JSON.parse(JSON.stringify(mon)), damage: 300 })
    const res = ms.damageMonster(300, () => 0)
    expect(res.appliedDamage).toBe(expected.appliedDamage)
    expect(res.hpDamage).toBe(expected.hpDamage)
  })
})
