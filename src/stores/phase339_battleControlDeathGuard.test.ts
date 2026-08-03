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

/**
 * Phase 3.39 — 战斗启动/模式恢复对死亡/非法 HP fail-closed。
 *
 * startBattle / resumeBattle 返回 boolean：任何 mutation 前校验 Number.isFinite(hp) && hp>0，
 * 失败返回 false，不调用 playerStore.revive / saveGame / 死亡恢复事务 / RNG，不修改
 * 玩家、怪物、gauge、日志、统计、combo、ultimate、telemetry、carry、ATB。App 模式切换
 * 只在 resumeBattle() 返回 true 时把 UI 切到 main。
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

function snapshotBattleState() {
  const gameStore = useGameStore()
  const playerStore = usePlayerStore()
  const monsterStore = useMonsterStore()
  const atbStore = useATBStore()
  return {
    currentHp: playerStore.player.currentHp,
    maxHp: playerStore.player.maxHp,
    currentMonster: monsterStore.currentMonster,
    currentEncounterId: monsterStore.currentEncounterId,
    difficultyValue: monsterStore.difficultyValue,
    monsterLevel: monsterStore.monsterLevel,
    playerActionGauge: gameStore.playerActionGauge,
    monsterActionGauge: gameStore.monsterActionGauge,
    battleLog: [...gameStore.battleLog],
    damageStats: JSON.parse(JSON.stringify(gameStore.damageStats)),
    currentCombo: gameStore.currentCombo,
    ultimateGauge: gameStore.ultimateGauge,
    carriedCombatSeconds: gameStore.carriedCombatSeconds,
    playerATB: atbStore.playerATB,
    monsterATB: atbStore.monsterATB,
    combatTelemetry: JSON.parse(JSON.stringify(gameStore.combatTelemetry ?? {}))
  }
}

function seedAliveBattle() {
  const playerStore = usePlayerStore()
  const monsterStore = useMonsterStore()
  playerStore.player.currentHp = 100
  playerStore.player.maxHp = 100
  monsterStore.setProgress(20, 20)
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

describe('Phase 3.39 — resumeBattle', () => {
  it('存活成功：返回 true、gauge/日志/统计/ATB 既有语义、HP 不变、零写盘', () => {
    seedAliveBattle()
    const playerStore = usePlayerStore()
    const gameStore = useGameStore()
    const atbStore = useATBStore()
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    // 制造脏状态
    gameStore.addBattleLog('old')
    gameStore.trackPlayerDamage(50, 'normal')
    gameStore.playerActionGauge = 30
    gameStore.monsterActionGauge = 70
    gameStore.carriedCombatSeconds = 2.5
    gameStore.currentCombo = 5

    const ok = gameStore.resumeBattle()

    expect(ok).toBe(true)
    expect(playerStore.player.currentHp).toBe(100) // HP 不变
    expect(gameStore.playerActionGauge).toBe(100)
    expect(gameStore.monsterActionGauge).toBe(0)
    expect(gameStore.battleLog).toEqual([])
    expect(gameStore.damageStats.totalDamage).toBe(0)
    expect(gameStore.carriedCombatSeconds).toBe(0)
    // resumeBattle 既有语义：不重置 combo / ultimateGauge（保持原值）
    expect(gameStore.currentCombo).toBe(5)
    expect(gameStore.ultimateGauge).toBe(0)
    expect(atbStore.playerATB).toBe(100)
    expect(atbStore.monsterATB).toBe(0)
    expect(setItemSpy.mock.calls.filter(c => c[0] === SAVE_KEY).length).toBe(0)
  })

  it('HP=0：返回 false、全部战斗状态逐项保持、HP 保持 0、SAVE_KEY 零写入', () => {
    seedAliveBattle()
    const playerStore = usePlayerStore()
    const gameStore = useGameStore()
    playerStore.player.currentHp = 0
    gameStore.addBattleLog('keep-me')
    gameStore.trackPlayerDamage(50, 'normal')
    gameStore.playerActionGauge = 30
    gameStore.monsterActionGauge = 70
    gameStore.carriedCombatSeconds = 2.5
    gameStore.currentCombo = 5
    gameStore.ultimateGauge = 7
    const before = snapshotBattleState()
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')

    const ok = gameStore.resumeBattle()

    expect(ok).toBe(false)
    expect(playerStore.player.currentHp).toBe(0)
    expect(snapshotBattleState()).toEqual(before) // 全部保持
    expect(setItemSpy.mock.calls.filter(c => c[0] === SAVE_KEY).length).toBe(0)
  })

  it('负 HP：同样 fail-closed', () => {
    seedAliveBattle()
    const playerStore = usePlayerStore()
    const gameStore = useGameStore()
    playerStore.player.currentHp = -5
    const before = snapshotBattleState()

    expect(gameStore.resumeBattle()).toBe(false)
    expect(snapshotBattleState()).toEqual(before)
    expect(playerStore.player.currentHp).toBe(-5)
  })

  it('NaN/Infinity/-Infinity HP：全部返回 false、零修改零写盘', () => {
    seedAliveBattle()
    const playerStore = usePlayerStore()
    const gameStore = useGameStore()
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    for (const bad of [NaN, Infinity, -Infinity]) {
      playerStore.player.currentHp = bad as number
      const before = snapshotBattleState()
      expect(gameStore.resumeBattle()).toBe(false)
      expect(snapshotBattleState()).toEqual(before)
      setItemSpy.mockClear()
    }
    expect(setItemSpy.mock.calls.filter(c => c[0] === SAVE_KEY).length).toBe(0)
  })
})

describe('Phase 3.39 — startBattle', () => {
  it('HP=0：返回 false、initMonster 零调用、currentMonster/encounterId/进度不变、战斗临时状态不变', () => {
    seedAliveBattle()
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    const gameStore = useGameStore()
    playerStore.player.currentHp = 0
    const oldMonster = monsterStore.currentMonster
    const encBefore = monsterStore.currentEncounterId
    const before = snapshotBattleState()
    const initSpy = vi.spyOn(monsterStore, 'initMonster')

    const ok = gameStore.startBattle()

    expect(ok).toBe(false)
    expect(initSpy).not.toHaveBeenCalled() // initMonster 零调用
    expect(monsterStore.currentMonster).toBe(oldMonster)
    expect(monsterStore.currentEncounterId).toBe(encBefore)
    expect(snapshotBattleState()).toEqual(before)
  })

  it('非有限 HP：返回 false、initMonster 零调用', () => {
    seedAliveBattle()
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    const gameStore = useGameStore()
    const initSpy = vi.spyOn(monsterStore, 'initMonster')
    for (const bad of [NaN, Infinity, -Infinity]) {
      playerStore.player.currentHp = bad as number
      expect(gameStore.startBattle()).toBe(false)
      expect(initSpy).not.toHaveBeenCalled()
      initSpy.mockClear()
    }
  })

  it('存活成功：返回 true、initMonster 恰一次、保持先手 gauge 规划、HP 不变、零写盘', () => {
    seedAliveBattle()
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    const gameStore = useGameStore()
    const initSpy = vi.spyOn(monsterStore, 'initMonster')
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    playerStore.player.stats.speed = 100
    playerStore.player.currentHp = 100

    const ok = gameStore.startBattle()

    expect(ok).toBe(true)
    expect(initSpy).toHaveBeenCalledTimes(1)
    expect(playerStore.player.currentHp).toBe(100) // HP 不变
    // 速度优势先手偏移（既有公式）
    expect(gameStore.playerActionGauge).toBeGreaterThan(0)
    expect(gameStore.monsterActionGauge).toBe(0)
    expect(setItemSpy.mock.calls.filter(c => c[0] === SAVE_KEY).length).toBe(0)
  })
})

describe('Phase 3.39 — 启动恢复失败后模式切换不得复活/重试', () => {
  it('启动恢复 saveGame=false 后调用 resumeBattle：返回 false、saveGame 总次数仍 1、保持死亡、无后退满血日志', () => {
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    const gameStore = useGameStore()
    playerStore.player.currentHp = 0
    playerStore.player.maxHp = 100
    monsterStore.setProgress(45, 20)
    const saveSpy = vi.spyOn(playerStore, 'saveGame').mockReturnValue(false)

    const rec = gameStore.recoverLoadedPlayerDeath()
    expect(rec).toEqual({ ok: false, reason: 'save failed' })
    expect(saveSpy).toHaveBeenCalledTimes(1)

    const ok = gameStore.resumeBattle()

    expect(ok).toBe(false)
    expect(saveSpy).toHaveBeenCalledTimes(1) // 总次数仍为 1
    expect(playerStore.player.currentHp).toBe(0) // 保持死亡
    expect(monsterStore.difficultyValue).toBe(45) // 无后退
    expect(gameStore.battleEvents.some(e => e.message.includes('已自动后退'))).toBe(false)
  })

  it('第一次 saveGame=false、后续已准备 true：resumeBattle/startBattle 均不得消费第二个 true', () => {
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    const gameStore = useGameStore()
    playerStore.player.currentHp = 0
    playerStore.player.maxHp = 100
    monsterStore.setProgress(45, 20)
    const saveSpy = vi
      .spyOn(playerStore, 'saveGame')
      .mockReturnValueOnce(false)
      .mockReturnValue(true)

    gameStore.recoverLoadedPlayerDeath() // 失败，消费第一个 false
    expect(saveSpy).toHaveBeenCalledTimes(1)

    expect(gameStore.resumeBattle()).toBe(false) // 不消费第二个 true
    expect(gameStore.startBattle()).toBe(false) // 不消费第二个 true
    expect(saveSpy).toHaveBeenCalledTimes(1) // 仍 1 次
    expect(playerStore.player.currentHp).toBe(0)
  })

  it('死亡状态下 resumeBattle：battle log/damage stats/telemetry/gauge/ATB/carry 全部保持，不能先重置再失败', () => {
    seedAliveBattle()
    const playerStore = usePlayerStore()
    const gameStore = useGameStore()
    playerStore.player.currentHp = 0
    gameStore.addBattleLog('must-keep')
    gameStore.trackPlayerDamage(120, 'normal')
    gameStore.playerActionGauge = 40
    gameStore.monsterActionGauge = 60
    gameStore.carriedCombatSeconds = 9.9
    gameStore.currentCombo = 8
    gameStore.ultimateGauge = 3
    gameStore.resetCombatTelemetry()
    gameStore.combatTelemetry!.playerActions = 4
    const before = snapshotBattleState()

    const ok = gameStore.resumeBattle()

    expect(ok).toBe(false)
    const after = snapshotBattleState()
    expect(after).toEqual(before) // 逐项保持
  })
})

describe('Phase 3.39 — 架构护栏', () => {
  const ROOT = process.cwd()

  it('App 模式切换：training 直接设置、main 先 resumeBattle、仅返回 true 才设置 main、无 battleMode=mode 后恢复写法', () => {
    const src = readFileSync(resolve(ROOT, 'src/App.vue'), 'utf8')
    const m = src.match(/function switchBattleMode\(mode: 'main' \| 'training'\)\s*\{[\s\S]*?\n\}/)
    expect(m).toBeTruthy()
    const body = m![0]
    // training 分支直接设置
    expect(body).toMatch(/mode === 'training'/)
    expect(body).toMatch(/battleMode\.value = 'training'/)
    // main 分支先 resumeBattle，仅 true 才设 main
    expect(body).toContain('gameStore.resumeBattle()')
    expect(body).toMatch(/if \(gameStore\.resumeBattle\(\)\)\s*\{[\s\S]*?battleMode\.value = 'main'/)
    // 不存在先 battleMode=mode 再恢复的写法
    expect(body).not.toMatch(/battleMode\.value = mode/)
    expect(body).not.toMatch(/playerStore\.revive\(\)/)
    expect(body).not.toMatch(/saveGame\(\)/)
    expect(body).not.toMatch(/tryRecoverFromDeath|handlePlayerDeath|recoverLoadedPlayerDeath/)
  })

  it('gameStore：startBattle/resumeBattle 返回 boolean、HP 校验在首次 mutation 之前、startBattle 校验在 initMonster 之前、无 playerStore.revive() 调用', () => {
    const src = readFileSync(resolve(ROOT, 'src/stores/gameStore.ts'), 'utf8')
    // 生产战斗控制不再调用 playerStore.revive()（注释中的历史说明除外）
    const codeWithoutComments = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '')
    expect(codeWithoutComments).not.toMatch(/playerStore\.revive\(\)/)

    const start = src.match(/function startBattle\(\)\s*:\s*boolean\s*\{[\s\S]*?\n  \}/)
    expect(start).toBeTruthy()
    const startBody = start![0]
    const hpIdx = startBody.indexOf('isValidBattleHp')
    const initIdx = startBody.indexOf('monsterStore.initMonster()')
    expect(hpIdx).toBeGreaterThan(0)
    expect(initIdx).toBeGreaterThan(hpIdx) // 校验先于 initMonster
    expect(startBody).toContain('return false')
    expect(startBody).toContain('return true')
    expect(startBody).not.toMatch(/revive\(\)/)

    const resume = src.match(/function resumeBattle\(\)\s*:\s*boolean\s*\{[\s\S]*?\n  \}/)
    expect(resume).toBeTruthy()
    const resumeBody = resume![0]
    // 校验位于任何 mutation 之前：resumeBattle 首个语句即 HP 校验
    const gaugeIdx = resumeBody.indexOf('playerActionGauge.value = GAUGE_MAX')
    const hpIdx2 = resumeBody.indexOf('isValidBattleHp')
    expect(hpIdx2).toBeGreaterThan(0)
    expect(gaugeIdx).toBeGreaterThan(hpIdx2) // 校验先于 gauge mutation
    expect(resumeBody).toContain('return false')
    expect(resumeBody).toContain('return true')
    expect(resumeBody).not.toMatch(/revive\(\)/)
  })
})
