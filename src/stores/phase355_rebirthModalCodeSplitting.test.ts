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
import App from '../App.vue'
import type { ComponentPublicInstance } from 'vue'
// @ts-ignore —— 测试运行于 Node，无需在应用 tsconfig 中引入 @types/node 全局类型
import { readFileSync } from 'node:fs'
// @ts-ignore
import { resolve } from 'node:path'
// @ts-ignore
declare const process: { cwd(): string }

/**
 * Phase 3.55 — RebirthModal 延迟加载与主入口预算恢复。
 *
 * - App 删除静态 import，改为 defineAsyncComponent(() => import('./components/RebirthModal.vue'))；
 * - 模板以 v-if="showRebirthModal || showRebirthShop" 条件挂载，双 false 时组件不创建；
 * - 动态加载后既有事件（close/perform-rebirth/purchase-upgrade/open-*）行为与 Store/runtime 语义不变。
 * 行为测试真实解析动态组件；架构项使用源码护栏。
 */

function warmupStores() {
  usePlayerStore()
  useMonsterStore()
  useGameStore()
  useTrainingStore()
  useATBStore()
  useRebirthStore()
}

function freshPinia() {
  setActivePinia(createPinia())
  localStorage.clear()
  warmupStores()
}

function seedAlive() {
  const playerStore = usePlayerStore()
  const monsterStore = useMonsterStore()
  playerStore.player.currentHp = 100
  playerStore.player.maxHp = 100
  monsterStore.setProgress(20, 20) // difficultyValue = 20 ≥ 10
}

type AppVm = ComponentPublicInstance & {
  openRebirthModal?: () => void
  openRebirthShop?: () => void
  closeRebirthModal?: () => void
  performRebirth?: () => void
  purchaseRebirthUpgrade?: (upgradeId: string) => void
  runtimeStartupStatus?: 'initializing' | 'ready' | 'blocked' | 'faulted'
  runtimeStartupError?: string
  showRebirthModal?: boolean
  showRebirthShop?: boolean
}

/** 挂载 App：真实 RebirthModal（不 stub），stub 掉其他重型子组件。 */
function mountApp355() {
  seedAlive()
  const rebirthStore = useRebirthStore()
  const gameStore = useGameStore()
  vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
  // 启动期资源 spy 放在 mount 之前，用于断言打开/关闭 modal 不新增资源
  const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1)
  const intervalSpy = vi.spyOn(window, 'setInterval')
  const addSpy = vi.spyOn(window, 'addEventListener')
  const wrapper = mount(App, {
    global: {
      stubs: {
        BattleHUD: true,
        PlayerStatusBar: true,
        OverlayContainer: true,
        TabsContainer: true,
        PauseOverlay: true,
        OfflineRewardModal: { template: '<div class="offline-reward-stub"></div>' }
      }
    }
  })
  return { wrapper, rebirthStore, gameStore, rafSpy, intervalSpy, addSpy }
}

async function mountReadyApp() {
  const m = mountApp355()
  await nextTick()
  const vm = m.wrapper.vm as unknown as AppVm
  return { ...m, vm }
}

/** 打开转生 modal 并等待真实动态组件解析完成。 */
async function openModal(vm: AppVm) {
  vm.openRebirthModal!()
  await flushPromises()
  await vi.dynamicImportSettled()
  await nextTick()
}

/** 打开转生 shop 并等待真实动态组件解析完成。 */
async function openShop(vm: AppVm) {
  vm.openRebirthShop!()
  await flushPromises()
  await vi.dynamicImportSettled()
  await nextTick()
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

describe('Phase 3.55 — 架构护栏', () => {
  const ROOT = process.cwd()
  const APP_PATH = resolve(ROOT, 'src/App.vue')
  const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\r\n]*/g, '')
  const SRC = stripComments(readFileSync(APP_PATH, 'utf8'))

  it('护栏：App 从 Vue 导入 defineAsyncComponent', () => {
    expect(SRC).toMatch(/import \{[^}]*defineAsyncComponent[^}]*\} from 'vue'/)
  })

  it('护栏：App 不再静态 import RebirthModal', () => {
    expect(SRC).not.toMatch(/import RebirthModal\s+from/)
    expect(SRC).not.toMatch(/import\s+RebirthModal/)
  })

  it('护栏：App 使用精确动态 import', () => {
    expect(SRC).toContain("import('./components/RebirthModal.vue')")
  })

  it('护栏：动态 import 被 defineAsyncComponent 包装', () => {
    expect(SRC).toMatch(/defineAsyncComponent\(\s*\(\s*\)\s*=>\s*import\('\.\/components\/RebirthModal\.vue'\)\s*\)/)
  })

  it('护栏：App 模板存在双状态外层条件', () => {
    expect(SRC).toMatch(/v-if="\s*showRebirthModal\s*\|\|\s*showRebirthShop\s*"/)
  })

  it('护栏：不存在 eager import、onMounted preload 或 retry', () => {
    const occurrences = SRC.match(/import\('\.\/components\/RebirthModal\.vue'\)/g) || []
    expect(occurrences.length).toBe(1) // 仅 defineAsyncComponent 一处
    expect(SRC).not.toMatch(/import\('\.\/components\/RebirthModal\.vue'\)\.catch/)
    const m = SRC.match(/onMounted\(\s*\(\)\s*=>\s*\{[\s\S]*?\n\}\)/)
    expect(m).toBeTruthy()
    expect(m![0]).not.toContain("import('./components/RebirthModal.vue')")
    expect(m![0]).not.toContain('RebirthModal')
  })

  it('护栏：其他 App 核心组件静态/异步策略不被顺手修改', () => {
    // Phase 3.56：OfflineRewardModal 已改为异步组件，从静态列表移除；其余核心组件策略不变。
    for (const name of ['BattleHUD', 'PlayerStatusBar', 'OverlayContainer', 'TabsContainer', 'PauseOverlay']) {
      expect(SRC).toMatch(new RegExp(`import ${name} from '\\./components/${name}\\.vue'`))
    }
  })
})

describe('Phase 3.55 — 初始行为', () => {
  it('App 初次挂载：modal=false、shop=false、RebirthModal DOM 不存在、runtime 可进入 ready', async () => {
    const { wrapper, vm } = await mountReadyApp()
    expect(vm.showRebirthModal).toBe(false)
    expect(vm.showRebirthShop).toBe(false)
    expect(wrapper.find('.rebirth-modal').exists()).toBe(false)
    expect(wrapper.find('.rebirth-confirm-btn').exists()).toBe(false)
    expect(wrapper.find('.buy-btn').exists()).toBe(false)
    expect(vm.runtimeStartupStatus).toBe('ready')
    wrapper.unmount()
  })

  it('初始状态不出现转生标题、转生商店或 buy button', async () => {
    const { wrapper } = await mountReadyApp()
    expect(wrapper.text()).not.toContain('转生商店')
    expect(wrapper.text()).not.toContain('进入转生商店')
    expect(wrapper.find('.buy-btn').exists()).toBe(false)
    wrapper.unmount()
  })
})

describe('Phase 3.55 — 真实动态加载', () => {
  it('openRebirthModal：真实动态 import 加载完成后出现转生 modal', async () => {
    const { wrapper, vm } = await mountReadyApp()
    vm.openRebirthModal!()
    await flushPromises()
    await vi.dynamicImportSettled()
    await nextTick()
    expect(vm.showRebirthModal).toBe(true)
    expect(vm.showRebirthShop).toBe(false)
    expect(wrapper.find('.rebirth-modal').exists()).toBe(true)
    expect(wrapper.find('.rebirth-confirm-btn').exists()).toBe(true)
    wrapper.unmount()
  })

  it('openRebirthShop：动态组件加载完成后 shop 内容和 .buy-btn 存在', async () => {
    const { wrapper, vm, rebirthStore } = await mountReadyApp()
    rebirthStore.rebirthPoints = 10000
    await openShop(vm)
    expect(vm.showRebirthShop).toBe(true)
    expect(vm.showRebirthModal).toBe(false)
    expect(wrapper.find('.buy-btn').exists()).toBe(true)
    expect(wrapper.text()).toContain('转生商店')
    wrapper.unmount()
  })

  it('真实组件内容而非全局 stub（shop 展示真实升级定义）', async () => {
    const { wrapper, vm, rebirthStore } = await mountReadyApp()
    rebirthStore.rebirthPoints = 10000
    await openShop(vm)
    expect(wrapper.text()).toContain('暴击强化') // REBIRTH_UPGRADES 真实定义
    expect(wrapper.find('.upgrade-item').exists()).toBe(true)
    wrapper.unmount()
  })
})

describe('Phase 3.55 — 既有事件回归', () => {
  it('真实 perform-rebirth 按钮仍到达 App handler', async () => {
    const { wrapper, vm, rebirthStore } = await mountReadyApp()
    vi.stubGlobal('alert', vi.fn())
    await openModal(vm)
    const actionSpy = vi.spyOn(rebirthStore, 'performRebirth').mockReturnValue({ pointsEarned: 33 })
    wrapper.find('.rebirth-confirm-btn').trigger('click')
    await nextTick()
    expect(actionSpy).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('真实 .buy-btn 仍精确传递第一个 upgrade ID', async () => {
    const { wrapper, vm, rebirthStore } = await mountReadyApp()
    rebirthStore.rebirthPoints = 10000
    await openShop(vm)
    const actionSpy = vi.spyOn(rebirthStore, 'purchaseUpgrade').mockReturnValue(true)
    wrapper.find('.buy-btn').trigger('click')
    await nextTick()
    expect(actionSpy).toHaveBeenCalledTimes(1)
    expect(actionSpy.mock.calls[0][0]).toBe('crit_rate')
    wrapper.unmount()
  })

  it('close 后两个状态均 false、组件卸载', async () => {
    const { wrapper, vm } = await mountReadyApp()
    await openModal(vm)
    expect(wrapper.find('.rebirth-modal').exists()).toBe(true)
    wrapper.find('.close-btn').trigger('click')
    await nextTick()
    expect(vm.showRebirthModal).toBe(false)
    expect(vm.showRebirthShop).toBe(false)
    expect(wrapper.find('.rebirth-modal').exists()).toBe(false)
    wrapper.unmount()
  })

  it('shop → modal 返回按钮仍工作', async () => {
    const { wrapper, vm } = await mountReadyApp()
    await openShop(vm)
    wrapper.find('.back-btn').trigger('click')
    await nextTick()
    expect(vm.showRebirthModal).toBe(true)
    expect(vm.showRebirthShop).toBe(false)
    wrapper.unmount()
  })

  it('modal → shop 按钮仍工作', async () => {
    const { wrapper, vm } = await mountReadyApp()
    await openModal(vm)
    wrapper.find('.shop-btn').trigger('click')
    await nextTick()
    expect(vm.showRebirthModal).toBe(false)
    expect(vm.showRebirthShop).toBe(true)
    wrapper.unmount()
  })

  it('关闭后再次打开能够重新显示', async () => {
    const { wrapper, vm } = await mountReadyApp()
    await openModal(vm)
    wrapper.find('.close-btn').trigger('click')
    await nextTick()
    expect(wrapper.find('.rebirth-modal').exists()).toBe(false)
    await openModal(vm)
    expect(vm.showRebirthModal).toBe(true)
    expect(wrapper.find('.rebirth-modal').exists()).toBe(true)
    wrapper.unmount()
  })

  it('再次打开不产生重复事件调用', async () => {
    const { wrapper, vm, rebirthStore } = await mountReadyApp()
    vi.stubGlobal('alert', vi.fn())
    await openModal(vm)
    wrapper.find('.close-btn').trigger('click')
    await nextTick()
    const actionSpy = vi.spyOn(rebirthStore, 'performRebirth').mockReturnValue({ pointsEarned: 33 })
    await openModal(vm)
    wrapper.find('.rebirth-confirm-btn').trigger('click')
    await nextTick()
    expect(actionSpy).toHaveBeenCalledTimes(1) // 单次点击单次调用
    wrapper.unmount()
  })
})

describe('Phase 3.55 — Store 与 runtime 保持', () => {
  async function openClose(vm: AppVm) {
    vm.openRebirthShop!()
    await flushPromises()
    await vi.dynamicImportSettled()
    await nextTick()
    vm.showRebirthShop = false
    await nextTick()
  }

  it('打开/关闭不修改 rebirthPoints、upgrades、player、monster', async () => {
    const { wrapper, vm, rebirthStore } = await mountReadyApp()
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    const pointsBefore = rebirthStore.rebirthPoints
    const upgradesLenBefore = rebirthStore.upgrades.length
    const hpBefore = playerStore.player.currentHp
    const diffBefore = monsterStore.difficultyValue
    await openClose(vm)
    expect(rebirthStore.rebirthPoints).toBe(pointsBefore)
    expect(rebirthStore.upgrades.length).toBe(upgradesLenBefore)
    expect(playerStore.player.currentHp).toBe(hpBefore)
    expect(monsterStore.difficultyValue).toBe(diffBefore)
    wrapper.unmount()
  })

  it('打开/关闭不调用 saveRebirthData、saveGame、recordLogout', async () => {
    const { wrapper, vm } = await mountReadyApp()
    const playerStore = usePlayerStore()
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    const saveSpy = vi.spyOn(playerStore, 'saveGame')
    const logoutSpy = vi.spyOn(playerStore, 'recordLogout')
    await openClose(vm)
    expect(setItemSpy.mock.calls.filter(c => c[0] === 'rebirth_data').length).toBe(0)
    expect(saveSpy).not.toHaveBeenCalled()
    expect(logoutSpy).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('runtime 保持 ready', async () => {
    const { wrapper, vm } = await mountReadyApp()
    await openClose(vm)
    expect(vm.runtimeStartupStatus).toBe('ready')
    wrapper.unmount()
  })

  it('不新增 RAF、interval 或 beforeunload 资源', async () => {
    const { wrapper, vm, rafSpy, intervalSpy, addSpy } = await mountReadyApp()
    const rafBefore = rafSpy.mock.calls.length
    const intervalBefore = intervalSpy.mock.calls.length
    const addBefore = addSpy.mock.calls.length
    await openClose(vm)
    expect(rafSpy.mock.calls.length).toBe(rafBefore)
    expect(intervalSpy.mock.calls.length).toBe(intervalBefore)
    expect(addSpy.mock.calls.length).toBe(addBefore)
    expect(addSpy.mock.calls.filter(c => c[0] === 'beforeunload').length).toBe(1) // 仅启动期注册一次
    wrapper.unmount()
  })
})

describe('Phase 3.55 — 已有 Phase 回归', () => {
  it('Phase 3.53：null、success、throw、alert throw 语义不变', async () => {
    const alertSpy = vi.fn()
    vi.stubGlobal('alert', alertSpy)

    // success
    {
      freshPinia()
      const { wrapper, vm, rebirthStore } = await mountReadyApp()
      await openModal(vm)
      vi.spyOn(rebirthStore, 'performRebirth').mockReturnValue({ pointsEarned: 33 })
      wrapper.find('.rebirth-confirm-btn').trigger('click')
      await nextTick()
      expect(vm.showRebirthModal).toBe(false)
      expect(vm.showRebirthShop).toBe(false)
      expect(alertSpy).toHaveBeenCalledTimes(1)
      expect(alertSpy).toHaveBeenCalledWith('转生成功！获得 33 转生点数！')
      expect(vm.runtimeStartupStatus).toBe('ready')
      wrapper.unmount()
    }

    // null 保持 UI
    {
      freshPinia()
      const { wrapper, vm, rebirthStore } = await mountReadyApp()
      await openModal(vm)
      vi.spyOn(rebirthStore, 'performRebirth').mockReturnValue(null)
      wrapper.find('.rebirth-confirm-btn').trigger('click')
      await nextTick()
      expect(vm.showRebirthModal).toBe(true)
      expect(vm.showRebirthShop).toBe(false)
      expect(vm.runtimeStartupStatus).toBe('ready')
      wrapper.unmount()
    }

    // throw → faulted
    {
      freshPinia()
      const { wrapper, vm, rebirthStore } = await mountReadyApp()
      await openModal(vm)
      vi.spyOn(rebirthStore, 'performRebirth').mockImplementation(() => {
        throw new Error('rebirth boom')
      })
      wrapper.find('.rebirth-confirm-btn').trigger('click')
      await nextTick()
      expect(vm.runtimeStartupStatus).toBe('faulted')
      expect(vm.runtimeStartupError).toBe('rebirth interaction failed: rebirth boom')
      wrapper.unmount()
    }

    // alert throw 不 fault
    {
      freshPinia()
      vi.stubGlobal('alert', () => {
        throw new Error('alert boom')
      })
      const { wrapper, vm, rebirthStore } = await mountReadyApp()
      await openModal(vm)
      vi.spyOn(rebirthStore, 'performRebirth').mockReturnValue({ pointsEarned: 33 })
      let threw = false
      try {
        wrapper.find('.rebirth-confirm-btn').trigger('click')
      } catch {
        threw = true
      }
      await nextTick()
      expect(threw).toBe(false)
      expect(vm.showRebirthModal).toBe(false) // 成功已提交
      expect(vm.runtimeStartupStatus).toBe('ready')
      expect(vm.runtimeStartupError).toBe('')
      wrapper.unmount()
    }
  })

  it('Phase 3.54：true、false、unexpected throw、non-ready 语义不变', async () => {
    // true：shop 保持、ready
    {
      freshPinia()
      const { wrapper, vm, rebirthStore } = await mountReadyApp()
      rebirthStore.rebirthPoints = 10000
      await openShop(vm)
      const actionSpy = vi.spyOn(rebirthStore, 'purchaseUpgrade').mockReturnValue(true)
      wrapper.find('.buy-btn').trigger('click')
      await nextTick()
      expect(actionSpy).toHaveBeenCalledTimes(1)
      expect(vm.showRebirthShop).toBe(true)
      expect(vm.runtimeStartupStatus).toBe('ready')
      wrapper.unmount()
    }

    // false：shop 保持、不 fault
    {
      freshPinia()
      const { wrapper, vm, rebirthStore } = await mountReadyApp()
      rebirthStore.rebirthPoints = 10000
      await openShop(vm)
      const actionSpy = vi.spyOn(rebirthStore, 'purchaseUpgrade').mockReturnValue(false)
      wrapper.find('.buy-btn').trigger('click')
      await nextTick()
      expect(actionSpy).toHaveBeenCalledTimes(1)
      expect(vm.showRebirthShop).toBe(true)
      expect(vm.runtimeStartupStatus).toBe('ready')
      expect(vm.runtimeStartupError).toBe('')
      wrapper.unmount()
    }

    // unexpected throw → faulted
    {
      freshPinia()
      const { wrapper, vm, rebirthStore } = await mountReadyApp()
      rebirthStore.rebirthPoints = 10000
      await openShop(vm)
      vi.spyOn(rebirthStore, 'purchaseUpgrade').mockImplementation(() => {
        throw new Error('purchase boom')
      })
      wrapper.find('.buy-btn').trigger('click')
      await nextTick()
      expect(vm.runtimeStartupStatus).toBe('faulted')
      expect(vm.runtimeStartupError).toBe('rebirth upgrade purchase failed: purchase boom')
      wrapper.unmount()
    }

    // non-ready（faulted）下点击零 action
    {
      freshPinia()
      const { wrapper, vm, rebirthStore } = await mountReadyApp()
      rebirthStore.rebirthPoints = 10000
      vm.runtimeStartupStatus = 'faulted'
      await openShop(vm)
      const actionSpy = vi.spyOn(rebirthStore, 'purchaseUpgrade')
      wrapper.find('.buy-btn').trigger('click')
      await nextTick()
      expect(actionSpy).not.toHaveBeenCalled()
      wrapper.unmount()
    }
  })
})
