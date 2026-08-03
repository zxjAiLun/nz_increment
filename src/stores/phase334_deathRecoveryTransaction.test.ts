import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
// @ts-ignore —— 测试运行于 Node，无需在应用 tsconfig 中引入 @types/node 全局类型
import { readFileSync } from 'node:fs'
// @ts-ignore
import { resolve } from 'node:path'
import { usePlayerStore } from './playerStore'
import { useMonsterStore } from './monsterStore'
import { useGameStore } from './gameStore'
import { useTrainingStore } from './trainingStore'
import { useCultivationStore } from './cultivationStore'
import { useTitleStore } from './titleStore'
import { usePetStore } from './petStore'
import { useRebirthStore } from './rebirthStore'
import { useTalentStore } from './talentStore'
import { useBattlePassStore } from './battlePassStore'
import { useCollectionStore } from './collectionStore'
import { useATBStore } from './atbStore'
// @ts-ignore
declare const process: { cwd(): string }

const SAVE_KEY = 'lollipop_adventure_save'
const DEATH_SAFE_MODE_MS = 10_000
const FIXED_NOW = 1_000_000

/**
 * Phase 3.34 — 自动死亡恢复（跨 Store 原子事务）。
 *
 * 事务本体：gameStore.tryRecoverFromDeath —— 前置规划 → 快照 → goBackLevels + 满血 →
 * 恰好一次 saveGame → 成功后才提交死亡统计/保护/行动槽/日志/飘字；任何规划失败、异常、
 * rng 抛错、存档失败都必须完整回滚 currentHp / difficultyValue / monsterLevel /
 * currentMonster（原引用）/ currentEncounterId，玩家保持死亡，磁盘不变。
 */

function warmupStores() {
  usePlayerStore()
  useMonsterStore()
  useGameStore()
  useTrainingStore()
  useCultivationStore()
  useTitleStore()
  usePetStore()
  useRebirthStore()
  useTalentStore()
  useBattlePassStore()
  useCollectionStore()
  useATBStore()
}

/** 主存档 setItem 抛错（模拟写盘失败），读取委托真实 storage。 */
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
}

/** 快照被测事务相关的全部状态。 */
function snapshotState() {
  const playerStore = usePlayerStore()
  const monsterStore = useMonsterStore()
  return {
    currentHp: playerStore.player.currentHp,
    maxHp: playerStore.player.maxHp,
    difficultyValue: monsterStore.difficultyValue,
    monsterLevel: monsterStore.monsterLevel,
    currentMonster: monsterStore.currentMonster,
    currentEncounterId: monsterStore.currentEncounterId
  }
}

/** 设置一个真实可变化的初始状态：玩家死亡（0 HP）、maxHp 100、真实怪物。 */
function seedDeadState(difficulty = 20, monsterLevel = 20) {
  const playerStore = usePlayerStore()
  const monsterStore = useMonsterStore()
  playerStore.player.currentHp = 0
  playerStore.player.maxHp = 100
  monsterStore.setProgress(difficulty, monsterLevel) // 真实生成 currentMonster，encounterId +1
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  warmupStores()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('Phase 3.34 — tryRecoverFromDeath 正常事务', () => {
  it('monsterTurn 正常死亡恢复：后退、满血、encounterId+1、saveGame 恰一次、统计/保护/行动槽/ATB/日志/飘字', () => {
    seedDeadState(45, 20) // difficulty 45 → setback 7
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    const gameStore = useGameStore()
    const atbStore = useATBStore()

    const oldMonster = monsterStore.currentMonster
    const encBefore = monsterStore.currentEncounterId
    const logBefore = gameStore.battleEvents.length
    const popupBefore = gameStore.damagePopups.length
    const saveSpy = vi.spyOn(playerStore, 'saveGame')

    const res = gameStore.tryRecoverFromDeath('monsterTurn', { rng: () => 0.5, now: FIXED_NOW })

    expect(res).toMatchObject({ ok: true, setback: 7, safeModeMs: DEATH_SAFE_MODE_MS })
    expect(monsterStore.difficultyValue).toBe(38) // 45 - 7
    expect(monsterStore.monsterLevel).toBe(13) // 20 - 7
    expect(playerStore.player.currentHp).toBe(100) // 满血 = maxHp
    expect(monsterStore.currentMonster).not.toBe(oldMonster) // 换怪
    expect(monsterStore.currentEncounterId).toBe(encBefore + 1)
    expect(saveSpy).toHaveBeenCalledTimes(1)

    // 瞬态状态提交
    expect(gameStore.deathCount).toBe(1)
    expect(gameStore.lastDeathAt).toBe(FIXED_NOW)
    expect(gameStore.safeModeUntil).toBe(FIXED_NOW + DEATH_SAFE_MODE_MS)
    expect(gameStore.lastDeathReason).toBeTruthy()
    expect(gameStore.playerActionGauge).toBe(100)
    expect(gameStore.monsterActionGauge).toBe(0)
    expect(atbStore.playerATB).toBe(100)
    expect(atbStore.monsterATB).toBe(0)

    // 两条成功日志 + 治疗飘字只出现一次
    const newLogs = gameStore.battleEvents.slice(0, gameStore.battleEvents.length - logBefore)
    expect(newLogs.filter(e => e.message.includes('你被击败了')).length).toBe(1)
    expect(newLogs.filter(e => e.message.includes('已自动后退')).length).toBe(1)
    const newPopups = gameStore.damagePopups.slice(0, gameStore.damagePopups.length - popupBefore)
    expect(newPopups.filter(p => p.type === 'heal').length).toBe(1)
  })

  it('playerTurn 正常恢复：不添加 monsterTurn 专属治疗飘字', () => {
    seedDeadState(45, 20)
    const playerStore = usePlayerStore()
    const gameStore = useGameStore()
    const popupBefore = gameStore.damagePopups.length
    vi.spyOn(playerStore, 'saveGame')

    const res = gameStore.tryRecoverFromDeath('playerTurn', { rng: () => 0.5, now: FIXED_NOW })

    expect(res.ok).toBe(true)
    const newPopups = gameStore.damagePopups.slice(0, gameStore.damagePopups.length - popupBefore)
    expect(newPopups.filter(p => p.type === 'heal').length).toBe(0)
  })

  it('难度较低/中等/高对应既有 setback 结果不回归', () => {
    const gameStore = useGameStore()
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()

    const cases = [
      { difficulty: 20, expectedSetback: 3 },
      { difficulty: 100, expectedSetback: 7 },
      { difficulty: 300, expectedSetback: 10 }
    ]
    for (const c of cases) {
      vi.spyOn(playerStore, 'saveGame')
      seedDeadState(c.difficulty, 20)
      const res = gameStore.tryRecoverFromDeath('monsterTurn', { rng: () => 0.5, now: FIXED_NOW })
      expect(res.ok).toBe(true)
      expect(res).toMatchObject({ setback: c.expectedSetback })
      expect(monsterStore.difficultyValue).toBe(Math.max(0, c.difficulty - c.expectedSetback))
      vi.restoreAllMocks()
    }
  })

  it('难度 ≥30 时 deathPenaltyUntil 更新为 now+30s', () => {
    seedDeadState(45, 20)
    const playerStore = usePlayerStore()
    const gameStore = useGameStore()
    vi.spyOn(playerStore, 'saveGame')

    const res = gameStore.tryRecoverFromDeath('monsterTurn', { rng: () => 0.5, now: FIXED_NOW })

    expect(res.ok).toBe(true)
    expect(gameStore.deathPenaltyUntil).toBe(FIXED_NOW + 30_000)
  })

  it('难度 ≥200 时 fatigue 按 talent reduction 更新', () => {
    seedDeadState(250, 20)
    const playerStore = usePlayerStore()
    const gameStore = useGameStore()
    vi.spyOn(playerStore, 'saveGame')

    const res = gameStore.tryRecoverFromDeath('monsterTurn', { rng: () => 0.5, now: FIXED_NOW })

    expect(res.ok).toBe(true)
    expect(gameStore.fatigue).toBeGreaterThan(0) // 默认 talent 0 → +1
  })
})

describe('Phase 3.34 — 前置规划 fail-closed', () => {
  it('不满足死亡条件（currentHp>0 / NaN）→ fail-closed', () => {
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    const gameStore = useGameStore()
    monsterStore.setProgress(20, 20)
    for (const hp of [10, 1, NaN]) {
      playerStore.player.currentHp = hp as number
      playerStore.player.maxHp = 100
      const before = snapshotState()
      const saveSpy = vi.spyOn(playerStore, 'saveGame')
      const res = gameStore.tryRecoverFromDeath('monsterTurn', { rng: () => 0.5, now: FIXED_NOW })
      expect(res.ok).toBe(false)
      expect(saveSpy).not.toHaveBeenCalled()
      expect(snapshotState()).toEqual(before)
      saveSpy.mockRestore()
    }
  })

  it('maxHp / 难度 / 等级 / now / rng 损坏 → fail-closed', () => {
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    const gameStore = useGameStore()

    // maxHp 损坏
    for (const maxHp of [NaN, 0, -1]) {
      monsterStore.setProgress(20, 20)
      playerStore.player.currentHp = 0
      playerStore.player.maxHp = maxHp as number
      const before = snapshotState()
      const saveSpy = vi.spyOn(playerStore, 'saveGame')
      expect(gameStore.tryRecoverFromDeath('monsterTurn', { rng: () => 0.5, now: FIXED_NOW }).ok).toBe(false)
      expect(saveSpy).not.toHaveBeenCalled()
      expect(snapshotState()).toEqual(before)
      saveSpy.mockRestore()
    }

    // 难度损坏
    for (const diff of [NaN, -1, 1.5]) {
      monsterStore.setProgress(20, 20)
      monsterStore.difficultyValue = diff
      playerStore.player.currentHp = 0
      playerStore.player.maxHp = 100
      const before = snapshotState()
      const saveSpy = vi.spyOn(playerStore, 'saveGame')
      expect(gameStore.tryRecoverFromDeath('monsterTurn', { rng: () => 0.5, now: FIXED_NOW }).ok).toBe(false)
      expect(saveSpy).not.toHaveBeenCalled()
      expect(snapshotState()).toEqual(before)
      saveSpy.mockRestore()
    }

    // 等级损坏
    for (const level of [0, NaN, 1.5]) {
      monsterStore.setProgress(20, 20)
      monsterStore.monsterLevel = level
      playerStore.player.currentHp = 0
      playerStore.player.maxHp = 100
      const before = snapshotState()
      const saveSpy = vi.spyOn(playerStore, 'saveGame')
      expect(gameStore.tryRecoverFromDeath('monsterTurn', { rng: () => 0.5, now: FIXED_NOW }).ok).toBe(false)
      expect(saveSpy).not.toHaveBeenCalled()
      expect(snapshotState()).toEqual(before)
      saveSpy.mockRestore()
    }

    // now 损坏
    monsterStore.setProgress(20, 20)
    playerStore.player.currentHp = 0
    playerStore.player.maxHp = 100
    for (const now of [NaN, 0, -5]) {
      const before = snapshotState()
      const saveSpy = vi.spyOn(playerStore, 'saveGame')
      expect(gameStore.tryRecoverFromDeath('monsterTurn', { rng: () => 0.5, now: now as number }).ok).toBe(false)
      expect(saveSpy).not.toHaveBeenCalled()
      expect(snapshotState()).toEqual(before)
      saveSpy.mockRestore()
    }

    // rng 非函数
    monsterStore.setProgress(20, 20)
    playerStore.player.currentHp = 0
    playerStore.player.maxHp = 100
    const before = snapshotState()
    const saveSpy = vi.spyOn(playerStore, 'saveGame')
    expect(
      gameStore.tryRecoverFromDeath('monsterTurn', { rng: 42 as unknown as () => number, now: FIXED_NOW }).ok
    ).toBe(false)
    expect(saveSpy).not.toHaveBeenCalled()
    expect(snapshotState()).toEqual(before)
  })

  it('talent bonus 损坏（safeModeBonusSeconds / fatigueReductionPercent 非有限）→ fail-closed', () => {
    seedDeadState(250, 20)
    const playerStore = usePlayerStore()
    const talentStore = useTalentStore()
    const gameStore = useGameStore()
    const before = snapshotState()
    const saveSpy = vi.spyOn(playerStore, 'saveGame')
    vi.spyOn(talentStore, 'getSpecialBonuses').mockReturnValue({
      deathSetbackReduction: 0,
      safeModeBonusSeconds: NaN,
      fatigueReductionPercent: 0
    } as never)

    const res = gameStore.tryRecoverFromDeath('monsterTurn', { rng: () => 0.5, now: FIXED_NOW })

    expect(res.ok).toBe(false)
    expect(saveSpy).not.toHaveBeenCalled()
    expect(snapshotState()).toEqual(before)
  })

  it('currentMonster 缺失 → fail-closed', () => {
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    const gameStore = useGameStore()
    playerStore.player.currentHp = 0
    playerStore.player.maxHp = 100
    monsterStore.currentMonster = null
    const before = snapshotState()
    const saveSpy = vi.spyOn(playerStore, 'saveGame')

    const res = gameStore.tryRecoverFromDeath('monsterTurn', { rng: () => 0.5, now: FIXED_NOW })

    expect(res.ok).toBe(false)
    expect(saveSpy).not.toHaveBeenCalled()
    expect(snapshotState()).toEqual(before)
  })
})

describe('Phase 3.34 — 异常与保存失败完整回滚', () => {
  it('rng 抛异常：玩家仍死亡，进度/引用/encounterId 恢复，saveGame 未调用，无成功副作用', () => {
    seedDeadState(45, 20)
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    const gameStore = useGameStore()
    const before = snapshotState()
    const logBefore = gameStore.battleEvents.length
    const popupBefore = gameStore.damagePopups.length
    const saveSpy = vi.spyOn(playerStore, 'saveGame')

    const res = gameStore.tryRecoverFromDeath('monsterTurn', {
      rng: () => {
        throw new Error('rng boom')
      },
      now: FIXED_NOW
    })

    expect(res.ok).toBe(false)
    expect(saveSpy).not.toHaveBeenCalled()
    expect(playerStore.player.currentHp).toBe(0) // 仍死亡
    expect(monsterStore.currentMonster).toBe(before.currentMonster) // 原引用恢复
    expect(snapshotState()).toEqual(before)
    expect(gameStore.deathCount).toBe(0)
    expect(gameStore.safeModeUntil).toBe(0)
    expect(gameStore.battleEvents.length).toBe(logBefore) // 无成功日志
    expect(gameStore.damagePopups.length).toBe(popupBefore) // 无飘字
  })

  it('saveGame 返回 false：候选修改完整回滚、saveGame 恰一次、无成功副作用', () => {
    seedDeadState(45, 20)
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    const gameStore = useGameStore()
    const before = snapshotState()
    const logBefore = gameStore.battleEvents.length
    const popupBefore = gameStore.damagePopups.length
    const saveSpy = vi.spyOn(playerStore, 'saveGame').mockReturnValue(false)

    const res = gameStore.tryRecoverFromDeath('monsterTurn', { rng: () => 0.5, now: FIXED_NOW })

    expect(res).toEqual({ ok: false, reason: 'save failed' })
    expect(saveSpy).toHaveBeenCalledTimes(1) // 恰一次，失败后不重试
    expect(playerStore.player.currentHp).toBe(0) // 仍死亡
    expect(monsterStore.currentMonster).toBe(before.currentMonster)
    expect(snapshotState()).toEqual(before)
    expect(gameStore.deathCount).toBe(0)
    expect(gameStore.safeModeUntil).toBe(0)
    expect(gameStore.battleEvents.length).toBe(logBefore)
    expect(gameStore.damagePopups.length).toBe(popupBefore)
  })

  it('saveGame 直接抛异常：与返回 false 相同地完整回滚', () => {
    seedDeadState(45, 20)
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    const gameStore = useGameStore()
    const before = snapshotState()
    const logBefore = gameStore.battleEvents.length
    const popupBefore = gameStore.damagePopups.length
    const saveSpy = vi
      .spyOn(playerStore, 'saveGame')
      .mockImplementation(() => {
        throw new Error('disk full')
      })

    const res = gameStore.tryRecoverFromDeath('monsterTurn', { rng: () => 0.5, now: FIXED_NOW })

    expect(res.ok).toBe(false)
    expect(saveSpy).toHaveBeenCalledTimes(1)
    expect(playerStore.player.currentHp).toBe(0)
    expect(monsterStore.currentMonster).toBe(before.currentMonster)
    expect(snapshotState()).toEqual(before)
    expect(gameStore.deathCount).toBe(0)
    expect(gameStore.battleEvents.length).toBe(logBefore)
    expect(gameStore.damagePopups.length).toBe(popupBefore)
  })

  it('真实 localStorage 写盘失败：磁盘基线不变、内存完整回滚', () => {
    seedDeadState(45, 20)
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    const gameStore = useGameStore()

    playerStore.saveGame() // 先正常落盘一份基线
    const diskBefore = localStorage.getItem(SAVE_KEY)
    const before = snapshotState()

    installThrowingStorage()
    const res = gameStore.tryRecoverFromDeath('monsterTurn', { rng: () => 0.5, now: FIXED_NOW })
    vi.unstubAllGlobals()

    expect(res.ok).toBe(false)
    expect(localStorage.getItem(SAVE_KEY)).toBe(diskBefore) // 磁盘不变
    expect(playerStore.player.currentHp).toBe(0)
    expect(monsterStore.currentMonster).toBe(before.currentMonster)
    expect(snapshotState()).toEqual(before)
  })
})

describe('Phase 3.34 — 持久化一致性与自动战斗路径', () => {
  it('保存成功后磁盘中的 player HP、difficultyValue、monsterLevel 与内存一致', () => {
    seedDeadState(45, 20)
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    const gameStore = useGameStore()
    vi.spyOn(playerStore, 'saveGame')

    const res = gameStore.tryRecoverFromDeath('monsterTurn', { rng: () => 0.5, now: FIXED_NOW })
    expect(res.ok).toBe(true)

    const disk = JSON.parse(localStorage.getItem(SAVE_KEY) as string)
    expect(disk.player.currentHp).toBe(playerStore.player.currentHp) // 100
    expect(disk.monsterData.difficultyValue).toBe(monsterStore.difficultyValue) // 38
    expect(disk.monsterData.monsterLevel).toBe(monsterStore.monsterLevel) // 13
  })

  it('自动战斗调用路径在恢复失败后保持玩家死亡，并停止后续同帧行动', () => {
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    const gameStore = useGameStore()

    // 怪物伤害足以一击致死（真实 executeMonsterTurn 路径触发死亡检测）。
    playerStore.player.currentHp = 1
    playerStore.player.maxHp = 100
    monsterStore.setProgress(20, 20)
    monsterStore.currentMonster!.attack = 9999
    monsterStore.currentMonster!.accuracy = 100
    // Phase 3.35 Repair 1：注入确定性战斗 RNG——命中率在 accuracy=100 / dodge=0 下被
    // clamp 到 0.95，缺省 Math.random 有约 5% 的 miss 概率导致玩家不死、本用例随机失败。
    // 固定 rng=0.5 保证必中，使该「真实怪物行动路径」用例稳定可复现。
    gameStore.setCombatRng(() => 0.5)

    const oldMonster = monsterStore.currentMonster
    const saveSpy = vi.spyOn(playerStore, 'saveGame').mockReturnValue(false)
    const logBefore = gameStore.battleEvents.length

    gameStore.performMonsterAction() // 怪物行动 → 玩家死亡 → handlePlayerDeath → 恢复失败

    expect(playerStore.player.currentHp).toBe(0) // 仍死亡
    expect(playerStore.isDead()).toBe(true)
    expect(saveSpy).toHaveBeenCalledTimes(1)
    expect(gameStore.battleError).not.toBeNull() // 明确错误
    expect(monsterStore.currentMonster).toBe(oldMonster) // 怪物进度与引用回滚
    expect(gameStore.deathCount).toBe(0) // 死亡统计未提交
    // 无成功日志（你被击败了 / 已自动后退 不应出现）
    expect(gameStore.battleEvents.slice(0, gameStore.battleEvents.length - logBefore).some(
      e => e.message.includes('你被击败了') || e.message.includes('已自动后退')
    )).toBe(false)
  })
})

describe('Phase 3.34 — 架构护栏', () => {
  const ROOT = process.cwd()

  it('handlePlayerDeath 只委托 tryRecoverFromDeath，不再直接调用 playerStore.revive()/saveGame/goBackLevels', () => {
    const src = readFileSync(resolve(ROOT, 'src/stores/gameStore.ts'), 'utf8')
    // 提取 handlePlayerDeath 函数体（签名可能带返回类型注解）
    const m = src.match(/function handlePlayerDeath\(source: DeathRecoverySource\)\s*:\s*DeathRecoveryResult\s*\{[\s\S]*?\n  \}/)
    expect(m).toBeTruthy()
    const body = m![0]
    expect(body).toContain('tryRecoverFromDeath(source)')
    expect(body).toContain('return result')
    expect(body).not.toMatch(/playerStore\.revive\(\)/)
    expect(body).not.toMatch(/playerStore\.saveGame\(\)/)
    expect(body).not.toMatch(/goBackLevels\(/)
  })

  it('gameStore 不再存在旧的非原子 revive 旁路（Phase 3.38 已删除）', () => {
    const src = readFileSync(resolve(ROOT, 'src/stores/gameStore.ts'), 'utf8')
    // 旧 revive 使用硬编码 10 层 + playerStore.revive()（自带写盘，第二提交点）+ 无回滚，
    // Phase 3.38 已删除，统一走 tryRecoverFromDeath 权威事务。
    expect(src).not.toMatch(/function revive\(\)/)
    expect(src).not.toMatch(/\brevive\b,\s*$/)
  })
})
