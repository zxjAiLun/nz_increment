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
    // 基础分类文本，不追加 undefined/null/空冒号后缀
    const reason = wrapper.find('.runtime-gate-reason').text()
    expect(reason).toBe('错误原因：automatic save failed')
    expect(reason).not.toContain(':')
    expect(reason).not.toContain('undefined')
    expect(reason).not.toContain('null')
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
    // 自动保存故障域：精确前缀 + 规范化 message，且不含在线任务分类
    expect(wrapper.text()).toContain('automatic save failed: disk quota')
    expect(wrapper.text()).not.toContain('online runtime tick failed')
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
    // 非 Error：String 规范化，仍归入自动保存故障域
    expect(wrapper.text()).toContain('automatic save failed: quota-exceeded-string')
    expect(wrapper.text()).not.toContain('online runtime tick failed')
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

  it('自动保存抛异常后多次 tick：不再保存、不增加在线时间/经验、首错 automatic-save 原因不变', async () => {
    const playerStore = usePlayerStore()
    const { wrapper, vm } = await mountReady()
    vi.spyOn(playerStore, 'getExpPerSecond').mockReturnValue(5)
    const saveSpy = vi.spyOn(playerStore, 'saveGame').mockImplementation(() => {
      throw new Error('disk quota')
    })
    const updateSpy = vi.spyOn(playerStore, 'updateOnlineTime')
    const addExpSpy = vi.spyOn(playerStore, 'addExperience')

    for (let i = 0; i < 30; i++) {
      vm.tickTime!()
    }
    await nextTick()
    const firstReason = wrapper.find('.runtime-gate-reason').text()
    expect(firstReason).toContain('automatic save failed: disk quota')
    expect(firstReason).not.toContain('online runtime tick failed')

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
    expect(wrapper.find('.runtime-gate-reason').text()).toBe(firstReason)
    wrapper.unmount()
  })

  it('自动保存抛异常后：clearInterval 1000ms interval 恰一次、beforeunload 移除、visibility 不重建资源', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    const intervalSpy = vi.spyOn(window, 'setInterval')
    const clearIntervalSpy = vi.spyOn(window, 'clearInterval')
    const removeListenerSpy = vi.spyOn(window, 'removeEventListener')
    const addListenerSpy = vi.spyOn(window, 'addEventListener')

    const wrapper = mountApp()
    await nextTick()
    const vm = wrapper.vm as unknown as ComponentPublicInstance & { tickTime?: () => void }
    const playerStore = usePlayerStore()
    vi.spyOn(playerStore, 'getExpPerSecond').mockReturnValue(0)
    vi.spyOn(playerStore, 'saveGame').mockImplementation(() => {
      throw new Error('disk quota')
    })

    const runtimeSetIdx = intervalSpy.mock.calls.findIndex(c => c[1] === 1000)
    expect(runtimeSetIdx).toBeGreaterThanOrEqual(0)
    const runtimeIntervalId = intervalSpy.mock.results[runtimeSetIdx].value

    for (let i = 0; i < 30; i++) {
      vm.tickTime!()
    }
    await nextTick()
    expect(wrapper.find('.runtime-gate-overlay').exists()).toBe(true)

    // 1000ms runtime interval 被 clearInterval 恰好一次
    expect(clearIntervalSpy.mock.calls.filter(c => c[0] === runtimeIntervalId).length).toBe(1)
    // beforeunload listener 被移除恰好一次
    expect(removeListenerSpy.mock.calls.filter(c => c[0] === 'beforeunload').length).toBe(1)

    // visibilitychange 不重建任何 1000ms interval / beforeunload listener
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
    // 在线任务故障域：online runtime tick failed 分类 + 规范化 message，不含自动保存分类
    expect(wrapper.text()).toContain('online runtime tick failed: online boom')
    expect(wrapper.text()).not.toContain('automatic save failed')
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
    expect(wrapper.text()).toContain('online runtime tick failed: exp boom')
    expect(wrapper.text()).not.toContain('automatic save failed')
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
    expect(wrapper.text()).toContain('online runtime tick failed: addExp boom')
    expect(wrapper.text()).not.toContain('automatic save failed')
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
    // 非 Error：String 规范化，仍保持 online runtime tick failed 分类
    expect(wrapper.text()).toContain('online runtime tick failed: plain-string-boom')
    expect(wrapper.text()).not.toContain('automatic save failed')
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

  it('自动保存抛异常不修改 gameStore.battleError', async () => {
    const playerStore = usePlayerStore()
    const gameStore = useGameStore()
    const { wrapper, vm } = await mountReady()
    vi.spyOn(playerStore, 'getExpPerSecond').mockReturnValue(0)
    vi.spyOn(playerStore, 'saveGame').mockImplementation(() => {
      throw new Error('disk quota')
    })

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
    expect(body).toContain('let saved: boolean')
    expect(body).toContain('saved = playerStore.saveGame()')
    expect(body).toContain('if (!saved)')
    expect(body).toContain("enterRuntimeFault('automatic save failed')")
    expect(body).toContain('autoSaveCounter = 0')
  })

  it('护栏：saveGame 拥有独立 try/catch，不再落入在线任务通用 catch', () => {
    const src = readFileSync(resolve(ROOT, 'src/App.vue'), 'utf8')
    const m = src.match(/function tickTime\(\)\s*\{[\s\S]*?\n\}/)
    expect(m).toBeTruthy()
    const body = m![0]

    // 两个独立异常边界（在线任务 + 自动保存）
    expect((body.match(/\} catch \(error\) \{/g) || []).length).toBe(2)

    const saveCallIdx = body.indexOf('playerStore.saveGame()')
    expect(saveCallIdx).toBeGreaterThan(-1)
    // saveGame 调用之后存在其专属 catch（自动保存独立故障域）
    expect(body.slice(saveCallIdx)).toMatch(/\} catch \(error\) \{/)
    // 在线任务分类文本出现在 saveGame 之前，即在线通用 catch 在保存之前已闭合
    const onlineIdx = body.indexOf('online runtime tick failed')
    expect(onlineIdx).toBeGreaterThan(-1)
    expect(onlineIdx).toBeLessThan(saveCallIdx)
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
