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
import type { ChanceGameOutcome } from '../systems/probability/chanceGame'
import { RewardResolver, SeededRng, type ProbabilityAudit } from '../systems/probability/rewardResolver'
import { createSeededRng, simulateCombatScenario } from '../systems/combat/battleSimulator'
import { generateMonster } from '../utils/monsterGenerator'
import { useGachaStore } from './gachaStore'
import { useLuckyWheelStore } from './luckyWheelStore'
import { useMonsterStore } from './monsterStore'
import { usePlayerStore } from './playerStore'
import { useProbabilityStore } from './probabilityStore'

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

function createBossChallengeMonster(weekId: string, index: number, requiredPower: number) {
  const monsterStore = useMonsterStore()
  const challengeDifficulty = Math.max(
    monsterStore.difficultyValue,
    Math.floor(Math.sqrt(Math.max(1, requiredPower)))
  )
  const level = Math.max(10, Math.ceil(index / 10) * 10)
  const rng = createSeededRng(hashSeed(`${weekId}:boss:${index}:combat`))
  return generateMonster(challengeDifficulty, level, rng)
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
    else if (reward.type === 'rarePlus') return reward.name
    else if (reward.type === 'buildToken' && reward.buildTarget) luckyWheelStore.addBuildToken(reward.buildTarget, reward.value)

    return reward.name
  }

  function buildRewardOutcome(reward: MonopolyReward, seed: string, audit?: ProbabilityAudit): ChanceGameOutcome {
    const expectedValueCost = reward.type === 'gachaTicket'
      ? 4
      : reward.type === 'pity' || reward.type === 'rarePlus'
        ? reward.value
        : 1
    return {
      gameId: 'monopoly',
      seed,
      source: reward.type === 'pity' ? 'pity' : 'monopoly',
      label: reward.name,
      expectedValueCost,
      freePulls: reward.type === 'gachaTicket' ? reward.value : 0,
      jackpot: false,
      modifier: reward.type === 'pity'
        ? { id: `monopoly:${seed}:${reward.id}`, source: 'pity', label: reward.name, pityBonus: reward.value }
        : reward.type === 'rarePlus'
          ? {
              id: `rare_plus_bonus:${seed}:${reward.id}`,
              source: 'monopoly',
              label: reward.name,
              poolId: PERMANENT_POOL_ID,
              appliesTo: 'nextPull',
              appliesToCost: 'paidOnly',
              rarePlusBonus: reward.value
            }
          : undefined,
      audit
    }
  }

  function applyRewardBatch(rewards: Array<{ reward: MonopolyReward; seed: string; audit?: ProbabilityAudit }>): string[] | null {
    const probabilityStore = useProbabilityStore()
    const outcomes = rewards.map(item => buildRewardOutcome(item.reward, item.seed, item.audit))
    return probabilityStore.applyChanceOutcomes(outcomes, () => rewards.map(item => applyReward(item.reward)))
  }

  function rollDice(options: { rng?: () => number; seed?: number; now?: number } = {}): MonopolyMoveRecord | null {
    refresh(options.now)
    if (state.diceRemaining <= 0 || state.board.length === 0) return null
    const playerStore = usePlayerStore()

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
    const probabilityStore = useProbabilityStore()
    const rewardBatch: Array<{ reward: MonopolyReward; seed: string; audit?: ProbabilityAudit }> = tile.type === 'reward' && tile.reward
      ? [{ reward: tile.reward, seed: `${state.weekId}:${to}:${state.history.length}`, audit: state.boardAudits[to] }]
      : tile.type === 'boss' && tile.boss
        ? tile.boss.rewards.map(reward => ({
            reward,
            seed: `${state.weekId}:boss:${to}:${reward.id}:${state.history.length}`
          }))
        : []
    const rewardOutcomes = rewardBatch.map(item => buildRewardOutcome(item.reward, item.seed, item.audit))
    if (rewardOutcomes.length > 0 && !probabilityStore.canRecordOutcomes(rewardOutcomes)) return null

    state.position = to
    state.diceRemaining--

    if (tile.type === 'reward' && tile.reward) {
      rewardNames.push(...(applyRewardBatch(rewardBatch) ?? []))
    } else if (tile.type === 'boss' && tile.boss) {
      requiredPower = tile.boss.requiredPower
      const bossMonster = createBossChallengeMonster(state.weekId, to, requiredPower)
      bossMonster.name = tile.boss.name
      const battleResult = simulateCombatScenario({
        player: playerStore.player,
        stats: playerStore.totalStats,
        monster: bossMonster,
        difficulty: Math.max(1, Math.floor(Math.sqrt(Math.max(1, requiredPower)))),
        rng: createSeededRng(hashSeed(`${state.weekId}:boss:${to}:roll:${state.history.length}`)),
        skillLoadout: playerStore.player.skills.filter((skill): skill is NonNullable<typeof skill> => !!skill),
        secondsLimit: 90
      })
      bossPassed = battleResult.killed
      if (bossPassed) {
        rewardNames.push(...(applyRewardBatch(rewardBatch) ?? []))
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
