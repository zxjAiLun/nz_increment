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
// @ts-ignore —— 测试运行于 Node，无需在应用 tsconfig 中引入 @types/node 全局类型
import { readFileSync } from 'node:fs'
// @ts-ignore
import { resolve } from 'node:path'
// @ts-ignore
declare const process: { cwd(): string }

/**
 * Phase 3.44 — RAF 战斗帧意外异常熔断。
 *
 * gameLoop() 正式契约是 boolean（true 继续 / false fail-stop），但 App 必须防御该边界
 * 意外抛异常：
 * - 返回 false → 保持 Phase 3.41 语义：gameStore.battleError?.message ?? 'battle runtime failed'；
 * - 抛异常 → battle runtime frame failed: <normalized>，进入 faulted；
 * - catch 不修改 store 已锁定的 battleError、不重新抛出、不逃出真实 RAF callback；
 * - 真实 RAF callback 执行后 useGameLoop 的 callback 后复查看到 loop 已停止，不安排第二帧。
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

/** RAF mock 为「登记回调并返回固定 ID，不真正调度」，保证帧分发可控。 */
function spyCapturedRaf(id = 7) {
  let captured: FrameRequestCallback | null = null
  const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
    captured = cb
    return id
  })
  const cancelSpy = vi.spyOn(window, 'cancelAnimationFrame')
  const intervalSpy = vi.spyOn(window, 'setInterval')
  const clearSpy = vi.spyOn(window, 'clearInterval')
  const addSpy = vi.spyOn(window, 'addEventListener')
  const removeSpy = vi.spyOn(window, 'removeEventListener')
  const getCaptured = () => captured
  return { rafSpy, cancelSpy, intervalSpy, clearSpy, addSpy, removeSpy, getCaptured }
}

/** RAF mock 为「直接返回固定 ID」，用于手动 handleGameFrame 的资源清理断言。 */
function spyRafResources(id = 1) {
  const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => id)
  const cancelSpy = vi.spyOn(window, 'cancelAnimationFrame')
  const intervalSpy = vi.spyOn(window, 'setInterval')
  const clearSpy = vi.spyOn(window, 'clearInterval')
  const addSpy = vi.spyOn(window, 'addEventListener')
  const removeSpy = vi.spyOn(window, 'removeEventListener')
  return { rafSpy, cancelSpy, intervalSpy, clearSpy, addSpy, removeSpy }
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
  restoreHidden()
})

describe('Phase 3.44 — 正常与 false 返回', () => {
  it('gameLoop 返回 true：保持 ready、无 fault、RAF 继续调度', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    vi.spyOn(gameStore, 'gameLoop').mockReturnValue(true)
    const { rafSpy, getCaptured } = spyCapturedRaf()

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { runtimeStartupStatus?: string }
    const captured = getCaptured()
    expect(captured).toBeTruthy()
    expect(rafSpy).toHaveBeenCalledTimes(1)

    captured!(1000) // 执行真实注册给 rAF 的 callback

    expect(rafSpy).toHaveBeenCalledTimes(2) // 第二帧继续调度
    expect(vm.runtimeStartupStatus).toBe('ready')
    expect(wrapper.find('.runtime-gate-overlay').exists()).toBe(false)
    wrapper.unmount()
  })

  it('gameLoop 返回 false 且有 battleError：使用原 message、不添加 frame 前缀、资源停止', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    vi.spyOn(gameStore, 'gameLoop').mockImplementation(() => {
      gameStore.battleError = new Error('battle reason')
      return false
    })
    const { cancelSpy, intervalSpy, clearSpy, removeSpy } = spyRafResources()

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { handleGameFrame?: (d: number) => void }

    vm.handleGameFrame!(16)
    await nextTick()

    const reason = wrapper.find('.runtime-gate-reason').text()
    expect(reason).toContain('battle reason')
    expect(reason).not.toContain('battle runtime frame failed')
    // 资源停止
    expect(cancelSpy.mock.calls.filter(c => c[0] === 1).length).toBe(1)
    const runtimeSetIdx = intervalSpy.mock.calls.findIndex(c => c[1] === 1000)
    expect(runtimeSetIdx).toBeGreaterThanOrEqual(0)
    const runtimeIntervalId = intervalSpy.mock.results[runtimeSetIdx].value
    expect(clearSpy.mock.calls.filter(c => c[0] === runtimeIntervalId).length).toBe(1)
    expect(removeSpy.mock.calls.filter(c => c[0] === 'beforeunload').length).toBe(1)
    wrapper.unmount()
  })

  it('gameLoop 返回 false 且 battleError===null：使用 battle runtime failed fallback', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    vi.spyOn(gameStore, 'gameLoop').mockReturnValue(false)

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { handleGameFrame?: (d: number) => void }

    vm.handleGameFrame!(16)
    await nextTick()

    expect(wrapper.find('.runtime-gate-reason').text()).toContain('battle runtime failed')
    expect(gameStore.battleError).toBeNull()
    wrapper.unmount()
  })
})

describe('Phase 3.44 — 手动帧异常', () => {
  it('gameLoop 抛 Error：handleGameFrame 不外抛、faulted、精确分类、Store 恰一次', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    const loopSpy = vi.spyOn(gameStore, 'gameLoop').mockImplementation(() => {
      throw new Error('frame boom')
    })

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & {
      handleGameFrame?: (d: number) => void
      runtimeStartupStatus?: string
    }

    let threw = false
    try {
      vm.handleGameFrame!(16)
    } catch {
      threw = true
    }
    await nextTick()

    expect(threw).toBe(false)
    expect(vm.runtimeStartupStatus).toBe('faulted')
    expect(wrapper.find('.runtime-gate-reason').text()).toContain('battle runtime frame failed: frame boom')
    expect(loopSpy).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('gameLoop 抛非 Error：String 规范化、不外抛', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    vi.spyOn(gameStore, 'gameLoop').mockImplementation(() => {
      throw 'frame-string-boom'
    })

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { handleGameFrame?: (d: number) => void }

    let threw = false
    try {
      vm.handleGameFrame!(16)
    } catch {
      threw = true
    }
    await nextTick()

    expect(threw).toBe(false)
    expect(wrapper.find('.runtime-gate-reason').text()).toContain('battle runtime frame failed: frame-string-boom')
    wrapper.unmount()
  })

  it('gameLoop 抛空 message Error：无尾随冒号、基础分类文本', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    vi.spyOn(gameStore, 'gameLoop').mockImplementation(() => {
      throw new Error('')
    })

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { handleGameFrame?: (d: number) => void }

    vm.handleGameFrame!(16)
    await nextTick()

    const reason = wrapper.find('.runtime-gate-reason').text()
    expect(reason).toContain('battle runtime frame failed')
    expect(reason).not.toContain('battle runtime frame failed:')
    wrapper.unmount()
  })

  it('frame exception 不修改 gameStore.battleError', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    vi.spyOn(gameStore, 'gameLoop').mockImplementation(() => {
      throw new Error('frame boom')
    })

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { handleGameFrame?: (d: number) => void }

    vm.handleGameFrame!(16)
    await nextTick()

    expect(gameStore.battleError).toBeNull()
    wrapper.unmount()
  })

  it('已有 battleError 时 frame exception：Store 引用/message 不变、overlay 用 frame reason', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    vi.spyOn(gameStore, 'gameLoop').mockImplementation(() => {
      throw new Error('frame boom')
    })
    const existingError = new Error('existing store fault')

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { handleGameFrame?: (d: number) => void }
    gameStore.battleError = existingError

    vm.handleGameFrame!(16)
    await nextTick()

    expect(gameStore.battleError).toBe(existingError)
    expect(gameStore.battleError!.message).toBe('existing store fault')
    expect(wrapper.find('.runtime-gate-reason').text()).toContain('battle runtime frame failed: frame boom')
    wrapper.unmount()
  })
})

describe('Phase 3.44 — 真实 RAF callback', () => {
  it('真实 RAF callback：gameLoop 抛 Error、callback 不外抛、faulted、不请求第二 RAF', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    const loopSpy = vi.spyOn(gameStore, 'gameLoop').mockImplementation(() => {
      throw new Error('frame boom')
    })
    const { rafSpy, getCaptured } = spyCapturedRaf()

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { runtimeStartupStatus?: string }
    const captured = getCaptured()
    expect(captured).toBeTruthy()
    expect(rafSpy).toHaveBeenCalledTimes(1)

    let threw = false
    try {
      captured!(1000)
    } catch {
      threw = true
    }
    await nextTick()

    expect(threw).toBe(false)
    expect(vm.runtimeStartupStatus).toBe('faulted')
    expect(wrapper.find('.runtime-gate-reason').text()).toContain('battle runtime frame failed: frame boom')
    expect(rafSpy).toHaveBeenCalledTimes(1) // 不安排第二个 RAF
    expect(loopSpy).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('真实 RAF exception：原 RAF ID 取消最多一次、interval 清除一次、listener 移除一次、卸载不重复', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    vi.spyOn(gameStore, 'gameLoop').mockImplementation(() => {
      throw new Error('frame boom')
    })
    const { cancelSpy, intervalSpy, clearSpy, removeSpy, getCaptured } = spyCapturedRaf(7)

    const wrapper = mountApp()
    await nextTick()
    getCaptured()!(1000)
    await nextTick()
    expect(wrapper.find('.runtime-gate-reason').text()).toContain('battle runtime frame failed: frame boom')

    expect(cancelSpy.mock.calls.filter(c => c[0] === 7).length).toBe(1)
    const runtimeSetIdx = intervalSpy.mock.calls.findIndex(c => c[1] === 1000)
    expect(runtimeSetIdx).toBeGreaterThanOrEqual(0)
    const runtimeIntervalId = intervalSpy.mock.results[runtimeSetIdx].value
    expect(clearSpy.mock.calls.filter(c => c[0] === runtimeIntervalId).length).toBe(1)
    expect(removeSpy.mock.calls.filter(c => c[0] === 'beforeunload').length).toBe(1)

    wrapper.unmount()
    // 卸载不重复清理
    expect(cancelSpy.mock.calls.filter(c => c[0] === 7).length).toBe(1)
    expect(clearSpy.mock.calls.filter(c => c[0] === runtimeIntervalId).length).toBe(1)
    expect(removeSpy.mock.calls.filter(c => c[0] === 'beforeunload').length).toBe(1)
  })

  it('exception 后 hidden→visible：不新增 RAF/interval/listener', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    vi.spyOn(gameStore, 'gameLoop').mockImplementation(() => {
      throw new Error('frame boom')
    })
    const { rafSpy, intervalSpy, addSpy, getCaptured } = spyCapturedRaf()

    const wrapper = mountApp()
    await nextTick()
    getCaptured()!(1000)
    await nextTick()
    expect(wrapper.find('.runtime-gate-reason').text()).toContain('battle runtime frame failed')

    const rafCalls = rafSpy.mock.calls.length
    const intervalCalls = intervalCount(intervalSpy, 1000)
    const addCalls = beforeunloadCount(addSpy)

    setPageHidden(true)
    await nextTick()
    setPageHidden(false)
    await nextTick()

    expect(rafSpy.mock.calls.length).toBe(rafCalls)
    expect(intervalCount(intervalSpy, 1000)).toBe(intervalCalls)
    expect(beforeunloadCount(addSpy)).toBe(addCalls)
    wrapper.unmount()
  })

  it('exception 后再次执行原 callback：gameLoop 不新增调用、reason 不变', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    const loopSpy = vi.spyOn(gameStore, 'gameLoop').mockImplementation(() => {
      throw new Error('frame boom')
    })
    const { getCaptured } = spyCapturedRaf()

    const wrapper = mountApp()
    await nextTick()
    const captured = getCaptured()
    captured!(1000)
    await nextTick()
    const reason = wrapper.find('.runtime-gate-reason').text()
    expect(loopSpy).toHaveBeenCalledTimes(1)

    captured!(2000)
    await nextTick()

    expect(loopSpy).toHaveBeenCalledTimes(1)
    expect(wrapper.find('.runtime-gate-reason').text()).toBe(reason)
    wrapper.unmount()
  })
})

describe('Phase 3.44 — 后续行为', () => {
  it('frame exception 后多次 tickTime：在线时间/经验/保存零新增', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    vi.spyOn(gameStore, 'gameLoop').mockImplementation(() => {
      throw new Error('frame boom')
    })
    const playerStore = usePlayerStore()
    const updateSpy = vi.spyOn(playerStore, 'updateOnlineTime')
    const addExpSpy = vi.spyOn(playerStore, 'addExperience')
    const saveSpy = vi.spyOn(playerStore, 'saveGame')

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { handleGameFrame?: (d: number) => void, tickTime?: () => void }
    vm.handleGameFrame!(16)
    await nextTick()

    for (let i = 0; i < 40; i++) vm.tickTime!()

    expect(updateSpy).not.toHaveBeenCalled()
    expect(addExpSpy).not.toHaveBeenCalled()
    expect(saveSpy).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('frame exception 后手动 handleGameFrame：Store 不再调用', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    const loopSpy = vi.spyOn(gameStore, 'gameLoop').mockImplementation(() => {
      throw new Error('frame boom')
    })

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { handleGameFrame?: (d: number) => void }
    vm.handleGameFrame!(16)
    await nextTick()
    expect(loopSpy).toHaveBeenCalledTimes(1)

    vm.handleGameFrame!(16)
    await nextTick()
    expect(loopSpy).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('frame exception 后 attemptRuntimeStartup：不重新准备、不重新安装资源', async () => {
    seedAlive()
    const gameStore = useGameStore()
    const prepSpy = vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    vi.spyOn(gameStore, 'gameLoop').mockImplementation(() => {
      throw new Error('frame boom')
    })
    const { rafSpy, intervalSpy, addSpy } = spyRafResources()

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & {
      handleGameFrame?: (d: number) => void
      attemptRuntimeStartup?: () => void
    }
    vm.handleGameFrame!(16)
    await nextTick()

    const prepCalls = prepSpy.mock.calls.length
    const rafCalls = rafSpy.mock.calls.length
    const intervalCalls = intervalCount(intervalSpy, 1000)
    const addCalls = beforeunloadCount(addSpy)

    vm.attemptRuntimeStartup!()
    await nextTick()

    expect(prepSpy.mock.calls.length).toBe(prepCalls)
    expect(rafSpy.mock.calls.length).toBe(rafCalls)
    expect(intervalCount(intervalSpy, 1000)).toBe(intervalCalls)
    expect(beforeunloadCount(addSpy)).toBe(addCalls)
    wrapper.unmount()
  })

  it('frame exception 后卸载：saveGame/recordLogout 零调用、cleanup 不重复', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    vi.spyOn(gameStore, 'gameLoop').mockImplementation(() => {
      throw new Error('frame boom')
    })
    const playerStore = usePlayerStore()
    const saveSpy = vi.spyOn(playerStore, 'saveGame')
    const logoutSpy = vi.spyOn(playerStore, 'recordLogout')
    const { cancelSpy, intervalSpy, clearSpy, removeSpy } = spyRafResources()

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { handleGameFrame?: (d: number) => void }
    vm.handleGameFrame!(16)
    await nextTick()

    const runtimeSetIdx = intervalSpy.mock.calls.findIndex(c => c[1] === 1000)
    const runtimeIntervalId = intervalSpy.mock.results[runtimeSetIdx].value
    const clearBefore = clearSpy.mock.calls.filter(c => c[0] === runtimeIntervalId).length
    const cancelBefore = cancelSpy.mock.calls.length
    const removeBefore = removeSpy.mock.calls.filter(c => c[0] === 'beforeunload').length

    wrapper.unmount()

    expect(saveSpy).not.toHaveBeenCalled()
    expect(logoutSpy).not.toHaveBeenCalled()
    expect(clearSpy.mock.calls.filter(c => c[0] === runtimeIntervalId).length).toBe(clearBefore)
    expect(cancelSpy.mock.calls.length).toBe(cancelBefore)
    expect(removeSpy.mock.calls.filter(c => c[0] === 'beforeunload').length).toBe(removeBefore)
  })
})

describe('Phase 3.44 — 竞态', () => {
  it('timer fault 先发生，再执行已捕获 RAF callback：Store 零调用、timer reason 不变', async () => {
    seedAlive()
    const gameStore = useGameStore()
    const playerStore = usePlayerStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    vi.spyOn(playerStore, 'getExpPerSecond').mockReturnValue(0)
    vi.spyOn(playerStore, 'saveGame').mockReturnValue(false)
    const { getCaptured } = spyCapturedRaf()

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { tickTime?: () => void }
    for (let i = 0; i < 30; i++) vm.tickTime!()
    await nextTick()
    const reason = wrapper.find('.runtime-gate-reason').text()
    expect(reason).toContain('automatic save failed')

    const loopSpy = vi.spyOn(gameStore, 'gameLoop')
    expect(loopSpy).not.toHaveBeenCalled()
    getCaptured()!(1000)
    await nextTick()

    expect(loopSpy).not.toHaveBeenCalled()
    expect(wrapper.find('.runtime-gate-reason').text()).toBe(reason)
    wrapper.unmount()
  })

  it('false-return battle fault 先发生，再手动 frame：Store 不再调用、battle reason 不变', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    const loopSpy = vi.spyOn(gameStore, 'gameLoop').mockImplementation(() => {
      gameStore.battleError = new Error('battle reason')
      return false
    })

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { handleGameFrame?: (d: number) => void }
    vm.handleGameFrame!(16)
    await nextTick()
    const reason = wrapper.find('.runtime-gate-reason').text()
    expect(reason).toContain('battle reason')
    expect(loopSpy).toHaveBeenCalledTimes(1)

    vm.handleGameFrame!(16)
    await nextTick()

    expect(loopSpy).toHaveBeenCalledTimes(1)
    expect(wrapper.find('.runtime-gate-reason').text()).toBe(reason)
    wrapper.unmount()
  })

  it('frame exception 先发生，再制造 timer/save failure：frame reason 不变、不保存', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    vi.spyOn(gameStore, 'gameLoop').mockImplementation(() => {
      throw new Error('frame boom')
    })
    const playerStore = usePlayerStore()
    const saveSpy = vi.spyOn(playerStore, 'saveGame')
    const updateSpy = vi.spyOn(playerStore, 'updateOnlineTime')

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & {
      handleGameFrame?: (d: number) => void
      tickTime?: () => void
    }
    vm.handleGameFrame!(16)
    await nextTick()
    const reason = wrapper.find('.runtime-gate-reason').text()
    expect(reason).toContain('battle runtime frame failed: frame boom')

    for (let i = 0; i < 40; i++) vm.tickTime!()
    await nextTick()

    expect(updateSpy).not.toHaveBeenCalled()
    expect(saveSpy).not.toHaveBeenCalled()
    expect(wrapper.find('.runtime-gate-reason').text()).toBe(reason)
    wrapper.unmount()
  })
})

describe('Phase 3.44 — UI/交互', () => {
  it('frame exception 后：skill/mode/offline 全部阻止、reload 按钮只 reload', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    vi.spyOn(gameStore, 'gameLoop').mockImplementation(() => {
      throw new Error('frame boom')
    })
    const useSkillSpy = vi.spyOn(gameStore, 'tryUsePlayerSkill')
    const resumeSpy = vi.spyOn(gameStore, 'resumeBattle')
    const reloadSpy = vi.fn()
    const originalLocation = window.location
    const stubLocation = { ...originalLocation, reload: reloadSpy }
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: stubLocation
    })

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
    expect(wrapper.find('.runtime-gate-overlay').exists()).toBe(true)

    vm.useSkill!(0)
    vm.switchBattleMode!('main')
    vm.onClaimOffline!()
    expect(useSkillSpy).not.toHaveBeenCalled()
    expect(resumeSpy).not.toHaveBeenCalled()

    const reloadBtn = wrapper.findAll('.runtime-gate-overlay button').find(b => b.text().includes('重新加载游戏'))
    expect(reloadBtn).toBeTruthy()
    reloadBtn!.trigger('click')
    expect(reloadSpy).toHaveBeenCalledTimes(1)

    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation
    })
    wrapper.unmount()
  })
})

describe('Phase 3.44 — 架构护栏', () => {
  const ROOT = process.cwd()

  it('护栏：gameStore.gameLoop() 位于 handleGameFrame 的 try/catch 中', () => {
    const src = readFileSync(resolve(ROOT, 'src/App.vue'), 'utf8')
    const m = src.match(/function handleGameFrame\(deltaTime: number\)\s*\{[\s\S]*?\n\}/)
    expect(m).toBeTruthy()
    const body = m![0]
    expect(body).toContain('try {')
    expect(body).toContain('ok = gameStore.gameLoop(deltaTime)')
    expect(body).toContain('} catch (error) {')
  })

  it('护栏：catch 使用 battle runtime frame failed 并复用 formatRuntimeFault', () => {
    const src = readFileSync(resolve(ROOT, 'src/App.vue'), 'utf8')
    const m = src.match(/function handleGameFrame\(deltaTime: number\)\s*\{[\s\S]*?\n\}/)
    expect(m).toBeTruthy()
    const body = m![0]
    expect(body).toContain("formatRuntimeFault('battle runtime frame failed'")
  })

  it('护栏：false-return 分支继续直接读取 battleError?.message', () => {
    const src = readFileSync(resolve(ROOT, 'src/App.vue'), 'utf8')
    const m = src.match(/function handleGameFrame\(deltaTime: number\)\s*\{[\s\S]*?\n\}/)
    expect(m).toBeTruthy()
    const body = m![0]
    expect(body).toContain('gameStore.battleError?.message')
    expect(body).toContain("'battle runtime failed'")
  })

  it('护栏：catch 内不存在 saveGame/recordLogout/battleError 赋值/恢复/启动准备', () => {
    const src = readFileSync(resolve(ROOT, 'src/App.vue'), 'utf8')
    const m = src.match(/function handleGameFrame\(deltaTime: number\)\s*\{[\s\S]*?\n\}/)
    expect(m).toBeTruthy()
    const body = m![0]
    const catchIdx = body.indexOf('} catch (error) {')
    expect(catchIdx).toBeGreaterThan(-1)
    const catchBody = body.slice(catchIdx)
    expect(catchBody).not.toContain('saveGame')
    expect(catchBody).not.toContain('recordLogout')
    expect(catchBody).not.toContain('battleError =')
    expect(catchBody).not.toContain('recoverLoadedPlayerDeath')
    expect(catchBody).not.toContain('prepareBattleRuntimeAfterLoad')
  })

  it('不存在 setTimeout、额外 interval 或 watcher 自动恢复 frame loop', () => {
    const src = readFileSync(resolve(ROOT, 'src/App.vue'), 'utf8')
    expect(src).not.toMatch(/setTimeout/)
  })
})
