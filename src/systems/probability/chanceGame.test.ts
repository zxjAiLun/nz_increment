import { describe, expect, it } from 'vitest'
import { createRarityBonusModifier } from './chanceGame'
import { formatProbabilityAuditRows } from './probabilityAudit'
import { toResolverModifier } from './probabilityModifier'
import { RewardResolver, SeededRng } from './rewardResolver'

const rewards = [
  { id: 'common', rarity: 'common' },
  { id: 'rare', rarity: 'rare' }
]

describe('chance game probability contract', () => {
  it('turns chance-game modifiers into displayable resolver modifiers', () => {
    const chanceModifier = createRarityBonusModifier({
      id: 'pachinko_rare_bonus',
      source: 'pachinko',
      label: '幸运槽 rare +5%',
      rarity: 'rare',
      bonus: 5
    })
    const resolverModifier = toResolverModifier(chanceModifier)
    const rng = new SeededRng(2026)
    const result = new RewardResolver(rewards, { common: 95, rare: 5 }, ['rare', 'common']).resolve({
      rng: rng.fn(),
      context: { pullNumber: 1 },
      modifiers: [resolverModifier],
      seed: 2026
    })

    expect(result.audit.modifiers).toContainEqual(expect.objectContaining({
      id: 'pachinko_rare_bonus',
      label: '幸运槽 rare +5%',
      active: true
    }))
    expect(result.audit.normalizedRates.rare).toBeGreaterThan(5)
  })

  it('formats audits with base rates, final rates, modifiers, and result reason', () => {
    const modifier = toResolverModifier(createRarityBonusModifier({
      id: 'pinball_bonus',
      source: 'pinball',
      label: '弹球 rare +10%',
      rarity: 'rare',
      bonus: 10
    }))
    const rng = new SeededRng(7)
    const result = new RewardResolver(rewards, { common: 95, rare: 5 }, ['rare', 'common']).resolve({
      rng: rng.fn(),
      context: { pullNumber: 1 },
      modifiers: [modifier]
    })
    const rows = formatProbabilityAuditRows(result.audit)

    expect(rows).toContainEqual(expect.objectContaining({ label: '基础rare率', value: '5.00%' }))
    expect(rows).toContainEqual(expect.objectContaining({ label: '弹球 rare +10%' }))
    expect(rows).toContainEqual(expect.objectContaining({ label: '最终rare率' }))
    expect(rows).toContainEqual(expect.objectContaining({ label: '结果原因' }))
  })
})
