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
 * Phase 3.53 — 转生资格校验与确认交互异常熔断。
 *
 * - rebirthStore.performRebirth() 收紧为 { pointsEarned } | null：非有限或 <10 → 预期拒绝返回 null
 *   （零状态修改、零存储写入）；10+ 保持既有执行语义。
 * - App performRebirth()：ready guard + action 异常边界（rebirth interaction failed）；
 *   null 保持 UI；成功才关闭 modal/shop；alert 成功提示独立防御边界（不 fault）。
 * 本阶段不涉及跨 localStorage key 原子性。
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

/** 挂载 App：RebirthModal 用可点击 emit('perform-rebirth') 的自定义 stub。 */
function mountAppWithRebirthEmitter() {
  return mount(App, {
    global: {
      stubs: {
        BattleHUD: true,
        PlayerStatusBar: true,
        OverlayContainer: true,
        TabsContainer: true,
        PauseOverlay: true,
        RebirthModal: {
          template: '<div><button class="emit-perform-rebirth" @click="$emit(\'perform-rebirth\')">rebirth</button></div>'
        },
        OfflineRewardModal: { template: '<div class="offline-reward-stub"></div>' }
      }
    }
  })
}

async function mountReadyForRebirth() {
  seedAlive()
  const rebirthStore = useRebirthStore()
  const gameStore = useGameStore()
  vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
  const wrapper = mountAppWithRebirthEmitter()
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

describe('Phase 3.53 — Store 资格门', () => {
  it('difficulty 9 / 9.999 / 0 / 负数 返回 null', () => {
    const monsterStore = useMonsterStore()
    const rebirthStore = useRebirthStore()
    for (const d of [9, 9.999, 0, -5]) {
      monsterStore.difficultyValue = d
      expect(rebirthStore.performRebirth()).toBeNull()
    }
  })

  it('NaN / Infinity / -Infinity 返回 null', () => {
    const monsterStore = useMonsterStore()
    const rebirthStore = useRebirthStore()
    for (const d of [NaN, Infinity, -Infinity]) {
      monsterStore.difficultyValue = d
      expect(rebirthStore.performRebirth()).toBeNull()
    }
  })

  it('拒绝时：转生状态不变、player/monster reset 零调用、localStorage 零写入', () => {
    const monsterStore = useMonsterStore()
    const rebirthStore = useRebirthStore()
    const playerStore = usePlayerStore()
    monsterStore.difficultyValue = 9
    const pointsBefore = rebirthStore.rebirthPoints
    const countBefore = rebirthStore.totalRebirthCount
    const timeBefore = rebirthStore.lastRebirthTime
    const playerResetSpy = vi.spyOn(playerStore, 'resetForRebirth')
    const monsterResetSpy = vi.spyOn(monsterStore, 'resetForRebirth')
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')

    expect(rebirthStore.performRebirth()).toBeNull()

    expect(rebirthStore.rebirthPoints).toBe(pointsBefore)
    expect(rebirthStore.totalRebirthCount).toBe(countBefore)
    expect(rebirthStore.lastRebirthTime).toBe(timeBefore)
    expect(playerResetSpy).not.toHaveBeenCalled()
    expect(monsterResetSpy).not.toHaveBeenCalled()
    expect(setItemSpy).not.toHaveBeenCalled()
  })

  it('difficulty 10 允许成功，points 公式不变', () => {
    const monsterStore = useMonsterStore()
    const rebirthStore = useRebirthStore()
    const playerStore = usePlayerStore()
    monsterStore.difficultyValue = 10
    monsterStore.monsterLevel = 10
    playerStore.player.gold = 1000

    const result = rebirthStore.performRebirth()

    expect(result).not.toBeNull()
    // Math.floor(Math.sqrt(10 + 1) * 10) = 33
    expect(result!.pointsEarned).toBe(33)
    expect(rebirthStore.rebirthPoints).toBe(33)
    expect(rebirthStore.totalRebirthCount).toBe(1)
  })
})

describe('Phase 3.53 — App 正常路径', () => {
  it('真实 RebirthModal emit + 成功：action 一次、modal/shop 关闭、alert 一次且文案精确、保持 ready', async () => {
    const { wrapper, vm, rebirthStore } = await mountReadyForRebirth()
    const alertSpy = vi.fn()
    vi.stubGlobal('alert', alertSpy)
    vm.showRebirthModal = true
    await nextTick()
    vm.showRebirthShop = true
    const actionSpy = vi.spyOn(rebirthStore, 'performRebirth').mockReturnValue({ pointsEarned: 33 })

    wrapper.find('.emit-perform-rebirth').trigger('click')
    await nextTick()

    expect(actionSpy).toHaveBeenCalledTimes(1)
    expect(vm.showRebirthModal).toBe(false)
    expect(vm.showRebirthShop).toBe(false)
    expect(alertSpy).toHaveBeenCalledTimes(1)
    expect(alertSpy).toHaveBeenCalledWith('转生成功！获得 33 转生点数！')
    expect(vm.runtimeStartupStatus).toBe('ready')
    wrapper.unmount()
  })

  it('App 不额外保存', async () => {
    const { wrapper, vm, rebirthStore } = await mountReadyForRebirth()
    const alertSpy = vi.fn()
    vi.stubGlobal('alert', alertSpy)
    vm.showRebirthModal = true
    await nextTick()
    vi.spyOn(rebirthStore, 'performRebirth').mockReturnValue({ pointsEarned: 33 })
    const saveSpy = vi.spyOn(usePlayerStore(), 'saveGame')

    wrapper.find('.emit-perform-rebirth').trigger('click')
    await nextTick()

    expect(saveSpy).not.toHaveBeenCalled() // App 不直接保存
    wrapper.unmount()
  })
})

describe('Phase 3.53 — 资格拒绝', () => {
  it('Store null：modal/shop 保持、无 alert、保持 ready、不 fault', async () => {
    const { wrapper, vm, rebirthStore } = await mountReadyForRebirth()
    const alertSpy = vi.fn()
    vi.stubGlobal('alert', alertSpy)
    vm.showRebirthModal = true
    await nextTick()
    vm.showRebirthShop = true
    const actionSpy = vi.spyOn(rebirthStore, 'performRebirth').mockReturnValue(null)

    wrapper.find('.emit-perform-rebirth').trigger('click')
    await nextTick()

    expect(actionSpy).toHaveBeenCalledTimes(1)
    expect(vm.showRebirthModal).toBe(true)
    expect(vm.showRebirthShop).toBe(true)
    expect(alertSpy).not.toHaveBeenCalled()
    expect(vm.runtimeStartupStatus).toBe('ready')
    expect(vm.runtimeStartupError).toBe('')
    wrapper.unmount()
  })

  it('拒绝后再次点击是独立请求，单次 handler 不内部重试', async () => {
    const { wrapper, vm, rebirthStore } = await mountReadyForRebirth()
    const alertSpy = vi.fn()
    vi.stubGlobal('alert', alertSpy)
    vm.showRebirthModal = true
    await nextTick()
    const actionSpy = vi.spyOn(rebirthStore, 'performRebirth').mockReturnValue(null)

    wrapper.find('.emit-perform-rebirth').trigger('click')
    wrapper.find('.emit-perform-rebirth').trigger('click')
    await nextTick()

    expect(actionSpy).toHaveBeenCalledTimes(2) // 两次独立用户请求
    expect(vm.showRebirthModal).toBe(true)
    expect(alertSpy).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})

describe('Phase 3.53 — Unexpected action throw', () => {
  it('Error 精确分类：真实 emit 不外抛、modal/shop 不当作成功关闭、alert 零调用', async () => {
    const { wrapper, vm, rebirthStore } = await mountReadyForRebirth()
    const alertSpy = vi.fn()
    vi.stubGlobal('alert', alertSpy)
    vm.showRebirthModal = true
    await nextTick()
    vm.showRebirthShop = true
    const actionSpy = vi.spyOn(rebirthStore, 'performRebirth').mockImplementation(() => {
      throw new Error('rebirth boom')
    })

    let threw = false
    try {
      wrapper.find('.emit-perform-rebirth').trigger('click')
    } catch {
      threw = true
    }
    await nextTick()

    expect(threw).toBe(false)
    expect(actionSpy).toHaveBeenCalledTimes(1)
    expect(vm.runtimeStartupStatus).toBe('faulted')
    expect(vm.runtimeStartupError).toBe('rebirth interaction failed: rebirth boom')
    expect(vm.showRebirthModal).toBe(true) // 不当作成功关闭
    expect(vm.showRebirthShop).toBe(true)
    expect(alertSpy).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('非 Error：String 规范化', async () => {
    const { wrapper, vm, rebirthStore } = await mountReadyForRebirth()
    const alertSpy = vi.fn()
    vi.stubGlobal('alert', alertSpy)
    vm.showRebirthModal = true
    await nextTick()
    vi.spyOn(rebirthStore, 'performRebirth').mockImplementation(() => {
      throw 'rebirth-string-boom'
    })
    wrapper.find('.emit-perform-rebirth').trigger('click')
    await nextTick()
    expect(vm.runtimeStartupError).toBe('rebirth interaction failed: rebirth-string-boom')
    expect(alertSpy).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('空 Error：无尾随冒号', async () => {
    const { wrapper, vm, rebirthStore } = await mountReadyForRebirth()
    vm.showRebirthModal = true
    await nextTick()
    vi.spyOn(rebirthStore, 'performRebirth').mockImplementation(() => {
      throw new Error('')
    })
    wrapper.find('.emit-perform-rebirth').trigger('click')
    await nextTick()
    expect(vm.runtimeStartupError).toBe('rebirth interaction failed')
    expect(vm.runtimeStartupError).not.toContain('rebirth interaction failed:')
    wrapper.unmount()
  })

  it('battleError 原引用保持', async () => {
    const { wrapper, vm, rebirthStore, gameStore } = await mountReadyForRebirth()
    const existing = new Error('existing store fault')
    gameStore.battleError = existing
    vm.showRebirthModal = true
    await nextTick()
    vi.spyOn(rebirthStore, 'performRebirth').mockImplementation(() => {
      throw new Error('rebirth boom')
    })
    wrapper.find('.emit-perform-rebirth').trigger('click')
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
    vi.spyOn(rebirthStore, 'performRebirth').mockImplementation(() => {
      throw new Error('rebirth boom')
    })
    const { cancelSpy, intervalSpy, clearSpy, removeSpy } = spyCleanup()

    const wrapper = mountAppWithRebirthEmitter()
    await nextTick()
    const vm = wrapper.vm as unknown as AppVm
    vm.showRebirthModal = true
    await nextTick()
    const runtimeSetIdx = intervalSpy.mock.calls.findIndex(c => c[1] === 1000)
    const runtimeIntervalId = intervalSpy.mock.results[runtimeSetIdx].value

    wrapper.find('.emit-perform-rebirth').trigger('click')
    await nextTick()

    expect(cancelSpy.mock.calls.filter(c => c[0] === 1).length).toBe(1)
    expect(clearSpy.mock.calls.filter(c => c[0] === runtimeIntervalId).length).toBe(1)
    expect(removeSpy.mock.calls.filter(c => c[0] === 'beforeunload').length).toBe(1)
    wrapper.unmount()
  })

  it('cleanup 同时 throw 保留 rebirth reason', async () => {
    seedAlive()
    const rebirthStore = useRebirthStore()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    vi.spyOn(rebirthStore, 'performRebirth').mockImplementation(() => {
      throw new Error('rebirth boom')
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {
      throw new Error('cancel boom')
    })

    const wrapper = mountAppWithRebirthEmitter()
    await nextTick()
    const vm = wrapper.vm as unknown as AppVm
    vm.showRebirthModal = true
    await nextTick()

    wrapper.find('.emit-perform-rebirth').trigger('click')
    await nextTick()

    expect(vm.runtimeStartupError).toBe('rebirth interaction failed: rebirth boom')
    expect(vm.runtimeStartupError).not.toContain('runtime cleanup failed')
    wrapper.unmount()
  })

  it('fault 后重复 rebirth 零 action、Phase 3.50–3.52 interaction 全部 no-op', async () => {
    const { wrapper, vm, rebirthStore, gameStore } = await mountReadyForRebirth()
    vm.showRebirthModal = true
    await nextTick()
    const actionSpy = vi.spyOn(rebirthStore, 'performRebirth').mockImplementation(() => {
      throw new Error('rebirth boom')
    })
    const skillSpy = vi.spyOn(gameStore, 'tryUsePlayerSkill')
    const resumeSpy = vi.spyOn(gameStore, 'resumeBattle')
    const goSpy = vi.spyOn(gameStore, 'tryPurchaseGoBackLevels')
    const claimSpy = vi.spyOn(usePlayerStore(), 'claimOfflineReward')
    const resetSpy = vi.spyOn(usePlayerStore(), 'resetGame')

    wrapper.find('.emit-perform-rebirth').trigger('click')
    await nextTick()
    expect(actionSpy).toHaveBeenCalledTimes(1)

    wrapper.find('.emit-perform-rebirth').trigger('click')
    await nextTick()
    expect(actionSpy).toHaveBeenCalledTimes(1)

    vm.useSkill!(0)
    vm.switchBattleMode!('main')
    vm.goBackLevels!()
    vm.onClaimOffline!()
    vm.confirmReset!()
    await nextTick()

    expect(skillSpy).not.toHaveBeenCalled()
    expect(resumeSpy).not.toHaveBeenCalled()
    expect(goSpy).not.toHaveBeenCalled()
    expect(claimSpy).not.toHaveBeenCalled()
    expect(resetSpy).not.toHaveBeenCalled()
    expect(vm.runtimeStartupError).toBe('rebirth interaction failed: rebirth boom')
    wrapper.unmount()
  })

  it('later Vue unmount 零 shutdown save', async () => {
    const { wrapper, vm, rebirthStore } = await mountReadyForRebirth()
    vm.showRebirthModal = true
    await nextTick()
    vi.spyOn(rebirthStore, 'performRebirth').mockImplementation(() => {
      throw new Error('rebirth boom')
    })
    const saveSpy = vi.spyOn(usePlayerStore(), 'saveGame')

    wrapper.find('.emit-perform-rebirth').trigger('click')
    await nextTick()
    expect(vm.runtimeStartupStatus).toBe('faulted')
    wrapper.unmount()
    expect(saveSpy).not.toHaveBeenCalled()
  })
})

describe('Phase 3.53 — Alert fault', () => {
  it('action 成功但 alert throw：不外抛、保持 ready、modal/shop 已关闭、action/alert 各一次、不 fault', async () => {
    const { wrapper, vm, rebirthStore } = await mountReadyForRebirth()
    vi.stubGlobal('alert', () => {
      throw new Error('alert boom')
    })
    vm.showRebirthModal = true
    await nextTick()
    vm.showRebirthShop = true
    const actionSpy = vi.spyOn(rebirthStore, 'performRebirth').mockReturnValue({ pointsEarned: 33 })

    let threw = false
    try {
      wrapper.find('.emit-perform-rebirth').trigger('click')
    } catch {
      threw = true
    }
    await nextTick()

    expect(threw).toBe(false)
    expect(actionSpy).toHaveBeenCalledTimes(1)
    expect(vm.showRebirthModal).toBe(false)
    expect(vm.showRebirthShop).toBe(false)
    expect(vm.runtimeStartupStatus).toBe('ready') // 已成功提交不因 alert 失败 fault
    expect(vm.runtimeStartupError).toBe('')
    wrapper.unmount()
  })
})

describe('Phase 3.53 — Non-ready guards', () => {
  it('initializing/blocked/faulted：action/alert 零调用、UI 不变', async () => {
    const rebirthStore = useRebirthStore()
    const gameStore = useGameStore()
    const actionSpy = vi.spyOn(rebirthStore, 'performRebirth')
    const alertSpy = vi.fn()
    vi.stubGlobal('alert', alertSpy)
    // initializing
    {
      seedAlive()
      vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
      const wrapper = mountAppWithRebirthEmitter()
      await nextTick()
      const vm = wrapper.vm as unknown as AppVm
      vm.showRebirthModal = true
      await nextTick()
      vm.runtimeStartupStatus = 'initializing'
      vm.performRebirth!()
      expect(actionSpy).not.toHaveBeenCalled()
      expect(alertSpy).not.toHaveBeenCalled()
      expect(vm.showRebirthModal).toBe(true)
      wrapper.unmount()
    }
    // blocked
    {
      seedAlive()
      vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: false, reason: 'invalid hp' })
      const wrapper = mountAppWithRebirthEmitter()
      await nextTick()
      const vm = wrapper.vm as unknown as AppVm
      expect(vm.runtimeStartupStatus).toBe('blocked')
      vm.showRebirthModal = true
      await nextTick()
      vm.performRebirth!()
      expect(actionSpy).not.toHaveBeenCalled()
      expect(alertSpy).not.toHaveBeenCalled()
      expect(vm.showRebirthModal).toBe(true)
      wrapper.unmount()
    }
    // faulted
    {
      seedAlive()
      vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
      const wrapper = mountAppWithRebirthEmitter()
      await nextTick()
      const vm = wrapper.vm as unknown as AppVm
      vm.showRebirthModal = true
      await nextTick()
      vm.runtimeStartupStatus = 'faulted'
      ;(vm as unknown as { runtimeStartupError: string }).runtimeStartupError = 'existing fault reason'
      vm.performRebirth!()
      expect(actionSpy).not.toHaveBeenCalled()
      expect(alertSpy).not.toHaveBeenCalled()
      expect((vm as unknown as { runtimeStartupError: string }).runtimeStartupError).toBe('existing fault reason')
      wrapper.unmount()
    }
  })
})

describe('Phase 3.53 — 架构护栏', () => {
  const ROOT = process.cwd()

  it('护栏：Store 有有限值及 <10 资格门，位于全部 mutation/存储调用之前', () => {
    const src = readFileSync(resolve(ROOT, 'src/stores/rebirthStore.ts'), 'utf8')
    const m = src.match(/function performRebirth\(\):\s*\{ pointsEarned: number \} \| null\s*\{[\s\S]*?\n  \}/)
    expect(m).toBeTruthy()
    const body = m![0]
    expect(body).toContain('Number.isFinite(difficulty)')
    expect(body).toContain('difficulty < 10')
    expect(body).toContain('return null')
    const gateIdx = body.indexOf('Number.isFinite(difficulty)')
    expect(body.indexOf('calculateRebirthPoints(')).toBeGreaterThan(gateIdx)
    expect(body.indexOf('rebirthPoints.value +=')).toBeGreaterThan(gateIdx)
    expect(body.indexOf('totalRebirthCount.value++')).toBeGreaterThan(gateIdx)
    expect(body.indexOf('lastRebirthTime.value =')).toBeGreaterThan(gateIdx)
    expect(body.indexOf('playerStore.resetForRebirth()')).toBeGreaterThan(gateIdx)
    expect(body.indexOf('monsterStore.resetForRebirth()')).toBeGreaterThan(gateIdx)
    expect(body.indexOf('saveRebirthData()')).toBeGreaterThan(gateIdx)
  })

  it('护栏：Store 返回类型允许 null', () => {
    const src = readFileSync(resolve(ROOT, 'src/stores/rebirthStore.ts'), 'utf8')
    expect(src).toContain('function performRebirth(): { pointsEarned: number } | null {')
  })

  it('护栏：App 有 ready guard；action 位于独立 try/catch；catch 使用精确分类', () => {
    const src = readFileSync(resolve(ROOT, 'src/App.vue'), 'utf8')
    const m = src.match(/function performRebirth\(\)\s*\{[\s\S]*?\n\}/)
    expect(m).toBeTruthy()
    const body = m![0]
    expect(body).toContain("runtimeStartupStatus.value !== 'ready'")
    expect(body).toContain('try {')
    expect(body).toContain('rebirthStore.performRebirth()')
    expect(body).toContain("formatRuntimeFault('rebirth interaction failed'")
    expect(body).toContain('enterRuntimeFault(formatRuntimeFault(')
  })

  it('护栏：null 分支在关闭 modal 前返回；alert 位于独立防御边界', () => {
    const src = readFileSync(resolve(ROOT, 'src/App.vue'), 'utf8')
    const m = src.match(/function performRebirth\(\)\s*\{[\s\S]*?\n\}/)
    expect(m).toBeTruthy()
    const body = m![0]
    const nullIdx = body.indexOf('if (!result) return')
    const closeIdx = body.indexOf('closeRebirthModal()')
    expect(nullIdx).toBeGreaterThan(-1)
    expect(nullIdx).toBeLessThan(closeIdx)
    // alert 独立 try/catch，且不在 action catch 内
    expect(body).toContain('try {')
    expect((body.match(/} catch \{/g) || []).length).toBe(1) // alert 的裸 catch
    const alertIdx = body.indexOf('alert(`')
    expect(alertIdx).toBeGreaterThan(closeIdx)
  })

  it('护栏：App 不直接修改 Store 状态或调用保存 API', () => {
    const src = readFileSync(resolve(ROOT, 'src/App.vue'), 'utf8')
    const m = src.match(/function performRebirth\(\)\s*\{[\s\S]*?\n\}/)
    expect(m).toBeTruthy()
    const body = m![0]
    for (const forbidden of [
      'rebirthPoints',
      'totalRebirthCount',
      'lastRebirthTime',
      'player.value =',
      'resetForRebirth',
      'saveRebirthData',
      'saveGame',
      'recordLogout'
    ]) {
      expect(body).not.toContain(forbidden)
    }
  })
})
