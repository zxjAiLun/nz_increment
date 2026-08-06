import { defineStore } from 'pinia'
import { computed, reactive } from 'vue'
import { PERMANENT_POOL_ID, GACHA_POOLS } from '../data/gachaPools'
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
const GACHA_KEY = 'nz_gacha_v1'
const PROBABILITY_KEY = 'nz_probability_v1'
const LUCKY_WHEEL_KEY = 'nz_lucky_wheel_v1'
const MAIN_KEY = 'lollipop_adventure_save'

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

function formatLocalDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getWeekId(timestamp: number): string {
  const date = new Date(timestamp)
  const day = date.getDay() || 7
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() - day + 1)
  return formatLocalDateKey(date)
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

  function rollDice(options: { rng?: () => number; seed?: number; now?: number } = {}): MonopolyMoveRecord | null {
    const probabilityStore = useProbabilityStore()
    const gachaStore = useGachaStore()
    const luckyWheelStore = useLuckyWheelStore()
    const playerStore = usePlayerStore()

    // Phase 3.67：单次时间戳候选（options.now 优先，否则仅一次 Date.now）。
    const transactionTimestamp = options.now ?? Date.now()
    if (!Number.isSafeInteger(transactionTimestamp) || transactionTimestamp <= 0) return null

    // 纯候选 refresh：周重置 + 每日骰子恢复（不写盘）。
    const weekId = getWeekId(transactionTimestamp)
    const today = dateKey(transactionTimestamp)
    let nextWeekId = state.weekId
    let nextPosition = state.position
    let nextDiceRemaining = state.diceRemaining
    let nextLastDiceRefresh = state.lastDiceRefresh
    let nextBoard = state.board
    let nextBoardAudits = state.boardAudits
    let nextHistory = state.history
    if (state.weekId !== weekId) {
      const generated = generateWeeklyBoard(weekId)
      nextWeekId = weekId
      nextPosition = 0
      nextBoard = generated.board
      nextBoardAudits = generated.audits
      nextHistory = []
    }
    if (nextLastDiceRefresh < today) {
      nextDiceRemaining = DAILY_MONOPOLY_DICE
      nextLastDiceRefresh = today
    }

    // 无骰子资格拒绝（零副作用）。
    if (nextDiceRemaining <= 0 || nextBoard.length === 0) return null

    // RNG / 掷骰候选（异常向组件边界上送，零副作用）。
    const seeded = options.seed !== undefined ? new SeededRng(options.seed) : null
    const rng = options.rng ?? seeded?.fn() ?? Math.random
    const from = nextPosition
    const roll = Math.floor(rng() * 6) + 1
    const to = (from + roll) % nextBoard.length
    const tile = nextBoard[to]
    const power = calculatePlayerPower()

    // Boss 模拟候选（异常上送，零副作用）。
    let bossPassed: boolean | undefined
    let requiredPower: number | undefined
    if (tile.type === 'boss' && tile.boss) {
      requiredPower = tile.boss.requiredPower
      const bossMonster = createBossChallengeMonster(nextWeekId, to, requiredPower)
      bossMonster.name = tile.boss.name
      const battleResult = simulateCombatScenario({
        player: playerStore.player,
        stats: playerStore.totalStats,
        monster: bossMonster,
        difficulty: Math.max(1, Math.floor(Math.sqrt(Math.max(1, requiredPower)))),
        rng: createSeededRng(hashSeed(`${nextWeekId}:boss:${to}:roll:${nextHistory.length}`)),
        skillLoadout: playerStore.player.skills.filter((skill): skill is NonNullable<typeof skill> => !!skill),
        secondsLimit: 90
      })
      bossPassed = battleResult.killed
    }

    // 奖励批次候选（Boss 失败 → 无奖励）。
    const rewardBatch: Array<{ reward: MonopolyReward; seed: string; audit?: ProbabilityAudit }> = tile.type === 'reward' && tile.reward
      ? [{ reward: tile.reward, seed: `${nextWeekId}:${to}:${nextHistory.length}`, audit: nextBoardAudits[to] }]
      : tile.type === 'boss' && tile.boss
        ? tile.boss.rewards.map(reward => ({
            reward,
            seed: `${nextWeekId}:boss:${to}:${reward.id}:${nextHistory.length}`
          }))
        : []
    const rewardsToApply = tile.type === 'boss' && !bossPassed ? [] : rewardBatch
    const rewardOutcomes = rewardsToApply.map(item => buildRewardOutcome(item.reward, item.seed, item.audit))

    const hasOutcomes = rewardOutcomes.length > 0
    const hasPity = rewardsToApply.some(i => i.reward.type === 'pity')
    const hasBuildToken = rewardsToApply.some(i => i.reward.type === 'buildToken')
    const hasPlayerReward = rewardsToApply.some(i => i.reward.type === 'gold' || i.reward.type === 'material' || i.reward.type === 'gachaTicket')

    // 事务前内存快照（深拷贝，供完整回滚）。
    const prevOutcomes = [...probabilityStore.state.outcomes]
    const prevBudgetUsage = JSON.parse(JSON.stringify(probabilityStore.state.budgetUsage)) as typeof probabilityStore.state.budgetUsage
    const prevPendingModifiers = [...probabilityStore.state.pendingModifiers]
    const prevMonopoly = {
      weekId: state.weekId,
      position: state.position,
      diceRemaining: state.diceRemaining,
      lastDiceRefresh: state.lastDiceRefresh,
      board: state.board,
      boardAudits: state.boardAudits,
      history: [...state.history]
    }
    const prevPlayerGold = playerStore.player.gold
    const prevPlayerMaterials = playerStore.player.materials
    const prevPlayerTickets = playerStore.player.gachaTickets
    const prevBattlePassExp = playerStore.battlePass.exp
    const prevBattlePassLevel = playerStore.battlePass.level
    const prevPityCounters = hasPity ? { ...gachaStore.state.pityCounters } : null
    const prevBuildTokens = hasBuildToken ? JSON.parse(JSON.stringify(luckyWheelStore.state.buildTokens)) as typeof luckyWheelStore.state.buildTokens : null

    // 旧 raw 快照（getItem 抛错 → 普通 null，零 mutation）。
    let prevProbabilityRaw: string | null = null
    let prevGachaRaw: string | null = null
    let prevLuckyRaw: string | null = null
    let prevMainRaw: string | null = null
    try {
      if (hasOutcomes) prevProbabilityRaw = localStorage.getItem(PROBABILITY_KEY)
      if (hasPity) prevGachaRaw = localStorage.getItem(GACHA_KEY)
      if (hasBuildToken) prevLuckyRaw = localStorage.getItem(LUCKY_WHEEL_KEY)
      if (hasPlayerReward) prevMainRaw = localStorage.getItem(MAIN_KEY)
    } catch {
      return null
    }

    function rollbackMemory() {
      probabilityStore.state.outcomes = prevOutcomes
      probabilityStore.state.budgetUsage = prevBudgetUsage
      probabilityStore.state.pendingModifiers = prevPendingModifiers
      state.weekId = prevMonopoly.weekId
      state.position = prevMonopoly.position
      state.diceRemaining = prevMonopoly.diceRemaining
      state.lastDiceRefresh = prevMonopoly.lastDiceRefresh
      state.board = prevMonopoly.board
      state.boardAudits = prevMonopoly.boardAudits
      state.history = prevMonopoly.history
      playerStore.player.gold = prevPlayerGold
      playerStore.player.materials = prevPlayerMaterials
      playerStore.player.gachaTickets = prevPlayerTickets
      playerStore.battlePass.exp = prevBattlePassExp
      playerStore.battlePass.level = prevBattlePassLevel
      if (hasPity && prevPityCounters) gachaStore.state.pityCounters = prevPityCounters
      if (hasBuildToken && prevBuildTokens) luckyWheelStore.state.buildTokens = prevBuildTokens
    }

    // 逆序补偿已写入 key；全部尝试并收集失败，不因第一个错误跳过后续补偿。
    function compensateRaws(raws: { key: string; previous: string | null }[]): unknown[] {
      const failures: unknown[] = []
      for (let i = raws.length - 1; i >= 0; i--) {
        const { key, previous } = raws[i]
        try {
          if (previous === null) localStorage.removeItem(key)
          else localStorage.setItem(key, previous)
        } catch (error) {
          failures.push(error)
        }
      }
      return failures
    }

    // 失败收口：内存回滚 → 逆序补偿已写入 key → 补偿失败抛固定分类错误。
    function finalizeFailure(writtenRaws: { key: string; previous: string | null }[]): null {
      rollbackMemory()
      const failures = compensateRaws(writtenRaws)
      if (failures.length > 0) {
        throw new Error('monopoly persistence rollback failed')
      }
      return null
    }

    const probabilityRaw = { key: PROBABILITY_KEY, previous: prevProbabilityRaw }
    const gachaRaw = { key: GACHA_KEY, previous: prevGachaRaw }
    const luckyRaw = { key: LUCKY_WHEEL_KEY, previous: prevLuckyRaw }
    const mainRaw = { key: MAIN_KEY, previous: prevMainRaw }
    // 前向写入顺序（补偿逆序恢复）。
    function forwardRaws(includeMain: boolean) {
      const raws: { key: string; previous: string | null }[] = []
      if (hasOutcomes) raws.push(probabilityRaw)
      if (hasPity) raws.push(gachaRaw)
      if (hasBuildToken) raws.push(luckyRaw)
      if (includeMain && hasPlayerReward) raws.push(mainRaw)
      return raws
    }

    const record: MonopolyMoveRecord = {
      timestamp: transactionTimestamp,
      weekId: nextWeekId,
      from,
      roll,
      to,
      tile,
      rewardNames: rewardsToApply.map(i => i.reward.name),
      bossPassed,
      requiredPower,
      playerPower: power
    }

    // 内存提交：Probability 无写盘 batch → Monopoly 状态 → 奖励。
    if (hasOutcomes && !probabilityStore.applyChanceOutcomesInMemory(rewardOutcomes, transactionTimestamp)) {
      return null // 预算拒绝：outcomes/pendingModifiers/budgetUsage 完全不变
    }
    state.weekId = nextWeekId
    state.position = to
    state.diceRemaining = nextDiceRemaining - 1
    state.lastDiceRefresh = nextLastDiceRefresh
    if (nextWeekId !== prevMonopoly.weekId) {
      state.board = nextBoard
      state.boardAudits = nextBoardAudits
    }
    state.history = [record, ...nextHistory]
    if (state.history.length > 30) state.history.pop()

    for (const item of rewardsToApply) {
      const reward = item.reward
      if (reward.type === 'gold') playerStore.applyGoldRewardInMemory(reward.value)
      else if (reward.type === 'material') playerStore.player.materials += reward.value
      else if (reward.type === 'gachaTicket') playerStore.player.gachaTickets += reward.value
      else if (reward.type === 'pity') {
        const pool = GACHA_POOLS[PERMANENT_POOL_ID]
        gachaStore.state.pityCounters[PERMANENT_POOL_ID] = Math.min(
          pool.pity.target - 1,
          (gachaStore.state.pityCounters[PERMANENT_POOL_ID] || 0) + Math.max(0, reward.value)
        )
      } else if (reward.type === 'buildToken' && reward.buildTarget) {
        luckyWheelStore.state.buildTokens[reward.buildTarget] = (luckyWheelStore.state.buildTokens[reward.buildTarget] || 0) + Math.max(0, reward.value)
      }
    }

    // 固定持久化顺序：Probability → Gacha → LuckyWheel → Player main → Monopoly（最后）。
    if (hasOutcomes) {
      try {
        probabilityStore.saveProbabilityData()
      } catch {
        return finalizeFailure([])
      }
    }
    if (hasPity) {
      try {
        gachaStore.saveGachaData()
      } catch {
        return finalizeFailure(forwardRaws(false))
      }
    }
    if (hasBuildToken) {
      try {
        luckyWheelStore.saveLuckyWheelData()
      } catch {
        return finalizeFailure(forwardRaws(false))
      }
    }
    if (hasPlayerReward) {
      let saved: boolean
      try {
        saved = playerStore.saveGame(transactionTimestamp)
      } catch {
        return finalizeFailure(forwardRaws(false))
      }
      if (!saved) {
        return finalizeFailure(forwardRaws(false))
      }
    }
    try {
      save()
    } catch {
      return finalizeFailure(forwardRaws(true))
    }

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
