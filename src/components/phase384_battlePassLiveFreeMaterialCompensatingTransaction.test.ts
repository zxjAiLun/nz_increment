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

describe('Phase 3.84 BattlePassTab 真实行为：free material 事务 dispatch', () => {
  // free material：currentLevel=5 点击 level 5 free → materials +5 exactly once / 无双发
  it('点击 level 5 free（material）→ materials +5 恰一次 / free marker [5] / premium 不变', async () => {
    const playerStore = usePlayerStore()
    playerStore.player.materials = 0
    playerStore.player.gold = 0
    const bp = useBattlePassStore()
    bp.currentLevel = 5
    const wrapper = mount(BattlePassTab)
    await nextTick()

    const freeButtons = wrapper.findAll('.free-reward button')
    // currentLevel=5：level 1（gold）+ level 5（material）两个 free 按钮
    expect(freeButtons.length).toBe(2)
    await freeButtons[1].trigger('click')
    await nextTick()

    // exactly once（若组件再调 addMaterial 会 +10）
    expect(playerStore.player.materials).toBe(5)
    expect(playerStore.player.gold).toBe(0)
    expect(bp.claimedFreeLevels).toEqual([5])
    expect(bp.claimedPremiumLevels).toEqual([])
  })

  // free gold（3.82 路径）不受影响
  it('level 1 free gold 仍走 3.82 事务：gold +100 / legacy EXP +10', async () => {
    const playerStore = usePlayerStore()
    playerStore.player.gold = 0
    playerStore.player.materials = 0
    const bp = useBattlePassStore()
    const wrapper = mount(BattlePassTab)
    await nextTick()

    await wrapper.findAll('.free-reward button')[0].trigger('click')
    await nextTick()

    expect(playerStore.player.gold).toBe(100)
    expect(playerStore.battlePass.exp).toBe(10)
    expect(playerStore.player.materials).toBe(0)
    expect(bp.claimedFreeLevels).toEqual([1])
  })

  // premium diamond（3.81 路径）不受影响
  it('Premium 玩家点击 level 1 premium → diamond +10 恰一次', async () => {
    const playerStore = usePlayerStore()
    playerStore.player.diamond = 0
    const bp = useBattlePassStore()
    bp.setPremium(true)
    const wrapper = mount(BattlePassTab)
    await nextTick()

    await wrapper.findAll('.premium-reward button')[0].trigger('click')
    await nextTick()

    expect(playerStore.player.diamond).toBe(10)
    expect(bp.claimedPremiumLevels).toEqual([1])
    expect(bp.claimedFreeLevels).toEqual([])
  })

  // remaining generic free（level 10 gachaTicket）仍走 3.83 generic path
  it('level 10 free（gachaTicket）仍走 generic 路径，不进入 material 事务', async () => {
    const playerStore = usePlayerStore()
    playerStore.player.gold = 0
    playerStore.player.materials = 0
    const prevTickets = playerStore.player.gachaTickets
    const bp = useBattlePassStore()
    bp.currentLevel = 10
    const wrapper = mount(BattlePassTab)
    await nextTick()

    const freeButtons = wrapper.findAll('.free-reward button')
    // currentLevel=10：level 1（gold）+ level 5（material）+ level 10（gachaTicket）三个 free 按钮
    expect(freeButtons.length).toBe(3)
    await freeButtons[2].trigger('click')
    await nextTick()

    expect(playerStore.player.gachaTickets).toBe(prevTickets + 1)
    expect(playerStore.player.materials).toBe(0)
    expect(playerStore.player.gold).toBe(0)
    expect(playerStore.battlePass.exp).toBe(0)
    expect(bp.claimedFreeLevels).toEqual([10])
    expect(bp.claimedPremiumLevels).toEqual([])
  })
})
