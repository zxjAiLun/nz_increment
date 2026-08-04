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
const FIXED_NOW = 2_000_000

/**
 * Phase 3.38 — 启动死亡存档统一走权威恢复事务。
 *
 * App.vue 不再直接 currentHp = maxHp 免费复活，而是先 loadGame → initMonster →
 * gameStore.recoverLoadedPlayerDeath()（内部委托 handlePlayerDeath('startup') →
 * tryRecoverFromDeath 权威事务）。startup 与 playerTurn 不显示治疗飘字，
 * monsterTurn 保留既有 heal popup。旧 gameStore.revive() 旁路已删除。
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

/** 设置真实可变化的死亡初始状态。 */
function seedDeadState(difficulty = 45, monsterLevel = 20) {
  const playerStore = usePlayerStore()
  const monsterStore = useMonsterStore()
  playerStore.player.currentHp = 0
  playerStore.player.maxHp = 100
  monsterStore.setProgress(difficulty, monsterLevel)
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

describe('Phase 3.38 — recoverLoadedPlayerDeath 存活/死亡判定', () => {
  it('玩家存活时返回 null，零修改、零写盘、不加死亡统计/日志/safe mode', () => {
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    const gameStore = useGameStore()
    playerStore.player.currentHp = 50
    playerStore.player.maxHp = 100
    monsterStore.setProgress(20, 20)
    const before = snapshotState()
    const deathCountBefore = gameStore.deathCount
    const logBefore = gameStore.battleEvents.length
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')

    const res = gameStore.recoverLoadedPlayerDeath()

    expect(res).toBeNull()
    expect(snapshotState()).toEqual(before)
    expect(gameStore.deathCount).toBe(deathCountBefore)
    expect(gameStore.battleEvents.length).toBe(logBefore)
    expect(gameStore.safeModeUntil).toBe(0)
    expect(setItemSpy.mock.calls.filter(c => c[0] === SAVE_KEY).length).toBe(0)
  })

  it('玩家 HP 为 NaN、Infinity、正数时均不写盘、不恢复', () => {
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    const gameStore = useGameStore()
    monsterStore.setProgress(20, 20)
    for (const hp of [NaN, Infinity, 10, 1]) {
      playerStore.player.currentHp = hp as number
      playerStore.player.maxHp = 100
      const before = snapshotState()
      const deathCountBefore = gameStore.deathCount
      const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
      const res = gameStore.recoverLoadedPlayerDeath()
      expect(res).toBeNull()
      expect(gameStore.deathCount).toBe(deathCountBefore)
      expect(snapshotState()).toEqual(before)
      expect(setItemSpy.mock.calls.filter(c => c[0] === SAVE_KEY).length).toBe(0)
      setItemSpy.mockRestore()
    }
  })
})

describe('Phase 3.38 — 启动死亡恢复成功事务', () => {
  it('死亡存档启动恢复成功：setback 与 Phase 3.34 一致、难度/等级后退、换怪、满血、saveGame 恰一次、磁盘含结果', () => {
    seedDeadState(45, 20) // difficulty 45 → setback 7
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    const gameStore = useGameStore()
    const oldMonster = monsterStore.currentMonster
    const encBefore = monsterStore.currentEncounterId
    const saveSpy = vi.spyOn(playerStore, 'saveGame')

    const res = gameStore.recoverLoadedPlayerDeath()

    expect(res).toMatchObject({ ok: true, setback: 7, safeModeMs: DEATH_SAFE_MODE_MS })
    expect(monsterStore.difficultyValue).toBe(38) // 45 - 7
    expect(monsterStore.monsterLevel).toBe(13) // 20 - 7
    expect(monsterStore.currentMonster).not.toBe(oldMonster) // 换怪
    expect(monsterStore.currentEncounterId).toBe(encBefore + 1)
    expect(playerStore.player.currentHp).toBe(100) // 满血 = maxHp
    expect(saveSpy).toHaveBeenCalledTimes(1)
    // 磁盘同时包含 HP 与怪物进度结果
    const disk = JSON.parse(localStorage.getItem(SAVE_KEY) as string)
    expect(disk.player.currentHp).toBe(100)
    expect(disk.monsterData.difficultyValue).toBe(38)
    expect(disk.monsterData.monsterLevel).toBe(13)
  })

  it('新 Pinia + loadGame 后恢复启动事务提交的结果', () => {
    seedDeadState(45, 20)
    const playerStore = usePlayerStore()
    const gameStore = useGameStore()
    vi.spyOn(playerStore, 'saveGame')
    expect(gameStore.recoverLoadedPlayerDeath()!.ok).toBe(true)

    setActivePinia(createPinia())
    warmupStores()
    const p2 = usePlayerStore()
    const m2 = useMonsterStore()
    p2.loadGame()

    expect(p2.player.currentHp).toBe(100)
    expect(m2.difficultyValue).toBe(38)
    expect(m2.monsterLevel).toBe(13)
  })

  it('启动恢复成功：deathCount+1、lastDeathAt/safeModeUntil/lastDeathReason 正确、行动槽/regenCarry 既有语义、两条死亡日志', () => {
    seedDeadState(45, 20)
    const playerStore = usePlayerStore()
    const gameStore = useGameStore()
    const atbStore = useATBStore()
    vi.spyOn(playerStore, 'saveGame')

    const res = gameStore.recoverLoadedPlayerDeath()

    expect(res!.ok).toBe(true)
    expect(gameStore.deathCount).toBe(1)
    expect(gameStore.lastDeathReason).toBeTruthy()
    expect(gameStore.safeModeUntil).toBeGreaterThan(Date.now())
    const logs = gameStore.battleEvents.slice(0, 2)
    expect(logs.some(e => e.message.includes('你被击败了'))).toBe(true)
    expect(logs.some(e => e.message.includes('已自动后退'))).toBe(true)
    expect(gameStore.playerActionGauge).toBe(100)
    expect(gameStore.monsterActionGauge).toBe(0)
    expect(atbStore.playerATB).toBe(100)
    expect(atbStore.monsterATB).toBe(0)
    expect(res).toMatchObject({ safeModeMs: DEATH_SAFE_MODE_MS })
  })

  it('startup 来源不创建 heal 治疗飘字', () => {
    seedDeadState(45, 20)
    const playerStore = usePlayerStore()
    const gameStore = useGameStore()
    vi.spyOn(playerStore, 'saveGame')

    const res = gameStore.recoverLoadedPlayerDeath()

    expect(res!.ok).toBe(true)
    expect(gameStore.damagePopups.some(p => p.type === 'heal')).toBe(false)
  })

  it('monsterTurn 来源原有 heal popup 继续存在（防回归）', () => {
    seedDeadState(45, 20)
    const playerStore = usePlayerStore()
    const gameStore = useGameStore()
    vi.spyOn(playerStore, 'saveGame')

    const res = gameStore.tryRecoverFromDeath('monsterTurn', { rng: () => 0.5, now: FIXED_NOW })

    expect(res.ok).toBe(true)
    expect(gameStore.damagePopups.some(p => p.type === 'heal')).toBe(true)
  })
})

describe('Phase 3.38 — 启动恢复失败完整回滚', () => {
  it('currentMonster 缺失：返回失败、玩家保持死亡、不写盘、battleError 被设置', () => {
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    const gameStore = useGameStore()
    playerStore.player.currentHp = 0
    playerStore.player.maxHp = 100
    monsterStore.currentMonster = null
    const before = snapshotState()
    const deathCountBefore = gameStore.deathCount
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')

    const res = gameStore.recoverLoadedPlayerDeath()

    expect(res).toMatchObject({ ok: false, reason: 'no current monster' })
    expect(playerStore.player.currentHp).toBe(0) // 保持死亡
    expect(snapshotState()).toEqual(before)
    expect(gameStore.deathCount).toBe(deathCountBefore)
    // Repair 1：startup 失败通过返回结果交给 App blocked 处理，不写入运行期 battleError。
    expect(gameStore.battleError).toBeNull()
    expect(setItemSpy.mock.calls.filter(c => c[0] === SAVE_KEY).length).toBe(0)
  })

  it('保存返回 false：HP/难度/monsterLevel/currentMonster 原引用/encounterId 完整回滚、保持死亡、无成功副作用、不重试', () => {
    seedDeadState(45, 20)
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    const gameStore = useGameStore()
    const before = snapshotState()
    const deathCountBefore = gameStore.deathCount
    const logBefore = gameStore.battleEvents.length
    const popupBefore = gameStore.damagePopups.length
    const saveSpy = vi.spyOn(playerStore, 'saveGame').mockReturnValue(false)

    const res = gameStore.recoverLoadedPlayerDeath()

    expect(res).toEqual({ ok: false, reason: 'save failed' })
    expect(saveSpy).toHaveBeenCalledTimes(1) // 恰一次，不重试
    expect(playerStore.player.currentHp).toBe(0) // 保持死亡
    expect(monsterStore.currentMonster).toBe(before.currentMonster)
    expect(snapshotState()).toEqual(before)
    expect(gameStore.deathCount).toBe(deathCountBefore)
    expect(gameStore.safeModeUntil).toBe(0)
    expect(gameStore.battleEvents.length).toBe(logBefore)
    expect(gameStore.damagePopups.length).toBe(popupBefore)
  })

  it('保存抛异常：同样完整回滚且不外抛', () => {
    seedDeadState(45, 20)
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    const gameStore = useGameStore()
    const before = snapshotState()
    const deathCountBefore = gameStore.deathCount
    const logBefore = gameStore.battleEvents.length
    const popupBefore = gameStore.damagePopups.length
    const saveSpy = vi
      .spyOn(playerStore, 'saveGame')
      .mockImplementation(() => {
        throw new Error('disk full')
      })

    let threw = false
    let res: ReturnType<typeof gameStore.recoverLoadedPlayerDeath> | undefined
    try {
      res = gameStore.recoverLoadedPlayerDeath()
    } catch {
      threw = true
    }

    expect(threw).toBe(false)
    expect(res!.ok).toBe(false)
    expect(saveSpy).toHaveBeenCalledTimes(1)
    expect(playerStore.player.currentHp).toBe(0)
    expect(monsterStore.currentMonster).toBe(before.currentMonster)
    expect(snapshotState()).toEqual(before)
    expect(gameStore.deathCount).toBe(deathCountBefore)
    expect(gameStore.battleEvents.length).toBe(logBefore)
    expect(gameStore.damagePopups.length).toBe(popupBefore)
  })

  it('goBackLevels 抛异常：完整回滚、零写盘、不外抛', () => {
    seedDeadState(45, 20)
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    const gameStore = useGameStore()
    const before = snapshotState()
    const saveSpy = vi.spyOn(playerStore, 'saveGame')
    const goSpy = vi.spyOn(monsterStore, 'goBackLevels').mockImplementation(() => {
      throw new Error('monster setback failed')
    })

    let threw = false
    let res: ReturnType<typeof gameStore.recoverLoadedPlayerDeath> | undefined
    try {
      res = gameStore.recoverLoadedPlayerDeath()
    } catch {
      threw = true
    }

    expect(threw).toBe(false)
    expect(res!.ok).toBe(false)
    expect(goSpy).toHaveBeenCalled()
    expect(saveSpy).not.toHaveBeenCalled()
    expect(playerStore.player.currentHp).toBe(0)
    expect(monsterStore.currentMonster).toBe(before.currentMonster)
    expect(snapshotState()).toEqual(before)
  })

  it('RNG 抛异常：完整回滚、零写盘、不外抛', () => {
    seedDeadState(45, 20)
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    const gameStore = useGameStore()
    const before = snapshotState()
    const saveSpy = vi.spyOn(playerStore, 'saveGame')

    let threw = false
    let res: ReturnType<typeof gameStore.tryRecoverFromDeath> | undefined
    try {
      res = gameStore.tryRecoverFromDeath('startup', {
        rng: () => {
          throw new Error('rng boom')
        },
        now: FIXED_NOW
      })
    } catch {
      threw = true
    }

    expect(threw).toBe(false)
    expect(res!.ok).toBe(false)
    expect(saveSpy).not.toHaveBeenCalled()
    expect(playerStore.player.currentHp).toBe(0)
    expect(monsterStore.currentMonster).toBe(before.currentMonster)
    expect(snapshotState()).toEqual(before)
  })
})

describe('Phase 3.38 Repair 1 — 死亡前置屏障：失败后禁止跨帧隐式重试', () => {
  it('启动恢复保存失败后，重复 gameLoop 不得重试：saveGame 仍 1 次、保持死亡、无行动/无新 RNG', () => {
    seedDeadState(45, 20)
    const playerStore = usePlayerStore()
    const gameStore = useGameStore()
    gameStore.enableCombatTelemetry(true)
    const before = snapshotState()
    const deathCountBefore = gameStore.deathCount
    const logBefore = gameStore.battleEvents.length
    const popupBefore = gameStore.damagePopups.length
    const saveSpy = vi.spyOn(playerStore, 'saveGame').mockReturnValue(false)

    // 启动恢复失败：saveGame 恰 1 次
    const res = gameStore.recoverLoadedPlayerDeath()
    expect(res).toEqual({ ok: false, reason: 'save failed' })
    expect(saveSpy).toHaveBeenCalledTimes(1)
    expect(playerStore.player.currentHp).toBe(0)

    // 让双方行动槽立即可行动（死亡屏障应在本帧任何行动前拦截）
    gameStore.primePlayerGauge()
    gameStore.playerActionGauge = 100
    gameStore.monsterActionGauge = 100

    const beforeState = snapshotState()
    const pBefore = gameStore.combatTelemetry.playerActions
    const mBefore = gameStore.combatTelemetry.monsterActions
    const rng = vi.fn(() => 0.5)
    gameStore.setCombatRng(rng)

    // 连续多帧 gameLoop
    for (let i = 0; i < 10; i++) {
      gameStore.gameLoop(1000)
    }

    expect(saveSpy).toHaveBeenCalledTimes(1) // 总次数仍为 1，无重试
    expect(playerStore.player.currentHp).toBe(0) // 保持死亡
    expect(playerStore.isDead()).toBe(true)
    expect(snapshotState()).toEqual(beforeState) // difficulty/monsterLevel/currentMonster/encounterId 不变
    expect(gameStore.deathCount).toBe(deathCountBefore)
    expect(gameStore.safeModeUntil).toBe(0)
    expect(gameStore.battleEvents.length).toBe(logBefore)
    expect(gameStore.damagePopups.length).toBe(popupBefore)
    expect(gameStore.combatTelemetry.playerActions).toBe(pBefore) // 无玩家行动
    expect(gameStore.combatTelemetry.monsterActions).toBe(mBefore) // 无怪物行动
    expect(rng).not.toHaveBeenCalled() // 不消费新 RNG
    expect(snapshotState()).toEqual(before) // 玩家不能以 0 HP 攻击
  })

  it('保存第一次失败、后续本可成功时也不得自动恢复（第二个 true 永不消费）', () => {
    seedDeadState(45, 20)
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    const gameStore = useGameStore()
    const saveSpy = vi
      .spyOn(playerStore, 'saveGame')
      .mockReturnValueOnce(false) // 启动恢复第一次失败
      .mockReturnValue(true) // 若被跨帧重试，本应成功

    const res = gameStore.recoverLoadedPlayerDeath()
    expect(res).toEqual({ ok: false, reason: 'save failed' })
    expect(saveSpy).toHaveBeenCalledTimes(1)
    expect(playerStore.player.currentHp).toBe(0)

    // 连续运行 gameLoop：死亡屏障必须阻止任何隐式重试消费第二个 true
    for (let i = 0; i < 10; i++) {
      gameStore.gameLoop(1000)
    }

    expect(saveSpy).toHaveBeenCalledTimes(1) // 仍只有启动时那一次
    expect(playerStore.player.currentHp).toBe(0) // 保持死亡
    expect(gameStore.deathCount).toBe(0)
    expect(gameStore.safeModeUntil).toBe(0)
    // 无后退、无满血、无成功日志
    expect(monsterStore.difficultyValue).toBe(45)
    expect(monsterStore.monsterLevel).toBe(20)
    expect(gameStore.battleEvents.some(e => e.message.includes('已自动后退'))).toBe(false)
  })

  it('carriedCombatSeconds 清零：死亡期间遗留时间不会在后续成功恢复后被突然消费', () => {
    seedDeadState(45, 20)
    const playerStore = usePlayerStore()
    const gameStore = useGameStore()
    const saveSpy = vi.spyOn(playerStore, 'saveGame').mockReturnValue(false)

    // 制造非零 carry
    gameStore.carriedCombatSeconds = 999
    gameStore.recoverLoadedPlayerDeath() // 失败，玩家保持死亡（startup 不写运行期 battleError）

    // 帧内 HP 前置屏障：玩家死亡 → 清零 carry 并 fail-stop（startup 失败不锁 battleError，
    // 因此本帧仍会进入 HP 检查并清除 carry，符合 Phase 3.38 的 carry 清零语义）。
    const ok = gameStore.gameLoop(0)
    expect(ok).toBe(false)
    expect(gameStore.carriedCombatSeconds).toBe(0) // carry 清零
    expect(gameStore.battleError).not.toBeNull() // 本帧运行期 HP 非法锁定
    expect(saveSpy).toHaveBeenCalledTimes(1) // 恢复事务自身一次，帧内零新增保存

    // 手动模拟「故障消除后重新加载」：清空 battleError 并恢复存活，
    // 之后运行小帧不得突然消费死亡期间遗留的大段时间或连续行动。
    gameStore.battleError = null
    gameStore.setCombatRng(() => 0.5)
    playerStore.player.currentHp = 100
    gameStore.playerActionGauge = 100
    const pBefore = gameStore.combatTelemetry?.playerActions ?? 0
    const mBefore = gameStore.combatTelemetry?.monsterActions ?? 0
    gameStore.gameLoop(16)
    // 一帧 16ms 不应触发多段行动（carry 已清零，不会爆量）
    expect(gameStore.carriedCombatSeconds).toBeLessThan(1)
    expect(gameStore.combatTelemetry?.playerActions ?? 0).toBeLessThanOrEqual(pBefore + 2)
    expect(gameStore.combatTelemetry?.monsterActions ?? 0).toBeLessThanOrEqual(mBefore + 2)
  })

  it('存活玩家调度不回归：HP>0 且行动槽就绪时行动照常发生，不被死亡屏障误拦截', () => {
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    const gameStore = useGameStore()
    gameStore.enableCombatTelemetry(true)
    playerStore.player.currentHp = 100
    playerStore.player.maxHp = 100
    monsterStore.setProgress(20, 20)
    gameStore.setCombatRng(() => 0.5)

    // 玩家就绪、怪物低攻，运行数帧应产生玩家行动
    gameStore.primePlayerGauge()
    const pBefore = gameStore.combatTelemetry.playerActions
    gameStore.gameLoop(500)

    expect(gameStore.combatTelemetry.playerActions).toBeGreaterThan(pBefore) // 存活玩家正常行动
    expect(playerStore.player.currentHp).toBeGreaterThan(0) // 未被误判死亡
    expect(gameStore.carriedCombatSeconds).toBeLessThan(5)
  })
})

describe('Phase 3.38 — 架构护栏', () => {
  const ROOT = process.cwd()

  it('App.vue 启动流程：loadGame → attemptRuntimeStartup（受控闸门），不再直接 initMonster/recoverLoadedPlayerDeath/startGameLoop', () => {
    const src = readFileSync(resolve(ROOT, 'src/App.vue'), 'utf8')
    // onMounted 只调用 exposeDebugVm + initializeAppRuntime；协调函数内顺序：loadGame → attemptRuntimeStartup
    const mounted = src.match(/onMounted\(\(\) => \{[\s\S]*?\n\}\)/)
    expect(mounted).toBeTruthy()
    expect(mounted![0]).toContain('exposeDebugVm()')
    expect(mounted![0]).toContain('initializeAppRuntime()')
    expect(mounted![0]).not.toMatch(/startGameLoop\(\)/)
    expect(mounted![0]).not.toMatch(/setInterval/)
    expect(mounted![0]).not.toMatch(/addEventListener/)

    const init = src.match(/function initializeAppRuntime\(\)\s*\{[\s\S]*?\n\}/)
    expect(init).toBeTruthy()
    const loadIdx = init![0].indexOf('playerStore.loadGame()')
    const startupIdx = init![0].indexOf('attemptRuntimeStartup()')
    expect(loadIdx).toBeGreaterThanOrEqual(0)
    expect(startupIdx).toBeGreaterThan(loadIdx)
    // Phase 3.40：App 不再直接调用这些权威入口，统一走 prepareBattleRuntimeAfterLoad
    expect(src).not.toMatch(/monsterStore\.initMonster\(\)/)
    expect(src).not.toMatch(/gameStore\.recoverLoadedPlayerDeath\(\)/)
    expect(src).not.toMatch(/playerStore\.revive\(\)/)
    expect(src).not.toMatch(/currentHp\s*=\s*playerStore\.player\.maxHp/)
  })

  it('gameStore：不存在旧 function revive()、return 不暴露 revive、recoverLoadedPlayerDeath 只委托 handlePlayerDeath(startup)', () => {
    const src = readFileSync(resolve(ROOT, 'src/stores/gameStore.ts'), 'utf8')
    expect(src).not.toMatch(/function revive\(\)/)
    // return 块不暴露 revive 导出
    expect(src).not.toMatch(/^\s*revive,\s*$/m)

    const m = src.match(/function recoverLoadedPlayerDeath\(\)\s*:\s*DeathRecoveryResult \| null\s*\{[\s\S]*?\n  \}/)
    expect(m).toBeTruthy()
    const body = m![0]
    expect(body).toContain("handlePlayerDeath('startup')")
    // 不直接赋值 currentHp（只读 const currentHp 声明，无 currentHp = 赋值）
    expect(body).not.toMatch(/currentHp\s*=\s*playerStore\.player\.maxHp/)
    expect(body).not.toMatch(/^\s*(?!const )\w*\.?currentHp\s*=/m)
    expect(body).not.toMatch(/saveGame\(\)/)
    expect(body).not.toMatch(/goBackLevels\(/)
  })
})
