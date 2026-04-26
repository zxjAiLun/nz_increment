import type { Equipment, Monster, Player, PlayerStats, StatType } from '../types'
import type { MainlineUnlockStage } from '../types/navigation'
import { calculateArmorReduction, calculateLifesteal, calculateLifestealCap, calculateTotalStats } from './calc'
import { calculateBuildArchetypeScores } from '../data/buildArchetypes'
import { applyDamageToMonster, calculateMonsterDamageFromSource, calculatePlayerDamageFromSource, type CombatContext, type DamageSource } from '../systems/combat/damage'

export interface CombatKpis {
  difficulty: number
  normalTtkSeconds: number | null
  survivalSeconds: number | null
  bossSurvivalRate: number | null
}

export interface EquipmentImpactRow {
  label: string
  value: number
  suffix: string
  higherIsBetter: boolean
}

export interface EquipmentPrecisionMetrics {
  winRate: number
  averageTtkSeconds: number
  averageTtlSeconds: number
  deathRate: number
}

export interface EquipmentPrecisionComparison {
  current: EquipmentPrecisionMetrics
  next: EquipmentPrecisionMetrics
  deltaWinRate: number
  deltaTtkSeconds: number
  deltaTtlSeconds: number
  runs: number
}

export type MainlineGuidanceSeverity = 'good' | 'warning' | 'danger'

export interface MainlineGuidance {
  bottleneck: string
  recommendedAction: string
  nextGoal: string
  expectedBenefit: string
  severity: MainlineGuidanceSeverity
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function percentDelta(next: number, base: number): number {
  if (base <= 0) return next > 0 ? 100 : 0
  return ((next - base) / base) * 100
}

function createSeededRng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (1664525 * state + 1013904223) >>> 0
    return state / 0x100000000
  }
}

export function estimateExpectedPlayerHitDamage(stats: PlayerStats, monster: Monster, difficulty: number): number {
  const hitChance = clamp(0.85 + stats.accuracy * 0.005 - monster.dodge * 0.005, 0.05, 0.95)
  const critChance = clamp((stats.critRate - monster.critResist * 0.5) / 100, 0, 0.8)
  const critMult = Math.max(1.2, stats.critDamage / 100 - monster.critResist * 0.2)
  const bonusMult = 1 + (stats.damageBonusI + stats.damageBonusII + stats.damageBonusIII) / 100
  const effectiveDefense = Math.max(0, monster.defense - stats.penetration)
  const armorReduction = calculateArmorReduction(effectiveDefense, difficulty)
  const directDamage = stats.trueDamage + stats.voidDamage
  const averageDamage = stats.attack * (1 + critChance * (critMult - 1)) * bonusMult
  const reducedDamage = Math.max(averageDamage * (1 - armorReduction), stats.attack * 0.1)
  return Math.max(0, (reducedDamage + directDamage) * hitChance)
}

export function estimateExpectedMonsterHitDamage(monster: Monster, stats: PlayerStats, difficulty: number): number {
  const hitChance = clamp(0.85 + monster.accuracy * 0.005 - stats.dodge * 0.005, 0.05, 0.95)
  const critChance = clamp((monster.critRate - stats.critResist * 0.5) / 100, 0, 0.8)
  const critMult = Math.max(1.2, monster.critDamage / 100 - stats.critResist * 0.2)
  const effectiveDefense = Math.max(0, stats.defense - monster.penetration)
  const armorReduction = calculateArmorReduction(effectiveDefense, difficulty)
  const averageDamage = monster.attack * (1 + critChance * (critMult - 1))
  const reducedDamage = Math.max(averageDamage * (1 - armorReduction), monster.attack * 0.1)
  return Math.max(0, reducedDamage * hitChance)
}

export function estimateCombatKpis(player: Player, stats: PlayerStats, monster: Monster | null, difficulty: number): CombatKpis {
  if (!monster) {
    return { difficulty, normalTtkSeconds: null, survivalSeconds: null, bossSurvivalRate: null }
  }

  const playerAttacksPerSecond = Math.max(0.05, stats.speed / 100)
  const monsterAttacksPerSecond = Math.max(0.05, monster.speed / 100)
  const playerDps = estimateExpectedPlayerHitDamage(stats, monster, difficulty) * playerAttacksPerSecond
  const incomingDps = estimateExpectedMonsterHitDamage(monster, stats, difficulty) * monsterAttacksPerSecond
  const normalTtkSeconds = playerDps > 0 ? monster.currentHp / playerDps : null
  const survivalSeconds = incomingDps > 0 ? player.currentHp / incomingDps : null
  const bossSurvivalRate = normalTtkSeconds && survivalSeconds
    ? clamp((survivalSeconds / normalTtkSeconds) * 100, 0, 100)
    : null

  return { difficulty, normalTtkSeconds, survivalSeconds, bossSurvivalRate }
}


export function getMainlineGuidance(
  kpis: CombatKpis,
  nextUnlockStage: Pick<MainlineUnlockStage, 'minDifficulty' | 'title'> | null,
  stats: PlayerStats
): MainlineGuidance {
  const nextGoal = nextUnlockStage
    ? `难度 ${nextUnlockStage.minDifficulty} 解锁 ${nextUnlockStage.title}`
    : '已开放全部主线阶段，开始挑战专门玩法'

  if (kpis.bossSurvivalRate !== null && kpis.bossSurvivalRate < 50) {
    return {
      bottleneck: `Boss 生存率仅 ${Math.round(kpis.bossSurvivalRate)}%`,
      recommendedAction: stats.lifesteal > 0
        ? '强化生命 / 防御，并保留吸血词条维持续航'
        : '强化生命 / 防御，或装备吸血词条',
      nextGoal,
      expectedBenefit: '预计提升 Boss 容错率，减少刚见到 Boss 就阵亡的挫败感',
      severity: kpis.bossSurvivalRate < 35 ? 'danger' : 'warning'
    }
  }

  if (kpis.normalTtkSeconds !== null && kpis.normalTtkSeconds > 12) {
    return {
      bottleneck: `普通怪击杀偏慢，约 ${kpis.normalTtkSeconds.toFixed(1)} 秒/只`,
      recommendedAction: '优先替换高攻击武器，或强化攻击 / 暴击 / 速度',
      nextGoal,
      expectedBenefit: '预计提高金币与装备获取频率，让前 30 分钟节奏更连续',
      severity: kpis.normalTtkSeconds > 20 ? 'danger' : 'warning'
    }
  }

  if (kpis.survivalSeconds !== null && kpis.normalTtkSeconds !== null && kpis.survivalSeconds < kpis.normalTtkSeconds * 1.5) {
    return {
      bottleneck: `生存时间接近击杀时间，仅 ${kpis.survivalSeconds.toFixed(1)} 秒`,
      recommendedAction: '补生命 / 防御，再考虑吸血或闪避词条',
      nextGoal,
      expectedBenefit: '预计降低连续战斗翻车率，让挂机推进更稳定',
      severity: 'warning'
    }
  }

  if (kpis.difficulty < 10) {
    return {
      bottleneck: '暂无明显瓶颈，正在建立攻击、掉落、装备循环',
      recommendedAction: '击败怪物、穿上新装备，并把金币投入攻击或生命',
      nextGoal,
      expectedBenefit: '预计 5-10 分钟内遇到第一次 Boss 压力并解锁长期目标',
      severity: 'good'
    }
  }

  if (kpis.difficulty < 20) {
    return {
      bottleneck: '已进入首个长期目标阶段，需要把抽卡收益转化为养成',
      recommendedAction: '领取免费抽卡，投入命座/修炼，再回到主线验证提升',
      nextGoal,
      expectedBenefit: '预计获得稳定属性来源，避免只靠随机装备推进',
      severity: 'good'
    }
  }

  if (kpis.difficulty < 30) {
    return {
      bottleneck: '装备和伤害来源开始变多，需要明确构筑方向',
      recommendedAction: '配置技能，查看套装/加成，并用装备比较选择 DPS 或生存收益',
      nextGoal,
      expectedBenefit: '预计形成暴击、吸血坦克或破甲真伤等第一条构筑路线',
      severity: 'good'
    }
  }

  return {
    bottleneck: '主线 30 分钟核心体验已成型',
    recommendedAction: '使用自动构筑按推图、Boss 或挂机收益切换目标',
    nextGoal,
    expectedBenefit: '预计减少手动比较成本，把注意力转向构筑取舍',
    severity: 'good'
  }
}

function clonePlayerWithEquipment(player: Player, equipment: Equipment | null, baseline: Equipment | null): Player {
  return {
    ...player,
    equipment: {
      ...player.equipment,
      [baseline?.slot ?? equipment?.slot ?? 'weapon']: equipment ?? undefined
    }
  }
}

function getDpsProxy(stats: PlayerStats): number {
  const critMultiplier = 1 + clamp(stats.critRate / 100, 0, 0.8) * Math.max(0, stats.critDamage / 100 - 1)
  const damageBonus = 1 + (stats.damageBonusI + stats.damageBonusII + stats.damageBonusIII + stats.skillDamageBonus) / 100
  return stats.attack * critMultiplier * damageBonus * Math.max(0.2, stats.speed / 100)
}

function getSurvivalProxy(stats: PlayerStats): number {
  const mitigation = 1 + stats.defense / (stats.defense + 500)
  const avoidance = 1 + clamp(stats.dodge / 100, 0, 0.75)
  return stats.maxHp * mitigation * avoidance * (1 + stats.lifesteal / 100)
}

function getGoldPerMinuteProxy(stats: PlayerStats): number {
  return getDpsProxy(stats) * (1 + stats.luck * 0.004)
}

export function compareEquipmentImpact(player: Player, equipment: Equipment, compareTo?: Equipment | null): EquipmentImpactRow[] {
  const equippedInSlot = player.equipment[equipment.slot] ?? null
  const baselineEquipment = compareTo ?? (equippedInSlot?.id === equipment.id ? null : equippedInSlot)
  const baseStats = calculateTotalStats(clonePlayerWithEquipment(player, baselineEquipment, equipment))
  const nextStats = calculateTotalStats(clonePlayerWithEquipment(player, equipment, equipment))
  const baseScores = calculateBuildArchetypeScores(baseStats)
  const nextScores = calculateBuildArchetypeScores(nextStats)
  const critBase = baseScores.find(item => item.archetype.id === 'critBurst')?.score ?? 0
  const critNext = nextScores.find(item => item.archetype.id === 'critBurst')?.score ?? 0
  const tankBase = baseScores.find(item => item.archetype.id === 'lifestealTank')?.score ?? 0
  const tankNext = nextScores.find(item => item.archetype.id === 'lifestealTank')?.score ?? 0

  return [
    { label: 'DPS', value: percentDelta(getDpsProxy(nextStats), getDpsProxy(baseStats)), suffix: '%', higherIsBetter: true },
    { label: '生存时间', value: percentDelta(getSurvivalProxy(nextStats), getSurvivalProxy(baseStats)), suffix: '%', higherIsBetter: true },
    { label: '金币/分钟', value: percentDelta(getGoldPerMinuteProxy(nextStats), getGoldPerMinuteProxy(baseStats)), suffix: '%', higherIsBetter: true },
    { label: '暴击流评分', value: critNext - critBase, suffix: '', higherIsBetter: true },
    { label: '吸血坦克评分', value: tankNext - tankBase, suffix: '', higherIsBetter: true }
  ]
}

function cloneMonsterForSimulation(monster: Monster): Monster {
  return JSON.parse(JSON.stringify({
    ...monster,
    currentHp: Math.max(1, monster.currentHp || monster.maxHp)
  })) as Monster
}

function simulateEquipmentBattle(player: Player, stats: PlayerStats, monster: Monster, difficulty: number, seed: number): {
  killed: boolean
  duration: number
  remainingHp: number
} {
  const rng = createSeededRng(seed)
  const simMonster = cloneMonsterForSimulation(monster)
  let playerHp = Math.max(1, player.currentHp || stats.maxHp)
  let playerGauge = 0
  let monsterGauge = 0
  let elapsed = 0
  const maxSeconds = 120
  const tickSeconds = 0.1
  const gaugeMax = 100
  const gaugeRate = 10
  const playerSource: DamageSource = { type: 'basic', name: '装备比较普攻', baseMultiplier: 1, hitCount: 1, canCrit: true }
  const monsterSource: DamageSource = { type: simMonster.isBoss ? 'boss' : 'basic', name: `${simMonster.name} 攻击`, baseMultiplier: 1, hitCount: 1, canCrit: true }

  while (elapsed < maxSeconds && playerHp > 0 && simMonster.currentHp > 0) {
    elapsed += tickSeconds
    playerGauge += stats.speed * gaugeRate / 100
    monsterGauge += simMonster.speed * gaugeRate / 100

    if (playerGauge >= gaugeMax) {
      playerGauge -= gaugeMax
      const context: CombatContext = { difficulty, rng }
      const result = calculatePlayerDamageFromSource({
        player,
        totalStats: stats,
        monster: simMonster,
        source: playerSource,
        context
      })
      if (result.hit && result.amount > 0) {
        applyDamageToMonster({ monster: simMonster, damage: result.amount })
        const lifestealRate = calculateLifestealCap(stats.lifesteal)
        if (lifestealRate > 0) playerHp = Math.min(stats.maxHp, playerHp + calculateLifesteal(result.amount, lifestealRate))
      }
    }

    if (simMonster.currentHp <= 0) break

    if (monsterGauge >= gaugeMax) {
      monsterGauge -= gaugeMax
      const context: CombatContext = { difficulty, rng }
      const result = calculateMonsterDamageFromSource({
        monster: simMonster,
        player,
        totalStats: stats,
        source: monsterSource,
        context
      })
      playerHp -= result.amount
    }
  }

  return {
    killed: simMonster.currentHp <= 0,
    duration: elapsed,
    remainingHp: Math.max(0, playerHp)
  }
}

function runEquipmentPrecision(player: Player, stats: PlayerStats, monster: Monster, difficulty: number, runs: number, seedOffset: number): EquipmentPrecisionMetrics {
  let wins = 0
  let totalTtk = 0
  let totalTtl = 0

  for (let i = 0; i < runs; i++) {
    const result = simulateEquipmentBattle(player, stats, monster, difficulty, seedOffset + i)
    if (result.killed) {
      wins++
      totalTtk += result.duration
    }
    totalTtl += result.duration
  }

  return {
    winRate: wins / runs,
    averageTtkSeconds: wins > 0 ? totalTtk / wins : 120,
    averageTtlSeconds: totalTtl / runs,
    deathRate: 1 - wins / runs
  }
}

export function compareEquipmentPrecision(
  player: Player,
  equipment: Equipment,
  monster: Monster | null,
  difficulty: number,
  compareTo?: Equipment | null,
  runs = 100
): EquipmentPrecisionComparison | null {
  if (!monster || runs <= 0) return null

  const equippedInSlot = player.equipment[equipment.slot] ?? null
  const baselineEquipment = compareTo ?? (equippedInSlot?.id === equipment.id ? equipment : equippedInSlot)
  const currentPlayer = clonePlayerWithEquipment(player, baselineEquipment, equipment)
  const nextPlayer = clonePlayerWithEquipment(player, equipment, equipment)
  const currentStats = calculateTotalStats(currentPlayer)
  const nextStats = calculateTotalStats(nextPlayer)
  const normalizedRuns = Math.max(10, Math.floor(runs))
  const current = runEquipmentPrecision(currentPlayer, currentStats, monster, difficulty, normalizedRuns, 91_000)
  const next = runEquipmentPrecision(nextPlayer, nextStats, monster, difficulty, normalizedRuns, 91_000)

  return {
    current,
    next,
    deltaWinRate: (next.winRate - current.winRate) * 100,
    deltaTtkSeconds: current.averageTtkSeconds - next.averageTtkSeconds,
    deltaTtlSeconds: next.averageTtlSeconds - current.averageTtlSeconds,
    runs: normalizedRuns
  }
}


export interface StatUpgradeRecommendation {
  stat: StatType
  label: string
  reason: string
  cost: number
  dpsDelta: number
  survivalDelta: number
  goldDelta: number
  score: number
}

export interface EquipmentDecisionSummary {
  dpsProxy: number
  survivalProxy: number
  goldPerMinuteProxy: number
  topBuildScores: Array<{ id: string; name: string; percent: number }>
}

export interface ChallengeDecisionHint {
  failureReason: string
  recommendedBuild: string
  recommendedStats: StatType[]
  expectedFix: string
  severity: MainlineGuidanceSeverity
}

export interface GachaDecisionHint {
  pityText: string
  freeText: string
  targetText: string
  archetypeBoosts: Array<{ archetype: string; impact: string }>
}

const STAT_LABELS: Partial<Record<StatType, string>> = {
  attack: '攻击',
  defense: '防御',
  maxHp: '生命',
  speed: '速度',
  penetration: '穿透',
  critRate: '暴击',
  critDamage: '暴伤',
  lifesteal: '吸血',
  luck: '幸运'
}

function cloneStatsWithDelta(stats: PlayerStats, stat: StatType, delta: number): PlayerStats {
  return { ...stats, [stat]: (stats[stat] || 0) + delta }
}

export function getEquipmentDecisionSummary(stats: PlayerStats): EquipmentDecisionSummary {
  return {
    dpsProxy: getDpsProxy(stats),
    survivalProxy: getSurvivalProxy(stats),
    goldPerMinuteProxy: getGoldPerMinuteProxy(stats),
    topBuildScores: calculateBuildArchetypeScores(stats).slice(0, 3).map(item => ({
      id: item.archetype.id,
      name: item.archetype.shortName,
      percent: item.percent
    }))
  }
}

export function recommendStatUpgrades(
  stats: PlayerStats,
  upgradeableStats: StatType[],
  getCost: (stat: StatType) => number,
  getDelta: (stat: StatType) => number,
  canUpgrade: (stat: StatType) => boolean
): StatUpgradeRecommendation[] {
  const baseDps = getDpsProxy(stats)
  const baseSurvival = getSurvivalProxy(stats)
  const baseGold = getGoldPerMinuteProxy(stats)

  return upgradeableStats
    .filter(canUpgrade)
    .map(stat => {
      const cost = Math.max(1, getCost(stat))
      const next = cloneStatsWithDelta(stats, stat, getDelta(stat))
      const dpsDelta = percentDelta(getDpsProxy(next), baseDps)
      const survivalDelta = percentDelta(getSurvivalProxy(next), baseSurvival)
      const goldDelta = percentDelta(getGoldPerMinuteProxy(next), baseGold)
      const score = (dpsDelta * 1.1 + survivalDelta + goldDelta * 0.55) / Math.log10(cost + 10)
      const primary = dpsDelta >= survivalDelta && dpsDelta >= goldDelta
        ? '提升击杀速度'
        : survivalDelta >= goldDelta
          ? '提升生存时间'
          : '提升每分钟收益'
      return {
        stat,
        label: STAT_LABELS[stat] ?? stat,
        reason: `${primary}，单位金币效率 ${score.toFixed(2)}`,
        cost,
        dpsDelta,
        survivalDelta,
        goldDelta,
        score
      }
    })
    .sort((a, b) => b.score - a.score)
}

export function getChallengeDecisionHint(kpis: CombatKpis, dominantBuildName: string): ChallengeDecisionHint {
  if (kpis.bossSurvivalRate !== null && kpis.bossSurvivalRate < 55) {
    return {
      failureReason: `Boss 生存率偏低（${Math.round(kpis.bossSurvivalRate)}%），主要风险是扛不住爆发。`,
      recommendedBuild: '吸血坦克流',
      recommendedStats: ['maxHp', 'defense', 'lifesteal'],
      expectedFix: '提高 TTL 与回血能力，先保证能活过 Boss 关键机制。',
      severity: kpis.bossSurvivalRate < 35 ? 'danger' : 'warning'
    }
  }

  if (kpis.normalTtkSeconds !== null && kpis.normalTtkSeconds > 18) {
    return {
      failureReason: `击杀时间偏长（${kpis.normalTtkSeconds.toFixed(1)}s），挑战中容易超时或被机制拖死。`,
      recommendedBuild: '暴击爆发流 / 极速技能流',
      recommendedStats: ['attack', 'critRate', 'critDamage', 'speed', 'skillDamageBonus'],
      expectedFix: '提高 DPS 与出手频率，缩短机制循环次数。',
      severity: kpis.normalTtkSeconds > 30 ? 'danger' : 'warning'
    }
  }

  return {
    failureReason: `当前 ${dominantBuildName} 没有明显硬伤，失败多半来自机制不匹配。`,
    recommendedBuild: '按 Boss 机制切换：高防选破甲，护盾选极速，高闪避补命中。',
    recommendedStats: ['penetration', 'trueDamage', 'speed', 'accuracy'],
    expectedFix: '根据挑战词缀调整构筑，而不是只堆战力。',
    severity: 'good'
  }
}

export function getGachaDecisionHint(
  poolName: string,
  pity: { current: number; target: number; bonus: boolean },
  canClaimFree: boolean
): GachaDecisionHint {
  const remaining = Math.max(0, pity.target - pity.current)
  const isAbyssPool = poolName.includes('深渊') || poolName.includes('限定')
  return {
    pityText: pity.bonus
      ? `已进入软保底区，距离硬保底 ${remaining} 抽。`
      : `距离硬保底 ${remaining} 抽，${Math.max(0, 80 - pity.current)} 抽后进入软保底。`,
    freeText: canClaimFree ? '今日免费抽可用：不扣钻，仍推进保底。' : '今日免费抽已领取：继续抽会消耗钻石。',
    targetText: isAbyssPool
      ? '目标：深渊征服者资源，主要提升破甲真伤流与高防 Boss 对策。'
      : '目标：技能书与通用碎片，主要提升极速技能流和暴击爆发流启动速度。',
    archetypeBoosts: isAbyssPool
      ? [
          { archetype: '破甲真伤流', impact: '穿透 / 真伤资源更集中' },
          { archetype: '吸血坦克流', impact: '被动碎片提供长期防守补强' }
        ]
      : [
          { archetype: '极速技能流', impact: '技能书缩短技能循环成型时间' },
          { archetype: '暴击爆发流', impact: '暴击碎片提升推图爆发' }
        ]
  }
}
