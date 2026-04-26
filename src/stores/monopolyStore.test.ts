import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { PERMANENT_POOL_ID } from '../data/gachaPools'
import type { MonopolyTile } from '../data/monopoly'
import { useGachaStore } from './gachaStore'
import { useLuckyWheelStore } from './luckyWheelStore'
import { useMonopolyStore } from './monopolyStore'
import { usePlayerStore } from './playerStore'
import { useProbabilityStore } from './probabilityStore'

const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value }),
    removeItem: vi.fn((key: string) => { delete store[key] }),
    clear: vi.fn(() => { store = {} })
  }
})()

const monday = Date.UTC(2026, 3, 20)
const nextMonday = Date.UTC(2026, 3, 27)

function setBoard(tile: MonopolyTile) {
  const monopoly = useMonopolyStore()
  monopoly.state.board = [
    { id: 'start', index: 0, type: 'start', name: '起点' },
    tile
  ]
  monopoly.state.position = 0
  monopoly.state.diceRemaining = 3
  return monopoly
}

describe('monopolyStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorageMock.clear()
    vi.stubGlobal('localStorage', localStorageMock)
    vi.restoreAllMocks()
    vi.stubGlobal('localStorage', localStorageMock)
  })

  it('limits daily dice to three rolls', () => {
    const monopoly = useMonopolyStore()
    monopoly.refresh(monday)

    expect(monopoly.rollDice({ rng: () => 0, now: monday })).not.toBeNull()
    expect(monopoly.rollDice({ rng: () => 0, now: monday })).not.toBeNull()
    expect(monopoly.rollDice({ rng: () => 0, now: monday })).not.toBeNull()
    expect(monopoly.rollDice({ rng: () => 0, now: monday })).toBeNull()
    expect(monopoly.state.diceRemaining).toBe(0)
  })

  it('resets map weekly', () => {
    const monopoly = useMonopolyStore()
    monopoly.refresh(monday)
    const firstWeek = monopoly.state.weekId
    const firstBoardIds = monopoly.state.board.map(tile => tile.id).join(',')
    monopoly.state.position = 5

    monopoly.refresh(nextMonday)

    expect(monopoly.state.weekId).not.toBe(firstWeek)
    expect(monopoly.state.position).toBe(0)
    expect(monopoly.state.board.map(tile => tile.id).join(',')).not.toBe(firstBoardIds)
  })

  it('大富翁周刷新后棋盘变化，周内固定', () => {
    const monopoly = useMonopolyStore()
    monopoly.refresh(monday)
    const weekId = monopoly.state.weekId
    const boardIds = monopoly.state.board.map(tile => tile.id).join(',')

    monopoly.refresh(monday + 2 * 24 * 60 * 60 * 1000)

    expect(monopoly.state.weekId).toBe(weekId)
    expect(monopoly.state.board.map(tile => tile.id).join(',')).toBe(boardIds)

    monopoly.refresh(nextMonday)

    expect(monopoly.state.weekId).not.toBe(weekId)
    expect(monopoly.state.board.map(tile => tile.id).join(',')).not.toBe(boardIds)
  })

  it('grants board rewards for gacha ticket, pity, rare plus, material, gold, and token', () => {
    const player = usePlayerStore()
    const gacha = useGachaStore()
    const wheel = useLuckyWheelStore()
    const probability = useProbabilityStore()

    let monopoly = setBoard({
      id: 'ticket',
      index: 1,
      type: 'reward',
      name: '抽卡券',
      reward: { id: 'ticket', rarity: 'epic', name: '抽卡券', description: '', type: 'gachaTicket', value: 1 }
    })
    monopoly.rollDice({ rng: () => 0, now: monday })
    expect(player.player.gachaTickets).toBe(1)

    monopoly = setBoard({
      id: 'pity',
      index: 1,
      type: 'reward',
      name: '保底',
      reward: { id: 'pity', rarity: 'common', name: '保底', description: '', type: 'pity', value: 3 }
    })
    monopoly.rollDice({ rng: () => 0, now: monday })
    expect(gacha.state.pityCounters[PERMANENT_POOL_ID]).toBe(3)

    monopoly = setBoard({
      id: 'rare_plus',
      index: 1,
      type: 'reward',
      name: 'rare+',
      reward: { id: 'rare_plus', rarity: 'rare', name: 'rare+', description: '', type: 'rarePlus', value: 5 }
    })
    monopoly.rollDice({ rng: () => 0, now: monday })
    expect(probability.visibleModifiers).toContainEqual(expect.objectContaining({
      appliesTo: 'nextPull',
      rarePlusBonus: 5
    }))

    monopoly = setBoard({
      id: 'material',
      index: 1,
      type: 'reward',
      name: '材料',
      reward: { id: 'material', rarity: 'common', name: '材料', description: '', type: 'material', value: 2 }
    })
    monopoly.rollDice({ rng: () => 0, now: monday })
    expect(player.player.materials).toBe(2)

    monopoly = setBoard({
      id: 'gold',
      index: 1,
      type: 'reward',
      name: '金币',
      reward: { id: 'gold', rarity: 'common', name: '金币', description: '', type: 'gold', value: 100 }
    })
    monopoly.rollDice({ rng: () => 0, now: monday })
    expect(player.player.gold).toBeGreaterThanOrEqual(100)

    monopoly = setBoard({
      id: 'token',
      index: 1,
      type: 'reward',
      name: 'token',
      reward: { id: 'token', rarity: 'epic', name: 'token', description: '', type: 'buildToken', value: 1, buildTarget: 'speedSkill' }
    })
    monopoly.rollDice({ rng: () => 0, now: monday })
    expect(wheel.state.buildTokens.speedSkill).toBe(1)
  })

  it('boss tile requires combat power before granting rewards', () => {
    const player = usePlayerStore()
    const monopoly = setBoard({
      id: 'boss',
      index: 1,
      type: 'boss',
      name: 'Boss格',
      boss: {
        name: '测试Boss',
        requiredPower: 999999,
        rewards: [{ id: 'ticket', rarity: 'epic', name: 'Boss抽卡券', description: '', type: 'gachaTicket', value: 1 }]
      }
    })

    const failed = monopoly.rollDice({ rng: () => 0, now: monday })
    expect(failed?.bossPassed).toBe(false)
    expect(player.player.gachaTickets).toBe(0)

    monopoly.state.position = 0
    monopoly.state.diceRemaining = 1
    monopoly.state.board[1].boss!.requiredPower = 1
    player.player.stats.attack = 1_000_000
    player.player.stats.maxHp = 1_000_000
    player.player.currentHp = 1_000_000
    const passed = monopoly.rollDice({ rng: () => 0, now: monday })

    expect(passed?.bossPassed).toBe(true)
    expect(player.player.gachaTickets).toBe(1)
  })

  it('does not grant monopoly reward when weekly probability budget is exceeded', () => {
    const player = usePlayerStore()
    const probability = useProbabilityStore()
    probability.recordOutcome({
      gameId: 'monopoly',
      seed: 'free-pull-cap',
      source: 'monopoly',
      label: 'weekly tickets',
      expectedValueCost: 20,
      freePulls: 5
    })
    const monopoly = setBoard({
      id: 'ticket',
      index: 1,
      type: 'reward',
      name: '抽卡券',
      reward: { id: 'ticket', rarity: 'epic', name: '抽卡券', description: '', type: 'gachaTicket', value: 1 }
    })

    const result = monopoly.rollDice({ rng: () => 0, now: monday })

    expect(result?.rewardNames).toHaveLength(0)
    expect(player.player.gachaTickets).toBe(0)
  })
})
