export type {
  ProbabilityAudit,
  ProbabilityAuditStep,
  ProbabilityModifierDisplay
} from './probability'

export function formatProbabilityAuditRows(audit: import('./probability').ProbabilityAudit | null): Array<{ label: string; value: string }> {
  if (!audit) return []
  const baseRates = audit.steps[0]?.rates ?? {}
  const rows: Array<{ label: string; value: string }> = []
  for (const [rarity, rate] of Object.entries(baseRates)) {
    rows.push({ label: `基础${rarity}率`, value: `${rate.toFixed(2)}%` })
  }
  for (const modifier of audit.modifiers) {
    rows.push({ label: modifier.label, value: modifier.active ? modifier.description : '未生效' })
  }
  for (const [rarity, rate] of Object.entries(audit.normalizedRates)) {
    rows.push({ label: `最终${rarity}率`, value: `${rate.toFixed(2)}%` })
  }
  rows.push({ label: '本次roll', value: audit.roll.toFixed(4) })
  rows.push({ label: '结果原因', value: `roll 落入 ${audit.selectedRarity} 区间，命中奖励 ${audit.selectedRewardId}` })
  return rows
}
