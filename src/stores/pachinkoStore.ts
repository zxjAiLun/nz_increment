import { defineStore } from 'pinia'
import { reactive } from 'vue'
import { PERMANENT_POOL_ID } from '../data/gachaPools'
import { PACHINKO_MODIFIERS, PACHINKO_RATES, type PachinkoModifierReward } from '../data/pachinko'
import { RewardResolver, SeededRng, type ProbabilityAudit } from '../systems/probability/rewardResolver'
import { useGachaStore } from './gachaStore'
import { useProbabilityStore } from './probabilityStore'

const PACHINKO_KEY = 'nz_pachinko_v1'

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

  function playShot(poolId: string = PERMANENT_POOL_ID, options: { seed?: number; rng?: () => number } = {}): PachinkoRecord {
    const gachaStore = useGachaStore()
    const probabilityStore = useProbabilityStore()
    const resolved = resolveModifier(options)
    gachaStore.addTenPullRarePlusBonus(poolId, resolved.reward.rarePlusBonus)
    const seed = String(options.seed ?? resolved.audit.seed ?? Date.now())
    probabilityStore.recordOutcome({
      gameId: 'pachinko',
      seed,
      source: 'pachinko',
      label: resolved.reward.name,
      route: [`slot:${resolved.reward.id}`],
      expectedValueCost: resolved.reward.rarePlusBonus,
      jackpot: resolved.reward.rarity === 'legendary',
      modifier: {
        id: `pachinko:${seed}:${resolved.reward.id}`,
        source: 'pachinko',
        label: resolved.reward.name,
        rarityBonus: { rare: resolved.reward.rarePlusBonus }
      },
      audit: resolved.audit
    })

    const record = {
      timestamp: Date.now(),
      poolId,
      modifier: resolved.reward,
      audit: resolved.audit
    }
    state.history.unshift(record)
    if (state.history.length > 20) state.history.pop()
    save()
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
