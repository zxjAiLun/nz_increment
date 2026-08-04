// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { usePlayerStore } from './playerStore'
import { useMonsterStore } from './monsterStore'
import { useGameStore } from './gameStore'
import { useTrainingStore } from './trainingStore'
import { useATBStore } from './atbStore'
import { useRebirthStore } from './rebirthStore'
import type { OfflineSettlement } from '../utils/offlineReward'
import App from '../App.vue'
import type { ComponentPublicInstance } from 'vue'
// @ts-ignore —— 测试运行于 Node，无需在应用 tsconfig 中引入 @types/node 全局类型
import { readFileSync } from 'node:fs'
// @ts-ignore
import { resolve } from 'node:path'
// @ts-ignore
declare const process: { cwd(): string }

/**
 * Phase 3.57 — 异步 Modal Chunk 加载故障熔断。
 *
 * - App 通过共享 loadAsyncModal(loader, faultPrefix, close) 包装两个动态 import：
 *   catch rejection → 关闭对应 modal → 复用 formatRuntimeFault / enterRuntimeFault 进入
 *   既有 fail-stop → 返回 inert EmptyAsyncModal（不 rethrow、不 retry）。
 * - 精确 fault 分类：'rebirth modal loading failed' / 'offline reward modal loading failed'。
 * - 集成测试通过 vi.doMock 使真实动态 import reject；分类测试直接调用 vm.loadAsyncModal
 *   验证 Error / 非 Error / 空 Error 的 formatRuntimeFault 规范化。
 */

const REBIRTH_PATH = '../components/RebirthModal.vue'
const OFFLINE_PATH = '../components/OfflineRewardModal.vue'

const PENDING_FULL: OfflineSettlement = {
  id: 'off_test',
  createdAt: 1000,
  elapsedSeconds: 120,
  creditedSeconds: 120,
  gold: 100,
  exp: 50,
  formulaVersion: 1
}

function warmupStores() {
  usePlayerStore()
  useMonsterStore()
  useGameStore()
  useTrainingStore()
  useATBStore()
  useRebirthStore()
}

function seedAlive() {
  const playerStore = usePlayerStore()
  const monsterStore = useMonsterStore()
  playerStore.player.currentHp = 100
  playerStore.player.maxHp = 100
  monsterStore.setProgress(20, 20)
}

function seedPending() {
  const playerStore = usePlayerStore()
  playerStore.pendingOfflineReward = PENDING_FULL
  expect(playerStore.saveGame()).toBe(true)
}

type AppVm = ComponentPublicInstance & {
  loadAsyncModal?: (loader: () => Promise<unknown>, prefix: string, close: () => void) => Promise<unknown>
  EmptyAsyncModal?: { render: () => unknown }
  showRebirthModal?: boolean
  showRebirthShop?: boolean
  showOfflineModal?: boolean
  runtimeStartupStatus?: 'initializing' | 'ready' | 'blocked' | 'faulted'
  runtimeStartupError?: string
  onClaimOffline?: () => void
  useSkill?: (i: number) => void
  switchBattleMode?: (m: 'main' | 'training') => void
  goBackLevels?: () => void
  confirmReset?: () => void
  performRebirth?: () => void
  purchaseRebirthUpgrade?: (upgradeId: string) => void
}

/** 挂载 App（真实模块，不 stub 两个 modal）。 */
function mountAppReal() {
  seedAlive()
  const playerStore = usePlayerStore()
  const gameStore = useGameStore()
  vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
  const wrapper = mount(App, {
    global: {
      stubs: {
        BattleHUD: true,
        PlayerStatusBar: true,
        OverlayContainer: true,
        TabsContainer: true,
        PauseOverlay: true
      }
    }
  })
  return { wrapper, playerStore, gameStore }
}

async function mountReadyReal() {
  const m = mountAppReal()
  await nextTick()
  const vm = m.wrapper.vm as unknown as AppVm
  return { ...m, vm }
}

/** 统一 spy 启动期资源 API。 */
function spyCleanup() {
  const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1)
  const cancelSpy = vi.spyOn(window, 'cancelAnimationFrame')
  const intervalSpy = vi.spyOn(window, 'setInterval')
  const clearSpy = vi.spyOn(window, 'clearInterval')
  const addSpy = vi.spyOn(window, 'addEventListener')
  const removeSpy = vi.spyOn(window, 'removeEventListener')
  return { rafSpy, cancelSpy, intervalSpy, clearSpy, addSpy, removeSpy }
}

/** 记录 window unhandledrejection 事件。 */
function trackUnhandled() {
  const unhandled: unknown[] = []
  const handler = (e: PromiseRejectionEvent) => {
    unhandled.push(e.reason)
  }
  window.addEventListener('unhandledrejection', handler)
  return {
    list: unhandled,
    stop: () => window.removeEventListener('unhandledrejection', handler)
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
  vi.doUnmock(REBIRTH_PATH)
  vi.doUnmock(OFFLINE_PATH)
})

describe('Phase 3.57 — 架构护栏', () => {
  const ROOT = process.cwd()
  const APP_PATH = resolve(ROOT, 'src/App.vue')
  const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\r\n]*/g, '')
  const SRC = stripComments(readFileSync(APP_PATH, 'utf8'))

  it('护栏：两个 modal 均无静态 import', () => {
    expect(SRC).not.toMatch(/import\s+RebirthModal\s+from/)
    expect(SRC).not.toMatch(/import\s+OfflineRewardModal\s+from/)
  })

  it('护栏：两个精确动态 import 各出现一次', () => {
    expect((SRC.match(/import\('\.\/components\/RebirthModal\.vue'\)/g) || []).length).toBe(1)
    expect((SRC.match(/import\('\.\/components\/OfflineRewardModal\.vue'\)/g) || []).length).toBe(1)
  })

  it('护栏：两个组件均继续使用 defineAsyncComponent', () => {
    expect(SRC).toMatch(/const RebirthModal = defineAsyncComponent\(/)
    expect(SRC).toMatch(/const OfflineRewardModal = defineAsyncComponent\(/)
  })

  it('护栏：两个 loader 均通过同一共享 loadAsyncModal helper', () => {
    expect(SRC).toMatch(/const RebirthModal = defineAsyncComponent\([\s\S]*loadAsyncModal\([\s\S]*import\('\.\/components\/RebirthModal\.vue'\)/)
    expect(SRC).toMatch(/const OfflineRewardModal = defineAsyncComponent\([\s\S]*loadAsyncModal\([\s\S]*import\('\.\/components\/OfflineRewardModal\.vue'\)/)
  })

  it('护栏：helper catch rejection', () => {
    const m = SRC.match(/function loadAsyncModal\([\s\S]*?\n\}/)
    expect(m).toBeTruthy()
    expect(m![0]).toContain('.catch(')
  })

  it('护栏：helper 调用 formatRuntimeFault 与 enterRuntimeFault', () => {
    const m = SRC.match(/function loadAsyncModal\([\s\S]*?\n\}/)
    expect(m).toBeTruthy()
    expect(m![0]).toContain('formatRuntimeFault(')
    expect(m![0]).toContain('enterRuntimeFault(')
  })

  it('护栏：helper 返回 inert component、不 rethrow', () => {
    const m = SRC.match(/function loadAsyncModal\([\s\S]*?\n\}/)
    expect(m).toBeTruthy()
    expect(m![0]).toContain('return EmptyAsyncModal')
    expect(m![0]).not.toContain('throw')
    expect(SRC).toMatch(/const EmptyAsyncModal = \{\s*render: \(\) => null\s*\}/)
  })

  it('护栏：无 retry、reload、preload 或全局 error handler', () => {
    const m = SRC.match(/function loadAsyncModal\([\s\S]*?\n\}/)
    expect(m).toBeTruthy()
    for (const forbidden of ['retry', 'reload', 'setTimeout', 'errorHandler', 'unhandledrejection', 'addEventListener']) {
      expect(m![0]).not.toContain(forbidden)
    }
    expect(SRC).not.toMatch(/import\('\.\/components\/RebirthModal\.vue'\)\.catch\(/)
    expect(SRC).not.toMatch(/import\('\.\/components\/OfflineRewardModal\.vue'\)\.catch\(/)
  })

  it('护栏：两个既有 v-if 保持', () => {
    expect(SRC).toMatch(/v-if="\s*showRebirthModal\s*\|\|\s*showRebirthShop\s*"/)
    expect(SRC).toMatch(/v-if="showOfflineModal"/)
  })
})

describe('Phase 3.57 — RebirthModal loader failure 分类（共享 helper）', () => {
  it('Error 精确分类：rebirth modal loading failed: chunk boom', async () => {
    const { wrapper, vm } = await mountReadyReal()
    const closeSpy = vi.fn()
    const result = await vm.loadAsyncModal!(
      () => Promise.reject(new Error('chunk boom')),
      'rebirth modal loading failed',
      closeSpy
    )
    expect(vm.runtimeStartupStatus).toBe('faulted')
    expect(vm.runtimeStartupError).toBe('rebirth modal loading failed: chunk boom')
    expect(closeSpy).toHaveBeenCalledTimes(1)
    expect((result as { render: () => unknown }).render()).toBeNull() // inert 收敛
    wrapper.unmount()
  })

  it('非 Error：String 规范化', async () => {
    const { wrapper, vm } = await mountReadyReal()
    const closeSpy = vi.fn()
    await vm.loadAsyncModal!(
      () => Promise.reject('chunk-string-boom'),
      'rebirth modal loading failed',
      closeSpy
    )
    expect(vm.runtimeStartupError).toBe('rebirth modal loading failed: chunk-string-boom')
    expect(closeSpy).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('空 Error：无尾随冒号', async () => {
    const { wrapper, vm } = await mountReadyReal()
    await vm.loadAsyncModal!(
      () => Promise.reject(new Error('')),
      'rebirth modal loading failed',
      () => {}
    )
    expect(vm.runtimeStartupError).toBe('rebirth modal loading failed')
    expect(vm.runtimeStartupError).not.toContain('rebirth modal loading failed:')
    wrapper.unmount()
  })
})

describe('Phase 3.57 — RebirthModal loader failure（真实动态 import reject）', () => {
  it('真实 loader rejection 不外抛', async () => {
    vi.doMock(REBIRTH_PATH, () => {
      throw new Error('chunk boom')
    })
    const { wrapper, vm } = await mountReadyReal()
    vm.showRebirthModal = true
    let threw = false
    try {
      await flushPromises()
      await vi.dynamicImportSettled()
      await nextTick()
    } catch {
      threw = true
    }
    expect(threw).toBe(false)
    expect(vm.runtimeStartupStatus).toBe('faulted')
    wrapper.unmount()
  })

  it('无 unhandled rejection', async () => {
    vi.doMock(REBIRTH_PATH, () => {
      throw new Error('chunk boom')
    })
    const track = trackUnhandled()
    const { wrapper, vm } = await mountReadyReal()
    vm.showRebirthModal = true
    await flushPromises()
    await vi.dynamicImportSettled()
    await nextTick()
    track.stop()
    expect(track.list.length).toBe(0)
    expect(vm.runtimeStartupStatus).toBe('faulted')
    wrapper.unmount()
  })

  it('modal/shop 均关闭、DOM 不出现', async () => {
    vi.doMock(REBIRTH_PATH, () => {
      throw new Error('chunk boom')
    })
    const { wrapper, vm } = await mountReadyReal()
    vm.showRebirthModal = true
    vm.showRebirthShop = true
    await flushPromises()
    await vi.dynamicImportSettled()
    await nextTick()
    expect(vm.showRebirthModal).toBe(false)
    expect(vm.showRebirthShop).toBe(false)
    expect(wrapper.find('.rebirth-modal').exists()).toBe(false)
    wrapper.unmount()
  })

  it('Store action、alert、保存均零调用', async () => {
    vi.doMock(REBIRTH_PATH, () => {
      throw new Error('chunk boom')
    })
    const { wrapper, vm, playerStore } = await mountReadyReal()
    const rebirthStore = useRebirthStore()
    const alertSpy = vi.fn()
    vi.stubGlobal('alert', alertSpy)
    const performSpy = vi.spyOn(rebirthStore, 'performRebirth')
    const purchaseSpy = vi.spyOn(rebirthStore, 'purchaseUpgrade')
    const saveSpy = vi.spyOn(playerStore, 'saveGame')
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    vm.showRebirthModal = true
    await flushPromises()
    await vi.dynamicImportSettled()
    await nextTick()
    expect(vm.runtimeStartupStatus).toBe('faulted')
    expect(performSpy).not.toHaveBeenCalled()
    expect(purchaseSpy).not.toHaveBeenCalled()
    expect(alertSpy).not.toHaveBeenCalled()
    expect(saveSpy).not.toHaveBeenCalled()
    expect(setItemSpy.mock.calls.filter(c => c[0] === 'rebirth_data').length).toBe(0)
    wrapper.unmount()
  })

  it('rebirth/player/monster 状态不变', async () => {
    vi.doMock(REBIRTH_PATH, () => {
      throw new Error('chunk boom')
    })
    const { wrapper, vm } = await mountReadyReal()
    const rebirthStore = useRebirthStore()
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    const pointsBefore = rebirthStore.rebirthPoints
    const upgradesLenBefore = rebirthStore.upgrades.length
    const hpBefore = playerStore.player.currentHp
    const diffBefore = monsterStore.difficultyValue
    vm.showRebirthModal = true
    await flushPromises()
    await vi.dynamicImportSettled()
    await nextTick()
    expect(rebirthStore.rebirthPoints).toBe(pointsBefore)
    expect(rebirthStore.upgrades.length).toBe(upgradesLenBefore)
    expect(playerStore.player.currentHp).toBe(hpBefore)
    expect(monsterStore.difficultyValue).toBe(diffBefore)
    wrapper.unmount()
  })

  it('battleError 原引用保持', async () => {
    vi.doMock(REBIRTH_PATH, () => {
      throw new Error('chunk boom')
    })
    const { wrapper, vm, gameStore } = await mountReadyReal()
    const existing = new Error('existing store fault')
    gameStore.battleError = existing
    vm.showRebirthModal = true
    await flushPromises()
    await vi.dynamicImportSettled()
    await nextTick()
    expect(gameStore.battleError).toBe(existing)
    expect(gameStore.battleError!.message).toBe('existing store fault')
    wrapper.unmount()
  })

  it('RAF、interval、listener 各清理一次', async () => {
    vi.doMock(REBIRTH_PATH, () => {
      throw new Error('chunk boom')
    })
    const { cancelSpy, intervalSpy, clearSpy, removeSpy } = spyCleanup()
    const { wrapper, vm } = await mountReadyReal()
    vm.showRebirthModal = true
    await flushPromises()
    await vi.dynamicImportSettled()
    await nextTick()
    const runtimeSetIdx = intervalSpy.mock.calls.findIndex(c => c[1] === 1000)
    const runtimeIntervalId = intervalSpy.mock.results[runtimeSetIdx].value
    expect(cancelSpy.mock.calls.filter(c => c[0] === 1).length).toBe(1)
    expect(clearSpy.mock.calls.filter(c => c[0] === runtimeIntervalId).length).toBe(1)
    expect(removeSpy.mock.calls.filter(c => c[0] === 'beforeunload').length).toBe(1)
    wrapper.unmount()
  })

  it('cleanup 同时 throw 保持 loader 首错', async () => {
    vi.doMock(REBIRTH_PATH, () => {
      throw new Error('chunk boom')
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {
      throw new Error('cancel boom')
    })
    const { wrapper, vm } = await mountReadyReal()
    vm.showRebirthModal = true
    await flushPromises()
    await vi.dynamicImportSettled()
    await nextTick()
    expect(vm.runtimeStartupError).toMatch(/^rebirth modal loading failed: /)
    expect(vm.runtimeStartupError).not.toContain('runtime cleanup failed')
    wrapper.unmount()
  })

  it('重复展示不 retry、不重复调用 loader', async () => {
    let factoryCalls = 0
    vi.doMock(REBIRTH_PATH, () => {
      factoryCalls++
      throw new Error('chunk boom')
    })
    const { wrapper, vm } = await mountReadyReal()
    vm.showRebirthModal = true
    await flushPromises()
    await vi.dynamicImportSettled()
    await nextTick()
    expect(factoryCalls).toBe(1)
    const reasonBefore = vm.runtimeStartupError
    vm.showRebirthModal = false
    await nextTick()
    vm.showRebirthModal = true
    await flushPromises()
    await vi.dynamicImportSettled()
    await nextTick()
    expect(factoryCalls).toBe(1) // 模块已缓存为 inert，不再调用 loader
    expect(vm.runtimeStartupError).toBe(reasonBefore)
    expect(wrapper.find('.rebirth-modal').exists()).toBe(false)
    wrapper.unmount()
  })

  it('later unmount 零 shutdown save', async () => {
    vi.doMock(REBIRTH_PATH, () => {
      throw new Error('chunk boom')
    })
    const { wrapper, vm, playerStore } = await mountReadyReal()
    const saveSpy = vi.spyOn(playerStore, 'saveGame')
    vm.showRebirthModal = true
    await flushPromises()
    await vi.dynamicImportSettled()
    await nextTick()
    expect(vm.runtimeStartupStatus).toBe('faulted')
    wrapper.unmount()
    expect(saveSpy).not.toHaveBeenCalled()
  })
})

describe('Phase 3.57 — OfflineRewardModal loader failure 分类（共享 helper）', () => {
  it('Error 精确分类：offline reward modal loading failed: chunk boom', async () => {
    const { wrapper, vm } = await mountReadyReal()
    const closeSpy = vi.fn()
    await vm.loadAsyncModal!(
      () => Promise.reject(new Error('chunk boom')),
      'offline reward modal loading failed',
      closeSpy
    )
    expect(vm.runtimeStartupStatus).toBe('faulted')
    expect(vm.runtimeStartupError).toBe('offline reward modal loading failed: chunk boom')
    expect(closeSpy).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('非 Error：String 规范化', async () => {
    const { wrapper, vm } = await mountReadyReal()
    await vm.loadAsyncModal!(
      () => Promise.reject('chunk-string-boom'),
      'offline reward modal loading failed',
      () => {}
    )
    expect(vm.runtimeStartupError).toBe('offline reward modal loading failed: chunk-string-boom')
    wrapper.unmount()
  })

  it('空 Error：无尾随冒号', async () => {
    const { wrapper, vm } = await mountReadyReal()
    await vm.loadAsyncModal!(
      () => Promise.reject(new Error('')),
      'offline reward modal loading failed',
      () => {}
    )
    expect(vm.runtimeStartupError).toBe('offline reward modal loading failed')
    expect(vm.runtimeStartupError).not.toContain('offline reward modal loading failed:')
    wrapper.unmount()
  })
})

describe('Phase 3.57 — OfflineRewardModal loader failure（真实 pending startup 路径）', () => {
  it('真实 pending startup 路径触发 loader reject，rejection 不外抛且无 unhandled rejection', async () => {
    vi.doMock(OFFLINE_PATH, () => {
      throw new Error('chunk boom')
    })
    const track = trackUnhandled()
    seedPending()
    const { wrapper, vm } = await mountReadyReal()
    await flushPromises()
    await vi.dynamicImportSettled()
    await nextTick()
    track.stop()
    expect(vm.runtimeStartupStatus).toBe('faulted')
    expect(vm.runtimeStartupError).toMatch(/^offline reward modal loading failed: /)
    expect(track.list.length).toBe(0)
    wrapper.unmount()
  })

  it('showOfflineModal=false、pending 保持、offline modal DOM 不出现', async () => {
    vi.doMock(OFFLINE_PATH, () => {
      throw new Error('chunk boom')
    })
    seedPending()
    const { wrapper, vm, playerStore } = await mountReadyReal()
    await flushPromises()
    await vi.dynamicImportSettled()
    await nextTick()
    expect(vm.showOfflineModal).toBe(false)
    expect(playerStore.pendingOfflineReward).toEqual(PENDING_FULL)
    expect(wrapper.find('.offline-modal').exists()).toBe(false)
    wrapper.unmount()
  })

  it('claim 和存储零调用', async () => {
    vi.doMock(OFFLINE_PATH, () => {
      throw new Error('chunk boom')
    })
    seedPending()
    const { wrapper, playerStore } = await mountReadyReal()
    const claimSpy = vi.spyOn(playerStore, 'claimOfflineReward')
    const saveSpy = vi.spyOn(playerStore, 'saveGame')
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    await flushPromises()
    await vi.dynamicImportSettled()
    await nextTick()
    expect(claimSpy).not.toHaveBeenCalled()
    expect(saveSpy).not.toHaveBeenCalled()
    expect(setItemSpy.mock.calls.filter(c => c[0] === 'rebirth_data').length).toBe(0)
    expect(setItemSpy.mock.calls.filter(c => c[0] === 'lollipop_adventure_save').length).toBe(0)
    wrapper.unmount()
  })

  it('player/monster 不变、battleError 原引用保持', async () => {
    vi.doMock(OFFLINE_PATH, () => {
      throw new Error('chunk boom')
    })
    seedPending()
    const { wrapper, playerStore, gameStore } = await mountReadyReal()
    const monsterStore = useMonsterStore()
    const existing = new Error('existing store fault')
    gameStore.battleError = existing
    const hpBefore = playerStore.player.currentHp
    const diffBefore = monsterStore.difficultyValue
    await flushPromises()
    await vi.dynamicImportSettled()
    await nextTick()
    expect(playerStore.player.currentHp).toBe(hpBefore)
    expect(monsterStore.difficultyValue).toBe(diffBefore)
    expect(gameStore.battleError).toBe(existing)
    wrapper.unmount()
  })

  it('RAF、interval、listener 各清理一次', async () => {
    vi.doMock(OFFLINE_PATH, () => {
      throw new Error('chunk boom')
    })
    seedPending()
    const { cancelSpy, intervalSpy, clearSpy, removeSpy } = spyCleanup()
    const { wrapper, vm } = await mountReadyReal()
    await flushPromises()
    await vi.dynamicImportSettled()
    await nextTick()
    const runtimeSetIdx = intervalSpy.mock.calls.findIndex(c => c[1] === 1000)
    const runtimeIntervalId = intervalSpy.mock.results[runtimeSetIdx].value
    expect(cancelSpy.mock.calls.filter(c => c[0] === 1).length).toBe(1)
    expect(clearSpy.mock.calls.filter(c => c[0] === runtimeIntervalId).length).toBe(1)
    expect(removeSpy.mock.calls.filter(c => c[0] === 'beforeunload').length).toBe(1)
    expect(vm.runtimeStartupError).toMatch(/^offline reward modal loading failed: /)
    wrapper.unmount()
  })

  it('cleanup 同时 throw 保持 loader 首错', async () => {
    vi.doMock(OFFLINE_PATH, () => {
      throw new Error('chunk boom')
    })
    seedPending()
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {
      throw new Error('cancel boom')
    })
    const { wrapper, vm } = await mountReadyReal()
    await flushPromises()
    await vi.dynamicImportSettled()
    await nextTick()
    expect(vm.runtimeStartupError).toMatch(/^offline reward modal loading failed: /)
    expect(vm.runtimeStartupError).not.toContain('runtime cleanup failed')
    wrapper.unmount()
  })

  it('重复显示不 retry、不重复调用 loader、reason 保持', async () => {
    let factoryCalls = 0
    vi.doMock(OFFLINE_PATH, () => {
      factoryCalls++
      throw new Error('chunk boom')
    })
    seedPending()
    const { wrapper, vm, playerStore } = await mountReadyReal()
    await flushPromises()
    await vi.dynamicImportSettled()
    await nextTick()
    expect(factoryCalls).toBe(1)
    const reasonBefore = vm.runtimeStartupError
    const claimSpy = vi.spyOn(playerStore, 'claimOfflineReward')
    vm.showOfflineModal = true // 重新显示：使用已缓存 inert component
    await flushPromises()
    await vi.dynamicImportSettled()
    await nextTick()
    expect(factoryCalls).toBe(1)
    expect(vm.runtimeStartupError).toBe(reasonBefore)
    expect(claimSpy).not.toHaveBeenCalled()
    expect(wrapper.find('.offline-modal').exists()).toBe(false)
    wrapper.unmount()
  })

  it('later unmount 零 shutdown save', async () => {
    vi.doMock(OFFLINE_PATH, () => {
      throw new Error('chunk boom')
    })
    seedPending()
    const { wrapper, vm, playerStore } = await mountReadyReal()
    await flushPromises()
    await vi.dynamicImportSettled()
    await nextTick()
    expect(vm.runtimeStartupStatus).toBe('faulted')
    const saveSpy = vi.spyOn(playerStore, 'saveGame')
    wrapper.unmount()
    expect(saveSpy).not.toHaveBeenCalled()
  })
})

describe('Phase 3.57 — 首错锁定与正常回归', () => {
  it('已 faulted 后迟到 rejection 不覆盖 reason、cleanup 不重复', async () => {
    vi.doMock(REBIRTH_PATH, () => {
      throw new Error('chunk boom')
    })
    const { cancelSpy, clearSpy, removeSpy } = spyCleanup()
    const { wrapper, vm } = await mountReadyReal()
    // 首次故障：非 chunk 原因
    await vm.loadAsyncModal!(
      () => Promise.reject(new Error('first fault')),
      'first prefix',
      () => {}
    )
    expect(vm.runtimeStartupError).toBe('first prefix: first fault')
    const cancelAfterFirst = cancelSpy.mock.calls.length
    const clearAfterFirst = clearSpy.mock.calls.length
    const removeAfterFirst = removeSpy.mock.calls.length
    // 迟到 rejection
    vm.showRebirthModal = true
    await flushPromises()
    await vi.dynamicImportSettled()
    await nextTick()
    expect(vm.runtimeStartupError).toBe('first prefix: first fault') // 首错保持
    expect(vm.runtimeStartupError).not.toContain('rebirth modal loading failed')
    expect(cancelSpy.mock.calls.length).toBe(cancelAfterFirst) // cleanup 不重复
    expect(clearSpy.mock.calls.length).toBe(clearAfterFirst)
    expect(removeSpy.mock.calls.length).toBe(removeAfterFirst)
    wrapper.unmount()
  })

  it('RebirthModal 正常 resolve 全链路仍工作', async () => {
    const { wrapper, vm } = await mountReadyReal()
    const monsterStore = useMonsterStore()
    monsterStore.difficultyValue = 20
    const rebirthStore = useRebirthStore()
    const alertSpy = vi.fn()
    vi.stubGlobal('alert', alertSpy)
    vm.showRebirthModal = true
    await flushPromises()
    await vi.dynamicImportSettled()
    await nextTick()
    expect(wrapper.find('.rebirth-modal').exists()).toBe(true)
    const actionSpy = vi.spyOn(rebirthStore, 'performRebirth').mockReturnValue({ pointsEarned: 33 })
    wrapper.find('.rebirth-confirm-btn').trigger('click')
    await nextTick()
    expect(actionSpy).toHaveBeenCalledTimes(1)
    expect(vm.showRebirthModal).toBe(false)
    expect(vm.showRebirthShop).toBe(false)
    expect(vm.runtimeStartupStatus).toBe('ready')
    wrapper.unmount()
  })

  it('OfflineRewardModal 正常 resolve 全链路仍工作', async () => {
    seedPending()
    const { wrapper, vm, playerStore } = await mountReadyReal()
    await flushPromises()
    await vi.dynamicImportSettled()
    await nextTick()
    expect(wrapper.find('.offline-modal').exists()).toBe(true)
    const claimSpy = vi.spyOn(playerStore, 'claimOfflineReward').mockReturnValue({ ...PENDING_FULL })
    wrapper.find('.offline-modal button').trigger('click')
    await nextTick()
    expect(claimSpy).toHaveBeenCalledTimes(1)
    expect(vm.showOfflineModal).toBe(false)
    expect(vm.runtimeStartupStatus).toBe('ready')
    wrapper.unmount()
  })

  it('Phase 3.50–3.56 ready-gated handler 在 loader fault 后全部 no-op', async () => {
    vi.doMock(REBIRTH_PATH, () => {
      throw new Error('chunk boom')
    })
    const { wrapper, vm, gameStore, playerStore } = await mountReadyReal()
    const skillSpy = vi.spyOn(gameStore, 'tryUsePlayerSkill')
    const resumeSpy = vi.spyOn(gameStore, 'resumeBattle')
    const goSpy = vi.spyOn(gameStore, 'tryPurchaseGoBackLevels')
    const claimSpy = vi.spyOn(playerStore, 'claimOfflineReward')
    const resetSpy = vi.spyOn(playerStore, 'resetGame')
    const rebirthStore = useRebirthStore()
    const performSpy = vi.spyOn(rebirthStore, 'performRebirth')
    const purchaseSpy = vi.spyOn(rebirthStore, 'purchaseUpgrade')
    vm.showRebirthModal = true
    await flushPromises()
    await vi.dynamicImportSettled()
    await nextTick()
    expect(vm.runtimeStartupStatus).toBe('faulted')
    vm.useSkill!(0)
    vm.switchBattleMode!('main')
    vm.goBackLevels!()
    vm.onClaimOffline!()
    vm.confirmReset!()
    vm.performRebirth!()
    vm.purchaseRebirthUpgrade!('crit_rate')
    await nextTick()
    expect(skillSpy).not.toHaveBeenCalled()
    expect(resumeSpy).not.toHaveBeenCalled()
    expect(goSpy).not.toHaveBeenCalled()
    expect(claimSpy).not.toHaveBeenCalled()
    expect(resetSpy).not.toHaveBeenCalled()
    expect(performSpy).not.toHaveBeenCalled()
    expect(purchaseSpy).not.toHaveBeenCalled()
    expect(vm.runtimeStartupError).toMatch(/^rebirth modal loading failed: /)
    wrapper.unmount()
  })
})
