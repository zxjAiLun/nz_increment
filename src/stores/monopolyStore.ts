import { defineStore } from 'pinia'
import { computed, reactive } from 'vue'
import { PERMANENT_POOL_ID } from '../data/gachaPools'
import {
  DAILY_MONOPOLY_DICE,
  MONOPOLY_BOARD_SIZE,
  MONOPOLY_REWARD_RATES,
  MONOPOLY_REWARDS,
  createMonopolyBoss,
  type MonopolyReward,
  type MonopolyTile
} from '../data/monopoly'
import { RewardResolver, SeededRng, type ProbabilityAudit } from '../systems/probability/rewardResolver'
import { useGachaStore } from './gachaStore'
import { useLuckyWheelStore } from './luckyWheelStore'
import { usePlayerStore } from './playerStore'

const MONOPOLY_KEY = 'nz_monopoly_v1'

interface MonopolyMoveRecord {
  timestamp: number
  weekId: string
  from: number
  roll: number
  to: number
  tile: MonopolyTile
  rewardNames: string[]
  bossPassed?: boolean
  requiredPower?: number
  playerPower?: number
}

interface MonopolyState {
  weekId: string
  position: number
  diceRemaining: number
  lastDiceRefresh: number
  board: MonopolyTile[]
  boardAudits: Record<number, ProbabilityAudit>
  history: MonopolyMoveRecord[]
}

function dateKey(timestamp: number): number {
  return new Date(timestamp).setHours(0, 0, 0, 0)
}

function getWeekId(timestamp: number): string {
  const date = new Date(timestamp)
  const day = date.getDay() || 7
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() - day + 1)
  return date.toISOString().slice(0, 10)
}

function hashSeed(value: string): number {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function calculatePlayerPower(): number {
  const playerStore = usePlayerStore()
  const stats = playerStore.totalStats
  return Math.floor(stats.attack + stats.defense + stats.maxHp * 0.08 + stats.speed * 25)
}

function makeStartTile(): MonopolyTile {
  return { id: 'start', index: 0, type: 'start', name: '起点' }
}

function generateWeeklyBoard(weekId: string): { board: MonopolyTile[]; audits: Record<number, ProbabilityAudit> } {
  const board: MonopolyTile[] = [makeStartTile()]
  const audits: Record<number, ProbabilityAudit> = {}
  const resolver = new RewardResolver<MonopolyReward>(
    MONOPOLY_REWARDS,
    MONOPOLY_REWARD_RATES,
    ['legendary', 'epic', 'rare', 'common']
  )

  for (let index = 1; index < MONOPOLY_BOARD_SIZE; index++) {
    if (index === 7 || index === 15) {
      board.push({ id: `boss_${index}`, index, type: 'boss', name: 'Boss格', boss: createMonopolyBoss(index) })
      continue
    }

    const seed = hashSeed(`${weekId}:${index}`)
    const rng = new SeededRng(seed)
    const resolved = resolver.resolve({
      rng: rng.fn(),
      context: { pullNumber: index },
      seed
    })
    audits[index] = resolved.audit
    board.push({
      id: `reward_${index}_${resolved.reward.id}`,
      index,
      type: 'reward',
      name: resolved.reward.name,
      reward: resolved.reward
    })
  }

  return { board, audits }
}

export const useMonopolyStore = defineStore('monopoly', () => {
  const now = Date.now()
  const generated = generateWeeklyBoard(getWeekId(now))
  const state = reactive<MonopolyState>({
    weekId: getWeekId(now),
    position: 0,
    diceRemaining: DAILY_MONOPOLY_DICE,
    lastDiceRefresh: dateKey(now),
    board: generated.board,
    boardAudits: generated.audits,
    history: []
  })

  const currentTile = computed(() => state.board[state.position] ?? state.board[0])
  const playerPower = computed(() => calculatePlayerPower())

  function load() {
    const saved = localStorage.getItem(MONOPOLY_KEY)
    if (!saved) return
    const data = JSON.parse(saved) as MonopolyState
    state.weekId = data.weekId || state.weekId
    state.position = data.position || 0
    state.diceRemaining = data.diceRemaining ?? DAILY_MONOPOLY_DICE
    state.lastDiceRefresh = data.lastDiceRefresh || 0
    state.board = data.board?.length ? data.board : state.board
    state.boardAudits = data.boardAudits || state.boardAudits
    state.history = data.history || []
  }

  function save() {
    localStorage.setItem(MONOPOLY_KEY, JSON.stringify(state))
  }

  function resetWeek(weekId: string) {
    const next = generateWeeklyBoard(weekId)
    state.weekId = weekId
    state.position = 0
    state.board = next.board
    state.boardAudits = next.audits
    state.history = []
  }

  function refresh(nowMs: number = Date.now()) {
    const weekId = getWeekId(nowMs)
    if (state.weekId !== weekId) resetWeek(weekId)
    const today = dateKey(nowMs)
    if (state.lastDiceRefresh < today) {
      state.diceRemaining = DAILY_MONOPOLY_DICE
      state.lastDiceRefresh = today
    }
    save()
  }

  function applyReward(reward: MonopolyReward): string {
    const playerStore = usePlayerStore()
    const gachaStore = useGachaStore()
    const luckyWheelStore = useLuckyWheelStore()

    if (reward.type === 'gold') playerStore.addGold(reward.value)
    else if (reward.type === 'material') playerStore.addMaterial(reward.value)
    else if (reward.type === 'gachaTicket') playerStore.addGachaTicket(reward.value)
    else if (reward.type === 'pity') gachaStore.addPityProgress(PERMANENT_POOL_ID, reward.value)
    else if (reward.type === 'rarePlus') gachaStore.addRarePlusBonus(PERMANENT_POOL_ID, reward.value)
    else if (reward.type === 'buildToken' && reward.buildTarget) luckyWheelStore.addBuildToken(reward.buildTarget, reward.value)

    return reward.name
  }

  function rollDice(options: { rng?: () => number; seed?: number; now?: number } = {}): MonopolyMoveRecord | null {
    refresh(options.now)
    if (state.diceRemaining <= 0 || state.board.length === 0) return null

    const seeded = options.seed !== undefined ? new SeededRng(options.seed) : null
    const rng = options.rng ?? seeded?.fn() ?? Math.random
    const from = state.position
    const roll = Math.floor(rng() * 6) + 1
    const to = (from + roll) % state.board.length
    const tile = state.board[to]
    const rewardNames: string[] = []
    const power = calculatePlayerPower()
    let bossPassed: boolean | undefined
    let requiredPower: number | undefined

    state.position = to
    state.diceRemaining--

    if (tile.type === 'reward' && tile.reward) {
      rewardNames.push(applyReward(tile.reward))
    } else if (tile.type === 'boss' && tile.boss) {
      requiredPower = tile.boss.requiredPower
      bossPassed = power >= requiredPower
      if (bossPassed) {
        for (const reward of tile.boss.rewards) rewardNames.push(applyReward(reward))
      }
    }

    const record: MonopolyMoveRecord = {
      timestamp: options.now ?? Date.now(),
      weekId: state.weekId,
      from,
      roll,
      to,
      tile,
      rewardNames,
      bossPassed,
      requiredPower,
      playerPower: power
    }
    state.history.unshift(record)
    if (state.history.length > 30) state.history.pop()
    save()
    return record
  }

  function getTileAudit(index: number): ProbabilityAudit | null {
    return state.boardAudits[index] || null
  }

  load()
  refresh()

  return {
    state,
    currentTile,
    playerPower,
    refresh,
    rollDice,
    getTileAudit
  }
})
