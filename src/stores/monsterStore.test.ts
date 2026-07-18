import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useMonsterStore } from './monsterStore'
import { createBossMechanicState, getBossMechanicById } from '../data/bossMechanics'
import type { Monster } from '../types'

function makeBoss(overrides: Partial<Monster> = {}): Monster {
  const boss: Monster = {
    id: 'boss-test',
    name: '测试Boss [BOSS]',
    level: 10,
    phase: 1,
    maxHp: 1000,
    currentHp: 1000,
    attack: 100,
    defense: 50,
    speed: 10,
    critRate: 0,
    critDamage: 150,
    critResist: 0,
    penetration: 0,
    accuracy: 0,
    dodge: 0,
    goldReward: 10,
    expReward: 5,
    equipmentDropChance: 0,
    diamondDropChance: 0,
    isBoss: true,
    isTrainingMode: false,
    trainingDifficulty: null,
    skills: [],
    status: { marks: [], elemental: [] },
    element: 'none',
    ...overrides
  }
  return boss
}

describe('monsterStore boss mechanics', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.spyOn(Math, 'random').mockReturnValue(1)
  })

  it('shield absorbs damage before hp', () => {
    const store = useMonsterStore()
    store.currentMonster = makeBoss({
      bossMechanic: getBossMechanicById('shield'),
      bossState: { ...createBossMechanicState(), shield: 200 }
    })

    const result = store.damageMonster(150)

    expect(result.shieldDamage).toBe(150)
    expect(store.currentMonster?.currentHp).toBe(1000)
    expect(store.currentMonster?.bossState?.shield).toBe(50)
  })

  it('lifesteal boss heals once when reaching low hp', () => {
    const store = useMonsterStore()
    store.currentMonster = makeBoss({
      currentHp: 360,
      bossMechanic: getBossMechanicById('lifesteal'),
      bossState: createBossMechanicState()
    })

    const result = store.damageMonster(20)

    expect(result.healed).toBe(250)
    expect(store.currentMonster?.currentHp).toBe(590)
    expect(store.currentMonster?.bossState?.healedOnce).toBe(true)
  })
})

describe('monsterStore 标记系统（Task 3：仅怪物行动后扣减）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('施加 duration=3 的标记立即仍为 3', () => {
    const store = useMonsterStore()
    const m = makeBoss({ status: { marks: [], elemental: [] } })
    store.currentMonster = m
    store.addMark(m, { type: 'burn', stacks: 1, duration: 3 })
    expect(m.status!.marks[0].duration).toBe(3)
    expect(m.status!.marks[0].stacks).toBe(1)
  })

  it('每次 tickMarks 仅扣减 1，第 3 次后标记消失', () => {
    const store = useMonsterStore()
    const m = makeBoss({ status: { marks: [], elemental: [] } })
    store.currentMonster = m
    store.addMark(m, { type: 'burn', stacks: 2, duration: 3 })
    store.tickMarks(m)
    expect(m.status!.marks[0].duration).toBe(2)
    store.tickMarks(m)
    expect(m.status!.marks[0].duration).toBe(1)
    store.tickMarks(m)
    expect(m.status!.marks.length).toBe(0)
  })

  it('引爆在标记有效时消费全部层数', () => {
    const store = useMonsterStore()
    const m = makeBoss({ status: { marks: [], elemental: [] } })
    store.currentMonster = m
    store.addMark(m, { type: 'bleed', stacks: 3, duration: 3 })
    const stacks = store.consumeMark(m, 'bleed')
    expect(stacks).toBe(3)
    expect(m.status!.marks.length).toBe(0)
  })

  it('新怪物不会继承旧怪物标记', () => {
    const store = useMonsterStore()
    store.currentMonster = makeBoss({ status: { marks: [{ type: 'burn', stacks: 2, duration: 3 }], elemental: [] } })
    store.currentMonster = makeBoss()
    expect(store.currentMonster!.status!.marks.length).toBe(0)
  })
})
