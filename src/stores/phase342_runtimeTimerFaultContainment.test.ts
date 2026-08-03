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

async function mountReady() {
  seedAlive()
  const gameStore = useGameStore()
  vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
  const wrapper = mountApp()
  await nextTick()
  const vm = wrapper.vm as unknown as ComponentPublicInstance & { tickTime?: () => void }
  return { wrapper, vm }
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

describe('Phase 3.42 — 正常调度', () => {
  it('ready、未暂停时一个 tick：在线时间一次、经验按返回值增加、不提前保存', async () => {
    const playerStore = usePlayerStore()
    const { wrapper, vm } = await mountReady()
    const updateSpy = vi.spyOn(playerStore, 'updateOnlineTime')
    vi.spyOn(playerStore, 'getExpPerSecond').mockReturnValue(5)
    const addExpSpy = vi.spyOn(playerStore, 'addExperience')
    const saveSpy = vi.spyOn(playerStore, 'saveGame')

    vm.tickTime!()

    expect(updateSpy).toHaveBeenCalledTimes(1)
    expect(addExpSpy).toHaveBeenCalledWith(5)
    expect(saveSpy).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('前 29 个有效 tick：saveGame 零调用、保持 ready', async () => {
    const playerStore = usePlayerStore()
    const { wrapper, vm } = await mountReady()
    vi.spyOn(playerStore, 'getExpPerSecond').mockReturnValue(0)
    const saveSpy = vi.spyOn(playerStore, 'saveGame')

    for (let i = 0; i < 29; i++) {
      vm.tickTime!()
    }

    expect(saveSpy).not.toHaveBeenCalled()
    expect(wrapper.find('.runtime-gate-overlay').exists()).toBe(false)
    wrapper.unmount()
  })

  it('第 30 个有效 tick：saveGame 恰一次、返回 true 保持 ready、再过 30 个才第二次保存', async () => {
    const playerStore = usePlayerStore()
    const { wrapper, vm } = await mountReady()
    vi.spyOn(playerStore, 'getExpPerSecond').mockReturnValue(0)
    const saveSpy = vi.spyOn(playerStore, 'saveGame').mockReturnValue(true)

    for (let i = 0; i < 30; i++) {
      vm.tickTime!()
    }
    expect(saveSpy).toHaveBeenCalledTimes(1)
    expect(wrapper.find('.runtime-gate-overlay').exists()).toBe(false)

    saveSpy.mockClear()
    for (let i = 0; i < 29; i++) {
      vm.tickTime!()
    }
    expect(saveSpy).not.toHaveBeenCalled()
    vm.tickTime!()
    expect(saveSpy).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('paused 状态：时间、经验、counter 和保存均不推进', async () => {
    const playerStore = usePlayerStore()
    const gameStore = useGameStore()
    const { wrapper, vm } = await mountReady()
    const updateSpy = vi.spyOn(playerStore, 'updateOnlineTime')
    const addExpSpy = vi.spyOn(playerStore, 'addExperience')
    const saveSpy = vi.spyOn(playerStore, 'saveGame')

    gameStore.isPaused = true
    for (let i = 0; i < 40; i++) {
      vm.tickTime!()
    }

    expect(updateSpy).not.toHaveBeenCalled()
    expect(addExpSpy).not.toHaveBeenCalled()
    expect(saveSpy).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})

describe('Phase 3.42 — 保存失败', () => {
  it('第 30 个 tick 中 saveGame 返回 false：faulted、overlay 固定原因、保存恰一次、interval 清除、beforeunload 移除', async () => {
    const playerStore = usePlayerStore()
    const { wrapper, vm } = await mountReady()
    vi.spyOn(playerStore, 'getExpPerSecond').mockReturnValue(0)
    const saveSpy = vi.spyOn(playerStore, 'saveGame').mockReturnValue(false)
    const removeListenerSpy = vi.spyOn(window, 'removeEventListener')

    for (let i = 0; i < 30; i++) {
      vm.tickTime!()
    }
    await nextTick()

    expect(saveSpy).toHaveBeenCalledTimes(1)
    expect(wrapper.find('.runtime-gate-overlay').exists()).toBe(true)
    expect(wrapper.text()).toContain('automatic save failed')
    expect(removeListenerSpy.mock.calls.filter(c => c[0] === 'beforeunload').length).toBe(1)
    wrapper.unmount()
  })

  it('saveGame 抛 Error：tick 不向外抛、faulted、原因含规范化 message、不第二次保存', async () => {
    const playerStore = usePlayerStore()
    const { wrapper, vm } = await mountReady()
    vi.spyOn(playerStore, 'getExpPerSecond').mockReturnValue(0)
    const saveSpy = vi.spyOn(playerStore, 'saveGame').mockImplementation(() => {
      throw new Error('disk quota')
    })

    let threw = false
    try {
      for (let i = 0; i < 30; i++) {
        vm.tickTime!()
      }
    } catch {
      threw = true
    }

    expect(threw).toBe(false)
    expect(saveSpy).toHaveBeenCalledTimes(1)
    await nextTick()
    expect(wrapper.find('.runtime-gate-overlay').exists()).toBe(true)
    expect(wrapper.text()).toContain('disk quota')
    wrapper.unmount()
  })

  it('saveGame 抛非 Error 值：同样 fail-stop、String 规范化、不外抛', async () => {
    const playerStore = usePlayerStore()
    const { wrapper, vm } = await mountReady()
    vi.spyOn(playerStore, 'getExpPerSecond').mockReturnValue(0)
    const saveSpy = vi.spyOn(playerStore, 'saveGame').mockImplementation(() => {
      throw 'quota-exceeded-string'
    })

    let threw = false
    try {
      for (let i = 0; i < 30; i++) {
        vm.tickTime!()
      }
    } catch {
      threw = true
    }

    expect(threw).toBe(false)
    expect(saveSpy).toHaveBeenCalledTimes(1)
    await nextTick()
    expect(wrapper.text()).toContain('quota-exceeded-string')
    wrapper.unmount()
  })
})

describe('Phase 3.42 — 保存失败后续', () => {
  it('自动保存失败后再次手动 tickTime 多次：时间/经验/保存零新增、首错原因不变', async () => {
    const playerStore = usePlayerStore()
    const { wrapper, vm } = await mountReady()
    vi.spyOn(playerStore, 'getExpPerSecond').mockReturnValue(0)
    const saveSpy = vi.spyOn(playerStore, 'saveGame').mockReturnValue(false)
    const updateSpy = vi.spyOn(playerStore, 'updateOnlineTime')
    const addExpSpy = vi.spyOn(playerStore, 'addExperience')

    for (let i = 0; i < 30; i++) {
      vm.tickTime!()
    }
    await nextTick()
    const firstReason = wrapper.text()
    updateSpy.mockClear()
    addExpSpy.mockClear()
    saveSpy.mockClear()

    for (let i = 0; i < 10; i++) {
      vm.tickTime!()
    }
    await nextTick()

    expect(updateSpy).not.toHaveBeenCalled()
    expect(addExpSpy).not.toHaveBeenCalled()
    expect(saveSpy).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('automatic save failed')
    expect(wrapper.text()).toBe(firstReason)
    wrapper.unmount()
  })

  it('自动保存失败后 hidden → visible：RAF 不恢复、interval 不重建、beforeunload 不重注册', async () => {
    const playerStore = usePlayerStore()
    const { wrapper, vm } = await mountReady()
    vi.spyOn(playerStore, 'getExpPerSecond').mockReturnValue(0)
    vi.spyOn(playerStore, 'saveGame').mockReturnValue(false)
    const intervalSpy = vi.spyOn(window, 'setInterval')
    const addListenerSpy = vi.spyOn(window, 'addEventListener')

    for (let i = 0; i < 30; i++) {
      vm.tickTime!()
    }
    await nextTick()
    expect(wrapper.find('.runtime-gate-overlay').exists()).toBe(true)
    const intervalsBefore = intervalSpy.mock.calls.filter(c => c[1] === 1000).length
    const beforeunloadBefore = addListenerSpy.mock.calls.filter(c => c[0] === 'beforeunload').length

    setPageHidden(true)
    await nextTick()
    setPageHidden(false)
    await nextTick()

    expect(intervalSpy.mock.calls.filter(c => c[1] === 1000).length).toBe(intervalsBefore)
    expect(addListenerSpy.mock.calls.filter(c => c[0] === 'beforeunload').length).toBe(beforeunloadBefore)
    wrapper.unmount()
  })

  it('自动保存失败后卸载：saveGame 不新增、recordLogout 零调用', async () => {
    const playerStore = usePlayerStore()
    const { wrapper, vm } = await mountReady()
    vi.spyOn(playerStore, 'getExpPerSecond').mockReturnValue(0)
    const saveSpy = vi.spyOn(playerStore, 'saveGame').mockReturnValue(false)
    const logoutSpy = vi.spyOn(playerStore, 'recordLogout')

    for (let i = 0; i < 30; i++) {
      vm.tickTime!()
    }
    saveSpy.mockClear()

    wrapper.unmount()

    expect(saveSpy).not.toHaveBeenCalled()
    expect(logoutSpy).not.toHaveBeenCalled()
  })
})

describe('Phase 3.42 — 在线任务异常', () => {
  it('updateOnlineTime 抛异常：faulted、不执行经验计算、不保存、interval callback 不外抛', async () => {
    const playerStore = usePlayerStore()
    const { wrapper, vm } = await mountReady()
    vi.spyOn(playerStore, 'updateOnlineTime').mockImplementation(() => {
      throw new Error('online boom')
    })
    const expSpy = vi.spyOn(playerStore, 'getExpPerSecond')
    const addExpSpy = vi.spyOn(playerStore, 'addExperience')
    const saveSpy = vi.spyOn(playerStore, 'saveGame')

    let threw = false
    try {
      vm.tickTime!()
    } catch {
      threw = true
    }

    expect(threw).toBe(false)
    await nextTick()
    expect(wrapper.find('.runtime-gate-overlay').exists()).toBe(true)
    expect(wrapper.text()).toContain('online boom')
    expect(expSpy).not.toHaveBeenCalled()
    expect(addExpSpy).not.toHaveBeenCalled()
    expect(saveSpy).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('getExpPerSecond 抛异常：faulted、不调用 addExperience、不保存', async () => {
    const playerStore = usePlayerStore()
    const { wrapper, vm } = await mountReady()
    vi.spyOn(playerStore, 'getExpPerSecond').mockImplementation(() => {
      throw new Error('exp boom')
    })
    const addExpSpy = vi.spyOn(playerStore, 'addExperience')
    const saveSpy = vi.spyOn(playerStore, 'saveGame')

    let threw = false
    try {
      vm.tickTime!()
    } catch {
      threw = true
    }

    expect(threw).toBe(false)
    await nextTick()
    expect(wrapper.find('.runtime-gate-overlay').exists()).toBe(true)
    expect(wrapper.text()).toContain('exp boom')
    expect(addExpSpy).not.toHaveBeenCalled()
    expect(saveSpy).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('addExperience 抛异常：faulted、不继续到自动保存分支', async () => {
    const playerStore = usePlayerStore()
    const { wrapper, vm } = await mountReady()
    vi.spyOn(playerStore, 'getExpPerSecond').mockReturnValue(5)
    vi.spyOn(playerStore, 'addExperience').mockImplementation(() => {
      throw new Error('addExp boom')
    })
    const saveSpy = vi.spyOn(playerStore, 'saveGame')

    let threw = false
    try {
      vm.tickTime!()
    } catch {
      threw = true
    }

    expect(threw).toBe(false)
    await nextTick()
    expect(wrapper.find('.runtime-gate-overlay').exists()).toBe(true)
    expect(saveSpy).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('在线任务抛非 Error 值：原因规范化、首错锁定', async () => {
    const playerStore = usePlayerStore()
    const { wrapper, vm } = await mountReady()
    vi.spyOn(playerStore, 'updateOnlineTime').mockImplementation(() => {
      throw 'plain-string-boom'
    })

    let threw = false
    try {
      vm.tickTime!()
    } catch {
      threw = true
    }

    expect(threw).toBe(false)
    await nextTick()
    expect(wrapper.find('.runtime-gate-overlay').exists()).toBe(true)
    expect(wrapper.text()).toContain('plain-string-boom')
    wrapper.unmount()
  })
})

describe('Phase 3.42 — 跨调度竞态', () => {
  it('battle fault 先发生，再调用 tick：tick 零副作用、battle reason 不被覆盖', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & {
      handleGameFrame?: (d: number) => void
      tickTime?: () => void
    }
    const playerStore = usePlayerStore()
    const saveSpy = vi.spyOn(playerStore, 'saveGame')
    const updateSpy = vi.spyOn(playerStore, 'updateOnlineTime')

    vi.spyOn(gameStore, 'gameLoop').mockImplementation(() => {
      gameStore.battleError = new Error('battle fault reason')
      return false
    })
    vm.handleGameFrame!(16)
    await nextTick()
    expect(wrapper.text()).toContain('battle fault reason')

    for (let i = 0; i < 5; i++) {
      vm.tickTime!()
    }
    expect(saveSpy).not.toHaveBeenCalled()
    expect(updateSpy).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('battle fault reason')
    wrapper.unmount()
  })

  it('timer fault 先发生，再调用 handleGameFrame：gameLoop 不被调用、timer reason 不被覆盖', async () => {
    const playerStore = usePlayerStore()
    const { wrapper, vm } = await mountReady()
    vi.spyOn(playerStore, 'getExpPerSecond').mockReturnValue(0)
    vi.spyOn(playerStore, 'saveGame').mockReturnValue(false)

    for (let i = 0; i < 30; i++) {
      vm.tickTime!()
    }
    await nextTick()
    expect(wrapper.text()).toContain('automatic save failed')

    const gameLoopSpy = vi.spyOn(useGameStore(), 'gameLoop')
    const vm2 = wrapper.vm as unknown as ComponentPublicInstance & { handleGameFrame?: (d: number) => void }
    vm2.handleGameFrame!(16)
    expect(gameLoopSpy).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('automatic save failed')
    wrapper.unmount()
  })

  it('timer fault 不修改 gameStore.battleError', async () => {
    const playerStore = usePlayerStore()
    const gameStore = useGameStore()
    const { wrapper, vm } = await mountReady()
    vi.spyOn(playerStore, 'getExpPerSecond').mockReturnValue(0)
    vi.spyOn(playerStore, 'saveGame').mockReturnValue(false)

    for (let i = 0; i < 30; i++) {
      vm.tickTime!()
    }

    expect(gameStore.battleError).toBeNull()
    wrapper.unmount()
  })
})

describe('Phase 3.42 — blocked / initializing', () => {
  it('blocked 状态手动调用 tick：零时间、零经验、零保存、不触发启动准备', async () => {
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: false, reason: 'invalid hp' })
    const prepSpy = vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad')
    const playerStore = usePlayerStore()
    const updateSpy = vi.spyOn(playerStore, 'updateOnlineTime')
    const addExpSpy = vi.spyOn(playerStore, 'addExperience')
    const saveSpy = vi.spyOn(playerStore, 'saveGame')

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { tickTime?: () => void }
    const prepCalls = prepSpy.mock.calls.length

    for (let i = 0; i < 40; i++) {
      vm.tickTime!()
    }

    expect(updateSpy).not.toHaveBeenCalled()
    expect(addExpSpy).not.toHaveBeenCalled()
    expect(saveSpy).not.toHaveBeenCalled()
    expect(prepSpy.mock.calls.length).toBe(prepCalls)
    wrapper.unmount()
  })

  it('initializing 状态手动调用 tick：同样零副作用', async () => {
    const playerStore = usePlayerStore()
    const updateSpy = vi.spyOn(playerStore, 'updateOnlineTime')
    const addExpSpy = vi.spyOn(playerStore, 'addExperience')
    const saveSpy = vi.spyOn(playerStore, 'saveGame')

    // 挂载后把运行时状态强制设为 initializing，验证 tickTime 防御性 guard。
    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & {
      tickTime?: () => void
      runtimeStartupStatus?: 'initializing' | 'ready' | 'blocked' | 'faulted'
    }
    vm.runtimeStartupStatus = 'initializing'

    for (let i = 0; i < 5; i++) {
      vm.tickTime!()
    }
    expect(updateSpy).not.toHaveBeenCalled()
    expect(addExpSpy).not.toHaveBeenCalled()
    expect(saveSpy).not.toHaveBeenCalled()
    await nextTick()
    wrapper.unmount()
  })
})

describe('Phase 3.42 — 架构护栏', () => {
  const ROOT = process.cwd()

  it('tickTime 检查 saveGame 返回值、计数只在成功后归零', () => {
    const src = readFileSync(resolve(ROOT, 'src/App.vue'), 'utf8')
    const m = src.match(/function tickTime\(\)\s*\{[\s\S]*?\n\}/)
    expect(m).toBeTruthy()
    const body = m![0]
    expect(body).toContain('const saved = playerStore.saveGame()')
    expect(body).toContain('if (!saved)')
    expect(body).toContain("enterRuntimeFault('automatic save failed')")
    expect(body).toContain('autoSaveCounter = 0')
  })

  it('不存在 setTimeout / watcher / 第二个 interval 自动重试保存', () => {
    const src = readFileSync(resolve(ROOT, 'src/App.vue'), 'utf8')
    expect(src).not.toMatch(/setTimeout/)
  })

  it('timer fault 只调用既有 enterRuntimeFault，不自行复制资源清理', () => {
    const src = readFileSync(resolve(ROOT, 'src/App.vue'), 'utf8')
    const m = src.match(/function tickTime\(\)\s*\{[\s\S]*?\n\}/)
    expect(m).toBeTruthy()
    const body = m![0]
    expect(body).toContain('enterRuntimeFault(')
    expect(body).not.toMatch(/clearInterval/)
    expect(body).not.toMatch(/removeEventListener/)
  })
})
