// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { usePlayerStore } from './playerStore'
import { useMonsterStore } from './monsterStore'
import { useGameStore } from './gameStore'
import { useTrainingStore } from './trainingStore'
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

const SAVE_KEY = 'lollipop_adventure_save'
const LAST_FLOOR_KEY = 'nz_last_floor'

/**
 * Phase 3.47 — 浏览器 beforeunload 持久化失败熔断。
 *
 * - playerStore.recordLogout() 收紧为返回 boolean：Date.now() 一次、saveGame(now) 一次、
 *   checkpoint 使用同一个 now；LAST_FLOOR_KEY 失败仍继续主存档。
 * - App 注册稳定的 handleBeforeUnload（ready guard）：recordLogout 返回 false / 抛异常 →
 *   faulted（beforeunload persistence failed）；成功后保持运行资源（其他 handler 可能取消导航）。
 * - 成功事件不设置永久 latch；false/throw 后 listener 已移除，再次 dispatch 零副作用。
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

/**
 * 统一 spy 启动期资源 API，并捕获实际注册的 beforeunload listener（同一函数引用）。
 * dispatch() 走真实事件分发路径触发该 listener。
 */
function spyResourcesWithBeforeUnload() {
  let captured: EventListener | null = null
  const originalAdd = window.addEventListener.bind(window)
  const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1)
  const cancelSpy = vi.spyOn(window, 'cancelAnimationFrame')
  const intervalSpy = vi.spyOn(window, 'setInterval')
  const clearSpy = vi.spyOn(window, 'clearInterval')
  const addSpy = vi.spyOn(window, 'addEventListener').mockImplementation((type: string, listener: unknown, options?: unknown) => {
    if (type === 'beforeunload') captured = listener as EventListener
    return originalAdd(type, listener as EventListenerOrEventListenerObject, options as AddEventListenerOptions | boolean | undefined)
  })
  const removeSpy = vi.spyOn(window, 'removeEventListener')
  return {
    rafSpy,
    cancelSpy,
    intervalSpy,
    clearSpy,
    addSpy,
    removeSpy,
    getListener: () => captured,
    dispatch: () => {
      window.dispatchEvent(new Event('beforeunload'))
    }
  }
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

describe('Phase 3.47 — Store 返回契约', () => {
  it('recordLogout 主存档成功返回 true', () => {
    const store = usePlayerStore()
    expect(store.recordLogout()).toBe(true)
    expect(localStorage.getItem(SAVE_KEY)).not.toBeNull()
  })

  it('recordLogout 主存档失败返回 false', () => {
    const store = usePlayerStore()
    const realSetItem = Storage.prototype.setItem.bind(localStorage)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key: string, value: string) => {
      if (key === SAVE_KEY) throw new Error('quota')
      return realSetItem(key, value)
    })
    expect(store.recordLogout()).toBe(false)
  })

  it('LAST_FLOOR_KEY 写入失败：仍调用主存档一次、按主存档结果返回', () => {
    const store = usePlayerStore()
    const realSetItem = Storage.prototype.setItem.bind(localStorage)
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key: string, value: string) => {
      if (key === LAST_FLOOR_KEY) throw new Error('floor quota')
      return realSetItem(key, value)
    })
    expect(store.recordLogout()).toBe(true)
    expect(setItemSpy.mock.calls.filter(c => c[0] === SAVE_KEY).length).toBe(1)
  })

  it('Date.now() 只调用一次', () => {
    const store = usePlayerStore()
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1234567890123)
    store.recordLogout()
    expect(nowSpy).toHaveBeenCalledTimes(1)
  })

  it('saveGame 使用同一个 now：成功后 checkpoint 精确推进', () => {
    const store = usePlayerStore()
    const fixed = 1234567890123
    expect(store.lastOfflineCheckpointAt).not.toBe(fixed)
    vi.spyOn(Date, 'now').mockReturnValue(fixed)
    expect(store.recordLogout()).toBe(true)
    expect(store.lastOfflineCheckpointAt).toBe(fixed)
  })

  it('saveGame 使用同一个 now：失败后 checkpoint 不变', () => {
    const store = usePlayerStore()
    const oldCp = 1234567890000
    store.lastOfflineCheckpointAt = oldCp
    const realSetItem = Storage.prototype.setItem.bind(localStorage)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key: string, value: string) => {
      if (key === SAVE_KEY) throw new Error('quota')
      return realSetItem(key, value)
    })
    vi.spyOn(Date, 'now').mockReturnValue(1234567890123)
    expect(store.recordLogout()).toBe(false)
    expect(store.lastOfflineCheckpointAt).toBe(oldCp)
  })

  it('recordLogout 不重试保存（主存档 setItem 恰好一次）', () => {
    const store = usePlayerStore()
    const realSetItem = Storage.prototype.setItem.bind(localStorage)
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key: string, value: string) => {
      if (key === SAVE_KEY) throw new Error('quota')
      return realSetItem(key, value)
    })
    store.recordLogout()
    expect(setItemSpy.mock.calls.filter(c => c[0] === SAVE_KEY).length).toBe(1)
  })
})

describe('Phase 3.47 — Listener 所有权', () => {
  it('ready 启动只注册一个 handleBeforeUnload，且不是 playerStore.recordLogout', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    const playerStore = usePlayerStore()
    const { addSpy, getListener } = spyResourcesWithBeforeUnload()

    const wrapper = mountApp()
    await nextTick()

    expect(addSpy.mock.calls.filter(c => c[0] === 'beforeunload').length).toBe(1)
    expect(getListener()).toBeTruthy()
    expect(getListener()).not.toBe(playerStore.recordLogout)
    wrapper.unmount()
  })

  it('stopRuntime 移除与注册完全相同的函数引用', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    vi.spyOn(gameStore, 'gameLoop').mockImplementation(() => {
      gameStore.battleError = new Error('battle reason')
      return false
    })
    const { getListener, removeSpy } = spyResourcesWithBeforeUnload()

    const wrapper = mountApp()
    await nextTick()
    const listener = getListener()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { handleGameFrame?: (d: number) => void }

    vm.handleGameFrame!(16) // 触发 fault → stopRuntime
    await nextTick()

    expect(removeSpy.mock.calls.filter(c => c[0] === 'beforeunload' && c[1] === listener).length).toBe(1)
    wrapper.unmount()
  })

  it('重复调用启动入口不重复注册 beforeunload', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    const { addSpy } = spyResourcesWithBeforeUnload()

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { attemptRuntimeStartup?: () => void }

    vm.attemptRuntimeStartup!()
    vm.attemptRuntimeStartup!()
    await nextTick()

    expect(addSpy.mock.calls.filter(c => c[0] === 'beforeunload').length).toBe(1)
    wrapper.unmount()
  })
})

describe('Phase 3.47 — 成功事件', () => {
  it('真实 dispatch beforeunload：recordLogout 一次、callback 不抛、status 仍 ready、资源保持运行', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    const playerStore = usePlayerStore()
    const logoutSpy = vi.spyOn(playerStore, 'recordLogout')
    const { cancelSpy, clearSpy, removeSpy, dispatch } = spyResourcesWithBeforeUnload()

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { runtimeStartupStatus?: string }

    let threw = false
    try {
      dispatch()
    } catch {
      threw = true
    }
    await nextTick()

    expect(threw).toBe(false)
    expect(logoutSpy).toHaveBeenCalledTimes(1)
    expect(vm.runtimeStartupStatus).toBe('ready')
    expect(wrapper.find('.runtime-gate-overlay').exists()).toBe(false)
    // 成功后保持运行资源
    expect(cancelSpy).not.toHaveBeenCalled()
    expect(clearSpy).not.toHaveBeenCalled()
    expect(removeSpy).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('成功事件后 tick/frame 仍可继续执行', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    vi.spyOn(gameStore, 'gameLoop').mockReturnValue(true)
    const playerStore = usePlayerStore()
    const updateSpy = vi.spyOn(playerStore, 'updateOnlineTime')
    const loopSpy = vi.spyOn(gameStore, 'gameLoop')
    const { dispatch } = spyResourcesWithBeforeUnload()

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { tickTime?: () => void, handleGameFrame?: (d: number) => void }

    dispatch()
    await nextTick()
    vm.tickTime!()
    vm.handleGameFrame!(16)

    expect(updateSpy).toHaveBeenCalledTimes(1)
    expect(loopSpy).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('两个独立成功事件各调用一次 recordLogout，不设置永久 latch', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    const playerStore = usePlayerStore()
    const logoutSpy = vi.spyOn(playerStore, 'recordLogout')
    const { dispatch } = spyResourcesWithBeforeUnload()

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { runtimeStartupStatus?: string }

    dispatch()
    dispatch()
    await nextTick()

    expect(logoutSpy).toHaveBeenCalledTimes(2)
    expect(vm.runtimeStartupStatus).toBe('ready')
    wrapper.unmount()
  })

  it('成功事件不调用 shutdown 保存', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    const playerStore = usePlayerStore()
    const saveSpy = vi.spyOn(playerStore, 'saveGame')
    const { dispatch } = spyResourcesWithBeforeUnload()

    const wrapper = mountApp()
    await nextTick()
    dispatch()
    await nextTick()

    // App 层不直接调用 saveGame（recordLogout 内部 saveGame 为闭包调用，不会被 proxy spy 捕获）
    expect(saveSpy).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})

describe('Phase 3.47 — false', () => {
  it('recordLogout 返回 false：dispatch 不抛、faulted、reason 精确为基础分类', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    const playerStore = usePlayerStore()
    const logoutSpy = vi.spyOn(playerStore, 'recordLogout').mockReturnValue(false)
    const { dispatch } = spyResourcesWithBeforeUnload()

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { runtimeStartupStatus?: string, runtimeStartupError?: string }

    let threw = false
    try {
      dispatch()
    } catch {
      threw = true
    }
    await nextTick()

    expect(threw).toBe(false)
    expect(logoutSpy).toHaveBeenCalledTimes(1)
    expect(vm.runtimeStartupStatus).toBe('faulted')
    expect(vm.runtimeStartupError).toBe('beforeunload persistence failed')
    expect(vm.runtimeStartupError).not.toContain(':')
    expect(vm.runtimeStartupError).not.toContain('undefined')
    expect(vm.runtimeStartupError).not.toContain('null')
    wrapper.unmount()
  })

  it('false 后 RAF、interval、listener 各清理一次', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    vi.spyOn(usePlayerStore(), 'recordLogout').mockReturnValue(false)
    const { cancelSpy, intervalSpy, clearSpy, removeSpy, dispatch } = spyResourcesWithBeforeUnload()

    const wrapper = mountApp()
    await nextTick()
    const runtimeSetIdx = intervalSpy.mock.calls.findIndex(c => c[1] === 1000)
    const runtimeIntervalId = intervalSpy.mock.results[runtimeSetIdx].value

    dispatch()
    await nextTick()

    expect(cancelSpy.mock.calls.filter(c => c[0] === 1).length).toBe(1)
    expect(clearSpy.mock.calls.filter(c => c[0] === runtimeIntervalId).length).toBe(1)
    expect(removeSpy.mock.calls.filter(c => c[0] === 'beforeunload').length).toBe(1)
    wrapper.unmount()
  })

  it('false 不额外调用 saveGame、不重试 recordLogout', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    const playerStore = usePlayerStore()
    const logoutSpy = vi.spyOn(playerStore, 'recordLogout').mockReturnValue(false)
    const saveSpy = vi.spyOn(playerStore, 'saveGame')
    const { dispatch } = spyResourcesWithBeforeUnload()

    const wrapper = mountApp()
    await nextTick()
    dispatch()
    await nextTick()

    expect(logoutSpy).toHaveBeenCalledTimes(1)
    expect(saveSpy).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('false 不修改 gameStore.battleError', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    vi.spyOn(usePlayerStore(), 'recordLogout').mockReturnValue(false)
    const { dispatch } = spyResourcesWithBeforeUnload()

    const wrapper = mountApp()
    await nextTick()
    dispatch()
    await nextTick()

    expect(gameStore.battleError).toBeNull()
    wrapper.unmount()
  })

  it('false 后第二次 dispatch：recordLogout 调用数不增加、cleanup 不重复、reason 不变', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    const playerStore = usePlayerStore()
    const logoutSpy = vi.spyOn(playerStore, 'recordLogout').mockReturnValue(false)
    const { cancelSpy, clearSpy, removeSpy, dispatch } = spyResourcesWithBeforeUnload()

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { runtimeStartupError?: string }

    dispatch()
    await nextTick()
    expect(logoutSpy).toHaveBeenCalledTimes(1)
    const cancelCount = cancelSpy.mock.calls.length
    const clearCount = clearSpy.mock.calls.length
    const removeCount = removeSpy.mock.calls.filter(c => c[0] === 'beforeunload').length

    dispatch() // listener 已被 stopRuntime 移除
    await nextTick()

    expect(logoutSpy).toHaveBeenCalledTimes(1)
    expect(cancelSpy.mock.calls.length).toBe(cancelCount)
    expect(clearSpy.mock.calls.length).toBe(clearCount)
    expect(removeSpy.mock.calls.filter(c => c[0] === 'beforeunload').length).toBe(removeCount)
    expect(vm.runtimeStartupError).toBe('beforeunload persistence failed')
    wrapper.unmount()
  })

  it('false 后 Vue unmount：不产生 shutdown save、reason 不被覆盖', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    const playerStore = usePlayerStore()
    vi.spyOn(playerStore, 'recordLogout').mockReturnValue(false)
    const saveSpy = vi.spyOn(playerStore, 'saveGame')
    const { dispatch } = spyResourcesWithBeforeUnload()

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { runtimeStartupError?: string }

    dispatch()
    await nextTick()
    expect(vm.runtimeStartupError).toBe('beforeunload persistence failed')

    wrapper.unmount()

    expect(saveSpy).not.toHaveBeenCalled()
    expect(vm.runtimeStartupError).toBe('beforeunload persistence failed')
    expect(vm.runtimeStartupError).not.toContain('shutdown save failed')
  })
})

describe('Phase 3.47 — throw', () => {
  it('recordLogout 抛 Error：callback 不抛、message 分类正确、资源清理', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    const logoutSpy = vi.spyOn(usePlayerStore(), 'recordLogout').mockImplementation(() => {
      throw new Error('quota boom')
    })
    const { cancelSpy, intervalSpy, clearSpy, removeSpy, dispatch } = spyResourcesWithBeforeUnload()

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { runtimeStartupError?: string }

    let threw = false
    try {
      dispatch()
    } catch {
      threw = true
    }
    await nextTick()

    expect(threw).toBe(false)
    expect(logoutSpy).toHaveBeenCalledTimes(1)
    expect(vm.runtimeStartupError).toBe('beforeunload persistence failed: quota boom')
    const runtimeSetIdx = intervalSpy.mock.calls.findIndex(c => c[1] === 1000)
    const runtimeIntervalId = intervalSpy.mock.results[runtimeSetIdx].value
    expect(cancelSpy.mock.calls.filter(c => c[0] === 1).length).toBe(1)
    expect(clearSpy.mock.calls.filter(c => c[0] === runtimeIntervalId).length).toBe(1)
    expect(removeSpy.mock.calls.filter(c => c[0] === 'beforeunload').length).toBe(1)
    wrapper.unmount()
  })

  it('recordLogout 抛非 Error：String 规范化、不外抛', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    vi.spyOn(usePlayerStore(), 'recordLogout').mockImplementation(() => {
      throw 'logout-string-boom'
    })
    const { dispatch } = spyResourcesWithBeforeUnload()

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { runtimeStartupError?: string }

    let threw = false
    try {
      dispatch()
    } catch {
      threw = true
    }
    await nextTick()

    expect(threw).toBe(false)
    expect(vm.runtimeStartupError).toBe('beforeunload persistence failed: logout-string-boom')
    wrapper.unmount()
  })

  it('recordLogout 抛空 message：无尾随冒号', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    vi.spyOn(usePlayerStore(), 'recordLogout').mockImplementation(() => {
      throw new Error('')
    })
    const { dispatch } = spyResourcesWithBeforeUnload()

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { runtimeStartupError?: string }

    dispatch()
    await nextTick()

    expect(vm.runtimeStartupError).toBe('beforeunload persistence failed')
    expect(vm.runtimeStartupError).not.toContain('beforeunload persistence failed:')
    wrapper.unmount()
  })

  it('已有 battleError 时抛异常：Store 引用/message 不变、App 用 beforeunload 分类', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    const existing = new Error('existing store fault')
    gameStore.battleError = existing
    vi.spyOn(usePlayerStore(), 'recordLogout').mockImplementation(() => {
      throw new Error('quota boom')
    })
    const { dispatch } = spyResourcesWithBeforeUnload()

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { runtimeStartupError?: string }

    dispatch()
    await nextTick()

    expect(gameStore.battleError).toBe(existing)
    expect(gameStore.battleError!.message).toBe('existing store fault')
    expect(vm.runtimeStartupError).toBe('beforeunload persistence failed: quota boom')
    wrapper.unmount()
  })
})

describe('Phase 3.47 — 非 ready 与 UI', () => {
  it('initializing/blocked/faulted 直接调用 handler 均不调用 recordLogout', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    const playerStore = usePlayerStore()
    const logoutSpy = vi.spyOn(playerStore, 'recordLogout')

    // initializing
    {
      const wrapper = mountApp()
      await nextTick()
      const vm = wrapper.vm as unknown as ComponentPublicInstance & { runtimeStartupStatus?: string, handleBeforeUnload?: () => void }
      vm.runtimeStartupStatus = 'initializing'
      vm.handleBeforeUnload!()
      expect(logoutSpy).not.toHaveBeenCalled()
      wrapper.unmount()
    }

    // blocked
    {
      const wrapper = mountApp()
      await nextTick()
      const vm = wrapper.vm as unknown as ComponentPublicInstance & { runtimeStartupStatus?: string, handleBeforeUnload?: () => void }
      vm.runtimeStartupStatus = 'blocked'
      vm.handleBeforeUnload!()
      expect(logoutSpy).not.toHaveBeenCalled()
      wrapper.unmount()
    }

    // faulted
    {
      const wrapper = mountApp()
      await nextTick()
      const vm = wrapper.vm as unknown as ComponentPublicInstance & { runtimeStartupStatus?: string, handleBeforeUnload?: () => void }
      vm.runtimeStartupStatus = 'faulted'
      vm.handleBeforeUnload!()
      expect(logoutSpy).not.toHaveBeenCalled()
      wrapper.unmount()
    }
  })

  it('beforeunload fault 后：offline modal 关闭、claim 不执行、skill/mode 被阻止', async () => {
    seedAlive()
    const playerStore = usePlayerStore()
    playerStore.pendingOfflineReward = { gold: 100, exp: 50 } as OfflineSettlement
    expect(playerStore.saveGame()).toBe(true) // 写盘让 loadGame 水合 pending

    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    const logoutSpy = vi.spyOn(playerStore, 'recordLogout').mockReturnValue(false)
    const useSkillSpy = vi.spyOn(gameStore, 'tryUsePlayerSkill')
    const resumeSpy = vi.spyOn(gameStore, 'resumeBattle')
    const { dispatch } = spyResourcesWithBeforeUnload()

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & {
      useSkill?: (i: number) => void
      switchBattleMode?: (m: 'main' | 'training') => void
      onClaimOffline?: () => void
    }
    expect(wrapper.find('.offline-reward-stub').exists()).toBe(true)

    dispatch()
    await nextTick()

    expect(logoutSpy).toHaveBeenCalledTimes(1)
    expect(wrapper.find('.offline-reward-stub').exists()).toBe(false)
    expect(playerStore.player.gold).toBe(0) // 未执行 claim
    vm.useSkill!(0)
    vm.switchBattleMode!('main')
    vm.onClaimOffline!()
    expect(useSkillSpy).not.toHaveBeenCalled()
    expect(resumeSpy).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('reload 按钮仍只 reload，不先保存或再次 recordLogout', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    const playerStore = usePlayerStore()
    const logoutSpy = vi.spyOn(playerStore, 'recordLogout').mockReturnValue(false)
    const saveSpy = vi.spyOn(playerStore, 'saveGame')
    const reloadSpy = vi.fn()
    const originalLocation = window.location
    const stubLocation = { ...originalLocation, reload: reloadSpy }
    Object.defineProperty(window, 'location', { configurable: true, value: stubLocation })
    const { dispatch } = spyResourcesWithBeforeUnload()

    const wrapper = mountApp()
    await nextTick()
    dispatch()
    await nextTick()
    expect(wrapper.find('.runtime-gate-overlay').exists()).toBe(true)

    const reloadBtn = wrapper.findAll('.runtime-gate-overlay button').find(b => b.text().includes('重新加载游戏'))
    expect(reloadBtn).toBeTruthy()
    reloadBtn!.trigger('click')

    expect(reloadSpy).toHaveBeenCalledTimes(1)
    expect(saveSpy).not.toHaveBeenCalled()
    expect(logoutSpy).toHaveBeenCalledTimes(1) // reload 不再触发 recordLogout
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation })
    wrapper.unmount()
  })
})

describe('Phase 3.47 — 架构护栏', () => {
  const ROOT = process.cwd()

  function handlerBody() {
    const src = readFileSync(resolve(ROOT, 'src/App.vue'), 'utf8')
    const m = src.match(/function handleBeforeUnload\(\)\s*\{[\s\S]*?\n\}/)
    expect(m).toBeTruthy()
    return m![0]
  }

  it('护栏：add/remove 使用同一个命名函数引用 handleBeforeUnload', () => {
    const src = readFileSync(resolve(ROOT, 'src/App.vue'), 'utf8')
    expect(src).toContain("window.addEventListener('beforeunload', handleBeforeUnload)")
    expect(src).toContain("window.removeEventListener('beforeunload', handleBeforeUnload)")
    expect(src).not.toContain("addEventListener('beforeunload', playerStore.recordLogout)")
    expect(src).not.toContain("removeEventListener('beforeunload', playerStore.recordLogout)")
  })

  it('护栏：handler 包含 ready guard', () => {
    const body = handlerBody()
    expect(body).toContain("runtimeStartupStatus.value !== 'ready'")
  })

  it('护栏：handler false 分支使用 beforeunload persistence failed', () => {
    const body = handlerBody()
    expect(body).toContain("enterRuntimeFault('beforeunload persistence failed')")
  })

  it('护栏：throw 分支复用 formatRuntimeFault 与 enterRuntimeFault', () => {
    const body = handlerBody()
    expect(body).toContain("enterRuntimeFault(formatRuntimeFault('beforeunload persistence failed', error))")
  })

  it('护栏：handler 不存在 saveGame/shutdown/第二次 recordLogout/preventDefault/returnValue/confirm/alert/reload/setTimeout', () => {
    const body = handlerBody()
    for (const forbidden of [
      'saveGame',
      'shutdownAppRuntime',
      'runtimeShutdownStarted',
      'preventDefault',
      'returnValue',
      'confirm',
      'alert',
      'location.reload',
      'setTimeout'
    ]) {
      expect(body).not.toContain(forbidden)
    }
    expect((body.match(/recordLogout\(\)/g) || []).length).toBe(1)
  })

  it('护栏：recordLogout 明确返回 saveGame(now)，不吞掉 false', () => {
    const src = readFileSync(resolve(ROOT, 'src/stores/playerStore.ts'), 'utf8')
    expect(src).toContain('function recordLogout(): boolean {')
    expect(src).toContain('return saveGame(now)')
  })
})
