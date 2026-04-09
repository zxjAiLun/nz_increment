export type Rarity = 'common' | 'good' | 'fine' | 'epic' | 'legend' | 'myth' | 'ancient' | 'eternal'

export type EquipmentSlot = 
  | 'head' | 'neck' | 'shoulder' | 'chest' | 'back'
  | 'hand' | 'waist' | 'legs' | 'leftHand' | 'rightHand'
  | 'ringLeft' | 'ringRight'

export type AchievementCategory = 'kill' | 'growth' | 'equipment' | 'phase' | 'wealth' | 'time' | 'combo' | 'special' | 'combat' | 'collection' | 'endless' | 'speedKill' | 'training' | 'rebirth' | 'skill'

export type StatType = 
  | 'attack' | 'defense' | 'maxHp' | 'speed' | 'luck'
  | 'critRate' | 'critDamage' | 'penetration' | 'dodge'
  | 'accuracy' | 'critResist' | 'combo' | 'damageReduction'
  | 'damageBonusI' | 'damageBonusII' | 'damageBonusIII'
  | 'trueDamage' | 'voidDamage' | 'gravityRange' | 'gravityStrength'
  | 'timeWarp' | 'massCollapse' | 'dimensionTear'

export type StatCategory = 'basic' | 'advanced' | 'high' | 'ultimate'

export type SkillType = 'damage' | 'heal' | 'buff' | 'debuff'

export interface StatBonus {
  type: StatType
  value: number
  isPercent: boolean
}

// T14.1 被动技能条件表达式
export interface ConditionExpression {
  field: string      // 'hpPercent', 'combo', 'hasEquipmentSet', 'isBoss', 'turnCount', 'speed'
  operator: string    // '<', '>', '>=', '<=', '==', 'has'
  value: number | string
}

export interface ConditionalPassiveEffect {
  id: string
  name: string
  description: string
  type: 'conditional' | 'static' | 'threshold'
  condition?: ConditionExpression
  effect: {
    stat?: StatType
    value?: number
    type?: 'flat' | 'percent'
    special?: string  // 'triggerSkill', 'reflect', 'lifesteal'
  }
  priority: number
}

/** 可金币提升的属性的词缀 */
export interface StatAffix {
  stat: StatType
  value: number
  isUpgradeable: boolean
  upgradeLevel: number
}

/** 可金币提升的属性列表 */
export const UPGRADEABLE_STATS = ['attack', 'defense', 'maxHp', 'speed'] as const
export type UpgradeableStat = typeof UPGRADEABLE_STATS[number]

/** 不可金币提升的属性列表 */
export const LOCKED_STATS = [
  'critRate', 'critDamage', 'penetration', 'dodge', 'accuracy',
  'critResist', 'combo', 'damageBonus', 'trueDamage', 'voidDamage',
  'luck', 'gravityRange', 'gravityStrength', 'timeWarp', 'massCollapse', 'dimensionTear'
] as const
export type LockedStat = typeof LOCKED_STATS[number]

export interface Equipment {
  id: string
  slot: EquipmentSlot
  name: string
  rarity: Rarity
  level: number
  stats: StatBonus[]
  /** 装备所属套装ID，不属于套装则为 undefined */
  setId?: string
  isLocked: boolean
  /** 词条列表（新版格式，支持金币升级） */
  affixes: StatAffix[]
}

export interface PassiveEffect {
  trigger: 'onKill' | 'onCrit' | 'onHit' | 'onDamageTaken' | 'onTurnEnd'
  effect: StatType | 'heal' | 'shield' | 'removeDebuff'
  value: number
}

export interface Skill {
  id: string
  name: string
  description: string
  type: SkillType
  damageMultiplier: number
  ignoreDefense: boolean
  defenseIgnorePercent: number
  trueDamage: number
  cooldown: number
  currentCooldown: number
  unlockPhase: number
  hitCount: number
  healPercent: number
  healAmount?: number
  lifesteal?: number
  buffEffect?: {
    stat: StatType
    percentBoost: number
    duration: number
  }
  passiveEffect?: PassiveEffect
}

export interface SkillSlot {
  slotIndex: number
  skill: Skill | null
}

export interface Monster {
  id: string
  name: string
  level: number
  phase: number
  maxHp: number
  currentHp: number
  attack: number
  defense: number
  speed: number
  critRate: number
  critDamage: number
  critResist: number
  penetration: number
  accuracy: number
  dodge: number
  goldReward: number
  expReward: number
  equipmentDropChance: number
  diamondDropChance: number
  isBoss: boolean
  isTrainingMode: boolean
  trainingDifficulty: 'easy' | 'medium' | 'hard' | null
  skills: string[]
}

export interface Achievement {
  id: string
  category: AchievementCategory
  name: string
  description: string
  requirement: number
  progress: number
  completed: boolean
  reward: AchievementReward
}

export interface AchievementReward {
  gold?: number
  exp?: number
  diamond?: number
  permanentBonus?: Partial<PlayerStats>
  offlineEfficiencyBonus?: number
  skillUnlock?: string
  goldBonus?: number
  passive?: number
  equipmentTicket?: number
  legendaryEquipment?: number
}

export interface PlayerStats {
  size: number
  attack: number
  defense: number
  maxHp: number
  speed: number
  critRate: number
  critDamage: number
  penetration: number
  dodge: number
  accuracy: number
  critResist: number
  combo: number
  damageReduction: number
  damageBonusI: number
  damageBonusII: number
  damageBonusIII: number
  luck: number
  gravityRange: number
  gravityStrength: number
  voidDamage: number
  trueDamage: number
  timeWarp: number
  massCollapse: number
  dimensionTear: number
}

export interface Player {
  id: string
  name: string
  level: number
  experience: number
  currentHp: number
  maxHp: number
  stats: PlayerStats
  gold: number
  diamond: number
  equipment: Partial<Record<EquipmentSlot, Equipment>>
  skills: (Skill | null)[]
  unlockedPhases: number[]
  totalKillCount: number
  totalComboCount: number
  maxComboCount: number
  totalOnlineTime: number
  totalOfflineTime: number
  lastLoginTime: number
  offlineEfficiencyBonus: number
  /** T7.1 速杀计数（10秒内击杀） */
  speedKillCount: number
  /** T7.1 练功房击杀计数 */
  trainingKillCount: number
  /** T7.4 签到系统-连续签到天数 */
  checkInStreak: number
  /** T7.4 签到系统-最后签到时间戳 */
  lastCheckInTime: number
  /** T7.4 装备券计数 */
  equipmentTickets: number
}

export const RARITY_COLORS: Record<Rarity, string> = {
  common: '#9d9d9d',
  good: '#4dff4d',
  fine: '#4d9dff',
  epic: '#9d4dff',
  legend: '#ff9d4d',
  myth: '#ff4d9d',
  ancient: '#ffd700',
  eternal: '#00ffff'
}

export const RARITY_MULTIPLIER: Record<Rarity, number> = {
  common: 1,
  good: 2,
  fine: 4,
  epic: 8,
  legend: 16,
  myth: 32,
  ancient: 64,
  eternal: 128
}

export const EQUIPMENT_SLOTS: EquipmentSlot[] = [
  'head', 'neck', 'shoulder', 'chest', 'back',
  'hand', 'waist', 'legs', 'leftHand', 'rightHand',
  'ringLeft', 'ringRight'
]

export const EQUIPMENT_SLOT_NAMES: Record<EquipmentSlot, string> = {
  head: '头部',
  neck: '颈部',
  shoulder: '肩部',
  chest: '胸部',
  back: '背部',
  hand: '手部',
  waist: '腰部',
  legs: '腿部',
  leftHand: '左手',
  rightHand: '右手',
  ringLeft: '左戒指',
  ringRight: '右戒指'
}

export const PHASE_NAMES = [
  '', '建筑物', '城市', '地理', '星球', '恒星系', '星系', '宇宙'
]

export const STAT_NAMES: Record<StatType, string> = {
  attack: '攻击力',
  defense: '防御力',
  maxHp: '最大生命',
  speed: '速度',
  critRate: '暴击率',
  critDamage: '暴击伤害',
  penetration: '穿透',
  dodge: '闪避率',
  accuracy: '必中概率',
  critResist: '暴击抵抗',
  combo: '连击',
  damageReduction: '伤害减免',
  damageBonusI: '增伤区I',
  damageBonusII: '增伤区II',
  damageBonusIII: '增伤区III',
  luck: '幸运',
  gravityRange: '引力范围',
  gravityStrength: '重力强度',
  voidDamage: '虚空伤害',
  trueDamage: '真实伤害',
  timeWarp: '时空扭曲',
  massCollapse: '质量坍缩',
  dimensionTear: '维度撕裂'
}

export const STAT_CATEGORY: Record<StatType, StatCategory> = {
  attack: 'basic',
  defense: 'basic',
  maxHp: 'basic',
  speed: 'basic',
  critRate: 'advanced',
  critDamage: 'advanced',
  penetration: 'advanced',
  dodge: 'advanced',
  accuracy: 'advanced',
  critResist: 'advanced',
  combo: 'high',
  damageReduction: 'advanced',
  damageBonusI: 'advanced',
  damageBonusII: 'high',
  damageBonusIII: 'ultimate',
  luck: 'high',
  gravityRange: 'high',
  gravityStrength: 'high',
  voidDamage: 'high',
  trueDamage: 'high',
  timeWarp: 'ultimate',
  massCollapse: 'ultimate',
  dimensionTear: 'ultimate'
}

export const PHASE_UNLOCK: Record<StatCategory, number> = {
  basic: 1,
  advanced: 3,
  high: 5,
  ultimate: 7
}

export const SKILL_SLOT_COUNT = 5

// Passive Skill System
export interface PassiveStatBonus {
  stat: StatType
  value: number
  type?: 'flat' | 'percent'
}

export interface PassiveSkillEffect {
  trigger: 'always' | 'onKill' | 'onCrit' | 'onHit' | 'onDamageTaken' | 'onTurnEnd'
  statBonus?: PassiveStatBonus
  specialEffect?: 'lifestealOnKill' | 'critStreak' | 'damageReflect'
  value?: number
}

export interface PassiveSkill {
  id: string
  name: string
  description: string
  effects: PassiveSkillEffect[]
  unlockCondition: number
  icon?: string
}

export const PASSIVE_SKILLS: PassiveSkill[] = [
  {
    id: 'iron_wall',
    name: '铁壁',
    description: '防御+5%（每100防御额外+1%）',
    effects: [{ trigger: 'always', statBonus: { stat: 'defense', value: 5, type: 'percent' } }],
    unlockCondition: 100
  },
  {
    id: 'berserk',
    name: '狂暴',
    description: '生命<30%时攻击+30%',
    effects: [{ trigger: 'onDamageTaken', specialEffect: 'critStreak', value: 30 }],
    unlockCondition: 200
  },
  {
    id: 'swift',
    name: '灵敏',
    description: '速度+10%',
    effects: [{ trigger: 'always', statBonus: { stat: 'speed', value: 10, type: 'percent' } }],
    unlockCondition: 300
  },
  {
    id: 'vampiric',
    name: '吸血',
    description: '生命偷取+2%',
    effects: [{ trigger: 'onKill', specialEffect: 'lifestealOnKill', value: 2 }],
    unlockCondition: 400
  },
  {
    id: 'combo_master',
    name: '连击',
    description: '10%概率额外攻击一次（50%伤害）',
    effects: [{ trigger: 'onHit', specialEffect: 'critStreak', value: 10 }],
    unlockCondition: 500
  },
  {
    id: 'penetration',
    name: '穿透',
    description: '穿透+20',
    effects: [{ trigger: 'always', statBonus: { stat: 'penetration', value: 20 } }],
    unlockCondition: 600
  },
  {
    id: 'lucky',
    name: '幸运',
    description: '金币获取+10%',
    effects: [{ trigger: 'always', statBonus: { stat: 'luck', value: 10 } }],
    unlockCondition: 700
  },
  {
    id: 'tough',
    name: '坚韧',
    description: '受到伤害-5%',
    effects: [{ trigger: 'always', statBonus: { stat: 'damageReduction', value: 5 } }],
    unlockCondition: 800
  },
] as const

export type RebirthUpgradeCategory = 'tech' | 'skill' | 'rarity' | 'permanent'

export interface RebirthUpgrade {
  id: string
  category: RebirthUpgradeCategory
  name: string
  description: string
  maxLevel: number
  costPerLevel: number
  costScaling: number
  effectPerLevel: number
  icon: string
}

export interface RebirthUpgradeLevel {
  upgradeId: string
  currentLevel: number
}

export interface RebirthData {
  rebirthPoints: number
  totalRebirthCount: number
  upgrades: RebirthUpgradeLevel[]
  lastRebirthTime: number
}

export interface RebirthStats {
  attackBonus: number
  defenseBonus: number
  maxHpBonus: number
  critRateBonus: number
  critDamageBonus: number
  penetrationBonus: number
  goldBonusPercent: number
  expBonusPercent: number
  equipmentRarityBonus: number
  skillDamageBonus: number
  bossDamageBonus: number
}

export interface DamageLogEntry {
  damage: number
  isCrit: boolean
  type: string
  timestamp?: number
}

export interface GameVMInterface {
  playerStore: ReturnType<typeof import('../stores/playerStore').usePlayerStore>
  monsterStore: ReturnType<typeof import('../stores/monsterStore').useMonsterStore>
  gameStore: ReturnType<typeof import('../stores/gameStore').useGameStore>
  achievementStore: ReturnType<typeof import('../stores/achievementStore').useAchievementStore>
  skillStore: ReturnType<typeof import('../stores/skillStore').useSkillStore>
  trainingStore: ReturnType<typeof import('../stores/trainingStore').useTrainingStore>
  rebirthStore: ReturnType<typeof import('../stores/rebirthStore').useRebirthStore>
}
