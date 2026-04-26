export type RarityRateMap = Record<string, number>

export interface WeightedReward {
  id: string
  rarity: string
}

export interface ProbabilityModifierContext {
  pullNumber: number
}

export interface ProbabilityModifierDisplay {
  id: string
  label: string
  description: string
  active: boolean
}

export interface ProbabilityAuditStep {
  label: string
  rates: RarityRateMap
  modifier?: ProbabilityModifierDisplay
}

export interface ProbabilityAudit {
  seed?: number
  roll: number
  normalizedRates: RarityRateMap
  selectedRarity: string
  selectedRewardId: string
  modifiers: ProbabilityModifierDisplay[]
  steps: ProbabilityAuditStep[]
}

export interface ResolveRewardResult<T extends WeightedReward> {
  reward: T
  rarity: string
  audit: ProbabilityAudit
}

export interface ProbabilityModifier {
  id: string
  label: string
  description: string
  apply(rates: RarityRateMap, context: ProbabilityModifierContext): RarityRateMap
  isActive?(context: ProbabilityModifierContext): boolean
}

export class SeededRng {
  private state: number
  readonly seed: number

  constructor(seed: number) {
    this.seed = seed >>> 0
    this.state = this.seed
  }

  next(): number {
    this.state = (1664525 * this.state + 1013904223) >>> 0
    return this.state / 0x100000000
  }

  fn(): () => number {
    return () => this.next()
  }
}

export function normalizeRates(rates: RarityRateMap): RarityRateMap {
  const positiveEntries = Object.entries(rates).map(([rarity, value]) => [rarity, Math.max(0, value)] as const)
  const total = positiveEntries.reduce((sum, [, value]) => sum + value, 0)
  if (total <= 0) {
    const equal = positiveEntries.length > 0 ? 100 / positiveEntries.length : 0
    return Object.fromEntries(positiveEntries.map(([rarity]) => [rarity, equal]))
  }
  return Object.fromEntries(positiveEntries.map(([rarity, value]) => [rarity, value / total * 100]))
}

function cloneRates(rates: RarityRateMap): RarityRateMap {
  return Object.fromEntries(Object.entries(rates).map(([rarity, value]) => [rarity, value]))
}

export class PityResolver {
  constructor(
    private readonly target: number,
    private readonly softPity: number,
    private readonly rarity: string = 'legendary',
    private readonly softBonusPerPull = 2
  ) {}

  getModifiers(pullNumber: number): ProbabilityModifier[] {
    const modifiers: ProbabilityModifier[] = []
    if (pullNumber >= this.target) {
      modifiers.push({
        id: 'hard_pity',
        label: '硬保底',
        description: `第 ${this.target} 抽必出${this.rarity}`,
        isActive: () => true,
        apply: rates => {
          const next = Object.fromEntries(Object.keys(rates).map(rarity => [rarity, 0]))
          next[this.rarity] = 100
          return next
        }
      })
      return modifiers
    }

    if (pullNumber >= this.softPity) {
      const bonus = Math.max(0, pullNumber - this.softPity) * this.softBonusPerPull
      modifiers.push({
        id: 'soft_pity',
        label: '软保底',
        description: `当前第 ${pullNumber} 抽，${this.rarity} 概率 +${bonus}%`,
        isActive: () => bonus > 0,
        apply: rates => ({
          ...rates,
          [this.rarity]: (rates[this.rarity] ?? 0) + bonus
        })
      })
    }

    return modifiers
  }

  nextCounter(currentCounter: number, rewardRarity: string): number {
    return rewardRarity === this.rarity ? 0 : currentCounter + 1
  }
}

export class RewardResolver<T extends WeightedReward> {
  constructor(
    private readonly rewards: T[],
    private readonly baseRates: RarityRateMap,
    private readonly rarityOrder: string[] = Object.keys(baseRates)
  ) {}

  resolve(params: {
    rng: () => number
    context: ProbabilityModifierContext
    modifiers?: ProbabilityModifier[]
    seed?: number
  }): ResolveRewardResult<T> {
    let rates = cloneRates(this.baseRates)
    const steps: ProbabilityAuditStep[] = [{ label: '基础概率', rates: normalizeRates(rates) }]
    const displays: ProbabilityModifierDisplay[] = []

    for (const modifier of params.modifiers ?? []) {
      const active = modifier.isActive ? modifier.isActive(params.context) : true
      const display = {
        id: modifier.id,
        label: modifier.label,
        description: modifier.description,
        active
      }
      displays.push(display)
      if (!active) continue

      rates = normalizeRates(modifier.apply(rates, params.context))
      steps.push({ label: modifier.label, rates: cloneRates(rates), modifier: display })
    }

    const normalizedRates = normalizeRates(rates)
    const roll = params.rng() * 100
    let cumulative = 0
    let selectedRarity = this.rarityOrder[this.rarityOrder.length - 1] ?? Object.keys(normalizedRates)[0]

    for (const rarity of this.rarityOrder) {
      cumulative += normalizedRates[rarity] ?? 0
      if (roll < cumulative) {
        selectedRarity = rarity
        break
      }
    }

    const matchingRewards = this.rewards.filter(reward => reward.rarity === selectedRarity)
    const rewardPool = matchingRewards.length > 0 ? matchingRewards : this.rewards
    const reward = rewardPool[Math.floor(params.rng() * rewardPool.length)] ?? this.rewards[0]
    if (!reward) throw new Error('RewardResolver requires at least one reward')

    return {
      reward,
      rarity: selectedRarity,
      audit: {
        seed: params.seed,
        roll,
        normalizedRates,
        selectedRarity,
        selectedRewardId: reward.id,
        modifiers: displays,
        steps
      }
    }
  }
}
