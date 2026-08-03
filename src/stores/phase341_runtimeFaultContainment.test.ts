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
      expect(body).toContain('instanceof Error')
    })

    it('App 使用受控帧包装 handleGameFrame 并具备 enterRuntimeFault', () => {
      const src = readFileSync(resolve(ROOT, 'src/App.vue'), 'utf8')
      expect(src).toContain('useGameLoop(handleGameFrame)')
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
