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

/**
 * Phase 3.52 — 游戏重置原子事务与确认交互熔断。
 *
 * - playerStore.resetGame() 收紧为返回 boolean：快照玩家/pending/buffs/强化计数/怪物/
 *   encounter ID → 候选重置 → initMonster → 单次 saveGame → false/throw 完整回滚。
 * - App confirmReset()：ready guard + resetGame 一次；true 才关闭 modal；false 保持；
 *   unexpected throw 进入 fail-stop（game reset failed）。
 */

// themeStore 部分 mock：armed 时第 throwOnCall 次调用抛异常——该调用发生在 saveGame 的
// saveData 构造阶段（位于 saveGame 内部 try 之外），用于真实触发「saveGame 直接抛异常」路径。
const themeThrowState = vi.hoisted(() => ({ armed: false, callCount: 0, throwOnCall: 1 }))
vi.mock('./themeStore', async importOriginal => {
  const actual = await importOriginal<typeof import('./themeStore')>()
  return {
    ...actual,
    useThemeStore: () => {
      themeThrowState.callCount++
      if (themeThrowState.armed && themeThrowState.callCount === themeThrowState.throwOnCall) {
        throw new Error('theme store access failed')
      }
      return actual.useThemeStore()
    }
  }
})

function warmupStores() {
  usePlayerStore()
  useMonsterStore()
  useGameStore()
  useTrainingStore()
  useATBStore()
}

function seedNonDefault() {
  const playerStore = usePlayerStore()
  const monsterStore = useMonsterStore()
  playerStore.player.currentHp = 100
  playerStore.player.maxHp = 100
  playerStore.player.diamond = 500
  playerStore.player.gold = 1000
  playerStore.pendingOfflineReward = { gold: 100, exp: 50 } as OfflineSettlement
  playerStore.activeBuffs.set('attack', { value: 10, mode: 'flat', remainingMs: 1000, totalDurationMs: 1000 })
  playerStore.statUpgradeCounts.set('attack', 3)
  monsterStore.setProgress(20, 20)
}

/** 主存档 setItem 抛错（模拟写盘失败），读取委托真实 storage。 */
function installThrowingStorage() {
  const realStorage = localStorage
  const throwingStorage = {
    get length() {
      return realStorage.length
    },
    clear: () => realStorage.clear(),
    getItem: (k: string) => realStorage.getItem(k),
    key: (i: number) => realStorage.key(i),
    removeItem: (k: string) => realStorage.removeItem(k),
    setItem: (_k: string, _v: string) => {
      throw new Error('quota exceeded')
    }
  }
  vi.stubGlobal('localStorage', throwingStorage)
}

type AppVm = ComponentPublicInstance & {
  confirmReset?: () => void
  useSkill?: (i: number) => void
  switchBattleMode?: (m: 'main' | 'training') => void
  goBackLevels?: () => void
  onClaimOffline?: () => void
  runtimeStartupStatus?: 'initializing' | 'ready' | 'blocked' | 'faulted'
  runtimeStartupError?: string
  showResetConfirm?: boolean
}

/** 挂载 App：OverlayContainer 用可点击 emit('confirm-reset') 的自定义 stub。 */
function mountAppWithResetEmitter() {
  return mount(App, {
    global: {
      stubs: {
        BattleHUD: true,
        PlayerStatusBar: true,
        OverlayContainer: {
          template: '<div><button class="emit-confirm-reset" @click="$emit(\'confirm-reset\')">reset</button></div>'
        },
        TabsContainer: true,
        PauseOverlay: true,
        RebirthModal: true,
        OfflineRewardModal: { template: '<div class="offline-reward-stub"></div>' }
      }
    }
  })
}

async function mountReadyForReset() {
  seedNonDefault()
  const playerStore = usePlayerStore()
  const gameStore = useGameStore()
  vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
  const wrapper = mountAppWithResetEmitter()
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
  themeThrowState.armed = false
  themeThrowState.callCount = 0
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('Phase 3.52 — Store 成功', () => {
  it('返回 true、player 恢复默认、pending/buffs/强化计数清空、initMonster 一次', () => {
    seedNonDefault()
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    const initSpy = vi.spyOn(monsterStore, 'initMonster')

    const res = playerStore.resetGame()

    expect(res).toBe(true)
    expect(playerStore.player.diamond).toBe(0)
    expect(playerStore.player.gold).toBe(0)
    expect(playerStore.pendingOfflineReward).toBeNull()
    expect(playerStore.activeBuffs.size).toBe(0)
    expect(playerStore.statUpgradeCounts.size).toBe(0)
    expect(initSpy).toHaveBeenCalledTimes(1)
  })

  it('encounter ID +1、difficulty/level 不变、saveGame 一次', () => {
    seedNonDefault()
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    const encounterBefore = monsterStore.currentEncounterId
    const difficultyBefore = monsterStore.difficultyValue
    const levelBefore = monsterStore.monsterLevel
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')

    const res = playerStore.resetGame()

    expect(res).toBe(true)
    expect(monsterStore.currentEncounterId).toBe(encounterBefore + 1)
    expect(monsterStore.difficultyValue).toBe(difficultyBefore)
    expect(monsterStore.monsterLevel).toBe(levelBefore)
    expect(setItemSpy.mock.calls.filter(c => c[0] === SAVE_KEY).length).toBe(1)
  })

  it('runeInventory 与非本域 Store 状态不变', () => {
    seedNonDefault()
    const playerStore = usePlayerStore()
    const runeBefore = playerStore.runeInventory
    const res = playerStore.resetGame()
    expect(res).toBe(true)
    expect(playerStore.runeInventory).toBe(runeBefore)
  })
})

describe('Phase 3.52 — Store 失败回滚（save false）', () => {
  it('save false：返回 false、player 精确恢复、pending 恢复、buffs/counts 引用与内容恢复', () => {
    seedNonDefault()
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    const previousPlayer = playerStore.player
    const previousPending = playerStore.pendingOfflineReward
    const previousBuffs = playerStore.activeBuffs
    const previousCounts = playerStore.statUpgradeCounts
    const previousMonster = monsterStore.currentMonster
    const previousEncounterId = monsterStore.currentEncounterId
    playerStore.saveGame() // 基线落盘
    const diskBefore = localStorage.getItem(SAVE_KEY)

    installThrowingStorage()
    const res = playerStore.resetGame()
    vi.unstubAllGlobals()

    expect(res).toBe(false)
    expect(playerStore.player).toBe(previousPlayer)
    expect(playerStore.player.diamond).toBe(500)
    expect(playerStore.player.gold).toBe(1000)
    expect(playerStore.pendingOfflineReward).toBe(previousPending)
    expect(playerStore.activeBuffs).toBe(previousBuffs)
    expect(playerStore.activeBuffs.size).toBe(1)
    expect(playerStore.activeBuffs.has('attack')).toBe(true)
    expect(playerStore.statUpgradeCounts).toBe(previousCounts)
    expect(playerStore.statUpgradeCounts.size).toBe(1)
    expect(monsterStore.currentMonster).toBe(previousMonster)
    expect(monsterStore.currentEncounterId).toBe(previousEncounterId)
    expect(monsterStore.difficultyValue).toBe(20)
    expect(monsterStore.monsterLevel).toBe(20)
    expect(localStorage.getItem(SAVE_KEY)).toBe(diskBefore) // 磁盘无成功 reset
  })

  it('零 save retry（setItem SAVE_KEY 恰好一次）', () => {
    seedNonDefault()
    const playerStore = usePlayerStore()
    const realSetItem = Storage.prototype.setItem.bind(localStorage)
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key: string, value: string) => {
      if (key === SAVE_KEY) throw new Error('quota')
      return realSetItem(key, value)
    })
    expect(playerStore.resetGame()).toBe(false)
    expect(setItemSpy.mock.calls.filter(c => c[0] === SAVE_KEY).length).toBe(1)
  })
})

describe('Phase 3.52 — Store 失败回滚（throw）', () => {
  it('saveGame 直接抛异常：不外抛、完整回滚、返回 false', () => {
    seedNonDefault()
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    const previousPlayer = playerStore.player
    const previousPending = playerStore.pendingOfflineReward
    const previousBuffs = playerStore.activeBuffs
    const previousCounts = playerStore.statUpgradeCounts
    const previousMonster = monsterStore.currentMonster
    const previousEncounterId = monsterStore.currentEncounterId
    playerStore.saveGame() // 基线落盘
    const diskBefore = localStorage.getItem(SAVE_KEY)

    themeThrowState.armed = true
    themeThrowState.callCount = 0
    themeThrowState.throwOnCall = 1

    let threw = false
    let res: boolean | undefined
    try {
      res = playerStore.resetGame()
    } catch {
      threw = true
    }
    themeThrowState.armed = false

    expect(threw).toBe(false)
    expect(res).toBe(false)
    expect(playerStore.player).toBe(previousPlayer)
    expect(playerStore.player.diamond).toBe(500)
    expect(playerStore.pendingOfflineReward).toBe(previousPending)
    expect(playerStore.activeBuffs).toBe(previousBuffs)
    expect(playerStore.activeBuffs.size).toBe(1)
    expect(playerStore.statUpgradeCounts).toBe(previousCounts)
    expect(monsterStore.currentMonster).toBe(previousMonster)
    expect(monsterStore.currentEncounterId).toBe(previousEncounterId)
    expect(localStorage.getItem(SAVE_KEY)).toBe(diskBefore)
  })

  it('initMonster 抛异常：不保存、完整回滚、返回 false', () => {
    seedNonDefault()
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    const previousPlayer = playerStore.player
    const previousPending = playerStore.pendingOfflineReward
    const previousBuffs = playerStore.activeBuffs
    const previousCounts = playerStore.statUpgradeCounts
    const previousMonster = monsterStore.currentMonster
    const previousEncounterId = monsterStore.currentEncounterId
    vi.spyOn(monsterStore, 'initMonster').mockImplementation(() => {
      throw new Error('monster boom')
    })
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')

    let threw = false
    let res: boolean | undefined
    try {
      res = playerStore.resetGame()
    } catch {
      threw = true
    }

    expect(threw).toBe(false)
    expect(res).toBe(false)
    expect(setItemSpy.mock.calls.filter(c => c[0] === SAVE_KEY).length).toBe(0) // 不保存
    expect(playerStore.player).toBe(previousPlayer)
    expect(playerStore.pendingOfflineReward).toBe(previousPending)
    expect(playerStore.activeBuffs).toBe(previousBuffs)
    expect(playerStore.statUpgradeCounts).toBe(previousCounts)
    expect(monsterStore.currentMonster).toBe(previousMonster)
    expect(monsterStore.currentEncounterId).toBe(previousEncounterId)
  })
})

describe('Phase 3.52 — App 交互', () => {
  it('真实 OverlayContainer emit + true：modal 关闭、保持 ready', async () => {
    const { wrapper, vm, playerStore } = await mountReadyForReset()
    vm.showResetConfirm = true
    const resetSpy = vi.spyOn(playerStore, 'resetGame').mockReturnValue(true)

    wrapper.find('.emit-confirm-reset').trigger('click')
    await nextTick()

    expect(resetSpy).toHaveBeenCalledTimes(1)
    expect(vm.showResetConfirm).toBe(false)
    expect(vm.runtimeStartupStatus).toBe('ready')
    wrapper.unmount()
  })

  it('false：modal 保持、ready 保持', async () => {
    const { wrapper, vm, playerStore } = await mountReadyForReset()
    vm.showResetConfirm = true
    const resetSpy = vi.spyOn(playerStore, 'resetGame').mockReturnValue(false)

    wrapper.find('.emit-confirm-reset').trigger('click')
    await nextTick()

    expect(resetSpy).toHaveBeenCalledTimes(1)
    expect(vm.showResetConfirm).toBe(true)
    expect(vm.runtimeStartupStatus).toBe('ready')
    expect(vm.runtimeStartupError).toBe('')
    wrapper.unmount()
  })

  it('false 后用户再次点击是独立请求，单次 handler 不重试', async () => {
    const { wrapper, vm, playerStore } = await mountReadyForReset()
    vm.showResetConfirm = true
    const resetSpy = vi.spyOn(playerStore, 'resetGame').mockReturnValue(false)

    wrapper.find('.emit-confirm-reset').trigger('click')
    wrapper.find('.emit-confirm-reset').trigger('click')
    await nextTick()

    expect(resetSpy).toHaveBeenCalledTimes(2) // 两次独立用户请求
    expect(vm.showResetConfirm).toBe(true)
    expect(vm.runtimeStartupStatus).toBe('ready')
    wrapper.unmount()
  })

  it('App 不额外保存', async () => {
    const { wrapper, vm, playerStore } = await mountReadyForReset()
    vm.showResetConfirm = true
    vi.spyOn(playerStore, 'resetGame').mockReturnValue(true)
    const saveSpy = vi.spyOn(playerStore, 'saveGame')

    wrapper.find('.emit-confirm-reset').trigger('click')
    await nextTick()

    expect(saveSpy).not.toHaveBeenCalled() // App 不直接保存（resetGame 内部保存为闭包调用）
    wrapper.unmount()
  })

  it('initializing/blocked/faulted：零 action、modal 不变', async () => {
    const gameStore = useGameStore()
    const playerStore = usePlayerStore()
    const resetSpy = vi.spyOn(playerStore, 'resetGame')
    // initializing
    {
      seedNonDefault()
      vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
      const wrapper = mountAppWithResetEmitter()
      await nextTick()
      const vm = wrapper.vm as unknown as AppVm
      vm.showResetConfirm = true
      vm.runtimeStartupStatus = 'initializing'
      vm.confirmReset!()
      expect(resetSpy).not.toHaveBeenCalled()
      expect(vm.showResetConfirm).toBe(true)
      wrapper.unmount()
    }
    // blocked
    {
      seedNonDefault()
      vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: false, reason: 'invalid hp' })
      const wrapper = mountAppWithResetEmitter()
      await nextTick()
      const vm = wrapper.vm as unknown as AppVm
      expect(vm.runtimeStartupStatus).toBe('blocked')
      vm.showResetConfirm = true
      vm.confirmReset!()
      expect(resetSpy).not.toHaveBeenCalled()
      expect(vm.showResetConfirm).toBe(true)
      wrapper.unmount()
    }
    // faulted
    {
      seedNonDefault()
      vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
      const wrapper = mountAppWithResetEmitter()
      await nextTick()
      const vm = wrapper.vm as unknown as AppVm
      vm.showResetConfirm = true
      vm.runtimeStartupStatus = 'faulted'
      vm.confirmReset!()
      expect(resetSpy).not.toHaveBeenCalled()
      expect(vm.showResetConfirm).toBe(true)
      wrapper.unmount()
    }
  })
})

describe('Phase 3.52 — Unexpected throw', () => {
  it('Error 精确分类：真实 emit 不外抛、modal 不当作成功关闭', async () => {
    const { wrapper, vm, playerStore } = await mountReadyForReset()
    vm.showResetConfirm = true
    const resetSpy = vi.spyOn(playerStore, 'resetGame').mockImplementation(() => {
      throw new Error('reset boom')
    })

    let threw = false
    try {
      wrapper.find('.emit-confirm-reset').trigger('click')
    } catch {
      threw = true
    }
    await nextTick()

    expect(threw).toBe(false)
    expect(resetSpy).toHaveBeenCalledTimes(1)
    expect(vm.runtimeStartupStatus).toBe('faulted')
    expect(vm.runtimeStartupError).toBe('game reset failed: reset boom')
    expect(vm.showResetConfirm).toBe(true) // catch 不当成功关闭
    wrapper.unmount()
  })

  it('非 Error：String 规范化', async () => {
    const { wrapper, vm, playerStore } = await mountReadyForReset()
    vm.showResetConfirm = true
    vi.spyOn(playerStore, 'resetGame').mockImplementation(() => {
      throw 'reset-string-boom'
    })
    wrapper.find('.emit-confirm-reset').trigger('click')
    await nextTick()
    expect(vm.runtimeStartupError).toBe('game reset failed: reset-string-boom')
    wrapper.unmount()
  })

  it('空 Error：无尾随冒号', async () => {
    const { wrapper, vm, playerStore } = await mountReadyForReset()
    vm.showResetConfirm = true
    vi.spyOn(playerStore, 'resetGame').mockImplementation(() => {
      throw new Error('')
    })
    wrapper.find('.emit-confirm-reset').trigger('click')
    await nextTick()
    expect(vm.runtimeStartupError).toBe('game reset failed')
    expect(vm.runtimeStartupError).not.toContain('game reset failed:')
    wrapper.unmount()
  })

  it('battleError 不变', async () => {
    const { wrapper, vm, playerStore, gameStore } = await mountReadyForReset()
    vm.showResetConfirm = true
    const existing = new Error('existing store fault')
    gameStore.battleError = existing
    vi.spyOn(playerStore, 'resetGame').mockImplementation(() => {
      throw new Error('reset boom')
    })
    wrapper.find('.emit-confirm-reset').trigger('click')
    await nextTick()
    expect(gameStore.battleError).toBe(existing)
    expect(gameStore.battleError!.message).toBe('existing store fault')
    wrapper.unmount()
  })

  it('throw 后 RAF、interval、listener 各清理一次', async () => {
    seedNonDefault()
    const playerStore = usePlayerStore()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    vi.spyOn(playerStore, 'resetGame').mockImplementation(() => {
      throw new Error('reset boom')
    })
    const { cancelSpy, intervalSpy, clearSpy, removeSpy } = spyCleanup()

    const wrapper = mountAppWithResetEmitter()
    await nextTick()
    const vm = wrapper.vm as unknown as AppVm
    vm.showResetConfirm = true
    const runtimeSetIdx = intervalSpy.mock.calls.findIndex(c => c[1] === 1000)
    const runtimeIntervalId = intervalSpy.mock.results[runtimeSetIdx].value

    wrapper.find('.emit-confirm-reset').trigger('click')
    await nextTick()

    expect(cancelSpy.mock.calls.filter(c => c[0] === 1).length).toBe(1)
    expect(clearSpy.mock.calls.filter(c => c[0] === runtimeIntervalId).length).toBe(1)
    expect(removeSpy.mock.calls.filter(c => c[0] === 'beforeunload').length).toBe(1)
    wrapper.unmount()
  })

  it('cleanup 同时 throw 保留 reset reason', async () => {
    seedNonDefault()
    const playerStore = usePlayerStore()
    const gameStore = useGameStore()
    vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
    vi.spyOn(playerStore, 'resetGame').mockImplementation(() => {
      throw new Error('reset boom')
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {
      throw new Error('cancel boom')
    })

    const wrapper = mountAppWithResetEmitter()
    await nextTick()
    const vm = wrapper.vm as unknown as AppVm
    vm.showResetConfirm = true

    wrapper.find('.emit-confirm-reset').trigger('click')
    await nextTick()

    expect(vm.runtimeStartupError).toBe('game reset failed: reset boom')
    expect(vm.runtimeStartupError).not.toContain('runtime cleanup failed')
    wrapper.unmount()
  })

  it('fault 后重复 reset 零调用、Phase 3.50 四条 interaction 全部 no-op', async () => {
    const { wrapper, vm, playerStore, gameStore } = await mountReadyForReset()
    vm.showResetConfirm = true
    const resetSpy = vi.spyOn(playerStore, 'resetGame').mockImplementation(() => {
      throw new Error('reset boom')
    })
    const skillSpy = vi.spyOn(gameStore, 'tryUsePlayerSkill')
    const resumeSpy = vi.spyOn(gameStore, 'resumeBattle')
    const goSpy = vi.spyOn(gameStore, 'tryPurchaseGoBackLevels')
    const claimSpy = vi.spyOn(playerStore, 'claimOfflineReward')

    wrapper.find('.emit-confirm-reset').trigger('click')
    await nextTick()
    expect(resetSpy).toHaveBeenCalledTimes(1)

    wrapper.find('.emit-confirm-reset').trigger('click')
    await nextTick()
    expect(resetSpy).toHaveBeenCalledTimes(1)

    vm.useSkill!(0)
    vm.switchBattleMode!('main')
    vm.goBackLevels!()
    vm.onClaimOffline!()
    await nextTick()

    expect(skillSpy).not.toHaveBeenCalled()
    expect(resumeSpy).not.toHaveBeenCalled()
    expect(goSpy).not.toHaveBeenCalled()
    expect(claimSpy).not.toHaveBeenCalled()
    expect(vm.runtimeStartupError).toBe('game reset failed: reset boom')
    wrapper.unmount()
  })

  it('later Vue unmount 零 shutdown save', async () => {
    const { wrapper, vm, playerStore } = await mountReadyForReset()
    vm.showResetConfirm = true
    vi.spyOn(playerStore, 'resetGame').mockImplementation(() => {
      throw new Error('reset boom')
    })
    const saveSpy = vi.spyOn(playerStore, 'saveGame')

    wrapper.find('.emit-confirm-reset').trigger('click')
    await nextTick()
    expect(vm.runtimeStartupStatus).toBe('faulted')
    wrapper.unmount()
    expect(saveSpy).not.toHaveBeenCalled()
  })
})

describe('Phase 3.52 — 架构护栏', () => {
  const ROOT = process.cwd()

  it('护栏：resetGame(): boolean', () => {
    const src = readFileSync(resolve(ROOT, 'src/stores/playerStore.ts'), 'utf8')
    expect(src).toContain('function resetGame(): boolean {')
  })

  it('护栏：全部快照位于候选修改前', () => {
    const src = readFileSync(resolve(ROOT, 'src/stores/playerStore.ts'), 'utf8')
    const m = src.match(/function resetGame\(\):\s*boolean\s*\{[\s\S]*?\n  \}/)
    expect(m).toBeTruthy()
    const body = m![0]
    const candidateIdx = body.indexOf('createDefaultPlayer()')
    expect(body.indexOf('const previousPlayer = player.value')).toBeLessThan(candidateIdx)
    expect(body.indexOf('const previousPending = pendingOfflineReward.value')).toBeLessThan(candidateIdx)
    expect(body.indexOf('const previousBuffs = activeBuffs.value')).toBeLessThan(candidateIdx)
    expect(body.indexOf('const previousCounts = statUpgradeCounts.value')).toBeLessThan(candidateIdx)
    expect(body.indexOf('const previousMonster = monsterStore.currentMonster')).toBeLessThan(candidateIdx)
    expect(body.indexOf('const previousEncounterId = monsterStore.currentEncounterId')).toBeLessThan(candidateIdx)
  })

  it('护栏：activeBuffs/statUpgradeCounts 使用新 Map、不清旧 Map', () => {
    const src = readFileSync(resolve(ROOT, 'src/stores/playerStore.ts'), 'utf8')
    const m = src.match(/function resetGame\(\):\s*boolean\s*\{[\s\S]*?\n  \}/)
    expect(m).toBeTruthy()
    const body = m![0]
    expect(body).toContain('activeBuffs.value = new Map()')
    expect(body).toContain('statUpgradeCounts.value = new Map()')
    expect(body).not.toContain('activeBuffs.value.clear()')
    expect(body).not.toContain('statUpgradeCounts.value.clear()')
  })

  it('护栏：false/throw 共用完整 rollback；saveGame 恰好一个调用点', () => {
    const src = readFileSync(resolve(ROOT, 'src/stores/playerStore.ts'), 'utf8')
    const m = src.match(/function resetGame\(\):\s*boolean\s*\{[\s\S]*?\n  \}/)
    expect(m).toBeTruthy()
    const body = m![0]
    expect((body.match(/rollback\(\)/g) || []).length).toBeGreaterThanOrEqual(2)
    expect((body.match(/saveGame\(\)/g) || []).length).toBe(1)
  })

  it('护栏：App 使用单一 confirmReset；模板不再含 inline reset expression', () => {
    const src = readFileSync(resolve(ROOT, 'src/App.vue'), 'utf8')
    expect(src).toContain('function confirmReset()')
    expect(src).toContain('@confirm-reset="confirmReset"')
    expect(src).not.toContain('playerStore.resetGame(); showResetConfirm = false')
  })

  it('护栏：App 有 ready guard、try/catch、精确分类；不直接修改 Store 重置状态', () => {
    const src = readFileSync(resolve(ROOT, 'src/App.vue'), 'utf8')
    const m = src.match(/function confirmReset\(\)\s*\{[\s\S]*?\n\}/)
    expect(m).toBeTruthy()
    const body = m![0]
    expect(body).toContain("runtimeStartupStatus.value !== 'ready'")
    expect(body).toContain('try {')
    expect(body).toContain('playerStore.resetGame()')
    expect(body).toContain("formatRuntimeFault('game reset failed'")
    expect(body).toContain('enterRuntimeFault(formatRuntimeFault(')
    for (const forbidden of [
      'player.value =',
      'pendingOfflineReward',
      'activeBuffs',
      'statUpgradeCounts',
      'currentMonster',
      'currentEncounterId',
      'saveGame',
      'recordLogout',
      'initMonster',
      'createDefaultPlayer'
    ]) {
      expect(body).not.toContain(forbidden)
    }
  })
})
