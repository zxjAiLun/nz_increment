// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { usePlayerStore } from './playerStore'
import { useMonsterStore } from './monsterStore'
import { useGameStore } from './gameStore'
import { useNavigationStore } from './navigationStore'
import { useATBStore } from './atbStore'
import App from '../App.vue'
import type { ComponentPublicInstance } from 'vue'
import type { OfflineSettlement } from '../utils/offlineReward'
// @ts-ignore —— 测试运行于 Node，无需在应用 tsconfig 中引入 @types/node 全局类型
import { readFileSync } from 'node:fs'
// @ts-ignore
import { resolve } from 'node:path'
// @ts-ignore
declare const process: { cwd(): string }

/**
 * Phase 3.46 — 运行时卸载保存失败隔离与单次关闭事务。
 *
 * onUnmounted 只委托 shutdownAppRuntime()：
 * - runtimeShutdownStarted latch 在任何清理/保存前提交，重复调用 no-op；
 * - shouldSave 在 stopRuntime() 之前按状态快照取得，只有原状态为 ready 才保存一次；
 * - 资源清理先于 saveGame()；
 * - saveGame 返回 false / 抛异常统一进入 faulted（shutdown save failed），零重试、零 recordLogout；
 * - 非 ready（initializing/blocked/faulted）卸载保持零保存、原 reason 不被覆盖。
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

/** 挂载 App（stub 掉重型子组件；OfflineRewardModal 用可检测的自定义 stub）。 */
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
        OfflineRewardModal: { template: '<div class="offline-reward-stub"></div>' }
      }
    }
  })
}

/** 统一 spy 启动期资源 API。RAF 被 mock 为「只登记不调度」。 */
function spyRafResources(id = 1) {
  const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => id)
  const cancelSpy = vi.spyOn(window, 'cancelAnimationFrame')
  const intervalSpy = vi.spyOn(window, 'setInterval')
  const clearSpy = vi.spyOn(window, 'clearInterval')
  const addSpy = vi.spyOn(window, 'addEventListener')
  const removeSpy = vi.spyOn(window, 'removeEventListener')
  return { rafSpy, cancelSpy, intervalSpy, clearSpy, addSpy, removeSpy }
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

describe('Phase 3.46 — 正常成功', () => {
  it('ready 卸载且保存成功：unmount 不抛、saveGame 一次、recordLogout 零、资源各清理一次', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    const playerStore = usePlayerStore()
    const saveSpy = vi.spyOn(playerStore, 'saveGame').mockReturnValue(true)
    const logoutSpy = vi.spyOn(playerStore, 'recordLogout')
    const { cancelSpy, intervalSpy, clearSpy, removeSpy } = spyRafResources()

    const wrapper = mountApp()
    await nextTick()

    let threw = false
    try {
      wrapper.unmount()
    } catch {
      threw = true
    }

    expect(threw).toBe(false)
    expect(saveSpy).toHaveBeenCalledTimes(1)
    expect(logoutSpy).not.toHaveBeenCalled()
    expect(cancelSpy.mock.calls.filter(c => c[0] === 1).length).toBe(1)
    const runtimeSetIdx = intervalSpy.mock.calls.findIndex(c => c[1] === 1000)
    expect(runtimeSetIdx).toBeGreaterThanOrEqual(0)
    const runtimeIntervalId = intervalSpy.mock.results[runtimeSetIdx].value
    expect(clearSpy.mock.calls.filter(c => c[0] === runtimeIntervalId).length).toBe(1)
    expect(removeSpy.mock.calls.filter(c => c[0] === 'beforeunload').length).toBe(1)
  })

  it('保存调用发生在所有资源清理之后', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    const saveSpy = vi.spyOn(usePlayerStore(), 'saveGame').mockReturnValue(true)
    const { cancelSpy, clearSpy, removeSpy } = spyRafResources()

    const wrapper = mountApp()
    await nextTick()
    wrapper.unmount()

    expect(saveSpy.mock.invocationCallOrder[0]).toBeGreaterThan(cancelSpy.mock.invocationCallOrder[0])
    expect(saveSpy.mock.invocationCallOrder[0]).toBeGreaterThan(clearSpy.mock.invocationCallOrder[0])
    expect(saveSpy.mock.invocationCallOrder[0]).toBeGreaterThan(removeSpy.mock.invocationCallOrder[0])
    expect(saveSpy.mock.invocationCallOrder.length).toBe(1)
  })

  it('正常成功不进入 faulted、不产生 shutdown reason', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    vi.spyOn(usePlayerStore(), 'saveGame').mockReturnValue(true)

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { runtimeStartupStatus?: string, runtimeStartupError?: string }

    wrapper.unmount()

    expect(vm.runtimeStartupStatus).toBe('ready')
    expect(vm.runtimeStartupError).toBe('')
  })

  it('重复调用关闭协调函数：保存总计一次、cleanup 不重复', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    const saveSpy = vi.spyOn(usePlayerStore(), 'saveGame').mockReturnValue(true)
    const { cancelSpy, clearSpy, removeSpy } = spyRafResources()

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { shutdownAppRuntime?: () => void }

    wrapper.unmount()
    expect(saveSpy).toHaveBeenCalledTimes(1)
    const cancelCount = cancelSpy.mock.calls.length
    const clearCount = clearSpy.mock.calls.length
    const removeCount = removeSpy.mock.calls.filter(c => c[0] === 'beforeunload').length

    saveSpy.mockClear()
    vm.shutdownAppRuntime!()

    expect(saveSpy).not.toHaveBeenCalled()
    expect(cancelSpy.mock.calls.length).toBe(cancelCount)
    expect(clearSpy.mock.calls.length).toBe(clearCount)
    expect(removeSpy.mock.calls.filter(c => c[0] === 'beforeunload').length).toBe(removeCount)
  })
})

describe('Phase 3.46 — 返回 false', () => {
  it('saveGame 返回 false：unmount 不抛、status faulted、reason 精确 shutdown save failed、保存一次', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    const saveSpy = vi.spyOn(usePlayerStore(), 'saveGame').mockReturnValue(false)

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { runtimeStartupStatus?: string, runtimeStartupError?: string }

    let threw = false
    try {
      wrapper.unmount()
    } catch {
      threw = true
    }

    expect(threw).toBe(false)
    expect(saveSpy).toHaveBeenCalledTimes(1)
    expect(vm.runtimeStartupStatus).toBe('faulted')
    expect(vm.runtimeStartupError).toBe('shutdown save failed')
  })

  it('false 分支：不含冒号/undefined/null、不重试、recordLogout 零', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    const playerStore = usePlayerStore()
    const saveSpy = vi.spyOn(playerStore, 'saveGame').mockReturnValue(false)
    const logoutSpy = vi.spyOn(playerStore, 'recordLogout')

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { runtimeStartupError?: string }

    wrapper.unmount()

    expect(vm.runtimeStartupError).toBe('shutdown save failed')
    expect(vm.runtimeStartupError).not.toContain(':')
    expect(vm.runtimeStartupError).not.toContain('undefined')
    expect(vm.runtimeStartupError).not.toContain('null')
    expect(saveSpy).toHaveBeenCalledTimes(1)
    expect(logoutSpy).not.toHaveBeenCalled()
  })

  it('false 后再次调用关闭入口：保存仍一次、reason 不变、cleanup 不重复', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    const saveSpy = vi.spyOn(usePlayerStore(), 'saveGame').mockReturnValue(false)
    const { cancelSpy, clearSpy, removeSpy } = spyRafResources()

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { shutdownAppRuntime?: () => void, runtimeStartupError?: string }

    wrapper.unmount()
    expect(saveSpy).toHaveBeenCalledTimes(1)
    expect(vm.runtimeStartupError).toBe('shutdown save failed')
    const cancelCount = cancelSpy.mock.calls.length
    const clearCount = clearSpy.mock.calls.length
    const removeCount = removeSpy.mock.calls.filter(c => c[0] === 'beforeunload').length

    saveSpy.mockClear()
    vm.shutdownAppRuntime!()

    expect(saveSpy).not.toHaveBeenCalled()
    expect(vm.runtimeStartupError).toBe('shutdown save failed')
    expect(cancelSpy.mock.calls.length).toBe(cancelCount)
    expect(clearSpy.mock.calls.length).toBe(clearCount)
    expect(removeSpy.mock.calls.filter(c => c[0] === 'beforeunload').length).toBe(removeCount)
  })

  it('false 不修改 gameStore.battleError', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    vi.spyOn(usePlayerStore(), 'saveGame').mockReturnValue(false)

    const wrapper = mountApp()
    await nextTick()
    wrapper.unmount()

    expect(gameStore.battleError).toBeNull()
  })
})

describe('Phase 3.46 — 保存抛异常', () => {
  it('saveGame 抛 Error：unmount 不抛、shutdown save failed: <msg>、保存一次、资源已清理', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    const saveSpy = vi.spyOn(usePlayerStore(), 'saveGame').mockImplementation(() => {
      throw new Error('quota boom')
    })
    const { cancelSpy, intervalSpy, clearSpy, removeSpy } = spyRafResources()

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { runtimeStartupError?: string }

    let threw = false
    try {
      wrapper.unmount()
    } catch {
      threw = true
    }

    expect(threw).toBe(false)
    expect(saveSpy).toHaveBeenCalledTimes(1)
    expect(vm.runtimeStartupError).toBe('shutdown save failed: quota boom')
    expect(cancelSpy.mock.calls.filter(c => c[0] === 1).length).toBe(1)
    const runtimeSetIdx = intervalSpy.mock.calls.findIndex(c => c[1] === 1000)
    expect(runtimeSetIdx).toBeGreaterThanOrEqual(0)
    const runtimeIntervalId = intervalSpy.mock.results[runtimeSetIdx].value
    expect(clearSpy.mock.calls.filter(c => c[0] === runtimeIntervalId).length).toBe(1)
    expect(removeSpy.mock.calls.filter(c => c[0] === 'beforeunload').length).toBe(1)
  })

  it('saveGame 抛非 Error：String 规范化、不外抛', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    vi.spyOn(usePlayerStore(), 'saveGame').mockImplementation(() => {
      throw 'shutdown-string-boom'
    })

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { runtimeStartupError?: string }

    let threw = false
    try {
      wrapper.unmount()
    } catch {
      threw = true
    }

    expect(threw).toBe(false)
    expect(vm.runtimeStartupError).toBe('shutdown save failed: shutdown-string-boom')
  })

  it('saveGame 抛空 message：reason 为基础分类、无尾随冒号', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    vi.spyOn(usePlayerStore(), 'saveGame').mockImplementation(() => {
      throw new Error('')
    })

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { runtimeStartupError?: string }

    wrapper.unmount()

    expect(vm.runtimeStartupError).toBe('shutdown save failed')
    expect(vm.runtimeStartupError).not.toContain('shutdown save failed:')
  })

  it('已有 battleError 时保存抛异常：Store 引用/message 不变、App shutdown reason 用 shutdown 分类', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    const existing = new Error('existing store fault')
    gameStore.battleError = existing
    vi.spyOn(usePlayerStore(), 'saveGame').mockImplementation(() => {
      throw new Error('quota boom')
    })

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { runtimeStartupError?: string }

    wrapper.unmount()

    expect(gameStore.battleError).toBe(existing)
    expect(gameStore.battleError!.message).toBe('existing store fault')
    expect(vm.runtimeStartupError).toBe('shutdown save failed: quota boom')
  })
})

describe('Phase 3.46 — 非 ready 卸载', () => {
  it('initializing 卸载：零保存、零 recordLogout', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    const playerStore = usePlayerStore()
    const saveSpy = vi.spyOn(playerStore, 'saveGame')
    const logoutSpy = vi.spyOn(playerStore, 'recordLogout')

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { runtimeStartupStatus?: string }
    vm.runtimeStartupStatus = 'initializing'
    wrapper.unmount()

    expect(saveSpy).not.toHaveBeenCalled()
    expect(logoutSpy).not.toHaveBeenCalled()
  })

  it('blocked 卸载：零保存、零 recordLogout', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: false, reason: 'invalid hp' })
    const playerStore = usePlayerStore()
    const saveSpy = vi.spyOn(playerStore, 'saveGame')
    const logoutSpy = vi.spyOn(playerStore, 'recordLogout')

    const wrapper = mountApp()
    await nextTick()
    wrapper.unmount()

    expect(saveSpy).not.toHaveBeenCalled()
    expect(logoutSpy).not.toHaveBeenCalled()
  })

  it('faulted（battle false-return）卸载：零保存、原 reason 保持、不产生 shutdown 分类', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    vi.spyOn(gameStore, 'gameLoop').mockImplementation(() => {
      gameStore.battleError = new Error('battle reason')
      return false
    })
    const saveSpy = vi.spyOn(usePlayerStore(), 'saveGame')

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & {
      handleGameFrame?: (d: number) => void
      runtimeStartupError?: string
    }
    vm.handleGameFrame!(16)
    await nextTick()
    expect(wrapper.find('.runtime-gate-overlay').exists()).toBe(true)

    wrapper.unmount()

    expect(saveSpy).not.toHaveBeenCalled()
    expect(vm.runtimeStartupError).toContain('battle reason')
    expect(vm.runtimeStartupError).not.toContain('shutdown save failed')
  })

  it('bootstrap fault 后卸载：不产生 shutdown 保存分类', async () => {
    seedAlive()
    const navigationStore = useNavigationStore()
    vi.spyOn(navigationStore, 'initialize').mockImplementation(() => {
      throw new Error('nav boom')
    })
    const saveSpy = vi.spyOn(usePlayerStore(), 'saveGame')

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { runtimeStartupError?: string }

    wrapper.unmount()

    expect(saveSpy).not.toHaveBeenCalled()
    expect(vm.runtimeStartupError).toContain('navigation initialization failed: nav boom')
    expect(vm.runtimeStartupError).not.toContain('shutdown save failed')
  })

  it('frame fault 后卸载：不产生 shutdown 保存分类', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    vi.spyOn(gameStore, 'gameLoop').mockImplementation(() => {
      throw new Error('frame boom')
    })
    const saveSpy = vi.spyOn(usePlayerStore(), 'saveGame')

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & {
      handleGameFrame?: (d: number) => void
      runtimeStartupError?: string
    }
    vm.handleGameFrame!(16)
    await nextTick()
    expect(vm.runtimeStartupError).toContain('battle runtime frame failed: frame boom')

    wrapper.unmount()

    expect(saveSpy).not.toHaveBeenCalled()
    expect(vm.runtimeStartupError).toContain('battle runtime frame failed: frame boom')
    expect(vm.runtimeStartupError).not.toContain('shutdown save failed')
  })

  it('timer fault 后卸载：不产生 shutdown 保存分类', async () => {
    seedAlive()
    const playerStore = usePlayerStore()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    vi.spyOn(playerStore, 'getExpPerSecond').mockReturnValue(0)
    const saveSpy = vi.spyOn(playerStore, 'saveGame').mockReturnValue(false)

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { tickTime?: () => void, runtimeStartupError?: string }
    for (let i = 0; i < 30; i++) vm.tickTime!()
    await nextTick()
    expect(vm.runtimeStartupError).toContain('automatic save failed')

    saveSpy.mockClear()
    wrapper.unmount()

    expect(saveSpy).not.toHaveBeenCalled()
    expect(vm.runtimeStartupError).toContain('automatic save failed')
    expect(vm.runtimeStartupError).not.toContain('shutdown save failed')
  })
})

describe('Phase 3.46 — 资源所有权与故障域隔离', () => {
  it('shutdown 保存失败后：RAF 取消至多一次、interval 清除一次、listener 移除一次', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    vi.spyOn(usePlayerStore(), 'saveGame').mockReturnValue(false)
    const { cancelSpy, intervalSpy, clearSpy, removeSpy } = spyRafResources()

    const wrapper = mountApp()
    await nextTick()
    const runtimeSetIdx = intervalSpy.mock.calls.findIndex(c => c[1] === 1000)
    expect(runtimeSetIdx).toBeGreaterThanOrEqual(0)
    const runtimeIntervalId = intervalSpy.mock.results[runtimeSetIdx].value

    wrapper.unmount()

    expect(cancelSpy.mock.calls.filter(c => c[0] === 1).length).toBe(1)
    expect(clearSpy.mock.calls.filter(c => c[0] === runtimeIntervalId).length).toBe(1)
    expect(removeSpy.mock.calls.filter(c => c[0] === 'beforeunload').length).toBe(1)
  })

  it('保存抛异常后重复 shutdown：不重复取消/清 interval/移除 listener', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    vi.spyOn(usePlayerStore(), 'saveGame').mockImplementation(() => {
      throw new Error('quota boom')
    })
    const { cancelSpy, intervalSpy, clearSpy, removeSpy } = spyRafResources()

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { shutdownAppRuntime?: () => void }
    const runtimeSetIdx = intervalSpy.mock.calls.findIndex(c => c[1] === 1000)
    const runtimeIntervalId = intervalSpy.mock.results[runtimeSetIdx].value

    wrapper.unmount()
    expect(clearSpy.mock.calls.filter(c => c[0] === runtimeIntervalId).length).toBe(1)
    expect(cancelSpy.mock.calls.filter(c => c[0] === 1).length).toBe(1)
    expect(removeSpy.mock.calls.filter(c => c[0] === 'beforeunload').length).toBe(1)

    vm.shutdownAppRuntime!()

    expect(clearSpy.mock.calls.filter(c => c[0] === runtimeIntervalId).length).toBe(1)
    expect(cancelSpy.mock.calls.filter(c => c[0] === 1).length).toBe(1)
    expect(removeSpy.mock.calls.filter(c => c[0] === 'beforeunload').length).toBe(1)
  })

  it('offline modal 在关闭清理过程中关闭，不执行 claim', async () => {
    seedAlive()
    const playerStore = usePlayerStore()
    playerStore.pendingOfflineReward = { gold: 100, exp: 50 } as OfflineSettlement
    expect(playerStore.saveGame()).toBe(true) // 写盘，让 loadGame 水合 pending

    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    vi.spyOn(playerStore, 'saveGame').mockReturnValue(true)

    const wrapper = mountApp()
    await nextTick()
    expect(wrapper.find('.offline-reward-stub').exists()).toBe(true)

    wrapper.unmount()

    // 关闭清理不执行 claim：pending 保留、金币不变
    expect(playerStore.pendingOfflineReward).not.toBeNull()
    expect(playerStore.player.gold).toBe(0)
  })

  it('自动保存 false 仍为 automatic save failed（与卸载保存隔离）', async () => {
    seedAlive()
    const playerStore = usePlayerStore()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    vi.spyOn(playerStore, 'getExpPerSecond').mockReturnValue(0)
    vi.spyOn(playerStore, 'saveGame').mockReturnValue(false)

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { tickTime?: () => void, runtimeStartupError?: string }
    for (let i = 0; i < 30; i++) vm.tickTime!()
    await nextTick()

    expect(vm.runtimeStartupError).toContain('automatic save failed')
    expect(vm.runtimeStartupError).not.toContain('shutdown save failed')
    wrapper.unmount()
  })

  it('shutdown 保存 false 只为 shutdown save failed（与自动保存隔离）', async () => {
    seedAlive()
    const playerStore = usePlayerStore()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    vi.spyOn(playerStore, 'getExpPerSecond').mockReturnValue(0)
    const saveSpy = vi.spyOn(playerStore, 'saveGame').mockReturnValue(false)

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { runtimeStartupError?: string }

    wrapper.unmount()

    expect(saveSpy).toHaveBeenCalledTimes(1)
    expect(vm.runtimeStartupError).toBe('shutdown save failed')
    expect(vm.runtimeStartupError).not.toContain('automatic save failed')
  })

  it('shutdown 不读取或重置自动保存计数器（只执行一次 shutdown 保存）', async () => {
    seedAlive()
    const playerStore = usePlayerStore()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    vi.spyOn(playerStore, 'getExpPerSecond').mockReturnValue(0)
    const saveSpy = vi.spyOn(playerStore, 'saveGame').mockReturnValue(true)

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { tickTime?: () => void }

    // 推进自动保存计数（<30，不触发保存）
    for (let i = 0; i < 29; i++) vm.tickTime!()
    expect(saveSpy).not.toHaveBeenCalled()

    // 卸载只执行 shutdown 保存一次；计数器不被 shutdown 读取/重置
    wrapper.unmount()
    expect(saveSpy).toHaveBeenCalledTimes(1)
  })
})

describe('Phase 3.46 — 架构护栏', () => {
  const ROOT = process.cwd()

  function shutdownBody() {
    const src = readFileSync(resolve(ROOT, 'src/App.vue'), 'utf8')
    const m = src.match(/function shutdownAppRuntime\(\)\s*\{[\s\S]*?\n\}/)
    expect(m).toBeTruthy()
    return m![0]
  }

  it('护栏：onUnmounted 只委托单一关闭协调函数', () => {
    const src = readFileSync(resolve(ROOT, 'src/App.vue'), 'utf8')
    const mounted = src.match(/onUnmounted\(\(\) => \{[\s\S]*?\n\}\)/)
    expect(mounted).toBeTruthy()
    expect(mounted![0]).toContain('shutdownAppRuntime()')
    expect(mounted![0]).not.toContain('saveGame')
    expect(mounted![0]).not.toContain('stopRuntime(')
  })

  it('护栏：关闭协调函数具有单次 latch，且在任何清理/保存前提交', () => {
    const body = shutdownBody()
    expect(body).toContain('if (runtimeShutdownStarted) return')
    expect(body).toContain('runtimeShutdownStarted = true')
    expect(body.indexOf('runtimeShutdownStarted = true')).toBeLessThan(body.indexOf('stopRuntime()'))
    expect(body.indexOf('runtimeShutdownStarted = true')).toBeLessThan(body.indexOf('playerStore.saveGame()'))
  })

  it('护栏：ready 快照在 stopRuntime() 之前取得', () => {
    const body = shutdownBody()
    const snapshotIdx = body.indexOf("const shouldSave = runtimeStartupStatus.value === 'ready'")
    const stopIdx = body.indexOf('stopRuntime()')
    expect(snapshotIdx).toBeGreaterThan(-1)
    expect(snapshotIdx).toBeLessThan(stopIdx)
  })

  it('护栏：saveGame() 位于 stopRuntime() 之后', () => {
    const body = shutdownBody()
    expect(body.indexOf('playerStore.saveGame()')).toBeGreaterThan(body.indexOf('stopRuntime()'))
  })

  it('护栏：false 与 throw 分支均复用 enterRuntimeFault；throw 复用 formatRuntimeFault', () => {
    const body = shutdownBody()
    expect(body).toContain("enterRuntimeFault('shutdown save failed')")
    expect(body).toContain("enterRuntimeFault(formatRuntimeFault('shutdown save failed', error))")
  })

  it('护栏：shutdown 路径不存在 recordLogout/resetGame/恢复/启动准备/reload/setTimeout/第二次保存/计数器操作', () => {
    const body = shutdownBody()
    for (const forbidden of [
      'recordLogout',
      'resetGame',
      'recoverLoadedPlayerDeath',
      'prepareBattleRuntimeAfterLoad',
      'location.reload',
      'setTimeout',
      'autoSaveCounter',
      'tickTime'
    ]) {
      expect(body).not.toContain(forbidden)
    }
    expect((body.match(/playerStore\.saveGame\(\)/g) || []).length).toBe(1)
  })
})
