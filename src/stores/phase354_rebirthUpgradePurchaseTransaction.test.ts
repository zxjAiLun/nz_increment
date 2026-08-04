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
import { useRebirthStore, REBIRTH_UPGRADES } from './rebirthStore'
import App from '../App.vue'
import type { ComponentPublicInstance } from 'vue'
// @ts-ignore —— 测试运行于 Node，无需在应用 tsconfig 中引入 @types/node 全局类型
import { readFileSync } from 'node:fs'
// @ts-ignore
import { resolve } from 'node:path'
// @ts-ignore
declare const process: { cwd(): string }

/**
 * Phase 3.54 — 转生升级购买原子事务与交互熔断。
 *
 * - rebirthStore.purchaseUpgrade(upgradeId) 收紧为失败闭合事务：upgradeId / 点数 /
 *   目标记录 / cost 全部前置校验；快照 points/upgrades → 独立 nextUpgrades → 单次
 *   saveRebirthData → 成功 true；保存 throw 时引用级回滚并 false。
 * - RebirthModal 购买按钮只 emit('purchaseUpgrade', upgrade.id)，不再直接调用 Store。
 * - App purchaseRebirthUpgrade(upgradeId)：ready guard + action 异常边界
 *   （rebirth upgrade purchase failed）；false 保持 shop 不 fault；unexpected throw 进入 fail-stop。
 */

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

type AppVm = ComponentPublicInstance & {
  purchaseRebirthUpgrade?: (upgradeId: string) => void
  performRebirth?: () => void
  useSkill?: (i: number) => void
  switchBattleMode?: (m: 'main' | 'training') => void
  goBackLevels?: () => void
  onClaimOffline?: () => void
  confirmReset?: () => void
  runtimeStartupStatus?: 'initializing' | 'ready' | 'blocked' | 'faulted'
  runtimeStartupError?: string
  showRebirthModal?: boolean
  showRebirthShop?: boolean
}

/** 挂载 App：保留真实 RebirthModal（点击真实购买按钮 emit），stub 掉其他重型子组件。 */
function mountAppReal() {
  return mount(App, {
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
}

/** 挂载并进入 ready 状态，返回真实 RebirthModal 所在 App 实例。 */
async function mountReadyShop() {
  seedAlive()
  const rebirthStore = useRebirthStore()
  const gameStore = useGameStore()
  vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
  const wrapper = mountAppReal()
  await nextTick()
  const vm = wrapper.vm as unknown as AppVm
  return { wrapper, vm, rebirthStore, gameStore }
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

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  warmupStores()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('Phase 3.54 — Store 成功事务', () => {
  it('零级目标成功购买：true、精确扣点、新增等级 1、保存一次', () => {
    const rebirthStore = useRebirthStore()
    rebirthStore.rebirthPoints = 1000
    rebirthStore.upgrades = []
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')

    expect(rebirthStore.purchaseUpgrade('crit_rate')).toBe(true)

    // cost = floor(10 * 1.15^0) = 10
    expect(rebirthStore.rebirthPoints).toBe(990)
    expect(rebirthStore.upgrades).toEqual([{ upgradeId: 'crit_rate', currentLevel: 1 }])
    expect(setItemSpy.mock.calls.filter(c => c[0] === 'rebirth_data').length).toBe(1)
  })

  it('已有目标成功购买：只增加一级、其他条目内容和顺序不变', () => {
    const rebirthStore = useRebirthStore()
    rebirthStore.rebirthPoints = 1000
    rebirthStore.upgrades = [
      { upgradeId: 'gold_bonus', currentLevel: 3 },
      { upgradeId: 'crit_rate', currentLevel: 2 }
    ]

    expect(rebirthStore.purchaseUpgrade('crit_rate')).toBe(true)

    // cost = floor(10 * 1.15^2) = floor(13.225) = 13
    expect(rebirthStore.rebirthPoints).toBe(987)
    expect(rebirthStore.upgrades).toEqual([
      { upgradeId: 'gold_bonus', currentLevel: 3 },
      { upgradeId: 'crit_rate', currentLevel: 3 }
    ])
  })

  it('成功使用新 upgrades 数组和新目标对象（原引用不被复用）', () => {
    const rebirthStore = useRebirthStore()
    rebirthStore.rebirthPoints = 1000
    const original = [{ upgradeId: 'crit_rate', currentLevel: 2 }]
    rebirthStore.upgrades = original
    const proxyBefore = rebirthStore.upgrades

    expect(rebirthStore.purchaseUpgrade('crit_rate')).toBe(true)

    expect(rebirthStore.upgrades).not.toBe(proxyBefore) // 新数组
    expect(rebirthStore.upgrades[0]).not.toBe(proxyBefore[0]) // 新目标对象
    expect(rebirthStore.upgrades).toEqual([{ upgradeId: 'crit_rate', currentLevel: 3 }])
  })

  it('旧数组和旧目标对象不被原地修改', () => {
    const rebirthStore = useRebirthStore()
    rebirthStore.rebirthPoints = 1000
    const original = [{ upgradeId: 'crit_rate', currentLevel: 2 }]
    rebirthStore.upgrades = original

    expect(rebirthStore.purchaseUpgrade('crit_rate')).toBe(true)

    expect(original).toEqual([{ upgradeId: 'crit_rate', currentLevel: 2 }])
    expect(original[0].currentLevel).toBe(2)
    expect(original.length).toBe(1)
  })
})

describe('Phase 3.54 — Store 预期拒绝', () => {
  it('未知、空白及非字符串 ID 返回 false', () => {
    const rebirthStore = useRebirthStore()
    rebirthStore.rebirthPoints = 1000

    expect(rebirthStore.purchaseUpgrade('unknown-id')).toBe(false)
    expect(rebirthStore.purchaseUpgrade('')).toBe(false)
    expect(rebirthStore.purchaseUpgrade(' ')).toBe(false)
    expect(rebirthStore.purchaseUpgrade(null as unknown as string)).toBe(false)
    expect(rebirthStore.purchaseUpgrade(undefined as unknown as string)).toBe(false)
    expect(rebirthStore.purchaseUpgrade(123 as unknown as string)).toBe(false)
    expect(rebirthStore.purchaseUpgrade({} as unknown as string)).toBe(false)
    expect(rebirthStore.rebirthPoints).toBe(1000)
  })

  it('点数不足返回 false', () => {
    const rebirthStore = useRebirthStore()
    rebirthStore.rebirthPoints = 5
    expect(rebirthStore.purchaseUpgrade('crit_rate')).toBe(false) // cost 10
    expect(rebirthStore.rebirthPoints).toBe(5)
    expect(rebirthStore.upgrades).toEqual([])
  })

  it('满级返回 false', () => {
    const rebirthStore = useRebirthStore()
    rebirthStore.rebirthPoints = 1000
    rebirthStore.upgrades = [{ upgradeId: 'crit_rate', currentLevel: 100 }]
    expect(rebirthStore.purchaseUpgrade('crit_rate')).toBe(false)
    expect(rebirthStore.upgrades).toEqual([{ upgradeId: 'crit_rate', currentLevel: 100 }])
  })

  it('NaN、Infinity、负数、小数 points 返回 false', () => {
    const rebirthStore = useRebirthStore()
    for (const bad of [NaN, Infinity, -Infinity, -5, 5.5]) {
      rebirthStore.rebirthPoints = bad
      expect(rebirthStore.purchaseUpgrade('crit_rate')).toBe(false)
    }
  })

  it('非整数、负数、NaN、Infinity target level 返回 false', () => {
    const rebirthStore = useRebirthStore()
    for (const bad of [1.5, -1, NaN, Infinity]) {
      rebirthStore.rebirthPoints = 1000
      rebirthStore.upgrades = [{ upgradeId: 'crit_rate', currentLevel: bad }]
      expect(rebirthStore.purchaseUpgrade('crit_rate')).toBe(false)
    }
  })

  it('重复 target 记录返回 false', () => {
    const rebirthStore = useRebirthStore()
    rebirthStore.rebirthPoints = 1000
    rebirthStore.upgrades = [
      { upgradeId: 'crit_rate', currentLevel: 1 },
      { upgradeId: 'crit_rate', currentLevel: 2 }
    ]
    expect(rebirthStore.purchaseUpgrade('crit_rate')).toBe(false)
    expect(rebirthStore.upgrades).toEqual([
      { upgradeId: 'crit_rate', currentLevel: 1 },
      { upgradeId: 'crit_rate', currentLevel: 2 }
    ])
  })

  it('非法 cost fail-closed', () => {
    const critRate = REBIRTH_UPGRADES.find(u => u.id === 'crit_rate')!
    const originalCost = critRate.costPerLevel
    try {
      critRate.costPerLevel = NaN
      const rebirthStore = useRebirthStore()
      rebirthStore.rebirthPoints = 1000
      expect(rebirthStore.purchaseUpgrade('crit_rate')).toBe(false)
      expect(rebirthStore.rebirthPoints).toBe(1000)
      expect(rebirthStore.upgrades).toEqual([])
    } finally {
      critRate.costPerLevel = originalCost
    }
  })

  it('所有前置拒绝零写盘、状态引用不变', () => {
    const rebirthStore = useRebirthStore()
    rebirthStore.rebirthPoints = 100
    const original = [{ upgradeId: 'crit_rate', currentLevel: 1 }]
    rebirthStore.upgrades = original
    const proxyBefore = rebirthStore.upgrades
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')

    expect(rebirthStore.purchaseUpgrade('')).toBe(false)
    expect(rebirthStore.purchaseUpgrade('unknown-id')).toBe(false)
    expect(rebirthStore.purchaseUpgrade(' ')).toBe(false)
    expect(rebirthStore.purchaseUpgrade(null as unknown as string)).toBe(false)

    rebirthStore.rebirthPoints = 5
    expect(rebirthStore.purchaseUpgrade('crit_rate')).toBe(false) // 点数不足

    rebirthStore.rebirthPoints = 100
    rebirthStore.upgrades = [
      { upgradeId: 'crit_rate', currentLevel: 1 },
      { upgradeId: 'crit_rate', currentLevel: 2 }
    ]
    expect(rebirthStore.purchaseUpgrade('crit_rate')).toBe(false) // 重复记录
    rebirthStore.upgrades = original

    expect(rebirthStore.upgrades).toBe(proxyBefore) // 原引用保持
    expect(rebirthStore.rebirthPoints).toBe(100)
    expect(setItemSpy).not.toHaveBeenCalled()
  })
})

describe('Phase 3.54 — 保存失败回滚', () => {
  it('saveRebirthData 真实 localStorage 写入 throw：不外抛、false、points/upgrades 恢复、磁盘旧值不变', () => {
    const rebirthStore = useRebirthStore()
    rebirthStore.rebirthPoints = 1000
    const original = [{ upgradeId: 'crit_rate', currentLevel: 1 }]
    rebirthStore.upgrades = original
    const oldDisk = JSON.stringify({ rebirthPoints: 1000, totalRebirthCount: 0, upgrades: original, lastRebirthTime: 0 })
    localStorage.setItem('rebirth_data', oldDisk)
    const proxyBefore = rebirthStore.upgrades

    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key: string) => {
      if (key === 'rebirth_data') throw new Error('disk full')
    })

    let threw = false
    try {
      expect(rebirthStore.purchaseUpgrade('crit_rate')).toBe(false)
    } catch {
      threw = true
    }
    expect(threw).toBe(false)

    expect(rebirthStore.rebirthPoints).toBe(1000) // points 引用值恢复
    expect(rebirthStore.upgrades).toBe(proxyBefore) // upgrades 原引用恢复
    expect(original[0].currentLevel).toBe(1) // 原条目内容恢复
    expect(localStorage.getItem('rebirth_data')).toBe(oldDisk) // 磁盘旧值不变
  })

  it('保存只尝试一次，零 retry', () => {
    const rebirthStore = useRebirthStore()
    rebirthStore.rebirthPoints = 1000
    rebirthStore.upgrades = []
    let rebirthWrites = 0
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key: string) => {
      if (key === 'rebirth_data') {
        rebirthWrites++
        throw new Error('disk full')
      }
    })

    expect(rebirthStore.purchaseUpgrade('crit_rate')).toBe(false)
    expect(rebirthWrites).toBe(1)
  })
})

describe('Phase 3.54 — App 与组件', () => {
  it('RebirthModal 真实按钮 emit 精确 upgradeId', async () => {
    const { wrapper, vm, rebirthStore } = await mountReadyShop()
    rebirthStore.rebirthPoints = 10000
    vm.showRebirthShop = true
    await flushPromises()
    await vi.dynamicImportSettled()
    await nextTick()
    const actionSpy = vi.spyOn(rebirthStore, 'purchaseUpgrade').mockReturnValue(true)

    wrapper.find('.buy-btn').trigger('click')
    await nextTick()

    expect(actionSpy).toHaveBeenCalledTimes(1)
    expect(actionSpy.mock.calls[0][0]).toBe('crit_rate') // 第一个 tech 升级即 crit_rate
    wrapper.unmount()
  })

  it('组件不再直接调用 Store action（faulted 下点击零 action，证明经 App guard 委托）', async () => {
    const { wrapper, vm, rebirthStore } = await mountReadyShop()
    rebirthStore.rebirthPoints = 10000
    vm.showRebirthShop = true
    vm.runtimeStartupStatus = 'faulted'
    await flushPromises()
    await vi.dynamicImportSettled()
    await nextTick()
    const actionSpy = vi.spyOn(rebirthStore, 'purchaseUpgrade')

    wrapper.find('.buy-btn').trigger('click')
    await nextTick()

    expect(actionSpy).not.toHaveBeenCalled()
    expect(vm.showRebirthShop).toBe(true)
    wrapper.unmount()
  })

  it('App ready + true：action 一次、shop/modal 不变、ready 保持', async () => {
    const { wrapper, vm, rebirthStore } = await mountReadyShop()
    rebirthStore.rebirthPoints = 10000
    vm.showRebirthShop = true
    await flushPromises()
    await vi.dynamicImportSettled()
    await nextTick()
    const actionSpy = vi.spyOn(rebirthStore, 'purchaseUpgrade').mockReturnValue(true)

    wrapper.find('.buy-btn').trigger('click')
    await nextTick()

    expect(actionSpy).toHaveBeenCalledTimes(1)
    expect(vm.showRebirthShop).toBe(true) // 购买成功不关闭 shop
    expect(vm.showRebirthModal).toBe(false)
    expect(vm.runtimeStartupStatus).toBe('ready')
    wrapper.unmount()
  })

  it('App ready + false：shop/modal 不变、不 fault', async () => {
    const { wrapper, vm, rebirthStore } = await mountReadyShop()
    rebirthStore.rebirthPoints = 10000
    vm.showRebirthShop = true
    await flushPromises()
    await vi.dynamicImportSettled()
    await nextTick()
    const actionSpy = vi.spyOn(rebirthStore, 'purchaseUpgrade').mockReturnValue(false)

    wrapper.find('.buy-btn').trigger('click')
    await nextTick()

    expect(actionSpy).toHaveBeenCalledTimes(1)
    expect(vm.showRebirthShop).toBe(true)
    expect(vm.runtimeStartupStatus).toBe('ready')
    expect(vm.runtimeStartupError).toBe('')
    wrapper.unmount()
  })

  it('false 后再次点击是独立请求，单次 handler 不 retry', async () => {
    const { wrapper, vm, rebirthStore } = await mountReadyShop()
    rebirthStore.rebirthPoints = 10000
    vm.showRebirthShop = true
    await flushPromises()
    await vi.dynamicImportSettled()
    await nextTick()
    const actionSpy = vi.spyOn(rebirthStore, 'purchaseUpgrade').mockReturnValue(false)

    wrapper.find('.buy-btn').trigger('click')
    wrapper.find('.buy-btn').trigger('click')
    await nextTick()

    expect(actionSpy).toHaveBeenCalledTimes(2) // 两次独立用户请求
    expect(vm.showRebirthShop).toBe(true)
    expect(vm.runtimeStartupStatus).toBe('ready')
    wrapper.unmount()
  })

  it('App 不额外保存', async () => {
    const { wrapper, vm, rebirthStore } = await mountReadyShop()
    rebirthStore.rebirthPoints = 10000
    vm.showRebirthShop = true
    await flushPromises()
    await vi.dynamicImportSettled()
    await nextTick()
    vi.spyOn(rebirthStore, 'purchaseUpgrade').mockReturnValue(true)
    const saveSpy = vi.spyOn(usePlayerStore(), 'saveGame')

    wrapper.find('.buy-btn').trigger('click')
    await nextTick()

    expect(saveSpy).not.toHaveBeenCalled() // 购买不触发主存档保存
    wrapper.unmount()
  })
})

describe('Phase 3.54 — Unexpected action throw', () => {
  it('Error 精确分类：faulted、reason 精确', async () => {
    const { wrapper, vm, rebirthStore } = await mountReadyShop()
    rebirthStore.rebirthPoints = 10000
    vm.showRebirthShop = true
    await flushPromises()
    await vi.dynamicImportSettled()
    await nextTick()
    vi.spyOn(rebirthStore, 'purchaseUpgrade').mockImplementation(() => {
      throw new Error('purchase boom')
    })

    wrapper.find('.buy-btn').trigger('click')
    await nextTick()

    expect(vm.runtimeStartupStatus).toBe('faulted')
    expect(vm.runtimeStartupError).toBe('rebirth upgrade purchase failed: purchase boom')
    wrapper.unmount()
  })

  it('非 Error：String 规范化', async () => {
    const { wrapper, vm, rebirthStore } = await mountReadyShop()
    rebirthStore.rebirthPoints = 10000
    vm.showRebirthShop = true
    await flushPromises()
    await vi.dynamicImportSettled()
    await nextTick()
    vi.spyOn(rebirthStore, 'purchaseUpgrade').mockImplementation(() => {
      throw 'purchase-string-boom'
    })

    wrapper.find('.buy-btn').trigger('click')
    await nextTick()

    expect(vm.runtimeStartupError).toBe('rebirth upgrade purchase failed: purchase-string-boom')
    wrapper.unmount()
  })

  it('空 Error：无尾随冒号', async () => {
    const { wrapper, vm, rebirthStore } = await mountReadyShop()
    rebirthStore.rebirthPoints = 10000
    vm.showRebirthShop = true
    await flushPromises()
    await vi.dynamicImportSettled()
    await nextTick()
    vi.spyOn(rebirthStore, 'purchaseUpgrade').mockImplementation(() => {
      throw new Error('')
    })

    wrapper.find('.buy-btn').trigger('click')
    await nextTick()

    expect(vm.runtimeStartupError).toBe('rebirth upgrade purchase failed')
    expect(vm.runtimeStartupError).not.toContain('rebirth upgrade purchase failed:')
    wrapper.unmount()
  })

  it('真实 emit 不外抛', async () => {
    const { wrapper, vm, rebirthStore } = await mountReadyShop()
    rebirthStore.rebirthPoints = 10000
    vm.showRebirthShop = true
    await flushPromises()
    await vi.dynamicImportSettled()
    await nextTick()
    vi.spyOn(rebirthStore, 'purchaseUpgrade').mockImplementation(() => {
      throw new Error('purchase boom')
    })

    let threw = false
    try {
      wrapper.find('.buy-btn').trigger('click')
    } catch {
      threw = true
    }
    await nextTick()

    expect(threw).toBe(false)
    expect(vm.runtimeStartupStatus).toBe('faulted')
    wrapper.unmount()
  })

  it('throw 后 modal/shop 不关闭', async () => {
    const { wrapper, vm, rebirthStore } = await mountReadyShop()
    rebirthStore.rebirthPoints = 10000
    vm.showRebirthShop = true
    await flushPromises()
    await vi.dynamicImportSettled()
    await nextTick()
    vi.spyOn(rebirthStore, 'purchaseUpgrade').mockImplementation(() => {
      throw new Error('purchase boom')
    })

    wrapper.find('.buy-btn').trigger('click')
    await nextTick()

    expect(vm.showRebirthShop).toBe(true)
    expect(vm.showRebirthModal).toBe(false)
    wrapper.unmount()
  })

  it('battleError 原引用保持', async () => {
    const { wrapper, vm, rebirthStore, gameStore } = await mountReadyShop()
    rebirthStore.rebirthPoints = 10000
    vm.showRebirthShop = true
    await flushPromises()
    await vi.dynamicImportSettled()
    await nextTick()
    const existing = new Error('existing store fault')
    gameStore.battleError = existing
    vi.spyOn(rebirthStore, 'purchaseUpgrade').mockImplementation(() => {
      throw new Error('purchase boom')
    })

    wrapper.find('.buy-btn').trigger('click')
    await nextTick()

    expect(gameStore.battleError).toBe(existing)
    expect(gameStore.battleError!.message).toBe('existing store fault')
    wrapper.unmount()
  })

  it('throw 后 RAF、interval、listener 各清理一次', async () => {
    seedAlive()
    const rebirthStore = useRebirthStore()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    vi.spyOn(rebirthStore, 'purchaseUpgrade').mockImplementation(() => {
      throw new Error('purchase boom')
    })
    const { cancelSpy, intervalSpy, clearSpy, removeSpy } = spyCleanup()

    const wrapper = mountAppReal()
    await nextTick()
    const vm = wrapper.vm as unknown as AppVm
    rebirthStore.rebirthPoints = 10000
    vm.showRebirthShop = true
    await flushPromises()
    await vi.dynamicImportSettled()
    await nextTick()
    const runtimeSetIdx = intervalSpy.mock.calls.findIndex(c => c[1] === 1000)
    const runtimeIntervalId = intervalSpy.mock.results[runtimeSetIdx].value

    wrapper.find('.buy-btn').trigger('click')
    await nextTick()

    expect(cancelSpy.mock.calls.filter(c => c[0] === 1).length).toBe(1)
    expect(clearSpy.mock.calls.filter(c => c[0] === runtimeIntervalId).length).toBe(1)
    expect(removeSpy.mock.calls.filter(c => c[0] === 'beforeunload').length).toBe(1)
    wrapper.unmount()
  })

  it('cleanup 同时 throw 保持购买 reason', async () => {
    seedAlive()
    const rebirthStore = useRebirthStore()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    vi.spyOn(rebirthStore, 'purchaseUpgrade').mockImplementation(() => {
      throw new Error('purchase boom')
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {
      throw new Error('cancel boom')
    })

    const wrapper = mountAppReal()
    await nextTick()
    const vm = wrapper.vm as unknown as AppVm
    rebirthStore.rebirthPoints = 10000
    vm.showRebirthShop = true
    await flushPromises()
    await vi.dynamicImportSettled()
    await nextTick()

    wrapper.find('.buy-btn').trigger('click')
    await nextTick()

    expect(vm.runtimeStartupError).toBe('rebirth upgrade purchase failed: purchase boom')
    expect(vm.runtimeStartupError).not.toContain('runtime cleanup failed')
    wrapper.unmount()
  })

  it('fault 后重复购买零 action', async () => {
    const { wrapper, vm, rebirthStore } = await mountReadyShop()
    rebirthStore.rebirthPoints = 10000
    vm.showRebirthShop = true
    await flushPromises()
    await vi.dynamicImportSettled()
    await nextTick()
    const actionSpy = vi.spyOn(rebirthStore, 'purchaseUpgrade').mockImplementation(() => {
      throw new Error('purchase boom')
    })

    wrapper.find('.buy-btn').trigger('click')
    await nextTick()
    expect(actionSpy).toHaveBeenCalledTimes(1)

    wrapper.find('.buy-btn').trigger('click')
    await nextTick()
    expect(actionSpy).toHaveBeenCalledTimes(1) // fault 后 no-op
    expect(vm.runtimeStartupError).toBe('rebirth upgrade purchase failed: purchase boom')
    wrapper.unmount()
  })

  it('fault 后重复购买及 Phase 3.50–3.53 interaction 全部 no-op', async () => {
    const { wrapper, vm, rebirthStore, gameStore } = await mountReadyShop()
    rebirthStore.rebirthPoints = 10000
    vm.showRebirthShop = true
    await flushPromises()
    await vi.dynamicImportSettled()
    await nextTick()
    const actionSpy = vi.spyOn(rebirthStore, 'purchaseUpgrade').mockImplementation(() => {
      throw new Error('purchase boom')
    })
    const skillSpy = vi.spyOn(gameStore, 'tryUsePlayerSkill')
    const resumeSpy = vi.spyOn(gameStore, 'resumeBattle')
    const goSpy = vi.spyOn(gameStore, 'tryPurchaseGoBackLevels')
    const claimSpy = vi.spyOn(usePlayerStore(), 'claimOfflineReward')
    const resetSpy = vi.spyOn(usePlayerStore(), 'resetGame')
    const rebirthSpy = vi.spyOn(rebirthStore, 'performRebirth')

    wrapper.find('.buy-btn').trigger('click')
    await nextTick()
    expect(actionSpy).toHaveBeenCalledTimes(1)

    vm.purchaseRebirthUpgrade!('crit_rate') // 直接调用同样 no-op
    vm.useSkill!(0)
    vm.switchBattleMode!('main')
    vm.goBackLevels!()
    vm.onClaimOffline!()
    vm.confirmReset!()
    vm.performRebirth!()
    await nextTick()

    expect(actionSpy).toHaveBeenCalledTimes(1)
    expect(skillSpy).not.toHaveBeenCalled()
    expect(resumeSpy).not.toHaveBeenCalled()
    expect(goSpy).not.toHaveBeenCalled()
    expect(claimSpy).not.toHaveBeenCalled()
    expect(resetSpy).not.toHaveBeenCalled()
    expect(rebirthSpy).not.toHaveBeenCalled()
    expect(vm.runtimeStartupError).toBe('rebirth upgrade purchase failed: purchase boom')
    wrapper.unmount()
  })

  it('later Vue unmount 零 shutdown save', async () => {
    const { wrapper, vm, rebirthStore } = await mountReadyShop()
    rebirthStore.rebirthPoints = 10000
    vm.showRebirthShop = true
    await flushPromises()
    await vi.dynamicImportSettled()
    await nextTick()
    vi.spyOn(rebirthStore, 'purchaseUpgrade').mockImplementation(() => {
      throw new Error('purchase boom')
    })
    const saveSpy = vi.spyOn(usePlayerStore(), 'saveGame')

    wrapper.find('.buy-btn').trigger('click')
    await nextTick()
    expect(vm.runtimeStartupStatus).toBe('faulted')
    wrapper.unmount()
    expect(saveSpy).not.toHaveBeenCalled()
  })
})

describe('Phase 3.54 — Non-ready guards', () => {
  it('initializing：零 action、UI/状态不变', async () => {
    const { wrapper, vm, rebirthStore } = await mountReadyShop()
    rebirthStore.rebirthPoints = 10000
    vm.showRebirthShop = true
    vm.runtimeStartupStatus = 'initializing'
    await flushPromises()
    await vi.dynamicImportSettled()
    await nextTick()
    const actionSpy = vi.spyOn(rebirthStore, 'purchaseUpgrade')

    wrapper.find('.buy-btn').trigger('click')
    await nextTick()

    expect(actionSpy).not.toHaveBeenCalled()
    expect(vm.showRebirthShop).toBe(true)
    expect(vm.runtimeStartupStatus).toBe('initializing')
    wrapper.unmount()
  })

  it('blocked：零 action、UI/状态不变', async () => {
    seedAlive()
    const rebirthStore = useRebirthStore()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: false, reason: 'invalid hp' })

    const wrapper = mountAppReal()
    await nextTick()
    const vm = wrapper.vm as unknown as AppVm
    expect(vm.runtimeStartupStatus).toBe('blocked')
    rebirthStore.rebirthPoints = 10000
    vm.showRebirthShop = true
    await flushPromises()
    await vi.dynamicImportSettled()
    await nextTick()
    const actionSpy = vi.spyOn(rebirthStore, 'purchaseUpgrade')

    wrapper.find('.buy-btn').trigger('click')
    await nextTick()

    expect(actionSpy).not.toHaveBeenCalled()
    expect(vm.showRebirthShop).toBe(true)
    expect(vm.runtimeStartupStatus).toBe('blocked')
    wrapper.unmount()
  })

  it('faulted：零 action、reason 不变', async () => {
    const { wrapper, vm, rebirthStore } = await mountReadyShop()
    rebirthStore.rebirthPoints = 10000
    vm.showRebirthShop = true
    vm.runtimeStartupStatus = 'faulted'
    vm.runtimeStartupError = 'existing fault reason'
    await flushPromises()
    await vi.dynamicImportSettled()
    await nextTick()
    const actionSpy = vi.spyOn(rebirthStore, 'purchaseUpgrade')

    wrapper.find('.buy-btn').trigger('click')
    await nextTick()

    expect(actionSpy).not.toHaveBeenCalled()
    expect(vm.runtimeStartupError).toBe('existing fault reason')
    expect(vm.showRebirthShop).toBe(true)
    wrapper.unmount()
  })
})

describe('Phase 3.54 — 架构护栏', () => {
  const ROOT = process.cwd()

  it('护栏：Store 所有校验位于 mutation 和 save 前', () => {
    const src = readFileSync(resolve(ROOT, 'src/stores/rebirthStore.ts'), 'utf8').replace(/\r\n/g, '\n')
    const m = src.match(/  const purchaseUpgrade = \(upgradeId: string\): boolean => \{\s*[\s\S]*?\n  \}/)
    expect(m).toBeTruthy()
    const body = m![0]
    const mutateIdx = body.indexOf('rebirthPoints.value = previousPoints - cost')
    const saveIdx = body.indexOf('saveRebirthData()')
    expect(mutateIdx).toBeGreaterThan(-1)
    expect(saveIdx).toBeGreaterThan(mutateIdx)
    expect(body.indexOf("typeof upgradeId !== 'string'")).toBeGreaterThan(-1)
    for (const validation of [
      'Number.isFinite(points)',
      'matches.length > 1',
      'Number.isFinite(currentLevel)',
      'currentLevel >= upgrade.maxLevel',
      'cost <= 0',
      'points < cost'
    ]) {
      expect(body.indexOf(validation)).toBeGreaterThan(-1)
      expect(body.indexOf(validation)).toBeLessThan(mutateIdx)
    }
  })

  it('护栏：Store 不原地修改旧 upgrades 数组或对象', () => {
    const src = readFileSync(resolve(ROOT, 'src/stores/rebirthStore.ts'), 'utf8').replace(/\r\n/g, '\n')
    const m = src.match(/  const purchaseUpgrade = \(upgradeId: string\): boolean => \{\s*[\s\S]*?\n  \}/)
    expect(m).toBeTruthy()
    const body = m![0]
    expect(body).not.toContain('existing.currentLevel++')
    expect(body).not.toContain('upgrades.value.push(')
    expect(body).toContain('upgrades.value.map(item => ({ ...item }))')
    expect(body).toContain('nextUpgrades.push(')
  })

  it('护栏：保存失败恢复原引用', () => {
    const src = readFileSync(resolve(ROOT, 'src/stores/rebirthStore.ts'), 'utf8').replace(/\r\n/g, '\n')
    const m = src.match(/  const purchaseUpgrade = \(upgradeId: string\): boolean => \{\s*[\s\S]*?\n  \}/)
    expect(m).toBeTruthy()
    const body = m![0]
    expect(body).toContain('const previousPoints = rebirthPoints.value')
    expect(body).toContain('const previousUpgrades = upgrades.value')
    expect(body).toContain('const nextUpgrades = upgrades.value.map(item => ({ ...item }))')
    expect(body).toContain('} catch {')
    const applyIdx = body.indexOf('upgrades.value = nextUpgrades')
    const rollbackIdx = body.indexOf('upgrades.value = previousUpgrades')
    expect(rollbackIdx).toBeGreaterThan(applyIdx)
    // 应用行是 `previousPoints - cost`，用行尾锚定唯一匹配回滚赋值行
    expect(body.indexOf('rebirthPoints.value = previousPoints\n')).toBeGreaterThan(applyIdx)
  })

  it('护栏：save 调用点恰好一个', () => {
    const src = readFileSync(resolve(ROOT, 'src/stores/rebirthStore.ts'), 'utf8').replace(/\r\n/g, '\n')
    const m = src.match(/  const purchaseUpgrade = \(upgradeId: string\): boolean => \{\s*[\s\S]*?\n  \}/)
    expect(m).toBeTruthy()
    const body = m![0]
    const calls = body.match(/saveRebirthData\(\)/g) || []
    expect(calls.length).toBe(1)
  })

  it('护栏：RebirthModal 只 emit，不直接购买', () => {
    const modal = readFileSync(resolve(ROOT, 'src/components/RebirthModal.vue'), 'utf8').replace(/\r\n/g, '\n')
    expect(modal).toContain("emit('purchaseUpgrade', upgrade.id)")
    expect(modal).toContain('purchaseUpgrade: [upgradeId: string]')
    expect(modal).not.toContain('rebirthStore.purchaseUpgrade')
    expect(modal).not.toContain('purchaseUpgrade(upgrade.id)')
  })

  it('护栏：App ready guard、try/catch 和精确分类存在', () => {
    const app = readFileSync(resolve(ROOT, 'src/App.vue'), 'utf8').replace(/\r\n/g, '\n')
    const m = app.match(/function purchaseRebirthUpgrade\(upgradeId: string\)\s*\{[\s\S]*?\n\}/)
    expect(m).toBeTruthy()
    const body = m![0]
    expect(body).toContain("runtimeStartupStatus.value !== 'ready'")
    expect(body).toContain('try {')
    expect(body).toContain('rebirthStore.purchaseUpgrade(upgradeId)')
    expect(body).toContain("formatRuntimeFault('rebirth upgrade purchase failed'")
    expect(body).toContain('enterRuntimeFault(formatRuntimeFault(')
    expect(app).toContain('@purchase-upgrade="purchaseRebirthUpgrade"')
  })

  it('护栏：App 不直接修改 Store 状态或调用存储', () => {
    const app = readFileSync(resolve(ROOT, 'src/App.vue'), 'utf8').replace(/\r\n/g, '\n')
    const m = app.match(/function purchaseRebirthUpgrade\(upgradeId: string\)\s*\{[\s\S]*?\n\}/)
    expect(m).toBeTruthy()
    const body = m![0]
    for (const forbidden of [
      'rebirthPoints',
      'upgrades',
      'saveRebirthData',
      'saveGame',
      'recordLogout',
      'localStorage',
      'resetForRebirth'
    ]) {
      expect(body).not.toContain(forbidden)
    }
  })
})
