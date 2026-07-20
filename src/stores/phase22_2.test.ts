import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { usePlayerStore } from './playerStore'
import { useMonsterStore } from './monsterStore'
import { useGameStore } from './gameStore'
import { getSkillById, getSkillBuffEffects } from '../utils/skillSystem'
import {
  simulateCombatScenario,
  getEffectiveStats,
  upsertActiveBuff,
  createActiveBuffMap,
  tickBuffs,
  BUFF_TIME_EPS_SECONDS
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
  const m = generateMonster(10, 1, (() => 0.3) as any)
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

// runtime 非伤害技能测试通用装配：attack=100 / trueDamage=100 / voidDamage=50 / lifesteal=15 / hitHealFlat>0
function setupNonDamage(skillId: string) {
  const playerStore = usePlayerStore()
  const game = useGameStore()
  const monsterStore = useMonsterStore()
  playerStore.player.stats = {
    ...playerStore.player.stats,
    attack: 100, critRate: 0, critDamage: 150, speed: 100, defense: 0,
    maxHp: 1000, lifesteal: 15, hitHealFlat: 10,
    hpRegenPercent: 0, killHealPercent: 0,
    dodge: 0, accuracy: 1000,
    trueDamage: 100, voidDamage: 50
  }
  playerStore.player.maxHp = 1000
  playerStore.player.currentHp = 500
  playerStore.player.skills = [cloneSkill(skillId), null, null, null, null]
  monsterStore.currentMonster = makeMonster({ speed: 100, attack: 0, defense: 0 })
  // rng=0.5：必命中（chance≈1）、且 0.5*100=50 >= critChance(5) → 不暴击。
  game.setCombatRng(() => 0.5)
  return { playerStore, game, monsterStore }
}

describe('Phase 2.2.2 — P0: 非伤害技能不进入伤害管线（runtime 经原子入口）', () => {
  it('skill_critical_boost（buff）：怪物 HP/护盾/combo 不变，无伤害/吸血/命中回复/击杀，gauge/cooldown/Buff 各一次', () => {
    const { playerStore, game, monsterStore } = setupNonDamage('skill_critical_boost')
    const monster = monsterStore.currentMonster!
    const hpBefore = monster.currentHp
    const comboBefore = game.currentCombo

    game.primePlayerGauge()
    const ok = game.tryUsePlayerSkill(0)
    expect(ok).toBe(true)

    // 核心：Buff 不造成任何伤害（即便玩家有 trueDamage/voidDamage）
    expect(monster.currentHp).toBe(hpBefore) // 仍为 1000
    expect(game.currentCombo).toBe(comboBefore) // combo 不变
    // 无伤害飘字
    expect(game.damagePopups.filter(p => p.type !== 'heal' && p.type !== 'lifesteal').length).toBe(0)
    // 无技能吸血 / 无属性吸血 / 无命中回复日志
    expect(game.battleLog.filter(l => l.includes('生命汲取技能：')).length).toBe(0)
    expect(game.battleLog.filter(l => l.includes('属性吸血：')).length).toBe(0)
    expect(game.battleLog.filter(l => l.includes('命中回复')).length).toBe(0)
    // 无击杀奖励
    expect(game.battleLog.filter(l => l.includes('你击败了')).length).toBe(0)
    // Buff 正常发生
    expect(playerStore.activeBuffs.size).toBe(2) // critRate + critDamage 各一条
    expect(game.canPlayerAct).toBe(false) // gauge 消费一次
    expect(playerStore.player.skills[0]!.currentCooldown).toBeGreaterThan(0) // cooldown 设一次
  })

  it('skill_defense_stance（buff）：同样不伤怪、不吸血、不增 combo，防御 Buff 正常施加', () => {
    const { playerStore, game, monsterStore } = setupNonDamage('skill_defense_stance')
    const monster = monsterStore.currentMonster!
    const hpBefore = monster.currentHp

    game.primePlayerGauge()
    game.tryUsePlayerSkill(0)

    expect(monster.currentHp).toBe(hpBefore)
    expect(game.currentCombo).toBe(0)
    expect(game.damagePopups.filter(p => p.type !== 'heal' && p.type !== 'lifesteal').length).toBe(0)
    expect(game.battleLog.filter(l => l.includes('生命汲取技能：') || l.includes('属性吸血：') || l.includes('命中回复')).length).toBe(0)
    expect(playerStore.activeBuffs.size).toBe(1) // 仅 defense
    expect(playerStore.player.skills[0]!.currentCooldown).toBeGreaterThan(0)
  })

  it('skill_heal（heal）：怪物 HP 不变，玩家 HP 上升，无伤害/吸血（技能吸血）/命中回复日志', () => {
    const { playerStore, game, monsterStore } = setupNonDamage('skill_heal')
    const monster = monsterStore.currentMonster!
    const hpBefore = monster.currentHp
    const playerHpBefore = playerStore.player.currentHp

    game.primePlayerGauge()
    game.tryUsePlayerSkill(0)

    expect(monster.currentHp).toBe(hpBefore) // 怪物不受治疗影响
    expect(playerStore.player.currentHp).toBeGreaterThan(playerHpBefore) // 治疗生效（30% maxHp）
    expect(game.currentCombo).toBe(0)
    expect(game.damagePopups.filter(p => p.type !== 'heal' && p.type !== 'lifesteal').length).toBe(0)
    expect(game.battleLog.filter(l => l.includes('生命汲取技能：')).length).toBe(0)
    expect(game.battleLog.filter(l => l.includes('属性吸血：')).length).toBe(0)
    expect(game.battleLog.filter(l => l.includes('命中回复')).length).toBe(0)
    expect(playerStore.player.skills[0]!.currentCooldown).toBeGreaterThan(0)
    expect(game.canPlayerAct).toBe(false)
  })
})

describe('Phase 2.2.2 — P0: 伤害技能行为不变', () => {
  function setupDamage(statOver: Partial<PlayerStats> = {}) {
    const playerStore = usePlayerStore()
    const game = useGameStore()
    const monsterStore = useMonsterStore()
    playerStore.player.stats = {
      ...playerStore.player.stats,
      attack: 100, critRate: 0, critDamage: 150, speed: 100, defense: 0,
      maxHp: 1000, lifesteal: 0, hitHealFlat: 0,
      hpRegenPercent: 0, killHealPercent: 0,
      dodge: 0, accuracy: 1000,
      ...statOver
    }
    playerStore.player.maxHp = 1000
    playerStore.player.currentHp = 500
    playerStore.player.skills = [cloneSkill('skill_life_steal'), null, null, null, null]
    monsterStore.currentMonster = makeMonster({ speed: 100, attack: 0, defense: 0, maxHp: 1000 })
    game.setCombatRng(() => 0.5)
    return { playerStore, game, monsterStore }
  }

  it('skill_life_steal 仍造成伤害并正确吸血（300 伤害 → 恢复 90）', () => {
    const { playerStore, game, monsterStore } = setupDamage()
    const monster = monsterStore.currentMonster!
    const hpBefore = monster.currentHp
    const playerHpBefore = playerStore.player.currentHp

    game.primePlayerGauge()
    game.tryUsePlayerSkill(0)

    expect(hpBefore - monster.currentHp).toBe(300) // 3×100，含命中
    expect(playerStore.player.currentHp - playerHpBefore).toBe(90) // 30% 技能吸血
    expect(game.battleLog.filter(l => l.includes('生命汲取技能：+90')).length).toBe(1)
  })

  it('伤害技能仍包含玩家全局 trueDamage / voidDamage（100/50 → 怪物多承 150）', () => {
    // 无 true/void：单次施放，combo=0 → 3×100 = 300。
    const without = setupDamage({ trueDamage: 0, voidDamage: 0 })
    without.game.primePlayerGauge()
    without.game.tryUsePlayerSkill(0)
    const mWithout = without.monsterStore.currentMonster!
    const deltaWithout = mWithout.maxHp - mWithout.currentHp

    // 关键：重建 Pinia，避免上一发施放留下的 combo（→连击加成）泄漏到下一发，污染基数。
    // 两发均在 combo=0 下测量，true/void 才表现为干净的 +150。
    setActivePinia(createPinia())
    localStorageMock.clear()
    const withTv = setupDamage({ trueDamage: 100, voidDamage: 50 })
    withTv.game.primePlayerGauge()
    withTv.game.tryUsePlayerSkill(0)
    const monsterTv = withTv.monsterStore.currentMonster!
    const deltaWith = monsterTv.maxHp - monsterTv.currentHp

    expect(deltaWithout).toBe(300)
    expect(deltaWith).toBe(450) // 300 + 100 + 50（true/void 为命中后加算，无后置乘区时即纯 +150）
    expect(deltaWith - deltaWithout).toBe(150)
  })

  it('伤害技能未命中仍不治疗（无技能吸血、无命中回复）', () => {
    const { playerStore, game, monsterStore } = setupDamage({ accuracy: 0 })
    monsterStore.currentMonster!.dodge = 100
    game.setCombatRng(() => 0.99) // 高闪避 → 必不中
    const playerHpBefore = playerStore.player.currentHp

    game.primePlayerGauge()
    game.tryUsePlayerSkill(0)

    expect(playerStore.player.currentHp - playerHpBefore).toBe(0) // 未命中不治疗
    expect(game.battleLog.filter(l => l.includes('生命汲取技能：')).length).toBe(0)
    expect(game.battleLog.filter(l => l.includes('命中回复')).length).toBe(0)
  })
})

describe('Phase 2.2.2 — P0: 非伤害技能不消费 combat RNG', () => {
  it('计数 RNG：施放 Buff/heal 后 calls === 0；随后真实伤害行动才消费 RNG', () => {
    let calls = 0
    const playerStore = usePlayerStore()
    const game = useGameStore()
    const monsterStore = useMonsterStore()
    playerStore.player.stats = {
      ...playerStore.player.stats,
      attack: 100, critRate: 0, critDamage: 150, speed: 100, defense: 0,
      maxHp: 1000, lifesteal: 0, hitHealFlat: 0,
      hpRegenPercent: 0, killHealPercent: 0, dodge: 0, accuracy: 1000
    }
    playerStore.player.maxHp = 1000
    playerStore.player.currentHp = 500
    playerStore.player.skills = [cloneSkill('skill_critical_boost'), cloneSkill('skill_heavy_strike'), null, null, null]
    monsterStore.currentMonster = makeMonster({ speed: 100, attack: 0, defense: 0 })
    game.setCombatRng(() => { calls++; return 0.5 })

    // 施放 Buff
    game.primePlayerGauge()
    game.tryUsePlayerSkill(0)
    expect(calls).toBe(0) // Buff 不消费 RNG

    // 随后真实伤害行动
    game.primePlayerGauge()
    game.tryUsePlayerSkill(1)
    expect(calls).toBeGreaterThan(0) // 伤害行动消费 RNG
  })

  it('runtime 与 simulator：非伤害技能均不消费 RNG，伤害 RNG 序列未被打断', () => {
    // ====== 设计说明 ======
    // runtime 的伤害引擎吃的是 totalStats（含被动注入，如 attack=120），而 simulator 不建模被动技能——
    // 这是两侧有意存在的 stat 层差异，因此「端到端精确伤害值对拍」不成立（parity 文件已明确记录）。
    // 本测试只比对 RNG 序列形状：两端都应表现为 [非伤害技能: 0 RNG] + [伤害技能: 消费 RNG]，
    // 即在 runtime 内部「先 Buff 再 Damage」与「直接 Damage」消费完全相同的 RNG 次数（同 RNG 流位置 → 序列未被打乱）。

    // ---------- Runtime 侧：P0 修复验证 ----------
    const buildRt = () => {
      const playerStore = usePlayerStore()
      const game = useGameStore()
      const monsterStore = useMonsterStore()
      playerStore.player.stats = {
        ...playerStore.player.stats,
        attack: 100, critRate: 0, critDamage: 150, speed: 100, defense: 0,
        maxHp: 1000, lifesteal: 0, hitHealFlat: 0,
        hpRegenPercent: 0, killHealPercent: 0, dodge: 0, accuracy: 1000
      }
      playerStore.player.maxHp = 1000
      playerStore.player.currentHp = 500
      playerStore.player.skills = [cloneSkill('skill_critical_boost'), cloneSkill('skill_heavy_strike'), null, null, null]
      monsterStore.currentMonster = makeMonster({ speed: 100, attack: 0, defense: 0 })
      return { playerStore, game, monsterStore }
    }

    // 基准：直接释放 heavy_strike（无前置 Buff），记录 RNG 调用次数与伤害。
    const base = buildRt()
    let baseCalls = 0
    base.game.setCombatRng(() => { baseCalls++; return 0.5 })
    base.game.primePlayerGauge()
    const baseTurn = base.game.executePlayerTurn(1) // skill_heavy_strike
    const baseDamage = baseTurn.damage

    // 序列：先释放 Buff（应 0 RNG），再 heavy_strike。
    const seq = buildRt()
    let seqCalls = 0
    seq.game.setCombatRng(() => { seqCalls++; return 0.5 })
    seq.game.primePlayerGauge()
    seq.game.executePlayerTurn(0) // skill_critical_boost（Buff）
    const buffCalls = seqCalls // Buff 释放瞬间的累计 RNG 调用数，应为 0
    seq.game.primePlayerGauge()
    const seqTurn = seq.game.executePlayerTurn(1) // skill_heavy_strike
    const seqDamage = seqTurn.damage
    const seqTotalCalls = seqCalls

    expect(buffCalls).toBe(0) // P0：Buff 不消费任何 RNG
    expect(baseCalls).toBeGreaterThan(0) // 伤害行动确实消费 RNG
    // 后续伤害行动消费的 RNG 次数与基准一致 → RNG 流位置未被 Buff 打断（序列未被打乱）
    expect(seqTotalCalls).toBe(baseCalls)
    expect(baseDamage).toBeGreaterThan(0) // 两次伤害均命中
    expect(seqDamage).toBeGreaterThan(0)

    // ---------- Simulator 侧：P0 修复验证 ----------
    // 用两条「仅一次玩家行动」的独立场景隔离测量：Buff 单独一次 → 0 RNG；Damage 单独一次 → 消费 RNG。
    // 窗口 1.2s 仅容纳首次玩家行动（≈1.0s）；怪物 speed=1 在窗口内绝不行动，避免怪物侧 rng 干扰计数。
    // 怪物 speed=60：玩家 speed=100 → 比例 1.67<2 无「速度双动」（避免 Buff 后自动补刀）；
    // 怪物首次行动在 100/60≈1.67s > 1.2s 窗口外，不会引入怪物侧 rng，确保 buffOnlyCalls 仅衡量玩家侧。
    const simMonster = () => buildSimMonster(1e9, 60, 0, { critResist: 0, dodge: 0, defense: 0 })
    const simStats = () => buildSimStats({ attack: 100, speed: 100, critRate: 0 })
    const simLoadout = () => [getSkillById('skill_critical_boost')!, getSkillById('skill_heavy_strike')!]

    let buffOnlyCalls = 0
    const simBuffOnly = simulateCombatScenario({
      player: buildSimPlayer(simStats()), stats: simStats(), monster: simMonster(), difficulty: 10,
      rng: () => { buffOnlyCalls++; return 0.5 },
      skillLoadout: simLoadout(),
      secondsLimit: 1.2,
      manualSkillCasts: [{ atSeconds: 0.1, slotIndex: 0 }] // 仅 Buff
    })
    expect(simBuffOnly.buffCasts).toBeGreaterThanOrEqual(1) // Buff 被建模
    expect(simBuffOnly.skillDamage).toBe(0) // 无伤害结算
    expect(buffOnlyCalls).toBe(0) // P0：simulator 的 Buff 也不引入任何 RNG

    let dmgOnlyCalls = 0
    const simDmgOnly = simulateCombatScenario({
      player: buildSimPlayer(simStats()), stats: simStats(), monster: simMonster(), difficulty: 10,
      rng: () => { dmgOnlyCalls++; return 0.5 },
      skillLoadout: simLoadout(),
      secondsLimit: 1.2,
      manualSkillCasts: [{ atSeconds: 0.1, slotIndex: 1 }] // 仅 Damage
    })
    expect(simDmgOnly.skillDamage).toBeGreaterThan(0) // 伤害行动确实结算
    expect(dmgOnlyCalls).toBeGreaterThan(0) // 伤害行动消费 RNG

    // ---------- 跨引擎 RNG 形状比对 ----------
    // 两端一致：非伤害技能 = 0 RNG；伤害技能 = 消费 RNG。RNG 序列未被非伤害技能打乱。
    expect(buffCalls).toBe(0)
    expect(buffOnlyCalls).toBe(0)
    expect(baseCalls).toBeGreaterThan(0)
    expect(dmgOnlyCalls).toBeGreaterThan(0)
  })
})

describe('Phase 2.2.2 — 模拟器：手动施放 Buff/heal 不伤怪、不增 playerDamage/skillDamage', () => {
  it('手动 Buff：monsterRemainingHp 不变、playerDamage=0、skillDamage=0、buffCasts>=1', () => {
    const stats = buildSimStats({ speed: 100 })
    const player = buildSimPlayer(stats)
    const monster = buildSimMonster(1000, 100, 0)
    const result = simulateCombatScenario({
      player, stats, monster, difficulty: 10, rng: () => 0.5,
      skillLoadout: [getSkillById('skill_critical_boost')!, getSkillById('skill_heavy_strike')!],
      // 窗口 1.5s → 仅一次玩家行动（≈1.0s），且被手动 Buff 占用，无自动伤害行动。
      secondsLimit: 1.5,
      manualSkillCasts: [{ atSeconds: 0.1, slotIndex: 0 }]
    })
    expect(result.monsterRemainingHp).toBe(1000) // 怪物不受 Buff 影响
    expect(result.playerDamage).toBe(0)
    expect(result.skillDamage).toBe(0)
    expect(result.buffCasts).toBeGreaterThanOrEqual(1)
  })

  it('手动 heal：monsterRemainingHp 不变、playerDamage=0、skillDamage=0、玩家获得恢复（netHpChange>0）', () => {
    const stats = buildSimStats({ speed: 100, maxHp: 1000, hpRegenPercent: 0, killHealPercent: 0 })
    const player = buildSimPlayer(stats)
    const monster = buildSimMonster(1000, 100, 0)
    const result = simulateCombatScenario({
      player, stats, monster, difficulty: 10, rng: () => 0.5,
      skillLoadout: [getSkillById('skill_heal')!, getSkillById('skill_heavy_strike')!],
      // 窗口 1.5s → 仅一次玩家行动（≈1.0s），且被手动 heal 占用，无自动伤害行动。
      secondsLimit: 1.5,
      manualSkillCasts: [{ atSeconds: 0.1, slotIndex: 0 }]
    })
    expect(result.monsterRemainingHp).toBe(1000) // 怪物不受治疗影响
    expect(result.playerDamage).toBe(0)
    expect(result.skillDamage).toBe(0)
    expect(result.netHpChange).toBeGreaterThan(0) // 玩家获得治疗
  })
})

describe('Phase 2.2.2 — P1: Buff 到期浮点残留', () => {
  it('统一常量存在且极小', () => {
    expect(BUFF_TIME_EPS_SECONDS).toBe(1e-9)
  })

  it('59 次 0.1 tick（T+5.9s）仍生效；第 60 次（T+6.0s）失效；不得持续到 T+6.1s', () => {
    const stats = buildSimStats({ critRate: 10, critDamage: 150, speed: 100 })
    const map = createActiveBuffMap()
    for (const e of getSkillBuffEffects(getSkillById('skill_critical_boost')!)) {
      upsertActiveBuff(map, { stat: e.stat as keyof PlayerStats, mode: e.mode, value: e.value, duration: e.duration })
    }
    expect(getEffectiveStats(stats, map).critRate).toBe(40)
    expect(getEffectiveStats(stats, map).critDamage).toBe(200)

    for (let i = 0; i < 59; i++) tickBuffs(map, 0.1)
    expect(map.size).toBe(2) // T+5.9s 仍在
    tickBuffs(map, 0.1)
    expect(map.size).toBe(0) // T+6.0s 失效
    tickBuffs(map, 0.1) // T+6.1s
    expect(map.size).toBe(0) // 不得持续到 6.1s
  })
})
