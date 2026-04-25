import type { Monster, Player, PlayerStats } from '../../types'
import { calculateArmorReduction, calculateDefenseK, calculateReducedDamage, rollHit } from '../../utils/calc'

export type RNG = () => number

export type CombatContext = {
  difficulty: number
  rng: RNG
}

export type DamageSourceType = 'basic' | 'skill' | 'detonate' | 'dot' | 'pet' | 'boss'

export type DamageSource = {
  type: DamageSourceType
  name: string
  baseMultiplier?: number
  hitCount?: number
  canCrit?: boolean
  ignoreDefense?: boolean
  defenseIgnorePercent?: number
  trueDamage?: number
  voidDamage?: number
}

export type DamagePostMultiplier = {
  label: string
  multiplier: number
}

export type DamageStep = {
  label: string
  value: string
}

export type DamageHitResult = {
  hit: boolean
  crit: boolean
  baseDamage: number
  afterCrit: number
  afterBonus: number
  armorReduction: number
  afterArmor: number
}

export type DamageResult = {
  amount: number
  hit: boolean
  crit: boolean
  rawDamage: number
  afterBonus: number
  armorReduction: number
  trueDamage: number
  voidDamage: number
  elementMultiplier: number
  source: DamageSource
  hits: DamageHitResult[]
  postMultipliers: Array<{
    label: string
    multiplier: number
    before: number
    after: number
  }>
  steps: DamageStep[]
}

export type ApplyDamageResult = {
  requestedDamage: number
  shieldDamage: number
  hpDamage: number
  healed: number
  killed: boolean
}

type PlayerDamageParams = {
  player: Player
  totalStats: PlayerStats
  monster: Monster
  source: DamageSource
  context: CombatContext
  extraDamageBonusPercent?: number
  bossDamageBonusPercent?: number
  postMultipliers?: DamagePostMultiplier[]
}

type MonsterDamageParams = {
  monster: Monster
  player: Player
  totalStats: PlayerStats
  source: DamageSource
  context: CombatContext
  postMultipliers?: DamagePostMultiplier[]
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function stat(value: number | undefined): number {
  return value ?? 0
}

function formatNumber(value: number): string {
  return Math.floor(value).toString()
}

function formatMultiplier(value: number): string {
  return Number.isInteger(value) ? value.toString() : value.toFixed(2)
}

function normalizeSource(source: DamageSource): Required<DamageSource> {
  return {
    type: source.type,
    name: source.name,
    baseMultiplier: source.baseMultiplier ?? 1,
    hitCount: Math.max(1, Math.floor(source.hitCount ?? 1)),
    canCrit: source.canCrit ?? (source.type !== 'dot' && source.type !== 'pet'),
    ignoreDefense: source.ignoreDefense ?? false,
    defenseIgnorePercent: source.defenseIgnorePercent ?? 0,
    trueDamage: source.trueDamage ?? 0,
    voidDamage: source.voidDamage ?? 0
  }
}

function getDefenseIgnorePercent(source: Required<DamageSource>): number {
  if (source.ignoreDefense) return 100
  return clamp(source.defenseIgnorePercent, 0, 100)
}

function createMissResult(source: DamageSource, rawDamage: number, steps: DamageStep[]): DamageResult {
  return {
    amount: 0,
    hit: false,
    crit: false,
    rawDamage,
    afterBonus: 0,
    armorReduction: 0,
    trueDamage: 0,
    voidDamage: 0,
    elementMultiplier: 1,
    source,
    hits: [],
    postMultipliers: [],
    steps: [...steps, { label: '最终伤害', value: '0' }]
  }
}

function applyPostMultipliers(damage: number, multipliers: DamagePostMultiplier[] = []): {
  damage: number
  applied: DamageResult['postMultipliers']
  steps: DamageStep[]
} {
  const applied: DamageResult['postMultipliers'] = []
  const steps: DamageStep[] = []
  let current = damage

  for (const item of multipliers) {
    const before = current
    current = Math.floor(current * item.multiplier)
    applied.push({ label: item.label, multiplier: item.multiplier, before, after: current })
    steps.push({ label: item.label, value: `×${formatMultiplier(item.multiplier)} → ${formatNumber(current)}` })
  }

  return { damage: current, applied, steps }
}

export function calculatePlayerDamageFromSource(params: PlayerDamageParams): DamageResult {
  const source = normalizeSource(params.source)
  const rng = params.context.rng
  const rawDamage = params.totalStats.attack
  const perHitBase = rawDamage * source.baseMultiplier
  const steps: DamageStep[] = [
    { label: '来源', value: source.name },
    { label: '基础攻击', value: formatNumber(rawDamage) },
    { label: '基础倍率', value: `×${formatMultiplier(source.baseMultiplier)} × ${source.hitCount}段` }
  ]

  const damageBonus = stat(params.totalStats.damageBonusI) + stat(params.totalStats.damageBonusII) + stat(params.totalStats.damageBonusIII)
    + ((source.type === 'skill' || source.type === 'detonate') ? stat(params.totalStats.skillDamageBonus) : 0)
    + (params.extraDamageBonusPercent ?? 0)
  const ignorePercent = getDefenseIgnorePercent(source)
  const effectiveDefense = params.monster.defense * (1 - ignorePercent / 100)
  const defenseAfterPenetration = Math.max(0, effectiveDefense - stat(params.totalStats.penetration))
  const armorReduction = source.ignoreDefense ? 0 : calculateArmorReduction(defenseAfterPenetration, params.context.difficulty)
  const critChance = clamp(stat(params.totalStats.critRate) - stat(params.monster.critResist) * 0.5, 0, 80)
  const critMultiplier = Math.max(1.2, stat(params.totalStats.critDamage) / 100 - stat(params.monster.critResist) * 0.2)
  const hits: DamageHitResult[] = []
  let hitCount = 0
  let critCount = 0
  let damage = 0
  let afterBonusTotal = 0

  for (let i = 0; i < source.hitCount; i++) {
    const didHit = rollHit(stat(params.totalStats.accuracy), stat(params.monster.dodge), rng)
    if (!didHit) {
      hits.push({ hit: false, crit: false, baseDamage: perHitBase, afterCrit: 0, afterBonus: 0, armorReduction: 0, afterArmor: 0 })
      continue
    }

    hitCount++
    const didCrit = source.canCrit && rng() * 100 < critChance
    if (didCrit) critCount++
    const afterCrit = didCrit ? perHitBase * critMultiplier : perHitBase
    const afterBonus = afterCrit * (1 + damageBonus / 100)
    const afterArmor = Math.max(afterBonus * (1 - armorReduction), perHitBase * 0.1)
    afterBonusTotal += afterBonus
    damage += afterArmor
    hits.push({ hit: true, crit: didCrit, baseDamage: perHitBase, afterCrit, afterBonus, armorReduction, afterArmor })
  }

  steps.push({ label: '命中', value: `命中 ${hitCount}/${source.hitCount}，暴击 ${critCount} 次` })
  if (critCount > 0) steps.push({ label: '暴击', value: `${critCount} 次 ×${formatMultiplier(critMultiplier)}` })
  else steps.push({ label: '暴击', value: source.canCrit ? '未触发' : '不可暴击' })
  steps.push({ label: '伤害加成', value: `+${Math.round(damageBonus)}% → ${formatNumber(afterBonusTotal)}` })
  steps.push({ label: '护甲减免', value: `-${Math.round(armorReduction * 100)}% → ${formatNumber(damage)}` })

  if (hitCount === 0) return createMissResult(source, rawDamage, steps)

  const trueDamage = stat(params.totalStats.trueDamage) + source.trueDamage
  const voidDamage = stat(params.totalStats.voidDamage) + source.voidDamage
  if (trueDamage > 0) steps.push({ label: '真伤', value: `+${formatNumber(trueDamage)}` })
  if (voidDamage > 0) steps.push({ label: '虚空伤害', value: `+${formatNumber(voidDamage)}` })
  damage += trueDamage + voidDamage

  const postMultipliers = [...(params.postMultipliers ?? [])]
  if (params.monster.isBoss && (params.bossDamageBonusPercent ?? 0) > 0) {
    postMultipliers.push({ label: 'Boss增伤', multiplier: 1 + (params.bossDamageBonusPercent ?? 0) / 100 })
  }
  const post = applyPostMultipliers(damage, postMultipliers)
  damage = post.damage
  steps.push(...post.steps)
  steps.push({ label: '最终伤害', value: formatNumber(damage) })

  return {
    amount: Math.floor(damage),
    hit: true,
    crit: critCount > 0,
    rawDamage,
    afterBonus: afterBonusTotal,
    armorReduction,
    trueDamage,
    voidDamage,
    elementMultiplier: 1,
    source,
    hits,
    postMultipliers: post.applied,
    steps
  }
}

export function calculateMonsterDamageFromSource(params: MonsterDamageParams): DamageResult {
  const source = normalizeSource(params.source)
  const rng = params.context.rng
  const rawDamage = params.monster.attack
  const perHitBase = rawDamage * source.baseMultiplier
  const steps: DamageStep[] = [
    { label: '来源', value: source.name },
    { label: '基础攻击', value: formatNumber(rawDamage) },
    { label: '基础倍率', value: `×${formatMultiplier(source.baseMultiplier)} × ${source.hitCount}段` }
  ]
  const effectiveDefense = Math.max(0, stat(params.totalStats.defense) - stat(params.monster.penetration))
  const armorReduction = calculateArmorReduction(effectiveDefense, params.context.difficulty)
  const critChance = clamp(stat(params.monster.critRate) - stat(params.totalStats.critResist) * 0.5, 0, 80)
  const critMultiplier = Math.max(1.2, stat(params.monster.critDamage) / 100 - stat(params.totalStats.critResist) * 0.2)
  const hits: DamageHitResult[] = []
  let hitCount = 0
  let critCount = 0
  let damage = 0
  let afterBonusTotal = 0

  for (let i = 0; i < source.hitCount; i++) {
    const didHit = rollHit(stat(params.monster.accuracy), stat(params.totalStats.dodge), rng)
    if (!didHit) {
      hits.push({ hit: false, crit: false, baseDamage: perHitBase, afterCrit: 0, afterBonus: 0, armorReduction: 0, afterArmor: 0 })
      continue
    }

    hitCount++
    const didCrit = source.canCrit && rng() * 100 < critChance
    if (didCrit) critCount++
    const afterCrit = didCrit ? perHitBase * critMultiplier : perHitBase
    const afterBonus = afterCrit
    const afterArmor = Math.max(afterBonus * (1 - armorReduction), perHitBase * 0.1)
    afterBonusTotal += afterBonus
    damage += afterArmor
    hits.push({ hit: true, crit: didCrit, baseDamage: perHitBase, afterCrit, afterBonus, armorReduction, afterArmor })
  }

  steps.push({ label: '命中', value: `命中 ${hitCount}/${source.hitCount}，暴击 ${critCount} 次` })
  if (critCount > 0) steps.push({ label: '暴击', value: `${critCount} 次 ×${formatMultiplier(critMultiplier)}` })
  else steps.push({ label: '暴击', value: source.canCrit ? '未触发' : '不可暴击' })
  steps.push({ label: '护甲减免', value: `-${Math.round(armorReduction * 100)}% → ${formatNumber(damage)}` })

  if (hitCount === 0) return createMissResult(source, rawDamage, steps)

  const trueDamage = source.trueDamage
  const voidDamage = source.voidDamage
  damage += trueDamage + voidDamage
  if (trueDamage > 0) steps.push({ label: '真伤', value: `+${formatNumber(trueDamage)}` })
  if (voidDamage > 0) steps.push({ label: '虚空伤害', value: `+${formatNumber(voidDamage)}` })

  const post = applyPostMultipliers(damage, params.postMultipliers)
  damage = post.damage
  steps.push(...post.steps)
  steps.push({ label: '最终伤害', value: formatNumber(damage) })

  return {
    amount: Math.floor(damage),
    hit: true,
    crit: critCount > 0,
    rawDamage,
    afterBonus: afterBonusTotal,
    armorReduction,
    trueDamage,
    voidDamage,
    elementMultiplier: 1,
    source,
    hits,
    postMultipliers: post.applied,
    steps
  }
}

export function applyDamageToMonster(params: { monster: Monster; damage: number }): ApplyDamageResult {
  const requestedDamage = Math.max(0, Math.floor(params.damage))
  let remainingDamage = requestedDamage
  let shieldDamage = 0
  let healed = 0

  if (params.monster.bossState && params.monster.bossState.shield > 0) {
    shieldDamage = Math.min(remainingDamage, params.monster.bossState.shield)
    params.monster.bossState.shield -= shieldDamage
    remainingDamage -= shieldDamage
  }

  const hpDamage = Math.min(remainingDamage, Math.max(0, params.monster.currentHp))
  params.monster.currentHp -= remainingDamage

  const mechanic = params.monster.bossMechanic
  const state = params.monster.bossState
  if (
    mechanic?.id === 'lifesteal' &&
    state &&
    !state.healedOnce &&
    params.monster.currentHp > 0 &&
    params.monster.currentHp <= params.monster.maxHp * (mechanic.healThreshold ?? 0)
  ) {
    healed = Math.floor(params.monster.maxHp * (mechanic.healPercent ?? 0))
    params.monster.currentHp = Math.min(params.monster.maxHp, params.monster.currentHp + healed)
    state.healedOnce = true
  }

  return {
    requestedDamage,
    shieldDamage,
    hpDamage,
    healed,
    killed: params.monster.currentHp <= 0
  }
}

export { calculateArmorReduction, calculateDefenseK, calculateReducedDamage }
