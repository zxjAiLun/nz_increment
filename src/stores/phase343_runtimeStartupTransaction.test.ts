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
import type { OfflineSettlement } from '../utils/offlineReward'
// @ts-ignore —— 测试运行于 Node，无需在应用 tsconfig 中引入 @types/node 全局类型
import { readFileSync } from 'node:fs'
// @ts-ignore
import { resolve } from 'node:path'
// @ts-ignore
declare const process: { cwd(): string }

/**
 * Phase 3.43 — 运行时资源启动原子化与部分启动回滚。
 *
 * 启动事务契约：
 * - prepareBattleRuntimeAfterLoad() 返回 { ok:false } → blocked（可显式重试，零资源）；
 * - prepareBattleRuntimeAfterLoad() 抛异常 → faulted（runtime preparation failed）；
 * - 资源安装（RAF / interval / beforeunload / 离线弹窗）任一步抛异常 → rollback + faulted
 *   （runtime startup failed）；
 * - runtimeStartedOnce 是成功提交标志，仅在全部资源安装成功后提交；
 * - ready 仅在启动事务成功后可见；
 * - stopRuntime 只清理实际持有的资源（interval ID 所有权 + beforeUnloadRegistered 所有权标记）。
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

/** 挂载 App 并捕获 mounted hook 是否向外抛异常。 */
async function mountAppNoThrow() {
  let wrapper: ReturnType<typeof mountApp> | null = null
  let threw: unknown = null
  try {
    wrapper = mountApp()
    await nextTick()
  } catch (e) {
    threw = e
  }
  return { wrapper, threw }
}

/** 统一 spy 启动期资源 API。RAF 被 mock 为「只登记不调度」，保证计数确定性。 */
function spyStartupResources() {
  const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1)
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

describe('Phase 3.43 — 正常成功', () => {
  it('alive 准备成功：ready、RAF/interval/beforeunload 各一个、无 fault/blocked overlay', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    const { rafSpy, intervalSpy, addSpy } = spyStartupResources()

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { runtimeStartupStatus?: string }

    expect(vm.runtimeStartupStatus).toBe('ready')
    expect(wrapper.find('.runtime-gate-overlay').exists()).toBe(false)
    expect(rafSpy).toHaveBeenCalledTimes(1)
    expect(intervalCount(intervalSpy, 1000)).toBe(1)
    expect(beforeunloadCount(addSpy)).toBe(1)
    expect(wrapper.find('.offline-reward-stub').exists()).toBe(false)
    wrapper.unmount()
  })

  it('有 pending offline reward：资源全部安装成功后才显示离线弹窗', async () => {
    seedAlive()
    const playerStore = usePlayerStore()
    playerStore.pendingOfflineReward = { gold: 100, exp: 50 } as OfflineSettlement
    expect(playerStore.saveGame()).toBe(true) // 写盘，让 loadGame 水合 pending

    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    const { rafSpy, intervalSpy, addSpy } = spyStartupResources()

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { runtimeStartupStatus?: string }

    expect(vm.runtimeStartupStatus).toBe('ready')
    expect(wrapper.find('.offline-reward-stub').exists()).toBe(true)
    expect(rafSpy).toHaveBeenCalledTimes(1)
    expect(intervalCount(intervalSpy, 1000)).toBe(1)
    expect(beforeunloadCount(addSpy)).toBe(1)
    wrapper.unmount()
  })

  it('有 pending offline reward：资源安装失败（RAF 抛异常）时离线弹窗不显示', async () => {
    seedAlive()
    const playerStore = usePlayerStore()
    playerStore.pendingOfflineReward = { gold: 100, exp: 50 } as OfflineSettlement
    expect(playerStore.saveGame()).toBe(true)

    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => {
      throw new Error('raf boom')
    })

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { runtimeStartupStatus?: string }

    expect(vm.runtimeStartupStatus).toBe('faulted')
    expect(wrapper.find('.offline-reward-stub').exists()).toBe(false)
    wrapper.unmount()
  })

  it('重复调用启动入口：不新增 RAF/interval/listener', async () => {
    seedAlive()
    const gameStore = useGameStore()
    const prepSpy = vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    const { rafSpy, intervalSpy, addSpy } = spyStartupResources()

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { attemptRuntimeStartup?: () => void }

    const rafCalls = rafSpy.mock.calls.length
    const intervalCalls = intervalCount(intervalSpy, 1000)
    const addCalls = beforeunloadCount(addSpy)

    vm.attemptRuntimeStartup!()
    vm.attemptRuntimeStartup!()
    await nextTick()

    expect(rafSpy.mock.calls.length).toBe(rafCalls)
    expect(intervalCount(intervalSpy, 1000)).toBe(intervalCalls)
    expect(beforeunloadCount(addSpy)).toBe(addCalls)
    expect(prepSpy).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('初始 hidden：RAF 不立即调度、interval/listener 正常安装、ready、visible 后调度一个 RAF', async () => {
    setPageHidden(true)
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1)
    const intervalSpy = vi.spyOn(window, 'setInterval')
    const addSpy = vi.spyOn(window, 'addEventListener')

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { runtimeStartupStatus?: string }

    expect(vm.runtimeStartupStatus).toBe('ready')
    expect(rafSpy).not.toHaveBeenCalled()
    expect(intervalCount(intervalSpy, 1000)).toBe(1)
    expect(beforeunloadCount(addSpy)).toBe(1)

    setPageHidden(false)
    await nextTick()
    expect(rafSpy).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })
})

describe('Phase 3.43 — 准备结果失败', () => {
  it('prepare 返回 {ok:false}：blocked、重试按钮、零资源、不 faulted', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: false, reason: 'invalid hp' })
    const { rafSpy, intervalSpy, addSpy } = spyStartupResources()

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { runtimeStartupStatus?: string }

    expect(vm.runtimeStartupStatus).toBe('blocked')
    expect(wrapper.find('.runtime-gate-overlay').exists()).toBe(true)
    expect(wrapper.text()).toContain('重试启动恢复')
    expect(wrapper.text()).not.toContain('游戏运行时发生错误')
    expect(rafSpy).not.toHaveBeenCalled()
    expect(intervalCount(intervalSpy, 1000)).toBe(0)
    expect(beforeunloadCount(addSpy)).toBe(0)
    wrapper.unmount()
  })

  it('blocked 后显式重试成功：资源各一次、ready、无重复', async () => {
    seedAlive()
    const gameStore = useGameStore()
    const prepSpy = vi
      .spyOn(gameStore, 'prepareBattleRuntimeAfterLoad')
      .mockReturnValueOnce({ ok: false, reason: 'invalid hp' })
      .mockReturnValue({ ok: true, state: 'alive' })
    const { rafSpy, intervalSpy, addSpy } = spyStartupResources()

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { runtimeStartupStatus?: string }
    expect(vm.runtimeStartupStatus).toBe('blocked')
    expect(rafSpy).not.toHaveBeenCalled()

    wrapper.find('.runtime-gate-overlay button').trigger('click')
    await nextTick()

    expect(vm.runtimeStartupStatus).toBe('ready')
    expect(prepSpy).toHaveBeenCalledTimes(2)
    expect(rafSpy).toHaveBeenCalledTimes(1)
    expect(intervalCount(intervalSpy, 1000)).toBe(1)
    expect(beforeunloadCount(addSpy)).toBe(1)
    wrapper.unmount()
  })
})

describe('Phase 3.43 — 准备入口异常', () => {
  it('prepare 抛 Error：不外抛、faulted、runtime preparation failed 分类、零资源、不保存', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockImplementation(() => {
      throw new Error('prep boom')
    })
    const { rafSpy, intervalSpy, addSpy } = spyStartupResources()
    const saveSpy = vi.spyOn(usePlayerStore(), 'saveGame')

    const { wrapper, threw } = await mountAppNoThrow()
    const vm = wrapper!.vm as unknown as ComponentPublicInstance & { runtimeStartupStatus?: string }

    expect(threw).toBeNull()
    expect(vm.runtimeStartupStatus).toBe('faulted')
    expect(wrapper!.find('.runtime-gate-reason').text()).toContain('runtime preparation failed: prep boom')
    expect(wrapper!.find('.runtime-gate-reason').text()).not.toContain('runtime startup failed')
    expect(rafSpy).not.toHaveBeenCalled()
    expect(intervalCount(intervalSpy, 1000)).toBe(0)
    expect(beforeunloadCount(addSpy)).toBe(0)
    expect(saveSpy).not.toHaveBeenCalled()
    wrapper!.unmount()
  })

  it('prepare 抛非 Error：String 规范化、不写 battleError', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockImplementation(() => {
      throw 'prep-string-boom'
    })

    const { wrapper, threw } = await mountAppNoThrow()
    const vm = wrapper!.vm as unknown as ComponentPublicInstance & { runtimeStartupStatus?: string }

    expect(threw).toBeNull()
    expect(vm.runtimeStartupStatus).toBe('faulted')
    expect(wrapper!.find('.runtime-gate-reason').text()).toContain('runtime preparation failed: prep-string-boom')
    expect(gameStore.battleError).toBeNull()
    wrapper!.unmount()
  })

  it('prepare fault 后调用启动入口：不重新准备、不启动资源', async () => {
    seedAlive()
    const gameStore = useGameStore()
    const prepSpy = vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockImplementation(() => {
      throw new Error('prep boom')
    })
    const { rafSpy, intervalSpy, addSpy } = spyStartupResources()

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { attemptRuntimeStartup?: () => void }

    const prepCalls = prepSpy.mock.calls.length
    vm.attemptRuntimeStartup!()
    await nextTick()

    expect(prepSpy.mock.calls.length).toBe(prepCalls)
    expect(rafSpy).not.toHaveBeenCalled()
    expect(intervalCount(intervalSpy, 1000)).toBe(0)
    expect(beforeunloadCount(addSpy)).toBe(0)
    wrapper.unmount()
  })
})

describe('Phase 3.43 — game loop 启动失败', () => {
  it('requestAnimationFrame 抛 Error：faulted、不外抛、无 interval/listener', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => {
      throw new Error('raf boom')
    })
    const intervalSpy = vi.spyOn(window, 'setInterval')
    const addSpy = vi.spyOn(window, 'addEventListener')

    const { wrapper, threw } = await mountAppNoThrow()
    const vm = wrapper!.vm as unknown as ComponentPublicInstance & { runtimeStartupStatus?: string }

    expect(threw).toBeNull()
    expect(vm.runtimeStartupStatus).toBe('faulted')
    expect(wrapper!.find('.runtime-gate-reason').text()).toContain('runtime startup failed: raf boom')
    expect(intervalCount(intervalSpy, 1000)).toBe(0)
    expect(beforeunloadCount(addSpy)).toBe(0)
    wrapper!.unmount()
  })

  it('RAF 启动失败后 visibility：不重新尝试 RAF、不新增资源', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => {
      throw new Error('raf boom')
    })
    const intervalSpy = vi.spyOn(window, 'setInterval')

    const wrapper = mountApp()
    await nextTick()
    expect(wrapper.find('.runtime-gate-reason').text()).toContain('runtime startup failed: raf boom')
    const rafCalls = rafSpy.mock.calls.length
    const intervalCalls = intervalCount(intervalSpy, 1000)

    setPageHidden(true)
    await nextTick()
    setPageHidden(false)
    await nextTick()

    expect(rafSpy.mock.calls.length).toBe(rafCalls)
    expect(intervalCount(intervalSpy, 1000)).toBe(intervalCalls)
    wrapper.unmount()
  })

  it('RAF 启动失败后卸载：saveGame/recordLogout 零调用', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => {
      throw new Error('raf boom')
    })
    const playerStore = usePlayerStore()
    const saveSpy = vi.spyOn(playerStore, 'saveGame')
    const logoutSpy = vi.spyOn(playerStore, 'recordLogout')

    const wrapper = mountApp()
    await nextTick()
    wrapper.unmount()

    expect(saveSpy).not.toHaveBeenCalled()
    expect(logoutSpy).not.toHaveBeenCalled()
  })
})

describe('Phase 3.43 — interval 失败', () => {
  it('setInterval 抛 Error：已启动 RAF 被取消、无 beforeunload、faulted、不保存', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 42)
    const cancelSpy = vi.spyOn(window, 'cancelAnimationFrame')
    vi.spyOn(window, 'setInterval').mockImplementation(() => {
      throw new Error('interval boom')
    })
    const addSpy = vi.spyOn(window, 'addEventListener')
    const saveSpy = vi.spyOn(usePlayerStore(), 'saveGame')

    const { wrapper, threw } = await mountAppNoThrow()
    const vm = wrapper!.vm as unknown as ComponentPublicInstance & { runtimeStartupStatus?: string }

    expect(threw).toBeNull()
    expect(vm.runtimeStartupStatus).toBe('faulted')
    expect(wrapper!.find('.runtime-gate-reason').text()).toContain('runtime startup failed: interval boom')
    expect(rafSpy).toHaveBeenCalledTimes(1)
    expect(cancelSpy).toHaveBeenCalledWith(42)
    expect(beforeunloadCount(addSpy)).toBe(0)
    expect(saveSpy).not.toHaveBeenCalled()
    wrapper!.unmount()
  })

  it('setInterval 抛非 Error：reason 规范化、cleanup 完成', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 42)
    const cancelSpy = vi.spyOn(window, 'cancelAnimationFrame')
    vi.spyOn(window, 'setInterval').mockImplementation(() => {
      throw 'interval-string-boom'
    })
    const addSpy = vi.spyOn(window, 'addEventListener')

    const { wrapper, threw } = await mountAppNoThrow()
    const vm = wrapper!.vm as unknown as ComponentPublicInstance & { runtimeStartupStatus?: string }

    expect(threw).toBeNull()
    expect(vm.runtimeStartupStatus).toBe('faulted')
    expect(wrapper!.find('.runtime-gate-reason').text()).toContain('runtime startup failed: interval-string-boom')
    expect(cancelSpy).toHaveBeenCalledWith(42)
    expect(beforeunloadCount(addSpy)).toBe(0)
    wrapper!.unmount()
  })
})

describe('Phase 3.43 — listener 失败', () => {
  it('addEventListener(beforeunload) 抛 Error：RAF 取消一次、interval 清除一次、listener 未提交、faulted', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 42)
    const cancelSpy = vi.spyOn(window, 'cancelAnimationFrame')
    const intervalSpy = vi.spyOn(window, 'setInterval')
    const clearSpy = vi.spyOn(window, 'clearInterval')
    const removeSpy = vi.spyOn(window, 'removeEventListener')
    const originalAdd = window.addEventListener.bind(window)
    vi.spyOn(window, 'addEventListener').mockImplementation((type: string, listener: unknown, options?: unknown) => {
      if (type === 'beforeunload') {
        throw new Error('listener boom')
      }
      return originalAdd(type, listener as EventListenerOrEventListenerObject, options as AddEventListenerOptions | boolean | undefined)
    })

    const { wrapper, threw } = await mountAppNoThrow()
    const vm = wrapper!.vm as unknown as ComponentPublicInstance & { runtimeStartupStatus?: string }

    expect(threw).toBeNull()
    expect(vm.runtimeStartupStatus).toBe('faulted')
    expect(wrapper!.find('.runtime-gate-reason').text()).toContain('runtime startup failed: listener boom')
    expect(cancelSpy.mock.calls.filter(c => c[0] === 42).length).toBe(1)
    const runtimeSetIdx = intervalSpy.mock.calls.findIndex(c => c[1] === 1000)
    expect(runtimeSetIdx).toBeGreaterThanOrEqual(0)
    const runtimeIntervalId = intervalSpy.mock.results[runtimeSetIdx].value
    expect(clearSpy.mock.calls.filter(c => c[0] === runtimeIntervalId).length).toBe(1)
    // listener 所有权未提交：不执行 removeEventListener('beforeunload')
    expect(removeSpy.mock.calls.filter(c => c[0] === 'beforeunload').length).toBe(0)
    wrapper!.unmount()
  })

  it('listener 失败后卸载：不重复清除 interval、不重复取消 RAF、不保存', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 42)
    const cancelSpy = vi.spyOn(window, 'cancelAnimationFrame')
    const intervalSpy = vi.spyOn(window, 'setInterval')
    const clearSpy = vi.spyOn(window, 'clearInterval')
    const removeSpy = vi.spyOn(window, 'removeEventListener')
    const originalAdd = window.addEventListener.bind(window)
    vi.spyOn(window, 'addEventListener').mockImplementation((type: string, listener: unknown, options?: unknown) => {
      if (type === 'beforeunload') {
        throw new Error('listener boom')
      }
      return originalAdd(type, listener as EventListenerOrEventListenerObject, options as AddEventListenerOptions | boolean | undefined)
    })
    const saveSpy = vi.spyOn(usePlayerStore(), 'saveGame')

    const wrapper = mountApp()
    await nextTick()

    const runtimeSetIdx = intervalSpy.mock.calls.findIndex(c => c[1] === 1000)
    const runtimeIntervalId = intervalSpy.mock.results[runtimeSetIdx].value
    expect(clearSpy.mock.calls.filter(c => c[0] === runtimeIntervalId).length).toBe(1)
    expect(cancelSpy.mock.calls.filter(c => c[0] === 42).length).toBe(1)

    wrapper.unmount()

    expect(clearSpy.mock.calls.filter(c => c[0] === runtimeIntervalId).length).toBe(1)
    expect(cancelSpy.mock.calls.filter(c => c[0] === 42).length).toBe(1)
    expect(removeSpy.mock.calls.filter(c => c[0] === 'beforeunload').length).toBe(0)
    expect(saveSpy).not.toHaveBeenCalled()
  })
})

describe('Phase 3.43 — 首错与交叉调度', () => {
  it('startup fault 后手动 frame/tick：首错 reason 不变', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => {
      throw new Error('raf boom')
    })

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { tickTime?: () => void, handleGameFrame?: (d: number) => void }
    const reason = wrapper.find('.runtime-gate-reason').text()
    expect(reason).toContain('runtime startup failed: raf boom')

    vm.tickTime!()
    vm.handleGameFrame!(16)
    await nextTick()

    expect(wrapper.find('.runtime-gate-reason').text()).toBe(reason)
    wrapper.unmount()
  })

  it('startup fault 后 tickTime：零在线时间/经验/保存', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => {
      throw new Error('raf boom')
    })
    const playerStore = usePlayerStore()
    const updateSpy = vi.spyOn(playerStore, 'updateOnlineTime')
    const addExpSpy = vi.spyOn(playerStore, 'addExperience')
    const saveSpy = vi.spyOn(playerStore, 'saveGame')

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { tickTime?: () => void }

    for (let i = 0; i < 5; i++) vm.tickTime!()

    expect(updateSpy).not.toHaveBeenCalled()
    expect(addExpSpy).not.toHaveBeenCalled()
    expect(saveSpy).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('startup fault 后 handleGameFrame：不调用 gameLoop', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => {
      throw new Error('raf boom')
    })
    const loopSpy = vi.spyOn(gameStore, 'gameLoop')

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { handleGameFrame?: (d: number) => void }

    vm.handleGameFrame!(16)

    expect(loopSpy).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('startup fault 不修改 gameStore.battleError', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => {
      throw new Error('raf boom')
    })

    const wrapper = mountApp()
    await nextTick()

    expect(gameStore.battleError).toBeNull()
    wrapper.unmount()
  })
})

describe('Phase 3.43 — 正常卸载回归', () => {
  it('成功 ready 后卸载：loop 停止、interval 清除一次、listener 移除一次、saveGame 一次', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 42)
    const cancelSpy = vi.spyOn(window, 'cancelAnimationFrame')
    const intervalSpy = vi.spyOn(window, 'setInterval')
    const clearSpy = vi.spyOn(window, 'clearInterval')
    const removeSpy = vi.spyOn(window, 'removeEventListener')
    const saveSpy = vi.spyOn(usePlayerStore(), 'saveGame')

    const wrapper = mountApp()
    await nextTick()

    const runtimeSetIdx = intervalSpy.mock.calls.findIndex(c => c[1] === 1000)
    expect(runtimeSetIdx).toBeGreaterThanOrEqual(0)
    const runtimeIntervalId = intervalSpy.mock.results[runtimeSetIdx].value

    wrapper.unmount()

    expect(cancelSpy.mock.calls.filter(c => c[0] === 42).length).toBe(1)
    expect(clearSpy.mock.calls.filter(c => c[0] === runtimeIntervalId).length).toBe(1)
    expect(removeSpy.mock.calls.filter(c => c[0] === 'beforeunload').length).toBe(1)
    expect(saveSpy).toHaveBeenCalledTimes(1)
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

  it('initializing 卸载：零保存、零 recordLogout', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    const playerStore = usePlayerStore()
    const saveSpy = vi.spyOn(playerStore, 'saveGame')
    const logoutSpy = vi.spyOn(playerStore, 'recordLogout')

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & {
      runtimeStartupStatus?: 'initializing' | 'ready' | 'blocked' | 'faulted'
    }
    vm.runtimeStartupStatus = 'initializing'
    wrapper.unmount()

    expect(saveSpy).not.toHaveBeenCalled()
    expect(logoutSpy).not.toHaveBeenCalled()
  })

  it('faulted 卸载：零保存、零 recordLogout', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => {
      throw new Error('raf boom')
    })
    const playerStore = usePlayerStore()
    const saveSpy = vi.spyOn(playerStore, 'saveGame')
    const logoutSpy = vi.spyOn(playerStore, 'recordLogout')

    const wrapper = mountApp()
    await nextTick()
    wrapper.unmount()

    expect(saveSpy).not.toHaveBeenCalled()
    expect(logoutSpy).not.toHaveBeenCalled()
  })
})

describe('Phase 3.43 — 架构护栏', () => {
  const ROOT = process.cwd()

  it('护栏：runtimeStartedOnce = true 出现在全部资源安装之后', () => {
    const src = readFileSync(resolve(ROOT, 'src/App.vue'), 'utf8')
    const m = src.match(/function startRuntimeOnce\(\)[^{]*\{[\s\S]*?\n\}/)
    expect(m).toBeTruthy()
    const body = m![0]
    const commitIdx = body.indexOf('runtimeStartedOnce = true')
    expect(commitIdx).toBeGreaterThan(-1)
    expect(body.indexOf('startGameLoop()')).toBeLessThan(commitIdx)
    expect(body.indexOf('window.setInterval(tickTime, 1000)')).toBeLessThan(commitIdx)
    expect(body.indexOf('window.addEventListener(')).toBeLessThan(commitIdx)
    expect(body.slice(commitIdx)).toContain('return true')
  })

  it('护栏：ready 状态提交在启动事务成功之后', () => {
    const src = readFileSync(resolve(ROOT, 'src/App.vue'), 'utf8')
    const m = src.match(/function attemptRuntimeStartup\(\)[^{]*\{[\s\S]*?\n\}/)
    expect(m).toBeTruthy()
    const body = m![0]
    const readyIdx = body.indexOf("runtimeStartupStatus.value = 'ready'")
    expect(readyIdx).toBeGreaterThan(-1)
    expect(body.slice(0, readyIdx)).toContain('startRuntimeOnce()')
  })

  it('护栏：失败路径统一调用既有 enterRuntimeFault，不复制 fault 清理逻辑', () => {
    const src = readFileSync(resolve(ROOT, 'src/App.vue'), 'utf8')
    const m = src.match(/function startRuntimeOnce\(\)[^{]*\{[\s\S]*?\n\}/)
    expect(m).toBeTruthy()
    const body = m![0]
    expect(body).toContain('enterRuntimeFault(')
    expect(body).not.toMatch(/clearInterval/)
    expect(body).not.toMatch(/removeEventListener/)
    expect(body).not.toMatch(/stopGameLoop\(\)/)
  })

  it('不存在 setTimeout、第二 interval 或 watcher 自动重试启动', () => {
    const src = readFileSync(resolve(ROOT, 'src/App.vue'), 'utf8')
    expect(src).not.toMatch(/setTimeout/)
  })
})
