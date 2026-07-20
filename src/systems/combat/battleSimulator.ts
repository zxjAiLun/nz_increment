import type { Monster, Player, PlayerStats, Rarity, Skill, StatType } from '../../types'
import { createDefaultPlayer, calculateLifestealCap, calculateAppliedLifesteal, calculateLuckEffects } from '../../utils/calc'
import { applyLuckCombatEffects, rollKillDrops } from '../../utils/luck'
import { calculateMonsterDamageFromSource, calculatePlayerDamageFromSource, applyDamageToMonster, type CombatContext, type DamagePostMultiplier, type DamageSource } from './damage'
import { advanceCombatTimeline } from './combatClock'
import { generateMonster } from '../../utils/monsterGenerator'
import { getSkillById, getSkillBuffEffects, selectAutoSkill, type SelectedAutoSkill } from '../../utils/skillSystem'
import { STAT_POOLS } from '../../utils/equipmentGenerator'

export type BalanceBattleType = 'normal' | 'boss' | 'highDefenseBoss' | 'highDodgeBoss'
export type BalanceBuildType = 'balanced' | 'crit' | 'tank' | 'armor' | 'speedSkill' | 'luck'
export type BalanceGuardrailStatus = 'pass' | 'warn' | 'fail'

export type BalanceFailureReason =
  | 'none'
  | 'normal_ttk_too_long'
  | 'boss_win_rate_too_low'
  | 'crit_too_strong_vs_high_defense'
  | 'accuracy_not_required_vs_high_dodge'
  | 'luck_income_out_of_band'
  | 'luck_boss_tradeoff_too_low'
  | 'luck_build_best_combat_income'
  | 'boss_challenge_too_low'
  | 'non_armor_too_strong_vs_high_defense'
  | 'speed_skill_dominates_bosses'

export type RecommendedStat =
  | 'none'
  | 'attack'
  | 'critRate'
  | 'critDamage'
  | 'speed'
  | 'maxHp'
  | 'defense'
  | 'lifesteal'
  | 'penetration'
  | 'trueDamage'
  | 'voidDamage'
  | 'accuracy'
  | 'luckRewardScaling'
  | 'combatPowerTradeoff'

export interface BalanceGuardrailFinding {
  status: BalanceGuardrailStatus
  reason: BalanceFailureReason
  recommendedStat: RecommendedStat
  message: string
  difficulty?: number
  buildType?: BalanceBuildType
  battleType?: BalanceBattleType
}

export interface BalanceGuardrailSummary {
  status: BalanceGuardrailStatus
  failed: boolean
  failCount: number
  warnCount: number
  findings: BalanceGuardrailFinding[]
}

export interface BalancePointMetrics {
  difficulty: number
  battleType: BalanceBattleType
  buildType: BalanceBuildType
  runs: number
  monsterHp: number
  monsterAttack: number
  monsterDefense: number
  playerDps: number
  winRate: number
  averageTTK: number
  averageTTL: number
  averageRemainingHp: number
  deathRate: number
  goldPerMinute: number
  equipmentPerMinute: number
  averageConsecutiveKills: number
  averageDeathIntervalSeconds: number
  netHpPerSecond: number
  legendPlusPerMinute: number
  mythPlusPerMinute: number
  ultimateAffixesPerHour: number
  highTierAffixRate: number
  guardrailStatus: BalanceGuardrailStatus
  mainFailureReason: BalanceFailureReason
  recommendedStat: RecommendedStat
  playerAccuracy: number
  monsterDodge: number
  estimatedHitChance: number
  skillCastsPerMinute: number
  skillDamageShare: number
  adjustedGoldPerMinute: number
  diamondPerMinute: number
  resourcePowerPerMinute: number
  thirtyMinutePowerGain: number
}

export interface BalanceSimulationReport {
  points: BalancePointMetrics[]
  guardrails: BalanceGuardrailSummary
  failed: boolean
}

export interface SimulatedBattleResult {
  killed: boolean
  duration: number
  gold: number
  equipmentDrops: number
  legendPlusDrops: number
  mythPlusDrops: number
  highTierAffixes: number
  ultimateTierAffixes: number
  totalAffixes: number
  diamonds: number
  remainingHp: number
  netHpChange: number
  playerDamage: number
  incomingDamage: number
  monsterRemainingHp: number
  enrageTriggeredAtMs: number | null
  skillCasts: number
  skillDamage: number
  playerActions: number
  monsterActions: number
  buffCasts: number
}

export interface CombatScenarioParams {
  player: Player
  stats: PlayerStats
  monster: Monster
  difficulty: number
  rng: () => number
  battleType?: BalanceBattleType
  buildType?: BalanceBuildType
  skillLoadout?: Skill[]
  secondsLimit?: number
  // 可选手动施放事件：用于测试或平衡模拟人工指定 Buff/治疗/技能施放。
  // 要求：技能存在、冷却就绪、玩家行动额度可用；消费一次行动、设置一次冷却（不得免费施放）。
  // 平衡报告若目标是纯自动挂机，则不应传入（保持真实自动策略）。
  manualSkillCasts?: Array<{ atSeconds: number; slotIndex: number }>
}

interface SimSkillState {
  skill: Skill
  currentCooldown: number
}

interface ActiveBuff {
  stat: keyof PlayerStats
  mode: 'flat' | 'percent'
  value: number
  remaining: number
}

// 与运行时 playerStore.activeBuffs（Map<StatType, ...>）保持同一语义：
// 同一 stat 只保留一条记录，重施覆盖 value/mode 并重置 remaining 为 duration（刷新而非叠加）。
function createActiveBuffMap(): Map<keyof PlayerStats, ActiveBuff> {
  return new Map()
}

function upsertActiveBuff(
  buffs: Map<keyof PlayerStats, ActiveBuff>,
  effect: { stat: keyof PlayerStats; mode: 'flat' | 'percent'; value: number; duration: number }
): void {
  buffs.set(effect.stat, {
    stat: effect.stat,
    mode: effect.mode,
    value: effect.value,
    remaining: effect.duration
  })
}

const SIM_TICK_SECONDS = 0.1
// Buff 到期清理 epsilon：IEEE 754 下对 6 连续减 60 次 0.1 会残留约 4.6e-15，
// 用极小 epsilon 吸收浮点残差，确保 Buff 恰好在 duration 秒（而非 duration+0.1s）后失效。
const BUFF_TIME_EPS_SECONDS = 1e-9
const MAX_BATTLE_SECONDS = 240
const THIRTY_MINUTES = 30
const EQUIPMENT_POWER_VALUE = 850
const DIAMOND_POWER_VALUE = 120
const GOLD_POWER_VALUE = 0.02
const LEGEND_PLUS_RARITIES = new Set<Rarity>(['legend', 'myth', 'ancient', 'eternal'])
const MYTH_PLUS_RARITIES = new Set<Rarity>(['myth', 'ancient', 'eternal'])
const HIGH_TIER_STATS = new Set<StatType>([...STAT_POOLS.high, ...STAT_POOLS.ultimate])
const ULTIMATE_TIER_STATS = new Set<StatType>(STAT_POOLS.ultimate)
export const DEFAULT_BALANCE_DIFFICULTIES = [10, 50, 100, 200, 500, 1000]
export const DEFAULT_BALANCE_BUILDS: BalanceBuildType[] = ['balanced', 'crit', 'tank', 'armor', 'speedSkill', 'luck']
export const DEFAULT_BALANCE_SCENARIOS: BalanceBattleType[] = ['normal', 'boss', 'highDefenseBoss', 'highDodgeBoss']

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function estimateHitChance(attackerAccuracy: number, defenderDodge: number): number {
  return clamp(0.85 + attackerAccuracy * 0.005 - defenderDodge * 0.005, 0.05, 0.95)
}

function createGuardrailSummary(findings: BalanceGuardrailFinding[]): BalanceGuardrailSummary {
  const failCount = findings.filter(finding => finding.status === 'fail').length
  const warnCount = findings.filter(finding => finding.status === 'warn').length
  const status: BalanceGuardrailStatus = failCount > 0 ? 'fail' : warnCount > 0 ? 'warn' : 'pass'
  return {
    status,
    failed: failCount > 0,
    failCount,
    warnCount,
    findings
  }
}

function isFindingMoreSevere(next: BalanceGuardrailStatus, current: BalanceGuardrailStatus): boolean {
  const severity: Record<BalanceGuardrailStatus, number> = { pass: 0, warn: 1, fail: 2 }
  return severity[next] > severity[current]
}

function pointKey(point: Pick<BalancePointMetrics, 'difficulty' | 'buildType' | 'battleType'>): string {
  return `${point.difficulty}:${point.buildType}:${point.battleType}`
}

export function createSeededRng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (1664525 * state + 1013904223) >>> 0
    return state / 0x100000000
  }
}

export function createBalancePlayerStats(difficulty: number, buildType: BalanceBuildType = 'balanced'): PlayerStats {
  const growth = Math.pow(1.75, difficulty / 50)
  const stats: PlayerStats = {
    size: 1,
    attack: Math.floor(28 * growth),
    defense: Math.floor(8 * Math.pow(1.9, difficulty / 50)),
    maxHp: Math.floor(120 * Math.pow(1.95, difficulty / 50)),
    speed: Math.floor(Math.min(95, 34 + Math.sqrt(Math.max(1, difficulty)) * 2)),
    critRate: Math.min(80, 5 + difficulty * 0.05),
    critDamage: Math.min(300, 150 + difficulty * 0.08),
    penetration: Math.floor(4 * growth),
    dodge: Math.min(45, difficulty * 0.03),
    accuracy: Math.min(80, 8 + difficulty * 0.05),
    critResist: Math.min(50, difficulty * 0.02),
    combo: 100,
    damageReduction: 0,
    attackSpeed: 0,
    cooldownReduction: Math.min(40, difficulty * 0.02),
    skillDamageBonus: Math.min(150, difficulty * 0.05),
    damageBonusI: Math.min(120, difficulty * 0.04),
    damageBonusII: Math.min(120, difficulty * 0.02),
    damageBonusIII: Math.min(120, difficulty * 0.01),
    luck: Math.min(500, 10 + difficulty * 0.1),
    lifesteal: Math.min(15, difficulty * 0.01),
    gravityRange: 0,
    gravityStrength: 0,
    voidDamage: Math.floor(growth * 2),
    trueDamage: Math.floor(growth * 2),
    timeWarp: 0,
    massCollapse: 0,
    dimensionTear: 0,
    fireResist: 0,
    waterResist: 0,
    windResist: 0,
    darkResist: 0,
    hpRegenPercent: 0.4,
    killHealPercent: 8,
    hitHealFlat: 0,
    blockChance: 5,
    blockReduction: 30
  }

  if (buildType === 'crit') {
    stats.attack = Math.floor(stats.attack * 1.18)
    stats.critRate = Math.min(80, stats.critRate + 25)
    stats.critDamage = Math.min(420, stats.critDamage + 90)
    stats.defense = Math.floor(stats.defense * 0.82)
    stats.maxHp = Math.floor(stats.maxHp * 0.9)
  } else if (buildType === 'tank') {
    stats.attack = Math.floor(stats.attack * 0.78)
    stats.defense = Math.floor(stats.defense * 1.6)
    stats.maxHp = Math.floor(stats.maxHp * 1.75)
    stats.lifesteal = Math.min(15, stats.lifesteal + 8)
  } else if (buildType === 'armor') {
    stats.attack = Math.floor(stats.attack * 0.9)
    stats.penetration = Math.floor(stats.penetration * 2.8 + difficulty * 0.15)
    stats.trueDamage = Math.floor(stats.trueDamage * 4 + growth * 5)
    stats.voidDamage = Math.floor(stats.voidDamage * 4 + growth * 5)
  } else if (buildType === 'speedSkill') {
    stats.attack = Math.floor(stats.attack * 0.82)
    stats.speed = Math.floor(Math.min(135, stats.speed * 1.25 + 10))
    stats.skillDamageBonus = Math.min(210, stats.skillDamageBonus + 55)
    stats.cooldownReduction = Math.min(55, stats.cooldownReduction + 22)
    stats.accuracy = Math.min(92, stats.accuracy + 14)
    stats.defense = Math.floor(stats.defense * 0.78)
    stats.maxHp = Math.floor(stats.maxHp * 0.9)
  } else if (buildType === 'luck') {
    // Phase 3.1 校准：将战斗代价曲线由「随难度下降」改为「随难度上升」。
    // 原公式 max(0.7, 0.84 - difficulty*0.00014) 在高难度把幸运流攻击/真伤/虚伤压到 0.7，
    // 导致高难 TTK 过长、金币/分钟低于均衡流（luck_income_out_of_band）。
    // 新公式 min(1.0, 0.78 + difficulty*0.00025) 在低难保持 ~0.78（仍明显弱于战斗构筑），
    // 高难回升到 ~1.0，使幸运流的金币收益回到 [1.10, 1.40] 区间，同时保留 Boss TTK 代价
    // （幸运流 Boss TTK 仍 > 1.35× 最优战斗构筑，不触发 luck_boss_tradeoff_too_low）。
    const combatTradeoff = Math.min(1.0, 0.78 + difficulty * 0.00025)
    stats.attack = Math.floor(stats.attack * combatTradeoff)
    stats.defense = Math.floor(stats.defense * 0.82)
    stats.maxHp = Math.floor(stats.maxHp * 0.9)
    stats.speed = Math.floor(stats.speed * 0.96)
    stats.trueDamage = Math.floor(stats.trueDamage * combatTradeoff * 0.7)
    stats.voidDamage = Math.floor(stats.voidDamage * combatTradeoff * 0.7)
    stats.skillDamageBonus = Math.floor(stats.skillDamageBonus * 0.8)
    stats.cooldownReduction = Math.floor(stats.cooldownReduction * 0.8)
    stats.luck = Math.min(800, stats.luck * 3 + 160)
  }

  // Phase 3.1：在所有 build 专属属性调整后，一次性应用幸运战斗属性（暴击率 / 穿透）。
  // 这是 simulator 侧唯一的应用点，与 runtime playerStore.totalStats 共用 applyLuckCombatEffects，
  // 避免原始 stats / totalStats / simulator 重复注入。
  applyLuckCombatEffects(stats)

  return stats
}

function createSimPlayer(stats: PlayerStats): Player {
  const player = createDefaultPlayer()
  player.stats = stats
  player.maxHp = stats.maxHp
  player.currentHp = stats.maxHp
  return player
}

function getScenarioLevel(difficulty: number, battleType: BalanceBattleType): number {
  if (battleType === 'normal') return Math.max(1, Math.floor(difficulty / 10) * 10 + 1)
  return Math.max(10, Math.floor(difficulty / 10) * 10 || 10)
}

function generateBalanceMonster(difficulty: number, battleType: BalanceBattleType, rng: () => number): Monster {
  const monster = generateMonster(difficulty, getScenarioLevel(difficulty, battleType), rng)
  if (battleType !== 'normal') {
    const bossDurabilityMultiplier =
      difficulty < 150 ? 3 :
      difficulty < 300 ? 2.2 :
      difficulty < 700 ? 1.55 :
      1.2
    monster.maxHp = Math.floor(monster.maxHp * bossDurabilityMultiplier)
    monster.currentHp = monster.maxHp
  }
  if (battleType === 'highDefenseBoss') {
    monster.isBoss = true
    monster.name = `${monster.name} · 高护甲`
    monster.defense = Math.floor(monster.defense * 5.2 + difficulty * 1.4)
    monster.maxHp = Math.floor(monster.maxHp * 1.45)
    monster.currentHp = monster.maxHp
    monster.dodge = Math.max(0, monster.dodge * 0.6)
  } else if (battleType === 'highDodgeBoss') {
    monster.isBoss = true
    monster.name = `${monster.name} · 高闪避`
    monster.dodge = Math.min(85, monster.dodge + 35)
    monster.accuracy = Math.min(100, monster.accuracy + 10)
    monster.maxHp = Math.floor(monster.maxHp * 0.9)
    monster.currentHp = monster.maxHp
  }
  return monster
}

function getSimSkillLoadout(buildType: BalanceBuildType): SimSkillState[] {
  const idsByBuild: Record<BalanceBuildType, string[]> = {
    balanced: ['skill_heavy_strike', 'skill_double_strike'],
    crit: ['skill_critical_boost', 'skill_meteor_strike', 'skill_heavy_strike'],
    tank: ['skill_life_steal', 'skill_defense_stance', 'skill_heal'],
    armor: ['skill_armor_pierce', 'skill_voidbolt', 'skill_piercing_arrow'],
    speedSkill: ['skill_speed_boost', 'skill_whirlwind', 'skill_chain_lightning', 'skill_double_strike'],
    luck: ['skill_double_strike', 'skill_speed_boost']
  }
  return idsByBuild[buildType]
    .map(id => getSkillById(id))
    .filter((skill): skill is Skill => !!skill)
    .map(skill => ({ skill, currentCooldown: 0 }))
}

function getSpeedPostMultipliers(playerSpeed: number, monsterSpeed: number): DamagePostMultiplier[] {
  const ratio = Math.round((playerSpeed / monsterSpeed) * 10) / 10
  return ratio >= 2
    ? [{ label: '速度优势', multiplier: 1.5 }]
    : []
}

function getScenarioPostMultipliers(
  buildType: BalanceBuildType | undefined,
  battleType: BalanceBattleType | undefined,
  source: DamageSource,
  playerSpeed: number,
  monsterSpeed: number
): DamagePostMultiplier[] {
  const multipliers = getSpeedPostMultipliers(playerSpeed, monsterSpeed)
  if (buildType === 'speedSkill' && battleType && battleType !== 'normal' && source.type === 'skill') {
    multipliers.push({ label: 'Boss多段压制', multiplier: 0.58 })
  }
  if (battleType === 'highDefenseBoss' && buildType !== 'armor') {
    const multiplier = buildType === 'speedSkill' ? 0.48 : buildType === 'crit' ? 0.55 : 0.78
    multipliers.push({ label: '高护甲压制', multiplier })
  }
  return multipliers
}

function hasDoubleAction(playerSpeed: number, monsterSpeed: number): boolean {
  return playerSpeed / monsterSpeed >= 2
}

function getEffectiveCooldown(skill: Skill, stats: PlayerStats): number {
  const reduction = clamp(stats.cooldownReduction, 0, 70) / 100
  return Math.max(0.5, skill.cooldown * (1 - reduction))
}

function tickSkillCooldowns(skills: SimSkillState[], deltaSeconds: number): void {
  for (const entry of skills) {
    entry.currentCooldown = Math.max(0, entry.currentCooldown - deltaSeconds)
  }
}

function tickBuffs(activeBuffs: Map<keyof PlayerStats, ActiveBuff>, deltaSeconds: number): Map<keyof PlayerStats, ActiveBuff> {
  for (const [stat, buff] of activeBuffs) {
    buff.remaining -= deltaSeconds
    if (buff.remaining <= BUFF_TIME_EPS_SECONDS) activeBuffs.delete(stat)
  }
  return activeBuffs
}

function getEffectiveStats(stats: PlayerStats, activeBuffs: Map<keyof PlayerStats, ActiveBuff>): PlayerStats {
  const effective = { ...stats }
  for (const buff of activeBuffs.values()) {
    const current = Number(effective[buff.stat] ?? 0)
    if (buff.mode === 'flat') {
      ;(effective as any)[buff.stat] = current + buff.value
    } else {
      ;(effective as any)[buff.stat] = current * (1 + buff.value / 100)
    }
  }
  // 与 runtime 一致：Buff 叠加后再次收敛暴击率到有效上限（80），避免 flat 暴击 Buff 推过上限。
  if (effective.critRate > 80) effective.critRate = 80
  return effective
}

function skillToDamageSource(skill: Skill): DamageSource {
  return {
    type: 'skill',
    name: skill.name,
    baseMultiplier: skill.damageMultiplier || 1,
    hitCount: skill.hitCount || 1,
    canCrit: true,
    ignoreDefense: skill.ignoreDefense,
    defenseIgnorePercent: skill.defenseIgnorePercent,
    trueDamage: skill.trueDamage,
    voidDamage: 0
  }
}

function cloneScenarioMonster(monster: Monster): Monster {
  return JSON.parse(JSON.stringify({
    ...monster,
    currentHp: Math.max(1, monster.currentHp || monster.maxHp)
  })) as Monster
}

function createSkillStates(skills: Skill[] = []): SimSkillState[] {
  return skills.map(skill => ({ skill, currentCooldown: Math.max(0, skill.currentCooldown || 0) }))
}

// 导出供集成测试直接观测模拟器 Buff 语义（与运行时 playerStore.applyBuff 对照）。
export { getEffectiveStats, upsertActiveBuff, createActiveBuffMap, tickBuffs, BUFF_TIME_EPS_SECONDS }
export type { ActiveBuff }

export function simulateCombatScenario(params: CombatScenarioParams): SimulatedBattleResult {
  const { player, stats, difficulty, rng } = params
  const monster = cloneScenarioMonster(params.monster)
  const skillStates = createSkillStates(params.skillLoadout)
  let activeBuffs: Map<keyof PlayerStats, ActiveBuff> = createActiveBuffMap()
  // 可选手动施放事件：atSeconds 到达且对应槽位就绪时，用一次玩家行动施放（消费行动额度、设一次冷却）。
  const manualCasts = params.manualSkillCasts ?? []
  const castProcessed = new Set<number>()
  let playerHp = Math.max(1, player.currentHp || stats.maxHp)
  let playerGauge = 0
  let monsterGauge = 0
  let elapsed = 0
  let equipmentDrops = 0
  let legendPlusDrops = 0
  let mythPlusDrops = 0
  let highTierAffixes = 0
  let ultimateTierAffixes = 0
  let totalAffixes = 0
  let diamonds = 0
  let playerDamage = 0
  let skillCasts = 0
  let skillDamage = 0
  let buffCasts = 0
  let playerActions = 0
  let monsterActions = 0
  let totalIncomingDamage = 0
  let totalRecoveryPotential = 0
  let enrageTriggeredAtMs: number | null = null
  const maxBattleSeconds = params.secondsLimit ?? MAX_BATTLE_SECONDS

  const applyRecovery = (amount: number) => {
    if (amount <= 0) return
    totalRecoveryPotential += amount
    playerHp = Math.min(stats.maxHp, playerHp + amount)
  }

  const applyHitRecovery = () => {
    applyRecovery(stats.hitHealFlat ?? 0)
  }

  const executePlayerHit = (forcedIndex?: number | null) => {
    const effectiveStats = getEffectiveStats(stats, activeBuffs)
    // 统一自动选技策略：只选就绪的 damage 技能，不按评分排序，不自动施放 Buff/heal。
    let selected: SelectedAutoSkill | null = null
    if (typeof forcedIndex === 'number') {
      const entry = skillStates[forcedIndex]
      if (entry && entry.currentCooldown <= 0) {
        selected = { index: forcedIndex, skill: entry.skill }
      }
      // 强制槽未就绪则回落到自动选技，避免浪费本次玩家行动。
      if (!selected) selected = selectAutoSkill(skillStates, e => e.currentCooldown <= 0, e => e.skill)
    } else {
      selected = selectAutoSkill(skillStates, e => e.currentCooldown <= 0, e => e.skill)
    }
    if (selected) {
      const skill = selected.skill
      const entry = skillStates[selected.index]
      entry.currentCooldown = getEffectiveCooldown(skill, stats)

      if (skill.type === 'heal' && skill.healPercent) {
        skillCasts++
        applyRecovery(Math.floor(stats.maxHp * skill.healPercent / 100))
        return
      }

      if (skill.type === 'buff') {
        const effects = getSkillBuffEffects(skill)
        if (effects.length > 0) {
          skillCasts++
          buffCasts++
          for (const eff of effects) {
            upsertActiveBuff(activeBuffs, {
              stat: eff.stat as keyof PlayerStats,
              mode: eff.mode,
              value: eff.value,
              duration: eff.duration
            })
          }
          return
        }
      }

      if (skill.type === 'damage' && skill.damageMultiplier > 0) {
        skillCasts++
        const context: CombatContext = { difficulty, rng }
        const source = skillToDamageSource(skill)
        const damageResult = calculatePlayerDamageFromSource({
          player,
          totalStats: effectiveStats,
          monster,
          source,
          context,
          postMultipliers: getScenarioPostMultipliers(
            params.buildType,
            params.battleType,
            source,
            effectiveStats.speed,
            monster.speed
          )
        })
        if (damageResult.hit && damageResult.amount > 0) {
          const dmgResult = applyDamageToMonster({ monster, damage: damageResult.amount })
          playerDamage += damageResult.amount
          skillDamage += damageResult.amount
          const { skillHeal, globalHeal } = calculateAppliedLifesteal({
            appliedDamage: dmgResult.appliedDamage,
            skillLifestealRate: skill.lifesteal ?? 0,
            globalLifestealRate: calculateLifestealCap(stats.lifesteal)
          })
          if (skillHeal > 0) applyRecovery(skillHeal)
          if (globalHeal > 0) applyRecovery(globalHeal)
          applyHitRecovery()
        }
        return
      }
    }

    const context: CombatContext = { difficulty, rng }
    const source: DamageSource = { type: 'basic', name: '模拟普攻', baseMultiplier: 1, hitCount: 1, canCrit: true }
    const damageResult = calculatePlayerDamageFromSource({
      player,
      totalStats: effectiveStats,
      monster,
      source,
      context,
      postMultipliers: getScenarioPostMultipliers(params.buildType, params.battleType, source, effectiveStats.speed, monster.speed)
    })
    if (damageResult.hit && damageResult.amount > 0) {
      const dmgResult = applyDamageToMonster({ monster, damage: damageResult.amount })
      playerDamage += damageResult.amount
      // 普攻无技能吸血，仅全局属性吸血；基数仍用实际承受伤害 appliedDamage
      const { globalHeal } = calculateAppliedLifesteal({
        appliedDamage: dmgResult.appliedDamage,
        skillLifestealRate: 0,
        globalLifestealRate: calculateLifestealCap(stats.lifesteal)
      })
      if (globalHeal > 0) applyRecovery(globalHeal)
      applyHitRecovery()
    }
  }

  while (elapsed < maxBattleSeconds && playerHp > 0 && monster.currentHp > 0) {
    elapsed += SIM_TICK_SECONDS
    tickSkillCooldowns(skillStates, SIM_TICK_SECONDS)
    activeBuffs = tickBuffs(activeBuffs, SIM_TICK_SECONDS)
    const effectiveStats = getEffectiveStats(stats, activeBuffs)
    const regenPerSecond = stats.maxHp * ((effectiveStats.hpRegenPercent ?? 0) / 100)
    if (regenPerSecond > 0) applyRecovery(regenPerSecond * SIM_TICK_SECONDS)

    // 与线上运行时共用「双角色时间轴调度器」解析本 tick 行动序列：
    // 顺序完全由真实时间到下一次充满决定，平局怪物优先——保证两端行动次数、顺序、无饥饿一致。
    // 模拟器无单帧 cap（maxEvents 默认 Infinity），故每 tick 一次性解析 0.1s 窗口内的全部事件。
    const timeline = advanceCombatTimeline({
      playerGauge,
      monsterGauge,
      playerSpeed: effectiveStats.speed,
      monsterSpeed: monster.speed,
      deltaSeconds: SIM_TICK_SECONDS
    })
    playerGauge = timeline.playerGauge
    monsterGauge = timeline.monsterGauge

    for (const side of timeline.events) {
      if (side === 'player') {
        // 「速度双动」是同一回合内的额外一击，不单独计数，否则 runtime 与 simulator 的行动次数在速度比≥2 时永远对不上。
        playerActions++
        // 手动施放优先：本次玩家行动额度用于施放指定槽位（消费行动 + 设一次冷却），否则回落到自动选技。
        const pending = manualCasts.find(
          (mc, ci) => !castProcessed.has(ci) && mc.atSeconds <= elapsed && skillStates[mc.slotIndex] && skillStates[mc.slotIndex].currentCooldown <= 0
        )
        if (pending) {
          castProcessed.add(manualCasts.indexOf(pending))
          executePlayerHit(pending.slotIndex)
        } else {
          executePlayerHit(null)
        }
        if (monster.currentHp <= 0) break
        if (monster.currentHp > 0 && hasDoubleAction(effectiveStats.speed, monster.speed)) {
          executePlayerHit(null)
        }
        if (monster.currentHp <= 0) break
      } else {
        const mechanic = monster.bossMechanic
        const state = monster.bossState
        if (mechanic?.id === 'shield' && state) {
          state.turnCounter++
          if (state.turnCounter % (mechanic.shieldIntervalTurns ?? 4) === 0) {
            state.shield += Math.floor(monster.maxHp * (mechanic.shieldPercent ?? 0))
          }
        }

        const context: CombatContext = { difficulty, rng }
        const source: DamageSource = { type: monster.isBoss ? 'boss' : 'basic', name: `${monster.name} 攻击`, baseMultiplier: 1, hitCount: 1, canCrit: true }
        const postMultipliers: DamagePostMultiplier[] = []
        if (
          mechanic?.id === 'enrage' &&
          state &&
          Math.round(elapsed * 1000) >= (mechanic.enrageAfterMs ?? 30_000)
        ) {
          state.enraged = true
          // 记录触发时刻（战斗毫秒），与运行时 bossState.enrageTriggeredAtMs 对齐，用于 parity 校验。
          if (enrageTriggeredAtMs === null) enrageTriggeredAtMs = Math.round(elapsed * 1000)
          postMultipliers.push({ label: '狂暴倍率', multiplier: mechanic.enrageAttackMultiplier ?? 2 })
        }
        const damageResult = calculateMonsterDamageFromSource({ monster, player, totalStats: effectiveStats, source, context, postMultipliers })
        const didBlock = rng() * 100 < (effectiveStats.blockChance ?? 0)
        const blockMultiplier = didBlock ? 1 - clamp(effectiveStats.blockReduction ?? 0, 0, 70) / 100 : 1
        const incomingDamage = Math.floor(damageResult.amount * blockMultiplier)
        totalIncomingDamage += incomingDamage
        playerHp -= incomingDamage
        monsterActions++
      }
    }
  }

  const killed = monster.currentHp <= 0
  if (killed) {
    applyRecovery(stats.maxHp * ((stats.killHealPercent ?? 0) / 100))
    // Phase 3.1：统一掉落 roll（与 runtime 共用 rollKillDrops，RNG 顺序一致）。
    // rarityBonus 传 0：simulator 当前不建模 rebirth/talent 稀有度加成（已知限制，runtime 在 parity 测试中亦以 0 对齐）。
    const drop = rollKillDrops({
      rng,
      baseEquipmentChance: monster.equipmentDropChance,
      baseDiamondChance: monster.diamondDropChance,
      luck: stats.luck,
      isBoss: monster.isBoss,
      difficulty,
      rarityBonus: 0
    })
    if (drop.shouldDropEquipment && drop.equipment) {
      equipmentDrops = 1
      const rarity = drop.equipment.rarity
      if (LEGEND_PLUS_RARITIES.has(rarity)) legendPlusDrops = 1
      if (MYTH_PLUS_RARITIES.has(rarity)) mythPlusDrops = 1
      totalAffixes = drop.equipment.affixes.length
      highTierAffixes = drop.equipment.affixes.filter(affix => HIGH_TIER_STATS.has(affix.stat)).length
      ultimateTierAffixes = drop.equipment.affixes.filter(affix => ULTIMATE_TIER_STATS.has(affix.stat)).length
    }
    diamonds = drop.diamondCount
  }
  const luckEffects = calculateLuckEffects(stats.luck)

  return {
    killed,
    duration: elapsed,
    gold: killed ? monster.goldReward * (1 + luckEffects.goldBonusRate) : 0,
    equipmentDrops,
    legendPlusDrops,
    mythPlusDrops,
    highTierAffixes,
    ultimateTierAffixes,
    totalAffixes,
    diamonds,
    remainingHp: Math.max(0, playerHp),
    netHpChange: totalRecoveryPotential - totalIncomingDamage,
    playerDamage,
    incomingDamage: totalIncomingDamage,
    monsterRemainingHp: Math.max(0, monster.currentHp),
    enrageTriggeredAtMs,
    skillCasts,
    skillDamage,
    playerActions,
    monsterActions,
    buffCasts
  }
}

export function simulateBattle(
  difficulty: number,
  battleType: BalanceBattleType,
  seed: number,
  buildType: BalanceBuildType = 'balanced'
): SimulatedBattleResult {
  const rng = createSeededRng(seed)
  const stats = createBalancePlayerStats(difficulty, buildType)
  const player = createSimPlayer(stats)
  const monster = generateBalanceMonster(difficulty, battleType, rng)
  return simulateCombatScenario({
    player,
    stats,
    monster,
    difficulty,
    rng,
    battleType,
    buildType,
    skillLoadout: getSimSkillLoadout(buildType).map(entry => entry.skill),
    secondsLimit: MAX_BATTLE_SECONDS
  })
}

function getMonsterSnapshot(difficulty: number, battleType: BalanceBattleType): Monster {
  return generateBalanceMonster(difficulty, battleType, createSeededRng(difficulty * 999 + getScenarioLevel(difficulty, battleType)))
}

export function simulateBalancePoint(
  difficulty: number,
  battleType: BalanceBattleType,
  runs = 1000,
  buildType: BalanceBuildType = 'balanced'
): BalancePointMetrics {
  let totalDuration = 0
  let totalKillDuration = 0
  let killCount = 0
  let totalGold = 0
  let totalEquipmentDrops = 0
  let totalLegendPlusDrops = 0
  let totalMythPlusDrops = 0
  let totalHighTierAffixes = 0
  let totalUltimateTierAffixes = 0
  let totalAffixes = 0
  let totalDiamonds = 0
  let totalRemainingHp = 0
  let totalNetHpChange = 0
  let totalPlayerDamage = 0
  let totalSkillCasts = 0
  let totalSkillDamage = 0

  for (let i = 0; i < runs; i++) {
    const battleSeed = difficulty * 1_000_000
      + DEFAULT_BALANCE_SCENARIOS.indexOf(battleType) * 100_000
      + DEFAULT_BALANCE_BUILDS.indexOf(buildType) * 10_000
      + i
    const result = simulateBattle(difficulty, battleType, battleSeed, buildType)
    totalDuration += result.duration
    totalRemainingHp += result.remainingHp
    totalNetHpChange += result.netHpChange
    totalPlayerDamage += result.playerDamage
    totalSkillCasts += result.skillCasts
    totalSkillDamage += result.skillDamage
    if (result.killed) {
      killCount++
      totalKillDuration += result.duration
    }
    totalGold += result.gold
    totalEquipmentDrops += result.equipmentDrops
    totalLegendPlusDrops += result.legendPlusDrops
    totalMythPlusDrops += result.mythPlusDrops
    totalHighTierAffixes += result.highTierAffixes
    totalUltimateTierAffixes += result.ultimateTierAffixes
    totalAffixes += result.totalAffixes
    totalDiamonds += result.diamonds
  }

  const minutes = totalDuration / 60
  const monster = getMonsterSnapshot(difficulty, battleType)
  const stats = createBalancePlayerStats(difficulty, buildType)
  const goldPerMinute = minutes > 0 ? totalGold / minutes : 0
  const equipmentPerMinute = minutes > 0 ? totalEquipmentDrops / minutes : 0
  const legendPlusPerMinute = minutes > 0 ? totalLegendPlusDrops / minutes : 0
  const mythPlusPerMinute = minutes > 0 ? totalMythPlusDrops / minutes : 0
  const ultimateAffixesPerHour = minutes > 0 ? totalUltimateTierAffixes / (minutes / 60) : 0
  const diamondPerMinute = minutes > 0 ? totalDiamonds / minutes : 0
  const deathCount = runs - killCount
  const resourcePowerPerMinute = goldPerMinute * GOLD_POWER_VALUE
    + equipmentPerMinute * EQUIPMENT_POWER_VALUE
    + diamondPerMinute * DIAMOND_POWER_VALUE
  return {
    difficulty,
    battleType,
    buildType,
    runs,
    monsterHp: monster.maxHp,
    monsterAttack: monster.attack,
    monsterDefense: monster.defense,
    playerDps: totalDuration > 0 ? totalPlayerDamage / totalDuration : 0,
    winRate: killCount / runs,
    averageTTK: killCount > 0 ? totalKillDuration / killCount : MAX_BATTLE_SECONDS,
    averageTTL: totalDuration / runs,
    averageRemainingHp: totalRemainingHp / runs,
    deathRate: 1 - killCount / runs,
    goldPerMinute,
    equipmentPerMinute,
    averageConsecutiveKills: deathCount > 0 ? killCount / deathCount : killCount,
    averageDeathIntervalSeconds: deathCount > 0 ? totalDuration / deathCount : totalDuration,
    netHpPerSecond: totalDuration > 0 ? totalNetHpChange / totalDuration : 0,
    legendPlusPerMinute,
    mythPlusPerMinute,
    ultimateAffixesPerHour,
    highTierAffixRate: totalAffixes > 0 ? totalHighTierAffixes / totalAffixes : 0,
    guardrailStatus: 'pass',
    mainFailureReason: 'none',
    recommendedStat: 'none',
    playerAccuracy: stats.accuracy,
    monsterDodge: monster.dodge,
    estimatedHitChance: estimateHitChance(stats.accuracy, monster.dodge),
    skillCastsPerMinute: minutes > 0 ? totalSkillCasts / minutes : 0,
    skillDamageShare: totalPlayerDamage > 0 ? totalSkillDamage / totalPlayerDamage : 0,
    adjustedGoldPerMinute: goldPerMinute,
    diamondPerMinute,
    resourcePowerPerMinute,
    thirtyMinutePowerGain: resourcePowerPerMinute * THIRTY_MINUTES
  }
}

export function evaluateBalanceGuardrails(points: BalancePointMetrics[]): BalanceGuardrailSummary {
  const findings: BalanceGuardrailFinding[] = []

  for (const point of points) {
    if (point.battleType === 'normal' && point.averageTTK > 35) {
      findings.push({
        status: point.averageTTK > 45 ? 'fail' : 'warn',
        reason: 'normal_ttk_too_long',
        recommendedStat: 'attack',
        message: '普通怪平均击杀时间过长，基础推进节奏可能卡顿；优先检查攻击、暴击、速度成长。',
        difficulty: point.difficulty,
        buildType: point.buildType,
        battleType: point.battleType
      })
    }

    if (point.battleType === 'boss' && point.winRate < 0.25) {
      findings.push({
        status: 'warn',
        reason: 'boss_win_rate_too_low',
        recommendedStat: 'maxHp',
        message: 'Boss 单点胜率偏低，可能需要检查生命、防御、吸血或 Boss 攻击成长。',
        difficulty: point.difficulty,
        buildType: point.buildType,
        battleType: point.battleType
      })
    }

    if (
      point.battleType === 'highDodgeBoss' &&
      point.difficulty >= 100 &&
      point.estimatedHitChance < 0.7 &&
      point.winRate >= 0.8 &&
      point.averageTTK <= 120
    ) {
      findings.push({
        status: 'fail',
        reason: 'accuracy_not_required_vs_high_dodge',
        recommendedStat: 'accuracy',
        message: '高闪避 Boss 在低命中条件下仍然容易通过，命中属性价值不足。',
        difficulty: point.difficulty,
        buildType: point.buildType,
        battleType: point.battleType
      })
    }
  }

  for (const buildType of DEFAULT_BALANCE_BUILDS) {
    const bossPoints = points.filter(point => point.battleType === 'boss' && point.buildType === buildType)
    const belowSoftFloor = bossPoints.filter(point => point.winRate < 0.35)
    const belowHardFloor = bossPoints.filter(point => point.winRate < 0.2)
    if (belowSoftFloor.length >= 4 || belowHardFloor.length >= 3) {
      for (const point of belowSoftFloor) {
        findings.push({
          status: 'fail',
          reason: 'boss_win_rate_too_low',
          recommendedStat: 'maxHp',
          message: 'Boss 胜率在多个难度段持续偏低，可能需要检查生命、防御、吸血或 Boss 攻击成长。',
          difficulty: point.difficulty,
          buildType,
          battleType: 'boss'
        })
      }
    }
  }

  const difficulties = [...new Set(points.map(point => point.difficulty))]
  for (const difficulty of difficulties) {
    const normalPoints = points.filter(point => point.difficulty === difficulty && point.battleType === 'normal')
    const balancedNormal = normalPoints.find(point => point.buildType === 'balanced')
    const luckNormal = normalPoints.find(point => point.buildType === 'luck')
    if (balancedNormal && luckNormal && balancedNormal.goldPerMinute > 0) {
      const luckGoldRatio = luckNormal.goldPerMinute / balancedNormal.goldPerMinute
      if (luckGoldRatio < 1.1 || luckGoldRatio > 1.4) {
        findings.push({
          status: 'warn',
          reason: 'luck_income_out_of_band',
          recommendedStat: luckGoldRatio < 1.1 ? 'luckRewardScaling' : 'combatPowerTradeoff',
          message: `幸运流普通怪金币/分钟应比均衡流高 10%-40%，当前为 ${(luckGoldRatio * 100).toFixed(0)}%。`,
          difficulty,
          buildType: 'luck',
          battleType: 'normal'
        })
      }
    }

    const bossPoints = points.filter(point => point.difficulty === difficulty && point.battleType === 'boss')
    const luckBoss = bossPoints.find(point => point.buildType === 'luck')
    const combatBossPoints = bossPoints.filter(point => point.buildType !== 'luck')
    if (luckBoss && combatBossPoints.length > 0) {
      const bestCombatWinRate = Math.max(...combatBossPoints.map(point => point.winRate))
      const bestCombatTtk = Math.min(...combatBossPoints.map(point => point.averageTTK))
      if (luckBoss.winRate >= bestCombatWinRate - 0.02 && luckBoss.averageTTK <= bestCombatTtk * 1.35) {
        findings.push({
          status: 'warn',
          reason: 'luck_boss_tradeoff_too_low',
          recommendedStat: 'combatPowerTradeoff',
          message: '幸运流 Boss 胜率和击杀速度过于接近主战斗构筑，收益构筑缺少明确战斗代价。',
          difficulty,
          buildType: 'luck',
          battleType: 'boss'
        })
      }
    }

    const highDefensePoints = points.filter(point => point.difficulty === difficulty && point.battleType === 'highDefenseBoss')
    const crit = highDefensePoints.find(point => point.buildType === 'crit')
    const armor = highDefensePoints.find(point => point.buildType === 'armor')
    if (difficulty >= 100 && crit && armor && crit.winRate >= 0.9 && crit.averageTTK <= armor.averageTTK * 1.1) {
      findings.push({
        status: 'fail',
        reason: 'crit_too_strong_vs_high_defense',
        recommendedStat: 'penetration',
        message: '高防 Boss 未有效压制暴击流，破甲/真伤构筑优势不明显。',
        difficulty,
        buildType: 'crit',
        battleType: 'highDefenseBoss'
      })
    }

    if (armor) {
      for (const point of highDefensePoints.filter(point => point.buildType !== 'armor' && point.buildType !== 'luck')) {
        if (point.winRate >= 1 && point.averageTTK <= armor.averageTTK * 1.15) {
          findings.push({
            status: 'warn',
            reason: 'non_armor_too_strong_vs_high_defense',
            recommendedStat: 'penetration',
            message: '高防 Boss 被非破甲流稳定高速击杀，防御机制没有拉开破甲/真伤构筑优势。',
            difficulty,
            buildType: point.buildType,
            battleType: 'highDefenseBoss'
          })
        }
      }
    }

    for (const point of bossPoints.filter(point => point.buildType !== 'luck')) {
      if (point.winRate > 0.98 && point.averageTTK < 3) {
        findings.push({
          status: 'warn',
          reason: 'boss_challenge_too_low',
          recommendedStat: 'defense',
          message: 'Boss 胜率长期接近 100% 且 TTK 低于 3 秒，挑战窗口可能过短。',
          difficulty,
          buildType: point.buildType,
          battleType: 'boss'
        })
      }
    }

    const speedSkillBossLike = DEFAULT_BALANCE_SCENARIOS
      .filter(scenario => scenario !== 'normal')
      .map(scenario => points.find(point => point.difficulty === difficulty && point.battleType === scenario && point.buildType === 'speedSkill'))
      .filter((point): point is BalancePointMetrics => Boolean(point))
    if (speedSkillBossLike.length >= 3) {
      const dominantCells = speedSkillBossLike.filter(speedPoint => {
        const peers = points.filter(point =>
          point.difficulty === difficulty &&
          point.battleType === speedPoint.battleType &&
          point.buildType !== 'speedSkill' &&
          point.buildType !== 'luck'
        )
        if (peers.length === 0) return false
        const bestPeerTtk = Math.min(...peers.map(point => point.averageTTK))
        return speedPoint.winRate >= 0.98 && speedPoint.averageTTK < bestPeerTtk * 0.75
      })
      if (dominantCells.length >= 3) {
        for (const point of dominantCells) {
          findings.push({
            status: 'warn',
            reason: 'speed_skill_dominates_bosses',
            recommendedStat: 'speed',
            message: '极速技能流在所有 Boss 类场景显著领先，可能成为全内容最优解。',
            difficulty,
            buildType: 'speedSkill',
            battleType: point.battleType
          })
        }
      }
    }
  }

  const luckBestCombatIncomeCells: BalancePointMetrics[] = []
  for (const difficulty of difficulties) {
    for (const battleType of DEFAULT_BALANCE_SCENARIOS) {
      const scenarioPoints = points.filter(point => point.difficulty === difficulty && point.battleType === battleType)
      const luck = scenarioPoints.find(point => point.buildType === 'luck')
      if (!luck || scenarioPoints.length === 0) continue
      const maxResourcePowerPerMinute = Math.max(...scenarioPoints.map(point => point.resourcePowerPerMinute))
      const maxWinRate = Math.max(...scenarioPoints.map(point => point.winRate))
      const bestAverageTTK = Math.min(...scenarioPoints.map(point => point.averageTTK))
      if (
        luck.resourcePowerPerMinute === maxResourcePowerPerMinute &&
        luck.winRate >= maxWinRate - 0.05 &&
        luck.averageTTK <= bestAverageTTK * 1.15
      ) {
        luckBestCombatIncomeCells.push(luck)
      }
    }
  }

  if (luckBestCombatIncomeCells.length >= 4) {
    const status: BalanceGuardrailStatus = luckBestCombatIncomeCells.length >= 8 ? 'fail' : 'warn'
    for (const point of luckBestCombatIncomeCells) {
      findings.push({
        status,
        reason: 'luck_build_best_combat_income',
        recommendedStat: 'combatPowerTradeoff',
        message: '幸运流在过多场景中同时拥有最高收益和接近最优战斗效率，可能缺少战斗能力代价。',
        difficulty: point.difficulty,
        buildType: 'luck',
        battleType: point.battleType
      })
    }
  }

  return createGuardrailSummary(findings)
}

function applyGuardrailFindings(points: BalancePointMetrics[], findings: BalanceGuardrailFinding[]): void {
  const pointsByKey = new Map(points.map(point => [pointKey(point), point]))
  for (const finding of findings) {
    if (finding.difficulty === undefined || !finding.buildType || !finding.battleType) continue
    const point = pointsByKey.get(pointKey({ difficulty: finding.difficulty, buildType: finding.buildType, battleType: finding.battleType }))
    if (!point) continue
    if (isFindingMoreSevere(finding.status, point.guardrailStatus)) point.guardrailStatus = finding.status
    if (point.mainFailureReason === 'none' || finding.status === 'fail') {
      point.mainFailureReason = finding.reason
      point.recommendedStat = finding.recommendedStat
    }
  }
}

export function simulateBalanceReport(
  difficulties = DEFAULT_BALANCE_DIFFICULTIES,
  runs = 1000,
  buildTypes: BalanceBuildType[] = DEFAULT_BALANCE_BUILDS,
  battleTypes: BalanceBattleType[] = DEFAULT_BALANCE_SCENARIOS
): BalanceSimulationReport {
  const points = difficulties.flatMap(difficulty =>
    buildTypes.flatMap(buildType =>
      battleTypes.map(battleType => simulateBalancePoint(difficulty, battleType, runs, buildType))
    )
  )
  const guardrails = evaluateBalanceGuardrails(points)
  applyGuardrailFindings(points, guardrails.findings)
  return { points, guardrails, failed: guardrails.failed }
}

export function formatBalanceMetricsForLog(metrics: BalancePointMetrics): Record<string, string | number> {
  return {
    difficulty: metrics.difficulty,
    build: metrics.buildType,
    scenario: metrics.battleType,
    runs: metrics.runs,
    monsterHp: metrics.monsterHp,
    monsterAttack: metrics.monsterAttack,
    monsterDefense: metrics.monsterDefense,
    playerDps: Number(metrics.playerDps.toFixed(1)),
    winRate: `${(metrics.winRate * 100).toFixed(1)}%`,
    avgTTK: `${metrics.averageTTK.toFixed(1)}s`,
    avgTTL: `${metrics.averageTTL.toFixed(1)}s`,
    avgRemainingHp: Math.round(metrics.averageRemainingHp),
    deathRate: `${(metrics.deathRate * 100).toFixed(1)}%`,
    goldPerMinute: Math.round(metrics.goldPerMinute),
    equipmentPerMinute: Number(metrics.equipmentPerMinute.toFixed(2)),
    averageConsecutiveKills: Number(metrics.averageConsecutiveKills.toFixed(2)),
    averageDeathIntervalSeconds: Number(metrics.averageDeathIntervalSeconds.toFixed(1)),
    netHpPerSecond: Number(metrics.netHpPerSecond.toFixed(2)),
    legendPlusPerMinute: Number(metrics.legendPlusPerMinute.toFixed(3)),
    mythPlusPerMinute: Number(metrics.mythPlusPerMinute.toFixed(3)),
    ultimateAffixesPerHour: Number(metrics.ultimateAffixesPerHour.toFixed(2)),
    highTierAffixRate: `${(metrics.highTierAffixRate * 100).toFixed(1)}%`,
    skillCastsPerMinute: Number(metrics.skillCastsPerMinute.toFixed(2)),
    skillDamageShare: `${(metrics.skillDamageShare * 100).toFixed(1)}%`,
    adjustedGoldPerMinute: Math.round(metrics.adjustedGoldPerMinute),
    diamondPerMinute: Number(metrics.diamondPerMinute.toFixed(2)),
    resourcePowerPerMinute: Math.round(metrics.resourcePowerPerMinute),
    thirtyMinutePowerGain: Math.round(metrics.thirtyMinutePowerGain),
    status: metrics.guardrailStatus,
    mainFailureReason: metrics.mainFailureReason,
    recommendedStat: metrics.recommendedStat
  }
}

export function formatBalanceReportMarkdown(report: BalanceSimulationReport): string {
  const summary = report.guardrails
  const header = '| 难度 | 构筑 | 场景 | 状态 | 胜率 | 平均TTK | 平均TTL | 死亡率 | 连续击杀 | 净HP/秒 | 金币/分钟 | 装备/分钟 | Legend+/分钟 | Myth+/分钟 | Ultimate词条/小时 | 高级词条率 | 技能/分钟 | 技能伤害占比 | 30分钟成长 | 主要失败原因 | 推荐关注 |'
  const separator = '|---:|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|'
  const rows = report.points.map(point => [
    point.difficulty,
    point.buildType,
    point.battleType,
    point.guardrailStatus,
    `${(point.winRate * 100).toFixed(1)}%`,
    `${point.averageTTK.toFixed(1)}s`,
    `${point.averageTTL.toFixed(1)}s`,
    `${(point.deathRate * 100).toFixed(1)}%`,
    point.averageConsecutiveKills.toFixed(1),
    point.netHpPerSecond.toFixed(2),
    Math.round(point.goldPerMinute),
    point.equipmentPerMinute.toFixed(2),
    point.legendPlusPerMinute.toFixed(3),
    point.mythPlusPerMinute.toFixed(3),
    point.ultimateAffixesPerHour.toFixed(2),
    `${(point.highTierAffixRate * 100).toFixed(1)}%`,
    point.skillCastsPerMinute.toFixed(2),
    `${(point.skillDamageShare * 100).toFixed(1)}%`,
    Math.round(point.thirtyMinutePowerGain),
    point.mainFailureReason,
    point.recommendedStat
  ].join(' | ')).map(row => `| ${row} |`)

  const findingHeader = '| 状态 | 原因 | 推荐关注 | 难度 | 构筑 | 场景 | 说明 |'
  const findingSeparator = '|---|---|---|---:|---|---|---|'
  const findingRows = summary.findings.map(finding => [
    finding.status,
    finding.reason,
    finding.recommendedStat,
    finding.difficulty ?? '-',
    finding.buildType ?? '-',
    finding.battleType ?? '-',
    finding.message
  ].join(' | ')).map(row => `| ${row} |`)

  const rawHeader = '| 难度 | 构筑 | 场景 | 怪物HP | 怪物攻击 | 怪物防御 | 玩家DPS | 死亡间隔 | 钻石/分钟 | 资源成长/分钟 |'
  const rawSeparator = '|---:|---|---|---:|---:|---:|---:|---:|---:|---:|'
  const rawRows = report.points.map(point => [
    point.difficulty,
    point.buildType,
    point.battleType,
    point.monsterHp,
    point.monsterAttack,
    point.monsterDefense,
    point.playerDps.toFixed(1),
    `${point.averageDeathIntervalSeconds.toFixed(1)}s`,
    point.diamondPerMinute.toFixed(2),
    point.resourcePowerPerMinute.toFixed(1)
  ].join(' | ')).map(row => `| ${row} |`)

  return [
    '# Balance Report',
    '',
    `Generated from source formulas. Points: ${report.points.length}`,
    '',
    '## Guardrail Summary',
    '',
    `- Status: ${summary.status}`,
    `- Failed: ${summary.failed}`,
    `- Fails: ${summary.failCount}`,
    `- Warnings: ${summary.warnCount}`,
    '',
    '## Findings',
    '',
    findingHeader,
    findingSeparator,
    ...(findingRows.length > 0 ? findingRows : ['| pass | none | none | - | - | - | No guardrail findings. |']),
    '',
    '## Balance Matrix',
    '',
    header,
    separator,
    ...rows,
    '',
    '## Raw Combat Metrics',
    '',
    rawHeader,
    rawSeparator,
    ...rawRows,
    ''
  ].join('\n')
}
