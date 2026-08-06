import { defineStore } from 'pinia'
import { reactive } from 'vue'
import { PERMANENT_POOL_ID } from '../data/gachaPools'
import { PACHINKO_MODIFIERS, PACHINKO_RATES, type PachinkoModifierReward } from '../data/pachinko'
import type { ChanceGameOutcome } from '../systems/probability/chanceGame'
import { RewardResolver, SeededRng, type ProbabilityAudit } from '../systems/probability/rewardResolver'
import { useProbabilityStore } from './probabilityStore'

const PACHINKO_KEY = 'nz_pachinko_v1'
const PROBABILITY_KEY = 'nz_probability_v1'

interface PachinkoRecord {
  timestamp: number
  poolId: string
  modifier: PachinkoModifierReward
  audit: ProbabilityAudit
}

interface PachinkoState {
  history: PachinkoRecord[]
}

export const usePachinkoStore = defineStore('pachinko', () => {
  const state = reactive<PachinkoState>({
    history: []
  })

  function load() {
    const saved = localStorage.getItem(PACHINKO_KEY)
    if (!saved) return
    const data = JSON.parse(saved) as PachinkoState
    state.history = data.history || []
  }

  function save() {
    localStorage.setItem(PACHINKO_KEY, JSON.stringify(state))
  }

  function resolveModifier(options: { seed?: number; rng?: () => number } = {}) {
    const seeded = options.seed !== undefined ? new SeededRng(options.seed) : null
    const rng = options.rng ?? seeded?.fn() ?? Math.random
    const resolver = new RewardResolver<PachinkoModifierReward>(
      PACHINKO_MODIFIERS,
      PACHINKO_RATES,
      ['legendary', 'epic', 'rare', 'common']
    )
    return resolver.resolve({
      rng,
      context: { pullNumber: 10 },
      seed: options.seed
    })
  }

  function playShot(poolId: string = PERMANENT_POOL_ID, options: { seed?: number; rng?: () => number; now?: number } = {}): PachinkoRecord | null {
    const probabilityStore = useProbabilityStore()

    // Phase 3.68：单次时间戳候选（options.now 优先，否则仅一次 Date.now；正安全整数校验）。
    const transactionTimestamp = options.now ?? Date.now()
    if (!Number.isSafeInteger(transactionTimestamp) || transactionTimestamp <= 0) return null

    // resolver 候选（RNG / resolver 异常向组件边界上送，零副作用）。
    const resolved = resolveModifier(options)
    const seed = String(options.seed ?? transactionTimestamp)
    const outcome: ChanceGameOutcome = {
      gameId: 'pachinko',
      seed,
      source: 'pachinko',
      label: resolved.reward.name,
      route: [`slot:${resolved.reward.id}`],
      expectedValueCost: resolved.reward.rarePlusBonus,
      jackpot: resolved.reward.rarity === 'legendary',
      modifier: {
        id: `pachinko_ten_pull_modifier:${seed}:${resolved.reward.id}`,
        source: 'pachinko',
        label: resolved.reward.name,
        poolId,
        appliesTo: 'tenPull',
        appliesToCost: 'paidOnly',
        rarePlusBonus: resolved.reward.rarePlusBonus
      },
      audit: resolved.audit
    }

    const record: PachinkoRecord = {
      timestamp: transactionTimestamp,
      poolId,
      modifier: resolved.reward,
      audit: resolved.audit
    }

    // 事务前内存快照（深拷贝，供完整回滚）。
    const prevOutcomes = [...probabilityStore.state.outcomes]
    const prevBudgetUsage = JSON.parse(JSON.stringify(probabilityStore.state.budgetUsage)) as typeof probabilityStore.state.budgetUsage
    const prevPendingModifiers = [...probabilityStore.state.pendingModifiers]
    const prevHistory = [...state.history]

    // 旧 raw 快照（getItem 抛错 → 普通 null，零 mutation）。
    let prevProbabilityRaw: string | null
    try {
      prevProbabilityRaw = localStorage.getItem(PROBABILITY_KEY)
      localStorage.getItem(PACHINKO_KEY)
    } catch {
      return null
    }

    function rollbackMemory() {
      probabilityStore.state.outcomes = prevOutcomes
      probabilityStore.state.budgetUsage = prevBudgetUsage
      probabilityStore.state.pendingModifiers = prevPendingModifiers
      state.history = prevHistory
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
        throw new Error('pachinko persistence rollback failed')
      }
      return null
    }

    const probabilityRaw = { key: PROBABILITY_KEY, previous: prevProbabilityRaw }

    // 内存提交：Probability 无写盘 outcome（预算拒绝 → 三字段与 history 完全不变）。
    if (!probabilityStore.applyChanceOutcomeInMemory(outcome, transactionTimestamp)) {
      return null
    }
    state.history.unshift(record)
    if (state.history.length > 20) state.history.pop()

    // 固定持久化顺序：Probability → Pachinko。
    try {
      probabilityStore.saveProbabilityData()
    } catch {
      return finalizeFailure([])
    }
    try {
      save()
    } catch {
      return finalizeFailure([probabilityRaw])
    }

    return record
  }

  function getPreviewAudit(seed?: number): ProbabilityAudit {
    return resolveModifier({ seed }).audit
  }

  load()

  return {
    state,
    playShot,
    getPreviewAudit
  }
})
