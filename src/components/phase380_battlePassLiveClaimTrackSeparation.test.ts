import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import BattlePassTab from './BattlePassTab.vue'
import { usePlayerStore } from '../stores/playerStore'
import { useBattlePassStore } from '../stores/battlePassStore'

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('Phase 3.80 BattlePassTab 真实行为：分轨领取', () => {
  // 普通玩家点击 free → 只发 free（gold +100），diamond 不增加
  it('普通玩家点击 level 1 free → player gold +100 / diamond 不增加', async () => {
    const playerStore = usePlayerStore()
    playerStore.player.gold = 0
    playerStore.player.diamond = 0
    const wrapper = mount(BattlePassTab)
    await nextTick()

    const freeButtons = wrapper.findAll('.free-reward button')
    expect(freeButtons.length).toBe(1) // 只有 level 1 可领（currentLevel=1）
    await freeButtons[0].trigger('click')
    await nextTick()

    expect(playerStore.player.gold).toBe(100)
    expect(playerStore.player.diamond).toBe(0)
    const bp = useBattlePassStore()
    expect(bp.claimedFreeLevels).toEqual([1])
    expect(bp.claimedPremiumLevels).toEqual([])
  })

  // Premium 玩家点击 premium → 只发 premium item（diamond +10），gold 不增加
  it('Premium 玩家点击 level 1 premium → 只发 premium（diamond +10）/ gold 不增加', async () => {
    const playerStore = usePlayerStore()
    playerStore.player.gold = 0
    playerStore.player.diamond = 0
    const bp = useBattlePassStore()
    bp.setPremium(true)
    const wrapper = mount(BattlePassTab)
    await nextTick()

    const premiumButtons = wrapper.findAll('.premium-reward button')
    expect(premiumButtons.length).toBe(1) // 只有 level 1 可领（currentLevel=1）
    await premiumButtons[0].trigger('click')
    await nextTick()

    expect(playerStore.player.diamond).toBe(10)
    expect(playerStore.player.gold).toBe(0)
    expect(bp.claimedPremiumLevels).toEqual([1])
    expect(bp.claimedFreeLevels).toEqual([])
  })

  // Premium 玩家先 free 后 premium：两个按钮都可见，两次点击分别入账
  it('Premium 玩家同一 level 先 free 后 premium：两轨各自入账且按钮状态独立', async () => {
    const playerStore = usePlayerStore()
    playerStore.player.gold = 0
    playerStore.player.diamond = 0
    const bp = useBattlePassStore()
    bp.setPremium(true)
    const wrapper = mount(BattlePassTab)
    await nextTick()

    // level 1 free 与 premium 按钮同时可见
    expect(wrapper.findAll('.free-reward button').length).toBe(1)
    expect(wrapper.findAll('.premium-reward button').length).toBe(1)

    await wrapper.findAll('.free-reward button')[0].trigger('click')
    await nextTick()
    expect(playerStore.player.gold).toBe(100)
    expect(playerStore.player.diamond).toBe(0)
    // free 已领后 free 按钮消失，premium 按钮仍在
    expect(wrapper.findAll('.free-reward button').length).toBe(0)
    expect(wrapper.findAll('.premium-reward button').length).toBe(1)

    await wrapper.findAll('.premium-reward button')[0].trigger('click')
    await nextTick()
    expect(playerStore.player.diamond).toBe(10)
    expect(playerStore.player.gold).toBe(100)
    // 两轨都已领
    expect(wrapper.findAll('.free-reward button').length).toBe(0)
    expect(wrapper.findAll('.premium-reward button').length).toBe(0)
    expect(bp.claimedFreeLevels).toEqual([1])
    expect(bp.claimedPremiumLevels).toEqual([1])
  })

  // 普通玩家看不到 premium 领取按钮（locked），且无法通过 UI 领取
  it('普通玩家 premium 区无按钮（locked）', async () => {
    const wrapper = mount(BattlePassTab)
    await nextTick()
    expect(wrapper.findAll('.premium-reward button').length).toBe(0)
    expect(wrapper.findAll('.premium-reward .locked').length).toBeGreaterThan(0)
  })
})
