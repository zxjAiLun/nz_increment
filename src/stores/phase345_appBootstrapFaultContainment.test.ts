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
 * Phase 3.45 — App 挂载初始化异常熔断。
 *
 * onMounted 只调用 exposeDebugVm()（最佳努力，失败不影响启动）和 initializeAppRuntime()。
 * initializeAppRuntime 对导航初始化与存档加载建立两个独立异常边界：
 * - navigationStore.initialize() 抛异常 → navigation initialization failed → faulted；
 * - playerStore.loadGame() 抛异常 → game state loading failed → faulted；
 * - 两步都成功后才调用 attemptRuntimeStartup()；
 * - faulted 后 bootstrap / 启动入口 / tick / frame / visibility 均零副作用；
 * - blocked 重试仍只调用 attemptRuntimeStartup()，不重跑导航/存档。
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

describe('Phase 3.45 — 正常成功', () => {
  it('正常启动调用顺序：navigation initialize → loadGame → prepare → 资源 → ready', async () => {
    seedAlive()
    const navigationStore = useNavigationStore()
    const navSpy = vi.spyOn(navigationStore, 'initialize')
    const playerStore = usePlayerStore()
    const loadGameSpy = vi.spyOn(playerStore, 'loadGame')
    const gameStore = useGameStore()
    const prepSpy = vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    const { rafSpy, intervalSpy, addSpy } = spyRafResources()

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { runtimeStartupStatus?: string }

    expect(vm.runtimeStartupStatus).toBe('ready')
    expect(navSpy).toHaveBeenCalledTimes(1)
    expect(loadGameSpy).toHaveBeenCalledTimes(1)
    expect(prepSpy).toHaveBeenCalledTimes(1)
    expect(rafSpy).toHaveBeenCalledTimes(1)
    expect(intervalCount(intervalSpy, 1000)).toBe(1)
    expect(beforeunloadCount(addSpy)).toBe(1)
    wrapper.unmount()
  })

  it('正常 blocked 后显式重试：nav/load 仍各一次、prepare 两次、资源只在成功后各一次', async () => {
    seedAlive()
    const navigationStore = useNavigationStore()
    const navSpy = vi.spyOn(navigationStore, 'initialize')
    const playerStore = usePlayerStore()
    const loadGameSpy = vi.spyOn(playerStore, 'loadGame')
    const gameStore = useGameStore()
    const prepSpy = vi
      .spyOn(gameStore, 'prepareBattleRuntimeAfterLoad')
      .mockReturnValueOnce({ ok: false, reason: 'invalid hp' })
      .mockReturnValue({ ok: true, state: 'alive' })
    const { rafSpy, intervalSpy, addSpy } = spyRafResources()

    const wrapper = mountApp()
    await nextTick()
    expect(wrapper.find('.runtime-gate-overlay').exists()).toBe(true) // blocked
    expect(navSpy).toHaveBeenCalledTimes(1)
    expect(loadGameSpy).toHaveBeenCalledTimes(1)
    expect(prepSpy).toHaveBeenCalledTimes(1)
    expect(rafSpy).not.toHaveBeenCalled()

    wrapper.find('.runtime-gate-overlay button').trigger('click')
    await nextTick()

    expect(navSpy).toHaveBeenCalledTimes(1) // 不重跑导航
    expect(loadGameSpy).toHaveBeenCalledTimes(1) // 不重跑存档
    expect(prepSpy).toHaveBeenCalledTimes(2)
    expect(rafSpy).toHaveBeenCalledTimes(1)
    expect(intervalCount(intervalSpy, 1000)).toBe(1)
    expect(beforeunloadCount(addSpy)).toBe(1)
    wrapper.unmount()
  })

  it('正常 pending offline reward 回归：资源安装成功后弹窗显示、ready', async () => {
    seedAlive()
    const playerStore = usePlayerStore()
    playerStore.pendingOfflineReward = { gold: 100, exp: 50 } as OfflineSettlement
    expect(playerStore.saveGame()).toBe(true) // 写盘，让 loadGame 水合 pending

    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { runtimeStartupStatus?: string }

    expect(vm.runtimeStartupStatus).toBe('ready')
    expect(wrapper.find('.offline-reward-stub').exists()).toBe(true)
    wrapper.unmount()
  })

  it('正常 startup death recovery 回归：死亡存档恢复满血后 ready', async () => {
    seedAlive()
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    playerStore.player.currentHp = 0
    playerStore.player.maxHp = 100
    monsterStore.setProgress(45, 20)
    expect(playerStore.saveGame()).toBe(true) // 写入死亡存档

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { runtimeStartupStatus?: string }

    expect(vm.runtimeStartupStatus).toBe('ready')
    expect(playerStore.player.currentHp).toBe(100) // 恢复满血
    wrapper.unmount()
  })
})

describe('Phase 3.45 — debug hook', () => {
  it('window.gameVM setter 抛 Error：不影响启动、最终 ready、无 fault overlay', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    const { rafSpy, intervalSpy, addSpy } = spyRafResources()
    Object.defineProperty(window, 'gameVM', {
      configurable: true,
      get: () => undefined,
      set: () => {
        throw new Error('debug setter denied')
      }
    })

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { runtimeStartupStatus?: string }

    expect(vm.runtimeStartupStatus).toBe('ready')
    expect(wrapper.find('.runtime-gate-overlay').exists()).toBe(false)
    expect(rafSpy).toHaveBeenCalledTimes(1)
    expect(intervalCount(intervalSpy, 1000)).toBe(1)
    expect(beforeunloadCount(addSpy)).toBe(1)
    delete (window as any).gameVM
    wrapper.unmount()
  })

  it('window.gameVM setter 抛非 Error：同样不影响启动', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    Object.defineProperty(window, 'gameVM', {
      configurable: true,
      get: () => undefined,
      set: () => {
        throw 'debug-string-boom'
      }
    })

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { runtimeStartupStatus?: string }

    expect(vm.runtimeStartupStatus).toBe('ready')
    expect(wrapper.find('.runtime-gate-overlay').exists()).toBe(false)
    delete (window as any).gameVM
    wrapper.unmount()
  })
})

describe('Phase 3.45 — 导航初始化异常', () => {
  it('navigationStore.initialize 抛 Error：不外抛、faulted、navigation 分类、loadGame/prepare 零调用、零资源', async () => {
    seedAlive()
    const navigationStore = useNavigationStore()
    const navSpy = vi.spyOn(navigationStore, 'initialize').mockImplementation(() => {
      throw new Error('navigation storage denied')
    })
    const playerStore = usePlayerStore()
    const loadGameSpy = vi.spyOn(playerStore, 'loadGame')
    const gameStore = useGameStore()
    const prepSpy = vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad')
    const { rafSpy, intervalSpy, addSpy } = spyRafResources()

    const { wrapper, threw } = await mountAppNoThrow()
    const vm = wrapper!.vm as unknown as ComponentPublicInstance & { runtimeStartupStatus?: string }

    expect(threw).toBeNull()
    expect(vm.runtimeStartupStatus).toBe('faulted')
    expect(wrapper!.find('.runtime-gate-reason').text()).toContain('navigation initialization failed: navigation storage denied')
    expect(navSpy).toHaveBeenCalledTimes(1)
    expect(loadGameSpy).not.toHaveBeenCalled()
    expect(prepSpy).not.toHaveBeenCalled()
    expect(rafSpy).not.toHaveBeenCalled()
    expect(intervalCount(intervalSpy, 1000)).toBe(0)
    expect(beforeunloadCount(addSpy)).toBe(0)
    wrapper!.unmount()
  })

  it('navigationStore.initialize 抛非 Error：String 规范化、battleError null', async () => {
    seedAlive()
    const navigationStore = useNavigationStore()
    vi.spyOn(navigationStore, 'initialize').mockImplementation(() => {
      throw 'navigation-string-boom'
    })
    const gameStore = useGameStore()

    const { wrapper, threw } = await mountAppNoThrow()
    const vm = wrapper!.vm as unknown as ComponentPublicInstance & { runtimeStartupStatus?: string }

    expect(threw).toBeNull()
    expect(vm.runtimeStartupStatus).toBe('faulted')
    expect(wrapper!.find('.runtime-gate-reason').text()).toContain('navigation initialization failed: navigation-string-boom')
    expect(gameStore.battleError).toBeNull()
    wrapper!.unmount()
  })

  it('navigationStore.initialize 抛空 message：无尾随冒号', async () => {
    seedAlive()
    const navigationStore = useNavigationStore()
    vi.spyOn(navigationStore, 'initialize').mockImplementation(() => {
      throw new Error('')
    })

    const wrapper = mountApp()
    await nextTick()

    const reason = wrapper.find('.runtime-gate-reason').text()
    expect(reason).toContain('navigation initialization failed')
    expect(reason).not.toContain('navigation initialization failed:')
    wrapper.unmount()
  })

  it('真实导航路径：localStorage.setItem 抛异常 → navigation fault、不加载游戏、不启动资源', async () => {
    seedAlive()
    const playerStore = usePlayerStore()
    const loadGameSpy = vi.spyOn(playerStore, 'loadGame')
    const gameStore = useGameStore()
    const prepSpy = vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad')
    const { rafSpy, intervalSpy, addSpy } = spyRafResources()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage denied')
    })

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { runtimeStartupStatus?: string }

    expect(vm.runtimeStartupStatus).toBe('faulted')
    expect(wrapper.find('.runtime-gate-reason').text()).toContain('navigation initialization failed: storage denied')
    expect(wrapper.find('.runtime-gate-reason').text()).not.toContain('game state loading failed')
    expect(loadGameSpy).not.toHaveBeenCalled()
    expect(prepSpy).not.toHaveBeenCalled()
    expect(rafSpy).not.toHaveBeenCalled()
    expect(intervalCount(intervalSpy, 1000)).toBe(0)
    expect(beforeunloadCount(addSpy)).toBe(0)
    wrapper.unmount()
  })

  it('localStorage.getItem 在导航阶段抛异常：同样 navigation fault、不进入 game-state-loading 分类', async () => {
    seedAlive()
    const playerStore = usePlayerStore()
    const loadGameSpy = vi.spyOn(playerStore, 'loadGame')
    // 只让导航 key 的读取抛异常（i18n 等其余 key 走原实现），确保故障点位于导航初始化。
    const originalGetItem = Storage.prototype.getItem.bind(localStorage)
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation((key: string) => {
      if (key === 'nz_nav_route_v2') {
        throw new Error('read denied')
      }
      return originalGetItem(key)
    })

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { runtimeStartupStatus?: string }

    expect(vm.runtimeStartupStatus).toBe('faulted')
    expect(wrapper.find('.runtime-gate-reason').text()).toContain('navigation initialization failed: read denied')
    expect(wrapper.find('.runtime-gate-reason').text()).not.toContain('game state loading failed')
    expect(loadGameSpy).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})

describe('Phase 3.45 — 存档加载异常', () => {
  it('loadGame 抛 Error：导航一次、faulted、game state loading failed、prepare 零、零资源、battleError null', async () => {
    seedAlive()
    const navigationStore = useNavigationStore()
    const navSpy = vi.spyOn(navigationStore, 'initialize')
    const playerStore = usePlayerStore()
    const loadGameSpy = vi.spyOn(playerStore, 'loadGame').mockImplementation(() => {
      throw new Error('save hydration boom')
    })
    const gameStore = useGameStore()
    const prepSpy = vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad')
    const { rafSpy, intervalSpy, addSpy } = spyRafResources()

    const { wrapper, threw } = await mountAppNoThrow()
    const vm = wrapper!.vm as unknown as ComponentPublicInstance & { runtimeStartupStatus?: string }

    expect(threw).toBeNull()
    expect(navSpy).toHaveBeenCalledTimes(1)
    expect(loadGameSpy).toHaveBeenCalledTimes(1)
    expect(vm.runtimeStartupStatus).toBe('faulted')
    expect(wrapper!.find('.runtime-gate-reason').text()).toContain('game state loading failed: save hydration boom')
    expect(wrapper!.find('.runtime-gate-reason').text()).not.toContain('navigation initialization failed')
    expect(prepSpy).not.toHaveBeenCalled()
    expect(rafSpy).not.toHaveBeenCalled()
    expect(intervalCount(intervalSpy, 1000)).toBe(0)
    expect(beforeunloadCount(addSpy)).toBe(0)
    expect(gameStore.battleError).toBeNull()
    wrapper!.unmount()
  })

  it('loadGame 抛非 Error：String 规范化、不外抛', async () => {
    seedAlive()
    const playerStore = usePlayerStore()
    vi.spyOn(playerStore, 'loadGame').mockImplementation(() => {
      throw 'load-string-boom'
    })

    const { wrapper, threw } = await mountAppNoThrow()
    const vm = wrapper!.vm as unknown as ComponentPublicInstance & { runtimeStartupStatus?: string }

    expect(threw).toBeNull()
    expect(vm.runtimeStartupStatus).toBe('faulted')
    expect(wrapper!.find('.runtime-gate-reason').text()).toContain('game state loading failed: load-string-boom')
    wrapper!.unmount()
  })

  it('loadGame 抛空 message：无尾随冒号', async () => {
    seedAlive()
    const playerStore = usePlayerStore()
    vi.spyOn(playerStore, 'loadGame').mockImplementation(() => {
      throw new Error('')
    })

    const wrapper = mountApp()
    await nextTick()

    const reason = wrapper.find('.runtime-gate-reason').text()
    expect(reason).toContain('game state loading failed')
    expect(reason).not.toContain('game state loading failed:')
    wrapper.unmount()
  })

  it('load fault 不修改既有 battleError', async () => {
    seedAlive()
    const gameStore = useGameStore()
    const existing = new Error('existing store fault')
    gameStore.battleError = existing
    const playerStore = usePlayerStore()
    vi.spyOn(playerStore, 'loadGame').mockImplementation(() => {
      throw new Error('save hydration boom')
    })

    const wrapper = mountApp()
    await nextTick()

    expect(gameStore.battleError).toBe(existing)
    expect(gameStore.battleError!.message).toBe('existing store fault')
    wrapper.unmount()
  })

  it('load fault 后卸载：saveGame/recordLogout 零调用、cleanup 幂等', async () => {
    seedAlive()
    const playerStore = usePlayerStore()
    const saveSpy = vi.spyOn(playerStore, 'saveGame')
    const logoutSpy = vi.spyOn(playerStore, 'recordLogout')
    vi.spyOn(playerStore, 'loadGame').mockImplementation(() => {
      throw new Error('save hydration boom')
    })
    const { rafSpy, cancelSpy, intervalSpy, clearSpy, addSpy, removeSpy } = spyRafResources()

    const wrapper = mountApp()
    await nextTick()
    expect(wrapper.find('.runtime-gate-overlay').exists()).toBe(true)
    wrapper.unmount()

    expect(saveSpy).not.toHaveBeenCalled()
    expect(logoutSpy).not.toHaveBeenCalled()
    expect(rafSpy).not.toHaveBeenCalled()
    expect(cancelSpy).not.toHaveBeenCalled()
    expect(intervalCount(intervalSpy, 1000)).toBe(0)
    expect(clearSpy).not.toHaveBeenCalled()
    expect(beforeunloadCount(addSpy)).toBe(0)
    expect(removeSpy).not.toHaveBeenCalled()
  })
})

describe('Phase 3.45 — 后续行为', () => {
  it('navigation fault 后再次调用 bootstrap：nav 不新增、load/prepare 零调用、reason 不变', async () => {
    seedAlive()
    const navigationStore = useNavigationStore()
    const navSpy = vi.spyOn(navigationStore, 'initialize').mockImplementation(() => {
      throw new Error('navigation storage denied')
    })
    const playerStore = usePlayerStore()
    const loadGameSpy = vi.spyOn(playerStore, 'loadGame')
    const gameStore = useGameStore()
    const prepSpy = vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad')

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { initializeAppRuntime?: () => void }
    const reason = wrapper.find('.runtime-gate-reason').text()

    vm.initializeAppRuntime!()
    await nextTick()

    expect(navSpy).toHaveBeenCalledTimes(1)
    expect(loadGameSpy).not.toHaveBeenCalled()
    expect(prepSpy).not.toHaveBeenCalled()
    expect(wrapper.find('.runtime-gate-reason').text()).toBe(reason)
    wrapper.unmount()
  })

  it('load fault 后调用 attemptRuntimeStartup：prepare 零调用、资源不安装', async () => {
    seedAlive()
    const playerStore = usePlayerStore()
    vi.spyOn(playerStore, 'loadGame').mockImplementation(() => {
      throw new Error('save hydration boom')
    })
    const gameStore = useGameStore()
    const prepSpy = vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad')
    const { rafSpy, intervalSpy, addSpy } = spyRafResources()

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { attemptRuntimeStartup?: () => void }

    vm.attemptRuntimeStartup!()
    await nextTick()

    expect(prepSpy).not.toHaveBeenCalled()
    expect(rafSpy).not.toHaveBeenCalled()
    expect(intervalCount(intervalSpy, 1000)).toBe(0)
    expect(beforeunloadCount(addSpy)).toBe(0)
    wrapper.unmount()
  })

  it('初始化 fault 后多次 tick：在线时间/经验/保存零调用', async () => {
    seedAlive()
    const navigationStore = useNavigationStore()
    vi.spyOn(navigationStore, 'initialize').mockImplementation(() => {
      throw new Error('navigation storage denied')
    })
    const playerStore = usePlayerStore()
    const updateSpy = vi.spyOn(playerStore, 'updateOnlineTime')
    const addExpSpy = vi.spyOn(playerStore, 'addExperience')
    const saveSpy = vi.spyOn(playerStore, 'saveGame')

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { tickTime?: () => void }

    for (let i = 0; i < 40; i++) vm.tickTime!()

    expect(updateSpy).not.toHaveBeenCalled()
    expect(addExpSpy).not.toHaveBeenCalled()
    expect(saveSpy).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('初始化 fault 后 frame：gameLoop 零调用', async () => {
    seedAlive()
    const navigationStore = useNavigationStore()
    vi.spyOn(navigationStore, 'initialize').mockImplementation(() => {
      throw new Error('navigation storage denied')
    })
    const gameStore = useGameStore()
    const loopSpy = vi.spyOn(gameStore, 'gameLoop')

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { handleGameFrame?: (d: number) => void }

    vm.handleGameFrame!(16)

    expect(loopSpy).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('初始化 fault 后 hidden→visible：不创建 RAF/interval/listener', async () => {
    seedAlive()
    const navigationStore = useNavigationStore()
    vi.spyOn(navigationStore, 'initialize').mockImplementation(() => {
      throw new Error('navigation storage denied')
    })
    const { rafSpy, intervalSpy, addSpy } = spyRafResources()

    const wrapper = mountApp()
    await nextTick()
    expect(wrapper.find('.runtime-gate-reason').text()).toContain('navigation initialization failed')

    setPageHidden(true)
    await nextTick()
    setPageHidden(false)
    await nextTick()

    expect(rafSpy).not.toHaveBeenCalled()
    expect(intervalCount(intervalSpy, 1000)).toBe(0)
    expect(beforeunloadCount(addSpy)).toBe(0)
    wrapper.unmount()
  })

  it('reload 按钮：只 reload 一次、不先保存、不重新初始化', async () => {
    seedAlive()
    const navigationStore = useNavigationStore()
    const navSpy = vi.spyOn(navigationStore, 'initialize').mockImplementation(() => {
      throw new Error('navigation storage denied')
    })
    const playerStore = usePlayerStore()
    const saveSpy = vi.spyOn(playerStore, 'saveGame')
    const reloadSpy = vi.fn()
    const originalLocation = window.location
    const stubLocation = { ...originalLocation, reload: reloadSpy }
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: stubLocation
    })

    const wrapper = mountApp()
    await nextTick()
    expect(wrapper.find('.runtime-gate-overlay').exists()).toBe(true)

    const reloadBtn = wrapper.findAll('.runtime-gate-overlay button').find(b => b.text().includes('重新加载游戏'))
    expect(reloadBtn).toBeTruthy()
    reloadBtn!.trigger('click')

    expect(reloadSpy).toHaveBeenCalledTimes(1)
    expect(saveSpy).not.toHaveBeenCalled()
    expect(navSpy).toHaveBeenCalledTimes(1) // 不重新初始化
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation
    })
    wrapper.unmount()
  })
})

describe('Phase 3.45 — 架构护栏', () => {
  const ROOT = process.cwd()

  it('护栏：navigationStore.initialize() 与 playerStore.loadGame() 各在独立 try/catch 中，attemptRuntimeStartup 在其后', () => {
    const src = readFileSync(resolve(ROOT, 'src/App.vue'), 'utf8')
    const m = src.match(/function initializeAppRuntime\(\)\s*\{[\s\S]*?\n\}/)
    expect(m).toBeTruthy()
    const body = m![0]
    expect(body).toContain('try {')
    expect(body).toContain('navigationStore.initialize()')
    expect(body).toContain('playerStore.loadGame()')
    expect((body.match(/\} catch \(error\) \{/g) || []).length).toBe(2)
    const prepIdx = body.indexOf('attemptRuntimeStartup()')
    const navCatchIdx = body.indexOf("'navigation initialization failed'")
    const loadCatchIdx = body.indexOf("'game state loading failed'")
    expect(prepIdx).toBeGreaterThan(navCatchIdx)
    expect(prepIdx).toBeGreaterThan(loadCatchIdx)
  })

  it('护栏：两个 catch 均复用 formatRuntimeFault 与 enterRuntimeFault', () => {
    const src = readFileSync(resolve(ROOT, 'src/App.vue'), 'utf8')
    const m = src.match(/function initializeAppRuntime\(\)\s*\{[\s\S]*?\n\}/)
    expect(m).toBeTruthy()
    const body = m![0]
    expect(body).toContain("formatRuntimeFault('navigation initialization failed'")
    expect(body).toContain("formatRuntimeFault('game state loading failed'")
    expect(body).toContain('enterRuntimeFault(')
  })

  it('护栏：catch 内不存在 saveGame/recordLogout/resetGame/恢复/启动准备/localStorage.removeItem/location.reload', () => {
    const src = readFileSync(resolve(ROOT, 'src/App.vue'), 'utf8')
    const m = src.match(/function initializeAppRuntime\(\)\s*\{[\s\S]*?\n\}/)
    expect(m).toBeTruthy()
    const body = m![0]
    for (const forbidden of [
      'saveGame',
      'recordLogout',
      'resetGame',
      'recoverLoadedPlayerDeath',
      'prepareBattleRuntimeAfterLoad',
      'localStorage.removeItem',
      'location.reload'
    ]) {
      expect(body).not.toContain(forbidden)
    }
  })

  it('不存在 setTimeout、额外 interval、watcher 或 Promise 自动重试 bootstrap', () => {
    const src = readFileSync(resolve(ROOT, 'src/App.vue'), 'utf8')
    expect(src).not.toMatch(/setTimeout/)
    const m = src.match(/function initializeAppRuntime\(\)\s*\{[\s\S]*?\n\}/)
    expect(m).toBeTruthy()
    const body = m![0]
    expect(body).not.toMatch(/setInterval/)
    expect(body).not.toMatch(/\.then\(/)
    expect(body).not.toMatch(/await /)
  })
})
