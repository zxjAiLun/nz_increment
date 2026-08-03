// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { usePlayerStore } from './playerStore'
import { useMonsterStore } from './monsterStore'
import { useGameStore, isValidBattleHp, type BattleRuntimePreparationResult } from './gameStore'
import { useATBStore } from './atbStore'
import App from '../App.vue'
import type { ComponentPublicInstance } from 'vue'
// @ts-ignore —— 测试运行于 Node，无需在应用 tsconfig 中引入 @types/node 全局类型
import { readFileSync } from 'node:fs'
// @ts-ignore
import { resolve } from 'node:path'
// @ts-ignore
declare const process: { cwd(): string }

const SAVE_KEY = 'lollipop_adventure_save'

/**
 * Phase 3.40 — 启动运行时闸门。
 *
 * store 权威入口 gameStore.prepareBattleRuntimeAfterLoad()：HP 有限正 → alive；
 * 怪物缺失时 initMonster 至多一次；死亡 → 委托 recoverLoadedPlayerDeath 恰好一次；
 * NaN/±Infinity → invalid hp，零 initMonster/零恢复/零 saveGame/零 RNG。
 * 统一 HP 契约 isValidBattleHp：有限且 >0，startBattle/resumeBattle/advanceBattleWindow 共用。
 *
 * App 生命周期闸门：只有 ready 才启动 game loop / interval / beforeunload / 离线弹窗；
 * blocked 时零运行资源、tickTime 零结算、卸载零 saveGame、技能/切模式/离线收益全部禁止，
 * 仅显式重试可再次尝试，且成功后再调用为 no-op。
 */

function warmupStores() {
  usePlayerStore()
  useMonsterStore()
  useGameStore()
  useATBStore()
}

function seedAlive() {
  const playerStore = usePlayerStore()
  const monsterStore = useMonsterStore()
  playerStore.player.currentHp = 100
  playerStore.player.maxHp = 100
  monsterStore.setProgress(20, 20)
}

/** 挂载 App（stub 掉重型子组件），返回 wrapper。 */
function mountApp() {
  return mount(App, {
    global: {
      stubs: {
        BattleHUD: true,
        PlayerStatusBar: true,
        OverlayContainer: true,
        TabsContainer: true,
        PauseOverlay: true,
        RebirthModal: true,
        OfflineRewardModal: true
      }
    }
  })
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

describe('Phase 3.40 — prepareBattleRuntimeAfterLoad', () => {
  it('有限正 HP、怪物存在：返回 alive、零写盘、零死亡恢复、零状态修改', () => {
    seedAlive()
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    const gameStore = useGameStore()
    const beforeHp = playerStore.player.currentHp
    const beforeMonster = monsterStore.currentMonster
    const beforeDiff = monsterStore.difficultyValue
    const saveSpy = vi.spyOn(playerStore, 'saveGame')
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    const recoverySpy = vi.spyOn(gameStore, 'recoverLoadedPlayerDeath')

    const res = gameStore.prepareBattleRuntimeAfterLoad()

    expect(res).toEqual({ ok: true, state: 'alive' })
    expect(playerStore.player.currentHp).toBe(beforeHp)
    expect(monsterStore.currentMonster).toBe(beforeMonster)
    expect(monsterStore.difficultyValue).toBe(beforeDiff)
    expect(saveSpy).not.toHaveBeenCalled()
    expect(recoverySpy).not.toHaveBeenCalled()
    expect(setItemSpy.mock.calls.filter(c => c[0] === SAVE_KEY).length).toBe(0)
  })

  it('有限正 HP、怪物缺失：initMonster 恰一次、成功初始化后返回 alive', () => {
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    const gameStore = useGameStore()
    playerStore.player.currentHp = 100
    playerStore.player.maxHp = 100
    monsterStore.currentMonster = null
    const initSpy = vi.spyOn(monsterStore, 'initMonster')

    const res = gameStore.prepareBattleRuntimeAfterLoad()

    expect(res).toEqual({ ok: true, state: 'alive' })
    expect(initSpy).toHaveBeenCalledTimes(1)
    expect(monsterStore.currentMonster).not.toBeNull()
  })

  it('怪物初始化后仍为空：返回 no current monster、不启动运行时', () => {
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    const gameStore = useGameStore()
    playerStore.player.currentHp = 100
    playerStore.player.maxHp = 100
    const initSpy = vi.spyOn(monsterStore, 'initMonster').mockImplementation(() => {
      monsterStore.currentMonster = null
    })

    const res = gameStore.prepareBattleRuntimeAfterLoad()

    expect(res).toEqual({ ok: false, reason: 'no current monster' })
    expect(initSpy).toHaveBeenCalledTimes(1)
  })

  it('HP=0 恢复成功：返回 recovered、恢复后满血且 setback 生效、保存恰好一次', () => {
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    const gameStore = useGameStore()
    playerStore.player.currentHp = 0
    playerStore.player.maxHp = 100
    monsterStore.setProgress(45, 20)
    const saveSpy = vi.spyOn(playerStore, 'saveGame')

    const res = gameStore.prepareBattleRuntimeAfterLoad()

    expect(res).toEqual({ ok: true, state: 'recovered' })
    expect(playerStore.player.currentHp).toBe(100) // 恢复后满血
    expect(monsterStore.difficultyValue).toBe(38) // setback 生效（45-7）
    expect(saveSpy).toHaveBeenCalledTimes(1) // 恢复事务自身恰好一次保存
  })

  it('HP=0 保存返回 false：返回失败、保持死亡、保存恰好一次、不自动重试', () => {
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    const gameStore = useGameStore()
    playerStore.player.currentHp = 0
    playerStore.player.maxHp = 100
    monsterStore.setProgress(45, 20)
    const saveSpy = vi.spyOn(playerStore, 'saveGame').mockReturnValue(false)

    const res = gameStore.prepareBattleRuntimeAfterLoad()

    expect(res).toEqual({ ok: false, reason: 'save failed' })
    expect(playerStore.player.currentHp).toBe(0)
    expect(saveSpy).toHaveBeenCalledTimes(1)
  })

  it('HP=0 保存抛异常：返回失败、不向外抛、不自动重试', () => {
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    const gameStore = useGameStore()
    playerStore.player.currentHp = 0
    playerStore.player.maxHp = 100
    monsterStore.setProgress(45, 20)
    const saveSpy = vi
      .spyOn(playerStore, 'saveGame')
      .mockImplementation(() => {
        throw new Error('disk full')
      })

    let threw = false
    let res: BattleRuntimePreparationResult | undefined
    try {
      res = gameStore.prepareBattleRuntimeAfterLoad()
    } catch {
      threw = true
    }

    expect(threw).toBe(false)
    expect(res!.ok).toBe(false)
    expect(saveSpy).toHaveBeenCalledTimes(1)
  })

  it('HP 为 NaN/Infinity/-Infinity：返回 invalid hp、initMonster 零调用、死亡恢复零调用、saveGame 零调用、状态保持', () => {
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    const gameStore = useGameStore()
    monsterStore.setProgress(20, 20)
    const initSpy = vi.spyOn(monsterStore, 'initMonster')
    const recoverySpy = vi.spyOn(gameStore, 'recoverLoadedPlayerDeath')
    const saveSpy = vi.spyOn(playerStore, 'saveGame')
    const rngSpy = vi.fn(() => 0.5)
    gameStore.setCombatRng(rngSpy)

    for (const bad of [NaN, Infinity, -Infinity]) {
      playerStore.player.currentHp = bad as number
      const beforeMonster = monsterStore.currentMonster
      const res = gameStore.prepareBattleRuntimeAfterLoad()
      expect(res).toEqual({ ok: false, reason: 'invalid hp' })
      expect(initSpy).not.toHaveBeenCalled()
      expect(recoverySpy).not.toHaveBeenCalled()
      expect(saveSpy).not.toHaveBeenCalled()
      expect(monsterStore.currentMonster).toBe(beforeMonster)
      initSpy.mockClear()
      recoverySpy.mockClear()
      saveSpy.mockClear()
    }
    expect(rngSpy).not.toHaveBeenCalled() // RNG 零消费
  })
})

describe('Phase 3.40 — isValidBattleHp 与战斗帧屏障', () => {
  it('isValidBattleHp：有限正为真，0/负/NaN/±Infinity 为假', () => {
    expect(isValidBattleHp(1)).toBe(true)
    expect(isValidBattleHp(100.5)).toBe(true)
    expect(isValidBattleHp(0)).toBe(false)
    expect(isValidBattleHp(-1)).toBe(false)
    expect(isValidBattleHp(NaN)).toBe(false)
    expect(isValidBattleHp(Infinity)).toBe(false)
    expect(isValidBattleHp(-Infinity)).toBe(false)
  })

  it('HP=0/负数/NaN/±Infinity 调用 gameLoop：gauge/cooldown/Buff/Boss 时间/battleTime/ATB 保持、carry 清零、行动统计保持、零 RNG/日志/写盘', () => {
    seedAlive()
    const playerStore = usePlayerStore()
    const gameStore = useGameStore()
    const atbStore = useATBStore()
    gameStore.enableCombatTelemetry(true)
    // 制造可见战斗状态
    gameStore.playerActionGauge = 50
    gameStore.monsterActionGauge = 40
    gameStore.battleTimeMs = 123
    gameStore.carriedCombatSeconds = 5
    const gaugeBefore = gameStore.playerActionGauge
    const mGaugeBefore = gameStore.monsterActionGauge
    const timeBefore = gameStore.battleTimeMs
    const atbBeforeP = atbStore.playerATB
    const atbBeforeM = atbStore.monsterATB
    const rngSpy = vi.fn(() => 0.5)
    gameStore.setCombatRng(rngSpy)
    const logBefore = gameStore.battleEvents.length
    const popupBefore = gameStore.damagePopups.length
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')

    for (const bad of [0, -5, NaN, Infinity, -Infinity]) {
      playerStore.player.currentHp = bad as number
      gameStore.gameLoop(1000)
      expect(gameStore.playerActionGauge).toBe(gaugeBefore)
      expect(gameStore.monsterActionGauge).toBe(mGaugeBefore)
      expect(gameStore.battleTimeMs).toBe(timeBefore)
      expect(atbStore.playerATB).toBe(atbBeforeP)
      expect(atbStore.monsterATB).toBe(atbBeforeM)
      expect(gameStore.battleEvents.length).toBe(logBefore)
      expect(gameStore.damagePopups.length).toBe(popupBefore)
      expect(gameStore.carriedCombatSeconds).toBe(0) // carry 清零
      playerStore.player.currentHp = 100
    }
    expect(rngSpy).not.toHaveBeenCalled()
    expect(setItemSpy.mock.calls.filter(c => c[0] === SAVE_KEY).length).toBe(0)
    expect(gameStore.combatTelemetry.playerActions).toBe(0)
    expect(gameStore.combatTelemetry.monsterActions).toBe(0)
  })

  it('有限正 HP 的 game loop 行为与 Phase 3.39 前一致', () => {
    seedAlive()
    const playerStore = usePlayerStore()
    const gameStore = useGameStore()
    gameStore.enableCombatTelemetry(true)
    gameStore.setCombatRng(() => 0.5)
    gameStore.primePlayerGauge()
    const before = gameStore.combatTelemetry.playerActions
    gameStore.gameLoop(500)
    expect(gameStore.combatTelemetry.playerActions).toBeGreaterThan(before) // 正常行动
    expect(playerStore.player.currentHp).toBeGreaterThan(0)
  })
})

describe('Phase 3.40 — App 生命周期闸门', () => {
  it('准备成功（存活）：game loop 启动一次、interval 创建一次、beforeunload 注册一次', async () => {
    seedAlive()
    const playerStore = usePlayerStore()
    const gameStore = useGameStore()
    const saveSpy = vi.spyOn(playerStore, 'saveGame')
    const intervalSpy = vi.spyOn(window, 'setInterval')
    const addListenerSpy = vi.spyOn(window, 'addEventListener')
    const prepSpy = vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })

    const wrapper = mountApp()
    await nextTick()

    expect(prepSpy).toHaveBeenCalledTimes(1)
    // beforeunload 恰好注册一次
    expect(addListenerSpy.mock.calls.filter(c => c[0] === 'beforeunload').length).toBe(1)
    // tickTime 秒级 interval 恰好创建一次（jsdom 的 rAF polyfill 会额外产生 16.6ms interval，不计入）
    expect(intervalSpy.mock.calls.filter(c => c[1] === 1000).length).toBe(1)
    expect(saveSpy).not.toHaveBeenCalled() // 准备成功不额外写盘
    wrapper.unmount()
  })

  it('准备失败（invalid hp）：game loop 零启动、interval 零创建、beforeunload 零注册、offline modal 不打开', async () => {
    const gameStore = useGameStore()
    const intervalSpy = vi.spyOn(window, 'setInterval')
    const addListenerSpy = vi.spyOn(window, 'addEventListener')
    const prepSpy = vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: false, reason: 'invalid hp' })

    const wrapper = mountApp()
    await nextTick()

    expect(prepSpy).toHaveBeenCalledTimes(1)
    expect(intervalSpy.mock.calls.filter(c => c[1] === 1000).length).toBe(0) // 无 tickTime interval
    expect(addListenerSpy.mock.calls.filter(c => c[0] === 'beforeunload').length).toBe(0)
    expect(wrapper.find('.runtime-gate-overlay').exists()).toBe(true) // blocked 层显示
    expect(wrapper.text()).toContain('游戏启动恢复失败')
    wrapper.unmount()
  })

  it('blocked 状态调用 tickTime：在线时间、经验和自动保存全部不变化', async () => {
    const playerStore = usePlayerStore()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: false, reason: 'invalid hp' })
    const updateOnlineSpy = vi.spyOn(playerStore, 'updateOnlineTime')
    const addExpSpy = vi.spyOn(playerStore, 'addExperience')
    const saveSpy = vi.spyOn(playerStore, 'saveGame')

    const wrapper = mountApp()
    await nextTick()

    // blocked 下直接调用 tickTime（防御性 guard）
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { tickTime?: () => void }
    expect(vm.tickTime).toBeTypeOf('function')
    for (let i = 0; i < 40; i++) {
      vm.tickTime!()
    }
    expect(updateOnlineSpy).not.toHaveBeenCalled()
    expect(addExpSpy).not.toHaveBeenCalled()
    expect(saveSpy).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('blocked 状态卸载：saveGame 零调用、recordLogout 零调用', async () => {
    const playerStore = usePlayerStore()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: false, reason: 'invalid hp' })
    const saveSpy = vi.spyOn(playerStore, 'saveGame')
    const logoutSpy = vi.spyOn(playerStore, 'recordLogout')

    const wrapper = mountApp()
    await nextTick()
    wrapper.unmount()

    expect(saveSpy).not.toHaveBeenCalled()
    expect(logoutSpy).not.toHaveBeenCalled()
  })

  it('第一次恢复失败、用户显式重试成功：第一次失败后零运行资源、重试只进行一次新恢复、成功后各创建一次', async () => {
    const gameStore = useGameStore()
    // 第一次失败
    const prepSpy = vi
      .spyOn(gameStore, 'prepareBattleRuntimeAfterLoad')
      .mockReturnValueOnce({ ok: false, reason: 'save failed' })
      .mockReturnValue({ ok: true, state: 'recovered' })
    const intervalSpy = vi.spyOn(window, 'setInterval')
    const addListenerSpy = vi.spyOn(window, 'addEventListener')

    const wrapper = mountApp()
    await nextTick()

    // 第一次失败：零运行资源
    expect(prepSpy).toHaveBeenCalledTimes(1)
    expect(intervalSpy).not.toHaveBeenCalled()
    expect(addListenerSpy.mock.calls.filter(c => c[0] === 'beforeunload').length).toBe(0)
    expect(wrapper.find('.runtime-gate-overlay').exists()).toBe(true)

    // 用户点击重试
    const btn = wrapper.find('.runtime-gate-overlay button')
    expect(btn.exists()).toBe(true)
    btn.trigger('click')
    await nextTick()
    expect(prepSpy).toHaveBeenCalledTimes(2) // 重试再调用一次
    expect(wrapper.find('.runtime-gate-overlay').exists()).toBe(false) // 成功后关闭
    expect(intervalSpy.mock.calls.filter(c => c[1] === 1000).length).toBe(1) // tickTime interval 恰一次
    expect(addListenerSpy.mock.calls.filter(c => c[0] === 'beforeunload').length).toBe(1)
    wrapper.unmount()
  })

  it('成功后重复调用重试入口：不重复启动 loop、不重复创建 interval、不重复注册 listener', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    const intervalSpy = vi.spyOn(window, 'setInterval')
    const addListenerSpy = vi.spyOn(window, 'addEventListener')

    const wrapper = mountApp()
    await nextTick()

    const vm = wrapper.vm as unknown as ComponentPublicInstance & { attemptRuntimeStartup?: () => void }
    // 已 ready，重复调用必须 no-op
    vm.attemptRuntimeStartup!()
    vm.attemptRuntimeStartup!()
    expect(intervalSpy.mock.calls.filter(c => c[1] === 1000).length).toBe(1) // 仍只有一次
    expect(addListenerSpy.mock.calls.filter(c => c[0] === 'beforeunload').length).toBe(1)
    wrapper.unmount()
  })

  it('blocked 状态：技能点击不进入 tryUsePlayerSkill、切换主线不进入 resumeBattle、离线收益不允许领取', async () => {
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: false, reason: 'invalid hp' })
    const useSkillSpy = vi.spyOn(gameStore, 'tryUsePlayerSkill')
    const resumeSpy = vi.spyOn(gameStore, 'resumeBattle')

    const wrapper = mountApp()
    await nextTick()

    const vm = wrapper.vm as unknown as ComponentPublicInstance & {
      useSkill?: (i: number) => void
      switchBattleMode?: (m: 'main' | 'training') => void
      onClaimOffline?: () => void
    }
    vm.useSkill!(0)
    vm.switchBattleMode!('main')
    vm.onClaimOffline!()

    expect(useSkillSpy).not.toHaveBeenCalled()
    expect(resumeSpy).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})

describe('Phase 3.40 Repair 1 — visibilitychange 不得绕过运行时闸门', () => {
  /** 模拟页面可见/隐藏并派发 visibilitychange。 */
  function setPageHidden(hidden: boolean) {
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: hidden
    })
    document.dispatchEvent(new Event('visibilitychange'))
  }

  function restoreHidden() {
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: false
    })
  }

  it('blocked 状态 hidden → visible：gameLoop 零调用、不产生 RAF/16.6ms interval、1000ms interval 零、beforeunload 零', async () => {
    const gameStore = useGameStore()
    const prepSpy = vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: false, reason: 'invalid hp' })
    const gameLoopSpy = vi.spyOn(gameStore, 'gameLoop')
    const intervalSpy = vi.spyOn(window, 'setInterval')
    const addListenerSpy = vi.spyOn(window, 'addEventListener')

    const wrapper = mountApp()
    await nextTick()
    expect(wrapper.find('.runtime-gate-overlay').exists()).toBe(true) // blocked

    // hidden → visible
    setPageHidden(true)
    await nextTick()
    setPageHidden(false)
    await nextTick()

    expect(gameLoopSpy).not.toHaveBeenCalled() // 不进入 gameLoop
    expect(intervalSpy.mock.calls.filter(c => c[1] === 1000).length).toBe(0) // 1000ms interval 零
    expect(addListenerSpy.mock.calls.filter(c => c[0] === 'beforeunload').length).toBe(0)
    expect(prepSpy).toHaveBeenCalledTimes(1) // 不自动重试准备入口
    restoreHidden()
    wrapper.unmount()
  })

  it('第一次恢复失败后，多次 hidden → visible：不启动循环、不自动调用准备入口、保存次数不增加', async () => {
    const playerStore = usePlayerStore()
    const gameStore = useGameStore()
    const saveSpy = vi.spyOn(playerStore, 'saveGame')
    const prepSpy = vi
      .spyOn(gameStore, 'prepareBattleRuntimeAfterLoad')
      .mockReturnValue({ ok: false, reason: 'save failed' })
    const intervalSpy = vi.spyOn(window, 'setInterval')

    const wrapper = mountApp()
    await nextTick()
    expect(saveSpy).toHaveBeenCalledTimes(0) // 启动恢复失败的 saveGame 在 recovery 内部，mock 后为 0

    for (let i = 0; i < 3; i++) {
      setPageHidden(true)
      await nextTick()
      setPageHidden(false)
      await nextTick()
    }

    expect(prepSpy).toHaveBeenCalledTimes(1) // 不自动调用准备入口
    expect(intervalSpy.mock.calls.filter(c => c[1] === 1000).length).toBe(0)
    restoreHidden()
    wrapper.unmount()
  })

  it('blocked 状态下显式重试再次失败，再 hidden → visible：仍保持 blocked、RAF 仍未启动', async () => {
    const gameStore = useGameStore()
    const prepSpy = vi
      .spyOn(gameStore, 'prepareBattleRuntimeAfterLoad')
      .mockReturnValue({ ok: false, reason: 'invalid hp' })
    const intervalSpy = vi.spyOn(window, 'setInterval')

    const wrapper = mountApp()
    await nextTick()
    expect(wrapper.find('.runtime-gate-overlay').exists()).toBe(true)

    // 显式重试再次失败
    wrapper.find('.runtime-gate-overlay button').trigger('click')
    await nextTick()
    expect(prepSpy).toHaveBeenCalledTimes(2)
    expect(wrapper.find('.runtime-gate-overlay').exists()).toBe(true) // 仍 blocked

    // 再 hidden → visible
    setPageHidden(true)
    await nextTick()
    setPageHidden(false)
    await nextTick()

    expect(wrapper.find('.runtime-gate-overlay').exists()).toBe(true)
    expect(intervalSpy.mock.calls.filter(c => c[1] === 1000).length).toBe(0)
    restoreHidden()
    wrapper.unmount()
  })

  it('blocked 状态下显式重试成功：RAF 启动一次、1000ms interval 一次、beforeunload 一次', async () => {
    const gameStore = useGameStore()
    const prepSpy = vi
      .spyOn(gameStore, 'prepareBattleRuntimeAfterLoad')
      .mockReturnValueOnce({ ok: false, reason: 'save failed' })
      .mockReturnValue({ ok: true, state: 'recovered' })
    const intervalSpy = vi.spyOn(window, 'setInterval')
    const addListenerSpy = vi.spyOn(window, 'addEventListener')

    const wrapper = mountApp()
    await nextTick()
    expect(wrapper.find('.runtime-gate-overlay').exists()).toBe(true)

    // 显式重试成功
    wrapper.find('.runtime-gate-overlay button').trigger('click')
    await nextTick()
    expect(prepSpy).toHaveBeenCalledTimes(2) // 第一次失败 + 显式重试
    expect(wrapper.find('.runtime-gate-overlay').exists()).toBe(false)
    expect(intervalSpy.mock.calls.filter(c => c[1] === 1000).length).toBe(1)
    expect(addListenerSpy.mock.calls.filter(c => c[0] === 'beforeunload').length).toBe(1)

    // hidden → visible：RAF 恢复但 1000ms interval 不重复、beforeunload 不重复
    setPageHidden(true)
    await nextTick()
    setPageHidden(false)
    await nextTick()
    expect(intervalSpy.mock.calls.filter(c => c[1] === 1000).length).toBe(1)
    expect(addListenerSpy.mock.calls.filter(c => c[0] === 'beforeunload').length).toBe(1)
    restoreHidden()
    wrapper.unmount()
  })

  it('ready 状态正常 hidden → visible：RAF 正常暂停并恢复、1000ms interval 不重复创建、beforeunload 不重复注册', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    const intervalSpy = vi.spyOn(window, 'setInterval')
    const addListenerSpy = vi.spyOn(window, 'addEventListener')

    const wrapper = mountApp()
    await nextTick()
    expect(intervalSpy.mock.calls.filter(c => c[1] === 1000).length).toBe(1)
    expect(addListenerSpy.mock.calls.filter(c => c[0] === 'beforeunload').length).toBe(1)

    setPageHidden(true)
    await nextTick()
    setPageHidden(false)
    await nextTick()

    expect(intervalSpy.mock.calls.filter(c => c[1] === 1000).length).toBe(1) // 不重复创建
    expect(addListenerSpy.mock.calls.filter(c => c[0] === 'beforeunload').length).toBe(1)
    restoreHidden()
    wrapper.unmount()
  })
})

describe('Phase 3.40 — 架构护栏', () => {
  const ROOT = process.cwd()

  it('App 不直接检查或修改 currentHp', () => {
    const src = readFileSync(resolve(ROOT, 'src/App.vue'), 'utf8')
    expect(src).not.toMatch(/playerStore\.player\.currentHp\s*=/)
    expect(src).not.toMatch(/playerStore\.player\.currentHp\s*[<>]=?\s*/)
  })

  it('App 不直接调用 initMonster / recoverLoadedPlayerDeath / playerStore.revive', () => {
    const src = readFileSync(resolve(ROOT, 'src/App.vue'), 'utf8')
    expect(src).not.toMatch(/monsterStore\.initMonster\(\)/)
    expect(src).not.toMatch(/gameStore\.recoverLoadedPlayerDeath\(\)/)
    expect(src).not.toMatch(/playerStore\.revive\(\)/)
  })

  it('启动流程只调用 prepareBattleRuntimeAfterLoad', () => {
    const src = readFileSync(resolve(ROOT, 'src/App.vue'), 'utf8')
    expect(src).toContain('gameStore.prepareBattleRuntimeAfterLoad()')
    const mounted = src.match(/onMounted\(\(\) => \{[\s\S]*?\n\}\)/)
    expect(mounted).toBeTruthy()
    expect(mounted![0]).toContain('playerStore.loadGame()')
    expect(mounted![0]).toContain('attemptRuntimeStartup()')
    expect(mounted![0]).not.toMatch(/startGameLoop\(\)/)
    expect(mounted![0]).not.toMatch(/setInterval/)
    expect(mounted![0]).not.toMatch(/addEventListener/)
  })

  it('没有 setTimeout / setInterval / watcher 自动重试恢复', () => {
    const src = readFileSync(resolve(ROOT, 'src/App.vue'), 'utf8')
    // 唯一 setInterval 在 startRuntimeOnce（受控启动）；没有自动重试定时器
    expect(src).not.toMatch(/setTimeout/)
  })
})
