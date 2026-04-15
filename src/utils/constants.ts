// ============================================================
// Game Constants - All magic numbers centralized here
// ============================================================

/**
 * 暴击相关常量
 */
export const CRIT = {
  BASE_RATE: 5,           // 基础暴击率%
  BASE_DAMAGE: 150,       // 基础暴击伤害%
  RATE_GROWTH: 0.02,     // 每难度 +0.02% 暴击率
  DAMAGE_GROWTH: 1.0,    // 每难度 +1% 暴击伤害
  RATE_MAX: 50,           // 暴击率上限%
  DAMAGE_MIN: 150,        // 暴击伤害下限%
  DAMAGE_RATIO: 2.0,     // 暴击伤害倍率
} as const

/**
 * 怪物相关常量
 */
export const MONSTER = {
  DEFENSE_MULTIPLIER: 1.5,  // 怪物防御倍率（从 3 降到 1.5）
  BOSS_DEFENSE_MULT: 1.5,   // BOSS 防御倍率
} as const

/** 能量槽上限 */
export const GAUGE_MAX = 100

/** 伤害溢出上限 */
export const DAMAGE_OVERFLOW_MAX = 1e15

/**
 * 防御力计算常量
 * 护甲公式: damageReduction = effectiveDef / (effectiveDef + DEFENSE_DIVISOR)
 */
export const DEFENSE_DIVISOR = 200

/**
 * 命中相关常量
 */
export const HIT = {
  MIN_CHANCE: 0.05,    // 最小命中概率
  MAX_CHANCE: 0.95,   // 最大命中概率（未受命中率影响）
  ACCURACY_MAX: 80,   // 最大命中率
} as const

/**
 * 速度相关常量
 */
export const SPEED = {
  DOUBLE_TURN_RATIO: 2.0,  // 速度比 >= 2 时双动
  DAMAGE_BONUS_RATIO: 0.5, // 双动时伤害加成
  INITIAL_BONUS_MAX_RATIO: 0.5, // 先手偏移最大比例
} as const

/**
 * 生命偷取相关常量
 */
export const LIFESTEAL = {
  BASE_RATE: 0,  // 基础生命偷取率（由技能/装备提供）
} as const

/**
 * 游戏主循环相关常量
 */
export const GAME = {
  TICK_INTERVAL: 100, // 主循环间隔（毫秒）
  TICK_RATE: 16,      // 每 tick 毫秒数（约 60fps）
  SAVE_INTERVAL: 30000, // 自动存档间隔（毫秒）
  GAUGE_TICK_RATE: 10, // 能量槽每 tick 增量
} as const

/**
 * 颜色变量（从 design-system.css 迁移）
 */
export const COLORS = {
  PRIMARY: '#4a9eff',
  SECONDARY: '#2d5a87',
  SUCCESS: '#4caf50',
  WARNING: '#ff9800',
  DANGER: '#f44336',
  BACKGROUND: '#1a1a2e',
  SURFACE: '#16213e',
  TEXT: '#e0e0e0',
  TEXT_SECONDARY: '#9e9e9e',
  GOLD: '#ffd700',
  DIAMOND: '#00bcd4',
} as const

// ============================================================
// Equipment Sets
// ============================================================

export interface EquipmentSetPiece {
  stat: string
  value: number
  type?: 'percent'
}

export interface EquipmentSet {
  id: string
  name: string
  pieces: {
    2: EquipmentSetPiece[]
    4: EquipmentSetPiece[]
  }
}

export const EQUIPMENT_SETS: readonly EquipmentSet[] = [
  {
    id: 'warrior',
    name: '勇者套装',
    pieces: {
      2: [{ stat: 'attack', value: 10, type: 'percent' }],
      4: [{ stat: 'critRate', value: 15 }]
    }
  },
  {
    id: 'guardian',
    name: '守护者套装',
    pieces: {
      2: [{ stat: 'defense', value: 10, type: 'percent' }],
      4: [{ stat: 'damageReduction', value: 8 }]
    }
  },
  {
    id: 'swift',
    name: '疾风套装',
    pieces: {
      2: [{ stat: 'speed', value: 10, type: 'percent' }],
      4: [{ stat: 'firstStrikeRate', value: 20 }]
    }
  },
  {
    id: 'tyrant',
    name: '暴君套装',
    pieces: {
      2: [{ stat: 'critDamage', value: 30 }],
      4: [{ stat: 'critDamage', value: 60 }]
    }
  },
  {
    id: 'void',
    name: '虚空套装',
    pieces: {
      2: [{ stat: 'trueDamage', value: 50 }],
      4: [{ stat: 'voidDamage', value: 100 }]
    }
  }
] as const

/** Damage reduction stat is not in StatType, use a special handling */
export const DAMAGE_REDUCTION_STAT = 'damageReduction'
export const FIRST_STRIKE_RATE_STAT = 'firstStrikeRate'

// T96 难度曲线参数
export const DIFFICULTY = {
  HP_MULTIPLIER: 1.15,     // 每级 HP 乘数
  ATTACK_MULTIPLIER: 1.12, // 每级 攻击乘数
  DEFENSE_MULTIPLIER: 1.08,// 每级 防御乘数
  GOLD_MULTIPLIER: 1.18,   // 每级 金币乘数
  EXP_MULTIPLIER: 1.15,    // 每级 经验乘数
  CRIT_RATE_PER_DIFFICULTY: 0.02, // 每难度 +0.02% 暴击率
  CRIT_DAMAGE_PER_DIFFICULTY: 1.0,// 每难度 +1% 暴击伤害
} as const
