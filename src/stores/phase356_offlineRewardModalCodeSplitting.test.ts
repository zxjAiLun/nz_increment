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
 * Phase 3.56 — OfflineRewardModal 延迟加载与离线奖励行为保持。
 *
 * - App 删除静态 import，改为 defineAsyncComponent(() => import('./components/OfflineRewardModal.vue'))；
 * - 保留模板 v-if="showOfflineModal" 条件挂载；startup 提交顺序不变（资源安装成功后
 *   才检查 pendingOfflineReward 并置 showOfflineModal）；
 * - claim / close / fault 语义与 Phase 3.2.1 保持。
 * 行为测试真实解析动态组件；架构项使用源码护栏。
 */

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
  expect(playerStore.saveGame()).toBe(true) // 写盘让 loadGame 在启动时水合 pending
}

type AppVm = ComponentPublicInstance & {
  onClaimOffline?: () => void
  useSkill?: (i: number) => void
  switchBattleMode?: (m: 'main' | 'training') => void
  goBackLevels?: () => void
  confirmReset?: () => void
  performRebirth?: () => void
  purchaseRebirthUpgrade?: (upgradeId: string) => void
  runtimeStartupStatus?: 'initializing' | 'ready' | 'blocked' | 'faulted'
  runtimeStartupError?: string
  showOfflineModal?: boolean
}

/** 挂载 App：真实 OfflineRewardModal（不 stub），stub 掉其他重型子组件。 */
function mountApp356() {
  seedAlive()
  const playerStore = usePlayerStore()
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
        PauseOverlay: true
      }
    }
  })
  return { wrapper, playerStore, gameStore, rafSpy, intervalSpy, addSpy }
}

/** 无 pending：初次挂载。 */
async function mountNoPending() {
  const m = mountApp356()
  await nextTick()
  const vm = m.wrapper.vm as unknown as AppVm
  return { ...m, vm }
}

/** 有 pending：启动即展示离线弹窗，等待真实动态组件解析完成。 */
async function mountWithPending() {
  seedPending()
  const m = mountApp356()
  await flushPromises()
  await vi.dynamicImportSettled()
  await nextTick()
  const vm = m.wrapper.vm as unknown as AppVm
  return { ...m, vm }
}

/** 统一 spy 启动期资源 API（用于 cleanup 断言）。 */
function spyCleanup() {
  const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1)
  const cancelSpy = vi.spyOn(window, 'cancelAnimationFrame')
  const intervalSpy = vi.spyOn(window, 'setInterval')
  const clearSpy = vi.spyOn(window, 'clearInterval')
  const addSpy = vi.spyOn(window, 'addEventListener')
  const removeSpy = vi.spyOn(window, 'removeEventListener')
  return { rafSpy, cancelSpy, intervalSpy, clearSpy, addSpy, removeSpy }
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

describe('Phase 3.56 — 架构护栏', () => {
  const ROOT = process.cwd()
  const APP_PATH = resolve(ROOT, 'src/App.vue')
  const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\r\n]*/g, '')
  const SRC = stripComments(readFileSync(APP_PATH, 'utf8'))

  it('护栏：App 不再静态 import OfflineRewardModal', () => {
    expect(SRC).not.toMatch(/import\s+OfflineRewardModal\s+from/)
    expect(SRC).not.toMatch(/import OfflineRewardModal/)
  })

  it('护栏：App 使用精确动态 import', () => {
    expect(SRC).toContain("import('./components/OfflineRewardModal.vue')")
  })

  it('护栏：动态 import 经共享 loadAsyncModal 被 defineAsyncComponent 包装', () => {
    expect(SRC).toMatch(/defineAsyncComponent\(\s*\(\s*\)\s*=>\s*loadAsyncModal\(\s*\(\s*\)\s*=>\s*import\('\.\/components\/OfflineRewardModal\.vue'\)/)
  })

  it('护栏：精确 import 只出现一次', () => {
    const occ = SRC.match(/import\('\.\/components\/OfflineRewardModal\.vue'\)/g) || []
    expect(occ.length).toBe(1)
  })

  it('护栏：模板保留 v-if="showOfflineModal"', () => {
    expect(SRC).toMatch(/v-if="showOfflineModal"/)
  })

  it('护栏：不存在 eager、preload、retry 或 onMounted import', () => {
    expect(SRC).not.toMatch(/import\('\.\/components\/OfflineRewardModal\.vue'\)\.catch/)
    expect(SRC).not.toMatch(/import OfflineRewardModal\s+from/)
    const m = SRC.match(/onMounted\(\s*\(\)\s*=>\s*\{[\s\S]*?\n\}\)/)
    expect(m).toBeTruthy()
    expect(m![0]).not.toContain("import('./components/OfflineRewardModal.vue')")
    expect(m![0]).not.toContain('OfflineRewardModal')
  })

  it('护栏：RebirthModal 的 Phase 3.55 异步结构不被修改（Phase 3.57 增加共享熔断）', () => {
    expect(SRC).toMatch(/const RebirthModal = defineAsyncComponent\(/)
    expect(SRC).toMatch(/loadAsyncModal\(/)
    expect(SRC).toContain("import('./components/RebirthModal.vue')")
    expect(SRC).toMatch(/v-if="\s*showRebirthModal\s*\|\|\s*showRebirthShop\s*"/)
  })

  it('护栏：其他 App 核心组件保持原静态策略', () => {
    for (const name of ['BattleHUD', 'PlayerStatusBar', 'OverlayContainer', 'TabsContainer', 'PauseOverlay']) {
      expect(SRC).toMatch(new RegExp(`import ${name} from '\\./components/${name}\\.vue'`))
    }
  })
})

describe('Phase 3.56 — 初始无 pending', () => {
  it('App 初次挂载无有效 pending：showOfflineModal=false、无 modal DOM、runtime 可进入 ready', async () => {
    const { wrapper, vm } = await mountNoPending()
    expect(vm.showOfflineModal).toBe(false)
    expect(wrapper.find('.offline-modal').exists()).toBe(false)
    expect(wrapper.find('.modal-overlay').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('离线收益')
    expect(wrapper.text()).not.toContain('领取奖励')
    expect(vm.runtimeStartupStatus).toBe('ready')
    wrapper.unmount()
  })

  it('初始无 pending 不修改 Store 或写盘', async () => {
    const { wrapper, vm } = await mountNoPending()
    const playerStore = usePlayerStore()
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    const saveSpy = vi.spyOn(playerStore, 'saveGame')
    const claimSpy = vi.spyOn(playerStore, 'claimOfflineReward')
    expect(vm.showOfflineModal).toBe(false)
    await nextTick()
    expect(saveSpy).not.toHaveBeenCalled()
    expect(claimSpy).not.toHaveBeenCalled()
    expect(setItemSpy.mock.calls.filter(c => c[0] === 'rebirth_data').length).toBe(0)
    expect(setItemSpy.mock.calls.filter(c => c[0] === 'lollipop_adventure_save').length).toBe(0)
    wrapper.unmount()
  })
})

describe('Phase 3.56 — 真实动态加载', () => {
  it('真实 OfflineRewardModal：pending 存在时启动展示离线弹窗、runtime ready', async () => {
    const { wrapper, vm } = await mountWithPending()
    expect(vm.showOfflineModal).toBe(true)
    expect(vm.runtimeStartupStatus).toBe('ready')
    expect(wrapper.find('.offline-modal').exists()).toBe(true)
    wrapper.unmount()
  })

  it('组件显示标题、精确 gold、exp、分钟数与 claim 按钮', async () => {
    const { wrapper } = await mountWithPending()
    const text = wrapper.text()
    expect(text).toContain('离线收益')
    expect(text).toContain('离线 2 分钟')
    expect(text).toContain('100 金币')
    expect(text).toContain('50 经验')
    const claimBtn = wrapper.find('.offline-modal button')
    expect(claimBtn.exists()).toBe(true)
    expect(claimBtn.text()).toBe('领取奖励')
    wrapper.unmount()
  })

  it('展示同一份 pendingOfflineReward 快照', async () => {
    const { wrapper, playerStore } = await mountWithPending()
    expect(playerStore.pendingOfflineReward).toEqual(PENDING_FULL)
    wrapper.unmount()
  })
})

describe('Phase 3.56 — claim success', () => {
  it('真实 claim 按钮到达 App handler、action 恰好一次、成功关闭 modal', async () => {
    const { wrapper, vm, playerStore } = await mountWithPending()
    const claimSpy = vi.spyOn(playerStore, 'claimOfflineReward').mockReturnValue({ ...PENDING_FULL })
    wrapper.find('.offline-modal button').trigger('click')
    await nextTick()
    expect(claimSpy).toHaveBeenCalledTimes(1)
    expect(vm.showOfflineModal).toBe(false)
    expect(vm.runtimeStartupStatus).toBe('ready')
    expect(wrapper.find('.offline-modal').exists()).toBe(false)
    wrapper.unmount()
  })

  it('成功不产生 App 额外保存、组件卸载', async () => {
    const { wrapper, vm, playerStore } = await mountWithPending()
    vi.spyOn(playerStore, 'claimOfflineReward').mockReturnValue({ ...PENDING_FULL })
    const saveSpy = vi.spyOn(playerStore, 'saveGame')
    wrapper.find('.offline-modal button').trigger('click')
    await nextTick()
    expect(vm.showOfflineModal).toBe(false)
    expect(saveSpy).not.toHaveBeenCalled()
    expect(wrapper.find('.offline-modal').exists()).toBe(false)
    wrapper.unmount()
  })
})

describe('Phase 3.56 — claim false', () => {
  it('false 保持 modal、pending 保持、runtime ready、不 fault', async () => {
    const { wrapper, vm, playerStore } = await mountWithPending()
    const claimSpy = vi.spyOn(playerStore, 'claimOfflineReward').mockReturnValue(null)
    wrapper.find('.offline-modal button').trigger('click')
    await nextTick()
    expect(claimSpy).toHaveBeenCalledTimes(1)
    expect(vm.showOfflineModal).toBe(true)
    expect(playerStore.pendingOfflineReward).toEqual(PENDING_FULL)
    expect(vm.runtimeStartupStatus).toBe('ready')
    expect(vm.runtimeStartupError).toBe('')
    wrapper.unmount()
  })

  it('两次点击是两次独立请求、单次 handler 不 retry', async () => {
    const { wrapper, vm, playerStore } = await mountWithPending()
    const claimSpy = vi.spyOn(playerStore, 'claimOfflineReward').mockReturnValue(null)
    wrapper.find('.offline-modal button').trigger('click')
    wrapper.find('.offline-modal button').trigger('click')
    await nextTick()
    expect(claimSpy).toHaveBeenCalledTimes(2)
    expect(vm.showOfflineModal).toBe(true)
    expect(vm.runtimeStartupStatus).toBe('ready')
    wrapper.unmount()
  })
})

describe('Phase 3.56 — claim unexpected throw', () => {
  it('Error 精确分类：faulted、reason 精确、offline modal 关闭', async () => {
    const { wrapper, vm, playerStore } = await mountWithPending()
    vi.spyOn(playerStore, 'claimOfflineReward').mockImplementation(() => {
      throw new Error('claim boom')
    })
    wrapper.find('.offline-modal button').trigger('click')
    await nextTick()
    expect(vm.runtimeStartupStatus).toBe('faulted')
    expect(vm.runtimeStartupError).toBe('offline reward claim failed: claim boom')
    expect(vm.showOfflineModal).toBe(false) // enterRuntimeFault 关闭 offline modal
    wrapper.unmount()
  })

  it('非 Error：String 规范化', async () => {
    const { wrapper, vm, playerStore } = await mountWithPending()
    vi.spyOn(playerStore, 'claimOfflineReward').mockImplementation(() => {
      throw 'claim-string-boom'
    })
    wrapper.find('.offline-modal button').trigger('click')
    await nextTick()
    expect(vm.runtimeStartupError).toBe('offline reward claim failed: claim-string-boom')
    wrapper.unmount()
  })

  it('空 Error：无尾随冒号', async () => {
    const { wrapper, vm, playerStore } = await mountWithPending()
    vi.spyOn(playerStore, 'claimOfflineReward').mockImplementation(() => {
      throw new Error('')
    })
    wrapper.find('.offline-modal button').trigger('click')
    await nextTick()
    expect(vm.runtimeStartupError).toBe('offline reward claim failed')
    expect(vm.runtimeStartupError).not.toContain('offline reward claim failed:')
    wrapper.unmount()
  })

  it('真实 emit 不外抛', async () => {
    const { wrapper, vm, playerStore } = await mountWithPending()
    vi.spyOn(playerStore, 'claimOfflineReward').mockImplementation(() => {
      throw new Error('claim boom')
    })
    let threw = false
    try {
      wrapper.find('.offline-modal button').trigger('click')
    } catch {
      threw = true
    }
    await nextTick()
    expect(threw).toBe(false)
    expect(vm.runtimeStartupStatus).toBe('faulted')
    wrapper.unmount()
  })

  it('offline modal 不作为成功路径处理（fault 关闭而非成功关闭）', async () => {
    const { wrapper, vm, playerStore } = await mountWithPending()
    vi.spyOn(playerStore, 'claimOfflineReward').mockImplementation(() => {
      throw new Error('claim boom')
    })
    wrapper.find('.offline-modal button').trigger('click')
    await nextTick()
    expect(vm.runtimeStartupStatus).toBe('faulted')
    expect(vm.showOfflineModal).toBe(false)
    expect(wrapper.find('.offline-modal').exists()).toBe(false)
    wrapper.unmount()
  })

  it('battleError 原引用保持', async () => {
    const { wrapper, playerStore, gameStore } = await mountWithPending()
    const existing = new Error('existing store fault')
    gameStore.battleError = existing
    vi.spyOn(playerStore, 'claimOfflineReward').mockImplementation(() => {
      throw new Error('claim boom')
    })
    wrapper.find('.offline-modal button').trigger('click')
    await nextTick()
    expect(gameStore.battleError).toBe(existing)
    expect(gameStore.battleError!.message).toBe('existing store fault')
    wrapper.unmount()
  })

  it('throw 后 RAF、interval、listener 各清理一次', async () => {
    seedAlive()
    seedPending()
    const playerStore = usePlayerStore()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    vi.spyOn(playerStore, 'claimOfflineReward').mockImplementation(() => {
      throw new Error('claim boom')
    })
    const { cancelSpy, intervalSpy, clearSpy, removeSpy } = spyCleanup()

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
    await flushPromises()
    await vi.dynamicImportSettled()
    await nextTick()
    const vm = wrapper.vm as unknown as AppVm
    const runtimeSetIdx = intervalSpy.mock.calls.findIndex(c => c[1] === 1000)
    const runtimeIntervalId = intervalSpy.mock.results[runtimeSetIdx].value

    wrapper.find('.offline-modal button').trigger('click')
    await nextTick()

    expect(cancelSpy.mock.calls.filter(c => c[0] === 1).length).toBe(1)
    expect(clearSpy.mock.calls.filter(c => c[0] === runtimeIntervalId).length).toBe(1)
    expect(removeSpy.mock.calls.filter(c => c[0] === 'beforeunload').length).toBe(1)
    expect(vm.runtimeStartupError).toBe('offline reward claim failed: claim boom')
    wrapper.unmount()
  })

  it('cleanup 同时 throw 保持 offline claim 首错', async () => {
    seedAlive()
    seedPending()
    const playerStore = usePlayerStore()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    vi.spyOn(playerStore, 'claimOfflineReward').mockImplementation(() => {
      throw new Error('claim boom')
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {
      throw new Error('cancel boom')
    })

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
    await flushPromises()
    await vi.dynamicImportSettled()
    await nextTick()
    const vm = wrapper.vm as unknown as AppVm

    wrapper.find('.offline-modal button').trigger('click')
    await nextTick()

    expect(vm.runtimeStartupError).toBe('offline reward claim failed: claim boom')
    expect(vm.runtimeStartupError).not.toContain('runtime cleanup failed')
    wrapper.unmount()
  })

  it('fault 后重复 claim 与 Phase 3.50–3.55 handler 全部 no-op', async () => {
    const { wrapper, vm, playerStore, gameStore } = await mountWithPending()
    const claimSpy = vi.spyOn(playerStore, 'claimOfflineReward').mockImplementation(() => {
      throw new Error('claim boom')
    })
    const skillSpy = vi.spyOn(gameStore, 'tryUsePlayerSkill')
    const resumeSpy = vi.spyOn(gameStore, 'resumeBattle')
    const goSpy = vi.spyOn(gameStore, 'tryPurchaseGoBackLevels')
    const resetSpy = vi.spyOn(playerStore, 'resetGame')
    const rebirthSpy = vi.spyOn(useRebirthStore(), 'performRebirth')
    const purchaseSpy = vi.spyOn(useRebirthStore(), 'purchaseUpgrade')

    wrapper.find('.offline-modal button').trigger('click')
    await nextTick()
    expect(claimSpy).toHaveBeenCalledTimes(1)
    expect(vm.runtimeStartupStatus).toBe('faulted')

    vm.onClaimOffline!() // 重复 claim no-op
    vm.useSkill!(0)
    vm.switchBattleMode!('main')
    vm.goBackLevels!()
    vm.confirmReset!()
    vm.performRebirth!()
    vm.purchaseRebirthUpgrade!('crit_rate')
    await nextTick()

    expect(claimSpy).toHaveBeenCalledTimes(1)
    expect(skillSpy).not.toHaveBeenCalled()
    expect(resumeSpy).not.toHaveBeenCalled()
    expect(goSpy).not.toHaveBeenCalled()
    expect(resetSpy).not.toHaveBeenCalled()
    expect(rebirthSpy).not.toHaveBeenCalled()
    expect(purchaseSpy).not.toHaveBeenCalled()
    expect(vm.runtimeStartupError).toBe('offline reward claim failed: claim boom')
    wrapper.unmount()
  })

  it('later Vue unmount 零 shutdown save', async () => {
    const { wrapper, vm, playerStore } = await mountWithPending()
    vi.spyOn(playerStore, 'claimOfflineReward').mockImplementation(() => {
      throw new Error('claim boom')
    })
    const saveSpy = vi.spyOn(playerStore, 'saveGame')
    wrapper.find('.offline-modal button').trigger('click')
    await nextTick()
    expect(vm.runtimeStartupStatus).toBe('faulted')
    wrapper.unmount()
    expect(saveSpy).not.toHaveBeenCalled()
  })
})

describe('Phase 3.56 — close 与重新挂载', () => {
  it('真实 close emit 只关闭 UI、不调用 claim', async () => {
    const { wrapper, vm, playerStore } = await mountWithPending()
    const claimSpy = vi.spyOn(playerStore, 'claimOfflineReward')
    wrapper.find('.modal-overlay').trigger('click') // overlay self-close
    await nextTick()
    expect(vm.showOfflineModal).toBe(false)
    expect(claimSpy).not.toHaveBeenCalled()
    expect(wrapper.find('.offline-modal').exists()).toBe(false)
    wrapper.unmount()
  })

  it('close 后 pending 保持、不保存、不 fault', async () => {
    const { wrapper, vm, playerStore } = await mountWithPending()
    const saveSpy = vi.spyOn(playerStore, 'saveGame')
    wrapper.find('.modal-overlay').trigger('click')
    await nextTick()
    expect(playerStore.pendingOfflineReward).toEqual(PENDING_FULL)
    expect(saveSpy).not.toHaveBeenCalled()
    expect(vm.runtimeStartupStatus).toBe('ready')
    expect(vm.runtimeStartupError).toBe('')
    wrapper.unmount()
  })

  it('保持 pending 后再次显示可重新挂载', async () => {
    const { wrapper, vm } = await mountWithPending()
    wrapper.find('.modal-overlay').trigger('click')
    await nextTick()
    expect(wrapper.find('.offline-modal').exists()).toBe(false)
    vm.showOfflineModal = true
    await flushPromises()
    await vi.dynamicImportSettled()
    await nextTick()
    expect(vm.showOfflineModal).toBe(true)
    expect(wrapper.find('.offline-modal').exists()).toBe(true)
    wrapper.unmount()
  })

  it('再次挂载单次点击只调用一次', async () => {
    const { wrapper, vm, playerStore } = await mountWithPending()
    wrapper.find('.modal-overlay').trigger('click')
    await nextTick()
    vm.showOfflineModal = true
    await flushPromises()
    await vi.dynamicImportSettled()
    await nextTick()
    const claimSpy = vi.spyOn(playerStore, 'claimOfflineReward').mockReturnValue({ ...PENDING_FULL })
    wrapper.find('.offline-modal button').trigger('click')
    await nextTick()
    expect(claimSpy).toHaveBeenCalledTimes(1)
    expect(vm.showOfflineModal).toBe(false)
    wrapper.unmount()
  })
})

describe('Phase 3.56 — runtime / Store 保持', () => {
  async function openClose(vm: AppVm) {
    vm.showOfflineModal = false
    await nextTick()
    vm.showOfflineModal = true
    await flushPromises()
    await vi.dynamicImportSettled()
    await nextTick()
    vm.showOfflineModal = false
    await nextTick()
  }

  it('单纯打开关闭不改变 player、monster 或 pending 内容', async () => {
    const { wrapper, vm, playerStore } = await mountWithPending()
    const monsterStore = useMonsterStore()
    const hpBefore = playerStore.player.currentHp
    const diffBefore = monsterStore.difficultyValue
    await openClose(vm)
    expect(playerStore.player.currentHp).toBe(hpBefore)
    expect(monsterStore.difficultyValue).toBe(diffBefore)
    expect(playerStore.pendingOfflineReward).toEqual(PENDING_FULL)
    wrapper.unmount()
  })

  it('单纯打开关闭不写主存档或 rebirth_data', async () => {
    const { wrapper, vm, playerStore } = await mountWithPending()
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    const saveSpy = vi.spyOn(playerStore, 'saveGame')
    const logoutSpy = vi.spyOn(playerStore, 'recordLogout')
    await openClose(vm)
    expect(saveSpy).not.toHaveBeenCalled()
    expect(logoutSpy).not.toHaveBeenCalled()
    expect(setItemSpy.mock.calls.filter(c => c[0] === 'rebirth_data').length).toBe(0)
    expect(setItemSpy.mock.calls.filter(c => c[0] === 'lollipop_adventure_save').length).toBe(0)
    wrapper.unmount()
  })

  it('不新增 RAF、interval、beforeunload 资源', async () => {
    const { wrapper, vm, rafSpy, intervalSpy, addSpy } = await mountWithPending()
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
