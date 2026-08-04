// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { usePlayerStore } from './playerStore'
import { useMonsterStore } from './monsterStore'
import { useGameStore, type GoBackLevelsPurchaseResult } from './gameStore'
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

/**
 * Phase 3.50 — Ready-gated 运行时交互异常熔断。
 *
 * 四条交互（useSkill / switchBattleMode / goBackLevels / onClaimOffline）遵循：
 * ready guard → 权威 action 一次 → 正常 false/null 保持既有业务失败语义（不 fault）→
 * 意外 throw 进入 App fail-stop（skill interaction failed / battle mode switch failed /
 * go back levels failed / offline reward claim failed），复用 formatRuntimeFault/enterRuntimeFault。
 *
 * 核心交互通过真实组件 emit（自定义 stub 按钮点击 → $emit → App handler）触发；
 * 非 ready guard 补充直接 VM 调用验证。
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

type AppVm = ComponentPublicInstance & {
  useSkill?: (i: number) => void
  switchBattleMode?: (m: 'main' | 'training') => void
  goBackLevels?: () => void
  onClaimOffline?: () => void
  runtimeStartupStatus?: 'initializing' | 'ready' | 'blocked' | 'faulted'
  runtimeStartupError?: string
  battleMode?: 'main' | 'training'
}

/** 挂载 App：TabsContainer/BattleHUD/OfflineRewardModal 用可点击 emit 的自定义 stub。 */
function mountAppWithEmitters() {
  return mount(App, {
    global: {
      stubs: {
        BattleHUD: {
          template: '<div><button class="emit-switch-main" @click="$emit(\'switch-mode\', \'main\')">main</button><button class="emit-switch-training" @click="$emit(\'switch-mode\', \'training\')">training</button></div>'
        },
        PlayerStatusBar: true,
        OverlayContainer: true,
        TabsContainer: {
          template: '<div><button class="emit-use-skill" @click="$emit(\'use-skill\', 2)">skill</button><button class="emit-goback" @click="$emit(\'go-back-levels\')">goback</button></div>'
        },
        PauseOverlay: true,
        RebirthModal: true,
        OfflineRewardModal: {
          template: '<div class="offline-reward-stub"><button class="emit-claim" @click="$emit(\'claim\')">claim</button></div>'
        }
      }
    }
  })
}

async function mountReady() {
  seedAlive()
  const gameStore = useGameStore()
  vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
  const wrapper = mountAppWithEmitters()
  await nextTick()
  return { wrapper, vm: wrapper.vm as unknown as AppVm, gameStore }
}

async function mountReadyWithPending() {
  seedAlive()
  const playerStore = usePlayerStore()
  playerStore.pendingOfflineReward = { gold: 100, exp: 50 } as OfflineSettlement
  expect(playerStore.saveGame()).toBe(true) // 写盘让 loadGame 水合 pending
  const gameStore = useGameStore()
  vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
  const wrapper = mountAppWithEmitters()
  await nextTick()
  return { wrapper, vm: wrapper.vm as unknown as AppVm, gameStore, playerStore }
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

describe('Phase 3.50 — Skill', () => {
  it('ready + 成功：slotIndex 原样传递、一次调用、保持 ready', async () => {
    const { wrapper, vm, gameStore } = await mountReady()
    const skillSpy = vi.spyOn(gameStore, 'tryUsePlayerSkill').mockReturnValue(true)
    wrapper.find('.emit-use-skill').trigger('click')
    await nextTick()
    expect(skillSpy).toHaveBeenCalledTimes(1)
    expect(skillSpy).toHaveBeenCalledWith(2)
    expect(vm.runtimeStartupStatus).toBe('ready')
    wrapper.unmount()
  })

  it('ready + false：不进入 faulted', async () => {
    const { wrapper, vm, gameStore } = await mountReady()
    const skillSpy = vi.spyOn(gameStore, 'tryUsePlayerSkill').mockReturnValue(false)
    wrapper.find('.emit-use-skill').trigger('click')
    await nextTick()
    expect(skillSpy).toHaveBeenCalledTimes(1)
    expect(vm.runtimeStartupStatus).toBe('ready')
    expect(vm.runtimeStartupError).toBe('')
    wrapper.unmount()
  })

  it('Error：event handler 不外抛、精确 reason', async () => {
    const { wrapper, vm, gameStore } = await mountReady()
    vi.spyOn(gameStore, 'tryUsePlayerSkill').mockImplementation(() => {
      throw new Error('skill boom')
    })
    let threw = false
    try {
      wrapper.find('.emit-use-skill').trigger('click')
    } catch {
      threw = true
    }
    await nextTick()
    expect(threw).toBe(false)
    expect(vm.runtimeStartupStatus).toBe('faulted')
    expect(vm.runtimeStartupError).toBe('skill interaction failed: skill boom')
    wrapper.unmount()
  })

  it('非 Error：String 规范化', async () => {
    const { wrapper, vm, gameStore } = await mountReady()
    vi.spyOn(gameStore, 'tryUsePlayerSkill').mockImplementation(() => {
      throw 'skill-string-boom'
    })
    wrapper.find('.emit-use-skill').trigger('click')
    await nextTick()
    expect(vm.runtimeStartupError).toBe('skill interaction failed: skill-string-boom')
    wrapper.unmount()
  })

  it('空 Error：无尾随冒号', async () => {
    const { wrapper, vm, gameStore } = await mountReady()
    vi.spyOn(gameStore, 'tryUsePlayerSkill').mockImplementation(() => {
      throw new Error('')
    })
    wrapper.find('.emit-use-skill').trigger('click')
    await nextTick()
    expect(vm.runtimeStartupError).toBe('skill interaction failed')
    expect(vm.runtimeStartupError).not.toContain('skill interaction failed:')
    wrapper.unmount()
  })

  it('battleError 不变', async () => {
    const { wrapper, gameStore } = await mountReady()
    const existing = new Error('existing store fault')
    gameStore.battleError = existing
    vi.spyOn(gameStore, 'tryUsePlayerSkill').mockImplementation(() => {
      throw new Error('skill boom')
    })
    wrapper.find('.emit-use-skill').trigger('click')
    await nextTick()
    expect(gameStore.battleError).toBe(existing)
    expect(gameStore.battleError!.message).toBe('existing store fault')
    wrapper.unmount()
  })
})

describe('Phase 3.50 — Battle mode', () => {
  it('ready 切 training：只修改本地模式、不调用 resume', async () => {
    const { wrapper, vm, gameStore } = await mountReady()
    const resumeSpy = vi.spyOn(gameStore, 'resumeBattle')
    wrapper.find('.emit-switch-training').trigger('click')
    await nextTick()
    expect(vm.battleMode).toBe('training')
    expect(resumeSpy).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('ready 切 main + true：提交 main', async () => {
    const { wrapper, vm, gameStore } = await mountReady()
    const resumeSpy = vi.spyOn(gameStore, 'resumeBattle').mockReturnValue(true)
    wrapper.find('.emit-switch-main').trigger('click')
    await nextTick()
    expect(vm.battleMode).toBe('main')
    expect(resumeSpy).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('ready 切 main + false：保持原模式、不 fault', async () => {
    const { wrapper, vm, gameStore } = await mountReady()
    const resumeSpy = vi.spyOn(gameStore, 'resumeBattle').mockReturnValue(false)
    wrapper.find('.emit-switch-training').trigger('click')
    await nextTick()
    wrapper.find('.emit-switch-main').trigger('click')
    await nextTick()
    expect(vm.battleMode).toBe('training')
    expect(vm.runtimeStartupStatus).toBe('ready')
    expect(resumeSpy).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('resume Error：不提交 main、精确 reason', async () => {
    const { wrapper, vm, gameStore } = await mountReady()
    vi.spyOn(gameStore, 'resumeBattle').mockImplementation(() => {
      throw new Error('mode boom')
    })
    wrapper.find('.emit-switch-training').trigger('click')
    await nextTick()
    let threw = false
    try {
      wrapper.find('.emit-switch-main').trigger('click')
    } catch {
      threw = true
    }
    await nextTick()
    expect(threw).toBe(false)
    expect(vm.battleMode).toBe('training')
    expect(vm.runtimeStartupStatus).toBe('faulted')
    expect(vm.runtimeStartupError).toBe('battle mode switch failed: mode boom')
    wrapper.unmount()
  })

  it('resume 非 Error：String 规范化', async () => {
    const { wrapper, vm, gameStore } = await mountReady()
    vi.spyOn(gameStore, 'resumeBattle').mockImplementation(() => {
      throw 'mode-string-boom'
    })
    wrapper.find('.emit-switch-training').trigger('click')
    await nextTick()
    wrapper.find('.emit-switch-main').trigger('click')
    await nextTick()
    expect(vm.runtimeStartupError).toBe('battle mode switch failed: mode-string-boom')
    wrapper.unmount()
  })
})

describe('Phase 3.50 — Go back levels', () => {
  it('ready + true：权威事务一次、保持 ready', async () => {
    const { wrapper, vm, gameStore } = await mountReady()
    const goSpy = vi.spyOn(gameStore, 'tryPurchaseGoBackLevels').mockReturnValue({
      ok: true,
      levels: 10,
      cost: 50,
      difficultyValue: 20,
      monsterLevel: 20
    } as GoBackLevelsPurchaseResult)
    wrapper.find('.emit-goback').trigger('click')
    await nextTick()
    expect(goSpy).toHaveBeenCalledTimes(1)
    expect(vm.runtimeStartupStatus).toBe('ready')
    wrapper.unmount()
  })

  it('ready + false：不 fault', async () => {
    const { wrapper, vm, gameStore } = await mountReady()
    const goSpy = vi.spyOn(gameStore, 'tryPurchaseGoBackLevels').mockReturnValue({
      ok: false,
      reason: 'insufficient diamond',
      cost: 0
    })
    wrapper.find('.emit-goback').trigger('click')
    await nextTick()
    expect(goSpy).toHaveBeenCalledTimes(1)
    expect(vm.runtimeStartupStatus).toBe('ready')
    wrapper.unmount()
  })

  it('Error：精确 reason、不外抛', async () => {
    const { wrapper, vm, gameStore } = await mountReady()
    vi.spyOn(gameStore, 'tryPurchaseGoBackLevels').mockImplementation(() => {
      throw new Error('purchase boom')
    })
    let threw = false
    try {
      wrapper.find('.emit-goback').trigger('click')
    } catch {
      threw = true
    }
    await nextTick()
    expect(threw).toBe(false)
    expect(vm.runtimeStartupStatus).toBe('faulted')
    expect(vm.runtimeStartupError).toBe('go back levels failed: purchase boom')
    wrapper.unmount()
  })

  it('非 Error：String 规范化', async () => {
    const { wrapper, vm, gameStore } = await mountReady()
    vi.spyOn(gameStore, 'tryPurchaseGoBackLevels').mockImplementation(() => {
      throw 'purchase-string-boom'
    })
    wrapper.find('.emit-goback').trigger('click')
    await nextTick()
    expect(vm.runtimeStartupError).toBe('go back levels failed: purchase-string-boom')
    wrapper.unmount()
  })

  it('空 Error：无尾随冒号', async () => {
    const { wrapper, vm, gameStore } = await mountReady()
    vi.spyOn(gameStore, 'tryPurchaseGoBackLevels').mockImplementation(() => {
      throw new Error('')
    })
    wrapper.find('.emit-goback').trigger('click')
    await nextTick()
    expect(vm.runtimeStartupError).toBe('go back levels failed')
    expect(vm.runtimeStartupError).not.toContain('go back levels failed:')
    wrapper.unmount()
  })

  it('initializing/blocked/faulted：零调用', async () => {
    const gameStore = useGameStore()
    const goSpy = vi.spyOn(gameStore, 'tryPurchaseGoBackLevels')
    // initializing
    {
      const { wrapper, vm } = await mountReady()
      vm.runtimeStartupStatus = 'initializing'
      vm.goBackLevels!()
      expect(goSpy).not.toHaveBeenCalled()
      wrapper.unmount()
    }
    // blocked
    {
      seedAlive()
      vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: false, reason: 'invalid hp' })
      const wrapper = mountAppWithEmitters()
      await nextTick()
      const vm = wrapper.vm as unknown as AppVm
      expect(vm.runtimeStartupStatus).toBe('blocked')
      vm.goBackLevels!()
      expect(goSpy).not.toHaveBeenCalled()
      wrapper.unmount()
    }
    // faulted
    {
      const { wrapper, vm } = await mountReady()
      vm.runtimeStartupStatus = 'faulted'
      vm.goBackLevels!()
      expect(goSpy).not.toHaveBeenCalled()
      wrapper.unmount()
    }
  })

  it('不直接调用 saveGame', async () => {
    const { wrapper, gameStore } = await mountReady()
    const playerStore = usePlayerStore()
    const saveSpy = vi.spyOn(playerStore, 'saveGame')
    vi.spyOn(gameStore, 'tryPurchaseGoBackLevels').mockReturnValue({
      ok: true,
      levels: 10,
      cost: 50,
      difficultyValue: 20,
      monsterLevel: 20
    } as GoBackLevelsPurchaseResult)
    wrapper.find('.emit-goback').trigger('click')
    await nextTick()
    expect(saveSpy).not.toHaveBeenCalled() // App 层不直接保存（事务内部保存为闭包调用）
    wrapper.unmount()
  })
})

describe('Phase 3.50 — Offline claim', () => {
  it('成功：claim 一次、modal 关闭、保持 ready', async () => {
    const { wrapper, vm, playerStore } = await mountReadyWithPending()
    expect(wrapper.find('.offline-reward-stub').exists()).toBe(true)
    const claimSpy = vi.spyOn(playerStore, 'claimOfflineReward').mockReturnValue({ gold: 100, exp: 50 } as OfflineSettlement)
    wrapper.find('.emit-claim').trigger('click')
    await nextTick()
    expect(claimSpy).toHaveBeenCalledTimes(1)
    expect(wrapper.find('.offline-reward-stub').exists()).toBe(false)
    expect(vm.runtimeStartupStatus).toBe('ready')
    wrapper.unmount()
  })

  it('false/null：modal 保持、保持 ready', async () => {
    const { wrapper, vm, playerStore } = await mountReadyWithPending()
    const claimSpy = vi.spyOn(playerStore, 'claimOfflineReward').mockReturnValue(null)
    wrapper.find('.emit-claim').trigger('click')
    await nextTick()
    expect(claimSpy).toHaveBeenCalledTimes(1)
    expect(wrapper.find('.offline-reward-stub').exists()).toBe(true)
    expect(vm.runtimeStartupStatus).toBe('ready')
    wrapper.unmount()
  })

  it('Error：modal 关闭、精确 reason、不外抛', async () => {
    const { wrapper, vm, playerStore } = await mountReadyWithPending()
    vi.spyOn(playerStore, 'claimOfflineReward').mockImplementation(() => {
      throw new Error('claim boom')
    })
    let threw = false
    try {
      wrapper.find('.emit-claim').trigger('click')
    } catch {
      threw = true
    }
    await nextTick()
    expect(threw).toBe(false)
    expect(vm.runtimeStartupStatus).toBe('faulted')
    expect(vm.runtimeStartupError).toBe('offline reward claim failed: claim boom')
    expect(wrapper.find('.offline-reward-stub').exists()).toBe(false)
    wrapper.unmount()
  })

  it('非 Error：String 规范化', async () => {
    const { wrapper, vm, playerStore } = await mountReadyWithPending()
    vi.spyOn(playerStore, 'claimOfflineReward').mockImplementation(() => {
      throw 'claim-string-boom'
    })
    wrapper.find('.emit-claim').trigger('click')
    await nextTick()
    expect(vm.runtimeStartupError).toBe('offline reward claim failed: claim-string-boom')
    wrapper.unmount()
  })

  it('空 Error：无尾随冒号', async () => {
    const { wrapper, vm, playerStore } = await mountReadyWithPending()
    vi.spyOn(playerStore, 'claimOfflineReward').mockImplementation(() => {
      throw new Error('')
    })
    wrapper.find('.emit-claim').trigger('click')
    await nextTick()
    expect(vm.runtimeStartupError).toBe('offline reward claim failed')
    expect(vm.runtimeStartupError).not.toContain('offline reward claim failed:')
    wrapper.unmount()
  })

  it('pending reward 不由 App 修改（claim null 时 pending 保留）', async () => {
    const { wrapper, playerStore } = await mountReadyWithPending()
    vi.spyOn(playerStore, 'claimOfflineReward').mockReturnValue(null)
    wrapper.find('.emit-claim').trigger('click')
    await nextTick()
    expect(playerStore.pendingOfflineReward).not.toBeNull()
    wrapper.unmount()
  })
})

describe('Phase 3.50 — 全局故障交互', () => {
  it('interaction throw 后 RAF、interval、listener 各清理一次', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    vi.spyOn(gameStore, 'tryUsePlayerSkill').mockImplementation(() => {
      throw new Error('skill boom')
    })
    const { cancelSpy, intervalSpy, clearSpy, removeSpy } = spyCleanup()

    const wrapper = mountAppWithEmitters()
    await nextTick()
    const runtimeSetIdx = intervalSpy.mock.calls.findIndex(c => c[1] === 1000)
    const runtimeIntervalId = intervalSpy.mock.results[runtimeSetIdx].value

    wrapper.find('.emit-use-skill').trigger('click')
    await nextTick()

    expect(cancelSpy.mock.calls.filter(c => c[0] === 1).length).toBe(1)
    expect(clearSpy.mock.calls.filter(c => c[0] === runtimeIntervalId).length).toBe(1)
    expect(removeSpy.mock.calls.filter(c => c[0] === 'beforeunload').length).toBe(1)
    wrapper.unmount()
  })

  it('action throw 后 saveGame/recordLogout 零调用', async () => {
    const { wrapper, gameStore } = await mountReady()
    const playerStore = usePlayerStore()
    const saveSpy = vi.spyOn(playerStore, 'saveGame')
    const logoutSpy = vi.spyOn(playerStore, 'recordLogout')
    vi.spyOn(gameStore, 'tryPurchaseGoBackLevels').mockImplementation(() => {
      throw new Error('purchase boom')
    })
    wrapper.find('.emit-goback').trigger('click')
    await nextTick()
    expect(saveSpy).not.toHaveBeenCalled()
    expect(logoutSpy).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('fault 后再次触发同一 action 零调用', async () => {
    const { wrapper, vm, gameStore } = await mountReady()
    const skillSpy = vi.spyOn(gameStore, 'tryUsePlayerSkill').mockImplementation(() => {
      throw new Error('skill boom')
    })
    wrapper.find('.emit-use-skill').trigger('click')
    await nextTick()
    expect(vm.runtimeStartupStatus).toBe('faulted')
    expect(skillSpy).toHaveBeenCalledTimes(1)

    wrapper.find('.emit-use-skill').trigger('click')
    await nextTick()
    expect(skillSpy).toHaveBeenCalledTimes(1)
    expect(vm.runtimeStartupError).toBe('skill interaction failed: skill boom')
    wrapper.unmount()
  })

  it('fault 后触发另外三种 action 全部 no-op', async () => {
    const { wrapper, vm, gameStore } = await mountReady()
    const resumeSpy = vi.spyOn(gameStore, 'resumeBattle')
    const goSpy = vi.spyOn(gameStore, 'tryPurchaseGoBackLevels')
    const claimSpy = vi.spyOn(usePlayerStore(), 'claimOfflineReward')
    vi.spyOn(gameStore, 'tryUsePlayerSkill').mockImplementation(() => {
      throw new Error('skill boom')
    })
    wrapper.find('.emit-use-skill').trigger('click')
    await nextTick()
    expect(vm.runtimeStartupStatus).toBe('faulted')

    vm.switchBattleMode!('main')
    vm.goBackLevels!()
    vm.onClaimOffline!()
    await nextTick()
    expect(resumeSpy).not.toHaveBeenCalled()
    expect(goSpy).not.toHaveBeenCalled()
    expect(claimSpy).not.toHaveBeenCalled()
    expect(vm.runtimeStartupError).toBe('skill interaction failed: skill boom')
    wrapper.unmount()
  })

  it('later Vue unmount 零 shutdown save', async () => {
    const { wrapper, vm, gameStore } = await mountReady()
    const playerStore = usePlayerStore()
    const saveSpy = vi.spyOn(playerStore, 'saveGame')
    vi.spyOn(gameStore, 'tryUsePlayerSkill').mockImplementation(() => {
      throw new Error('skill boom')
    })
    wrapper.find('.emit-use-skill').trigger('click')
    await nextTick()
    expect(vm.runtimeStartupStatus).toBe('faulted')
    wrapper.unmount()
    expect(saveSpy).not.toHaveBeenCalled()
  })

  it('reload 按钮仍只 reload', async () => {
    const { wrapper, gameStore } = await mountReady()
    const reloadSpy = vi.fn()
    const originalLocation = window.location
    const stubLocation = { ...originalLocation, reload: reloadSpy }
    Object.defineProperty(window, 'location', { configurable: true, value: stubLocation })
    vi.spyOn(gameStore, 'tryUsePlayerSkill').mockImplementation(() => {
      throw new Error('skill boom')
    })
    wrapper.find('.emit-use-skill').trigger('click')
    await nextTick()
    expect(wrapper.find('.runtime-gate-overlay').exists()).toBe(true)
    const reloadBtn = wrapper.findAll('.runtime-gate-overlay button').find(b => b.text().includes('重新加载游戏'))
    expect(reloadBtn).toBeTruthy()
    reloadBtn!.trigger('click')
    expect(reloadSpy).toHaveBeenCalledTimes(1)
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation })
    wrapper.unmount()
  })
})

describe('Phase 3.50 — Non-ready guards', () => {
  it('initializing 下四个 handler 全部 no-op、battleMode 不修改', async () => {
    const gameStore = useGameStore()
    const skillSpy = vi.spyOn(gameStore, 'tryUsePlayerSkill')
    const resumeSpy = vi.spyOn(gameStore, 'resumeBattle')
    const goSpy = vi.spyOn(gameStore, 'tryPurchaseGoBackLevels')
    const claimSpy = vi.spyOn(usePlayerStore(), 'claimOfflineReward')

    const { wrapper, vm } = await mountReady()
    vm.runtimeStartupStatus = 'initializing'
    vm.useSkill!(0)
    vm.switchBattleMode!('main')
    vm.goBackLevels!()
    vm.onClaimOffline!()
    await nextTick()

    expect(skillSpy).not.toHaveBeenCalled()
    expect(resumeSpy).not.toHaveBeenCalled()
    expect(goSpy).not.toHaveBeenCalled()
    expect(claimSpy).not.toHaveBeenCalled()
    expect(vm.battleMode).toBe('main')
    wrapper.unmount()
  })

  it('blocked 下四个 handler 全部 no-op', async () => {
    seedAlive()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: false, reason: 'invalid hp' })
    const skillSpy = vi.spyOn(gameStore, 'tryUsePlayerSkill')
    const resumeSpy = vi.spyOn(gameStore, 'resumeBattle')
    const goSpy = vi.spyOn(gameStore, 'tryPurchaseGoBackLevels')
    const claimSpy = vi.spyOn(usePlayerStore(), 'claimOfflineReward')

    const wrapper = mountAppWithEmitters()
    await nextTick()
    const vm = wrapper.vm as unknown as AppVm
    expect(vm.runtimeStartupStatus).toBe('blocked')

    vm.useSkill!(0)
    vm.switchBattleMode!('main')
    vm.goBackLevels!()
    vm.onClaimOffline!()
    await nextTick()

    expect(skillSpy).not.toHaveBeenCalled()
    expect(resumeSpy).not.toHaveBeenCalled()
    expect(goSpy).not.toHaveBeenCalled()
    expect(claimSpy).not.toHaveBeenCalled()
    expect(vm.battleMode).toBe('main')
    wrapper.unmount()
  })

  it('faulted 下四个 handler 全部 no-op', async () => {
    const gameStore = useGameStore()
    const skillSpy = vi.spyOn(gameStore, 'tryUsePlayerSkill')
    const resumeSpy = vi.spyOn(gameStore, 'resumeBattle')
    const goSpy = vi.spyOn(gameStore, 'tryPurchaseGoBackLevels')
    const claimSpy = vi.spyOn(usePlayerStore(), 'claimOfflineReward')

    const { wrapper, vm } = await mountReady()
    vm.runtimeStartupStatus = 'faulted'
    vm.useSkill!(0)
    vm.switchBattleMode!('main')
    vm.goBackLevels!()
    vm.onClaimOffline!()
    await nextTick()

    expect(skillSpy).not.toHaveBeenCalled()
    expect(resumeSpy).not.toHaveBeenCalled()
    expect(goSpy).not.toHaveBeenCalled()
    expect(claimSpy).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})

describe('Phase 3.50 — 架构护栏', () => {
  const ROOT = process.cwd()
  const HANDLERS = ['useSkill', 'switchBattleMode', 'goBackLevels', 'onClaimOffline']
  const CLASS_MAP: Record<string, string> = {
    useSkill: 'skill interaction failed',
    switchBattleMode: 'battle mode switch failed',
    goBackLevels: 'go back levels failed',
    onClaimOffline: 'offline reward claim failed'
  }

  function handlerBody(src: string, name: string) {
    const m = src.match(new RegExp(`function ${name}\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\}`))
    expect(m).toBeTruthy()
    return m![0]
  }

  it('护栏：四个 handler 均有 ready guard', () => {
    const src = readFileSync(resolve(ROOT, 'src/App.vue'), 'utf8')
    for (const name of HANDLERS) {
      expect(handlerBody(src, name)).toContain("runtimeStartupStatus.value !== 'ready'")
    }
  })

  it('护栏：四个权威 action 调用位于 try/catch 内', () => {
    const src = readFileSync(resolve(ROOT, 'src/App.vue'), 'utf8')
    for (const name of HANDLERS) {
      const body = handlerBody(src, name)
      expect(body).toContain('try {')
      expect(body).toContain('} catch (error) {')
    }
  })

  it('护栏：throw 分支使用各自精确分类、formatRuntimeFault、enterRuntimeFault；false/null 分支不调用', () => {
    const src = readFileSync(resolve(ROOT, 'src/App.vue'), 'utf8')
    for (const name of HANDLERS) {
      const body = handlerBody(src, name)
      expect(body).toContain(`formatRuntimeFault('${CLASS_MAP[name]}'`)
      expect(body).toContain('enterRuntimeFault(formatRuntimeFault(')
      // false/null 分支不调用 enterRuntimeFault：整个 handler 中 enterRuntimeFault 只出现在 catch
      expect((body.match(/enterRuntimeFault\(/g) || []).length).toBe(1)
    }
  })

  it('护栏：App 不直接调用低层 go-back/claim/revive/save API', () => {
    const src = readFileSync(resolve(ROOT, 'src/App.vue'), 'utf8')
    expect(src).not.toMatch(/playerStore\.claimOfflineReward\(/)
    expect(src).not.toMatch(/monsterStore\.goBackLevels\(/)
    expect(src).not.toMatch(/playerStore\.revive\(/)
    for (const name of HANDLERS) {
      const body = handlerBody(src, name)
      expect(body).not.toContain('saveGame')
      expect(body).not.toContain('claimOfflineReward')
      expect(body).not.toContain('resetGame')
    }
  })
})
