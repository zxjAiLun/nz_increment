import type { Player, PlayerStats, Monster, Equipment, StatType } from '../types'
import { RARITY_MULTIPLIER } from '../types'

export function createDefaultPlayer(): Player {
  return {
    id: generateId(),
    name: '棒棒糖',
    level: 1,
    experience: 0,
    currentHp: 100,
    maxHp: 100,
    stats: {
      size: 1,
      attack: 10,
      defense: 5,
      maxHp: 100,
      speed: 10,
      critRate: 5,
      critDamage: 150,
      penetration: 0,
      dodge: 0,
      accuracy: 0,
      critResist: 0,
      combo: 100,
      damageBonusI: 0,
      damageBonusII: 0,
      damageBonusIII: 0,
      luck: 10,
      gravityRange: 0,
      gravityStrength: 0,
      voidDamage: 0,
      trueDamage: 0,
      timeWarp: 0,
      massCollapse: 0,
      dimensionTear: 0
    },
    gold: 0,
    diamond: 0,
    equipment: {},
    skills: [null, null, null, null, null],
    unlockedPhases: [1],
    totalKillCount: 0,
    totalComboCount: 0,
    maxComboCount: 0,
    totalOnlineTime: 0,
    totalOfflineTime: 0,
    lastLoginTime: Date.now(),
    offlineEfficiencyBonus: 0
  }
}

export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9)
}

export function calculateTotalStats(player: Player): PlayerStats {
  const base: PlayerStats = {
    size: player.stats.size || 1,
    attack: player.stats.attack || 10,
    defense: player.stats.defense || 5,
    maxHp: player.stats.maxHp || 100,
    speed: player.stats.speed || 10,
    critRate: player.stats.critRate || 5,
    critDamage: player.stats.critDamage || 150,
    penetration: player.stats.penetration || 0,
    dodge: player.stats.dodge || 0,
    accuracy: player.stats.accuracy || 0,
    critResist: player.stats.critResist || 0,
    combo: player.stats.combo || 100,
    damageBonusI: player.stats.damageBonusI || 0,
    damageBonusII: player.stats.damageBonusII || 0,
    damageBonusIII: player.stats.damageBonusIII || 0,
    luck: player.stats.luck || 10,
    gravityRange: player.stats.gravityRange || 0,
    gravityStrength: player.stats.gravityStrength || 0,
    voidDamage: player.stats.voidDamage || 0,
    trueDamage: player.stats.trueDamage || 0,
    timeWarp: player.stats.timeWarp || 0,
    massCollapse: player.stats.massCollapse || 0,
    dimensionTear: player.stats.dimensionTear || 0
  }
  
  for (const equipment of Object.values(player.equipment)) {
    if (!equipment) continue
    for (const stat of equipment.stats) {
      if (stat.type in base) {
        const currentValue = base[stat.type as keyof PlayerStats] as number
        base[stat.type as keyof PlayerStats] = currentValue + stat.value
      }
    }
  }
  
  base.accuracy = Math.min(base.accuracy, 80)
  
  base.penetration += calculateLuckPenetrationBonus(base.luck)
  
  return base
}

export function calculatePlayerDamage(_player: Player, totalStats: PlayerStats, monster: Monster, ignoreDefense: boolean = false, defenseIgnorePercent: number = 0, skillDamageBonus: number = 0, bossDamageBonus: number = 0): number {
  const hitChance = Math.max(0.05, 0.95 - monster.accuracy * 0.01 + totalStats.dodge * 0.01)
  if (Math.random() > hitChance) {
    return 0
  }
  
  let damage = totalStats.attack
  
  const critChance = Math.min(totalStats.critRate - monster.critResist * 0.5, 50)
  const isCrit = Math.random() * 100 < critChance
  if (isCrit) {
    const critMult = Math.max(1.2, totalStats.critDamage / 100 - monster.critResist * 0.2)
    damage *= critMult
  }
  
  const damageMultiplier = 1 + (totalStats.damageBonusI + totalStats.damageBonusII + totalStats.damageBonusIII + skillDamageBonus) / 100
  damage *= damageMultiplier
  
  if (!ignoreDefense) {
    const effectiveDefense = monster.defense * (1 - defenseIgnorePercent / 100)
    const defenseAfterPenetration = Math.max(0, effectiveDefense - totalStats.penetration)
    const damageReduction = defenseAfterPenetration / (defenseAfterPenetration + 200)
    damage = damage * (1 - damageReduction)
    damage = Math.max(damage, totalStats.attack * 0.1)
  }
  
  damage += totalStats.trueDamage
  damage += totalStats.voidDamage
  
  if (monster.isBoss) {
    damage *= (1 + bossDamageBonus / 100)
  }
  
  return Math.floor(damage)
}

export function getPlayerHitCount(totalStats: PlayerStats): number {
  const baseCombo = totalStats.combo / 100
  return Math.max(1, Math.floor(baseCombo))
}

export function calculateMonsterDamage(monster: Monster, _player: Player, totalStats: PlayerStats): number {
  const hitChance = Math.max(0.05, 0.95 - monster.accuracy * 0.01 + totalStats.dodge * 0.01)
  if (Math.random() > hitChance) {
    return 0
  }
  
  let damage = monster.attack
  
  const critChance = Math.min(monster.critRate - totalStats.critResist * 0.5, 50)
  const isCrit = Math.random() * 100 < critChance
  if (isCrit) {
    const critMult = Math.max(1.2, monster.critDamage / 100 - totalStats.critResist * 0.2)
    damage *= critMult
  }
  
  const effectiveDef = Math.max(0, totalStats.defense - monster.penetration)
  const damageReduction = effectiveDef / (effectiveDef + 200)
  damage = damage * (1 - damageReduction)
  damage = Math.max(damage, monster.attack * 0.1)
  
  return Math.floor(damage)
}

export function calculateHealing(_player: Player, totalStats: PlayerStats, healPercent: number): number {
  const healAmount = totalStats.maxHp * (healPercent / 100)
  return Math.floor(healAmount)
}

export function calculateLifesteal(damage: number, lifeStealRate: number): number {
  return Math.floor(damage * (lifeStealRate / 100))
}

export function calculateLuckEffects(luck: number): {
  goldBonus: number
  equipmentDropBonus: number
  diamondDropChance: number
  critBonus: number
} {
  return {
    goldBonus: luck * 0.02,
    equipmentDropBonus: luck * 0.008,
    diamondDropChance: Math.min(luck * 0.0002, 0.15),
    critBonus: luck * 0.08
  }
}

export function calculateLuckPenetrationBonus(luck: number): number {
  return Math.floor(luck * 0.1)
}

export function calculateEquipmentScore(equipment: Equipment): number {
  let score = 0
  for (const stat of equipment.stats) {
    const baseValue = getStatBaseValue(stat.type)
    score += (stat.value / baseValue) * RARITY_MULTIPLIER[equipment.rarity]
  }
  return Math.floor(score)
}

function getStatBaseValue(type: StatType): number {
  const baseValues: Record<StatType, number> = {
    attack: 10,
    defense: 5,
    maxHp: 100,
    speed: 10,
    critRate: 5,
    critDamage: 150,
    penetration: 10,
    dodge: 5,
    accuracy: 5,
    critResist: 5,
    combo: 100,
    damageBonusI: 5,
    damageBonusII: 5,
    damageBonusIII: 5,
    luck: 10,
    gravityRange: 10,
    gravityStrength: 10,
    voidDamage: 50,
    trueDamage: 50,
    timeWarp: 10,
    massCollapse: 50,
    dimensionTear: 50
  }
  return baseValues[type] || 10
}

export function isEquipmentBetter(newEq: Equipment, oldEq: Equipment | null, threshold: number = 1.0): boolean {
  if (!oldEq) return true
  const oldScore = calculateEquipmentScore(oldEq)
  const newScore = calculateEquipmentScore(newEq)
  return newScore > oldScore * threshold
}

export function calculateRecyclePrice(equipment: Equipment): number {
  const score = calculateEquipmentScore(equipment)
  return score * 10 * RARITY_MULTIPLIER[equipment.rarity]
}

export function calculateOfflineReward(player: Player, offlineSeconds: number): { gold: number, exp: number } {
  const maxOfflineSeconds = 24 * 60 * 60
  const actualSeconds = Math.min(offlineSeconds, maxOfflineSeconds)
  
  const luckEffects = calculateLuckEffects(player.stats.luck)
  const baseGoldPerSecond = player.stats.attack * 0.2 * (1 + player.offlineEfficiencyBonus / 100) * (1 + luckEffects.goldBonus)
  const baseExpPerSecond = player.stats.attack * 0.1
  
  let goldMultiplier = 1
  let expMultiplier = 1
  
  if (actualSeconds >= 3600) {
    goldMultiplier = 1.5
    expMultiplier = 1.2
  }
  if (actualSeconds >= 4 * 3600) {
    goldMultiplier = 2.0
    expMultiplier = 1.5
  }
  if (actualSeconds >= 8 * 3600) {
    goldMultiplier = 2.5
    expMultiplier = 2.0
  }
  
  return {
    gold: Math.floor(baseGoldPerSecond * actualSeconds * goldMultiplier),
    exp: Math.floor(baseExpPerSecond * actualSeconds * expMultiplier)
  }
}
