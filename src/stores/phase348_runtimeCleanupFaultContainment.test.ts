// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { usePlayerStore } from './playerStore'
import { useMonsterStore } from './monsterStore'
import { useGameStore } from './gameStore'
import { useTrainingStore } from './trainingStore'
import { useATBStore } from './atbStore'
import { useGameLoop } from '../composables/useGameLoop'
import App from '../App.vue'
import type { ComponentPublicInstance } from 'vue'
// @ts-ignore —— 测试运行于 Node，无需在应用 tsconfig 中引入 @types/node 全局类型
import { readFileSync } from 'node:fs'
// @ts-ignore
import { resolve } from 'node:path'
// @ts-ignore
declare const process: { cwd(): string }

/**
 * Phase 3.48 — 运行时资源清理异常隔离与所有权先释放。
 *
 * - useGameLoop.stop() 先释放 shouldRun/isRunning/lastTimestamp/RAF ID，再最佳努力调用
 *   cancelAnimationFrame，返回第一条清理错误（null = 无异常），不外抛。
 * - App.stopRuntime() 每个资源独立 try/catch，所有权先释放，返回第一条错误，不分类故障。
 * - shutdownAppRuntime() 捕获 cleanup 错误 → runtime cleanup failed，并按原 ready 快照保存一次；
 *   既有 fault teardown 保留原始主 reason（cleanup 错误不覆盖）。
 */

function warmupStores() {
  usePlayerStore()
  useMonsterStore()
  useGameStore()
  useTrainingStore()
  useATBStore()
}

function seedAlive() {
  const playerStore = usePlayerStore()
  const monsterStore = useMonsterStore()
  playerStore.player.currentHp = 100
  playerStore.player.maxHp = 100
  monsterStore.setProgress(20, 20)
}

/** 挂载 App（stub 掉重型子组件）。 */
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

/**
 * 统一 spy 启动/清理资源 API。rafThrow / clearThrow / removeThrow 存在时对应清理 API 抛该值；
 * beforeunloadAddThrow 为 true 时 addEventListener('beforeunload') 抛 Error（用于 startup rollback）。
 * 捕获实际传给 rAF 的 callback 供重放验证。
 */
function spyCleanupResources(opts: { rafThrow?: unknown; clearThrow?: unknown; removeThrow?: unknown; beforeunloadAddThrow?: boolean } = {}) {
  const originalAdd = window.addEventListener.bind(window)
  const originalClear = window.clearInterval.bind(window)
  const originalRemove = window.removeEventListener.bind(window)
  let rafCaptured: FrameRequestCallback | null = null
  const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
    rafCaptured = cb
    return 7
  })
  const cancelSpy = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {
    if ('rafThrow' in opts) throw opts.rafThrow
  })
  const intervalSpy = vi.spyOn(window, 'setInterval')
  const clearSpy = vi.spyOn(window, 'clearInterval').mockImplementation((id: number | undefined) => {
    if ('clearThrow' in opts) throw opts.clearThrow
    return originalClear(id)
  })
  const addSpy = vi.spyOn(window, 'addEventListener').mockImplementation((type: string, listener: unknown, options?: unknown) => {
    if (type === 'beforeunload' && opts.beforeunloadAddThrow) throw new Error('listener boom')
    return originalAdd(type, listener as EventListenerOrEventListenerObject, options as AddEventListenerOptions | boolean | undefined)
  })
  const removeSpy = vi.spyOn(window, 'removeEventListener').mockImplementation((type: string, listener: unknown, options?: unknown) => {
    if ('removeThrow' in opts) throw opts.removeThrow
    return originalRemove(type, listener as EventListenerOrEventListenerObject, options as boolean | undefined)
  })
  return {
    rafSpy,
    cancelSpy,
    intervalSpy,
    clearSpy,
    addSpy,
    removeSpy,
    getCapturedRaf: () => rafCaptured
  }
}

function setPageHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    value: hidden
  })
  document.dispatchEvent(new Event('visibilitychange'))
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  warmupStores()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  Object.defineProperty(document, 'hidden', { configurable: true, value: false })
})

describe('Phase 3.48 — useGameLoop stop 清理契约', () => {
  type LoopApi = ReturnType<typeof useGameLoop>
  let rafCallback: FrameRequestCallback | null = null
  let rafSpy: ReturnType<typeof vi.spyOn>
  let cafSpy: ReturnType<typeof vi.spyOn>
  let wrapper: VueWrapper | null = null
  let currentLoop: LoopApi | null = null

  const LoopHost = defineComponent({
    props: { callback: { type: Function, required: true } },
    setup(props) {
      currentLoop = useGameLoop(props.callback as (d: number) => void)
      return () => h('div')
    }
  })

  function mountLoop(cb: (d: number) => void) {
    currentLoop = null
    wrapper = mount(LoopHost, { props: { callback: cb } })
    return currentLoop!
  }

  function unmountLoop() {
    wrapper?.unmount()
    wrapper = null
    currentLoop = null
  }

  beforeEach(() => {
    rafCallback = null
    rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(cb => {
      rafCallback = cb as FrameRequestCallback
      return 7
    })
    cafSpy = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {
      rafCallback = null
    })
  })

  afterEach(() => {
    unmountLoop()
  })

  it('stop 正常返回 null', () => {
    const cb = vi.fn()
    const loop = mountLoop(cb)
    loop.start()
    expect(loop.stop()).toBeNull()
    expect(loop.isRunning.value).toBe(false)
  })

  it('cancelAnimationFrame 抛 Error：stop 不外抛、返回原 Error、isRunning false', () => {
    const cb = vi.fn()
    const loop = mountLoop(cb)
    loop.start()
    const err = new Error('cancel boom')
    cafSpy.mockImplementation(() => {
      throw err
    })
    let result: unknown
    let threw = false
    try {
      result = loop.stop()
    } catch {
      threw = true
    }
    expect(threw).toBe(false)
    expect(result).toBe(err)
    expect(loop.isRunning.value).toBe(false)
  })

  it('cancel 抛非 Error：返回原始值', () => {
    const cb = vi.fn()
    const loop = mountLoop(cb)
    loop.start()
    cafSpy.mockImplementation(() => {
      throw 'cancel-string-boom'
    })
    expect(loop.stop()).toBe('cancel-string-boom')
    expect(loop.isRunning.value).toBe(false)
  })

  it('cancel 抛空 message Error：原值返回', () => {
    const cb = vi.fn()
    const loop = mountLoop(cb)
    loop.start()
    const err = new Error('')
    cafSpy.mockImplementation(() => {
      throw err
    })
    expect(loop.stop()).toBe(err)
  })

  it('cancel 失败后重复 stop 不再次取消同一 ID', () => {
    const cb = vi.fn()
    const loop = mountLoop(cb)
    loop.start()
    cafSpy.mockImplementation(() => {
      throw new Error('cancel boom')
    })
    loop.stop()
    expect(cafSpy).toHaveBeenCalledTimes(1)
    // 所有权已释放：第二次 stop 直接返回 null，不再调用 cancel
    expect(loop.stop()).toBeNull()
    expect(cafSpy).toHaveBeenCalledTimes(1)
  })

  it('cancel 失败后执行旧 RAF callback：业务零调用、不安排第二帧', () => {
    const cb = vi.fn()
    const loop = mountLoop(cb)
    loop.start()
    cafSpy.mockImplementation(() => {
      throw new Error('cancel boom')
    })
    loop.stop()
    // cancel 抛错，rafCallback 仍指向旧 tick；但 isRunning 已 false
    const old = rafCallback
    expect(old).not.toBeNull()
    rafCallback = null
    let threw = false
    try {
      old!(1000)
    } catch {
      threw = true
    }
    expect(threw).toBe(false)
    expect(cb).not.toHaveBeenCalled()
    expect(rafSpy).toHaveBeenCalledTimes(1) // 不安排第二帧
  })

  it('cancel 失败后 hidden → visible 不恢复 RAF', () => {
    const cb = vi.fn()
    const loop = mountLoop(cb)
    loop.start()
    cafSpy.mockImplementation(() => {
      throw new Error('cancel boom')
    })
    loop.stop()
    const callsAfterStop = rafSpy.mock.calls.length
    setPageHidden(true)
    setPageHidden(false)
    expect(rafSpy.mock.calls.length).toBe(callsAfterStop)
    expect(loop.isRunning.value).toBe(false)
  })

  it('composable unmount 中 cancel 抛异常不外抛', () => {
    const cb = vi.fn()
    const loop = mountLoop(cb)
    loop.start()
    cafSpy.mockImplementation(() => {
      throw new Error('cancel boom')
    })
    let threw = false
    try {
      unmountLoop()
    } catch {
      threw = true
    }
    expect(threw).toBe(false)
  })

  it('composable visibility listener remove 抛异常不外抛', () => {
    const cb = vi.fn()
    mountLoop(cb)
    vi.spyOn(document, 'removeEventListener').mockImplementation(() => {
      throw new Error('remove boom')
    })
    let threw = false
    try {
      unmountLoop()
    } catch {
      threw = true
    }
    expect(threw).toBe(false)
  })
})

describe('Phase 3.48 — App 单项清理异常（主故障优先）', () => {
  it('frame fault + cancel 抛异常：原 frame reason、interval/listener 仍清理', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    vi.spyOn(gameStore, 'gameLoop').mockImplementation(() => {
      gameStore.battleError = new Error('battle reason')
      return false
    })
    const { cancelSpy, intervalSpy, clearSpy, removeSpy } = spyCleanupResources({ rafThrow: new Error('cancel boom') })

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { handleGameFrame?: (d: number) => void, runtimeStartupError?: string }

    vm.handleGameFrame!(16)
    await nextTick()

    expect(vm.runtimeStartupError).toContain('battle reason')
    expect(vm.runtimeStartupError).not.toContain('runtime cleanup failed')
    expect(cancelSpy).toHaveBeenCalled()
    const runtimeSetIdx = intervalSpy.mock.calls.findIndex(c => c[1] === 1000)
    const runtimeIntervalId = intervalSpy.mock.results[runtimeSetIdx].value
    expect(clearSpy.mock.calls.filter(c => c[0] === runtimeIntervalId).length).toBe(1)
    expect(removeSpy.mock.calls.filter(c => c[0] === 'beforeunload').length).toBe(1)
    wrapper.unmount()
  })

  it('timer fault + clearInterval 抛异常：原 timer reason、listener 仍移除', async () => {
    seedAlive()
    const playerStore = usePlayerStore()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    vi.spyOn(playerStore, 'getExpPerSecond').mockReturnValue(0)
    vi.spyOn(playerStore, 'saveGame').mockReturnValue(false)
    const { cancelSpy, clearSpy, removeSpy } = spyCleanupResources({ clearThrow: new Error('clear boom') })

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { tickTime?: () => void, runtimeStartupError?: string }
    for (let i = 0; i < 30; i++) vm.tickTime!()
    await nextTick()

    expect(vm.runtimeStartupError).toContain('automatic save failed')
    expect(vm.runtimeStartupError).not.toContain('runtime cleanup failed')
    expect(clearSpy).toHaveBeenCalled()
    expect(cancelSpy).toHaveBeenCalled()
    expect(removeSpy.mock.calls.filter(c => c[0] === 'beforeunload').length).toBe(1)
    wrapper.unmount()
  })

  it('beforeunload fault + listener remove 抛异常：原 beforeunload reason、dispatch 不外抛', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    vi.spyOn(usePlayerStore(), 'recordLogout').mockReturnValue(false)
    spyCleanupResources({ removeThrow: new Error('remove boom') })

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { runtimeStartupError?: string }

    let threw = false
    try {
      window.dispatchEvent(new Event('beforeunload'))
    } catch {
      threw = true
    }
    await nextTick()

    expect(threw).toBe(false)
    expect(vm.runtimeStartupError).toBe('beforeunload persistence failed')
    expect(vm.runtimeStartupError).not.toContain('runtime cleanup failed')
    wrapper.unmount()
  })

  it('startup rollback + cancel 抛异常：原 startup reason', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    const { cancelSpy, clearSpy, removeSpy } = spyCleanupResources({
      beforeunloadAddThrow: true,
      rafThrow: new Error('cancel boom')
    })

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { runtimeStartupError?: string }

    expect(vm.runtimeStartupError).toContain('runtime startup failed: listener boom')
    expect(vm.runtimeStartupError).not.toContain('runtime cleanup failed')
    expect(cancelSpy).toHaveBeenCalled()
    expect(clearSpy).toHaveBeenCalled()
    expect(removeSpy).not.toHaveBeenCalled() // listener 注册失败 → 所有权未提交，不执行移除
    wrapper.unmount()
  })

  it('startup rollback + clearInterval 抛异常：原 startup reason', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    const { cancelSpy, clearSpy, removeSpy } = spyCleanupResources({
      beforeunloadAddThrow: true,
      clearThrow: new Error('clear boom')
    })

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { runtimeStartupError?: string }

    expect(vm.runtimeStartupError).toContain('runtime startup failed: listener boom')
    expect(vm.runtimeStartupError).not.toContain('runtime cleanup failed')
    expect(cancelSpy).toHaveBeenCalled()
    expect(clearSpy).toHaveBeenCalled()
    expect(removeSpy).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('startup rollback + listener remove 抛异常：原 startup reason', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    const { cancelSpy, clearSpy, removeSpy } = spyCleanupResources({
      beforeunloadAddThrow: true,
      removeThrow: new Error('remove boom')
    })

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { runtimeStartupError?: string }

    expect(vm.runtimeStartupError).toContain('runtime startup failed: listener boom')
    expect(vm.runtimeStartupError).not.toContain('runtime cleanup failed')
    expect(cancelSpy).toHaveBeenCalled()
    expect(clearSpy).toHaveBeenCalled()
    expect(removeSpy).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})

describe('Phase 3.48 — 所有权与重复调用', () => {
  it('clearInterval 抛异常后重复 stop：不重复 clear 同一 ID（所有权已先释放）', async () => {
    seedAlive()
    const playerStore = usePlayerStore()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    vi.spyOn(playerStore, 'getExpPerSecond').mockReturnValue(0)
    vi.spyOn(playerStore, 'saveGame').mockReturnValue(false)
    const { intervalSpy, clearSpy, removeSpy } = spyCleanupResources({ clearThrow: new Error('clear boom') })

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { tickTime?: () => void }
    for (let i = 0; i < 30; i++) vm.tickTime!()
    await nextTick()
    const runtimeIntervalId = intervalSpy.mock.results[intervalSpy.mock.calls.findIndex(c => c[1] === 1000)].value
    expect(clearSpy.mock.calls.filter(c => c[0] === runtimeIntervalId).length).toBe(1)
    const removeCount = removeSpy.mock.calls.filter(c => c[0] === 'beforeunload').length

    // 重复 shutdown 触发第二次 stopRuntime：所有权已释放，不重复 clear
    wrapper.unmount()
    expect(clearSpy.mock.calls.filter(c => c[0] === runtimeIntervalId).length).toBe(1)
    expect(removeSpy.mock.calls.filter(c => c[0] === 'beforeunload').length).toBe(removeCount)
  })

  it('旧 RAF callback 重放不调用 gameLoop', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    const loopSpy = vi.spyOn(gameStore, 'gameLoop').mockImplementation(() => {
      gameStore.battleError = new Error('battle reason')
      return false
    })
    const { getCapturedRaf, cancelSpy } = spyCleanupResources({ rafThrow: new Error('cancel boom') })

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { handleGameFrame?: (d: number) => void }
    vm.handleGameFrame!(16)
    await nextTick()
    expect(loopSpy).toHaveBeenCalledTimes(1)

    const old = getCapturedRaf()
    expect(old).not.toBeNull()
    let threw = false
    try {
      old!(1000)
    } catch {
      threw = true
    }
    await nextTick()

    expect(threw).toBe(false)
    expect(loopSpy).toHaveBeenCalledTimes(1)
    expect(cancelSpy).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('模拟旧 interval callback 重放：tick 零副作用', async () => {
    seedAlive()
    const playerStore = usePlayerStore()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    vi.spyOn(playerStore, 'getExpPerSecond').mockReturnValue(0)
    vi.spyOn(playerStore, 'saveGame').mockReturnValue(false)
    const updateSpy = vi.spyOn(playerStore, 'updateOnlineTime')
    const addExpSpy = vi.spyOn(playerStore, 'addExperience')
    const saveSpy = vi.spyOn(playerStore, 'saveGame')
    spyCleanupResources({ clearThrow: new Error('clear boom') })

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { tickTime?: () => void }
    for (let i = 0; i < 30; i++) vm.tickTime!()
    await nextTick()
    updateSpy.mockClear()
    addExpSpy.mockClear()
    saveSpy.mockClear()

    vm.tickTime!() // 旧 interval callback 重放
    await nextTick()

    expect(updateSpy).not.toHaveBeenCalled()
    expect(addExpSpy).not.toHaveBeenCalled()
    expect(saveSpy).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('listener 实际残留时再次 dispatch 不调用 recordLogout', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    const logoutSpy = vi.spyOn(usePlayerStore(), 'recordLogout').mockReturnValue(false)
    spyCleanupResources({ removeThrow: new Error('remove boom') })

    const wrapper = mountApp()
    await nextTick()
    window.dispatchEvent(new Event('beforeunload')) // 第一次 → fault，remove 抛错 → listener 可能残留
    await nextTick()
    expect(logoutSpy).toHaveBeenCalledTimes(1)

    window.dispatchEvent(new Event('beforeunload')) // 残留 listener 再次触发 → ready guard no-op
    await nextTick()
    expect(logoutSpy).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })
})

describe('Phase 3.48 — 正常 shutdown 清理异常', () => {
  it('cancel 失败：真实 unmount 不外抛、reason runtime cleanup failed、saveGame 一次', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    const saveSpy = vi.spyOn(usePlayerStore(), 'saveGame').mockReturnValue(true)
    const { cancelSpy, intervalSpy, clearSpy, removeSpy } = spyCleanupResources({ rafThrow: new Error('cancel boom') })

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { runtimeStartupError?: string }

    // 真实 wrapper.unmount()：App onBeforeUnmount 先于 composable onUnmounted，捕获 RAF cancel 错误
    let threw = false
    try {
      wrapper.unmount()
    } catch {
      threw = true
    }

    expect(threw).toBe(false)
    expect(vm.runtimeStartupError).toBe('runtime cleanup failed: cancel boom')
    expect(saveSpy).toHaveBeenCalledTimes(1)
    expect(cancelSpy.mock.calls.filter(c => c[0] === 7).length).toBe(1) // composable 后续 teardown 不重复 cancel
    const runtimeSetIdx = intervalSpy.mock.calls.findIndex(c => c[1] === 1000)
    expect(runtimeSetIdx).toBeGreaterThanOrEqual(0)
    const runtimeIntervalId = intervalSpy.mock.results[runtimeSetIdx].value
    expect(clearSpy.mock.calls.filter(c => c[0] === runtimeIntervalId).length).toBe(1)
    expect(removeSpy.mock.calls.filter(c => c[0] === 'beforeunload').length).toBe(1)
  })

  it('clearInterval 失败：cleanup reason 正确、saveGame 一次', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    const saveSpy = vi.spyOn(usePlayerStore(), 'saveGame').mockReturnValue(true)
    spyCleanupResources({ clearThrow: new Error('clear boom') })

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { runtimeStartupError?: string }

    wrapper.unmount()

    expect(vm.runtimeStartupError).toBe('runtime cleanup failed: clear boom')
    expect(saveSpy).toHaveBeenCalledTimes(1)
  })

  it('listener remove 失败：cleanup reason 正确、saveGame 一次', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    const saveSpy = vi.spyOn(usePlayerStore(), 'saveGame').mockReturnValue(true)
    spyCleanupResources({ removeThrow: new Error('remove boom') })

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { runtimeStartupError?: string }

    wrapper.unmount()

    expect(vm.runtimeStartupError).toBe('runtime cleanup failed: remove boom')
    expect(saveSpy).toHaveBeenCalledTimes(1)
  })

  it('cleanup 抛非 Error：String 规范化（真实 unmount）', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    vi.spyOn(usePlayerStore(), 'saveGame').mockReturnValue(true)
    spyCleanupResources({ rafThrow: 'clear-string-boom' })

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { runtimeStartupError?: string }

    wrapper.unmount()

    expect(vm.runtimeStartupError).toBe('runtime cleanup failed: clear-string-boom')
  })

  it('cleanup 抛空 message：无尾随冒号（真实 unmount）', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    vi.spyOn(usePlayerStore(), 'saveGame').mockReturnValue(true)
    spyCleanupResources({ rafThrow: new Error('') })

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { runtimeStartupError?: string }

    wrapper.unmount()

    expect(vm.runtimeStartupError).toBe('runtime cleanup failed')
    expect(vm.runtimeStartupError).not.toContain('runtime cleanup failed:')
  })

  it('cleanup 失败且 saveGame false：cleanup reason 保持、save 一次、不显示 shutdown save reason', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    const saveSpy = vi.spyOn(usePlayerStore(), 'saveGame').mockReturnValue(false)
    spyCleanupResources({ rafThrow: new Error('cancel boom') })

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { runtimeStartupError?: string }

    wrapper.unmount()

    expect(saveSpy).toHaveBeenCalledTimes(1)
    expect(vm.runtimeStartupError).toBe('runtime cleanup failed: cancel boom')
    expect(vm.runtimeStartupError).not.toContain('shutdown save failed')
  })

  it('cleanup 失败且 saveGame 抛异常：unmount 不外抛、cleanup reason 保持、save 一次', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    const saveSpy = vi.spyOn(usePlayerStore(), 'saveGame').mockImplementation(() => {
      throw new Error('save boom')
    })
    spyCleanupResources({ rafThrow: new Error('cancel boom') })

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
    expect(vm.runtimeStartupError).toBe('runtime cleanup failed: cancel boom')
  })

  it('cleanup 全部成功：Phase 3.46 正常 shutdown 语义不回归', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    const saveSpy = vi.spyOn(usePlayerStore(), 'saveGame').mockReturnValue(true)
    const { cancelSpy, intervalSpy, clearSpy, removeSpy } = spyCleanupResources()

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { runtimeStartupStatus?: string, runtimeStartupError?: string }

    wrapper.unmount()

    expect(vm.runtimeStartupStatus).toBe('ready')
    expect(vm.runtimeStartupError).toBe('')
    expect(saveSpy).toHaveBeenCalledTimes(1)
    const runtimeIntervalId = intervalSpy.mock.results[intervalSpy.mock.calls.findIndex(c => c[1] === 1000)].value
    expect(cancelSpy.mock.calls.filter(c => c[0] === 7).length).toBe(1)
    expect(clearSpy.mock.calls.filter(c => c[0] === runtimeIntervalId).length).toBe(1)
    expect(removeSpy.mock.calls.filter(c => c[0] === 'beforeunload').length).toBe(1)
  })
})

describe('Phase 3.48 — 多重清理异常', () => {
  it('RAF、interval、listener 都抛：全部尝试、每项一次、第一条 RAF 错误被分类（真实 unmount）', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    const saveSpy = vi.spyOn(usePlayerStore(), 'saveGame').mockReturnValue(true)
    const { cancelSpy, intervalSpy, clearSpy, removeSpy } = spyCleanupResources({
      rafThrow: new Error('raf boom'),
      clearThrow: new Error('clear boom'),
      removeThrow: new Error('remove boom')
    })

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { runtimeStartupError?: string }

    // 真实 wrapper.unmount()：三条清理均尝试一次，RAF 错误成为第一条
    wrapper.unmount()

    expect(vm.runtimeStartupError).toBe('runtime cleanup failed: raf boom')
    expect(saveSpy).toHaveBeenCalledTimes(1)
    expect(cancelSpy.mock.calls.filter(c => c[0] === 7).length).toBe(1)
    const runtimeSetIdx = intervalSpy.mock.calls.findIndex(c => c[1] === 1000)
    const runtimeIntervalId = intervalSpy.mock.results[runtimeSetIdx].value
    expect(clearSpy.mock.calls.filter(c => c[0] === runtimeIntervalId).length).toBe(1)
    expect(removeSpy.mock.calls.filter(c => c[0] === 'beforeunload').length).toBe(1)
  })

  it('interval、listener 都抛：listener 仍尝试、interval 错误被分类', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    const saveSpy = vi.spyOn(usePlayerStore(), 'saveGame').mockReturnValue(true)
    const { cancelSpy, intervalSpy, clearSpy, removeSpy } = spyCleanupResources({
      clearThrow: new Error('clear boom'),
      removeThrow: new Error('remove boom')
    })

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { runtimeStartupError?: string }

    wrapper.unmount()

    expect(vm.runtimeStartupError).toBe('runtime cleanup failed: clear boom')
    expect(saveSpy).toHaveBeenCalledTimes(1)
    expect(cancelSpy.mock.calls.filter(c => c[0] === 7).length).toBe(1)
    const runtimeIntervalId = intervalSpy.mock.results[intervalSpy.mock.calls.findIndex(c => c[1] === 1000)].value
    expect(clearSpy.mock.calls.filter(c => c[0] === runtimeIntervalId).length).toBe(1)
    expect(removeSpy.mock.calls.filter(c => c[0] === 'beforeunload').length).toBe(1)
  })

  it('cleanup fault 后重复 shutdown：不重复清理、不重复保存、reason 不变', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    const saveSpy = vi.spyOn(usePlayerStore(), 'saveGame').mockReturnValue(true)
    const { intervalSpy, clearSpy, removeSpy } = spyCleanupResources({ clearThrow: new Error('clear boom') })

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { shutdownAppRuntime?: () => void, runtimeStartupError?: string }

    wrapper.unmount()
    expect(saveSpy).toHaveBeenCalledTimes(1)
    const runtimeIntervalId = intervalSpy.mock.results[intervalSpy.mock.calls.findIndex(c => c[1] === 1000)].value
    const clearCount = clearSpy.mock.calls.filter(c => c[0] === runtimeIntervalId).length
    const removeCount = removeSpy.mock.calls.filter(c => c[0] === 'beforeunload').length

    saveSpy.mockClear()
    vm.shutdownAppRuntime!()

    expect(saveSpy).not.toHaveBeenCalled()
    expect(clearSpy.mock.calls.filter(c => c[0] === runtimeIntervalId).length).toBe(clearCount)
    expect(removeSpy.mock.calls.filter(c => c[0] === 'beforeunload').length).toBe(removeCount)
    expect(vm.runtimeStartupError).toBe('runtime cleanup failed: clear boom')
  })
})

describe('Phase 3.48 — 架构护栏', () => {
  const ROOT = process.cwd()

  it('护栏：useGameLoop stop 在 cancel 前清除运行许可、状态和 RAF ID', () => {
    const src = readFileSync(resolve(ROOT, 'src/composables/useGameLoop.ts'), 'utf8')
    const stopM = src.match(/function stop\(\):\s*unknown \| null\s*\{[\s\S]*?\n  \}/)
    expect(stopM).toBeTruthy()
    const stopBody = stopM![0]
    const cancelIdx = stopBody.indexOf('cancelFrameLoop()')
    expect(stopBody.indexOf('shouldRun = false')).toBeGreaterThan(-1)
    expect(stopBody.indexOf('isRunning.value = false')).toBeGreaterThan(-1)
    expect(stopBody.indexOf('lastTimestamp = 0')).toBeGreaterThan(-1)
    expect(stopBody.indexOf('shouldRun = false')).toBeLessThan(cancelIdx)
    expect(stopBody.indexOf('isRunning.value = false')).toBeLessThan(cancelIdx)
    expect(stopBody.indexOf('lastTimestamp = 0')).toBeLessThan(cancelIdx)

    // cancelFrameLoop 在外部取消 API 前清除 RAF ID（ownership-first）
    const cancelM = src.match(/function cancelFrameLoop\(\):\s*unknown \| null\s*\{[\s\S]*?\n  \}/)
    expect(cancelM).toBeTruthy()
    const cancelBody = cancelM![0]
    expect(cancelBody.indexOf('animationFrameId = null')).toBeLessThan(cancelBody.indexOf('cancelAnimationFrame('))
  })

  it('护栏：App interval ID 在 clear 前置空、listener flag 在 remove 前清除', () => {
    const src = readFileSync(resolve(ROOT, 'src/App.vue'), 'utf8')
    const m = src.match(/function stopRuntime\(\):\s*unknown \| null\s*\{[\s\S]*?\n\}/)
    expect(m).toBeTruthy()
    const body = m![0]
    const clearIdx = body.indexOf('clearInterval(')
    const removeIdx = body.indexOf('removeEventListener(')
    expect(body.indexOf('timeIntervalId = null')).toBeLessThan(clearIdx)
    expect(body.indexOf('beforeUnloadRegistered = false')).toBeLessThan(removeIdx)
  })

  it('护栏：stopRuntime 每个资源拥有独立 try/catch 并返回第一条错误，不调用 enterRuntimeFault', () => {
    const src = readFileSync(resolve(ROOT, 'src/App.vue'), 'utf8')
    const m = src.match(/function stopRuntime\(\):\s*unknown \| null\s*\{[\s\S]*?\n\}/)
    expect(m).toBeTruthy()
    const body = m![0]
    expect((body.match(/\} catch \(error\) \{/g) || []).length).toBe(3)
    expect(body).toContain('return firstError')
    expect(body).not.toContain('enterRuntimeFault')
    expect(body).not.toContain('saveGame')
    expect(body).not.toContain('recordLogout')
  })

  it('护栏：shutdown 使用 runtime cleanup failed，并在 cleanup 后按原 ready 快照保存', () => {
    const src = readFileSync(resolve(ROOT, 'src/App.vue'), 'utf8')
    const m = src.match(/function shutdownAppRuntime\(\)\s*\{[\s\S]*?\n\}/)
    expect(m).toBeTruthy()
    const body = m![0]
    expect(body).toContain("formatRuntimeFault('runtime cleanup failed'")
    expect(body.indexOf("const shouldSave = runtimeStartupStatus.value === 'ready'")).toBeLessThan(body.indexOf('stopRuntime()'))
    expect(body.indexOf('playerStore.saveGame()')).toBeGreaterThan(body.indexOf('stopRuntime()'))
  })

  it('护栏：enterRuntimeFault 忽略 cleanup 返回值并保留先写 status/reason 的顺序', () => {
    const src = readFileSync(resolve(ROOT, 'src/App.vue'), 'utf8')
    const m = src.match(/function enterRuntimeFault\(reason: string\)\s*\{[\s\S]*?\n\}/)
    expect(m).toBeTruthy()
    const body = m![0]
    expect(body).toContain("runtimeStartupStatus.value = 'faulted'")
    expect(body).toContain('runtimeStartupError.value = reason')
    const stopIdx = body.indexOf('stopRuntime()')
    expect(body.indexOf("runtimeStartupStatus.value = 'faulted'")).toBeLessThan(stopIdx)
    expect(body.indexOf('runtimeStartupError.value = reason')).toBeLessThan(stopIdx)
  })

  it('护栏：App 使用单一 onBeforeUnmount 委托 shutdown，且不再保留 onUnmounted shutdown 委托', () => {
    const src = readFileSync(resolve(ROOT, 'src/App.vue'), 'utf8')
    const hooks = src.match(/on(BeforeUnmount|Unmounted)\(\(\) => \{/g) || []
    expect(hooks.length).toBe(1)
    expect(hooks[0]).toBe('onBeforeUnmount(() => {')
    const before = src.match(/onBeforeUnmount\(\(\) => \{[\s\S]*?\n\}\)/)
    expect(before).toBeTruthy()
    expect(before![0]).toContain('shutdownAppRuntime()')
    expect(before![0]).not.toContain('saveGame')
    expect(before![0]).not.toContain('stopRuntime(')
  })

  it('护栏：useGameLoop 继续使用自己的 onUnmounted 做 composable 私有清理', () => {
    const src = readFileSync(resolve(ROOT, 'src/composables/useGameLoop.ts'), 'utf8')
    expect(src).toMatch(/onUnmounted\(\(\) => \{/)
  })
})
