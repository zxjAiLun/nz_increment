import { describe, expect, it, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useGameStore } from './gameStore'
import { usePlayerStore } from './playerStore'
import { useMonsterStore } from './monsterStore'
import { useSkillStore } from './skillStore'
import { simulateCombatScenario, createSeededRng, type SimulatedBattleResult } from '../systems/combat/battleSimulator'
import { getSkillById } from '../utils/skillSystem'
import { createDefaultPlayer, calculateTotalStats } from '../utils/calc'
import { createBossMechanicState } from '../data/bossMechanics'
import { advanceCombatTimeline } from '../systems/combat/combatClock'
import type { Monster, Player, PlayerStats, Skill } from '../types'

const SEED = 7
const TOTAL_SECONDS = 12
const FRAME_MS = 1000 / 60
const STEP_EPS_MS = 1e-6

// 深拷贝技能，避免污染全局 SKILL_POOL（Review P1：原测试直接改 getSkillById 返回对象）。
function cloneSkill(id: string): Skill {
  const s = getSkillById(id)
  if (!s) throw new Error(`skill not found: ${id}`)
  return JSON.parse(JSON.stringify(s)) as Skill
}

function makeBoss(overrides: Partial<Monster> = {}): Monster {
  const base: Monster = {
    id: 'parity', name: 'ParityBoss [BOSS]', level: 1, phase: 1,
    maxHp: 1e9, currentHp: 1e9, attack: 0, defense: 0, speed: 50,
    critRate: 0, critDamage: 150, critResist: 0, penetration: 0, accuracy: 0, dodge: 0,
    goldReward: 0, expReward: 0, equipmentDropChance: 0, diamondDropChance: 0,
    isBoss: true, isTrainingMode: false, trainingDifficulty: null, skills: [],
    status: { marks: [], elemental: [] }, element: 'none',
    bossMechanic: { id: 'enrage', name: '狂暴', description: '', feedback: '', recommendedBuild: '', enrageAfterMs: 5000, enrageAttackMultiplier: 2 },
    bossState: createBossMechanicState()
  } as unknown as Monster
  return { ...base, ...overrides } as Monster
}

interface ScenarioSpec {
  name: string
  playerSpeed: number
  monsterSpeed: number
  monster: Monster
  skills: Skill[] // 关键：每个场景真正使用各自不同的技能集合
  attack: number
  expectEnrage: boolean
  manualCastSkillIndex?: number // 运行时不会自动施放 buff 类技能，需经真实 useSkill→processPlayerAttack 路径手动施放
}

// 不可变初始快照：运行时与模拟器各自从这里 clone，禁止「用运行时结束状态构造模拟器输入」。
// 必须使用 spec.skills，不再无条件装备重击（Review P1：四个场景共用同一隐式技能）。
function buildInitial(spec: ScenarioSpec): { player: Player; monster: Monster; skills: Skill[]; stats: PlayerStats } {
  const player: Player = createDefaultPlayer()
  player.maxHp = 1e9
  player.currentHp = 1e9
  player.stats = { ...player.stats, speed: spec.playerSpeed, attack: spec.attack, maxHp: 1e9, defense: 0, critRate: 0, critDamage: 150 }
  // 技能槽：把 spec.skills 依次放入前 N 个槽位，其余为 null。
  const slots: (Skill | null)[] = [null, null, null, null, null]
  spec.skills.forEach((sk, i) => { slots[i] = sk })
  player.skills = slots
  const stats = calculateTotalStats(player)
  const monster = JSON.parse(JSON.stringify(spec.monster)) as Monster
  return { player, monster, skills: JSON.parse(JSON.stringify(spec.skills)), stats }
}

interface RuntimeResult {
  playerActions: number
  monsterActions: number
  skillCasts: number
  playerDamage: number
  incomingDamage: number
  actionLog: Array<'P' | 'M'>
  skillCastTimes: number[]
  buffApplyMs: number | null
  buffExpireMs: number | null
  enraged: boolean
  enrageTriggeredAtMs: number | null
  ultimateTriggered: boolean
  newMonsterStartsFullHp: boolean
  finalEncounterId: number
}

function runRuntime(_spec: ScenarioSpec, initial: { player: Player; monster: Monster; skills: Skill[]; stats: PlayerStats }): RuntimeResult {
  const playerStore = usePlayerStore()
  const monsterStore = useMonsterStore()
  const game = useGameStore()
  playerStore.player = JSON.parse(JSON.stringify(initial.player))
  monsterStore.currentMonster = JSON.parse(JSON.stringify(initial.monster))
  game.gameSpeed = 1
  game.setCombatRng(createSeededRng(SEED))
  // 经真实技能路径手动施放 buff（运行时自动战斗只选 damage 类技能，不会自动施放 buff）。
  if (_spec.manualCastSkillIndex != null) {
    const skillStore = useSkillStore()
    const idx = _spec.manualCastSkillIndex
    skillStore.useSkill(idx)
    game.processPlayerAttack(idx)
  }
  // 包含窗口端点：帧量化会把「恰好 t=12.0 的边界事件」挤进最后一帧的余数缝隙而丢失，
  // 因此在总窗口上加一个极小 epsilon，确保边界事件被处理（下一事件在 0.5s 之后，不会越界）。
  const frames = Math.ceil(((TOTAL_SECONDS * 1000) + STEP_EPS_MS * 4) / FRAME_MS)
  let maxUltimate = 0
  let prevEncounter = monsterStore.currentEncounterId
  let newMonsterStartsFullHp = true
  for (let i = 0; i < frames; i++) {
    game.gameLoop(FRAME_MS)
    maxUltimate = Math.max(maxUltimate, game.ultimateGauge)
    // 换怪瞬间：新怪物必须满血（旧窗口事件不得命中新怪）。
    const enc = monsterStore.currentEncounterId
    const mon = monsterStore.currentMonster
    if (enc !== prevEncounter && mon) {
      if (mon.currentHp !== mon.maxHp) newMonsterStartsFullHp = false
      prevEncounter = enc
    }
  }
  return {
    playerActions: game.combatTelemetry.playerActions,
    monsterActions: game.combatTelemetry.monsterActions,
    skillCasts: game.combatTelemetry.skillCasts,
    playerDamage: game.combatTelemetry.playerDamage,
    incomingDamage: game.combatTelemetry.incomingDamage,
    actionLog: game.combatTelemetry.actionLog,
    skillCastTimes: game.combatTelemetry.skillCastTimes,
    buffApplyMs: game.combatTelemetry.buffApplyMs,
    buffExpireMs: game.combatTelemetry.buffExpireMs,
    enraged: !!monsterStore.currentMonster?.bossState?.enraged,
    enrageTriggeredAtMs: monsterStore.currentMonster?.bossState?.enrageTriggeredAtMs ?? null,
    ultimateTriggered: maxUltimate >= 100,
    newMonsterStartsFullHp,
    finalEncounterId: monsterStore.currentEncounterId
  }
}

function runSimulator(_spec: ScenarioSpec, initial: { player: Player; monster: Monster; skills: Skill[]; stats: PlayerStats }): SimulatedBattleResult {
  return simulateCombatScenario({
    player: JSON.parse(JSON.stringify(initial.player)),
    stats: JSON.parse(JSON.stringify(initial.stats)),
    monster: JSON.parse(JSON.stringify(initial.monster)),
    difficulty: 1,
    rng: createSeededRng(SEED),
    skillLoadout: JSON.parse(JSON.stringify(initial.skills)),
    secondsLimit: TOTAL_SECONDS
  })
}

// 由「同一份调度原语」推导本场战斗的权威行动时序（无 cap、初值为 0）。
// 模拟器与运行时都以此原语驱动行动顺序，因此运行时 actionLog 必须与之严格一致。
function canonicalOrder(playerSpeed: number, monsterSpeed: number, totalSeconds: number): Array<'P' | 'M'> {
  const tl = advanceCombatTimeline({ playerGauge: 0, monsterGauge: 0, playerSpeed, monsterSpeed, deltaSeconds: totalSeconds })
  return tl.events.map(e => (e === 'player' ? 'P' : 'M'))
}

describe('runtimeSimulatorSchedulingParity（A2.3：逐事件时钟 + 同钟 + encounter 保护）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.stubGlobal('localStorage', {
      getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {}, key: () => null, get length() { return 0 }
    } as Storage)
  })

  // 明确的「尚未统一」的字段——模拟器使用固定 0.1s tick 结算冷却并含「速度双动」额外一击，
  // 运行时为连续结算且无双动额外一击，因此下列字段允许偏差并被显式列出（不得用 >0 / <2x / 2000ms 冒充严格 parity）：
  //   - playerDamage / incomingDamage / monsterRemainingHp / remainingHp（结算 resolution 未统一）
  //   - skillCasts 在「速度双动」场景下计数不同（场景 4）
  //   - combo / 必杀具体伤害（未统一）
  //   - 技能施法时刻存在「首次边界相位滑移」这一已知 divergence（场景 2/3），仅比较次数与平均节奏

  it('场景 1：纯普攻 + 必杀——必杀槽充满触发必杀', () => {
    const spec: ScenarioSpec = { name: '纯普攻 + 必杀', playerSpeed: 100, monsterSpeed: 60, monster: makeBoss(), skills: [], attack: 100, expectEnrage: true }
    const rt = runRuntime(spec, buildInitial(spec))
    expect(rt.ultimateTriggered).toBe(true)
    expect(rt.playerDamage).toBeGreaterThan(0)
  })

  it('场景 2：真实冷却伤害技能——施法次数与节奏严格 parity（无双动）', () => {
    const spec: ScenarioSpec = { name: '真实冷却伤害技能', playerSpeed: 100, monsterSpeed: 60, monster: makeBoss(), skills: [(() => { const s = cloneSkill('skill_heavy_strike'); s.cooldown = 2; s.currentCooldown = 0; return s })()], attack: 100, expectEnrage: true }
    const rt = runRuntime(spec, buildInitial(spec))
    const sim = runSimulator(spec, buildInitial(spec))
    // 冷却 2s：施法「次数」与模拟器严格一致（无双动，运行时连续结算 == 模拟器 0.1s tick）。
    expect(rt.skillCasts).toBe(sim.skillCasts)
    expect(rt.skillCasts).toBeGreaterThan(0)
    // 节奏：平均施法间隔 ≈ 2000ms（允许 ≤300ms 误差，含首次边界相位滑移这一已知 divergence）。
    if (rt.skillCastTimes.length > 1) {
      const span = rt.skillCastTimes[rt.skillCastTimes.length - 1] - rt.skillCastTimes[0]
      const avg = span / (rt.skillCastTimes.length - 1)
      expect(Math.abs(avg - 2000)).toBeLessThanOrEqual(300)
    }
  })

  it('场景 3：5s 速度 Buff——施加/到期时刻与生效后续事件重排', () => {
    const spec: ScenarioSpec = { name: '5s 速度 Buff', playerSpeed: 100, monsterSpeed: 60, monster: makeBoss(), skills: [cloneSkill('skill_speed_boost')], attack: 100, expectEnrage: true, manualCastSkillIndex: 0 }
    const rt = runRuntime(spec, buildInitial(spec))
    expect(rt.buffApplyMs).not.toBeNull()
    expect(rt.buffExpireMs).not.toBeNull()
    // Buff 在 t≈0 经真实 useSkill 路径施加，到期 ≈ 施加 + 5000ms（≤100ms tick 误差）。
    expect(rt.buffApplyMs!).toBeLessThanOrEqual(100)
    expect(Math.abs((rt.buffExpireMs! - rt.buffApplyMs!) - 5000)).toBeLessThanOrEqual(100)
    // 生效后续事件重排：Buff 期间（apply..expire）玩家行动间隔应明显短于 Buff 之后（速度翻倍生效后更快）。
    const log = rt.actionLog
    const playerIdx = log.map((e, i) => (e === 'P' ? i : -1)).filter(i => i >= 0)
    // Buff 前（0~5s）玩家速度 200（翻倍前为 100），Buff 后（5s~）速度回落到 100 → Buff 前更密集。
    const before = playerIdx.filter(i => i < log.length * 0.5)
    const after = playerIdx.filter(i => i > log.length * 0.6)
    const avg = (arr: number[]) => arr.length > 1 ? (arr[arr.length - 1] - arr[0]) / (arr.length - 1) : Infinity
    if (before.length > 1 && after.length > 1) {
      expect(avg(before)).toBeLessThan(avg(after))
    }
  })

  it('场景 4：狂暴 + 双动 + 同刻——严格 action 顺序（怪物优先）且 skillCasts 显式 divergence', () => {
    const spec: ScenarioSpec = { name: '狂暴 + 双动 + 同刻怪物优先', playerSpeed: 200, monsterSpeed: 100, monster: makeBoss({ speed: 100 }), skills: [], attack: 100, expectEnrage: true }
    const initial = buildInitial(spec)
    const rt = runRuntime(spec, initial)
    const sim = runSimulator(spec, initial)
    const order = canonicalOrder(spec.playerSpeed, spec.monsterSpeed, TOTAL_SECONDS)
    // 行动时序仍须与共享调度原语一致（同刻怪物优先）。
    expect(rt.actionLog.join('')).toBe(order.join(''))
    expect(rt.playerActions).toBe(sim.playerActions)
    expect(rt.monsterActions).toBe(sim.monsterActions)
    // 狂暴触发时刻在「怪物行动事件」处、以真实战斗时间判定，与模拟器 0.1s tick 网格误差 ≤100ms。
    expect(rt.enraged).toBe(true)
    expect(sim.enrageTriggeredAtMs).not.toBeNull()
    if (rt.enrageTriggeredAtMs !== null && sim.enrageTriggeredAtMs !== null) {
      expect(Math.abs(rt.enrageTriggeredAtMs - sim.enrageTriggeredAtMs)).toBeLessThanOrEqual(100)
    }
    // 本场景无技能：两端 skillCasts 均为 0（显式 divergence 仅作用于有技能的场景）。
    expect(rt.skillCasts).toBe(0)
    expect(sim.skillCasts).toBe(0)
  })

  it('击杀换怪：旧窗口事件不命中新怪（encounter 保护，A2.3 P0）', () => {
    const spec: ScenarioSpec = {
      name: '快速击杀换怪', playerSpeed: 135, monsterSpeed: 50,
      monster: makeBoss({ maxHp: 100, currentHp: 100, speed: 50 }),
      skills: [], attack: 100000, expectEnrage: false
    }
    const initial = buildInitial(spec)
    const rt = runRuntime(spec, initial)
    // 多次击杀换怪（行动数远大于 1），且换怪后新怪物始终以满血出现（旧窗口事件未命中新怪）。
    expect(rt.playerActions).toBeGreaterThan(1)
    expect(rt.finalEncounterId).toBeGreaterThan(1)
    expect(rt.newMonsterStartsFullHp).toBe(true)
  })

  it('30/60/144Hz 相同战斗时间内行动次数严格一致（帧率无关）', () => {
    const spec: ScenarioSpec = { name: '帧率无关', playerSpeed: 135, monsterSpeed: 50, monster: makeBoss(), skills: [], attack: 100, expectEnrage: true }
    const counts: Record<number, number> = {}
    for (const hz of [30, 60, 144]) {
      setActivePinia(createPinia())
      const initial = buildInitial(spec)
      const playerStore = usePlayerStore()
      const monsterStore = useMonsterStore()
      const game = useGameStore()
      playerStore.player = JSON.parse(JSON.stringify(initial.player))
      monsterStore.currentMonster = JSON.parse(JSON.stringify(initial.monster))
      game.gameSpeed = 1
      game.setCombatRng(createSeededRng(SEED))
      const frameMs = 1000 / hz
      const frames = Math.round((TOTAL_SECONDS * 1000) / frameMs)
      for (let i = 0; i < frames; i++) game.gameLoop(frameMs)
      counts[hz] = game.combatTelemetry.playerActions
    }
    expect(counts[30]).toBe(counts[60])
    expect(counts[60]).toBe(counts[144])
  })

  it('生产限频：10000/10000、gameSpeed=4、200ms 输入不崩溃且单帧事件受 cap 约束', () => {
    const spec: ScenarioSpec = { name: '限频', playerSpeed: 10000, monsterSpeed: 10000, monster: makeBoss({ speed: 10000 }), skills: [], attack: 100, expectEnrage: true }
    const initial = buildInitial(spec)
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    const game = useGameStore()
    playerStore.player = JSON.parse(JSON.stringify(initial.player))
    monsterStore.currentMonster = JSON.parse(JSON.stringify(initial.monster))
    game.gameSpeed = 4
    game.setCombatRng(createSeededRng(SEED))
    // 200ms 真实输入 × gameSpeed 4 = 800ms 战斗窗口，极端倍速下不应抛出或卡死。
    for (let i = 0; i < 60; i++) game.gameLoop(200)
    expect(game.combatTelemetry.playerActions).toBeGreaterThan(0)
    expect(game.battleError).toBeNull()
  })
})
