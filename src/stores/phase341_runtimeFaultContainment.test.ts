// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { usePlayerStore } from './playerStore'
import { useMonsterStore } from './monsterStore'
import { useGameStore } from './gameStore'
import { useATBStore } from './atbStore'
import App from '../App.vue'
import type { ComponentPublicInstance } from 'vue'
// @ts-ignore
import { readFileSync } from 'node:fs'
// @ts-ignore
import { resolve } from 'node:path'
// @ts-ignore
declare const process: { cwd(): string }

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

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  warmupStores()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  restoreHidden()
})

describe('Phase 3.41 — gameStore.gameLoop fail-stop', () => {
  it('正常存活帧返回 true', () => {
    seedAlive()
    const playerStore = usePlayerStore()
    const gameStore = useGameStore()
    gameStore.setCombatRng(() => 0.5)
    gameStore.primePlayerGauge()

    const ok = gameStore.gameLoop(16)

    expect(ok).toBe(true)
    expect(playerStore.player.currentHp).toBeGreaterThan(0)
    expect(gameStore.battleError).toBeNull()
  })

  it('暂停帧返回 true 且零推进', () => {
    seedAlive()
    const gameStore = useGameStore()
    gameStore.playerActionGauge = 30
    gameStore.monsterActionGauge = 20
    gameStore.isPaused = true
    const before = gameStore.playerActionGauge
    const mBefore = gameStore.monsterActionGauge

    const ok = gameStore.gameLoop(1000)

    expect(ok).toBe(true)
    expect(gameStore.playerActionGauge).toBe(before)
    expect(gameStore.monsterActionGauge).toBe(mBefore)
  })

  it('无当前怪物时设置错误并返回 false', () => {
    seedAlive()
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    const gameStore = useGameStore()
    playerStore.player.currentHp = 100
    monsterStore.currentMonster = null

    const ok = gameStore.gameLoop(16)

    expect(ok).toBe(false)
    expect(gameStore.battleError).not.toBeNull()
  })

  it('战斗内部抛异常时返回 false、错误规范化并锁定', () => {
    seedAlive()
    const playerStore = usePlayerStore()
    const gameStore = useGameStore()
    // detectBuffTransitions 遍历 activeBuffs：让 keys() 抛非 Error 值，验证规范化与锁定。
    const boomMap = new Map<string, unknown>()
    boomMap.keys = () => {
      throw 'boom-not-an-error'
    }
    playerStore.activeBuffs = boomMap as unknown as typeof playerStore.activeBuffs

    const ok = gameStore.gameLoop(16)

    expect(ok).toBe(false)
    expect(gameStore.battleError).toBeInstanceOf(Error)
    expect(gameStore.battleError!.message).toBe('boom-not-an-error')
  })

  it('已有 battleError 时后续帧立即返回 false、零 mutation、零 RNG', () => {
    seedAlive()
    const gameStore = useGameStore()
    gameStore.battleError = new Error('first fault')
    gameStore.playerActionGauge = 50
    const rngSpy = vi.fn(() => 0.5)
    gameStore.setCombatRng(rngSpy)
    const gaugeBefore = gameStore.playerActionGauge

    const ok = gameStore.gameLoop(1000)

    expect(ok).toBe(false)
    expect(gameStore.battleError!.message).toBe('first fault')
    expect(gameStore.playerActionGauge).toBe(gaugeBefore)
    expect(rngSpy).not.toHaveBeenCalled()
  })

  it('HP=0/负数/NaN/±Infinity 运行期返回 false', () => {
    seedAlive()
    const playerStore = usePlayerStore()
    const gameStore = useGameStore()
    for (const bad of [0, -5, NaN, Infinity, -Infinity]) {
      playerStore.player.currentHp = bad as number
      gameStore.battleError = null
      const ok = gameStore.gameLoop(16)
      expect(ok).toBe(false)
      expect(gameStore.battleError).not.toBeNull()
      playerStore.player.currentHp = 100
    }
  })

  it('运行期死亡恢复保存返回 false：gameLoop false、保持死亡、保存恰一次、后续帧不重试', () => {
    seedAlive()
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    const gameStore = useGameStore()
    playerStore.player.currentHp = 1
    playerStore.player.maxHp = 100
    monsterStore.setProgress(20, 20)
    monsterStore.currentMonster!.attack = 9999
    monsterStore.currentMonster!.accuracy = 100
    gameStore.setCombatRng(() => 0.5)
    gameStore.monsterActionGauge = 100 // 怪物立即可行动
    gameStore.playerActionGauge = 0
    const saveSpy = vi.spyOn(playerStore, 'saveGame').mockReturnValue(false)

    const ok = gameStore.gameLoop(1000)

    expect(ok).toBe(false)
    expect(playerStore.player.currentHp).toBe(0)
    expect(saveSpy).toHaveBeenCalledTimes(1)
    expect(gameStore.battleError).not.toBeNull()

    saveSpy.mockClear()
    const ok2 = gameStore.gameLoop(1000)
    expect(ok2).toBe(false)
    expect(saveSpy).not.toHaveBeenCalled()
  })

  it('保存抛异常时同样 fail-stop 且不向外抛', () => {
    seedAlive()
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    const gameStore = useGameStore()
    playerStore.player.currentHp = 1
    playerStore.player.maxHp = 100
    monsterStore.setProgress(20, 20)
    monsterStore.currentMonster!.attack = 9999
    monsterStore.currentMonster!.accuracy = 100
    gameStore.setCombatRng(() => 0.5)
    gameStore.monsterActionGauge = 100 // 怪物立即可行动
    gameStore.playerActionGauge = 0
    const saveSpy = vi
      .spyOn(playerStore, 'saveGame')
      .mockImplementation(() => {
        throw new Error('disk full')
      })

    let threw = false
    let ok: boolean | undefined
    try {
      ok = gameStore.gameLoop(1000)
    } catch {
      threw = true
    }

    expect(threw).toBe(false)
    expect(ok).toBe(false)
    expect(playerStore.player.currentHp).toBe(0)
    expect(gameStore.battleError).not.toBeNull()
    expect(saveSpy).toHaveBeenCalledTimes(1) // 恢复事务自身一次，不重试
  })
})

describe('Phase 3.41 — App 运行期故障熔断', () => {
  it('ready 状态首个帧返回 false：faulted、overlay、interval 清除、beforeunload 移除', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    const frameSpy = vi.spyOn(gameStore, 'gameLoop').mockImplementation(() => {
      gameStore.battleError = new Error('frame fault')
      return false
    })
    const intervalSpy = vi.spyOn(window, 'setInterval')
    const addListenerSpy = vi.spyOn(window, 'addEventListener')
    const removeListenerSpy = vi.spyOn(window, 'removeEventListener')

    const wrapper = mountApp()
    await nextTick()
    expect(intervalSpy.mock.calls.filter(c => c[1] === 1000).length).toBe(1)
    expect(addListenerSpy.mock.calls.filter(c => c[0] === 'beforeunload').length).toBe(1)

    const vm = wrapper.vm as unknown as ComponentPublicInstance & { handleGameFrame?: (d: number) => void }
    vm.handleGameFrame!(16)

    await nextTick()
    expect(wrapper.find('.runtime-gate-overlay').exists()).toBe(true)
    expect(wrapper.text()).toContain('游戏运行时发生错误')
    expect(wrapper.text()).toContain('frame fault')
    expect(removeListenerSpy.mock.calls.filter(c => c[0] === 'beforeunload').length).toBe(1)
    expect(frameSpy).toHaveBeenCalled()
    wrapper.unmount()
  })

  it('faulted 后多次 visibility 切换不恢复 RAF', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    vi.spyOn(gameStore, 'gameLoop').mockImplementation(() => {
      gameStore.battleError = new Error('frame fault')
      return false
    })
    const intervalSpy = vi.spyOn(window, 'setInterval')

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { handleGameFrame?: (d: number) => void }
    vm.handleGameFrame!(16)
    await nextTick()
    expect(wrapper.find('.runtime-gate-overlay').exists()).toBe(true)

    const intervalsBefore = intervalSpy.mock.calls.filter(c => c[1] === 1000).length
    setPageHidden(true)
    await nextTick()
    setPageHidden(false)
    await nextTick()
    expect(intervalSpy.mock.calls.filter(c => c[1] === 1000).length).toBe(intervalsBefore)
    expect(wrapper.find('.runtime-gate-overlay').exists()).toBe(true)
    wrapper.unmount()
  })

  it('faulted 后在线时间、经验、自动保存均不增加', async () => {
    seedAlive()
    const playerStore = usePlayerStore()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    vi.spyOn(gameStore, 'gameLoop').mockImplementation(() => {
      gameStore.battleError = new Error('frame fault')
      return false
    })
    const updateOnlineSpy = vi.spyOn(playerStore, 'updateOnlineTime')
    const addExpSpy = vi.spyOn(playerStore, 'addExperience')
    const saveSpy = vi.spyOn(playerStore, 'saveGame')

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & {
      handleGameFrame?: (d: number) => void
      tickTime?: () => void
    }
    vm.handleGameFrame!(16)
    await nextTick()

    for (let i = 0; i < 40; i++) {
      vm.tickTime!()
    }
    expect(updateOnlineSpy).not.toHaveBeenCalled()
    expect(addExpSpy).not.toHaveBeenCalled()
    expect(saveSpy).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('faulted 后技能、主线切换、离线领取均被阻止', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    vi.spyOn(gameStore, 'gameLoop').mockImplementation(() => {
      gameStore.battleError = new Error('frame fault')
      return false
    })
    const useSkillSpy = vi.spyOn(gameStore, 'tryUsePlayerSkill')
    const resumeSpy = vi.spyOn(gameStore, 'resumeBattle')

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & {
      handleGameFrame?: (d: number) => void
      useSkill?: (i: number) => void
      switchBattleMode?: (m: 'main' | 'training') => void
      onClaimOffline?: () => void
    }
    vm.handleGameFrame!(16)
    await nextTick()

    vm.useSkill!(0)
    vm.switchBattleMode!('main')
    vm.onClaimOffline!()
    expect(useSkillSpy).not.toHaveBeenCalled()
    expect(resumeSpy).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('faulted 后卸载：saveGame 零调用、recordLogout 零调用', async () => {
    seedAlive()
    const playerStore = usePlayerStore()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    vi.spyOn(gameStore, 'gameLoop').mockImplementation(() => {
      gameStore.battleError = new Error('frame fault')
      return false
    })
    const saveSpy = vi.spyOn(playerStore, 'saveGame')
    const logoutSpy = vi.spyOn(playerStore, 'recordLogout')

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { handleGameFrame?: (d: number) => void }
    vm.handleGameFrame!(16)
    await nextTick()
    expect(wrapper.find('.runtime-gate-overlay').exists()).toBe(true)

    wrapper.unmount()
    expect(saveSpy).not.toHaveBeenCalled()
    expect(logoutSpy).not.toHaveBeenCalled()
  })

  it('faulted 不调用 prepareBattleRuntimeAfterLoad 或死亡恢复事务', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    vi.spyOn(gameStore, 'gameLoop').mockImplementation(() => {
      gameStore.battleError = new Error('frame fault')
      return false
    })
    const recoverySpy = vi.spyOn(gameStore, 'recoverLoadedPlayerDeath')

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { handleGameFrame?: (d: number) => void }
    vm.handleGameFrame!(16)
    await nextTick()

    expect(recoverySpy).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('重复故障只保留第一条错误原因、资源清理只发生一次', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    vi.spyOn(gameStore, 'gameLoop').mockImplementation(() => {
      gameStore.battleError = new Error('frame fault')
      return false
    })
    const removeListenerSpy = vi.spyOn(window, 'removeEventListener')

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { handleGameFrame?: (d: number) => void }
    vm.handleGameFrame!(16)
    await nextTick()
    vm.handleGameFrame!(16)
    await nextTick()

    expect(wrapper.text()).toContain('frame fault')
    expect(removeListenerSpy.mock.calls.filter(c => c[0] === 'beforeunload').length).toBe(1)
    wrapper.unmount()
  })

  it('「重新加载游戏」按钮存在且 faulted 不调用启动重试', async () => {
    seedAlive()
    const gameStore = useGameStore()
    const prepSpy = vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    vi.spyOn(gameStore, 'gameLoop').mockImplementation(() => {
      gameStore.battleError = new Error('frame fault')
      return false
    })

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { handleGameFrame?: (d: number) => void }
    vm.handleGameFrame!(16)
    await nextTick()

    const reloadBtn = wrapper.findAll('.runtime-gate-overlay button')
    expect(reloadBtn.some(b => b.text().includes('重新加载游戏'))).toBe(true)
    expect(prepSpy).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })
})

describe('Phase 3.41 — 回归与架构护栏', () => {
  it('startup blocked 的显式重试行为保持不变', async () => {
    const gameStore = useGameStore()
    const prepSpy = vi
      .spyOn(gameStore, 'prepareBattleRuntimeAfterLoad')
      .mockReturnValueOnce({ ok: false, reason: 'invalid hp' })
      .mockReturnValue({ ok: true, state: 'alive' })
    const intervalSpy = vi.spyOn(window, 'setInterval')

    const wrapper = mountApp()
    await nextTick()
    expect(wrapper.find('.runtime-gate-overlay').exists()).toBe(true)
    expect(wrapper.text()).toContain('重试启动恢复')

    wrapper.find('.runtime-gate-overlay button').trigger('click')
    await nextTick()
    expect(prepSpy).toHaveBeenCalledTimes(2)
    expect(wrapper.find('.runtime-gate-overlay').exists()).toBe(false)
    expect(intervalSpy.mock.calls.filter(c => c[1] === 1000).length).toBe(1)
    wrapper.unmount()
  })

  it('正常 ready → hidden → visible 行为保持不变', async () => {
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
    expect(intervalSpy.mock.calls.filter(c => c[1] === 1000).length).toBe(1)
    expect(wrapper.find('.runtime-gate-overlay').exists()).toBe(false)
    wrapper.unmount()
  })

  it('正常 ready 卸载仍保存一次', async () => {
    seedAlive()
    const playerStore = usePlayerStore()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    const saveSpy = vi.spyOn(playerStore, 'saveGame')

    const wrapper = mountApp()
    await nextTick()
    wrapper.unmount()

    expect(saveSpy).toHaveBeenCalledTimes(1)
  })

  describe('架构护栏', () => {
    const ROOT = process.cwd()

    it('gameStore.gameLoop 返回 boolean 并锁定 battleError', () => {
      const src = readFileSync(resolve(ROOT, 'src/stores/gameStore.ts'), 'utf8')
      const m = src.match(/function gameLoop\(deltaTime: number\)\s*:\s*boolean\s*\{[\s\S]*?\n  \}/)
      expect(m).toBeTruthy()
      const body = m![0]
      expect(body).toContain('battleError.value')
      expect(body).toContain('return true')
      expect(body).toContain('return false')
      // 错误写入统一委托 latchBattleError（首错锁定 + 规范化），不在帧内直接写。
      expect(body).toContain('latchBattleError')
    })

    it('handlePlayerDeath 只对运行期来源 latch battleError，startup 不写入', () => {
      const src = readFileSync(resolve(ROOT, 'src/stores/gameStore.ts'), 'utf8')
      const m = src.match(/function handlePlayerDeath\(source: DeathRecoverySource\): DeathRecoveryResult\s*\{[\s\S]*?\n  \}/)
      expect(m).toBeTruthy()
      const body = m![0]
      expect(body).toContain("source !== 'startup'")
      expect(body).toContain('latchBattleError(result.reason)')
    })

    it('App 使用受控帧包装 handleGameFrame 并具备 enterRuntimeFault', () => {
      const src = readFileSync(resolve(ROOT, 'src/App.vue'), 'utf8')
      // Phase 3.49：useGameLoop 接受 handleGameFrame 业务回调 + lifecycle fault 回调
      expect(src).toContain('useGameLoop(handleGameFrame, handleGameLoopLifecycleFault)')
      expect(src).not.toContain('useGameLoop(gameStore.gameLoop)')
      const fault = src.match(/function enterRuntimeFault\(reason: string\)\s*\{[\s\S]*?\n\}/)
      expect(fault).toBeTruthy()
      expect(fault![0]).toContain("'faulted'")
    })

    it('useGameLoop.tick 在 callback 后重检再安排下一帧', () => {
      const src = readFileSync(resolve(ROOT, 'src/composables/useGameLoop.ts'), 'utf8')
      expect(src).toContain('shouldRun &&')
      expect(src).toContain('isRunning.value &&')
      expect(src).toContain('!document.hidden')
    })
  })
})

describe('Phase 3.41 Repair 1 — 启动恢复错误与运行期 latch 隔离', () => {
  it('startup 保存返回 false：返回失败、保持死亡、battleError === null、保存恰好一次', () => {
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    const gameStore = useGameStore()
    playerStore.player.currentHp = 0
    playerStore.player.maxHp = 100
    monsterStore.setProgress(45, 20)
    const saveSpy = vi.spyOn(playerStore, 'saveGame').mockReturnValue(false)

    const res = gameStore.recoverLoadedPlayerDeath()

    expect(res).toEqual({ ok: false, reason: 'save failed' })
    expect(playerStore.player.currentHp).toBe(0)
    expect(gameStore.battleError).toBeNull()
    expect(saveSpy).toHaveBeenCalledTimes(1)
  })

  it('startup 保存抛异常：不外抛、返回失败、battleError === null、保存恰一次', () => {
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
    let res: ReturnType<typeof gameStore.recoverLoadedPlayerDeath> | undefined
    try {
      res = gameStore.recoverLoadedPlayerDeath()
    } catch {
      threw = true
    }

    expect(threw).toBe(false)
    expect(res!.ok).toBe(false)
    expect(playerStore.player.currentHp).toBe(0)
    expect(gameStore.battleError).toBeNull()
    expect(saveSpy).toHaveBeenCalledTimes(1)
  })

  it('playerTurn 保存失败：battleError 被设置、第一条锁定、后续帧不重试', () => {
    seedAlive()
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    const gameStore = useGameStore()
    playerStore.player.currentHp = 1
    playerStore.player.maxHp = 100
    monsterStore.setProgress(20, 20)
    monsterStore.currentMonster!.attack = 9999
    monsterStore.currentMonster!.accuracy = 100
    gameStore.setCombatRng(() => 0.5)
    gameStore.monsterActionGauge = 100
    gameStore.playerActionGauge = 0
    const saveSpy = vi.spyOn(playerStore, 'saveGame').mockReturnValue(false)

    const ok = gameStore.gameLoop(1000)

    expect(ok).toBe(false)
    expect(gameStore.battleError).not.toBeNull()
    expect(playerStore.player.currentHp).toBe(0)
    expect(saveSpy).toHaveBeenCalledTimes(1)

    saveSpy.mockClear()
    const ok2 = gameStore.gameLoop(1000)
    expect(ok2).toBe(false)
    expect(saveSpy).not.toHaveBeenCalled()
  })

  it('monsterTurn 保存失败：同样 latch battleError、后续帧 fail-stop', () => {
    seedAlive()
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    const gameStore = useGameStore()
    playerStore.player.currentHp = 1
    playerStore.player.maxHp = 100
    monsterStore.setProgress(20, 20)
    monsterStore.currentMonster!.attack = 9999
    monsterStore.currentMonster!.accuracy = 100
    gameStore.setCombatRng(() => 0.5)
    gameStore.monsterActionGauge = 100
    gameStore.playerActionGauge = 0
    const saveSpy = vi.spyOn(playerStore, 'saveGame').mockReturnValue(false)

    const ok = gameStore.gameLoop(1000)

    expect(ok).toBe(false)
    expect(gameStore.battleError).not.toBeNull()
    expect(playerStore.player.currentHp).toBe(0)

    saveSpy.mockClear()
    expect(gameStore.gameLoop(1000)).toBe(false)
    expect(saveSpy).not.toHaveBeenCalled()
  })

  it('已有真实运行期 battleError 时不被 startup 相关 API 覆盖', () => {
    seedAlive()
    const gameStore = useGameStore()
    gameStore.battleError = new Error('runtime first fault')
    const playerStore = usePlayerStore()
    playerStore.player.currentHp = 100
    const monsterStore = useMonsterStore()
    monsterStore.setProgress(45, 20)

    const res = gameStore.prepareBattleRuntimeAfterLoad()
    expect(res).toEqual({ ok: true, state: 'alive' })
    expect(gameStore.battleError!.message).toBe('runtime first fault')
  })

  it('真实 App：第一次保存失败进入 blocked 且 battleError === null、零运行资源', async () => {
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    const gameStore = useGameStore()
    playerStore.player.currentHp = 0
    playerStore.player.maxHp = 100
    monsterStore.setProgress(45, 20)
    const saveSpy = vi.spyOn(playerStore, 'saveGame').mockReturnValue(false)
    const intervalSpy = vi.spyOn(window, 'setInterval')
    const addListenerSpy = vi.spyOn(window, 'addEventListener')

    const wrapper = mountApp()
    await nextTick()

    expect(wrapper.find('.runtime-gate-overlay').exists()).toBe(true)
    expect(wrapper.text()).toContain('重试启动恢复')
    expect(gameStore.battleError).toBeNull()
    expect(saveSpy).toHaveBeenCalledTimes(1)
    expect(intervalSpy.mock.calls.filter(c => c[1] === 1000).length).toBe(0)
    expect(addListenerSpy.mock.calls.filter(c => c[0] === 'beforeunload').length).toBe(0)
    wrapper.unmount()
  })

  it('真实 App：显式重试成功（第二次保存 true）→ ready、battleError null、首个真实帧返回 true', async () => {
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
    const intervalSpy = vi.spyOn(window, 'setInterval')
    const addListenerSpy = vi.spyOn(window, 'addEventListener')

    const wrapper = mountApp()
    await nextTick()
    expect(wrapper.find('.runtime-gate-overlay').exists()).toBe(true)
    expect(gameStore.battleError).toBeNull()

    wrapper.find('.runtime-gate-overlay button').trigger('click')
    await nextTick()

    expect(wrapper.find('.runtime-gate-overlay').exists()).toBe(false)
    expect(playerStore.player.currentHp).toBe(100)
    expect(gameStore.battleError).toBeNull()
    expect(saveSpy).toHaveBeenCalledTimes(2) // 启动失败一次 + 重试成功一次
    expect(intervalSpy.mock.calls.filter(c => c[1] === 1000).length).toBe(1)
    expect(addListenerSpy.mock.calls.filter(c => c[0] === 'beforeunload').length).toBe(1)

    const vm = wrapper.vm as unknown as ComponentPublicInstance & { handleGameFrame?: (d: number) => void }
    vm.handleGameFrame!(16)
    await nextTick()
    expect(wrapper.find('.runtime-gate-overlay').exists()).toBe(false)
    expect(gameStore.battleError).toBeNull()
    wrapper.unmount()
  })

  it('真实 App：第一次与第二次保存都失败 → 保持 blocked、battleError null、保存次数等于显式恢复次数', async () => {
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    const gameStore = useGameStore()
    playerStore.player.currentHp = 0
    playerStore.player.maxHp = 100
    monsterStore.setProgress(45, 20)
    const saveSpy = vi.spyOn(playerStore, 'saveGame').mockReturnValue(false)

    const wrapper = mountApp()
    await nextTick()
    expect(wrapper.find('.runtime-gate-overlay').exists()).toBe(true)
    expect(saveSpy).toHaveBeenCalledTimes(1)

    wrapper.find('.runtime-gate-overlay button').trigger('click')
    await nextTick()
    expect(wrapper.find('.runtime-gate-overlay').exists()).toBe(true)
    expect(gameStore.battleError).toBeNull()
    expect(saveSpy).toHaveBeenCalledTimes(2)
    wrapper.unmount()
  })

  it('startup 失败后 visibility hidden → visible：不启动 RAF、不设置 battleError、不自动恢复', async () => {
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    const gameStore = useGameStore()
    playerStore.player.currentHp = 0
    playerStore.player.maxHp = 100
    monsterStore.setProgress(45, 20)
    vi.spyOn(playerStore, 'saveGame').mockReturnValue(false)
    const intervalSpy = vi.spyOn(window, 'setInterval')
    const prepSpy = vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad')

    const wrapper = mountApp()
    await nextTick()
    expect(wrapper.find('.runtime-gate-overlay').exists()).toBe(true)
    const prepCalls = prepSpy.mock.calls.length

    setPageHidden(true)
    await nextTick()
    setPageHidden(false)
    await nextTick()

    expect(prepSpy.mock.calls.length).toBe(prepCalls)
    expect(gameStore.battleError).toBeNull()
    expect(intervalSpy.mock.calls.filter(c => c[1] === 1000).length).toBe(0)
    wrapper.unmount()
  })

  it('faulted 后点击「重新加载游戏」：reload 恰一次、saveGame/recordLogout/prepare/恢复零调用', async () => {
    seedAlive()
    const playerStore = usePlayerStore()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    vi.spyOn(gameStore, 'gameLoop').mockImplementation(() => {
      gameStore.battleError = new Error('frame fault')
      return false
    })
    const saveSpy = vi.spyOn(playerStore, 'saveGame')
    const logoutSpy = vi.spyOn(playerStore, 'recordLogout')
    const recoverySpy = vi.spyOn(gameStore, 'recoverLoadedPlayerDeath')
    const prepSpy = vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad')
    // window.location.reload 在 jsdom 不可直接 spy（non-configurable），用 stub location 覆盖。
    const reloadSpy = vi.fn()
    const originalLocation = window.location
    const stubLocation = { ...originalLocation, reload: reloadSpy }
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: stubLocation
    })

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { handleGameFrame?: (d: number) => void }
    vm.handleGameFrame!(16)
    await nextTick()
    expect(wrapper.find('.runtime-gate-overlay').exists()).toBe(true)
    expect(wrapper.text()).toContain('重新加载游戏')

    const reloadBtn = wrapper.findAll('.runtime-gate-overlay button').find(b => b.text().includes('重新加载游戏'))
    expect(reloadBtn).toBeTruthy()
    reloadBtn!.trigger('click')

    expect(reloadSpy).toHaveBeenCalledTimes(1)
    expect(saveSpy).not.toHaveBeenCalled()
    expect(logoutSpy).not.toHaveBeenCalled()
    expect(recoverySpy).not.toHaveBeenCalled()
    expect(prepSpy).toHaveBeenCalledTimes(1) // mount 时一次，点击 reload 不增加
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation
    })
    wrapper.unmount()
  })
})
