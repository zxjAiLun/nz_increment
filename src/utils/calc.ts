import type { Player, PlayerStats, Monster, Equipment, StatType, ElementType } from '../types'
import { RARITY_MULTIPLIER } from '../types'

// T65 元素克制关系：fire > wind > water > fire，dark 独立
const ELEMENT_ADVANTAGE: Record<ElementType, ElementType | null> = {
  fire: 'wind',    // 火克风
  wind: 'water',   // 风克水
  water: 'fire',   // 水克火
  dark: null,      // 暗无克制
  none: null       // 无属性无克制
}

/**
 * T65 计算元素克制伤害倍率
 * @param playerElement - 攻击方元素（玩家目前无属性，扩展用）
 * @param monsterElement - 怪物元素
 * @param playerResist - 玩家元素抗性
 * @returns 克制倍率（1.0=无克制，1.5=克制，~0.67=被克制）
 */
export function calculateElementalAdvantage(
  playerElement: ElementType,
  monsterElement: ElementType,
  playerResist: number
): number {
  const advantage = ELEMENT_ADVANTAGE[playerElement]
  if (!advantage) return 1.0
  if (advantage === monsterElement) {
    // 克制：1.5x，减去抗性（上限1.5，下限1.0）
    return Math.max(1.0, 1.5 - playerResist / 100)
  }
  // 被克制：约0.67x，加上抗性（抗性满时回到1.0）
  if (ELEMENT_ADVANTAGE[monsterElement] === playerElement) {
    return Math.min(1.0, 0.67 + playerResist / 100)
  }
  return 1.0
}

/**
 * 创建默认玩家对象
 * @returns 初始化的玩家对象，包含默认属性和空装备栏
 */
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
      damageReduction: 0,
      attackSpeed: 0,
      cooldownReduction: 0,
      skillDamageBonus: 0,
      damageBonusI: 0,
      damageBonusII: 0,
      damageBonusIII: 0,
      luck: 10,
      lifesteal: 0,
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
    offlineEfficiencyBonus: 0,
    // T7.1 速杀/练功房计数
    speedKillCount: 0,
    trainingKillCount: 0,
    // T7.4 签到系统
    checkInStreak: 0,
    lastCheckInTime: 0,
    equipmentTickets: 0,
    materials: 0,
    gachaTickets: 0,
    passiveShards: 0,
    avatarFrames: 0,
    ownedAvatarFrames: [],
    setPieces: 0
  }
}

/**
 * 生成唯一ID（基于时间戳和随机字符串）
 * @returns 36进制时间戳 + 9位随机字符串
 */
export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9)
}

/**
 * 计算玩家总属性（基础属性 + 装备属性 + 转生加成）
 * @param player - 玩家对象
 * @returns 合并后的完整属性对象
 * @description 遍历玩家身上所有装备，将装备属性累加到基础属性上，并应用幸运穿透加成
 */
export interface CultivationParams {
  starMultiplier?: number
  ascensionMultiplier?: number
  constellationBonus?: Record<string, number>
}

export function calculateTotalStats(player: Player, cultivation?: CultivationParams): PlayerStats {
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
    damageReduction: player.stats.damageReduction || 0,
    attackSpeed: player.stats.attackSpeed || 0,
    cooldownReduction: player.stats.cooldownReduction || 0,
    skillDamageBonus: player.stats.skillDamageBonus || 0,
    damageBonusI: player.stats.damageBonusI || 0,
    damageBonusII: player.stats.damageBonusII || 0,
    damageBonusIII: player.stats.damageBonusIII || 0,
    luck: player.stats.luck || 10,
    lifesteal: player.stats.lifesteal || 0,
    gravityRange: player.stats.gravityRange || 0,
    gravityStrength: player.stats.gravityStrength || 0,
    voidDamage: player.stats.voidDamage || 0,
    trueDamage: player.stats.trueDamage || 0,
    timeWarp: player.stats.timeWarp || 0,
    massCollapse: player.stats.massCollapse || 0,
    dimensionTear: player.stats.dimensionTear || 0,
    // T65 元素抗性
    fireResist: player.stats.fireResist || 0,
    waterResist: player.stats.waterResist || 0,
    windResist: player.stats.windResist || 0,
    darkResist: player.stats.darkResist || 0
  }

  // 应用星级和觉醒倍率（养成基础属性）
  if (cultivation?.starMultiplier !== undefined && cultivation?.ascensionMultiplier !== undefined) {
    const mult = cultivation.starMultiplier * cultivation.ascensionMultiplier
    for (const key of ['attack', 'defense', 'maxHp', 'speed'] as const) {
      if (key in base) {
        base[key] = Math.floor(base[key] * mult)
      }
    }
  }

  // 累加装备属性
  for (const equipment of Object.values(player.equipment)) {
    if (!equipment) continue
    for (const stat of equipment.stats) {
      if (stat.type in base) {
        const currentValue = base[stat.type as keyof PlayerStats] as number
        base[stat.type as keyof PlayerStats] = currentValue + stat.value
      }
    }
  }

  // 应用命座效果
  if (cultivation?.constellationBonus) {
    for (const [stat, value] of Object.entries(cultivation.constellationBonus)) {
      if (stat in base) {
        base[stat as keyof PlayerStats] = Math.floor((base[stat as keyof PlayerStats] as number) * (1 + value / 100))
      }
    }
  }

  // 必中概率上限80%
  base.accuracy = Math.min(base.accuracy, 80)

  // 幸运值提供穿透加成
  base.penetration += calculateLuckPenetrationBonus(base.luck)

  return base
}

/**
 * T18.3 暴击率成长曲线（线性分段）
 * difficulty < 500: 5 + difficulty/10, 上限 50
 * difficulty >= 500: 50 + (difficulty-500)/50, 上限 80
 */
export function calculateCritRate(difficulty: number): number {
  if (difficulty < 500) {
    return Math.min(5 + Math.floor(difficulty / 10), 50)
  } else {
    return Math.min(50 + Math.floor((difficulty - 500) / 50), 80)
  }
}

/**
 * T18.3 暴击伤害成长曲线（线性）
 * 150 + difficulty * 0.05, 上限 300
 */
export function calculateCritDamage(difficulty: number): number {
  return Math.min(150 + Math.floor(difficulty * 0.05), 300)
}

/**
 * T18.2 生命偷取上限计算
 * @param baseLifesteal - 基础生命偷取率（0-15）
 * @returns 上限 15%
 */
export function calculateLifestealCap(baseLifesteal: number): number {
  return Math.min(baseLifesteal, 15)
}

/**
 * 计算玩家对怪物的伤害（完整伤害计算链）
 * 
 * 计算顺序（严格遵循）：
 * 1. 命中判定
 * 2. 基础伤害（攻击力）
 * 3. 暴击加成
 * 4. 增伤区加成（damageBonusI + damageBonusII + damageBonusIII + skillDamageBonus）
 * 5. 护甲计算（effectiveDefense → damageReduction）
 * 6. 真实伤害 + 虚空伤害（最后加入）
 * 
 * @param _player - 玩家对象（预留参数）
 * @param totalStats - 玩家完整属性（来自calculateTotalStats）
 * @param monster - 目标怪物对象
 * @param ignoreDefense - 是否忽略防御（true时跳过护甲计算）
 * @param defenseIgnorePercent - 防御无视百分比（0-100）
 * @param skillDamageBonus - 技能增伤百分比
 * @param bossDamageBonus - BOSS增伤百分比
 * @returns 最终伤害值（已向下取整）
 */
export function calculatePlayerDamage(
  _player: Player,
  totalStats: PlayerStats,
  monster: Monster,
  ignoreDefense: boolean = false,
  defenseIgnorePercent: number = 0,
  skillDamageBonus: number = 0,
  bossDamageBonus: number = 0,
  comboBonus: number = 0
): number {
  // 1. 命中判定
  const hitChance = Math.max(0.05, 0.95 - monster.accuracy * 0.01 + totalStats.dodge * 0.01)
  if (Math.random() > hitChance) {
    return 0 // 未命中
  }
  
  // 2. 基础伤害
  let damage = totalStats.attack
  
  // 3. 暴击计算（与calculateCritRate上限80保持一致）
  const critChance = Math.min(totalStats.critRate - monster.critResist * 0.5, 80)
  const isCrit = Math.random() * 100 < critChance
  if (isCrit) {
    const critMult = Math.max(1.2, totalStats.critDamage / 100 - monster.critResist * 0.2)
    damage *= critMult
  }
  
  // 4. 增伤区加成
  const damageMultiplier = 1 + (totalStats.damageBonusI + totalStats.damageBonusII + totalStats.damageBonusIII + skillDamageBonus) / 100
  damage *= damageMultiplier
  
  // T65 5. 连击加成 + 元素克制（乘法区，在护甲前）
  if (comboBonus > 0) {
    damage *= (1 + comboBonus / 100)
  }
  // T65 元素克制
  const elementalMult = calculateElementalAdvantage('none', monster.element, totalStats.fireResist || 0)
  if (elementalMult !== 1.0) {
    damage *= elementalMult
  }
  
  // 6. 护甲计算
  if (!ignoreDefense) {
    const effectiveDefense = monster.defense * (1 - defenseIgnorePercent / 100)
    const defenseAfterPenetration = Math.max(0, effectiveDefense - totalStats.penetration)
    const damageReduction = defenseAfterPenetration / (defenseAfterPenetration + 200)
    damage = damage * (1 - damageReduction)
    // 最低伤害保底：不低于攻击力的10%
    damage = Math.max(damage, totalStats.attack * 0.1)
  }
  
  // 7. 真实伤害 + 虚空伤害（穿透所有防御，不受暴击加成）
  damage += totalStats.trueDamage
  damage += totalStats.voidDamage
  
  // BOSS增伤
  if (monster.isBoss) {
    damage *= (1 + bossDamageBonus / 100)
  }
  
  return Math.floor(damage)
}

/**
 * 根据连击率计算玩家每次攻击的命中次数
 * @param totalStats - 玩家完整属性
 * @returns 每次攻击的命中次数（最少1次）
 * @description combo值除以100得到连击倍率，实际命中次数 = floor(combo / 100)，最少为1
 */
export function getPlayerHitCount(totalStats: PlayerStats): number {
  const baseCombo = totalStats.combo / 100
  return Math.max(1, Math.floor(baseCombo))
}

/**
 * 计算怪物对玩家的伤害
 * @param monster - 怪物对象
 * @param _player - 玩家对象（预留参数）
 * @param totalStats - 玩家完整属性（用于护甲减免计算）
 * @returns 伤害值（已向下取整）
 * @description 包含：命中判定 → 基础伤害 → 暴击 → 护甲减免（最低10%保底）
 */
export function calculateMonsterDamage(monster: Monster, _player: Player, totalStats: PlayerStats): number {
  // 命中判定
  const hitChance = Math.max(0.05, 0.95 - monster.accuracy * 0.01 + totalStats.dodge * 0.01)
  if (Math.random() > hitChance) {
    return 0
  }
  
  let damage = monster.attack
  
  // 暴击（与calculateCritRate上限80保持一致）
  const critChance = Math.min(monster.critRate - totalStats.critResist * 0.5, 80)
  const isCrit = Math.random() * 100 < critChance
  if (isCrit) {
    const critMult = Math.max(1.2, monster.critDamage / 100 - totalStats.critResist * 0.2)
    damage *= critMult
  }
  
  // 护甲减免
  const effectiveDef = Math.max(0, totalStats.defense - monster.penetration)
  const damageReduction = effectiveDef / (effectiveDef + 200)
  damage = damage * (1 - damageReduction)
  // 最低保底：不低于怪物攻击的10%
  damage = Math.max(damage, monster.attack * 0.1)
  
  return Math.floor(damage)
}

/**
 * 计算治疗量
 * @param _player - 玩家对象（预留参数）
 * @param totalStats - 玩家完整属性（用于获取maxHp）
 * @param healPercent - 治疗百分比（0-100）
 * @returns 治疗量（已向下取整）
 * @description 治疗量 = 最大生命值 × (healPercent / 100)
 */
export function calculateHealing(_player: Player, totalStats: PlayerStats, healPercent: number): number {
  const healAmount = totalStats.maxHp * (healPercent / 100)
  return Math.floor(healAmount)
}

/**
 * 计算生命偷取量
 * @param damage - 造成的伤害值
 * @param lifeStealRate - 生命偷取百分比（0-100）
 * @returns 偷取的生命值（已向下取整）
 * @description 偷取量 = 实际伤害 × (lifeStealRate / 100)
 */
export function calculateLifesteal(damage: number, lifeStealRate: number): number {
  return Math.floor(damage * (lifeStealRate / 100))
}

/**
 * 计算技能生命偷取量
 * @param skill - 技能对象（含 lifesteal 属性）
 * @param damage - 造成的伤害值
 * @returns 偷取的生命值
 * @description 从技能对象读取 lifesteal 率应用到伤害上
 */
export function calculateSkillLifesteal(skill: { lifesteal?: number } | null, damage: number): number {
  if (!skill || !skill.lifesteal || skill.lifesteal <= 0) return 0
  return Math.floor(damage * (skill.lifesteal / 100))
}

/**
 * 计算幸运值的所有效果
 * @param luck - 幸运值
 * @returns 幸运效果对象
 * @description 包含：金币加成、装备掉落加成、钻石掉落概率、暴击加成
 */
export function calculateLuckEffects(luck: number): {
  goldBonus: number       // 金币收益加成（luck × 2%）
  equipmentDropBonus: number  // 装备掉落加成（luck × 0.8%）
  diamondDropChance: number   // 钻石掉落概率（luck × 0.02%，上限15%）
  critBonus: number       // 暴击率加成（luck × 0.8%）
} {
  return {
    goldBonus: luck * 0.02,
    equipmentDropBonus: luck * 0.008,
    diamondDropChance: Math.min(luck * 0.0002, 0.15),
    critBonus: luck * 0.08
  }
}

/**
 * 计算幸运值提供的穿透加成
 * @param luck - 幸运值
 * @returns 穿透加成值（向下取整）
 * @description 每10点幸运值提供1点穿透
 */
export function calculateLuckPenetrationBonus(luck: number): number {
  return Math.floor(luck * 0.1)
}

/**
 * 计算装备评分
 * @param equipment - 装备对象
 * @returns 装备综合评分（整数）
 * @description 评分公式：Σ(词条值 / 词条基础值 × 稀有度倍率)
 * 用于装备对比和自动穿戴判断
 */
export function calculateEquipmentScore(equipment: Equipment): number {
  let score = 0
  for (const stat of equipment.stats) {
    const baseValue = getStatBaseValue(stat.type)
    score += (stat.value / baseValue) * RARITY_MULTIPLIER[equipment.rarity]
  }
  return Math.floor(score)
}

/**
 * 获取指定属性类型的基础参考值
 * @param type - 属性类型
 * @returns 基础参考值
 * @description 用于装备评分时将不同属性的实际值标准化
 */
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
    damageReduction: 5,
    attackSpeed: 5,
    cooldownReduction: 5,
    skillDamageBonus: 5,
    damageBonusI: 5,
    damageBonusII: 5,
    damageBonusIII: 5,
    luck: 10,
    lifesteal: 0,
    gravityRange: 10,
    gravityStrength: 10,
    voidDamage: 50,
    trueDamage: 50,
    timeWarp: 10,
    massCollapse: 50,
    dimensionTear: 50,
    // T65 元素抗性
    fireResist: 10,
    waterResist: 10,
    windResist: 10,
    darkResist: 10
  }
  return baseValues[type] || 10
}

/**
 * 判断新装备是否比旧装备更好
 * @param newEq - 新装备
 * @param oldEq - 当前装备（null表示空槽位）
 * @param threshold - 评分阈值倍数（默认1.0，即新装备评分必须更高）
 * @returns 新装备是否更好
 * @description 用于自动穿戴推荐：当新装备评分超过旧装备评分×threshold时触发替换提示
 */
export function isEquipmentBetter(newEq: Equipment, oldEq: Equipment | null, threshold: number = 1.0): boolean {
  if (!oldEq) return true
  const oldScore = calculateEquipmentScore(oldEq)
  const newScore = calculateEquipmentScore(newEq)
  return newScore > oldScore * threshold
}

/**
 * 计算装备回收价格（优化版）
 * @param equipment - 装备对象
 * @returns 回收获得的金币数
 * @description 回收价 = (装备评分 × 10 × 稀有度倍率) × (1 + min(score/200, 0.8))
 * 评分越高返还越多，评分>100时返还比例达到最高+80%
 */
export function calculateRecyclePrice(equipment: Equipment): number {
  const score = calculateEquipmentScore(equipment)
  const basePrice = score * 10 * RARITY_MULTIPLIER[equipment.rarity]
  // 评分每满100点增加+20%返还，上限+80%（需要评分达到400）
  const bonusMultiplier = Math.min(score / 200, 0.8)
  return Math.floor(basePrice * (1 + bonusMultiplier))
}

/**
 * 计算离线收益
 * @param player - 玩家对象
 * @param offlineSeconds - 离线秒数
 * @returns 金币和经验收益对象
 * @description 根据离线时长计算离线收益：
 * - 最长计算24小时
 * - 离线≥1小时：金币×1.5，经验×1.2
 * - 离线≥4小时：金币×2.0，经验×1.5
 * - 离线≥8小时：金币×2.5，经验×2.0
 */
export function calculateOfflineReward(player: Player, offlineSeconds: number): { gold: number, exp: number } {
  const maxOfflineSeconds = 24 * 60 * 60 // 24小时上限
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
