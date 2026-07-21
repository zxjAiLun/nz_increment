import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useGameStore } from './gameStore'
import { usePlayerStore } from './playerStore'
import { useMonsterStore } from './monsterStore'
import { useTalentStore } from './talentStore'
import { useAchievementStore } from './achievementStore'
import { useChallengeStore } from './challengeStore'
import { useCollectionStore } from './collectionStore'
import { useRebirthStore } from './rebirthStore'
import * as killDrops from '../utils/killDrops'
import type { KillDropRollResult } from '../utils/killDrops'
import { simulateCombatScenario, createSeededRng, type SimulatedBattleResult } from '../systems/combat/battleSimulator'
import { getSkillById } from '../utils/skillSystem'
import { createDefaultPlayer, calculateTotalStats } from '../utils/calc'
import type { Monster, PlayerStats, Skill } from '../types'

const SAVE_KEY = 'lollipop_adventure_save'
const HEAVY = 'skill_heavy_strike'

function cloneSkill(id: string): Skill {
  const s = getSkillById(id)
  if (!s) throw new Error(`skill not found: ${id}`)
  return JSON.parse(JSON.stringify(s)) as Skill
}

// 构造「一次命中即击杀」的低血怪物 + 高攻玩家。
// parity 场景用 monster.speed=50 / player.speed=80：玩家先手、一击必杀、速度比 1.6<2 不触发双动，
// 因此 runtime 与 simulator 在掉落前各恰好消费 2 次 combat RNG（命中 + 暴击），RNG 游标对齐。
//
// 关键：calculateTotalStats(player) 会忽略对 player.stats.attack 的覆盖，重新从基础属性算攻击，
// 导致模拟器侧玩家攻击≈1、需多回合才能击杀，使「掉落前 combat RNG 次数」远大于 2、与 runtime 错位。
// 因此必须对【计算后的 stats】再强制一次高攻/高命中/满血；怪物也压到 1 血，确保两端都在首动即击杀。
function buildKillScenario(opts: { playerSpeed?: number; monsterSpeed?: number } = {}) {
  const player = createDefaultPlayer()
  player.maxHp = 1e9
  player.currentHp = 1e9
  player.stats = {
    ...player.stats,
    speed: opts.playerSpeed ?? 80,
    attack: 5000,
    maxHp: 1e9,
    defense: 0,
    critRate: 0,
    critDamage: 150
  }
  player.skills = [cloneSkill(HEAVY), null, null, null, null]
  const stats: PlayerStats = calculateTotalStats(player)
  // 强制覆盖：保证模拟器侧「首动即击杀」（否则掉落前 combat RNG 次数与 runtime 错位）。
  stats.attack = 5000
  stats.maxHp = 1e9
  stats.speed = opts.playerSpeed ?? 80
  stats.critRate = 0
  stats.defense = 0
  stats.accuracy = 999 // 命中率封顶 → 首动必中，避免偶发 miss 导致多回合
  const monster = {
    id: 'kill', name: 'KillDummy', level: 1, phase: 1,
    maxHp: 1, currentHp: 1, attack: 0, defense: 0, speed: opts.monsterSpeed ?? 50,
    critRate: 0, critDamage: 150, critResist: 0, penetration: 0, accuracy: 0, dodge: 0,
    goldReward: 10, expReward: 5, equipmentDropChance: 0.5, diamondDropChance: 0.5,
    isBoss: false, isTrainingMode: false, trainingDifficulty: null, skills: [],
    status: { marks: [], elemental: [] }, element: 'none'
  } as unknown as Monster
  return { player, monster, stats }
}

// 记录值的 seeded RNG 包装器：保留完整抽取值序列，供 RNG 相位对拍。
function tracedRng(seed: number) {
  const base = createSeededRng(seed)
  const values: number[] = []
  const next = () => {
    const v = base()
    values.push(v)
    return v
  }
  return { values, next }
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
})

// 文件级统一恢复 spy，避免前序 describe 的 spy 泄漏到后续测试（Review 要求 #7）。
afterEach(() => {
  vi.restoreAllMocks()
})

// 真实 gameStore 入口击杀：包裹 rollKillDrops（仅记录、不替换实现），深拷贝返回的真实掉落结果。
function runRuntimeKill(seed: number): { drop: KillDropRollResult; values: number[] } {
  const { player, monster } = buildKillScenario()
  const playerStore = usePlayerStore()
  const monsterStore = useMonsterStore()
  const game = useGameStore()
  playerStore.player = JSON.parse(JSON.stringify(player))
  monsterStore.currentMonster = JSON.parse(JSON.stringify(monster))
  monsterStore.difficultyValue = 10
  const rt = tracedRng(seed)
  game.setCombatRng(() => rt.next())

  const originalRoll = killDrops.rollKillDrops
  let captured: KillDropRollResult | null = null
  const rollSpy = vi.spyOn(killDrops, 'rollKillDrops').mockImplementation((...args) => {
    const r = originalRoll(...args)
    captured = JSON.parse(JSON.stringify(r)) // 深拷贝，避免 equipNewEquipment 后续改写影响对拍
    return r
  })
  game.performPlayerAction(0)
  rollSpy.mockRestore()
  return { drop: captured!, values: rt.values }
}

// 真实 simulateCombatScenario 击杀：掉落结果来自 SimulatedBattleResult.dropResult（结构化字段）。
function runSimKill(seed: number): { drop: KillDropRollResult; values: number[]; result: SimulatedBattleResult } {
  const { player, monster, stats } = buildKillScenario()
  const st = tracedRng(seed)
  const result = simulateCombatScenario({
    player,
    stats,
    monster,
    difficulty: 10,
    rng: () => st.next(),
    skillLoadout: [cloneSkill(HEAVY)],
    secondsLimit: 5
  })
  return { drop: result.dropResult as KillDropRollResult, values: st.values, result }
}

// 经真实模拟器（非 pure helper）单次扫描出 3 个类别的种子，供严格 parity 对拍。
//  - none：不掉任何奖励；diamond：掉钻石不掉装备；equip：掉装备（任意词条数，多词条优先）。
//  - 不强制多词条门限：本场景默认稀有度加成 0，装备常仅 1 词条，硬卡 >=2 会导致 1000 内扫不到种子。
function findSeeds(): { none: number; diamond: number; equip: number } {
  const out = { none: 0, diamond: 0, equip: 0 }
  let equipMulti = 0
  for (let s = 1; s <= 1000 && (out.none === 0 || out.diamond === 0 || out.equip === 0); s++) {
    const { player, monster, stats } = buildKillScenario()
    const res = simulateCombatScenario({
      player, stats, monster, difficulty: 10, rng: createSeededRng(s),
      skillLoadout: [cloneSkill(HEAVY)], secondsLimit: 5
    })
    if (!res.killed || !res.dropResult) continue
    const d = res.dropResult
    // 注意：SimulatedBattleResult.dropResult 仅含 { diamondCount, equipment }，没有 shouldDropEquipment 字段，
    // 故以 equipment != null 判定是否掉装备（等价于 runtime 的 shouldDropEquipment）。
    const dropsDiamond = d.diamondCount > 0
    const dropsEquip = d.equipment != null
    const multiAffix = dropsEquip && d.equipment!.affixes.length >= 2
    if (out.none === 0 && !dropsDiamond && !dropsEquip) out.none = s
    else if (out.diamond === 0 && dropsDiamond && !dropsEquip) out.diamond = s
    else if (dropsEquip) {
      if (out.equip === 0) out.equip = s
      if (multiAffix && equipMulti === 0) equipMulti = s // 优先用多词条种子演示装备 parity
    }
  }
  // 优先用「多词条」种子（若存在）；否则用任意装备种子。
  if (equipMulti !== 0) out.equip = equipMulti
  if (out.none === 0 || out.diamond === 0 || out.equip === 0) throw new Error(`种子扫描未集齐: ${JSON.stringify(out)}`)
  return out
}

describe('真实 runtime 击杀链（grantKillRewards 成功路径 + finally 兜底）', () => {
  it('击杀后难度 +1、rollKillDrops 与 advanceAfterKill 各一次，且掉落 RNG 先于下一怪生成 RNG', () => {
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    const game = useGameStore()
    const { player, monster } = buildKillScenario()
    playerStore.player = JSON.parse(JSON.stringify(player))
    monsterStore.currentMonster = JSON.parse(JSON.stringify(monster))
    monsterStore.difficultyValue = 10
    game.setCombatRng(() => 0)

    const rollSpy = vi.spyOn(killDrops, 'rollKillDrops')
    const advanceSpy = vi.spyOn(monsterStore, 'advanceAfterKill')

    game.performPlayerAction(0)

    expect(monsterStore.difficultyValue).toBe(11)
    expect(rollSpy).toHaveBeenCalledTimes(1)
    expect(advanceSpy).toHaveBeenCalledTimes(1)
    expect(rollSpy.mock.invocationCallOrder[0]).toBeLessThan(advanceSpy.mock.invocationCallOrder[0])
  })

  it('击杀后存档以「新难度」落盘，刷新不会回退一层', () => {
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    const game = useGameStore()
    const { player, monster } = buildKillScenario()
    playerStore.player = JSON.parse(JSON.stringify(player))
    monsterStore.currentMonster = JSON.parse(JSON.stringify(monster))
    monsterStore.difficultyValue = 10
    game.setCombatRng(() => 0)

    game.performPlayerAction(0)

    const saved = JSON.parse(localStorage.getItem(SAVE_KEY) ?? '{}')
    expect(saved?.monsterData?.difficultyValue).toBe(11)
    expect(saved?.monsterData?.difficultyValue).not.toBe(10)
  })

  it('装备环节抛异常，推进仍无条件发生且存档为新难度（finally 兜底，不留死怪）', () => {
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    const game = useGameStore()
    const { player, monster } = buildKillScenario()
    playerStore.player = JSON.parse(JSON.stringify(player))
    monsterStore.currentMonster = JSON.parse(JSON.stringify(monster))
    monsterStore.difficultyValue = 10
    game.setCombatRng(() => 0)
    vi.spyOn(playerStore, 'equipNewEquipment').mockImplementation(() => { throw new Error('equip boom') })

    expect(() => game.performPlayerAction(0)).toThrow()

    expect(monsterStore.difficultyValue).toBe(11)
    const saved = JSON.parse(localStorage.getItem(SAVE_KEY) ?? '{}')
    expect(saved?.monsterData?.difficultyValue).toBe(11)
    expect(monsterStore.currentMonster).not.toBeNull()
  })
})

describe('奖励链前段异常（try 覆盖完整 grantKillRewards）', () => {
  // 每个反例：奖励链某处抛错 → finally 仍推进 + 存档（难度 10→11，存档新难度，无死怪）。
  const assertNoDeadMonster = (monsterStore: ReturnType<typeof useMonsterStore>) => {
    expect(monsterStore.difficultyValue).toBe(11)
    expect(monsterStore.currentMonster).not.toBeNull()
    const saved = JSON.parse(localStorage.getItem(SAVE_KEY) ?? '{}')
    expect(saved?.monsterData?.difficultyValue).toBe(11)
  }

  it('processKillRewards 抛异常（首杀/每日进度 localStorage 写入前）：仍推进 + 存档', () => {
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    const game = useGameStore()
    const { player, monster } = buildKillScenario()
    playerStore.player = JSON.parse(JSON.stringify(player))
    monsterStore.currentMonster = JSON.parse(JSON.stringify(monster))
    monsterStore.difficultyValue = 10
    game.setCombatRng(() => 0)
    vi.spyOn(playerStore, 'processKillRewards').mockImplementation(() => { throw new Error('processKillRewards boom') })
    const advanceSpy = vi.spyOn(monsterStore, 'advanceAfterKill')
    const saveSpy = vi.spyOn(playerStore, 'saveGame') // calls through：记录 + 真实写入

    expect(() => game.performPlayerAction(0)).toThrow()

    expect(advanceSpy).toHaveBeenCalledTimes(1)
    expect(saveSpy).toHaveBeenCalledTimes(1)
    assertNoDeadMonster(monsterStore)
  })

  it('getSpecialBonuses 抛异常：仍推进 + 存档', () => {
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    const game = useGameStore()
    const { player, monster } = buildKillScenario()
    playerStore.player = JSON.parse(JSON.stringify(player))
    monsterStore.currentMonster = JSON.parse(JSON.stringify(monster))
    monsterStore.difficultyValue = 10
    game.setCombatRng(() => 0)
    const talentStore = useTalentStore()
    vi.spyOn(talentStore, 'getSpecialBonuses').mockImplementation(() => { throw new Error('bonus boom') })
    const advanceSpy = vi.spyOn(monsterStore, 'advanceAfterKill')
    const saveSpy = vi.spyOn(playerStore, 'saveGame')

    expect(() => game.performPlayerAction(0)).toThrow()

    expect(advanceSpy).toHaveBeenCalledTimes(1)
    expect(saveSpy).toHaveBeenCalledTimes(1)
    assertNoDeadMonster(monsterStore)
  })

  it('challengeStore.incrementProgress 抛异常（trackKill/进度链）：仍推进 + 存档', () => {
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    const game = useGameStore()
    const { player, monster } = buildKillScenario()
    playerStore.player = JSON.parse(JSON.stringify(player))
    monsterStore.currentMonster = JSON.parse(JSON.stringify(monster))
    monsterStore.difficultyValue = 10
    game.setCombatRng(() => 0)
    const challengeStore = useChallengeStore()
    vi.spyOn(challengeStore, 'incrementProgress').mockImplementation(() => { throw new Error('challenge boom') })
    const advanceSpy = vi.spyOn(monsterStore, 'advanceAfterKill')
    const saveSpy = vi.spyOn(playerStore, 'saveGame')

    expect(() => game.performPlayerAction(0)).toThrow()

    expect(advanceSpy).toHaveBeenCalledTimes(1)
    expect(saveSpy).toHaveBeenCalledTimes(1)
    assertNoDeadMonster(monsterStore)
  })

  it('rollKillDrops 抛异常：仍推进 + 存档', () => {
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    const game = useGameStore()
    const { player, monster } = buildKillScenario()
    playerStore.player = JSON.parse(JSON.stringify(player))
    monsterStore.currentMonster = JSON.parse(JSON.stringify(monster))
    monsterStore.difficultyValue = 10
    game.setCombatRng(() => 0)
    vi.spyOn(killDrops, 'rollKillDrops').mockImplementation(() => { throw new Error('rollKillDrops boom') })
    const advanceSpy = vi.spyOn(monsterStore, 'advanceAfterKill')
    const saveSpy = vi.spyOn(playerStore, 'saveGame')

    expect(() => game.performPlayerAction(0)).toThrow()

    expect(advanceSpy).toHaveBeenCalledTimes(1)
    expect(saveSpy).toHaveBeenCalledTimes(1)
    assertNoDeadMonster(monsterStore)
  })

  it('localStorage.setItem 抛异常（首杀/每日进度保存失败）：怪物仍推进，不被卡死', () => {
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    const game = useGameStore()
    const { player, monster } = buildKillScenario()
    playerStore.player = JSON.parse(JSON.stringify(player))
    monsterStore.currentMonster = JSON.parse(JSON.stringify(monster))
    monsterStore.difficultyValue = 10
    game.setCombatRng(() => 0)
    // 预热：用真实 localStorage 完成所有 store 的初始化写盘。
    // 关键 —— performPlayerAction 顶部会首次调用 useChallengeStore/useAchievementStore/useCollectionStore，
    // 这些 store 的 setup 会立即写 localStorage（challengeStore load→save、collectionStore save 等）。
    // 若不先以真实 localStorage 预热，则 stub 后这些「首次实例化写盘」会发生在 grantKillRewards 的 try/finally 之外，
    // 导致 advanceAfterKill 永不执行、怪物卡死（difficultyValue 停在 10）。预热后它们已是单例，不再触发 init 写盘。
    useAchievementStore()
    useChallengeStore()
    useCollectionStore()
    useRebirthStore()
    // 用 stub 全局 localStorage 强制写入抛错：比 spyOn(localStorage,'setItem') 更稳 ——
    // jsdom 下 localStorage 可能为 getter 每次返回新实例，导致 spyOn 不拦截 saveGame 实际调用。
    const setItemSpy = vi.fn((_k: string, _v: string) => { throw new Error('quota exceeded') })
    // 先捕获「真实」localStorage 引用：stub 后全局 localStorage 会变成 throwingStorage 自身，
    // 若 delegates 仍写 `localStorage.xxx` 会无限递归爆栈（异常发生在 getItem 而非 setItem）。
    // 因此 getItem/removeItem/clear/key/length 都委托给捕获前的真实实例，仅 setItem 抛错。
    const realLocalStorage = localStorage
    const throwingStorage = {
      getItem: (k: string) => realLocalStorage.getItem(k),
      removeItem: (k: string) => realLocalStorage.removeItem(k),
      clear: () => realLocalStorage.clear(),
      key: (i: number) => realLocalStorage.key(i),
      get length() { return realLocalStorage.length }
    }
    Object.defineProperty(throwingStorage, 'setItem', { value: setItemSpy, enumerable: true })
    vi.stubGlobal('localStorage', throwingStorage)
    const advanceSpy = vi.spyOn(monsterStore, 'advanceAfterKill')
    const saveSpy = vi.spyOn(playerStore, 'saveGame')

    try {
      // processKillRewards 的「首杀/每日进度」localStorage 写入未被 try/catch 包裹，故异常会向上抛；
      // 但 finally（advanceAfterKill + saveGame）仍无条件执行，怪物不会卡在旧难度。这正是不留死怪兜底的验证点。
      expect(() => game.performPlayerAction(0)).toThrow()

      expect(setItemSpy).toHaveBeenCalled() // 确实尝试了持久化
      expect(advanceSpy).toHaveBeenCalledTimes(1)
      expect(saveSpy).toHaveBeenCalledTimes(1)
      expect(monsterStore.difficultyValue).toBe(11) // 不退化为死怪卡在旧难度
      expect(monsterStore.currentMonster).not.toBeNull()
    } finally {
      vi.unstubAllGlobals() // 恢复真实 localStorage，避免泄漏到后续测试
    }
  })

  it('advanceAfterKill 本身抛异常：嵌套 finally 仍尝试 saveGame（至少保存已改变进度）', () => {
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    const game = useGameStore()
    const { player, monster } = buildKillScenario()
    playerStore.player = JSON.parse(JSON.stringify(player))
    monsterStore.currentMonster = JSON.parse(JSON.stringify(monster))
    monsterStore.difficultyValue = 10
    game.setCombatRng(() => 0)
    // advanceAfterKill 抛错（下一怪生成失败）：嵌套 finally 中 saveGame 仍应被调用一次。
    vi.spyOn(monsterStore, 'advanceAfterKill').mockImplementation(() => { throw new Error('advance boom') })
    const saveSpy = vi.spyOn(playerStore, 'saveGame')

    expect(() => game.performPlayerAction(0)).toThrow()

    // advance 抛错导致难度未推进、怪物未换，但 saveGame 仍尝试一次。
    expect(saveSpy).toHaveBeenCalledTimes(1)
  })
})

describe('runtime ↔ simulator 真实掉落结果 parity（同 seed + tracedRng，非 rollKillDrops 调两遍）', () => {
  it('3 个类别（不掉/掉钻石/掉装备多词条）：两端掉落结果与 RNG 相位严格一致', () => {
    const seeds = findSeeds()

    for (const cat of ['none', 'diamond', 'equip'] as const) {
      const seed = seeds[cat]
      const runtime = runRuntimeKill(seed)
      const sim = runSimKill(seed)

      // 1) 真实产出严格一致（runtime 经 gameStore.performPlayerAction，simulator 经 simulateCombatScenario；均未直接调用 rollKillDrops 计算 expected）
      // 注意：sim.drop 为 SimulatedBattleResult.dropResult，仅含 { diamondCount, equipment }，无 shouldDropEquipment 字段；
      //      故以 equipment != null 判定是否掉装备，与 runtime 的 shouldDropEquipment 等价。
      expect(runtime.drop.diamondCount).toBe(sim.drop.diamondCount)
      const rtHasEquip = runtime.drop.equipment != null
      const simHasEquip = sim.drop.equipment != null
      expect(rtHasEquip).toBe(simHasEquip)
      if (rtHasEquip && simHasEquip) {
        expect(runtime.drop.equipment!.slot).toBe(sim.drop.equipment!.slot)
        expect(runtime.drop.equipment!.rarity).toBe(sim.drop.equipment!.rarity)
        expect(runtime.drop.equipment!.stats).toEqual(sim.drop.equipment!.stats)
        expect(runtime.drop.equipment!.affixes).toEqual(sim.drop.equipment!.affixes)
      } else {
        expect(runtime.drop.equipment).toBeNull()
        expect(sim.drop.equipment).toBeNull()
      }

      // 2) RNG 相位：进入奖励阶段时游标相同（掉落前两端各恰好 2 次 = 命中 + 暴击）
      expect(runtime.values.slice(0, 2)).toEqual(sim.values.slice(0, 2))
      // dropLen 通过「回放 rollKillDrops 于 sim 掉落段（values[2..]）」精确推导，不依赖 sim.values.length ——
      // 模拟器在击杀后仍继续时间轴模拟（怪物已死仍跑满 5s），会额外消费 RNG，故 sim 总长度不可用于推导 dropLen。
      let dropLen = 0
      const replayRng = () => sim.values[2 + dropLen++]
      const replayed = killDrops.rollKillDrops({
        rng: replayRng,
        baseEquipmentChance: 0.5,
        baseDiamondDropChance: 0.5,
        luck: 10,
        isBoss: false,
        difficulty: 10,
        rarityBonus: 0
      })
      // sanity：回放结果与 sim.drop 完全一致（同一段 RNG、同一参数）——证明掉落段消费顺序一致
      expect(replayed.diamondCount).toBe(sim.drop.diamondCount)
      expect(replayed.equipment != null).toBe(sim.drop.equipment != null)
      // 掉落段（reward）消费的值完全相同：runtime 与 sim 在 values[2..2+dropLen) 逐值一致
      expect(runtime.values.slice(2, 2 + dropLen)).toEqual(sim.values.slice(2, 2 + dropLen))
      // 进入掉落前 + 掉落段：两端前缀 [0,2+dropLen) 完全一致（combat 2 次 + 掉落段）；掉落之后两端各自分歧
      // （runtime 进入 advanceAfterKill 生成下一怪，simulator 继续空跑时间轴），故仅比较此前缀。
      expect(runtime.values.slice(0, 2 + dropLen)).toEqual(sim.values.slice(0, 2 + dropLen))

      // 3) 分类专属：掉落门固定消费；未掉落不消费后续 RNG（dropLen 由 rollKillDrops 锁定顺序决定）
      if (cat === 'none') {
        // 不掉任何奖励：仅 2 次（钻石门 + 装备门），不消费数量/槽位/稀有度/词条 RNG
        expect(dropLen).toBe(2)
        expect(runtime.drop.diamondCount).toBe(0)
        expect(runtime.drop.shouldDropEquipment).toBe(false)
        expect(sim.drop.equipment).toBeNull()
      } else if (cat === 'diamond') {
        // 掉钻石但不掉装备：3 次（钻石门 + 钻石数量 + 装备门），不消费槽位/稀有度/词条 RNG
        expect(dropLen).toBe(3)
        expect(runtime.drop.diamondCount).toBeGreaterThan(0)
        expect(runtime.drop.shouldDropEquipment).toBe(false)
        expect(sim.drop.equipment).toBeNull()
      } else {
        // 掉装备：dropLen 取决于词条生成 RNG 数（≥4，= 钻石门+装备门+槽位+稀有度+词条生成）；装备字段严格一致已在上方校验
        expect(dropLen).toBeGreaterThanOrEqual(4)
        expect(runtime.drop.shouldDropEquipment).toBe(true)
        expect(runtime.drop.equipment).not.toBeNull()
        expect(sim.drop.equipment).not.toBeNull()
      }
    }
  })
})
