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
import { useThemeStore } from './themeStore'
import App from '../App.vue'
import type { ComponentPublicInstance } from 'vue'

/**
 * Phase 3.58 — 转生跨 Store 同步补偿事务。
 *
 * - playerStore.resetForRebirth() 改为纯内存重置（不再自行 saveGame；activeBuffs/counts
 *   改用新 Map 替换旧引用）。
 * - rebirthStore.performRebirth() 建立同步补偿事务：资格验证 → 完整内存快照 → 候选应用 →
 *   rebirth_data 先写 → 主存档最后写 → 成功提交；任何同步失败都精确回滚内存，主存档失败时
 *   补偿恢复 rebirth_data，再抛异常进入既有 App fail-stop。
 * - 只保证一次同步调用内的失败原子性，不宣称跨 localStorage key 的断电级 ACID。
 */

function warmupStores() {
  usePlayerStore()
  useMonsterStore()
  useGameStore()
  useTrainingStore()
  useATBStore()
  useRebirthStore()
  useThemeStore()
}

/** 就绪的转生环境（难度 10 满足资格门）。 */
function seedRebirthReady() {
  const monsterStore = useMonsterStore()
  const playerStore = usePlayerStore()
  const rebirthStore = useRebirthStore()
  monsterStore.difficultyValue = 10
  monsterStore.monsterLevel = 10
  playerStore.player.currentHp = 100
  playerStore.player.maxHp = 100
  return { monsterStore, playerStore, rebirthStore }
}

function seedRebirthRaw(value: string | null) {
  if (value === null) {
    localStorage.removeItem('rebirth_data')
  } else {
    localStorage.setItem('rebirth_data', value)
  }
}

const OLD_REBIRTH_RAW = JSON.stringify({ rebirthPoints: 5, totalRebirthCount: 1, upgrades: [], lastRebirthTime: 100 })

type AppVm = ComponentPublicInstance & {
  performRebirth?: () => void
  runtimeStartupStatus?: 'initializing' | 'ready' | 'blocked' | 'faulted'
  runtimeStartupError?: string
  showRebirthModal?: boolean
  showRebirthShop?: boolean
}

function mountAppReal() {
  const playerStore = usePlayerStore()
  const monsterStore = useMonsterStore()
  const gameStore = useGameStore()
  playerStore.player.currentHp = 100
  playerStore.player.maxHp = 100
  monsterStore.setProgress(20, 20)
  vi.spyOn(gameStore, 'prepareBattleRuntimeAfterLoad').mockReturnValue({ ok: true, state: 'alive' })
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
  return { wrapper, playerStore, monsterStore, gameStore }
}

async function mountReadyApp() {
  const m = mountAppReal()
  await nextTick()
  const vm = m.wrapper.vm as unknown as AppVm
  return { ...m, vm }
}

async function openRebirthModal(vm: AppVm) {
  vm.showRebirthModal = true
  await flushPromises()
  await vi.dynamicImportSettled()
  await nextTick()
}

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

describe('Phase 3.58 — Player reset 纯内存', () => {
  it('resetForRebirth 不调用 saveGame、零写盘', () => {
    const playerStore = usePlayerStore()
    const saveSpy = vi.spyOn(playerStore, 'saveGame')
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    playerStore.resetForRebirth()
    expect(saveSpy).not.toHaveBeenCalled()
    expect(setItemSpy).not.toHaveBeenCalled()
  })

  it('使用新 Player 对象', () => {
    const playerStore = usePlayerStore()
    playerStore.player.gold = 100
    const oldPlayer = playerStore.player
    playerStore.resetForRebirth()
    expect(playerStore.player).not.toBe(oldPlayer)
    expect(playerStore.player.gold).toBe(0)
  })

  it('使用新空 activeBuffs Map', () => {
    const playerStore = usePlayerStore()
    playerStore.activeBuffs.set('attack' as never, { value: 5, mode: 'flat', remainingMs: 100, totalDurationMs: 100 } as never)
    const oldBuffs = playerStore.activeBuffs
    playerStore.resetForRebirth()
    expect(playerStore.activeBuffs).not.toBe(oldBuffs)
    expect(playerStore.activeBuffs.size).toBe(0)
  })

  it('使用新空 statUpgradeCounts Map', () => {
    const playerStore = usePlayerStore()
    playerStore.statUpgradeCounts.set('attack' as never, 2)
    const oldCounts = playerStore.statUpgradeCounts
    playerStore.resetForRebirth()
    expect(playerStore.statUpgradeCounts).not.toBe(oldCounts)
    expect(playerStore.statUpgradeCounts.size).toBe(0)
  })

  it('不修改旧 Player/旧 Map（旧引用内容保持）', () => {
    const playerStore = usePlayerStore()
    playerStore.player.gold = 100
    const oldPlayer = playerStore.player
    const oldBuffs = playerStore.activeBuffs
    oldBuffs.set('attack' as never, { value: 5, mode: 'flat', remainingMs: 100, totalDurationMs: 100 } as never)
    const oldCounts = playerStore.statUpgradeCounts
    oldCounts.set('attack' as never, 2)
    playerStore.resetForRebirth()
    expect(oldPlayer.gold).toBe(100) // 旧 Player 未被原地修改
    expect(oldBuffs.size).toBe(1) // 旧 Map 未被 clear
    expect(oldCounts.size).toBe(1)
  })

  it('原有累计字段保持', () => {
    const playerStore = usePlayerStore()
    playerStore.player.totalKillCount = 999
    playerStore.player.totalComboCount = 42
    playerStore.player.maxComboCount = 10
    playerStore.player.totalOnlineTime = 12345
    playerStore.player.totalOfflineTime = 6789
    playerStore.resetForRebirth()
    expect(playerStore.player.totalKillCount).toBe(999)
    expect(playerStore.player.totalComboCount).toBe(42)
    expect(playerStore.player.maxComboCount).toBe(10)
    expect(playerStore.player.totalOnlineTime).toBe(12345)
    expect(playerStore.player.totalOfflineTime).toBe(6789)
  })
})

describe('Phase 3.58 — 成功事务', () => {
  it('难度 10 返回 33、points/count/time 精确更新一次', () => {
    const { rebirthStore } = seedRebirthReady()
    const timeBefore = rebirthStore.lastRebirthTime
    const result = rebirthStore.performRebirth()
    expect(result).not.toBeNull()
    expect(result!.pointsEarned).toBe(33)
    expect(rebirthStore.rebirthPoints).toBe(33)
    expect(rebirthStore.totalRebirthCount).toBe(1)
    expect(rebirthStore.lastRebirthTime).not.toBe(timeBefore)
    expect(rebirthStore.lastRebirthTime).toBeGreaterThan(0)
  })

  it('Player reset / Monster reset 各一次，rebirth 写入一次、main save 一次', () => {
    const { playerStore, monsterStore, rebirthStore } = seedRebirthReady()
    const playerResetSpy = vi.spyOn(playerStore, 'resetForRebirth')
    const monsterResetSpy = vi.spyOn(monsterStore, 'resetForRebirth')
    const saveGameSpy = vi.spyOn(playerStore, 'saveGame')
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    rebirthStore.performRebirth()
    expect(playerResetSpy).toHaveBeenCalledTimes(1)
    expect(monsterResetSpy).toHaveBeenCalledTimes(1)
    expect(saveGameSpy).toHaveBeenCalledTimes(1)
    expect(setItemSpy.mock.calls.filter(c => c[0] === 'rebirth_data').length).toBe(1)
  })

  it('写入顺序严格为 rebirth key → 主存档 key', () => {
    const { rebirthStore } = seedRebirthReady()
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    rebirthStore.performRebirth()
    const keys = setItemSpy.mock.calls.map(c => c[0])
    const rebirthIdx = keys.indexOf('rebirth_data')
    const mainIdx = keys.indexOf('lollipop_adventure_save')
    expect(rebirthIdx).toBeGreaterThan(-1)
    expect(mainIdx).toBeGreaterThan(-1)
    expect(rebirthIdx).toBeLessThan(mainIdx)
  })

  it('两份磁盘数据与成功内存一致', () => {
    const { rebirthStore } = seedRebirthReady()
    rebirthStore.performRebirth()
    const diskRebirth = JSON.parse(localStorage.getItem('rebirth_data')!)
    expect(diskRebirth.rebirthPoints).toBe(rebirthStore.rebirthPoints)
    expect(diskRebirth.totalRebirthCount).toBe(rebirthStore.totalRebirthCount)
    expect(diskRebirth.lastRebirthTime).toBe(rebirthStore.lastRebirthTime)
    expect(diskRebirth.upgrades).toEqual([])
    const mainSave = JSON.parse(localStorage.getItem('lollipop_adventure_save')!)
    expect(mainSave.player.gold).toBe(0) // reset 后 Player 进度
    expect(mainSave.monsterData.difficultyValue).toBe(10)
  })

  it('upgrades 引用和内容不变', () => {
    const { rebirthStore } = seedRebirthReady()
    rebirthStore.upgrades = [{ upgradeId: 'crit_rate', currentLevel: 2 }]
    const upgradesBefore = rebirthStore.upgrades
    rebirthStore.performRebirth()
    expect(rebirthStore.upgrades).toBe(upgradesBefore)
    expect(rebirthStore.upgrades).toEqual([{ upgradeId: 'crit_rate', currentLevel: 2 }])
  })
})

describe('Phase 3.58 — 资格拒绝', () => {
  it('NaN、Infinity、负值、0、9、9.999 返回 null', () => {
    const monsterStore = useMonsterStore()
    const rebirthStore = useRebirthStore()
    for (const d of [NaN, Infinity, -Infinity, 0, -5, 9, 9.999]) {
      monsterStore.difficultyValue = d
      expect(rebirthStore.performRebirth()).toBeNull()
    }
  })

  it('资格拒绝零 mutation、零 reset、零 storage', () => {
    const monsterStore = useMonsterStore()
    const playerStore = usePlayerStore()
    const rebirthStore = useRebirthStore()
    monsterStore.difficultyValue = 9
    const pointsBefore = rebirthStore.rebirthPoints
    const countBefore = rebirthStore.totalRebirthCount
    const timeBefore = rebirthStore.lastRebirthTime
    const playerBefore = playerStore.player
    const playerResetSpy = vi.spyOn(playerStore, 'resetForRebirth')
    const monsterResetSpy = vi.spyOn(monsterStore, 'resetForRebirth')
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    expect(rebirthStore.performRebirth()).toBeNull()
    expect(rebirthStore.rebirthPoints).toBe(pointsBefore)
    expect(rebirthStore.totalRebirthCount).toBe(countBefore)
    expect(rebirthStore.lastRebirthTime).toBe(timeBefore)
    expect(playerStore.player).toBe(playerBefore)
    expect(playerResetSpy).not.toHaveBeenCalled()
    expect(monsterResetSpy).not.toHaveBeenCalled()
    expect(setItemSpy).not.toHaveBeenCalled()
  })
})

describe('Phase 3.58 — Candidate failure', () => {
  it('Player reset throw：完整内存回滚、零 storage、原错误抛出', () => {
    const { playerStore, rebirthStore } = seedRebirthReady()
    const boomError = new Error('reset boom')
    vi.spyOn(playerStore, 'resetForRebirth').mockImplementation(() => {
      throw boomError
    })
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    const playerBefore = playerStore.player
    let thrown: unknown
    try {
      rebirthStore.performRebirth()
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBe(boomError)
    expect(rebirthStore.rebirthPoints).toBe(0)
    expect(rebirthStore.totalRebirthCount).toBe(0)
    expect(rebirthStore.lastRebirthTime).toBe(0)
    expect(playerStore.player).toBe(playerBefore)
    expect(setItemSpy).not.toHaveBeenCalled()
  })

  it('Monster reset throw：完整内存回滚、零 storage、原错误抛出、旧引用未被修改', () => {
    const { playerStore, monsterStore, rebirthStore } = seedRebirthReady()
    playerStore.player.gold = 100
    const oldBuffs = playerStore.activeBuffs
    oldBuffs.set('attack' as never, { value: 5, mode: 'flat', remainingMs: 100, totalDurationMs: 100 } as never)
    const oldCounts = playerStore.statUpgradeCounts
    oldCounts.set('attack' as never, 2)
    const playerBefore = playerStore.player
    const monsterBefore = monsterStore.currentMonster
    const boomError = new Error('monster boom')
    vi.spyOn(monsterStore, 'resetForRebirth').mockImplementation(() => {
      throw boomError
    })
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    let thrown: unknown
    try {
      rebirthStore.performRebirth()
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBe(boomError)
    expect(rebirthStore.rebirthPoints).toBe(0)
    expect(rebirthStore.totalRebirthCount).toBe(0)
    expect(playerStore.player).toBe(playerBefore)
    expect(playerStore.player.gold).toBe(100)
    expect(playerStore.activeBuffs).toBe(oldBuffs)
    expect(playerStore.activeBuffs.size).toBe(1)
    expect(playerStore.statUpgradeCounts).toBe(oldCounts)
    expect(playerStore.statUpgradeCounts.size).toBe(1)
    expect(monsterStore.currentMonster).toBe(monsterBefore)
    expect(setItemSpy).not.toHaveBeenCalled()
  })
})

describe('Phase 3.58 — Rebirth key 写入失败', () => {
  it('真实 rebirth_data setItem throw：内存回滚、主存档零尝试、两 key 旧值不变、原错误抛出、无 retry', () => {
    const { playerStore, rebirthStore } = seedRebirthReady()
    seedRebirthRaw(OLD_REBIRTH_RAW)
    const mainSaveBefore = localStorage.getItem('lollipop_adventure_save')
    const boomError = new Error('disk full')
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key: string) => {
      if (key === 'rebirth_data') throw boomError
    })
    const saveGameSpy = vi.spyOn(playerStore, 'saveGame')
    let thrown: unknown
    try {
      rebirthStore.performRebirth()
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBe(boomError) // 原错误引用
    expect(saveGameSpy).not.toHaveBeenCalled() // 主存档零尝试
    expect(rebirthStore.rebirthPoints).toBe(0)
    expect(rebirthStore.totalRebirthCount).toBe(0)
    expect(localStorage.getItem('rebirth_data')).toBe(OLD_REBIRTH_RAW) // 旧值不变
    expect(localStorage.getItem('lollipop_adventure_save')).toBe(mainSaveBefore)
    // 只尝试一次写入，无 retry
    expect((vi.mocked(Storage.prototype.setItem).mock.calls.filter(c => c[0] === 'rebirth_data')).length).toBe(1)
  })
})

describe('Phase 3.58 — Main save false', () => {
  it('saveGame 返回 false：内存回滚、rebirth key 恢复旧字节、抛 rebirth main save failed', () => {
    const { playerStore, rebirthStore } = seedRebirthReady()
    seedRebirthRaw(OLD_REBIRTH_RAW)
    const playerBefore = playerStore.player
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    const saveGameSpy = vi.spyOn(playerStore, 'saveGame').mockReturnValue(false)
    let thrown: unknown
    try {
      rebirthStore.performRebirth()
    } catch (e) {
      thrown = e
    }
    expect((thrown as Error).message).toBe('rebirth main save failed')
    expect(rebirthStore.rebirthPoints).toBe(0)
    expect(rebirthStore.totalRebirthCount).toBe(0)
    expect(playerStore.player).toBe(playerBefore)
    expect(localStorage.getItem('rebirth_data')).toBe(OLD_REBIRTH_RAW) // 恢复旧字节
    expect(saveGameSpy).toHaveBeenCalledTimes(1)
    const rebirthWrites = setItemSpy.mock.calls.filter(c => c[0] === 'rebirth_data')
    expect(rebirthWrites.length).toBe(2) // 新值写入一次 + 补偿恢复一次，零 retry
    expect(rebirthWrites[1][1]).toBe(OLD_REBIRTH_RAW) // 恢复的是旧字节
  })

  it('old-null：saveGame false 后 rebirth key 恢复为不存在', () => {
    const { playerStore, rebirthStore } = seedRebirthReady()
    seedRebirthRaw(null)
    vi.spyOn(playerStore, 'saveGame').mockReturnValue(false)
    let thrown: unknown
    try {
      rebirthStore.performRebirth()
    } catch (e) {
      thrown = e
    }
    expect((thrown as Error).message).toBe('rebirth main save failed')
    expect(localStorage.getItem('rebirth_data')).toBeNull()
  })
})

describe('Phase 3.58 — Main save throw', () => {
  it('saveGame throw：内存回滚、rebirth key 恢复旧值、原错误引用重抛、不重复调用', () => {
    const { playerStore, rebirthStore } = seedRebirthReady()
    seedRebirthRaw(OLD_REBIRTH_RAW)
    const playerBefore = playerStore.player
    const boomError = new Error('main boom')
    const saveGameSpy = vi.spyOn(playerStore, 'saveGame').mockImplementation(() => {
      throw boomError
    })
    let thrown: unknown
    try {
      rebirthStore.performRebirth()
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBe(boomError) // 原错误引用重新抛出
    expect(saveGameSpy).toHaveBeenCalledTimes(1) // 不重复调用
    expect(rebirthStore.rebirthPoints).toBe(0)
    expect(rebirthStore.totalRebirthCount).toBe(0)
    expect(playerStore.player).toBe(playerBefore)
    expect(localStorage.getItem('rebirth_data')).toBe(OLD_REBIRTH_RAW)
  })
})

describe('Phase 3.58 — 真实主 key setItem throw', () => {
  it('真实主 key setItem throw（saveGame 内部 catch 返回 false）：内存回滚、rebirth key 恢复、抛 rebirth main save failed', () => {
    const { playerStore, rebirthStore } = seedRebirthReady()
    seedRebirthRaw(OLD_REBIRTH_RAW)
    const playerBefore = playerStore.player
    const originalSetItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (key === 'lollipop_adventure_save') throw new Error('main disk full')
      return originalSetItem.call(this, key, value)
    })
    let thrown: unknown
    try {
      rebirthStore.performRebirth()
    } catch (e) {
      thrown = e
    }
    expect((thrown as Error).message).toBe('rebirth main save failed')
    expect(rebirthStore.rebirthPoints).toBe(0)
    expect(rebirthStore.totalRebirthCount).toBe(0)
    expect(playerStore.player).toBe(playerBefore)
    expect(localStorage.getItem('rebirth_data')).toBe(OLD_REBIRTH_RAW) // 恢复旧字节
  })
})

describe('Phase 3.58 — 补偿失败', () => {
  it('main save 失败后 rebirth key 恢复操作 throw：内存仍回滚、抛 rebirth persistence rollback failed、补偿一次、不清空其他 storage', () => {
    const { playerStore, monsterStore, rebirthStore } = seedRebirthReady()
    seedRebirthRaw(OLD_REBIRTH_RAW)
    localStorage.setItem('other_key', 'keep')
    const playerBefore = playerStore.player
    const monsterBefore = monsterStore.currentMonster
    let restoreShouldThrow = false
    const originalSetItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (key === 'rebirth_data' && restoreShouldThrow) {
        throw new Error('restore boom')
      }
      return originalSetItem.call(this, key, value)
    })
    vi.spyOn(playerStore, 'saveGame').mockImplementation(() => {
      restoreShouldThrow = true
      return false
    })
    let thrown: unknown
    try {
      rebirthStore.performRebirth()
    } catch (e) {
      thrown = e
    }
    expect((thrown as Error).message).toBe('rebirth persistence rollback failed')
    expect(rebirthStore.rebirthPoints).toBe(0) // 内存仍完整回滚
    expect(rebirthStore.totalRebirthCount).toBe(0)
    expect(playerStore.player).toBe(playerBefore)
    expect(monsterStore.currentMonster).toBe(monsterBefore)
    const rebirthWrites = (vi.mocked(Storage.prototype.setItem).mock.calls.filter(c => c[0] === 'rebirth_data'))
    expect(rebirthWrites.length).toBe(2) // 新值写入一次 + 补偿尝试一次，无 retry
    expect(localStorage.getItem('other_key')).toBe('keep') // 不清空其他 storage
  })
})

describe('Phase 3.58 — App 回归', () => {
  it('资格 null 仍保持 modal、runtime ready、不 alert', async () => {
    const { wrapper, vm, monsterStore } = await mountReadyApp()
    const alertSpy = vi.fn()
    vi.stubGlobal('alert', alertSpy)
    monsterStore.difficultyValue = 9
    await openRebirthModal(vm)
    vm.performRebirth!()
    await nextTick()
    expect(vm.showRebirthModal).toBe(true)
    expect(vm.runtimeStartupStatus).toBe('ready')
    expect(alertSpy).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('成功仍关闭 modal/shop 并 alert 一次', async () => {
    const { wrapper, vm } = await mountReadyApp()
    const alertSpy = vi.fn()
    vi.stubGlobal('alert', alertSpy)
    await openRebirthModal(vm)
    wrapper.find('.rebirth-confirm-btn').trigger('click')
    await nextTick()
    expect(vm.showRebirthModal).toBe(false)
    expect(vm.showRebirthShop).toBe(false)
    expect(vm.runtimeStartupStatus).toBe('ready')
    expect(alertSpy).toHaveBeenCalledTimes(1)
    expect(alertSpy).toHaveBeenCalledWith('转生成功！获得 45 转生点数！')
    wrapper.unmount()
  })

  it('事务 throw 进入 rebirth interaction failed、不外抛、不 alert', async () => {
    const { wrapper, vm, playerStore } = await mountReadyApp()
    const alertSpy = vi.fn()
    vi.stubGlobal('alert', alertSpy)
    vi.spyOn(playerStore, 'saveGame').mockReturnValue(false)
    await openRebirthModal(vm)
    let threw = false
    try {
      wrapper.find('.rebirth-confirm-btn').trigger('click')
    } catch {
      threw = true
    }
    await nextTick()
    expect(threw).toBe(false)
    expect(vm.runtimeStartupStatus).toBe('faulted')
    expect(vm.runtimeStartupError).toBe('rebirth interaction failed: rebirth main save failed')
    expect(vm.showRebirthModal).toBe(true) // 不作为成功关闭
    expect(alertSpy).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('battleError 保持、cleanup 单次、首错锁定、later unmount 零 shutdown save', async () => {
    seedRebirthRaw(null)
    const { cancelSpy, intervalSpy, clearSpy, removeSpy } = spyCleanup()
    const { wrapper, vm, gameStore, playerStore } = await mountReadyApp()
    const existing = new Error('existing store fault')
    gameStore.battleError = existing
    const saveGameSpy = vi.spyOn(playerStore, 'saveGame').mockReturnValue(false)
    await openRebirthModal(vm)
    wrapper.find('.rebirth-confirm-btn').trigger('click')
    await nextTick()
    expect(vm.runtimeStartupStatus).toBe('faulted')
    expect(vm.runtimeStartupError).toBe('rebirth interaction failed: rebirth main save failed')
    expect(gameStore.battleError).toBe(existing) // battleError 保持
    const runtimeSetIdx = intervalSpy.mock.calls.findIndex(c => c[1] === 1000)
    const runtimeIntervalId = intervalSpy.mock.results[runtimeSetIdx].value
    expect(cancelSpy.mock.calls.filter(c => c[0] === 1).length).toBe(1)
    expect(clearSpy.mock.calls.filter(c => c[0] === runtimeIntervalId).length).toBe(1)
    expect(removeSpy.mock.calls.filter(c => c[0] === 'beforeunload').length).toBe(1)
    // 首错锁定：重复 trigger 不覆盖 reason
    vm.performRebirth!()
    await nextTick()
    expect(vm.runtimeStartupError).toBe('rebirth interaction failed: rebirth main save failed')
    const callsAfterFault = saveGameSpy.mock.calls.length
    wrapper.unmount()
    expect(saveGameSpy.mock.calls.length).toBe(callsAfterFault) // faulted 下 later unmount 零 shutdown save
  })
})
