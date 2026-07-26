import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { usePlayerStore } from './playerStore'
import { useMonsterStore } from './monsterStore'
import { useGameStore } from './gameStore'
import { useTrainingStore } from './trainingStore'
import { useRuneStore } from './runeStore'
import { useAchievementStore } from './achievementStore'
import { useChallengeStore } from './challengeStore'
import { useCollectionStore } from './collectionStore'
import { useRebirthStore } from './rebirthStore'
import type { Rune } from './runeStore'
import {
  RUNE_DROP_CONFIG,
  getBaseRuneDropChance,
  normalizeRuneDropChance
} from '../utils/runeDrop'
import { generateMonster } from '../utils/monsterGenerator'
import { rollKillDrops } from '../utils/killDrops'
import { generateEquipment } from '../utils/equipmentGenerator'
import { validateRune, getPlayerEquipmentRuneBonuses, getRuneDisplayName, createEmptyEquipmentRuneSlots } from '../utils/equipmentRunes'
import { validateRuneProgressionState } from '../utils/runeExperience'
import { calculateTotalStats, createDefaultPlayer } from '../utils/calc'
import { getSkillById } from '../utils/skillSystem'
import {
  simulateCombatScenario,
  simulateBalancePoint,
  simulateBattle,
  evaluateBalanceGuardrails,
  formatBalanceReportMarkdown,
  createSeededRng,
  type SimulatedBattleResult
} from '../systems/combat/battleSimulator'
import type { Monster, PlayerStats, Skill, Equipment } from '../types'

const SAVE_KEY = 'lollipop_adventure_save'
const HEAVY = 'skill_heavy_strike'

function cloneSkill(id: string): Skill {
  const s = getSkillById(id)
  if (!s) throw new Error(`skill not found: ${id}`)
  return JSON.parse(JSON.stringify(s)) as Skill
}

// ---------------------------------------------------------------------------
// 共享：失败注入器
// ---------------------------------------------------------------------------

/** 让主存档 setItem 抛错、读取委托真实 storage。 */
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

// ---------------------------------------------------------------------------
// 共享：RNG 包装（计数 + 调用顺序记录）
// ---------------------------------------------------------------------------

function makeCountedRng(values: number[]) {
  let i = 0
  let calls = 0
  const order: number[] = []
  const rng = () => {
    calls++
    const v = values[i++] ?? 0
    order.push(v)
    return v
  }
  return { rng, getCalls: () => calls, order }
}

function callRoll(values: number[], opts: { rune: unknown; ts?: number }) {
  const r = makeCountedRng(values)
  const tsFactory = () => opts.ts ?? 1000
  const result = rollKillDrops({
    rng: r.rng,
    baseEquipmentChance: 1,
    baseDiamondDropChance: 1,
    baseRuneDropChance: opts.rune,
    luck: 0,
    isBoss: false,
    difficulty: 1,
    rarityBonus: 0,
    runeTimestampFactory: tsFactory
  })
  return { result, calls: r.getCalls(), order: r.order }
}

/**
 * 装备形状比较：equipment.id 由 generateId()（基于 Math.random/Date）非确定性生成，
 * 相同 rng 序列下两次 roll 的 id 不同，但 slot/rarity/level/stats/affixes 完全一致。
 * 因此 parity/旧结果比对必须排除 id，只比较确定性字段。
 */
function equipShape(eq: Equipment | null) {
  if (!eq) return null
  return {
    slot: eq.slot,
    rarity: eq.rarity,
    level: eq.level,
    stats: eq.stats,
    affixes: eq.affixes
  }
}

// ---------------------------------------------------------------------------
// 共享：runtime 击杀场景构造
// ---------------------------------------------------------------------------

function buildRuntimeScenario(opts: { runeDropChance?: number; equipDropChance?: number; diamondDropChance?: number } = {}) {
  const player = createDefaultPlayer()
  player.maxHp = 1e9
  player.currentHp = 1e9
  player.stats = {
    ...player.stats,
    speed: 80,
    attack: 5000,
    maxHp: 1e9,
    defense: 0,
    critRate: 0,
    critDamage: 150
  }
  player.skills = [cloneSkill(HEAVY), null, null, null, null]
  const stats: PlayerStats = calculateTotalStats(player)
  stats.attack = 5000
  stats.maxHp = 1e9
  stats.speed = 80
  stats.critRate = 0
  stats.defense = 0
  stats.accuracy = 999

  const monster = {
    id: 'kill',
    name: 'KillDummy',
    level: 1,
    phase: 1,
    maxHp: 1,
    currentHp: 1,
    attack: 0,
    defense: 0,
    speed: 50,
    critRate: 0,
    critDamage: 150,
    critResist: 0,
    penetration: 0,
    accuracy: 0,
    dodge: 0,
    goldReward: 10,
    expReward: 5,
    equipmentDropChance: opts.equipDropChance ?? 0,
    diamondDropChance: opts.diamondDropChance ?? 0,
    runeDropChance: opts.runeDropChance ?? 1,
    isBoss: false,
    isTrainingMode: false,
    trainingDifficulty: null,
    skills: [],
    status: { marks: [], elemental: [] },
    element: 'none'
  } as unknown as Monster

  return { player, monster, stats }
}

// ---------------------------------------------------------------------------
// 共享：simulator 击杀场景构造
// ---------------------------------------------------------------------------

function buildSimScenario(opts: { runeDropChance?: number } = {}) {
  const player = createDefaultPlayer()
  player.maxHp = 1e9
  player.currentHp = 1e9
  player.stats = {
    ...player.stats,
    speed: 80,
    attack: 5000,
    maxHp: 1e9,
    defense: 0,
    critRate: 0,
    critDamage: 150
  }
  player.skills = [cloneSkill(HEAVY), null, null, null, null]
  const stats: PlayerStats = calculateTotalStats(player)
  stats.attack = 5000
  stats.maxHp = 1e9
  stats.speed = 80
  stats.critRate = 0
  stats.defense = 0
  stats.accuracy = 999

  const monster = {
    id: 'kill',
    name: 'KillDummy',
    level: 1,
    phase: 1,
    maxHp: 1,
    currentHp: 1,
    attack: 0,
    defense: 0,
    speed: 50,
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
    runeDropChance: opts.runeDropChance ?? 1,
    isBoss: false,
    isTrainingMode: false,
    trainingDifficulty: null,
    skills: [],
    status: { marks: [], elemental: [] },
    element: 'none'
  } as unknown as Monster

  return { player, monster, stats }
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// ===========================================================================
// 1. 掉率配置（RUNE_DROP_CONFIG 冻结 + getBaseRuneDropChance / normalizeRuneDropChance）
// ===========================================================================

describe('Phase 3.9 掉率配置 leaf 模块', () => {
  it('RUNE_DROP_CONFIG 冻结且锁定初始掉率', () => {
    expect(RUNE_DROP_CONFIG.normalChance).toBe(0.01)
    expect(RUNE_DROP_CONFIG.bossChance).toBe(0.10)
    expect(RUNE_DROP_CONFIG.trainingChance).toBe(0)
    expect(Object.isFrozen(RUNE_DROP_CONFIG)).toBe(true)
  })

  it('getBaseRuneDropChance 按 isBoss / isTrainingMode 推导', () => {
    expect(getBaseRuneDropChance({ isBoss: false })).toBe(0.01)
    expect(getBaseRuneDropChance({ isBoss: true })).toBe(0.10)
    expect(getBaseRuneDropChance({ isBoss: false, isTrainingMode: true })).toBe(0)
    expect(getBaseRuneDropChance({ isBoss: true, isTrainingMode: true })).toBe(0)
    // training 优先于 boss
    expect(getBaseRuneDropChance({ isBoss: true, isTrainingMode: 'yes' as unknown })).toBe(0)
  })

  it('normalizeRuneDropChance 边界', () => {
    expect(normalizeRuneDropChance(undefined)).toBe(0)
    expect(normalizeRuneDropChance(null)).toBe(0)
    expect(normalizeRuneDropChance(NaN)).toBe(0)
    expect(normalizeRuneDropChance(Infinity)).toBe(0)
    expect(normalizeRuneDropChance(-0.5)).toBe(0)
    expect(normalizeRuneDropChance(0)).toBe(0)
    expect(normalizeRuneDropChance(0.5)).toBe(0.5)
    expect(normalizeRuneDropChance(1)).toBe(1)
    expect(normalizeRuneDropChance(2)).toBe(1)
    expect(normalizeRuneDropChance('0.3' as unknown)).toBe(0)
  })
})

// ===========================================================================
// 2. Monster 字段赋值
// ===========================================================================

describe('Phase 3.9 Monster.runeDropChance 构造点', () => {
  it('generateMonster：普通怪 0.01、Boss 0.10', () => {
    const normal = generateMonster(100, 1)
    expect(normal.runeDropChance).toBe(0.01)
    const boss = generateMonster(100, 10) // level % 10 === 0 → isBoss
    expect(boss.isBoss).toBe(true)
    expect(boss.runeDropChance).toBe(0.10)
    // 不从 equipmentDropChance / diamondDropChance 推导
    expect(boss.runeDropChance).not.toBe(boss.equipmentDropChance)
    expect(boss.runeDropChance).not.toBe(boss.diamondDropChance)
  })

  it('练功房怪物 runeDropChance = 0', () => {
    const training = useTrainingStore()
    training.spawnTrainingMonster()
    // 注意：setup store 中 currentTrainingMonster 已被 Pinia 解包为 Monster 对象（非 ref），直接读属性。
    expect(training.currentTrainingMonster?.runeDropChance).toBe(0)
    expect(training.currentTrainingMonster?.runeDropChance).toBe(RUNE_DROP_CONFIG.trainingChance)
  })
})

// ===========================================================================
// 3. killDrops Rune 门严格追加在装备之后（RNG 顺序 + 旧结果不变）
// ===========================================================================

describe('Phase 3.9 killDrops Rune 门 RNG 顺序', () => {
  it('Rune 门追加在装备逻辑之后，且旧钻石/装备结果不变', () => {
    const seq = new Array(40).fill(0)
    const base = callRoll(seq, { rune: 0 }) // 无 Rune：只钻石 + 装备
    const B = base.calls // 钻石门 + 钻石数量 + 装备门 + 槽位 + 稀有度 + 装备生成 RNG 数

    // 命中序列：前 B 个值不变（确保钻石/装备前缀一致），第 B 为门（0→命中），
    // 第 B+1 type=0.9(luck)、B+2 rarity=0.9(epic)、B+3 suffix=0.5。
    const hitSeq = seq.slice()
    hitSeq[B] = 0
    hitSeq[B + 1] = 0.9
    hitSeq[B + 2] = 0.9
    hitSeq[B + 3] = 0.5
    const hit = callRoll(hitSeq, { rune: 1, ts: 5555 })

    expect(hit.result.rune).not.toBeNull()
    // RNG 消费 = 装备段(B) + 门(1) + type/rarity/suffix(3)
    expect(hit.calls).toBe(B + 4)
    // 旧结果不变
    expect(hit.result.diamondCount).toBe(base.result.diamondCount)
    expect(equipShape(hit.result.equipment)).toEqual(equipShape(base.result.equipment))
    // 顺序证明：Rune type/rarity 来自装备段之后的 RNG
    expect(hit.result.rune!.type).toBe('luck')
    expect(hit.result.rune!.rarity).toBe('epic')
    const suffixId = (0.5).toString(36).substr(2, 5)
    expect(hit.result.rune!.id).toBe(`rune_5555_${suffixId}`)
  })

  it('chance = 0：不消费 Rune RNG、不调 timestamp factory、rune=null', () => {
    const seq = new Array(40).fill(0)
    const base = callRoll(seq, { rune: 0 })
    // timestamp factory 调用计数
    let tsCalls = 0
    const r = makeCountedRng(seq)
    const result = rollKillDrops({
      rng: r.rng,
      baseEquipmentChance: 1,
      baseDiamondDropChance: 1,
      baseRuneDropChance: 0,
      luck: 0,
      isBoss: false,
      difficulty: 1,
      rarityBonus: 0,
      runeTimestampFactory: () => {
        tsCalls++
        return 1000
      }
    })
    expect(result.rune).toBeNull()
    expect(result.shouldDropRune).toBe(false)
    expect(tsCalls).toBe(0)
    expect(r.getCalls()).toBe(base.calls) // 与无 Rune 基线一致，没有额外消费
  })

  it('chance > 0 且 miss：Rune 门消费 1 次、不调 factory、不生成', () => {
    const seq = new Array(40).fill(0)
    const base = callRoll(seq, { rune: 0 })
    const missSeq = seq.slice()
    missSeq[base.calls] = 0.6 // 门 0.6 >= 0.5 → miss
    let tsCalls = 0
    const r = makeCountedRng(missSeq)
    const result = rollKillDrops({
      rng: r.rng,
      baseEquipmentChance: 1,
      baseDiamondDropChance: 1,
      baseRuneDropChance: 0.5,
      luck: 0,
      isBoss: false,
      difficulty: 1,
      rarityBonus: 0,
      runeTimestampFactory: () => {
        tsCalls++
        return 1000
      }
    })
    expect(result.rune).toBeNull()
    expect(result.shouldDropRune).toBe(false)
    expect(tsCalls).toBe(0)
    expect(r.getCalls()).toBe(base.calls + 1) // 仅门 1 次，无生成
  })

  it('chance = 1（>=1）仍固定消费门 1 次，不短路', () => {
    const seq = new Array(40).fill(0)
    const base = callRoll(seq, { rune: 0 })
    const hitSeq = seq.slice()
    hitSeq[base.calls] = 0 // 门 0 < 1 → 命中
    const hit = callRoll(hitSeq, { rune: 1, ts: 9 })
    expect(hit.result.rune).not.toBeNull()
    expect(hit.calls).toBe(base.calls + 4) // 门 + type + rarity + suffix，证明门仍被消费
  })

  it('向后兼容：不传 baseRuneDropChance 与传 0 结果一致（钻石/装备不变）', () => {
    const seq = new Array(40).fill(0)
    const r1 = makeCountedRng(seq)
    const a = rollKillDrops({
      rng: r1.rng,
      baseEquipmentChance: 1,
      baseDiamondDropChance: 1,
      luck: 0,
      isBoss: false,
      difficulty: 1,
      rarityBonus: 0
    } as never)
    const r2 = makeCountedRng(seq)
    const b = rollKillDrops({
      rng: r2.rng,
      baseEquipmentChance: 1,
      baseDiamondDropChance: 1,
      baseRuneDropChance: 0,
      luck: 0,
      isBoss: false,
      difficulty: 1,
      rarityBonus: 0
    })
    expect(b.diamondCount).toBe(a.diamondCount)
    expect(equipShape(b.equipment)).toEqual(equipShape(a.equipment))
    expect(b.rune).toBeNull()
  })
})

// ===========================================================================
// 4. Rune 生成失败隔离（不影响钻石/装备、不抛）
// ===========================================================================

describe('Phase 3.9 Rune 生成失败隔离', () => {
  const seq = new Array(40).fill(0)

  function runeDropWith(factory: unknown) {
    const base = callRoll(seq, { rune: 0 })
    const r = makeCountedRng(seq)
    const result = rollKillDrops({
      rng: r.rng,
      baseEquipmentChance: 1,
      baseDiamondDropChance: 1,
      baseRuneDropChance: 1,
      luck: 0,
      isBoss: false,
      difficulty: 1,
      rarityBonus: 0,
      runeTimestampFactory: factory as () => unknown
    })
    return { result, base }
  }

  it('timestamp factory 缺失 → rune=null，钻石/装备不变、不抛', () => {
    const { result, base } = runeDropWith(undefined)
    expect(result.rune).toBeNull()
    expect(result.shouldDropRune).toBe(false)
    expect(result.diamondCount).toBe(base.result.diamondCount)
    expect(equipShape(result.equipment)).toEqual(equipShape(base.result.equipment))
  })

  it('timestamp factory 抛异常 → rune=null，钻石/装备不变、不抛', () => {
    const { result, base } = runeDropWith(() => {
      throw new Error('boom')
    })
    expect(result.rune).toBeNull()
    expect(result.diamondCount).toBe(base.result.diamondCount)
    expect(equipShape(result.equipment)).toEqual(equipShape(base.result.equipment))
  })

  it('timestamp factory 返回 null / 字符串 → planRuneGeneration 失败 → rune=null', () => {
    const nullRes = runeDropWith(() => null)
    expect(nullRes.result.rune).toBeNull()
    const strRes = runeDropWith(() => 'abc')
    expect(strRes.result.rune).toBeNull()
  })
})

// ===========================================================================
// 5. runtime 成功掉落（gameStore 真实击杀链）
// ===========================================================================

describe('Phase 3.9 runtime 成功入库（gameStore.performPlayerAction）', () => {
  it('Rune 成功掉落：inventory+1、装备孔不变、未镶嵌、成功日志、难度+1、刷新保留', () => {
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    const game = useGameStore()
    const { player, monster } = buildRuntimeScenario({ runeDropChance: 1, equipDropChance: 0, diamondDropChance: 0 })
    playerStore.player = JSON.parse(JSON.stringify(player))
    monsterStore.currentMonster = JSON.parse(JSON.stringify(monster))
    monsterStore.difficultyValue = 10
    game.setCombatRng(() => 0) // all-zero：combat 命中 + 钻石/装备门 miss + Rune 门命中

    const dateSpy = vi.spyOn(Date, 'now').mockReturnValue(4242) // 固定 timestamp → 确定 ID
    game.performPlayerAction(0)
    dateSpy.mockRestore()

    // inventory 恰好 +1
    expect(playerStore.runeInventory).toHaveLength(1)
    const rune = playerStore.runeInventory[0]
    expect(rune.id).toBe('rune_4242_') // suffix=0 → substr(2,5)=""
    expect(rune.type).toBe('attack')
    expect(rune.rarity).toBe('common')
    expect(rune.level).toBe(1)
    expect(rune.exp).toBe(0)
    expect(rune.statValue).toBe(10)

    // 装备孔完全不变（未镶嵌）
    const allEmpty = (Object.values(playerStore.player.equipment) as { runeSlots: { runeId: string | null }[] }[]).every(
      (eq) => eq.runeSlots.every((s) => s.runeId === null)
    )
    expect(allEmpty).toBe(true)

    // 未镶嵌 → 全局 Rune 聚合为空，不贡献 totalStats
    expect(getPlayerEquipmentRuneBonuses(playerStore.player.equipment, playerStore.runeInventory)).toHaveLength(0)

    // 成功日志恰好一条（获得符文）
    const runeLogs = game.battleLog.filter((m) => m.includes('获得符文：'))
    expect(runeLogs).toHaveLength(1)
    expect(runeLogs[0]).toBe(`获得符文：${getRuneDisplayName(rune)}`)

    // 难度 +1
    expect(monsterStore.difficultyValue).toBe(11)

    // 刷新后保留（重开 pinia + loadGame）
    const disk = JSON.parse(localStorage.getItem(SAVE_KEY) ?? '{}')
    expect(disk?.runeData?.inventory?.some((r: Rune) => r.id === rune.id)).toBe(true)
    setActivePinia(createPinia())
    const reloaded = usePlayerStore()
    reloaded.loadGame()
    expect(reloaded.runeInventory.some((r) => r.id === rune.id)).toBe(true)
  })
})

// ===========================================================================
// 6. runtime 失败路径
// ===========================================================================

describe('Phase 3.9 runtime 失败路径', () => {
  it('重复生成 ID：tryAcquireRune 拒绝、不重 roll、inventory 不增加、无成功日志、难度仍推进', () => {
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    const game = useGameStore()
    // 预置 inventory 含即将生成的 ID：combatRng=0 + Date.now=4242 + suffix=0 → id "rune_4242_"
    playerStore.runeInventory = [
      { id: 'rune_4242_', type: 'attack', rarity: 'common', level: 1, exp: 0, statValue: 10 }
    ]
    const { player, monster } = buildRuntimeScenario({ runeDropChance: 1, equipDropChance: 0, diamondDropChance: 0 })
    playerStore.player = JSON.parse(JSON.stringify(player))
    monsterStore.currentMonster = JSON.parse(JSON.stringify(monster))
    monsterStore.difficultyValue = 10
    game.setCombatRng(() => 0)
    const dateSpy = vi.spyOn(Date, 'now').mockReturnValue(4242)
    game.performPlayerAction(0)
    dateSpy.mockRestore()

    // 仅保留预置的那一枚，新 Rune 被拒绝（不重 roll、不覆盖）
    expect(playerStore.runeInventory).toHaveLength(1)
    expect(playerStore.runeInventory[0].id).toBe('rune_4242_')
    expect(game.battleLog.filter((m) => m.includes('获得符文：'))).toHaveLength(0)
    expect(monsterStore.difficultyValue).toBe(11)
  })

  it('悬空/损坏拓扑：继承 Phase 3.8.1 fail-closed，不自动镶嵌、装备不清理、难度仍推进', () => {
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    const game = useGameStore()
    const { player, monster } = buildRuntimeScenario({ runeDropChance: 1, equipDropChance: 0, diamondDropChance: 0 })
    playerStore.player = JSON.parse(JSON.stringify(player))
    // 武器孔悬空引用即将生成的 ID（combatRng=0 + Date.now=4242 + suffix=0 → "rune_4242_"）
    // createDefaultPlayer() 的 equipment 为空 {}，需显式构造一把合法武器以触发拓扑校验。
    const weapon = generateEquipment('weapon', 'common', 1, () => 0.5)
    weapon.runeSlots = createEmptyEquipmentRuneSlots()
    weapon.runeSlots[0] = { index: 0, runeId: 'rune_4242_' }
    playerStore.player.equipment.weapon = weapon
    monsterStore.currentMonster = JSON.parse(JSON.stringify(monster))
    monsterStore.difficultyValue = 10
    game.setCombatRng(() => 0)
    const dateSpy = vi.spyOn(Date, 'now').mockReturnValue(4242)
    game.performPlayerAction(0)
    dateSpy.mockRestore()

    // 拓扑拒绝 → inventory 空、装备孔保持原样、不自动镶嵌
    expect(playerStore.runeInventory).toHaveLength(0)
    expect(playerStore.player.equipment.weapon.runeSlots[0].runeId).toBe('rune_4242_')
    expect(game.battleLog.filter((m) => m.includes('获得符文：'))).toHaveLength(0)
    expect(monsterStore.difficultyValue).toBe(11)
  })

  it('localStorage.setItem 失败：Rune 回滚、无 ghost、finally 仍推进/保存', () => {
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    const game = useGameStore()
    const { player, monster } = buildRuntimeScenario({ runeDropChance: 1, equipDropChance: 0, diamondDropChance: 0 })
    playerStore.player = JSON.parse(JSON.stringify(player))
    monsterStore.currentMonster = JSON.parse(JSON.stringify(monster))
    monsterStore.difficultyValue = 10
    game.setCombatRng(() => 0)
    const dateSpy = vi.spyOn(Date, 'now').mockReturnValue(4242)
    // 预热：用真实 localStorage 完成其余 store 的初始化写盘，避免 stub 后首次实例化写盘
    // 发生在 grantKillRewards 的 try/finally 之外，导致 advanceAfterKill 永不执行、怪物卡死。
    useAchievementStore()
    useChallengeStore()
    useCollectionStore()
    useRebirthStore()
    installThrowingStorage() // setItem 抛错
    const advanceSpy = vi.spyOn(monsterStore, 'advanceAfterKill')

    expect(() => game.performPlayerAction(0)).toThrow()

    dateSpy.mockRestore()
    // 无 ghost Rune
    expect(playerStore.runeInventory).toHaveLength(0)
    // 难度仍推进（不留死怪）
    expect(monsterStore.difficultyValue).toBe(11)
    expect(advanceSpy).toHaveBeenCalledTimes(1)
  })
})

// ===========================================================================
// 7. simulator 接入 + Rune/分钟 指标
// ===========================================================================

describe('Phase 3.9 simulator Rune 掉落与指标', () => {
  it('simulateCombatScenario：Rune 门命中 → runeDrops=1、dropResult.rune 合法且 ID 由 runeTimestamp 决定', () => {
    const { player, monster, stats } = buildSimScenario({ runeDropChance: 1 })
    let found: SimulatedBattleResult | null = null
    let foundSeed = 0
    for (let s = 1; s <= 20 && !found; s++) {
      const rng = createSeededRng(s)
      const res = simulateCombatScenario({
        player,
        stats,
        monster,
        difficulty: 10,
        rng,
        skillLoadout: [cloneSkill(HEAVY)],
        secondsLimit: 5,
        runeTimestamp: s + 1
      })
      if (res.killed && res.runeDrops === 1) {
        found = res
        foundSeed = s
      }
    }
    expect(found).not.toBeNull()
    const rune = found!.dropResult!.rune!
    expect(rune).not.toBeNull()
    expect(validateRune(rune).ok).toBe(true)
    expect(validateRuneProgressionState(rune).ok).toBe(true)
    expect(rune.id.startsWith(`rune_${foundSeed + 1}_`)).toBe(true)
    // simulator 不持久化、不镶嵌
    expect(found!.runeDrops).toBe(1)
  })

  it('simulateBattle：单点含 runeDrops 字段且合法', () => {
    const res = simulateBattle(50, 'normal', 7, 'balanced')
    expect(typeof res.runeDrops).toBe('number')
    expect(res.runeDrops).toBeGreaterThanOrEqual(0)
  })

  it('simulateBalancePoint：runePerMinute 聚合自 totalRuneDrops 且为有限数', () => {
    const m = simulateBalancePoint(100, 'boss', 50, 'balanced')
    expect(typeof m.runePerMinute).toBe('number')
    expect(Number.isFinite(m.runePerMinute)).toBe(true)
    expect(m.runePerMinute).toBeGreaterThanOrEqual(0)
    // 不进入 resourcePowerPerMinute（保持既有公式）
    expect(typeof m.resourcePowerPerMinute).toBe('number')
  })

  it('formatBalanceReportMarkdown 含「符文/分钟」列且 runePerMinute 进入矩阵', () => {
    const point = simulateBalancePoint(10, 'normal', 20, 'balanced')
    const report = { points: [point], guardrails: evaluateBalanceGuardrails([point]), failed: false }
    const md = formatBalanceReportMarkdown(report)
    expect(md).toContain('符文/分钟')
  })
})

// ===========================================================================
// 8. runeStore 仍可用（既有生成路径未回归）
// ===========================================================================

describe('Phase 3.9 runeStore.generateRune 未回归', () => {
  it('generateRune 仍可生成合法 Rune', () => {
    const rs = useRuneStore()
    const rune = rs.generateRune(() => 0, 1234)
    expect(rune).not.toBeNull()
    expect(rune!.id).toBe('rune_1234_')
  })
})
