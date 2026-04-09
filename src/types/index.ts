export type Rarity = 'common' | 'good' | 'fine' | 'epic' | 'legend' | 'myth' | 'ancient' | 'eternal'

export type EquipmentSlot = 
  | 'head' | 'neck' | 'shoulder' | 'chest' | 'back'
  | 'hand' | 'waist' | 'legs' | 'leftHand' | 'rightHand'
  | 'ringLeft' | 'ringRight'

export type AchievementCategory = 'kill' | 'growth' | 'equipment' | 'phase' | 'wealth' | 'time' | 'combo' | 'special'

export type StatType = 
  | 'attack' | 'defense' | 'maxHp' | 'speed' | 'luck'
  | 'critRate' | 'critDamage' | 'penetration' | 'dodge'
  | 'accuracy' | 'critResist' | 'combo'
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

export interface Equipment {
  id: string
  slot: EquipmentSlot
  name: string
  rarity: Rarity
  level: number
  stats: StatBonus[]
  isLocked: boolean
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
  diamond?: number
  permanentBonus?: Partial<PlayerStats>
  offlineEfficiencyBonus?: number
  skillUnlock?: string
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
