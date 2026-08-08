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

describe('Phase 3.82 BattlePassTab 真实行为：free gold 事务 dispatch', () => {
  // free gold：普通玩家 level 1 free click → gold +100 exactly once / legacy EXP +10 / 无双发
  it('普通玩家点击 level 1 free → gold +100 恰一次 / legacy BP EXP +10 / free marker / premium 不变', async () => {
    const playerStore = usePlayerStore()
    playerStore.player.gold = 0
    playerStore.player.diamond = 0
    const bp = useBattlePassStore()
    const wrapper = mount(BattlePassTab)
    await nextTick()

    const freeButtons = wrapper.findAll('.free-reward button')
    expect(freeButtons.length).toBe(1) // currentLevel=1 仅 level 1 可领
    await freeButtons[0].trigger('click')
    await nextTick()

    // exactly once（若组件再调 addGold 会 +200 / EXP +20）
    expect(playerStore.player.gold).toBe(100)
    expect(playerStore.battlePass.exp).toBe(10)
    expect(playerStore.player.diamond).toBe(0)
    expect(bp.claimedFreeLevels).toEqual([1])
    expect(bp.claimedPremiumLevels).toEqual([])
  })

  // premium diamond（3.81 路径）不受 3.82 dispatch 影响
  it('Premium 玩家点击 level 1 premium → diamond +10 恰一次（3.81 路径不回归）', async () => {
    const playerStore = usePlayerStore()
    playerStore.player.gold = 0
    playerStore.player.diamond = 0
    const bp = useBattlePassStore()
    bp.setPremium(true)
    const wrapper = mount(BattlePassTab)
    await nextTick()

    await wrapper.findAll('.premium-reward button')[0].trigger('click')
    await nextTick()

    expect(playerStore.player.diamond).toBe(10)
    expect(playerStore.player.gold).toBe(0)
    expect(bp.claimedPremiumLevels).toEqual([1])
    expect(bp.claimedFreeLevels).toEqual([])
  })

  // non-gold free（level 5 material）仍走 generic 3.80 path
  it('level 5 free（material）仍走 generic 路径，不进入 free-gold 事务', async () => {
    const playerStore = usePlayerStore()
    playerStore.player.gold = 0
    const prevMaterials = playerStore.player.materials
    const bp = useBattlePassStore()
    bp.currentLevel = 5
    const wrapper = mount(BattlePassTab)
    await nextTick()

    const freeButtons = wrapper.findAll('.free-reward button')
    // currentLevel=5：level 1（gold）+ level 5（material）两个 free 按钮
    expect(freeButtons.length).toBe(2)
    await freeButtons[1].trigger('click')
    await nextTick()

    expect(playerStore.player.materials).toBe(prevMaterials + 5)
    expect(playerStore.player.gold).toBe(0)
    expect(playerStore.battlePass.exp).toBe(0)
    expect(bp.claimedFreeLevels).toEqual([5])
    expect(bp.claimedPremiumLevels).toEqual([])
  })
})
