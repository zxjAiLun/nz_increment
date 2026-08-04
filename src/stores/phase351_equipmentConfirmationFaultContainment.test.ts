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
import type { Equipment } from '../types'
// @ts-ignore —— 测试运行于 Node，无需在应用 tsconfig 中引入 @types/node 全局类型
import { readFileSync } from 'node:fs'
// @ts-ignore
import { resolve } from 'node:path'
// @ts-ignore
declare const process: { cwd(): string }

/**
 * Phase 3.51 — 装备确认交互异常熔断。
 *
 * confirmEquip 遵循：ready guard → 快照 pending/slot → 权威装备事务恰好一次 →
 * true 才关闭确认弹窗、false 保持确认 UI（业务拒绝/持久化失败，不 fault）→
 * throw 进入 App fail-stop（equipment confirmation failed），复用 formatRuntimeFault/enterRuntimeFault。
 *
 * 核心路径通过真实 OverlayContainer emit（自定义 stub 按钮点击 → $emit('confirm-equip')）触发。
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
  confirmEquip?: () => void
  useSkill?: (i: number) => void
  switchBattleMode?: (m: 'main' | 'training') => void
  goBackLevels?: () => void
  onClaimOffline?: () => void
  runtimeStartupStatus?: 'initializing' | 'ready' | 'blocked' | 'faulted'
  runtimeStartupError?: string
  equipConfirmSlot?: string | null
  showEquipConfirm?: boolean
}

/** 挂载 App：OverlayContainer 用可点击 emit('confirm-equip') 的自定义 stub。 */
function mountAppWithEquipEmitter() {
  return mount(App, {
    global: {
      stubs: {
        BattleHUD: true,
        PlayerStatusBar: true,
        OverlayContainer: {
          template: '<div><button class="emit-confirm-equip" @click="$emit(\'confirm-equip\')">confirm</button></div>'
        },
        TabsContainer: true,
        PauseOverlay: true,
        RebirthModal: true,
        OfflineRewardModal: { template: '<div class="offline-reward-stub"></div>' }
      }
    }
  })
}

function makeEquipment(id: string): Equipment {
  return {
    id,
    slot: 'weapon',
    name: `eq-${id}`,
    rarity: 'rare',
    level: 1,
    stats: [],
    isLocked: false,
    affixes: [],
    refiningSlots: [],
    refiningLevel: 0,
    runeSlots: []
  } as unknown as Equipment
}

async function mountReadyForEquip() {
  seedAlive()
  const playerStore = usePlayerStore()
  const gameStore = useGameStore()
  vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
  const wrapper = mountAppWithEquipEmitter()
  await nextTick()
  const vm = wrapper.vm as unknown as AppVm
  return { wrapper, vm, playerStore, gameStore }
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

describe('Phase 3.51 — 正常成功', () => {
  it('ready + 有效 slot/pending：真实 emit 触发、action 恰好一次、参数为原 pending 引用', async () => {
    const { wrapper, vm, playerStore, gameStore } = await mountReadyForEquip()
    const pending = makeEquipment('eq-1')
    playerStore.pendingEquipment = pending
    vm.equipConfirmSlot = 'weapon'
    vm.showEquipConfirm = true
    const equipSpy = vi.spyOn(playerStore, 'equipNewEquipment').mockReturnValue(true)

    wrapper.find('.emit-confirm-equip').trigger('click')
    await nextTick()

    expect(equipSpy).toHaveBeenCalledTimes(1)
    expect(equipSpy).toHaveBeenCalledWith(pending)
    expect(vm.showEquipConfirm).toBe(false)
    expect(vm.equipConfirmSlot).toBeNull()
    expect(vm.runtimeStartupStatus).toBe('ready')
    expect(gameStore.battleError).toBeNull()
    wrapper.unmount()
  })

  it('action true：modal 关闭、slot 清空、保持 ready、App 不清除 pending', async () => {
    const { wrapper, vm, playerStore } = await mountReadyForEquip()
    const pending = makeEquipment('eq-2')
    playerStore.pendingEquipment = pending
    vm.equipConfirmSlot = 'weapon'
    vm.showEquipConfirm = true
    vi.spyOn(playerStore, 'equipNewEquipment').mockReturnValue(true)

    wrapper.find('.emit-confirm-equip').trigger('click')
    await nextTick()

    expect(vm.showEquipConfirm).toBe(false)
    expect(vm.equipConfirmSlot).toBeNull()
    expect(vm.runtimeStartupStatus).toBe('ready')
    // pending 成功清理由 Store 权威事务负责；App 不直接清除
    expect(playerStore.pendingEquipment).toEqual(pending)
    wrapper.unmount()
  })

  it('不产生额外 saveGame 调用', async () => {
    const { wrapper, vm, playerStore } = await mountReadyForEquip()
    const pending = makeEquipment('eq-3')
    playerStore.pendingEquipment = pending
    vm.equipConfirmSlot = 'weapon'
    vm.showEquipConfirm = true
    vi.spyOn(playerStore, 'equipNewEquipment').mockReturnValue(true)
    const saveSpy = vi.spyOn(playerStore, 'saveGame')

    wrapper.find('.emit-confirm-equip').trigger('click')
    await nextTick()

    expect(saveSpy).not.toHaveBeenCalled() // App 不直接保存（Store 事务内部保存为闭包调用）
    wrapper.unmount()
  })
})

describe('Phase 3.51 — 正常拒绝', () => {
  it('action false：modal 保持、slot/pending 保持、runtime ready、不 fault', async () => {
    const { wrapper, vm, playerStore } = await mountReadyForEquip()
    const pending = makeEquipment('eq-4')
    playerStore.pendingEquipment = pending
    vm.equipConfirmSlot = 'weapon'
    vm.showEquipConfirm = true
    const equipSpy = vi.spyOn(playerStore, 'equipNewEquipment').mockReturnValue(false)

    wrapper.find('.emit-confirm-equip').trigger('click')
    await nextTick()

    expect(equipSpy).toHaveBeenCalledTimes(1)
    expect(vm.showEquipConfirm).toBe(true)
    expect(vm.equipConfirmSlot).toBe('weapon')
    expect(playerStore.pendingEquipment).toEqual(pending)
    expect(vm.runtimeStartupStatus).toBe('ready')
    expect(vm.runtimeStartupError).toBe('')
    wrapper.unmount()
  })

  it('连续两次点击产生两次独立请求，单次 handler 不内部重试', async () => {
    const { wrapper, vm, playerStore } = await mountReadyForEquip()
    const pending = makeEquipment('eq-5')
    playerStore.pendingEquipment = pending
    vm.equipConfirmSlot = 'weapon'
    vm.showEquipConfirm = true
    const equipSpy = vi.spyOn(playerStore, 'equipNewEquipment').mockReturnValue(false)

    wrapper.find('.emit-confirm-equip').trigger('click')
    wrapper.find('.emit-confirm-equip').trigger('click')
    await nextTick()

    expect(equipSpy).toHaveBeenCalledTimes(2) // 两次独立用户请求，各自调用一次
    expect(vm.runtimeStartupStatus).toBe('ready')
    expect(vm.showEquipConfirm).toBe(true)
    wrapper.unmount()
  })

  it('false 不调用 enterRuntimeFault', async () => {
    const { wrapper, vm, playerStore } = await mountReadyForEquip()
    const pending = makeEquipment('eq-6')
    playerStore.pendingEquipment = pending
    vm.equipConfirmSlot = 'weapon'
    vm.showEquipConfirm = true
    vi.spyOn(playerStore, 'equipNewEquipment').mockReturnValue(false)

    wrapper.find('.emit-confirm-equip').trigger('click')
    await nextTick()

    expect(vm.runtimeStartupStatus).toBe('ready')
    expect(vm.runtimeStartupError).toBe('')
    wrapper.unmount()
  })
})

describe('Phase 3.51 — 缺失上下文', () => {
  it('ready + slot 缺失：action 零调用、modal 关闭、slot 为 null、pending 不由 App 清除', async () => {
    const { wrapper, vm, playerStore } = await mountReadyForEquip()
    const pending = makeEquipment('eq-7')
    playerStore.pendingEquipment = pending
    vm.equipConfirmSlot = null
    vm.showEquipConfirm = true
    const equipSpy = vi.spyOn(playerStore, 'equipNewEquipment')

    wrapper.find('.emit-confirm-equip').trigger('click')
    await nextTick()

    expect(equipSpy).not.toHaveBeenCalled()
    expect(vm.showEquipConfirm).toBe(false)
    expect(vm.equipConfirmSlot).toBeNull()
    expect(playerStore.pendingEquipment).toEqual(pending) // 不由 App 清除
    expect(vm.runtimeStartupStatus).toBe('ready')
    wrapper.unmount()
  })

  it('ready + pending 缺失：action 零调用、modal 关闭、slot 清空', async () => {
    const { wrapper, vm, playerStore } = await mountReadyForEquip()
    playerStore.pendingEquipment = null
    vm.equipConfirmSlot = 'weapon'
    vm.showEquipConfirm = true
    const equipSpy = vi.spyOn(playerStore, 'equipNewEquipment')

    wrapper.find('.emit-confirm-equip').trigger('click')
    await nextTick()

    expect(equipSpy).not.toHaveBeenCalled()
    expect(vm.showEquipConfirm).toBe(false)
    expect(vm.equipConfirmSlot).toBeNull()
    expect(vm.runtimeStartupStatus).toBe('ready')
    wrapper.unmount()
  })

  it('slot/pending 都缺失：不 fault、不保存', async () => {
    const { wrapper, vm, playerStore } = await mountReadyForEquip()
    playerStore.pendingEquipment = null
    vm.equipConfirmSlot = null
    vm.showEquipConfirm = true
    const saveSpy = vi.spyOn(playerStore, 'saveGame')

    wrapper.find('.emit-confirm-equip').trigger('click')
    await nextTick()

    expect(vm.runtimeStartupStatus).toBe('ready')
    expect(vm.runtimeStartupError).toBe('')
    expect(saveSpy).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})

describe('Phase 3.51 — 异常分类', () => {
  it('Error：真实 emit 不外抛、精确 reason、action 恰好一次', async () => {
    const { wrapper, vm, playerStore } = await mountReadyForEquip()
    const pending = makeEquipment('eq-8')
    playerStore.pendingEquipment = pending
    vm.equipConfirmSlot = 'weapon'
    vm.showEquipConfirm = true
    const equipSpy = vi.spyOn(playerStore, 'equipNewEquipment').mockImplementation(() => {
      throw new Error('equip boom')
    })

    let threw = false
    try {
      wrapper.find('.emit-confirm-equip').trigger('click')
    } catch {
      threw = true
    }
    await nextTick()

    expect(threw).toBe(false)
    expect(equipSpy).toHaveBeenCalledTimes(1)
    expect(vm.runtimeStartupStatus).toBe('faulted')
    expect(vm.runtimeStartupError).toBe('equipment confirmation failed: equip boom')
    wrapper.unmount()
  })

  it('非 Error：String 规范化', async () => {
    const { wrapper, vm, playerStore } = await mountReadyForEquip()
    const pending = makeEquipment('eq-9')
    playerStore.pendingEquipment = pending
    vm.equipConfirmSlot = 'weapon'
    vm.showEquipConfirm = true
    vi.spyOn(playerStore, 'equipNewEquipment').mockImplementation(() => {
      throw 'equip-string-boom'
    })

    wrapper.find('.emit-confirm-equip').trigger('click')
    await nextTick()

    expect(vm.runtimeStartupError).toBe('equipment confirmation failed: equip-string-boom')
    wrapper.unmount()
  })

  it('空 Error：无尾随冒号', async () => {
    const { wrapper, vm, playerStore } = await mountReadyForEquip()
    const pending = makeEquipment('eq-10')
    playerStore.pendingEquipment = pending
    vm.equipConfirmSlot = 'weapon'
    vm.showEquipConfirm = true
    vi.spyOn(playerStore, 'equipNewEquipment').mockImplementation(() => {
      throw new Error('')
    })

    wrapper.find('.emit-confirm-equip').trigger('click')
    await nextTick()

    expect(vm.runtimeStartupError).toBe('equipment confirmation failed')
    expect(vm.runtimeStartupError).not.toContain('equipment confirmation failed:')
    wrapper.unmount()
  })

  it('action 恰好一次、零重试；modal/slot 不被 catch 当作成功清理', async () => {
    const { wrapper, vm, playerStore } = await mountReadyForEquip()
    const pending = makeEquipment('eq-11')
    playerStore.pendingEquipment = pending
    vm.equipConfirmSlot = 'weapon'
    vm.showEquipConfirm = true
    const equipSpy = vi.spyOn(playerStore, 'equipNewEquipment').mockImplementation(() => {
      throw new Error('equip boom')
    })

    wrapper.find('.emit-confirm-equip').trigger('click')
    await nextTick()

    expect(equipSpy).toHaveBeenCalledTimes(1) // 零重试
    expect(vm.equipConfirmSlot).toBe('weapon') // catch 不当作成功清理 slot
    expect(playerStore.pendingEquipment).toEqual(pending) // catch 不清除 pending
    wrapper.unmount()
  })

  it('battleError 原引用保持', async () => {
    const { wrapper, vm, playerStore, gameStore } = await mountReadyForEquip()
    const existing = new Error('existing store fault')
    gameStore.battleError = existing
    const pending = makeEquipment('eq-12')
    playerStore.pendingEquipment = pending
    vm.equipConfirmSlot = 'weapon'
    vm.showEquipConfirm = true
    vi.spyOn(playerStore, 'equipNewEquipment').mockImplementation(() => {
      throw new Error('equip boom')
    })

    wrapper.find('.emit-confirm-equip').trigger('click')
    await nextTick()

    expect(gameStore.battleError).toBe(existing)
    expect(gameStore.battleError!.message).toBe('existing store fault')
    wrapper.unmount()
  })
})

describe('Phase 3.51 — 全局 fault', () => {
  it('throw 后 RAF、interval、beforeunload 各清理一次', async () => {
    seedAlive()
    const playerStore = usePlayerStore()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    const pending = makeEquipment('eq-13')
    playerStore.pendingEquipment = pending
    const { cancelSpy, intervalSpy, clearSpy, removeSpy } = spyCleanup()

    const wrapper = mountAppWithEquipEmitter()
    await nextTick()
    const vm = wrapper.vm as unknown as AppVm
    vm.equipConfirmSlot = 'weapon'
    vm.showEquipConfirm = true
    vi.spyOn(playerStore, 'equipNewEquipment').mockImplementation(() => {
      throw new Error('equip boom')
    })

    const runtimeSetIdx = intervalSpy.mock.calls.findIndex(c => c[1] === 1000)
    const runtimeIntervalId = intervalSpy.mock.results[runtimeSetIdx].value

    wrapper.find('.emit-confirm-equip').trigger('click')
    await nextTick()

    expect(cancelSpy.mock.calls.filter(c => c[0] === 1).length).toBe(1)
    expect(clearSpy.mock.calls.filter(c => c[0] === runtimeIntervalId).length).toBe(1)
    expect(removeSpy.mock.calls.filter(c => c[0] === 'beforeunload').length).toBe(1)
    wrapper.unmount()
  })

  it('throw 后 saveGame/recordLogout 零调用', async () => {
    const { wrapper, vm, playerStore } = await mountReadyForEquip()
    const pending = makeEquipment('eq-14')
    playerStore.pendingEquipment = pending
    vm.equipConfirmSlot = 'weapon'
    vm.showEquipConfirm = true
    vi.spyOn(playerStore, 'equipNewEquipment').mockImplementation(() => {
      throw new Error('equip boom')
    })
    const saveSpy = vi.spyOn(playerStore, 'saveGame')
    const logoutSpy = vi.spyOn(playerStore, 'recordLogout')

    wrapper.find('.emit-confirm-equip').trigger('click')
    await nextTick()

    expect(saveSpy).not.toHaveBeenCalled()
    expect(logoutSpy).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('fault 后再次 confirm 零 action 调用', async () => {
    const { wrapper, vm, playerStore } = await mountReadyForEquip()
    const pending = makeEquipment('eq-15')
    playerStore.pendingEquipment = pending
    vm.equipConfirmSlot = 'weapon'
    vm.showEquipConfirm = true
    const equipSpy = vi.spyOn(playerStore, 'equipNewEquipment').mockImplementation(() => {
      throw new Error('equip boom')
    })

    wrapper.find('.emit-confirm-equip').trigger('click')
    await nextTick()
    expect(equipSpy).toHaveBeenCalledTimes(1)

    wrapper.find('.emit-confirm-equip').trigger('click')
    await nextTick()
    expect(equipSpy).toHaveBeenCalledTimes(1)
    expect(vm.runtimeStartupError).toBe('equipment confirmation failed: equip boom')
    wrapper.unmount()
  })

  it('fault 后 Phase 3.50 四条 interaction 全部 no-op', async () => {
    const { wrapper, vm, playerStore, gameStore } = await mountReadyForEquip()
    const pending = makeEquipment('eq-16')
    playerStore.pendingEquipment = pending
    vm.equipConfirmSlot = 'weapon'
    vm.showEquipConfirm = true
    vi.spyOn(playerStore, 'equipNewEquipment').mockImplementation(() => {
      throw new Error('equip boom')
    })
    const skillSpy = vi.spyOn(gameStore, 'tryUsePlayerSkill')
    const resumeSpy = vi.spyOn(gameStore, 'resumeBattle')
    const goSpy = vi.spyOn(gameStore, 'tryPurchaseGoBackLevels')
    const claimSpy = vi.spyOn(playerStore, 'claimOfflineReward')

    wrapper.find('.emit-confirm-equip').trigger('click')
    await nextTick()
    expect(vm.runtimeStartupStatus).toBe('faulted')

    vm.useSkill!(0)
    vm.switchBattleMode!('main')
    vm.goBackLevels!()
    vm.onClaimOffline!()
    await nextTick()

    expect(skillSpy).not.toHaveBeenCalled()
    expect(resumeSpy).not.toHaveBeenCalled()
    expect(goSpy).not.toHaveBeenCalled()
    expect(claimSpy).not.toHaveBeenCalled()
    expect(vm.runtimeStartupError).toBe('equipment confirmation failed: equip boom')
    wrapper.unmount()
  })

  it('later Vue unmount 零 shutdown save', async () => {
    const { wrapper, vm, playerStore } = await mountReadyForEquip()
    const pending = makeEquipment('eq-17')
    playerStore.pendingEquipment = pending
    vm.equipConfirmSlot = 'weapon'
    vm.showEquipConfirm = true
    vi.spyOn(playerStore, 'equipNewEquipment').mockImplementation(() => {
      throw new Error('equip boom')
    })
    const saveSpy = vi.spyOn(playerStore, 'saveGame')

    wrapper.find('.emit-confirm-equip').trigger('click')
    await nextTick()
    expect(vm.runtimeStartupStatus).toBe('faulted')
    wrapper.unmount()
    expect(saveSpy).not.toHaveBeenCalled()
  })

  it('cleanup API 同时 throw 时保留 equipment reason', async () => {
    seedAlive()
    const playerStore = usePlayerStore()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    const pending = makeEquipment('eq-18')
    playerStore.pendingEquipment = pending
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {
      throw new Error('cancel boom')
    })

    const wrapper = mountAppWithEquipEmitter()
    await nextTick()
    const vm = wrapper.vm as unknown as AppVm
    vm.equipConfirmSlot = 'weapon'
    vm.showEquipConfirm = true
    vi.spyOn(playerStore, 'equipNewEquipment').mockImplementation(() => {
      throw new Error('equip boom')
    })

    wrapper.find('.emit-confirm-equip').trigger('click')
    await nextTick()

    expect(vm.runtimeStartupError).toBe('equipment confirmation failed: equip boom')
    expect(vm.runtimeStartupError).not.toContain('runtime cleanup failed')
    wrapper.unmount()
  })
})

describe('Phase 3.51 — Non-ready guards', () => {
  it('initializing：action 零调用、modal/slot/pending 不变', async () => {
    const { wrapper, vm, playerStore } = await mountReadyForEquip()
    const pending = makeEquipment('eq-19')
    playerStore.pendingEquipment = pending
    vm.equipConfirmSlot = 'weapon'
    vm.showEquipConfirm = true
    const equipSpy = vi.spyOn(playerStore, 'equipNewEquipment')
    vm.runtimeStartupStatus = 'initializing'

    vm.confirmEquip!()
    await nextTick()

    expect(equipSpy).not.toHaveBeenCalled()
    expect(vm.showEquipConfirm).toBe(true)
    expect(vm.equipConfirmSlot).toBe('weapon')
    expect(playerStore.pendingEquipment).toEqual(pending)
    wrapper.unmount()
  })

  it('blocked：action 零调用、modal/slot/pending 不变', async () => {
    seedAlive()
    const playerStore = usePlayerStore()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: false, reason: 'invalid hp' })
    const pending = makeEquipment('eq-20')
    playerStore.pendingEquipment = pending
    const equipSpy = vi.spyOn(playerStore, 'equipNewEquipment')

    const wrapper = mountAppWithEquipEmitter()
    await nextTick()
    const vm = wrapper.vm as unknown as AppVm
    expect(vm.runtimeStartupStatus).toBe('blocked')
    vm.equipConfirmSlot = 'weapon'
    vm.showEquipConfirm = true

    vm.confirmEquip!()
    await nextTick()

    expect(equipSpy).not.toHaveBeenCalled()
    expect(vm.showEquipConfirm).toBe(true)
    expect(vm.equipConfirmSlot).toBe('weapon')
    expect(playerStore.pendingEquipment).toEqual(pending)
    wrapper.unmount()
  })

  it('faulted：action 零调用、reason 不变', async () => {
    const { wrapper, vm, playerStore } = await mountReadyForEquip()
    const pending = makeEquipment('eq-21')
    playerStore.pendingEquipment = pending
    vm.equipConfirmSlot = 'weapon'
    vm.showEquipConfirm = true
    const equipSpy = vi.spyOn(playerStore, 'equipNewEquipment')
    vm.runtimeStartupStatus = 'faulted'
    ;(vm as unknown as { runtimeStartupError: string }).runtimeStartupError = 'existing fault reason'

    vm.confirmEquip!()
    await nextTick()

    expect(equipSpy).not.toHaveBeenCalled()
    expect((vm as unknown as { runtimeStartupError: string }).runtimeStartupError).toBe('existing fault reason')
    wrapper.unmount()
  })
})

describe('Phase 3.51 — 架构护栏', () => {
  const ROOT = process.cwd()

  function confirmEquipBody() {
    const src = readFileSync(resolve(ROOT, 'src/App.vue'), 'utf8')
    const m = src.match(/function confirmEquip\(\)\s*\{[\s\S]*?\n\}/)
    expect(m).toBeTruthy()
    return m![0]
  }

  it('护栏：confirmEquip 有 ready guard', () => {
    expect(confirmEquipBody()).toContain("runtimeStartupStatus.value !== 'ready'")
  })

  it('护栏：pending 和 slot 在 action 前快照', () => {
    const body = confirmEquipBody()
    const actionIdx = body.indexOf('equipNewEquipment(')
    expect(body.indexOf('const slot = equipConfirmSlot.value')).toBeLessThan(actionIdx)
    expect(body.indexOf('const pending = playerStore.pendingEquipment')).toBeLessThan(actionIdx)
  })

  it('护栏：equipNewEquipment 位于 try/catch；catch 使用精确分类/formatRuntimeFault/enterRuntimeFault', () => {
    const body = confirmEquipBody()
    expect(body).toContain('try {')
    expect(body).toContain('equipNewEquipment(pending)')
    expect(body).toContain('} catch (error) {')
    expect(body).toContain("formatRuntimeFault('equipment confirmation failed'")
    expect(body).toContain('enterRuntimeFault(formatRuntimeFault(')
  })

  it('护栏：true 分支才关闭 modal/slot；false 分支不进入 fault', () => {
    const body = confirmEquipBody()
    const actionIdx = body.indexOf('equipNewEquipment(')
    // true 分支的 modal/slot 清理必须出现在 action 之后
    expect(body.indexOf('showEquipConfirm.value = false', actionIdx)).toBeGreaterThan(actionIdx)
    expect(body.indexOf('equipConfirmSlot.value = null', actionIdx)).toBeGreaterThan(actionIdx)
    // false 分支（不满足 if 时）直接结束，不调用 enterRuntimeFault
    expect((body.match(/enterRuntimeFault\(/g) || []).length).toBe(1)
  })

  it('护栏：App 不直接修改装备、金币或清除 pending；不调用低层装备事务或 save API', () => {
    const body = confirmEquipBody()
    expect(body).not.toContain('pendingEquipment.value =')
    expect(body).not.toContain('player.value.equipment')
    expect(body).not.toContain('player.value.gold')
    expect(body).not.toContain('saveGame')
    expect(body).not.toContain('recordLogout')
    expect(body).not.toContain('tryReplaceEquipment')
    expect(body).not.toContain('equipItem')
    expect(body).not.toContain('autoEquipIfBetter')
  })
})
