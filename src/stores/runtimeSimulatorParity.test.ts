import { describe, expect, it, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useGameStore } from './gameStore'
import { usePlayerStore } from './playerStore'
import { useMonsterStore } from './monsterStore'
import { simulateCombatScenario, createSeededRng } from '../systems/combat/battleSimulator'
import { getSkillById } from '../utils/skillSystem'
import { createDefaultPlayer } from '../utils/calc'
import { createBossMechanicState } from '../data/bossMechanics'
import type { Monster, Player, Skill } from '../types'

const SEED = 7
const TOTAL_SECONDS = 12
const FRAME_MS = 1000 / 60

function makeBoss(): Monster {
  return {
    id: 'parity', name: 'ParityBoss [BOSS]', level: 1, phase: 1,
    maxHp: 1e9, currentHp: 1e9, attack: 0, defense: 0, speed: 50,
    critRate: 0, critDamage: 150, critResist: 0, penetration: 0, accuracy: 0, dodge: 0,
    goldReward: 0, expReward: 0, equipmentDropChance: 0, diamondDropChance: 0,
    isBoss: true, isTrainingMode: false, trainingDifficulty: null, skills: [],
    status: { marks: [], elemental: [] }, element: 'none',
    bossMechanic: { id: 'enrage', name: '狂暴', description: '', feedback: '', recommendedBuild: '', enrageAfterMs: 5000, enrageAttackMultiplier: 2 },
    bossState: createBossMechanicState()
  } as unknown as Monster
}

describe('运行时 / 模拟器 parity（Task 5：真正的两端交叉对比）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.stubGlobal('localStorage', {
      getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {}, key: () => null, get length() { return 0 }
    } as Storage)
  })

  it('相同场景下运行时与模拟器的玩家/怪物行动次数、狂暴触发完全一致', () => {
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    const game = useGameStore()

    // —— 共享玩家/怪物/技能 ——
    // 用 0 冷却技能：运行时每回合必放该技能 → 必杀槽不会攒满 → 运行时专属的「必杀技 5x 普攻」不会干扰伤害对比。
    // 模拟器侧 getEffectiveCooldown 下限 0.5s，但玩家约 0.74s 行动一次，故下一回合必然已转好，同样每回合放技能。
    const skill = getSkillById('skill_heavy_strike') as Skill
    skill.cooldown = 0
    skill.currentCooldown = 0

    const player: Player = createDefaultPlayer()
    player.maxHp = 1e9
    player.currentHp = 1e9
    player.stats = { ...player.stats, speed: 135, attack: 100, maxHp: 1e9, defense: 0, critRate: 5, critDamage: 150 }
    player.skills = [skill, null, null, null, null]
    playerStore.player = player

    const monster = makeBoss()
    monsterStore.currentMonster = monster

    game.gameSpeed = 1
    // 固定战斗 RNG（仅保证运行时自身可复现；与模拟器的 RNG 消费顺序不同，故伤害仅做同量级对比）
    game.setCombatRng(createSeededRng(SEED))

    // —— 运行时 harness：驱动真实 gameLoop（60Hz，gameSpeed=1）——
    const frames = Math.round((TOTAL_SECONDS * 1000) / FRAME_MS)
    for (let i = 0; i < frames; i++) game.gameLoop(FRAME_MS)

    const runtimePlayerActions = game.battleTurnCount
    const runtimeMonsterActions = game.monsterTurnCount
    const runtimeEnraged = !!monsterStore.currentMonster?.bossState?.enraged

    // —— 模拟器：相同场景、相同种子、相同技能、相同战斗时长 ——
    const simMonster = JSON.parse(JSON.stringify(monster)) as Monster
    const simResult = simulateCombatScenario({
      player,
      stats: playerStore.totalStats,
      monster: simMonster,
      difficulty: 1,
      rng: createSeededRng(SEED),
      skillLoadout: [skill],
      secondsLimit: TOTAL_SECONDS
    })

    // 行动次数一致性：均由共享 advanceGauge 决定，与帧率/RNG/双动无关。
    // 玩家行动严格相等（证明 ATB 节拍完全一致）；怪物行动允许 ±1 的离散 tick 边界误差——
    // 运行时按 60Hz 帧量化累加 50*(1000/60)/1000，720 帧后浮点为 599.999…（差一丝到 600），
    // 而模拟器用干净的 0.1s tick 恰好 600；这属于离散 tick 量化边界，非 gauge 丢失。
    expect(runtimePlayerActions).toBe(simResult.playerActions)
    expect(Math.abs(runtimeMonsterActions - simResult.monsterActions)).toBeLessThanOrEqual(1)

    // 狂暴触发一致（战斗 5s 触发，12s 内必触发）
    expect(runtimeEnraged).toBe(true)
    expect(simMonster.bossState?.enraged).toBe(true)

    // 伤害为同一战斗模型产出：允许 combo / 必杀 / 被动等运行时专属机制带来的同量级偏差，
    // 但必须同量级（非数量级差异）。这是「离散 tick / RNG 消费顺序」允许的近似误差，而非「各自运行两次相等」。
    expect(simResult.playerDamage).toBeGreaterThan(0)
    expect(game.damageStats.totalDamage).toBeGreaterThan(0)
    const ratio = Math.max(simResult.playerDamage, game.damageStats.totalDamage) /
      Math.min(simResult.playerDamage, game.damageStats.totalDamage)
    // 双动 + 速度优势倍率两端一致；combo（运行时专属，上限 +50%）是主要偏差来源，2x 仍属同量级。
    expect(ratio).toBeLessThan(2)

    // 怪物攻击为 0，两端均不应致死
    expect(game.damageStats.damageToPlayer).toBe(0)
  })

  it('gameSpeed=2 时运行时与模拟器行动次数等比翻倍', () => {
    // 模拟器没有 gameSpeed 概念，但「战斗时间×2」等价于 gameSpeed=2。
    // 因此用 gameSpeed=2 跑 T 秒，应与模拟器跑 2T 秒的行动次数一致。
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    const game = useGameStore()

    const skill = getSkillById('skill_heavy_strike') as Skill
    skill.cooldown = 0
    skill.currentCooldown = 0
    const player: Player = createDefaultPlayer()
    player.maxHp = 1e9
    player.currentHp = 1e9
    player.stats = { ...player.stats, speed: 135, attack: 100, maxHp: 1e9, defense: 0, critRate: 5, critDamage: 150 }
    player.skills = [skill, null, null, null, null]
    playerStore.player = player
    const monster = makeBoss()
    monsterStore.currentMonster = monster

    game.gameSpeed = 2
    const frames = Math.round((TOTAL_SECONDS * 1000) / FRAME_MS)
    for (let i = 0; i < frames; i++) game.gameLoop(FRAME_MS)

    // 模拟器跑 2 倍时长
    const simMonster = JSON.parse(JSON.stringify(monster)) as Monster
    const simResult = simulateCombatScenario({
      player, stats: playerStore.totalStats, monster: simMonster,
      difficulty: 1, rng: createSeededRng(SEED), skillLoadout: [skill],
      secondsLimit: TOTAL_SECONDS * 2
    })

    expect(game.battleTurnCount).toBe(simResult.playerActions)
    expect(game.monsterTurnCount).toBe(simResult.monsterActions)
  })
})
