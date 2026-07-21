import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useGameStore } from './gameStore'
import { usePlayerStore } from './playerStore'
import { useMonsterStore } from './monsterStore'
import * as killDrops from '../utils/killDrops'
import { simulateCombatScenario, createSeededRng, type SimulatedBattleResult } from '../systems/combat/battleSimulator'
import { getSkillById } from '../utils/skillSystem'
import { createDefaultPlayer, calculateTotalStats } from '../utils/calc'
import type { Monster, PlayerStats, Skill } from '../types'

const SEED = 7
const SAVE_KEY = 'lollipop_adventure_save'

// 真实伤害技能（来自 SKILL_POOL），供运行时自动战斗 / 手动施放走 damage 路径。
function cloneSkill(id: string): Skill {
  const s = getSkillById(id)
  if (!s) throw new Error(`skill not found: ${id}`)
  return JSON.parse(JSON.stringify(s)) as Skill
}

// 构造一个「一次命中即击杀」的低血怪物 + 高攻玩家，确保真实入口能稳定触发击杀奖励链。
function setupKillScenario() {
  const player = createDefaultPlayer()
  player.maxHp = 1e9
  player.currentHp = 1e9
  player.stats = { ...player.stats, speed: 10, attack: 5000, maxHp: 1e9, defense: 0, critRate: 0, critDamage: 150 }
  const dmg = cloneSkill('skill_heavy_strike')
  const slots: (Skill | null)[] = [dmg, null, null, null, null]
  player.skills = slots
  const stats: PlayerStats = calculateTotalStats(player)
  const monster = {
    id: 'kill', name: 'KillDummy', level: 1, phase: 1,
    maxHp: 10, currentHp: 10, attack: 0, defense: 0, speed: 50,
    critRate: 0, critDamage: 150, critResist: 0, penetration: 0, accuracy: 0, dodge: 0,
    goldReward: 10, expReward: 5, equipmentDropChance: 0.5, diamondDropChance: 0.5,
    isBoss: false, isTrainingMode: false, trainingDifficulty: null, skills: [],
    status: { marks: [], elemental: [] }, element: 'none'
  } as unknown as Monster
  return { player, monster, stats }
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
})

describe('真实 runtime 击杀链（gameStore → grantKillRewards → rollKillDrops → advanceAfterKill）', () => {
  it('击杀后难度 +1、rollKillDrops 与 advanceAfterKill 各调用一次，且掉落 RNG 先于下一怪生成 RNG', () => {
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    const game = useGameStore()
    const { player, monster } = setupKillScenario()
    playerStore.player = JSON.parse(JSON.stringify(player))
    monsterStore.currentMonster = JSON.parse(JSON.stringify(monster))
    monsterStore.difficultyValue = 10
    game.setCombatRng(() => 0)

    const rollSpy = vi.spyOn(killDrops, 'rollKillDrops')
    const advanceSpy = vi.spyOn(monsterStore, 'advanceAfterKill')

    game.performPlayerAction(0) // 经真实入口施放 damage 技能，触发真实击杀链

    expect(monsterStore.difficultyValue).toBe(11) // 推进无条件发生
    expect(rollSpy).toHaveBeenCalledTimes(1) // 掉落经真实 rollKillDrops 完成
    expect(advanceSpy).toHaveBeenCalledTimes(1) // 下一怪真实生成
    // 顺序：掉落 roll 必须先于 advanceAfterKill（下一怪生成），保证两端同种子掉落判定位置一致
    expect(rollSpy.mock.invocationCallOrder[0]).toBeLessThan(advanceSpy.mock.invocationCallOrder[0])
  })

  it('击杀后存档以「新难度」落盘，刷新不会回退一层', () => {
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    const game = useGameStore()
    const { player, monster } = setupKillScenario()
    playerStore.player = JSON.parse(JSON.stringify(player))
    monsterStore.currentMonster = JSON.parse(JSON.stringify(monster))
    monsterStore.difficultyValue = 10
    game.setCombatRng(() => 0)

    game.performPlayerAction(0)

    const saved = JSON.parse(localStorage.getItem(SAVE_KEY) ?? '{}')
    expect(saved?.monsterData?.difficultyValue).toBe(11) // 存档为推进后的新难度
    expect(saved?.monsterData?.difficultyValue).not.toBe(10) // 不是旧的 equip 期难度
  })

  it('即使装备环节抛异常，推进仍无条件发生且存档为新难度（finally 兜底，不留死怪）', () => {
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    const game = useGameStore()
    const { player, monster } = setupKillScenario()
    playerStore.player = JSON.parse(JSON.stringify(player))
    monsterStore.currentMonster = JSON.parse(JSON.stringify(monster))
    monsterStore.difficultyValue = 10
    game.setCombatRng(() => 0)

    // 装备环节抛异常：复刻「奖励异常后永久留下死怪」风险路径
    vi.spyOn(playerStore, 'equipNewEquipment').mockImplementation(() => { throw new Error('equip boom') })

    expect(() => game.performPlayerAction(0)).toThrow()

    // 即便奖励抛异常，advanceAfterKill（finally）仍使难度推进、saveGame 落盘新难度
    expect(monsterStore.difficultyValue).toBe(11)
    const saved = JSON.parse(localStorage.getItem(SAVE_KEY) ?? '{}')
    expect(saved?.monsterData?.difficultyValue).toBe(11)
    // 旧怪已不再是「死怪」卡在旧难度：currentMonster 已被 advanceAfterKill 重新指派
    expect(monsterStore.currentMonster).not.toBeNull()
  })
})

describe('真实 simulator 击杀链（simulateCombatScenario）', () => {
  it('simulateCombatScenario 在击杀时路由 rollKillDrops（与 runtime 共用同一掉落函数）', () => {
    const { player: basePlayer, monster } = setupKillScenario()
    // 模拟器侧：提高行动速度确保击杀在窗口内发生（runtime 侧仍用 speed=10 走真实入口）
    basePlayer.stats.speed = 100
    const stats = calculateTotalStats(basePlayer)
    const rollSpy = vi.spyOn(killDrops, 'rollKillDrops')
    const result: SimulatedBattleResult = simulateCombatScenario({
      player: basePlayer,
      stats,
      monster,
      difficulty: 10,
      rng: createSeededRng(SEED),
      skillLoadout: [getSkillById('skill_heavy_strike')!],
      secondsLimit: 10
    })
    expect(result.killed).toBe(true)
    expect(result.gold).toBeGreaterThan(0)
    expect(rollSpy).toHaveBeenCalled() // 模拟器同样经 rollKillDrops 完成掉落
    rollSpy.mockRestore()
  })
})

describe('runtime ↔ simulator 掉落顺序共享（真实入口，非 rollKillDrops 调两遍）', () => {
  afterEach(() => vi.restoreAllMocks())

  it('两端均经由 rollKillDrops 完成掉落，且 runtime 侧掉落 RNG 先于下一怪生成 RNG', () => {
    // runtime 侧：真实 gameStore 击杀
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    const game = useGameStore()
    const { player, monster } = setupKillScenario()
    playerStore.player = JSON.parse(JSON.stringify(player))
    monsterStore.currentMonster = JSON.parse(JSON.stringify(monster))
    monsterStore.difficultyValue = 10
    game.setCombatRng(() => 0)
    const runtimeRoll = vi.spyOn(killDrops, 'rollKillDrops')
    const runtimeAdvance = vi.spyOn(monsterStore, 'advanceAfterKill')
    game.performPlayerAction(0)
    expect(runtimeRoll).toHaveBeenCalledTimes(1)
    expect(runtimeAdvance).toHaveBeenCalledTimes(1)
    expect(runtimeRoll.mock.invocationCallOrder[0]).toBeLessThan(runtimeAdvance.mock.invocationCallOrder[0])
    // 用完即还原，避免与下方 simulator spy 嵌套计数同一函数（同一 fn 上两层 spy 会叠加计数）
    runtimeRoll.mockRestore()
    runtimeAdvance.mockRestore()

    // simulator 侧：真实 simulateCombatScenario（与 runtime 共用 rollKillDrops，纯函数）
    const { player: simPlayer, monster: simMonster } = setupKillScenario()
    simPlayer.stats.speed = 100
    const simStats = calculateTotalStats(simPlayer)
    const simRoll = vi.spyOn(killDrops, 'rollKillDrops')
    const result = simulateCombatScenario({
      player: simPlayer,
      stats: simStats,
      monster: simMonster,
      difficulty: 10,
      rng: createSeededRng(SEED),
      skillLoadout: [getSkillById('skill_heavy_strike')!],
      secondsLimit: 10
    })
    expect(result.killed).toBe(true)
    expect(simRoll).toHaveBeenCalled() // 两端都走 rollKillDrops，掉落函数唯一、RNG 顺序一致
  })
})
