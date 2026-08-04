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
 * Phase 3.49 — 游戏循环 RAF 调度与页面可见性故障熔断。
 *
 * - 异步 visibility / 帧末调度失败不向事件或 RAF callback 外抛，统一通知 onLifecycleFault
 *   （App 分类为 game loop lifecycle failed）。
 * - 取消/恢复均「先提交内部安全状态、再最佳努力调用浏览器 API」。
 * - 首次启动的资源安装失败（visibility listener 注册 / 首次 request）仍由 startRuntimeOnce
 *   分类为 runtime startup failed，不走运行期 lifecycle callback。
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
 * App 级资源 spy：rafCallThrowAt 在第 N 次 requestAnimationFrame 调用抛 Error('request boom')；
 * cancelThrow/clearThrow/removeThrow 对应清理 API 抛该值；visibilityAddThrow 让
 * visibilitychange 注册抛 Error('vis add boom')。捕获真实 rAF callback 与 visibility listener。
 */
function spyAppResources(opts: {
  rafCallThrowAt?: number
  cancelThrow?: unknown
  clearThrow?: unknown
  removeThrow?: unknown
  visibilityAddThrow?: boolean
} = {}) {
  let rafCalls = 0
  let rafCaptured: FrameRequestCallback | null = null
  let visListener: EventListener | null = null
  const originalWinClear = window.clearInterval.bind(window)
  const originalWinRemove = window.removeEventListener.bind(window)
  const originalDocAdd = document.addEventListener.bind(document)
  const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
    rafCalls++
    if (opts.rafCallThrowAt !== undefined && rafCalls >= opts.rafCallThrowAt) {
      throw new Error('request boom')
    }
    rafCaptured = cb
    return 7
  })
  const cancelSpy = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {
    if ('cancelThrow' in opts) throw opts.cancelThrow
  })
  const intervalSpy = vi.spyOn(window, 'setInterval')
  const clearSpy = vi.spyOn(window, 'clearInterval').mockImplementation((id: number | undefined) => {
    if ('clearThrow' in opts) throw opts.clearThrow
    return originalWinClear(id)
  })
  const addSpy = vi.spyOn(window, 'addEventListener')
  const removeSpy = vi.spyOn(window, 'removeEventListener').mockImplementation((type: string, listener: unknown, options?: unknown) => {
    if ('removeThrow' in opts) throw opts.removeThrow
    return originalWinRemove(type, listener as EventListenerOrEventListenerObject, options as boolean | undefined)
  })
  const docAddSpy = vi.spyOn(document, 'addEventListener').mockImplementation((type: string, listener: unknown, options?: unknown) => {
    if (type === 'visibilitychange') {
      visListener = listener as EventListener
      if (opts.visibilityAddThrow) throw new Error('vis add boom')
    }
    return originalDocAdd(type, listener as EventListenerOrEventListenerObject, options as AddEventListenerOptions | boolean | undefined)
  })
  const docRemoveSpy = vi.spyOn(document, 'removeEventListener')
  const dispatchVisible = (hidden: boolean) => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: hidden })
    document.dispatchEvent(new Event('visibilitychange'))
  }
  return {
    rafSpy,
    cancelSpy,
    intervalSpy,
    clearSpy,
    addSpy,
    removeSpy,
    docAddSpy,
    docRemoveSpy,
    getCapturedRaf: () => rafCaptured,
    getVisListener: () => visListener,
    dispatchVisible
  }
}

function intervalCount(intervalSpy: { mock: { calls: unknown[][] } }, delay: number) {
  return intervalSpy.mock.calls.filter(c => c[1] === delay).length
}

function beforeunloadCount(addSpy: { mock: { calls: unknown[][] } }) {
  return addSpy.mock.calls.filter(c => c[0] === 'beforeunload').length
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

describe('Phase 3.49 — useGameLoop 生命周期 fault（composable 级）', () => {
  type LoopApi = ReturnType<typeof useGameLoop>
  let currentLoop: LoopApi | null = null
  let rafCallback: FrameRequestCallback | null = null
  let rafSpy: ReturnType<typeof vi.spyOn>
  let cafSpy: ReturnType<typeof vi.spyOn>
  let wrapper: VueWrapper | null = null

  const LoopHost = defineComponent({
    props: {
      callback: { type: Function, required: true },
      onFault: { type: Function, required: false }
    },
    setup(props) {
      currentLoop = useGameLoop(
        props.callback as (d: number) => void,
        props.onFault as ((e: unknown) => void) | undefined
      )
      return () => h('div')
    }
  })

  function mountLoop(cb: (d: number) => void, onFault?: (e: unknown) => void) {
    currentLoop = null
    const props: { callback: (d: number) => void; onFault?: (e: unknown) => void } = { callback: cb }
    if (onFault) props.onFault = onFault
    wrapper = mount(LoopHost, { props })
    return currentLoop!
  }

  function unmountLoop() {
    wrapper?.unmount()
    wrapper = null
    currentLoop = null
  }

  function setPageHidden(hidden: boolean) {
    Object.defineProperty(document, 'hidden', { configurable: true, value: hidden })
    document.dispatchEvent(new Event('visibilitychange'))
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

  it('visibility addEventListener 抛 Error 时 Vue mount/setup 不抛', () => {
    const originalAdd = document.addEventListener.bind(document)
    vi.spyOn(document, 'addEventListener').mockImplementation((type: string, listener: unknown, options?: unknown) => {
      if (type === 'visibilitychange') throw new Error('vis add boom')
      return originalAdd(type, listener as EventListenerOrEventListenerObject, options as AddEventListenerOptions | boolean | undefined)
    })
    const cb = vi.fn()
    const faultSpy = vi.fn()
    let threw = false
    try {
      mountLoop(cb, faultSpy)
    } catch {
      threw = true
    }
    expect(threw).toBe(false)
  })

  it('注册失败后首次 start 抛原始 Error', () => {
    const err = new Error('vis add boom')
    const originalAdd = document.addEventListener.bind(document)
    vi.spyOn(document, 'addEventListener').mockImplementation((type: string, listener: unknown, options?: unknown) => {
      if (type === 'visibilitychange') throw err
      return originalAdd(type, listener as EventListenerOrEventListenerObject, options as AddEventListenerOptions | boolean | undefined)
    })
    const cb = vi.fn()
    const faultSpy = vi.fn()
    const loop = mountLoop(cb, faultSpy)
    let thrown: unknown = null
    try {
      loop.start()
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBe(err)
    expect(faultSpy).not.toHaveBeenCalled()
  })

  it('注册成功时只注册一次 visibilitychange', () => {
    const addSpy = vi.spyOn(document, 'addEventListener')
    const cb = vi.fn()
    const loop = mountLoop(cb)
    loop.start()
    expect(addSpy.mock.calls.filter(c => c[0] === 'visibilitychange').length).toBe(1)
  })

  it('unmount 仅移除已注册 listener、引用完全一致', () => {
    const originalAdd = document.addEventListener.bind(document)
    let captured: EventListener | null = null
    vi.spyOn(document, 'addEventListener').mockImplementation((type: string, listener: unknown, options?: unknown) => {
      if (type === 'visibilitychange') captured = listener as EventListener
      return originalAdd(type, listener as EventListenerOrEventListenerObject, options as AddEventListenerOptions | boolean | undefined)
    })
    const removeSpy = vi.spyOn(document, 'removeEventListener')
    const cb = vi.fn()
    mountLoop(cb)
    unmountLoop()
    expect(removeSpy.mock.calls.filter(c => c[0] === 'visibilitychange' && c[1] === captured).length).toBe(1)
  })

  it('remove 失败不外抛且 ownership 已先清除', () => {
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

  it('hidden cancel Error：dispatch 不抛、lifecycle callback 一次、isRunning false', () => {
    const cb = vi.fn()
    const faultSpy = vi.fn()
    const loop = mountLoop(cb, faultSpy)
    loop.start()
    cafSpy.mockImplementation(() => {
      throw new Error('cancel boom')
    })
    let threw = false
    try {
      setPageHidden(true)
    } catch {
      threw = true
    }
    expect(threw).toBe(false)
    expect(faultSpy).toHaveBeenCalledTimes(1)
    expect(faultSpy.mock.calls[0][0]).toBeInstanceOf(Error)
    expect(loop.isRunning.value).toBe(false)
  })

  it('hidden cancel 抛非 Error：通知原始值', () => {
    const cb = vi.fn()
    const faultSpy = vi.fn()
    const loop = mountLoop(cb, faultSpy)
    loop.start()
    cafSpy.mockImplementation(() => {
      throw 'cancel-string-boom'
    })
    setPageHidden(true)
    expect(faultSpy).toHaveBeenCalledTimes(1)
    expect(faultSpy.mock.calls[0][0]).toBe('cancel-string-boom')
    expect(loop.isRunning.value).toBe(false)
  })

  it('hidden cancel 抛空 message Error：通知原 Error', () => {
    const cb = vi.fn()
    const faultSpy = vi.fn()
    const loop = mountLoop(cb, faultSpy)
    loop.start()
    const err = new Error('')
    cafSpy.mockImplementation(() => {
      throw err
    })
    setPageHidden(true)
    expect(faultSpy).toHaveBeenCalledTimes(1)
    expect(faultSpy.mock.calls[0][0]).toBe(err)
    expect(loop.isRunning.value).toBe(false)
  })

  it('cancel 前 RAF ID 已释放：重复 hidden 不重复取消同一 ID', () => {
    const cb = vi.fn()
    const faultSpy = vi.fn()
    const loop = mountLoop(cb, faultSpy)
    loop.start()
    cafSpy.mockImplementation(() => {
      throw new Error('cancel boom')
    })
    setPageHidden(true) // 第一次：cancel 抛错但 ownership 已释放
    expect(cafSpy).toHaveBeenCalledTimes(1)
    setPageHidden(true) // 第二次：frameId null，不再次 cancel
    expect(cafSpy).toHaveBeenCalledTimes(1)
    expect(faultSpy).toHaveBeenCalledTimes(1) // 首错后 shouldRun 已清除
  })

  it('cancel 失败后旧 RAF callback 业务零调用', () => {
    const cb = vi.fn()
    const faultSpy = vi.fn()
    const loop = mountLoop(cb, faultSpy)
    loop.start()
    cafSpy.mockImplementation(() => {
      throw new Error('cancel boom')
    })
    setPageHidden(true)
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
    expect(cb).not.toHaveBeenCalled() // isRunning false → tick 首行返回
  })

  it('cancel 失败后 visible 不恢复', () => {
    const cb = vi.fn()
    const faultSpy = vi.fn()
    const loop = mountLoop(cb, faultSpy)
    loop.start()
    cafSpy.mockImplementation(() => {
      throw new Error('cancel boom')
    })
    setPageHidden(true)
    const callsAfterFault = rafSpy.mock.calls.length
    setPageHidden(false)
    expect(rafSpy.mock.calls.length).toBe(callsAfterFault)
    expect(loop.isRunning.value).toBe(false)
  })

  it('正常 hidden→visible 仍恢复一条 RAF', () => {
    const cb = vi.fn()
    const loop = mountLoop(cb)
    loop.start()
    setPageHidden(true)
    const callsAfterHidden = rafSpy.mock.calls.length
    setPageHidden(false)
    expect(rafSpy.mock.calls.length).toBe(callsAfterHidden + 1)
    expect(loop.isRunning.value).toBe(true)
  })

  it('visible request Error：dispatch 不抛、lifecycle callback 一次、isRunning false', () => {
    const cb = vi.fn()
    const faultSpy = vi.fn()
    const loop = mountLoop(cb, faultSpy)
    loop.start()
    setPageHidden(true) // suspend 正常
    rafSpy.mockImplementation(() => {
      throw new Error('request boom')
    })
    let threw = false
    try {
      setPageHidden(false) // visible → resume → request 抛错
    } catch {
      threw = true
    }
    expect(threw).toBe(false)
    expect(faultSpy).toHaveBeenCalledTimes(1)
    expect(faultSpy.mock.calls[0][0]).toBeInstanceOf(Error)
    expect(loop.isRunning.value).toBe(false)
  })

  it('visible request 抛非 Error：通知原始值', () => {
    const cb = vi.fn()
    const faultSpy = vi.fn()
    const loop = mountLoop(cb, faultSpy)
    loop.start()
    setPageHidden(true)
    rafSpy.mockImplementation(() => {
      throw 'raf-string-boom'
    })
    setPageHidden(false)
    expect(faultSpy).toHaveBeenCalledTimes(1)
    expect(faultSpy.mock.calls[0][0]).toBe('raf-string-boom')
    expect(loop.isRunning.value).toBe(false)
  })

  it('visible request 失败后重复 visible 不重试', () => {
    const cb = vi.fn()
    const faultSpy = vi.fn()
    const loop = mountLoop(cb, faultSpy)
    loop.start()
    setPageHidden(true)
    rafSpy.mockImplementation(() => {
      throw new Error('request boom')
    })
    setPageHidden(false) // fault：shouldRun 清除
    const callsAfterFault = rafSpy.mock.calls.length
    setPageHidden(true)
    setPageHidden(false)
    expect(rafSpy.mock.calls.length).toBe(callsAfterFault)
    expect(faultSpy).toHaveBeenCalledTimes(1)
  })

  it('stop 正常返回 null，不调用 lifecycle callback', () => {
    const cb = vi.fn()
    const faultSpy = vi.fn()
    const loop = mountLoop(cb, faultSpy)
    loop.start()
    expect(loop.stop()).toBeNull()
    expect(faultSpy).not.toHaveBeenCalled()
  })

  it('stop 返回 cleanup error，不调用 lifecycle callback', () => {
    const cb = vi.fn()
    const faultSpy = vi.fn()
    const loop = mountLoop(cb, faultSpy)
    loop.start()
    const err = new Error('cancel boom')
    cafSpy.mockImplementation(() => {
      throw err
    })
    expect(loop.stop()).toBe(err)
    expect(faultSpy).not.toHaveBeenCalled()
  })

  it('pause cancel 失败不外抛、状态停止', () => {
    const cb = vi.fn()
    const loop = mountLoop(cb)
    loop.start()
    cafSpy.mockImplementation(() => {
      throw new Error('cancel boom')
    })
    let threw = false
    try {
      loop.pause()
    } catch {
      threw = true
    }
    expect(threw).toBe(false)
    expect(loop.isRunning.value).toBe(false)
  })
})

describe('Phase 3.49 — App 级故障分类', () => {
  it('visibility 注册失败：App mount 不抛、faulted、reason runtime startup failed、零资源', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    const { rafSpy, intervalSpy, addSpy } = spyAppResources({ visibilityAddThrow: true })

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { runtimeStartupError?: string }

    expect(vm.runtimeStartupError).toContain('runtime startup failed: vis add boom')
    expect(vm.runtimeStartupError).not.toContain('game loop lifecycle failed')
    expect(rafSpy).not.toHaveBeenCalled()
    expect(intervalCount(intervalSpy, 1000)).toBe(0)
    expect(beforeunloadCount(addSpy)).toBe(0)
    expect(wrapper.find('.offline-reward-stub').exists()).toBe(false)
    wrapper.unmount()
  })

  it('hidden cancel Error：App 精确 lifecycle reason、清理 interval/listener、battleError 不变', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    const { intervalSpy, clearSpy, removeSpy, dispatchVisible } = spyAppResources({ cancelThrow: new Error('cancel boom') })

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { runtimeStartupError?: string }

    let threw = false
    try {
      dispatchVisible(true)
    } catch {
      threw = true
    }
    await nextTick()

    expect(threw).toBe(false)
    expect(vm.runtimeStartupError).toBe('game loop lifecycle failed: cancel boom')
    expect(gameStore.battleError).toBeNull()
    const runtimeSetIdx = intervalSpy.mock.calls.findIndex(c => c[1] === 1000)
    const runtimeIntervalId = intervalSpy.mock.results[runtimeSetIdx].value
    expect(clearSpy.mock.calls.filter(c => c[0] === runtimeIntervalId).length).toBe(1)
    expect(removeSpy.mock.calls.filter(c => c[0] === 'beforeunload').length).toBe(1)
    wrapper.unmount()
  })

  it('hidden cancel 非 Error：String 规范化分类', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    const { dispatchVisible } = spyAppResources({ cancelThrow: 'cancel-string-boom' })

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { runtimeStartupError?: string }

    dispatchVisible(true)
    await nextTick()

    expect(vm.runtimeStartupError).toBe('game loop lifecycle failed: cancel-string-boom')
    wrapper.unmount()
  })

  it('hidden cancel 空 Error：无尾随冒号', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    const { dispatchVisible } = spyAppResources({ cancelThrow: new Error('') })

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { runtimeStartupError?: string }

    dispatchVisible(true)
    await nextTick()

    expect(vm.runtimeStartupError).toBe('game loop lifecycle failed')
    expect(vm.runtimeStartupError).not.toContain('game loop lifecycle failed:')
    wrapper.unmount()
  })

  it('visible request Error：App fault reason 精确', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    const { dispatchVisible } = spyAppResources({ rafCallThrowAt: 2 })

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { runtimeStartupError?: string }

    dispatchVisible(true) // 正常挂起
    let threw = false
    try {
      dispatchVisible(false) // 恢复 → request 抛错
    } catch {
      threw = true
    }
    await nextTick()

    expect(threw).toBe(false)
    expect(vm.runtimeStartupError).toBe('game loop lifecycle failed: request boom')
    wrapper.unmount()
  })

  it('帧业务成功后下一帧 request 抛 Error：RAF callback 不抛、gameLoop 一次、lifecycle fault 一次', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    const loopSpy = vi.spyOn(gameStore, 'gameLoop').mockReturnValue(true)
    const { rafSpy, getCapturedRaf } = spyAppResources({ rafCallThrowAt: 2 })

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { runtimeStartupError?: string }

    const old = getCapturedRaf()
    expect(old).not.toBeNull()
    let threw = false
    try {
      old!(1000) // 真实 tick：业务成功后请求下一帧抛错
    } catch {
      threw = true
    }
    await nextTick()

    expect(threw).toBe(false)
    expect(loopSpy).toHaveBeenCalledTimes(1)
    expect(vm.runtimeStartupError).toBe('game loop lifecycle failed: request boom')
    expect(rafSpy.mock.calls.length).toBe(2) // 初次 + 帧末尝试（失败）
    wrapper.unmount()
  })

  it('handleGameFrame 已 faulted 时不再请求下一帧', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    vi.spyOn(gameStore, 'gameLoop').mockImplementation(() => {
      gameStore.battleError = new Error('battle reason')
      return false
    })
    const { rafSpy, getCapturedRaf } = spyAppResources()

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { runtimeStartupError?: string }

    getCapturedRaf()!(1000) // tick → gameLoop false → fault → stop
    await nextTick()

    expect(vm.runtimeStartupError).toContain('battle reason')
    expect(rafSpy.mock.calls.length).toBe(1) // 不请求下一帧
    wrapper.unmount()
  })

  it('startup 初次 RAF request 失败仍分类为 runtime startup failed', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    const { intervalSpy, addSpy } = spyAppResources({ rafCallThrowAt: 1 })

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { runtimeStartupError?: string }

    expect(vm.runtimeStartupError).toBe('runtime startup failed: request boom')
    expect(vm.runtimeStartupError).not.toContain('game loop lifecycle failed')
    expect(intervalCount(intervalSpy, 1000)).toBe(0)
    expect(beforeunloadCount(addSpy)).toBe(0)
    wrapper.unmount()
  })

  it('正常 shutdown cleanup error 仍分类为 runtime cleanup failed（真实 unmount）', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    const saveSpy = vi.spyOn(usePlayerStore(), 'saveGame').mockReturnValue(true)
    spyAppResources({ cancelThrow: new Error('cancel boom') })

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { runtimeStartupError?: string }

    wrapper.unmount()

    expect(vm.runtimeStartupError).toBe('runtime cleanup failed: cancel boom')
    expect(saveSpy).toHaveBeenCalledTimes(1)
  })
})

describe('Phase 3.49 — 架构护栏', () => {
  const ROOT = process.cwd()

  it('护栏：cancelFrameLoop 在外部 API 前清除 RAF ID', () => {
    const src = readFileSync(resolve(ROOT, 'src/composables/useGameLoop.ts'), 'utf8')
    const m = src.match(/function cancelFrameLoop\(\):\s*unknown \| null\s*\{[\s\S]*?\n  \}/)
    expect(m).toBeTruthy()
    const body = m![0]
    expect(body.indexOf('animationFrameId = null')).toBeLessThan(body.indexOf('cancelAnimationFrame('))
  })

  it('护栏：suspend 在 cancel 前设置 isRunning false', () => {
    const src = readFileSync(resolve(ROOT, 'src/composables/useGameLoop.ts'), 'utf8')
    const m = src.match(/function suspendFrameLoop\(\):\s*unknown \| null\s*\{[\s\S]*?\n  \}/)
    expect(m).toBeTruthy()
    const body = m![0]
    expect(body.indexOf('isRunning.value = false')).toBeLessThan(body.indexOf('cancelFrameLoop()'))
  })

  it('护栏：resume 成功后才提交 isRunning/RAF ownership', () => {
    const src = readFileSync(resolve(ROOT, 'src/composables/useGameLoop.ts'), 'utf8')
    const m = src.match(/function resumeFrameLoop\(\):\s*unknown \| null\s*\{[\s\S]*?\n  \}/)
    expect(m).toBeTruthy()
    const body = m![0]
    const rafIdx = body.indexOf('requestAnimationFrame(tick)')
    expect(body.indexOf('animationFrameId = frameId')).toBeGreaterThan(rafIdx)
    expect(body.indexOf('isRunning.value = true')).toBeGreaterThan(rafIdx)
  })

  it('护栏：tick 的后续 request 有 try/catch', () => {
    const src = readFileSync(resolve(ROOT, 'src/composables/useGameLoop.ts'), 'utf8')
    const m = src.match(/function tick\(timestamp: number\)\s*\{[\s\S]*?\n  \}/)
    expect(m).toBeTruthy()
    const body = m![0]
    expect(body).toContain('requestAnimationFrame(tick)')
    expect(body).toContain('} catch (error) {')
  })

  it('护栏：useGameLoop fault callback 不在 stop/unmount 路径调用', () => {
    const src = readFileSync(resolve(ROOT, 'src/composables/useGameLoop.ts'), 'utf8')
    const stopM = src.match(/function stop\(\):\s*unknown \| null\s*\{[\s\S]*?\n  \}/)
    expect(stopM).toBeTruthy()
    expect(stopM![0]).not.toContain('notifyLifecycleFault')
    const unmountM = src.match(/onUnmounted\(\(\) => \{[\s\S]*?\n  \}\)/)
    expect(unmountM).toBeTruthy()
    expect(unmountM![0]).not.toContain('notifyLifecycleFault')
  })

  it('护栏：App callback 使用 game loop lifecycle failed、formatRuntimeFault、enterRuntimeFault', () => {
    const src = readFileSync(resolve(ROOT, 'src/App.vue'), 'utf8')
    expect(src).toContain("useGameLoop(handleGameFrame, handleGameLoopLifecycleFault)")
    const m = src.match(/function handleGameLoopLifecycleFault\(error: unknown\)\s*\{[\s\S]*?\n\}/)
    expect(m).toBeTruthy()
    const body = m![0]
    expect(body).toContain("formatRuntimeFault('game loop lifecycle failed'")
    expect(body).toContain('enterRuntimeFault(')
    expect(body).toContain("runtimeStartupStatus.value !== 'ready'")
  })

  it('护栏：listener registration 使用明确 ownership flag 与保存的 startup error', () => {
    const src = readFileSync(resolve(ROOT, 'src/composables/useGameLoop.ts'), 'utf8')
    expect(src).toContain('visibilityListenerRegistered = false')
    expect(src).toContain('visibilityRegistrationError')
    expect(src).toContain('visibilityListenerRegistered = true')
    const startM = src.match(/function start\(\)\s*\{[\s\S]*?\n  \}/)
    expect(startM).toBeTruthy()
    expect(startM![0]).toContain('visibilityRegistrationError !== null')
    expect(startM![0]).toContain('throw visibilityRegistrationError')
  })
})
