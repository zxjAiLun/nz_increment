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

// Phase 3.72：nz_pachinko_v1 安全 hydration 专用 fail-closed 规范化 helper。
// Audit 校验合同与 LuckyWheel hydration 保持一致（同构规则，不新造语义）。
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isValidModifierDisplay(value: unknown): boolean {
  if (!isPlainObject(value)) return false
  return typeof value.id === 'string' &&
    typeof value.label === 'string' &&
    typeof value.description === 'string' &&
    typeof value.active === 'boolean'
}

function isValidAuditStep(value: unknown): boolean {
  if (!isPlainObject(value)) return false
  if (typeof value.label !== 'string') return false
  if (!isPlainObject(value.rates)) return false
  for (const rate of Object.values(value.rates)) {
    if (typeof rate !== 'number' || !Number.isFinite(rate)) return false
  }
  if (value.modifier !== undefined && !isValidModifierDisplay(value.modifier)) return false
  return true
}

/** audit 满足 ProbabilityAudit 安全结构（含嵌套 modifiers/steps）。 */
function isValidAudit(value: unknown): value is ProbabilityAudit {
  if (!isPlainObject(value)) return false
  if (typeof value.roll !== 'number' || !Number.isFinite(value.roll)) return false
  if (!isPlainObject(value.normalizedRates)) return false
  for (const rate of Object.values(value.normalizedRates)) {
    if (typeof rate !== 'number' || !Number.isFinite(rate)) return false
  }
  if (typeof value.selectedRarity !== 'string') return false
  if (typeof value.selectedRewardId !== 'string') return false
  if (!Array.isArray(value.modifiers) || !value.modifiers.every(isValidModifierDisplay)) return false
  if (!Array.isArray(value.steps) || !value.steps.every(isValidAuditStep)) return false
  if (value.seed !== undefined && !Number.isFinite(value.seed)) return false
  return true
}

/** 仅保留可经 canonical modifier 重建且 audit 跨字段一致的 record。 */
function normalizePachinkoRecord(value: unknown): PachinkoRecord | null {
  if (!isPlainObject(value)) return null
  if (!Number.isSafeInteger(value.timestamp) || (value.timestamp as number) <= 0) return null
  if (typeof value.poolId !== 'string' || value.poolId === '') return null
  const modifierValue = value.modifier
  if (!isPlainObject(modifierValue) || typeof modifierValue.id !== 'string') return null
  const modifier = PACHINKO_MODIFIERS.find(m => m.id === modifierValue.id)
  if (!modifier) return null // 未知 id 直接丢弃，不按 audit 推导或改写
  const auditValue = value.audit
  if (!isValidAudit(auditValue)) return null
  if (auditValue.selectedRewardId !== modifier.id) return null
  if (auditValue.selectedRarity !== modifier.rarity) return null
  return {
    timestamp: value.timestamp as number,
    poolId: value.poolId as string,
    modifier, // 用当前表中的 canonical modifier 重建，不信任 raw 副本
    audit: auditValue
  }
}

function normalizeHistory(value: unknown): PachinkoRecord[] {
  if (!Array.isArray(value)) return []
  const result: PachinkoRecord[] = []
  for (const entry of value) {
    if (result.length >= 20) break
    const normalized = normalizePachinkoRecord(entry)
    if (normalized) result.push(normalized)
  }
  return result
}

export const usePachinkoStore = defineStore('pachinko', () => {
  const state = reactive<PachinkoState>({
    history: []
  })

  function load() {
    let candidate = {
      history: [] as PachinkoRecord[]
    }
    try {
      const saved = localStorage.getItem(PACHINKO_KEY)
      if (saved) {
        const parsed: unknown = JSON.parse(saved)
        if (isPlainObject(parsed)) {
          candidate = {
            history: normalizeHistory(parsed.history)
          }
        }
      }
    } catch {
      // getItem / JSON.parse / normalization 异常 → 保持默认 candidate
    }
    // Phase 3.72：完整 candidate 一次性提交；不写盘、不删除原 raw。
    state.history = candidate.history
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
