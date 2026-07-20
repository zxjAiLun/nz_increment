import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { usePlayerStore } from './playerStore'
import { useMonsterStore } from './monsterStore'
import { useGameStore } from './gameStore'
import { getSkillById, selectAutoSkill, getSkillBuffEffects } from '../utils/skillSystem'
import {
  simulateCombatScenario,
  getEffectiveStats,
  upsertActiveBuff,
  createActiveBuffMap,
  tickBuffs,
  createSeededRng
} from '../systems/combat/battleSimulator'
import { createDefaultPlayer } from '../utils/calc'
import { generateMonster } from '../utils/monsterGenerator'
import type { Monster, PlayerStats, Skill } from '../types'

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

function cloneSkill(id: string): Skill {
  const s = getSkillById(id)
  if (!s) throw new Error(`skill not found: ${id}`)
  return JSON.parse(JSON.stringify(s)) as Skill
}

function makeMonster(over: Partial<Monster> = {}): Monster {
  return {
    id: 'm', name: '测试怪', level: 1, isBoss: false,
    maxHp: 1000, currentHp: 1000, attack: 10, defense: 0, speed: 10,
    goldReward: 1, expReward: 1, equipmentDropChance: 0, diamondDropChance: 0,
    ...over
  } as Monster
}

function buildSimStats(over: Partial<PlayerStats> = {}): PlayerStats {
  return {
    ...createDefaultPlayer().stats,
    attack: 100, critRate: 0, critDamage: 150, speed: 100, defense: 0,
    lifesteal: 0, maxHp: 1e9, hpRegenPercent: 0, killHealPercent: 0, hitHealFlat: 0,
    dodge: 0, accuracy: 1000,
    ...over
  }
}

function buildSimPlayer(stats: PlayerStats) {
  const p = createDefaultPlayer()
  p.stats = stats
  p.maxHp = stats.maxHp
  p.currentHp = stats.maxHp
  return p
}

function buildSimMonster(maxHp: number, speed: number, attack = 0, over: Partial<Monster> = {}): Monster {
  const m = generateMonster(10, 1, createSeededRng(3))
  m.maxHp = maxHp
  m.currentHp = maxHp
  m.speed = speed
  m.attack = attack
  m.defense = 0
  return { ...m, ...over } as Monster
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorageMock.clear()
  vi.stubGlobal('localStorage', localStorageMock)
})

describe('Phase 2.2.1 — 统一自动选技 selectAutoSkill', () => {
  it('混合技能栏 [buff, damage] → 选第二槽 damage（不自动施放 Buff）', () => {
    const items = [getSkillById('skill_defense_stance')!, getSkillById('skill_heavy_strike')!]
    const sel = selectAutoSkill(items, () => true, s => s)
    expect(sel).not.toBeNull()
    expect(sel!.index).toBe(1)
    expect(sel!.skill.id).toBe('skill_heavy_strike')
  })

  it('纯 Buff/heal 技能栏 → 返回 null（退化普攻）', () => {
    const items = [getSkillById('skill_defense_stance')!, getSkillById('skill_heal')!]
    expect(selectAutoSkill(items, () => true, s => s)).toBeNull()
  })

  it('多个 damage 技能按槽位顺序选择（不按伤害评分排序）', () => {
    const items = [getSkillById('skill_heavy_strike')!, getSkillById('skill_meteor_strike')!]
    const sel = selectAutoSkill(items, () => true, s => s)
    expect(sel!.index).toBe(0) // heavy 在前，即便 meteor 单发伤害更高
  })

  it('已就绪判定生效：isReady 返回 false 的技能被跳过', () => {
    const a = { skill: getSkillById('skill_heavy_strike')!, ready: true } // 就绪
    const b = { skill: getSkillById('skill_meteor_strike')!, ready: false } // 冷却中
    const items = [a, b]
    // 第一槽就绪、第二槽未就绪 → 选第一槽
    const sel = selectAutoSkill(items, (it) => it.ready, (it) => it.skill)
    expect(sel!.index).toBe(0)
  })
})

describe('Phase 2.2.1 — runtime: critical_boost 经原子入口施放', () => {
  it('gauge 消费1次 / cooldown 设1次 / 40-200 / 5999ms 生效 / 6000ms 同时失效', () => {
    const playerStore = usePlayerStore()
    const game = useGameStore()
    const monsterStore = useMonsterStore()
    playerStore.player.stats.critRate = 10
    playerStore.player.stats.critDamage = 150
    playerStore.player.stats.speed = 50
    playerStore.player.stats.luck = 0 // Phase 3.1: totalStats 现含幸运暴击率，隔离 Buff 数学
    playerStore.player.skills = [cloneSkill('skill_critical_boost'), null, null, null, null]
    monsterStore.currentMonster = makeMonster({ speed: 50 })

    game.setCombatRng(() => 0)
    game.primePlayerGauge()
    expect(game.canPlayerAct).toBe(true)

    const ok = game.tryUsePlayerSkill(0)
    expect(ok).toBe(true)
    expect(game.canPlayerAct).toBe(false) // gauge 仅消费一次
    expect(playerStore.player.skills[0]!.currentCooldown).toBeGreaterThan(0) // cooldown 仅设一次
    expect(playerStore.activeBuffs.size).toBe(2) // 两项效果各一条，未重复施加
    expect(playerStore.totalStats.critRate).toBe(40.8) // 10 base + 30 buff + 0.8 默认幸运暴击率(Phase 3.1)
    expect(playerStore.totalStats.critDamage).toBe(200)

    playerStore.updateActiveBuffs(5999)
    expect(playerStore.activeBuffs.has('critRate')).toBe(true)
    expect(playerStore.activeBuffs.has('critDamage')).toBe(true)
    expect(playerStore.totalStats.critRate).toBe(40.8) // 10 base + 30 buff + 0.8 默认幸运暴击率(Phase 3.1)

    playerStore.updateActiveBuffs(1) // 到达 6000ms
    expect(playerStore.activeBuffs.has('critRate')).toBe(false)
    expect(playerStore.activeBuffs.has('critDamage')).toBe(false)
    expect(playerStore.totalStats.critRate).toBe(10.8) // 10 base + 0.8 默认幸运暴击率(Phase 3.1)
  })
})

describe('Phase 2.2.1 — runtime: life_steal 经原子入口施放（首击技能吸血）', () => {
  function setup(over: Partial<Monster> = {}, statOver: Partial<PlayerStats> = {}) {
    const playerStore = usePlayerStore()
    const game = useGameStore()
    const monsterStore = useMonsterStore()
    playerStore.player.stats = {
      ...playerStore.player.stats,
      attack: 100, critRate: 0, critDamage: 150, speed: 100, defense: 0,
      maxHp: 1000, lifesteal: 0,
      hpRegenPercent: 0, killHealPercent: 0, hitHealFlat: 0,
      dodge: 0, accuracy: 1000,
      ...statOver
    }
    playerStore.player.maxHp = playerStore.player.stats.maxHp
    playerStore.player.currentHp = 500
    playerStore.player.skills = [cloneSkill('skill_life_steal'), null, null, null, null]
    monsterStore.currentMonster = makeMonster({ speed: 100, attack: 0, defense: 0, ...over })
    // rng=0.5：必命中（chance≈0.95）、且 0.5*100=50 >= critChance(5) → 不暴击，伤害恒为 3×attack=300。
    // 注意 player.stats.critRate=0 经 totalStats 的 `|| 5` 兜底为 5，故必须用 rng 阻止暴击而非依赖 critRate=0。
    game.setCombatRng(() => 0.5)
    return { playerStore, game, monsterStore }
  }

  // 从战斗日志解析「击杀恢复」金额（与技能吸血相互独立，击杀触发的基础回血）。
  function parseKillHeal(log: string[]): number {
    const entry = log.find(l => l.includes('击杀恢复'))
    if (!entry) return 0
    const m = entry.match(/\+(\d+)/)
    return m ? Number(m[1]) : 0
  }

  it('普通 300 伤害 → 技能治疗 90', () => {
    const { playerStore, game } = setup({ maxHp: 1000, currentHp: 600 })
    game.primePlayerGauge()
    const before = playerStore.player.currentHp
    game.tryUsePlayerSkill(0)
    expect(playerStore.player.currentHp - before).toBe(90)
    expect(game.battleLog.filter(l => l.includes('生命汲取技能：')).length).toBe(1)
  })

  it('未命中 → 0', () => {
    const { playerStore, game, monsterStore } = setup({ maxHp: 1000, currentHp: 600 }, { accuracy: 0 })
    game.setCombatRng(() => 0.99) // rng 0.99 配合高闪避 → rollHit 必不中
    monsterStore.currentMonster!.dodge = 100
    game.primePlayerGauge()
    const before = playerStore.player.currentHp
    game.tryUsePlayerSkill(0)
    expect(playerStore.player.currentHp - before).toBe(0)
    expect(game.battleLog.filter(l => l.includes('生命汲取技能：')).length).toBe(0)
  })

  it('过量至 50 HP → 技能吸血 15（appliedDamage 取实际扣血），击杀恢复另计', () => {
    const { playerStore, game } = setup({ maxHp: 50, currentHp: 50 })
    game.primePlayerGauge()
    const before = playerStore.player.currentHp
    game.tryUsePlayerSkill(0)
    // 关键：过量命中时技能吸血基于「实际承受伤害」50（而非请求的 300）。
    expect(game.battleLog.filter(l => l.includes('生命汲取技能：+15')).length).toBe(1)
    const killHeal = parseKillHeal(game.battleLog) // 击杀触发的基础回血，独立于技能吸血
    expect(playerStore.player.currentHp - before).toBe(15 + killHeal)
  })

  it('50 HP + 100 护盾 → appliedDamage 150（护盾计入）→ 技能吸血 45，击杀恢复另计', () => {
    const { playerStore, game } = setup({
      maxHp: 50, currentHp: 50,
      bossState: { shield: 100, enraged: false, healedOnce: false } as any
    })
    game.primePlayerGauge()
    const before = playerStore.player.currentHp
    game.tryUsePlayerSkill(0)
    expect(game.battleLog.filter(l => l.includes('生命汲取技能：+45')).length).toBe(1)
    const killHeal = parseKillHeal(game.battleLog)
    expect(playerStore.player.currentHp - before).toBe(45 + killHeal)
  })

  it('接近满血 → 恢复被 clamp 到缺失 HP', () => {
    const { playerStore, game } = setup({ maxHp: 1e9, currentHp: 1e9 }, {})
    // 改为接近满血：maxHp 1000 / currentHp 950
    playerStore.player.maxHp = 1000
    playerStore.player.currentHp = 950
    playerStore.player.stats.maxHp = 1000
    game.primePlayerGauge()
    const before = playerStore.player.currentHp
    game.tryUsePlayerSkill(0)
    expect(playerStore.player.currentHp - before).toBe(50) // 仅补满，不溢出
  })

  it('全局吸血 10% → 90 + 30，日志各 1 条', () => {
    const { playerStore, game } = setup({ maxHp: 1000, currentHp: 600 }, { lifesteal: 10 })
    game.primePlayerGauge()
    const before = playerStore.player.currentHp
    game.tryUsePlayerSkill(0)
    expect(playerStore.player.currentHp - before).toBe(120)
    expect(game.battleLog.filter(l => l.includes('生命汲取技能：+90')).length).toBe(1)
    expect(game.battleLog.filter(l => l.includes('属性吸血：+30')).length).toBe(1)
  })

  it('速度双动：首击获技能吸血，额外普攻（退化为普攻）获 0 技能吸血，日志恰好 1 条', () => {
    const { playerStore, game, monsterStore } = setup({ maxHp: 1000, currentHp: 600 }, { speed: 200 })
    monsterStore.currentMonster!.speed = 100 // 200/100 = 2 → 双动（并触发 1.5× 速度伤害加成）
    game.primePlayerGauge()
    const before = playerStore.player.currentHp
    game.tryUsePlayerSkill(0)
    // 首击（技能）= 3×attack×1.5 = 450 → 技能吸血 floor(450*0.3)=135；
    // 额外普攻（退化为普攻，无技能吸血）伤害 100×1.5=150，技能吸血 0。
    const firstHit = Math.floor(100 * 3 * 1.5)
    const expectedSkillHeal = Math.floor(firstHit * 0.3)
    expect(game.battleLog.filter(l => l.includes('生命汲取技能：')).length).toBe(1)
    expect(game.battleLog.filter(l => l.includes(`生命汲取技能：+${expectedSkillHeal}`)).length).toBe(1)
    const killHeal = parseKillHeal(game.battleLog) // 怪物在第 2 击阵亡，触发一次击杀恢复
    expect(playerStore.player.currentHp - before).toBe(expectedSkillHeal + killHeal)
  })
})

describe('Phase 2.2.1 — simulator: 自动策略不施放 Buff/heal', () => {
  it('自动战斗不施放 critical_boost（buffCasts===0），改选 damage 技能', () => {
    const stats = buildSimStats({ speed: 100 })
    const player = buildSimPlayer(stats)
    const monster = buildSimMonster(600, 100)
    const result = simulateCombatScenario({
      player, stats, monster, difficulty: 10, rng: createSeededRng(3),
      skillLoadout: [getSkillById('skill_critical_boost')!, getSkillById('skill_meteor_strike')!],
      secondsLimit: 3
    })
    expect(result.buffCasts).toBe(0)
    expect(result.skillCasts).toBeGreaterThan(0)
  })

  it('手动施放 critical_boost 后 Buff 被施加（buffCasts>=1）', () => {
    const stats = buildSimStats({ speed: 100 })
    const player = buildSimPlayer(stats)
    const monster = buildSimMonster(600, 100)
    const result = simulateCombatScenario({
      player, stats, monster, difficulty: 10, rng: createSeededRng(3),
      skillLoadout: [getSkillById('skill_critical_boost')!, getSkillById('skill_meteor_strike')!],
      secondsLimit: 3,
      manualSkillCasts: [{ atSeconds: 0.1, slotIndex: 0 }]
    })
    expect(result.buffCasts).toBeGreaterThanOrEqual(1)
  })
})

describe('Phase 2.2.1 — simulator Buff 数学与 runtime applyBuff 完全一致', () => {
  it('flat 加法 / 重施刷新不叠加 / 到期，且与 runtime 数值对齐', () => {
    const stats = buildSimStats({ critRate: 10, critDamage: 150, speed: 100 })
    const map = createActiveBuffMap()
    const effs = getSkillBuffEffects(getSkillById('skill_critical_boost')!)
    for (const e of effs) {
      upsertActiveBuff(map, { stat: e.stat as keyof PlayerStats, mode: e.mode, value: e.value, duration: e.duration })
    }
    expect(getEffectiveStats(stats, map).critRate).toBe(40)
    expect(getEffectiveStats(stats, map).critDamage).toBe(200)

    // 重施刷新，而非叠加（不得 70/250）
    upsertActiveBuff(map, { stat: 'critRate', mode: 'flat', value: 30, duration: 6 })
    upsertActiveBuff(map, { stat: 'critDamage', mode: 'flat', value: 50, duration: 6 })
    expect(getEffectiveStats(stats, map).critRate).toBe(40)
    expect(getEffectiveStats(stats, map).critDamage).toBe(200)

    // 到期：按真实 0.1s tick 循环（P1 浮点残留修复，不得拖到 6.1s）
    for (let i = 0; i < 59; i++) tickBuffs(map, 0.1)
    expect(map.size).toBe(2) // 59 次 tick（T+5.9s）后仍未到期
    tickBuffs(map, 0.1)
    expect(map.size).toBe(0) // 第 60 次（T+6.0s）正好到期，不得持续到 T+6.1s

    // runtime 对照
    const ps = usePlayerStore()
    ps.player.stats.luck = 0 // Phase 3.1: totalStats 现含幸运暴击率，隔离 Buff 数学
    ps.player.stats.critRate = 10
    ps.player.stats.critDamage = 150
    ps.applyBuff('critRate', 30, 6, 'flat')
    ps.applyBuff('critDamage', 50, 6, 'flat')
    expect(ps.totalStats.critRate).toBe(40.8) // 10 base + 30 buff + 0.8 默认幸运暴击率(Phase 3.1)
    expect(ps.totalStats.critDamage).toBe(200)
  })
})

describe('Phase 2.2.1 — simulator: life_steal 使用 appliedDamage', () => {
  it('单次手动施放：300 伤害 → 恢复 90（无护甲/暴击/全局吸血/回复干扰），无自动 Buff', () => {
    const stats = buildSimStats({
      attack: 100, critRate: 0, speed: 100, lifesteal: 0,
      hpRegenPercent: 0, killHealPercent: 0, hitHealFlat: 0
    })
    const player = buildSimPlayer(stats)
    const monster = buildSimMonster(1000, 100, 0) // 高血量，确保仅 1 次命中、不击杀
    const result = simulateCombatScenario({
      player, stats, monster, difficulty: 10, rng: createSeededRng(3),
      skillLoadout: [getSkillById('skill_life_steal')!],
      secondsLimit: 2,
      manualSkillCasts: [{ atSeconds: 0.1, slotIndex: 0 }]
    })
    expect(result.killed).toBe(false)
    expect(result.buffCasts).toBe(0)
    expect(result.skillCasts).toBeGreaterThanOrEqual(1)
    expect(result.netHpChange).toBe(90) // floor(300*0.3)：simulator 同样使用 appliedDamage 作为吸血基数
  })

  it('自动战斗：仅 1 次 life_steal 命中（CD 8s > 窗口），每击恢复 90，无自动 Buff', () => {
    const stats = buildSimStats({
      attack: 100, critRate: 0, speed: 100, lifesteal: 0,
      hpRegenPercent: 0, killHealPercent: 0, hitHealFlat: 0
    })
    const player = buildSimPlayer(stats)
    const monster = buildSimMonster(600, 100, 0)
    const result = simulateCombatScenario({
      player, stats, monster, difficulty: 10, rng: createSeededRng(3),
      skillLoadout: [getSkillById('skill_life_steal')!],
      secondsLimit: 5
    })
    expect(result.buffCasts).toBe(0)
    expect(result.netHpChange).toBe(90) // 自动策略下 life_steal CD 8s，5s 窗口内仅 1 次命中
  })
})
