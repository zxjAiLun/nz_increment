import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import BattlePassTab from './BattlePassTab.vue'
import { usePlayerStore } from '../stores/playerStore'
import { useBattlePassStore } from '../stores/battlePassStore'

const SAVE_KEY = 'lollipop_adventure_save'

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('Phase 3.81 BattlePassTab 真实行为：premium diamond 事务 dispatch', () => {
  // Premium diamond：level 1 premium click → 走事务 API → diamond +10 exactly once
  it('Premium 玩家点击 level 1 premium → diamond +10 恰一次 / marker 只进 premium 轨', async () => {
    const playerStore = usePlayerStore()
    playerStore.player.diamond = 0
    playerStore.player.gold = 0
    const bp = useBattlePassStore()
    bp.setPremium(true)
    const wrapper = mount(BattlePassTab)
    await nextTick()

    const premiumButtons = wrapper.findAll('.premium-reward button')
    expect(premiumButtons.length).toBe(1) // currentLevel=1 仅 level 1 可领
    await premiumButtons[0].trigger('click')
    await nextTick()

    expect(playerStore.player.diamond).toBe(10)
    expect(playerStore.player.gold).toBe(0)
    expect(bp.claimedPremiumLevels).toEqual([1])
    expect(bp.claimedFreeLevels).toEqual([])
  })

  // fresh reload：player diamond == persisted value / premium marker persisted
  it('fresh reload：Main raw diamond == 10 且 premium marker 持久化', async () => {
    const playerStore = usePlayerStore()
    playerStore.player.diamond = 0
    const bp = useBattlePassStore()
    bp.setPremium(true)
    const wrapper = mount(BattlePassTab)
    await nextTick()

    await wrapper.findAll('.premium-reward button')[0].trigger('click')
    await nextTick()

    // Main raw 已包含新 diamond
    const mainRaw = localStorage.getItem(SAVE_KEY)!
    expect(JSON.parse(mainRaw).player.diamond).toBe(10)
    // 新 store 实例恢复 premium marker
    setActivePinia(createPinia())
    const bp2 = useBattlePassStore()
    expect(bp2.claimedPremiumLevels).toEqual([1])
    expect(bp2.claimedFreeLevels).toEqual([])
  })

  // Non-diamond premium：level 5 passiveShard 仍走 generic 3.80 路径
  it('Premium 玩家点击 level 5 premium（passiveShard）→ 走 generic 路径，diamond 不变', async () => {
    const playerStore = usePlayerStore()
    playerStore.player.diamond = 0
    const prevShards = playerStore.player.passiveShards
    const bp = useBattlePassStore()
    bp.setPremium(true)
    bp.currentLevel = 5
    const wrapper = mount(BattlePassTab)
    await nextTick()

    const premiumButtons = wrapper.findAll('.premium-reward button')
    // currentLevel=5：level 1（diamond）+ level 5（passiveShard）两个 premium 按钮
    expect(premiumButtons.length).toBe(2)
    await premiumButtons[1].trigger('click')
    await nextTick()

    expect(playerStore.player.passiveShards).toBe(prevShards + 2)
    expect(playerStore.player.diamond).toBe(0)
    expect(bp.claimedPremiumLevels).toEqual([5])
    expect(bp.claimedFreeLevels).toEqual([])
  })

  // Free：普通玩家 level 1 free gold 保持 3.80 行为
  it('普通玩家点击 level 1 free → gold +100 / diamond 不增加（dispatch 未改坏 free 路径）', async () => {
    const playerStore = usePlayerStore()
    playerStore.player.gold = 0
    playerStore.player.diamond = 0
    const wrapper = mount(BattlePassTab)
    await nextTick()

    const freeButtons = wrapper.findAll('.free-reward button')
    expect(freeButtons.length).toBe(1)
    await freeButtons[0].trigger('click')
    await nextTick()

    expect(playerStore.player.gold).toBe(100)
    expect(playerStore.player.diamond).toBe(0)
    const bp = useBattlePassStore()
    expect(bp.claimedFreeLevels).toEqual([1])
    expect(bp.claimedPremiumLevels).toEqual([])
  })
})
