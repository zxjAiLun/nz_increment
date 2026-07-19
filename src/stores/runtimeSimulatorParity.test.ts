import { describe, expect, it, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useGameStore } from './gameStore'
import { usePlayerStore } from './playerStore'
import { useMonsterStore } from './monsterStore'
import { simulateCombatScenario, createSeededRng, type SimulatedBattleResult } from '../systems/combat/battleSimulator'
import { getSkillById } from '../utils/skillSystem'
import { createDefaultPlayer, calculateTotalStats } from '../utils/calc'
import { createBossMechanicState } from '../data/bossMechanics'
import { advanceCombatTimeline } from '../systems/combat/combatClock'
import type { Monster, Player, PlayerStats, Skill } from '../types'

const SEED = 7
const TOTAL_SECONDS = 12
const FRAME_MS = 1000 / 60

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
  manualCastSkillIndex?: number // 运行时自动战斗只选 damage 类技能，buff 需经原子入口 tryUsePlayerSkill 在 gauge 满时手动施放
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
  playerActionTimes: number[]
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
  game.enableCombatTelemetry(true)
  // 经由「原子手动技能入口」施放 buff：必须等 gauge 真正充满（canPlayerAct）后再用 tryUsePlayerSkill 释放，
  // 禁止在 gauge=0 时直接调用有副作用的 useSkill()。这复刻了真实 App 行为（玩家在槽位满时点击）。
  let manualCastDone = false
  // 恰好 12 秒输入：不额外补帧。边界事件（t=12.0）应被事件驱动循环在本窗口内如实处理。
  const frames = Math.round((TOTAL_SECONDS * 1000) / FRAME_MS)
  let maxUltimate = 0
  let prevEncounter = monsterStore.currentEncounterId
  let newMonsterStartsFullHp = true
  // 在循环开始前，把玩家行动槽直接置满并立即经原子入口施放 buff（模拟「槽位满、玩家点击」瞬间）。
  // 这复刻真实 App 行为，且不依赖离散帧内瞬时满槽的竞态。
  if (_spec.manualCastSkillIndex != null) {
    game.primePlayerGauge()
    if (game.tryUsePlayerSkill(_spec.manualCastSkillIndex)) manualCastDone = true
  }
  for (let i = 0; i < frames; i++) {
    // 兜底：若首个窗口内未成功能放（相位原因），在 gauge 满时再尝试一次。
    if (_spec.manualCastSkillIndex != null && !manualCastDone && game.canPlayerAct) {
      if (game.tryUsePlayerSkill(_spec.manualCastSkillIndex)) manualCastDone = true
    }
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
    playerActionTimes: game.combatTelemetry.playerActionTimes,
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

  // 自 A2.4.1（逐事件时钟 + 同钟）起，运行时与模拟器已共用 advanceCombatTimeline，且两端均实现「速度双动」额外一击。
  // 因此下列为「仍允许偏差」的字段——仅限结算 resolution 与相位滑移，不得用于掩盖技能效果 / 吸血 / Buff 语义的分叉：
  //   - playerDamage / incomingDamage / monsterRemainingHp / remainingHp（模拟器 0.1s 固定 tick vs 运行时连续结算，resolution 未统一）
  //   - combo / 必杀具体伤害（未统一）
  //   - 技能施法时刻存在「首次边界相位滑移」这一已知 divergence（场景 2/3），仅比较次数与平均节奏
  //   - 双动场景中 skillCasts 计数可能不同：运行时额外一击退化为普攻（不计技能施法），模拟器额外一击走自动选技可能选中 damage 技能；
  //     这是已知的结算口径差异，但「暴击强化 / 防御姿态 / 治疗等 Buff/heal 绝不自动施放」「技能吸血只作用于实际施放该技能的命中」两端必须一致（见下方 Phase 2.2.1 严格对照）。

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

  it('场景 3：5s 速度 Buff——施加/到期时刻与生效后续事件重排（真实时间戳）', () => {
    const spec: ScenarioSpec = { name: '5s 速度 Buff', playerSpeed: 100, monsterSpeed: 60, monster: makeBoss(), skills: [cloneSkill('skill_speed_boost')], attack: 100, expectEnrage: true, manualCastSkillIndex: 0 }
    const rt = runRuntime(spec, buildInitial(spec))
    expect(rt.buffApplyMs).not.toBeNull()
    expect(rt.buffExpireMs).not.toBeNull()
    // Buff 经原子入口在「gauge 首次充满」时施放；到期 ≈ 施加 + 5000ms（≤100ms tick 误差）。
    expect(rt.buffApplyMs!).toBeGreaterThanOrEqual(0)
    expect(rt.buffApplyMs!).toBeLessThanOrEqual(2000)
    expect(Math.abs((rt.buffExpireMs! - rt.buffApplyMs!) - 5000)).toBeLessThanOrEqual(100)
    // 生效后续事件重排：用真实时间戳比较玩家行动间隔。
    // Buff 期间（apply..expire）速度翻倍（200）→ 行动间隔约 500ms；Buff 后回落到 100 → 约 1000ms。
    const times = rt.playerActionTimes
    expect(times.length).toBeGreaterThan(3)
    const apply = rt.buffApplyMs!
    const expire = rt.buffExpireMs!
    const during = times.filter(t => t >= apply && t <= expire)
    const after = times.filter(t => t > expire)
    const avgInterval = (arr: number[]) => {
      if (arr.length < 2) return Infinity
      const sorted = [...arr].sort((a, b) => a - b)
      let sum = 0
      for (let i = 1; i < sorted.length; i++) sum += sorted[i] - sorted[i - 1]
      return sum / (sorted.length - 1)
    }
    // Buff 期间应明显更密集（间隔更小）于 Buff 之后。
    if (during.length >= 2 && after.length >= 2) {
      expect(avgInterval(during)).toBeLessThan(avgInterval(after))
    }
    // Buff 期间平均间隔应接近 500ms（速度 200），允许 ≤150ms 量化/相位误差。
    if (during.length >= 2) {
      expect(Math.abs(avgInterval(during) - 500)).toBeLessThanOrEqual(150)
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
      game.enableCombatTelemetry(true)
      const frameMs = 1000 / hz
      const frames = Math.round((TOTAL_SECONDS * 1000) / frameMs)
      for (let i = 0; i < frames; i++) game.gameLoop(frameMs)
      counts[hz] = game.combatTelemetry.playerActions
    }
    expect(counts[30]).toBe(counts[60])
    expect(counts[60]).toBe(counts[144])
  })

  it('生产 cap：注入小上限会真正触发限流，且排空 carry 后与无 cap 结果一致', () => {
    const spec: ScenarioSpec = { name: '限频', playerSpeed: 10000, monsterSpeed: 10000, monster: makeBoss({ speed: 10000 }), skills: [], attack: 100, expectEnrage: true }
    const initial = buildInitial(spec)

    // 无 cap 基准：单帧吞下整个大窗口，得到该窗口内的理论总行动数。
    setActivePinia(createPinia())
    let baseActions = 0
    let baseLog = ''
    {
      const ps = usePlayerStore(); const ms = useMonsterStore(); const g = useGameStore()
      ps.player = JSON.parse(JSON.stringify(initial.player)); ms.currentMonster = JSON.parse(JSON.stringify(initial.monster))
      g.gameSpeed = 4; g.setCombatRng(createSeededRng(SEED)); g.enableCombatTelemetry(true)
      g.gameLoop(200) // 200ms × gameSpeed 4 = 800ms 战斗窗口
      baseActions = g.combatTelemetry.playerActions + g.combatTelemetry.monsterActions
      baseLog = g.combatTelemetry.actionLog.join('')
    }

    // 注入 cap=20：同一 800ms 窗口，限流 20 事件/帧，剩余 carry 靠 gameLoop(0) 多次排空。
    setActivePinia(createPinia())
    const ps = usePlayerStore(); const ms = useMonsterStore(); const g = useGameStore()
    ps.player = JSON.parse(JSON.stringify(initial.player)); ms.currentMonster = JSON.parse(JSON.stringify(initial.monster))
    g.gameSpeed = 4; g.setCombatRng(createSeededRng(SEED)); g.enableCombatTelemetry(true)
    g.setLogicEventCap(20)
    g.gameLoop(200) // 首帧：最多处理 20 事件，剩余时间写 carriedCombatSeconds
    // 首帧后 carry 应 > 0
    expect(g.carriedCombatSeconds).toBeGreaterThan(0)
    // 排空 carry：多轮 gameLoop(0) 只处理已顺延的 carry，不追加新时间。
    for (let i = 0; i < 100; i++) {
      if (g.carriedCombatSeconds <= 1e-6) break
      g.gameLoop(0)
    }
    expect(g.carriedCombatSeconds).toBeLessThanOrEqual(1e-6)
    expect(g.battleError).toBeNull()
    // 排空 carry 后，总行动数、actionLog 必须等于无 cap 基准（限流只延迟、不丢失、不改变顺序）。
    expect(g.combatTelemetry.playerActions + g.combatTelemetry.monsterActions).toBe(baseActions)
    expect(g.combatTelemetry.actionLog.join('')).toBe(baseLog)
    expect(g.combatTelemetry.playerActions).toBeGreaterThan(20) // 证明 cap 确实被触发过（单帧上限 20 远小于总量）
  })

  it('30/60/144Hz × gameSpeed 0.5/1/2/4：严格帧率矩阵——playerActions/monsterActions/actionLog 全一致', () => {
    const spec: ScenarioSpec = { name: '矩阵', playerSpeed: 135, monsterSpeed: 50, monster: makeBoss(), skills: [], attack: 100, expectEnrage: true }
    let ref: { playerActions: number, monsterActions: number, log: string } | null = null
    for (const hz of [30, 60, 144]) {
      for (const gs of [0.5, 1, 2, 4]) {
        setActivePinia(createPinia())
        const initial = buildInitial(spec)
        const playerStore = usePlayerStore()
        const monsterStore = useMonsterStore()
        const game = useGameStore()
        playerStore.player = JSON.parse(JSON.stringify(initial.player))
        monsterStore.currentMonster = JSON.parse(JSON.stringify(initial.monster))
        game.gameSpeed = gs
        game.setCombatRng(createSeededRng(SEED))
        game.enableCombatTelemetry(true)
        const frameMs = 1000 / hz
        const frames = Math.round((TOTAL_SECONDS * 1000) / (frameMs * gs))
        for (let i = 0; i < frames; i++) game.gameLoop(frameMs)
        const cur = { playerActions: game.combatTelemetry.playerActions, monsterActions: game.combatTelemetry.monsterActions, log: game.combatTelemetry.actionLog.join('') }
        if (ref === null) { ref = cur; continue }
        expect(cur.playerActions).toBe(ref.playerActions)
        expect(cur.monsterActions).toBe(ref.monsterActions)
        expect(cur.log).toBe(ref.log)
      }
    }
  })

  // ─── DueNow 边界回归测试（A2.4.1 P0 修复） ─────────────────────────
  // 每个测试通过精确的初始槽位值设置，让玩家和怪物在不同时刻到达行动阈值，
  // 验证因 DueNow 判定误用 availableMs 而提前执行的一方不会在错误时间出手。

  it('DueNow 防线：5/10ms player-first——player gauge=99.5, monster gauge=99, speed=100', () => {
    setActivePinia(createPinia())
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {}, key: () => null, get length() { return 0 } } as Storage)
    const playerStore = usePlayerStore(); const monsterStore = useMonsterStore(); const g = useGameStore()
    const p = createDefaultPlayer(); p.stats.speed = 100; p.maxHp = 1e9; p.currentHp = 1e9; p.stats.attack = 0
    playerStore.player = p as any
    monsterStore.currentMonster = makeBoss({ speed: 100 })
    g.gameSpeed = 1; g.setCombatRng(createSeededRng(SEED)); g.enableCombatTelemetry(true)
    // pDelay = (100-99.5)/100*1000 = 5ms, mDelay = (100-99)/100*1000 = 10ms
    g.playerActionGauge = 99.5
    g.monsterActionGauge = 99
    g.gameLoop(16.667)
    // 5ms: player acts (gauge 99.5+0.5=100), then gauge=0
    // 剩余 11.67ms, player gauge=0 (need 1000ms), monster gauge=99 (need 10-5=5ms)
    // nextDelay=5ms → monster gauge=100 → monster acts
    expect(g.combatTelemetry.actionLog.join('')).toBe('PM')
    expect(g.combatTelemetry.playerActions).toBe(1)
    expect(g.combatTelemetry.monsterActions).toBe(1)
  })

  it('DueNow 防线：5/10ms monster-first——monster gauge=99.5, player gauge=99, speed=100', () => {
    setActivePinia(createPinia())
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {}, key: () => null, get length() { return 0 } } as Storage)
    const playerStore = usePlayerStore(); const monsterStore = useMonsterStore(); const g = useGameStore()
    const p = createDefaultPlayer(); p.stats.speed = 100; p.maxHp = 1e9; p.currentHp = 1e9; p.stats.attack = 0
    playerStore.player = p as any
    monsterStore.currentMonster = makeBoss({ speed: 100 })
    g.gameSpeed = 1; g.setCombatRng(createSeededRng(SEED)); g.enableCombatTelemetry(true)
    // mDelay = 5ms, pDelay = 10ms
    g.monsterActionGauge = 99.5
    g.playerActionGauge = 99
    g.gameLoop(16.667)
    // 5ms: monster acts, remaining 11.67ms → 5ms later player acts
    expect(g.combatTelemetry.actionLog.join('')).toBe('MP')
    expect(g.combatTelemetry.playerActions).toBe(1)
    expect(g.combatTelemetry.monsterActions).toBe(1)
  })

  it('DueNow 防线：Buff-only 边界——3ms buff 到期（无行动），5ms player, 10ms monster', () => {
    setActivePinia(createPinia())
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {}, key: () => null, get length() { return 0 } } as Storage)
    const playerStore = usePlayerStore(); const monsterStore = useMonsterStore(); const g = useGameStore()
    const p = createDefaultPlayer(); p.stats.speed = 100; p.maxHp = 1e9; p.currentHp = 1e9; p.stats.attack = 0
    playerStore.player = p as any
    monsterStore.currentMonster = makeBoss({ speed: 100 })
    g.gameSpeed = 1; g.setCombatRng(createSeededRng(SEED)); g.enableCombatTelemetry(true)
    g.playerActionGauge = 99.5 // pDelay=5ms
    g.monsterActionGauge = 99   // mDelay=10ms
    // 施加 3ms 后到期的 buff
    playerStore.applyBuff('speed', 100, 0.003)
    g.gameLoop(16.667)
    // 3ms: buff 到期（无行动，continue 重新读取速度）
    // 5ms: player 行动 → P
    // 5ms 后: monster 行动 → M
    expect(g.combatTelemetry.actionLog.join('')).toBe('PM')
    expect(g.combatTelemetry.playerActions).toBe(1)
    expect(g.combatTelemetry.monsterActions).toBe(1)
    expect(playerStore.activeBuffs.size).toBe(0)
  })
})

// ─── Phase 2.2.1 严格机制对照（不得用「允许 divergence」绕过本轮目标） ─────
// 这些场景直接断言「自动选技策略」与「Buff 刷新语义」在运行时与模拟器两端一致：
//   - 暴击强化 / 防御姿态 / 治疗等 Buff/heal 绝不自动施放（统一 selectAutoSkill）；
//   - 速度双动额外普攻不退化为继承首击技能吸血；
//   - 模拟器 Buff 重施刷新而非叠加（与运行时 playerStore.applyBuff 同语义）。
describe('Phase 2.2.1 严格机制对照（runtime ↔ simulator）', () => {
  it('自动选技策略两端一致：混合技能栏 [critical_boost, meteor] 绝不自动施放 Buff', () => {
    const spec: ScenarioSpec = {
      name: 'auto-no-buff', playerSpeed: 100, monsterSpeed: 60, monster: makeBoss(),
      skills: [cloneSkill('skill_critical_boost'), cloneSkill('skill_meteor_strike')],
      attack: 100, expectEnrage: true
    }
    const initial = buildInitial(spec)
    const rt = runRuntime(spec, initial)
    const sim = runSimulator(spec, initial)
    const playerStore = usePlayerStore()
    // 运行时：自动选技只选 damage 技能，critical_boost（buff）永不自动施放。
    expect(playerStore.activeBuffs.has('critRate')).toBe(false)
    expect(playerStore.activeBuffs.has('critDamage')).toBe(false)
    expect(rt.skillCasts).toBeGreaterThan(0) // 确实在施放 damage 技能
    // 模拟器：同样不自动施放 Buff。
    expect(sim.buffCasts).toBe(0)
  })

  it('混合技能栏 [heal, damage]：自动选技跳过治疗，选中 damage 技能（两端）', () => {
    const spec: ScenarioSpec = {
      name: 'auto-no-heal', playerSpeed: 100, monsterSpeed: 60, monster: makeBoss(),
      skills: [cloneSkill('skill_heal'), cloneSkill('skill_heavy_strike')],
      attack: 100, expectEnrage: true
    }
    const initial = buildInitial(spec)
    runRuntime(spec, initial)
    const sim = runSimulator(spec, initial)
    const playerStore = usePlayerStore()
    expect(playerStore.activeBuffs.size).toBe(0) // 治疗不自动施放
    expect(sim.buffCasts).toBe(0)
  })
})
