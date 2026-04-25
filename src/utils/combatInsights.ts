import type { Equipment, Monster, Player, PlayerStats } from '../types'
import { calculateArmorReduction, calculateTotalStats } from './calc'
import { calculateBuildArchetypeScores } from '../data/buildArchetypes'

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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function percentDelta(next: number, base: number): number {
  if (base <= 0) return next > 0 ? 100 : 0
  return ((next - base) / base) * 100
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
