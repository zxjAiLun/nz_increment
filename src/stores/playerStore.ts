import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Player, PlayerStats, Equipment, EquipmentSlot, Skill, StatType, StatBonus, BuffValueMode, RuneSlot } from '../types'
import { createDefaultPlayer, calculateTotalStats, calculateHealing, applyEffectiveStatCaps } from '../utils/calc'
import { calculateOfflineSettlement, makeSettlement, mergeSettlements, normalizePendingOfflineReward, MIN_OFFLINE_SECONDS, type OfflineSettlement } from '../utils/offlineReward'
import { parsePositiveTimestamp } from '../utils/timestamp'
import { planEquipmentReplacement, validateEquipmentForEconomy, planEquipmentRecycle, type EquipmentReplacementDecision } from '../utils/equipmentReplacement'
import { planEquipmentAffixUpgrade } from '../utils/equipmentAffixUpgrade'
import { planEquipmentRefinement } from '../utils/equipmentRefining'
import {
  planEmbedEquipmentRune,
  planRemoveEquipmentRune,
  normalizeEquipmentRuneSlots,
  normalizeRuneInventory,
  type RuneSlotUpdate,
  reconcileRuneReferences,
  validateRuneInventory,
  validatePlayerRuneReferenceTopology
} from '../utils/equipmentRunes'
import { planRuneExperienceGain, validateRuneProgressionState } from '../utils/runeExperience'
import { planRuneGeneration, planRuneAcquisition } from '../utils/runeGeneration'
import { planRuneBatchFeeding, buildRuneTopologySnapshot, sameRuneTopologySnapshot } from '../utils/runeFeeding'
import { planRuneBatchLockChange } from '../utils/runeLocking'
import type { Rune } from './runeStore'
import { applyLuckCombatEffects } from '../utils/luck'
import { calculateActiveSets } from '../utils/equipmentSetCalculator'
import { generateEquipment, generateRandomRarity } from '../utils/equipmentGenerator'
import type { AchievementReward } from '../types'
import { EQUIPMENT_SLOTS, PHASE_UNLOCK, STAT_CATEGORY, STAT_NAMES } from '../types'
import { getUnlockedSkills, createSkillInstance } from '../utils/skillSystem'
import { useMonsterStore } from './monsterStore'
import { useTalentStore } from './talentStore'
import { useGameStore } from './gameStore'
import { useCollectionStore } from './collectionStore'
import { useTrainingStore } from './trainingStore'
import { useRebirthStore } from './rebirthStore'
import { useCultivationStore } from './cultivationStore'
import { useTitleStore } from './titleStore'
import { usePetStore } from './petStore'
import { useThemeStore, normalizeOwnedThemeIds } from './themeStore'
import { THEMES } from '../data/themes'
import { EQUIPMENT_SETS } from '../utils/constants'
import { FIRST_REWARD } from './guideStore'

/** 装备词缀升级事务结果（Phase 3.4）。cost 为实际扣除金币（失败时 0）。 */
export interface EquipmentAffixUpgradeResult {
  ok: boolean
  reason?: string
  cost: number
}

/** 装备精炼事务结果（Phase 3.5）。ok:true 返回实际扣款 cost 与精炼后 level；失败 cost 为 0。 */
export interface EquipmentRefiningResult {
  ok: boolean
  reason?: string
  cost: number
  level?: number
}

/** 装备符文镶嵌/移除事务结果（Phase 3.6）。失败 reason 说明原因，ok:false 时零修改零写盘。 */
export interface EquipmentRuneTransactionResult {
  ok: boolean
  reason?: string
}

/** 符文经验升级事务结果（Phase 3.7）。失败 reason 说明原因，ok:false 时 levelsGained = 0、零修改零写盘。 */
export interface RuneExperienceTransactionResult {
  ok: boolean
  reason?: string
  levelsGained: number
  level?: number
  exp?: number
}

/**
 * 主题购买事务结果（Phase 3.35）。
 * - ok:true：购买成功，cost 为主题价格；钻石扣除与主题所有权已随主存档 themeData 单次提交。
 * - ok:false：前置校验失败或任何异常 / 存档失败，cost 恒为 0，钻石与 ownedThemes 已完整回滚。
 */
export type ThemePurchaseResult =
  | {
      ok: true
      themeId: string
      cost: number
    }
  | {
      ok: false
      reason: string
      cost: 0
    }

/** 符文入库事务结果（Phase 3.8）。成功返回 canonical acquired Rune 与追加位置；失败零修改零写盘。 */
export interface RuneAcquisitionResult {
  ok: boolean
  reason?: string
  rune?: Rune
  insertIndex?: number
}

/**
 * 符文吞噬强化事务结果（Phase 3.11）。
 * 成功返回注入经验 expAdded、升级数 levelsGained 与升级后的目标 level/exp；
 * 失败 reason 说明原因，ok:false 时零修改零写盘（材料不消耗、目标不升级）。
 */
export interface RuneFeedingTransactionResult {
  ok: boolean
  reason?: string
  expAdded: number
  levelsGained: number
  level?: number
  exp?: number
}

/**
 * 符文批量吞噬事务结果（Phase 3.13）。
 * 成功：expAdded 为全部材料固定经验的精确整数和，consumedRuneIds 为被永久消耗材料的
 * canonical ID（按 inventoryIndex 升序），materialsConsumed === consumedRuneIds.length。
 * 失败：整批零消耗（reason 说明原因），expAdded=0、levelsGained=0、materialsConsumed=0。
 */
export type RuneBatchFeedingTransactionResult =
  | {
      ok: true
      expAdded: number
      levelsGained: number
      level: number
      exp: number
      materialsConsumed: number
      consumedRuneIds: readonly string[]
    }
  | {
      ok: false
      reason: string
      expAdded: 0
      levelsGained: 0
      materialsConsumed: 0
      consumedRuneIds: readonly string[]
    }

/**
 * 符文锁定切换事务结果（Phase 3.12）。
 * 成功返回 changed（是否发生实际切换）与最终 isLocked；
 * changed:false 表示已处于目标状态（幂等，零修改零写盘）。
 * 失败 reason 说明原因，ok:false 时 changed:false、零修改零写盘。
 */
export type RuneLockTransactionResult =
  | { ok: true; changed: boolean; isLocked: boolean }
  | { ok: false; reason: string; changed: false }

/**
 * 符文手动批量锁定/解锁事务结果（Phase 3.15）。
 * 成功返回目标状态与 selected/changed/unchanged 统计及 canonical ID 名单；
 * changedCount=0 表示全部已处于目标状态（幂等，零修改零写盘）。
 * 失败 reason 说明原因，ok:false 时全部计数为 0、零修改零写盘（整批回滚）。
 */
export type RuneBatchLockTransactionResult =
  | {
      ok: true
      isLocked: boolean
      selectedCount: number
      changedCount: number
      unchangedCount: number
      changedRuneIds: readonly string[]
      unchangedRuneIds: readonly string[]
    }
  | {
      ok: false
      reason: string
      selectedCount: 0
      changedCount: 0
      unchangedCount: 0
      changedRuneIds: readonly []
      unchangedRuneIds: readonly []
    }

export interface AttributeUpgradeConfig {
  key: StatType
  label: string
  baseCost: number
  costGrowth: number
  effectPerLevel: number
}

/**
 * 唯一属性强化配置（Phase 2.1）：删除全局 STAT_UPGRADE_COST_GROWTH/DEFAULT_…/POINTS。
 * 价格和效果必须从此配置表读取，不允许隐式默认值或不支持的属性。
 */
export const ATTRIBUTE_UPGRADES: readonly AttributeUpgradeConfig[] = [
  { key: 'attack' as StatType, label: '攻击', baseCost: 10, costGrowth: 1.1, effectPerLevel: 2 },
  { key: 'defense' as StatType, label: '防御', baseCost: 10, costGrowth: 1.1, effectPerLevel: 2 },
  { key: 'maxHp' as StatType, label: '生命', baseCost: 10, costGrowth: 1.1, effectPerLevel: 20 },
  { key: 'speed' as StatType, label: '速度', baseCost: 10, costGrowth: 1.1, effectPerLevel: 1 },
  { key: 'penetration' as StatType, label: '穿透', baseCost: 50, costGrowth: 1.15, effectPerLevel: 5 },
] as const

function getAttributeUpgradeConfig(stat: StatType): AttributeUpgradeConfig | undefined {
  return ATTRIBUTE_UPGRADES.find(item => item.key === stat)
}

/** 唯一价格函数：使用对应属性的 `baseCost` × `costGrowth^purchasedLevels`。 */
function calculateStatUpgradeCost(config: AttributeUpgradeConfig, purchasedLevels: number): number {
  return Math.max(1, Math.floor(config.baseCost * Math.pow(config.costGrowth, purchasedLevels)))
}

const SAVE_KEY = 'lollipop_adventure_save'

// T7.4 签到系统常量（文件级）
const CHECKIN_KEY = 'nz_checkin_v1'

// T8.1 月卡/战令系统常量
const MONTHLY_CARD_KEY = 'nz_monthly_card_v1'
const BATTLEPASS_KEY = 'nz_battlepass_v1'
// T8.1 战令：等级上限（单一权威常量，签到资格门与经验增长共用）。
export const BATTLE_PASS_MAX_LEVEL = 30
const LEADERBOARD_KEY = 'nz_leaderboard_v1'

// T28 离线收益系统常量
const LAST_LOGIN_KEY = 'nz_last_login'
const LAST_FLOOR_KEY = 'nz_last_floor'

// Phase 3.2.3：唯一「正向时间戳」解析统一复用 src/utils/timestamp.ts（无循环依赖的 leaf 模块，
// 由 playerStore 离线结算与 offlineReward 规范化共用，项目内只保留这一份实现）。

// T66 首次击杀系统常量
const FIRST_KILL_KEY = 'nz_first_kill_v1'

// T66 每日目标系统常量
const DAILY_KILL_KEY = 'nz_daily_kill_v1'

// T66 每日击杀目标奖励配置
// 3/6/9 击杀时发放奖励
const DAILY_KILL_REWARDS = [
  { target: 3, gold: 50, description: '3连杀' },
  { target: 6, gold: 150, description: '6连杀' },
  { target: 9, gold: 300, description: '9连杀' },
] as const

export interface CheckInState {
  lastCheckIn: number  // timestamp
  streak: number
}

// T8.1 月卡/战令接口
export interface MonthlyCardState {
  purchasedAt: number  // timestamp
  lastClaimAt: number  // timestamp
}

export interface BattlePassState {
  level: number
  exp: number
  freeRewards: string[]  // 已领取的免费奖励id
  premiumRewards: string[]  // 已领取的付费奖励id
  purchased: boolean  // 是否购买付费版
}

export interface BattlePassReward {
  id: string
  level: number
  type: 'free' | 'premium'
  reward: AchievementReward
}

// T8.3 排行榜接口
export interface LeaderboardEntry {
  name: string
  difficultyValue: number
  totalKills: number
  totalGold: number
  updatedAt: number
}

// T66 首次击杀/每日目标相关接口
export interface FirstKillState {
  templates: string[]  // 已首次击杀的怪物模板ID列表
}

export interface DailyKillState {
  date: string  // 日期字符串 YYYY-MM-DD
  count: number  // 当日击杀数
  claimed: number[]  // 已领取的奖励索引 [0,1,2] = 3连杀和6连杀已领
}

export interface KillBonusResult {
  firstKillBonus: boolean       // 是否触发首杀奖励
  firstKillGold: number        // 首杀额外金币
  firstKillExp: number         // 首杀额外经验
  dailyGoalReached: number     // 达到的每日目标索引（-1=未达到）
  dailyGoalGold: number        // 每日目标奖励金币
}

// T8.1 月卡常量
const MONTHLY_CARD_DURATION = 30 * 24 * 60 * 60 * 1000

// T8.1 战令奖励表（30级）
export const BATTLE_PASS_REWARDS: BattlePassReward[] = [
  { id: 'bp_1', level: 1, type: 'free', reward: { gold: 100 } },
  { id: 'bp_2', level: 2, type: 'free', reward: { diamond: 1 } },
  { id: 'bp_3', level: 3, type: 'free', reward: { gold: 300 } },
  { id: 'bp_4', level: 4, type: 'free', reward: { exp: 200 } },
  { id: 'bp_5', level: 5, type: 'free', reward: { gold: 500, diamond: 2 } },
  { id: 'bp_6', level: 6, type: 'free', reward: { gold: 200 } },
  { id: 'bp_7', level: 7, type: 'free', reward: { exp: 500 } },
  { id: 'bp_8', level: 8, type: 'free', reward: { diamond: 3 } },
  { id: 'bp_9', level: 9, type: 'free', reward: { gold: 800 } },
  { id: 'bp_10', level: 10, type: 'free', reward: { gold: 1000, equipmentTicket: 1 } },
  { id: 'bp_11', level: 11, type: 'free', reward: { exp: 1000 } },
  { id: 'bp_12', level: 12, type: 'free', reward: { gold: 500 } },
  { id: 'bp_13', level: 13, type: 'free', reward: { diamond: 5 } },
  { id: 'bp_14', level: 14, type: 'free', reward: { gold: 1500 } },
  { id: 'bp_15', level: 15, type: 'free', reward: { exp: 2000, legendaryEquipment: 1 } },
  { id: 'bp_16', level: 16, type: 'free', reward: { gold: 1000 } },
  { id: 'bp_17', level: 17, type: 'free', reward: { exp: 1500 } },
  { id: 'bp_18', level: 18, type: 'free', reward: { diamond: 8 } },
  { id: 'bp_19', level: 19, type: 'free', reward: { gold: 2000 } },
  { id: 'bp_20', level: 20, type: 'free', reward: { gold: 3000, equipmentTicket: 2 } },
  { id: 'bp_21', level: 21, type: 'free', reward: { exp: 3000 } },
  { id: 'bp_22', level: 22, type: 'free', reward: { gold: 2000 } },
  { id: 'bp_23', level: 23, type: 'free', reward: { diamond: 10 } },
  { id: 'bp_24', level: 24, type: 'free', reward: { exp: 5000 } },
  { id: 'bp_25', level: 25, type: 'free', reward: { gold: 5000, legendaryEquipment: 1 } },
  { id: 'bp_26', level: 26, type: 'free', reward: { gold: 3000 } },
  { id: 'bp_27', level: 27, type: 'free', reward: { exp: 5000 } },
  { id: 'bp_28', level: 28, type: 'free', reward: { diamond: 15 } },
  { id: 'bp_29', level: 29, type: 'free', reward: { gold: 8000 } },
  { id: 'bp_30', level: 30, type: 'free', reward: { exp: 10000, gold: 10000 } },
  // 付费奖励（premium）
  { id: 'bp_p1', level: 1, type: 'premium', reward: { diamond: 5 } },
  { id: 'bp_p2', level: 2, type: 'premium', reward: { gold: 500 } },
  { id: 'bp_p3', level: 3, type: 'premium', reward: { diamond: 10 } },
  { id: 'bp_p4', level: 4, type: 'premium', reward: { exp: 1000 } },
  { id: 'bp_p5', level: 5, type: 'premium', reward: { legendaryEquipment: 1 } },
  { id: 'bp_p6', level: 6, type: 'premium', reward: { diamond: 20 } },
  { id: 'bp_p7', level: 7, type: 'premium', reward: { gold: 3000 } },
  { id: 'bp_p8', level: 8, type: 'premium', reward: { passive: 1 } },
  { id: 'bp_p9', level: 9, type: 'premium', reward: { diamond: 30 } },
  { id: 'bp_p10', level: 10, type: 'premium', reward: { legendaryEquipment: 1 } },
  { id: 'bp_p15', level: 15, type: 'premium', reward: { gold: 10000 } },
  { id: 'bp_p20', level: 20, type: 'premium', reward: { legendaryEquipment: 1, diamond: 50 } },
  { id: 'bp_p25', level: 25, type: 'premium', reward: { exp: 20000, gold: 20000 } },
  { id: 'bp_p30', level: 30, type: 'premium', reward: { legendaryEquipment: 1, diamond: 100 } },
]

export const CHECKIN_REWARDS: AchievementReward[] = [
  { gold: 100 },
  { gold: 200 },
  { diamond: 1 },
  { gold: 500, equipmentTicket: 1 },
  { diamond: 2 },
  { gold: 1000 },
  { diamond: 5, legendaryEquipment: 1 },
]

export const usePlayerStore = defineStore('player', () => {
  const player = ref<Player>(createDefaultPlayer())
  const pendingOfflineReward = ref<OfflineSettlement | null>(null)
  // 战斗 Buff 以「战斗剩余毫秒」计时（remainingMs），由 gameStore.gameLoop 的 updateActiveBuffs 按战斗时间递减。
  // 不使用 Date.now()：暂停时停止、gameSpeed 倍速时同步加速，且与模拟器（秒级）语义一致。
  const activeBuffs = ref<Map<StatType, { value: number; mode: BuffValueMode; remainingMs: number; totalDurationMs: number }>>(new Map())
  const statUpgradeCounts = ref<Map<StatType, number>>(new Map())
  const pendingEquipment = ref<Equipment | null>(null)

  // Phase 3.6：符文 inventory（唯一权威来源，主存档持久化）。Rune 对象不可变，
  // 装备绑定状态完全由 player.equipment[*].runeSlots 拓扑派生（见 equipmentRunes.ts）。
  const runeInventory = ref<Rune[]>([])

  // T28 离线收益追踪（保留字段，仅作旧存档迁移读取；结算不再使用）
  const lastLoginTime = ref(Date.now())

  // Phase 3.2：统一离线时间源（权威 checkpoint，存入主存档）
  const lastOfflineCheckpointAt = ref<number>(Date.now())

  // T66 首次击杀追踪
  const firstKillTemplates = ref<Set<string>>(new Set())

  // T66 每日目标追踪
  const dailyKillCount = ref(0)
  const dailyKillDate = ref('')
  const dailyKillClaimed = ref<Set<number>>(new Set())

  function recordLogout(): boolean {
    // 仅在页面隐藏/关闭时记录最后活跃时刻并落盘；结算统一走 lastOfflineCheckpointAt。
    // checkpoint 不得在写入成功前推进：saveGame 仅在 setItem 成功后才会把
    // lastOfflineCheckpointAt 设为 now，因此即便 LAST_FLOOR_KEY 写入失败，内存 checkpoint
    // 也不会被提前推进；其失败被吞掉，不影响 checkpoint 落盘。
    // Phase 3.47：返回主存档提交是否成功（true/false），供 App beforeunload 边界分类；
    // Date.now() 只调用一次、saveGame() 恰好一次，checkpoint 使用同一个 now。
    const now = Date.now()
    try {
      localStorage.setItem(LAST_FLOOR_KEY, String(player.value.level))
    } catch {
      // 楼层信息保存失败不致命，不阻断 checkpoint 落盘
    }
    return saveGame(now)
  }

  // T8.1 月卡状态
  const monthlyCard = ref<MonthlyCardState | null>(null)

  // T8.1 战令状态
  const battlePass = ref<BattlePassState>({
    level: 0,
    exp: 0,
    freeRewards: [],
    premiumRewards: [],
    purchased: false
  })

  // T8.3 排行榜
  const leaderboard = ref<LeaderboardEntry[]>([])

  // T8.1 加载月卡/战令/排行榜数据
  function loadBattlePassData() {
    try {
      const mc = localStorage.getItem(MONTHLY_CARD_KEY)
      if (mc) monthlyCard.value = JSON.parse(mc)

      const bp = localStorage.getItem(BATTLEPASS_KEY)
      if (bp) {
        const parsed = JSON.parse(bp)
        battlePass.value = parsed
      }

      const lb = localStorage.getItem(LEADERBOARD_KEY)
      if (lb) leaderboard.value = JSON.parse(lb)
    } catch {
      // silent
    }
  }

  // T8.1 月卡：购买（消耗钻石，30天有效）
  function purchaseMonthlyCard(): boolean {
    const cost = 30  // 30钻石购买
    if (player.value.diamond < cost) return false

    player.value.diamond -= cost
    const now = Date.now()
    monthlyCard.value = {
      purchasedAt: now,
      lastClaimAt: 0
    }
    localStorage.setItem(MONTHLY_CARD_KEY, JSON.stringify(monthlyCard.value))
    saveGame()
    return true
  }

  // T8.1 月卡：领取每日奖励（100钻石）。Phase 3.75 补偿事务：
  // 时间/资格门 → 内存快照 → 候选前 raw 快照 → 纯内存候选 → Main→Monthly 持久化
  // → 任一点失败精确回滚内存 +（仅 Main 已写盘时）逆序补偿 raw。
  function claimMonthlyCardReward(options?: { now?: number }): AchievementReward | null {
    let ts: number
    try {
      ts = options?.now ?? Date.now()
    } catch {
      return null
    }
    if (!Number.isSafeInteger(ts) || ts <= 0) return null
    const mc = monthlyCard.value
    if (!mc) return null
    const pa = mc.purchasedAt
    const la = mc.lastClaimAt
    if (!Number.isSafeInteger(pa) || !Number.isSafeInteger(la)) return null
    if (ts > pa + MONTHLY_CARD_DURATION) return null
    if (new Date(la).setHours(0, 0, 0, 0) === new Date(ts).setHours(0, 0, 0, 0)) return null
    const pL = la
    const pD = player.value.diamond
    const pC = lastOfflineCheckpointAt.value
    let mp: string | null
    try {
      mp = localStorage.getItem(SAVE_KEY)
      localStorage.getItem(MONTHLY_CARD_KEY) // 候选前读取月卡 raw（合同）；抛错→零 mutation
    } catch {
      return null
    }
    mc.lastClaimAt = ts
    applyDiamondRewardInMemory(100)
    function rb() {
      mc!.lastClaimAt = pL
      player.value.diamond = pD
      lastOfflineCheckpointAt.value = pC
    }
    if (!safeSave(ts)) {
      rb()
      return null
    }

    try {
      localStorage.setItem(MONTHLY_CARD_KEY, JSON.stringify(mc))
    } catch {
      rb()
      try {
        if (mp === null) localStorage.removeItem(SAVE_KEY)
        else localStorage.setItem(SAVE_KEY, mp)
      } catch {
        throw new Error('monthly card claim persistence rollback failed')
      }
      return null
    }
    return { gold: 0, diamond: 100 }
  }

  // T8.1 月卡：检查是否有效
  function isMonthlyCardActive(): boolean {
    if (!monthlyCard.value) return false
    const now = Date.now()
    return now <= monthlyCard.value.purchasedAt + MONTHLY_CARD_DURATION
  }

  // T8.1 月卡：获取剩余天数
  function getMonthlyCardRemainingDays(): number {
    if (!monthlyCard.value) return 0
    const now = Date.now()
    const expiry = monthlyCard.value.purchasedAt + MONTHLY_CARD_DURATION
    if (now > expiry) return 0
    return Math.ceil((expiry - now) / (24 * 60 * 60 * 1000))
  }

  // T8.1 月卡加成倍率（20%金币加成）
  function getMonthlyCardGoldBonus(): number {
    return isMonthlyCardActive() ? 0.2 : 0
  }

  // T8.1 战令：购买付费版
  function purchaseBattlePass(): boolean {
    const cost = 50  // 50钻石
    if (player.value.diamond < cost) return false

    player.value.diamond -= cost
    battlePass.value.purchased = true
    saveBattlePassData()
    return true
  }

  // Phase 3.60：纯内存战令经验增长（含升级），不写盘。
  // 仅由外层补偿事务在快照后调用，持久化由事务按序统一提交。
  function applyBattlePassExpInMemory(amount: number) {
    battlePass.value.exp += amount
    // 升级：每1000 exp升1级，上限 BATTLE_PASS_MAX_LEVEL 级
    while (battlePass.value.exp >= 1000 && battlePass.value.level < BATTLE_PASS_MAX_LEVEL) {
      battlePass.value.exp -= 1000
      battlePass.value.level++
    }
    battlePass.value.level = Math.min(battlePass.value.level, BATTLE_PASS_MAX_LEVEL)
  }

  // T8.1 战令：添加经验（升级用）
  function addBattlePassExp(amount: number) {
    applyBattlePassExpInMemory(amount)
    saveBattlePassData()
  }

  // T8.1 战令：领取奖励
  function claimBattlePassReward(level: number): AchievementReward | null {
    const rewardEntry = BATTLE_PASS_REWARDS.find(r => r.level === level && r.type === 'free')
    if (!rewardEntry) return null
    if (battlePass.value.level < level) return null
    if (battlePass.value.freeRewards.includes(rewardEntry.id)) return null  // 已领取

    battlePass.value.freeRewards.push(rewardEntry.id)
    saveBattlePassData()
    return grantBattlePassReward(rewardEntry.reward)
  }

  function claimBattlePassPremiumReward(level: number): AchievementReward | null {
    if (!battlePass.value.purchased) return null
    const rewardEntry = BATTLE_PASS_REWARDS.find(r => r.level === level && r.type === 'premium')
    if (!rewardEntry) return null
    if (battlePass.value.level < level) return null
    if (battlePass.value.premiumRewards.includes(rewardEntry.id)) return null

    battlePass.value.premiumRewards.push(rewardEntry.id)
    saveBattlePassData()
    return grantBattlePassReward(rewardEntry.reward)
  }

  function grantBattlePassReward(reward: AchievementReward): AchievementReward {
    if (reward.gold) addGold(reward.gold)
    if (reward.diamond) addDiamond(reward.diamond)
    if (reward.exp) addExperience(reward.exp)
    if (reward.equipmentTicket) player.value.equipmentTickets += reward.equipmentTicket
    if (reward.legendaryEquipment) {
      const equipment = generateRandomEquipment()
      if (equipment) {
        equipment.rarity = 'legend'
        autoEquipIfBetter(equipment)
      }
    }
    if (reward.passive) {
      // 发放被动技能点（暂记入玩家属性）
    }
    return reward
  }

  function saveBattlePassData() {
    localStorage.setItem(BATTLEPASS_KEY, JSON.stringify(battlePass.value))
  }

  function getBattlePassProgress(): { level: number; exp: number; expNeeded: number; percent: number } {
    const expNeeded = 1000
    return {
      level: battlePass.value.level,
      exp: battlePass.value.exp,
      expNeeded,
      percent: Math.min(100, (battlePass.value.exp / expNeeded) * 100)
    }
  }

  // T8.3 排行榜：更新记录
  function updateLeaderboard(name: string) {
    const entry: LeaderboardEntry = {
      name,
      difficultyValue: player.value.stats.size > 0 ? player.value.stats.size : 1,
      totalKills: player.value.totalKillCount,
      totalGold: player.value.gold,
      updatedAt: Date.now()
    }
    // 合并同名记录
    const existIdx = leaderboard.value.findIndex(e => e.name === name)
    if (existIdx >= 0) {
      leaderboard.value[existIdx] = entry
    } else {
      leaderboard.value.push(entry)
    }
    leaderboard.value.sort((a, b) => b.difficultyValue - a.difficultyValue)
    leaderboard.value = leaderboard.value.slice(0, 100)
    localStorage.setItem(LEADERBOARD_KEY, JSON.stringify(leaderboard.value))
  }

  function getLeaderboard(): LeaderboardEntry[] {
    return leaderboard.value
  }
  
  // 清理已到期 buff（remainingMs <= 0）。updateActiveBuffs 每帧已处理，这里作为保守兜底。
  function cleanupExpiredBuffs() {
    for (const [stat, buff] of activeBuffs.value) {
      if (buff.remainingMs <= 0) {
        activeBuffs.value.delete(stat)
      }
    }
  }

  // 长期总属性（不含临时战斗 Buff）：装备/天赋/套装/称号/宠物/转生等稳定来源都包含，
  // 但 activeBuffs 不进入。离线结算使用此 getter，避免把短时 Buff 算进离线收益。
  function computeBaseStats(): PlayerStats {
    const cultivation = useCultivationStore()
    const stats = calculateTotalStats(player.value, {
      starMultiplier: cultivation.starMultiplier,
      ascensionMultiplier: cultivation.ascensionMultiplier,
      constellationBonus: cultivation.getConstellationBonus()
    }, runeInventory.value)
    const titleStore = useTitleStore()
    const petStore = usePetStore()
    const rebirthStore = useRebirthStore()
    const talentStore = useTalentStore()
    const rebirthStats = rebirthStore.rebirthStats

    stats.attack += rebirthStats.attackBonus
    stats.defense += rebirthStats.defenseBonus
    stats.maxHp += rebirthStats.maxHpBonus
    stats.critRate += rebirthStats.critRateBonus
    stats.critDamage += rebirthStats.critDamageBonus
    stats.penetration += rebirthStats.penetrationBonus

    // T18.4 穿透线性成长（每难度 +0.1）
    const monsterStore = useMonsterStore()
    stats.penetration += Math.floor(monsterStore.difficultyValue * 0.1)

    // Apply equipped title bonuses (single-player local bonus source)
    const equippedTitleEffect = titleStore.getEquippedEffect()
    if (equippedTitleEffect) {
      const allowedStats = new Set(['attack', 'defense', 'maxHp', 'speed', 'critRate', 'critDamage', 'penetration'])
      if (allowedStats.has(equippedTitleEffect.stat)) {
        const statKey = equippedTitleEffect.stat as keyof PlayerStats
        stats[statKey] = (stats[statKey] || 0) + equippedTitleEffect.value
      }
      if (equippedTitleEffect.stat2 && equippedTitleEffect.value2 && allowedStats.has(equippedTitleEffect.stat2)) {
        const statKey2 = equippedTitleEffect.stat2 as keyof PlayerStats
        stats[statKey2] = (stats[statKey2] || 0) + equippedTitleEffect.value2
      }
    }

    // Apply equipped pet bonuses
    if (petStore.equippedPet) {
      const petStats = petStore.getStats(petStore.equippedPet)
      stats.attack += petStats.attack
      stats.defense += petStats.defense
      stats.maxHp += petStats.maxHp
      stats.speed += petStats.speed
    }

    // Apply equipment set bonuses
    const activeSets = calculateActiveSets(player.value.equipment)
    for (const bonus of activeSets) {
      if (bonus.effect.stat) {
        const { stat, value, type } = bonus.effect.stat
        if (type === 'percent') {
          stats[stat] = (stats[stat] || 0) * (1 + value / 100)
        } else {
          stats[stat] = (stats[stat] || 0) + value
        }
      }
    }

    for (const bonus of talentStore.getStatBonuses()) {
      if (bonus.type === 'percent') {
        stats[bonus.stat] = (stats[bonus.stat] || 0) * (1 + bonus.value / 100)
      } else {
        stats[bonus.stat] = (stats[bonus.stat] || 0) + bonus.value
      }
    }

    // Phase 3.1：在所有幸运来源（原始 + 装备 + 天赋 + 套装 + 称号 + 宠物）汇总进 stats.luck 之后，
    // 一次性应用幸运战斗属性（暴击率 / 穿透）。此处是 runtime 侧唯一的应用点，避免重复注入。
    applyLuckCombatEffects(stats)

    applyEffectiveStatCaps(stats)

    return stats
  }

  const persistentTotalStats = computed<PlayerStats>(() => computeBaseStats())

  const totalStats = computed<PlayerStats>(() => {
    const stats = computeBaseStats()

    for (const [stat, buff] of activeBuffs.value) {
      // 仅应用仍未到期的战斗 Buff（防御性过滤；updateActiveBuffs 已逐帧清理）
      if (buff.remainingMs > 0) {
        if (buff.mode === 'flat') {
          stats[stat] = (stats[stat] ?? 0) + buff.value
        } else {
          stats[stat] = (stats[stat] ?? 0) * (1 + buff.value / 100)
        }
      }
    }

    // Buff 在基础属性上限收敛之后叠加，这里再次把暴击率收敛到现有有效上限（80），
    // 保证「暴击率+30 百分点」这类 flat Buff 不会把最终暴击率推过上限。
    if (stats.critRate > 80) stats.critRate = 80

    player.value.maxHp = stats.maxHp

    return stats
  })
  
  // Phase 3.4 / 3.4.1：旧存档迁移——修复 stats ↔ affixes 双模型分叉。
  // 关键约束（Phase 3.4.1）：双向唯一映射 + 迁移顺序无关。
  //   - upgradeLevel > 0：玩家已付费升级，stats.value 同步为 affix.value（使真实生效）
  //   - upgradeLevel === 0：stats 为权威，affix.value 同步回 stats.value（不凭空赠送）
  // 模糊 / 损坏 / 无法唯一对应（同一 stat 存在多个 affix、同一类型存在多个 stat、
  //   合法 affix 与损坏 affix 指向同一 stat）：不猜测、不依赖数组顺序，
  //   仅将相关 affix 的 isUpgradeable 置 false 禁止后续升级，数值一律保持原样。
  // 采用两阶段：第一阶段只分析构建拓扑（不修改），第二阶段按完整拓扑统一应用。
  function isWellFormedAffix(affix: unknown): boolean {
    if (!affix || typeof affix !== 'object') return false
    const a = affix as Record<string, unknown>
    return (
      typeof a.stat === 'string' &&
      Object.prototype.hasOwnProperty.call(STAT_NAMES, a.stat) &&
      typeof a.value === 'number' &&
      Number.isFinite(a.value) &&
      (a.value as number) >= 0 &&
      typeof a.isUpgradeable === 'boolean' &&
      typeof a.upgradeLevel === 'number' &&
      Number.isInteger(a.upgradeLevel) &&
      (a.upgradeLevel as number) >= 0
    )
  }

  function normalizeEquipmentAffixes(equipment: Equipment): void {
    const validation = validateEquipmentForEconomy(equipment)
    if (!validation.ok) return // 损坏装备：保持安全，不迁移
    if (!Array.isArray(equipment.affixes)) return

    const statsArr = equipment.stats

    // ---- 第一阶段：只分析，不修改 ----
    // 每个合法 stat 对应的 stats 索引（type 匹配且 value 有限非负）
    const statToStatIndices = new Map<string, number[]>()
    if (Array.isArray(statsArr)) {
      for (let si = 0; si < statsArr.length; si++) {
        const s = statsArr[si]
        if (!s || typeof s !== 'object') continue
        const t = s.type
        if (!Object.prototype.hasOwnProperty.call(STAT_NAMES, t)) continue
        const arr = statToStatIndices.get(t) ?? []
        arr.push(si)
        statToStatIndices.set(t, arr)
      }
    }

    // 每个合法 stat 对应的 affix 声明索引（不论完整与否，只要声明该 stat）
    const statToAffixIndices = new Map<string, number[]>()
    for (let ai = 0; ai < equipment.affixes.length; ai++) {
      const affix = equipment.affixes[ai]
      if (!affix || typeof affix !== 'object') continue
      const stat = affix.stat
      if (!Object.prototype.hasOwnProperty.call(STAT_NAMES, stat)) continue
      const arr = statToAffixIndices.get(stat) ?? []
      arr.push(ai)
      statToAffixIndices.set(stat, arr)
    }

    // ---- 第二阶段：按完整拓扑统一应用 ----
    const forbid = new Set<number>()

    // 1) 不完整 affix（含声明非法/缺失 stat）一律禁止升级
    for (let ai = 0; ai < equipment.affixes.length; ai++) {
      if (!isWellFormedAffix(equipment.affixes[ai])) forbid.add(ai)
    }

    // 2) 对每个合法 stat 判断唯一映射（statIndices===1 且 affixIndices===1）
    for (const [stat, affixIndices] of statToAffixIndices) {
      const statIndices = statToStatIndices.get(stat) ?? []
      const unique = statIndices.length === 1 && affixIndices.length === 1
      if (!unique) {
        // 模糊/损坏：禁止所有声明该 stat 的 affix，且不动任何数值（含不依赖数组顺序）
        for (const ai of affixIndices) forbid.add(ai)
        continue
      }
      const ai = affixIndices[0]
      const si = statIndices[0]
      const affix = equipment.affixes[ai]
      // 唯一但必须完整（单条损坏也禁止，绝不把 NaN/Inf 写入权威 stats）
      if (!isWellFormedAffix(affix)) {
        forbid.add(ai)
        continue
      }
      const statObj = statsArr[si]
      const statValue = statObj.value
      if (typeof statValue !== 'number' || !Number.isFinite(statValue) || statValue < 0) {
        forbid.add(ai)
        continue
      }

      if (affix.upgradeLevel > 0) {
        // 玩家已付费：stats 同步 affix，使升级真实生效
        statObj.value = affix.value
      } else if (affix.value !== statValue) {
        // upgradeLevel === 0：stats 为权威，affix 回写
        affix.value = statValue
      }
    }

    // 统一应用禁止标记（仅置 false，永不置 true；不修改任何 value）
    for (const ai of forbid) {
      const affix = equipment.affixes[ai]
      if (affix && typeof affix === 'object') affix.isUpgradeable = false
    }
  }

  function loadGame() {
    // Phase 3.36 Repair 1：loadGame 一开始就取得 themeStore，保证「无主存档 / 主存档损坏」
    // 的启动路径也完成所有权水合与授权对账（themeStore 初始化读取的 legacy ownedThemes
    // 只是迁移来源，不代表最终所有权；nz_theme 不能授予访问权限）。
    const themeStore = useThemeStore()

    try {
      const saved = localStorage.getItem(SAVE_KEY)
      if (saved) {
        const data = JSON.parse(saved)
        const defaultPlayer = createDefaultPlayer()
        player.value = {
          ...defaultPlayer,
          ...data.player,
          skills: Array.isArray(data.player.skills) ? data.player.skills : [null, null, null, null, null],
          stats: {
            ...defaultPlayer.stats,
            ...data.player.stats
          }
        }

        // Phase 3.4：旧存档迁移——规范 stats ↔ affixes 双模型分叉。
        // 必须在计算总属性与离线收益前完成，使迁移后的数值立即生效，
        // 并随末尾 saveGame(now) 落盘（迁移结果持久化）。
        if (player.value.equipment) {
          for (const slot of EQUIPMENT_SLOTS) {
            const eq = player.value.equipment[slot]
            if (eq) normalizeEquipmentAffixes(eq)
          }
        }

        // Phase 3.6：旧装备符文三孔迁移 + 主存档 inventory 水合 + 全局拓扑对账。
        // 必须在装备总属性计算 / 离线结算 / 候选存档写回之前完成，使迁移后的符文属性立即生效，
        // 并随末尾 saveGame(now) 落盘（迁移结果持久化）。
        if (player.value.equipment) {
          for (const slot of EQUIPMENT_SLOTS) {
            const eq = player.value.equipment[slot]
            if (eq) normalizeEquipmentRuneSlots(eq)
          }
        }
        // 水合 inventory（缺失 → []；损坏 → 不注入非法 Rune、不抛异常）
        runeInventory.value = normalizeRuneInventory(data.runeData?.inventory)
        // 全局拓扑对账：悬空/重复引用全部清空（与装备/槽位遍历顺序无关）
        reconcileRuneReferences(player.value.equipment, runeInventory.value)

        // Phase 3.35：主题所有权水合（主存档优先于 legacy nz_owned_themes）。
        // 只按「主存档是否含 themeData 自身属性」决定是否回退 legacy：
        //  - themeData 属性完全缺失 → 允许读取 legacy 并迁移；
        //  - themeData 属性存在（无论合法或损坏）→ 一律规范化主存档内容，绝不借旧 key
        //    夺回权威；null/数字/字符串/数组/空对象/ownedThemes 损坏一律规范化为至少 ['default']。
        // 末尾 saveGame(now) 会把修复后的 canonical 结果写回主存档。
        if (Object.prototype.hasOwnProperty.call(data, 'themeData')) {
          const rawThemeData = (data as Record<string, unknown>).themeData
          const rawOwnedThemes =
            rawThemeData !== null &&
            typeof rawThemeData === 'object' &&
            !Array.isArray(rawThemeData)
              ? (rawThemeData as Record<string, unknown>).ownedThemes
              : undefined
          themeStore.replaceOwnedThemes(normalizeOwnedThemeIds(rawOwnedThemes))
        } else {
          themeStore.replaceOwnedThemes(normalizeOwnedThemeIds(themeStore.ownedThemes))
        }

        // 加载怪物进度
        if (data.monsterData) {
          const monsterStore = useMonsterStore()
          monsterStore.setProgress(
            data.monsterData.difficultyValue || 0,
            data.monsterData.monsterLevel || 1
          )
        }

        // 加载游戏数据
        if (data.gameData) {
          const gameStore = useGameStore()
          if (data.gameData.damageStats) {
            gameStore.damageStats = data.gameData.damageStats
          }
          if (data.gameData.battleLog) {
            gameStore.battleLog = data.gameData.battleLog
          }
        }

        // 加载练功房进度
        if (data.trainingData) {
          const trainingStore = useTrainingStore()
          if (data.trainingData.trainingLevel) {
            trainingStore.trainingLevel = data.trainingData.trainingLevel
          }
          if (data.trainingData.trainingDifficulty) {
            trainingStore.trainingDifficulty = data.trainingData.trainingDifficulty
          }
        }

        // Phase 3.2.1：无条件水合 pending。存档显式 pendingOfflineReward:null 或缺失旧字段时，
        // 也必须清空内存中可能残留的旧 pending，避免重复加载 / 导入存档 / 热重载产生幽灵奖励。
        pendingOfflineReward.value = normalizePendingOfflineReward(data.pendingOfflineReward)

        // Phase 2.1：加载属性强化购买次数（兼容旧存档：缺失时按 0 初始化）。
        statUpgradeCounts.value = new Map()
        if (Array.isArray(data.statUpgradeCounts)) {
          for (const [key, count] of data.statUpgradeCounts) {
            const n = Math.max(0, Math.floor(Number(count))) || 0
            if (Number.isFinite(n) && getAttributeUpgradeConfig(key as StatType)) {
              statUpgradeCounts.value.set(key as StatType, n)
            }
          }
        }

        // Phase 3.2.1：统一离线结算（单一时间源 lastOfflineCheckpointAt）。
        // 迁移严格按「主存档字段 → 旧 LAST_LOGIN_KEY → player.lastLoginTime → 当前时间」回退，
        // 且全程经 parsePositiveTimestamp：缺失 / 空串 / 损坏的 key 一律视为 null，
        // 绝不会把 Number(null)===0 误当有效时间戳（那会算出 ~56 年并截断为满 24h 收益）。
        const now = Date.now()
        const savedCheckpoint = parsePositiveTimestamp(data.lastOfflineCheckpointAt)
        const legacyCheckpoint = parsePositiveTimestamp(localStorage.getItem(LAST_LOGIN_KEY))
        const playerCheckpoint = parsePositiveTimestamp(player.value.lastLoginTime)
        const checkpoint = savedCheckpoint ?? legacyCheckpoint ?? playerCheckpoint ?? now

        // Phase 3.2.3：在成功落盘前，内存 checkpoint 始终对齐磁盘旧值（权威时间源）。
        // 写入失败时 saveGame 不会推进它，候选奖励仍挂在内存中等待下次成功存档/领取，不丢失。
        lastOfflineCheckpointAt.value = checkpoint

        const elapsedSeconds = Math.max(0, (now - checkpoint) / 1000)

        if (elapsedSeconds >= MIN_OFFLINE_SECONDS) {
          const stats = persistentTotalStats.value
          const next = calculateOfflineSettlement({
            offlineSeconds: elapsedSeconds,
            attack: stats.attack,
            effectiveLuck: stats.luck,
            offlineEfficiencyBonus: player.value.offlineEfficiencyBonus
          })
          player.value.totalOfflineTime += elapsedSeconds
          pendingOfflineReward.value = pendingOfflineReward.value
            ? mergeSettlements(pendingOfflineReward.value, next)
            : makeSettlement(next)
        }

        cleanupExpiredBuffs() // T73 加载时清理过期buff

        // Phase 3.2.3：尝试把「候选奖励（old pending + 本次新区间）」原子落盘。
        // 写入成功 → saveGame 在 setItem 成功后推进 checkpoint 到 now，候选奖励与 checkpoint 一起落盘，
        //   保证同一时间段只结算一次。
        // 写入失败 → 不回滚：内存保留完整候选奖励与累加后的 totalOfflineTime，
        //   checkpoint 不因 saveGame 失败而推进（仍等于磁盘旧值），磁盘内容保持不变。
        //   下一次自动存档 / 手动存档 / 领取都会原子提交它；
        //   若在此之前刷新页面，因 checkpoint 未推进，会从磁盘旧 checkpoint 重新计算该区间
        //   （此前没有任何成功保存或领取，不会重复发放）。
        saveGame(now)
      } else {
        // Phase 3.36 Repair 1：没有主存档时，themeStore 初始化读取的 legacy ownedThemes
        // 是唯一可用迁移来源。再次规范化收敛后，交由末尾 reconcileCurrentTheme 对账：
        // legacy 真正拥有且 nz_theme 相同时允许保持，否则回退 default。
        themeStore.replaceOwnedThemes(normalizeOwnedThemeIds(themeStore.ownedThemes))
      }

      loadBattlePassData()

      // T66 加载首次击杀数据
      loadFirstKills()
      // T66 加载每日目标数据
      loadDailyKills()
    } catch (e) {
      player.value = createDefaultPlayer()
      // 解析失败时同步清空属性强化购买次数，避免沿用损坏存档里的旧 count。
      statUpgradeCounts.value = new Map()
      // Phase 3.36 Repair 1：整个主存档损坏 / 加载异常 → 主题所有权 fail-closed 为
      // ['default']，不得使用陈旧 nz_owned_themes 恢复付费主题；末尾 reconcile 会把
      // 未授权 nz_theme 收敛到 default 并应用正确 CSS。
      themeStore.replaceOwnedThemes(['default'])
    }

    // Phase 3.36 Repair 1：所有退出分支（合法 / 无存档 / 损坏）都必须完成授权对账——
    // nz_theme 只是显示偏好，不能授予所有权；未授权/未知/损坏的选择 fail-closed 收敛
    // 到 default 并应用正确 CSS。
    themeStore.reconcileCurrentTheme()
  }
  
  function saveGame(checkpointAt: number = Date.now()): boolean {
    // Phase 3.2.2：checkpoint 不在写入前永久修改内存值——只在写入成功后提交。
    // 这样写入失败时内存 checkpoint 仍停留在「结算前」，配合 loadGame / claimOfflineReward
    // 的回滚逻辑，可保证「结算与推进 checkpoint 一起落盘，失败则整体不生效」。
    // checkpointAt 必须经过 parsePositiveTimestamp 规整：传入非正有限值（如 Number(null)===0）
    // 一律回退到当前时间，绝不会把无效时间戳当有效 checkpoint 落盘。
    const nextCheckpoint = parsePositiveTimestamp(checkpointAt) ?? Date.now()
    const monsterStore = useMonsterStore()
    const gameStore = useGameStore()
    const trainingStore = useTrainingStore()

    const saveData = {
      player: player.value,
      pendingOfflineReward: pendingOfflineReward.value,
      lastOfflineCheckpointAt: nextCheckpoint,
      statUpgradeCounts: Array.from(statUpgradeCounts.value.entries()),
      monsterData: {
        difficultyValue: monsterStore.difficultyValue,
        monsterLevel: monsterStore.monsterLevel
      },
      gameData: {
        damageStats: gameStore.damageStats,
        battleLog: gameStore.battleLog
      },
      trainingData: {
        trainingLevel: trainingStore.trainingLevel,
        trainingDifficulty: trainingStore.trainingDifficulty
      },
      // Phase 3.6：符文 inventory 唯一持久化来源（不另建第二个 localStorage key）
      runeData: {
        inventory: runeInventory.value
      },
      // Phase 3.35：主题所有权唯一权威持久化来源（主存档）。购买通过
      // tryPurchaseTheme 单次提交钻石 + ownedThemes；legacy nz_owned_themes 只读不再写入。
      themeData: {
        ownedThemes: useThemeStore().ownedThemes
      }
    }

    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(saveData))
      lastOfflineCheckpointAt.value = nextCheckpoint
      return true
    } catch {
      // 存档失败时返回 false，调用方据此回滚（如 claimOfflineReward / 离线结算事务）。
      return false
    }
  }
  
  // 统一 saveGame 失败边界：返回 false 或抛异常均视为保存失败（调用方据此回滚）。
  function safeSave(ts?: number): boolean {
    let ok = false
    try {
      ok = saveGame(ts)
    } catch {
      ok = false
    }
    return ok
  }


  // Phase 3.2：唯一领取入口。pending 空 → 返回 null 且资源不变；
  // 非空 → 恰好增加一次 gold/exp、清空 pending、保存一次；再次调用 → 返回 null。
  // 领取与清空 pending 必须在同一份主存档中一次落盘（异常时整体回滚）。
  function claimOfflineReward(): OfflineSettlement | null {
    const reward = pendingOfflineReward.value
    if (!reward) return null

    const prevGold = player.value.gold
    const prevExp = player.value.experience

    // 先清空 pending：保证即便后续保存失败，重入也不会重复发放。
    pendingOfflineReward.value = null
    player.value.gold += reward.gold
    player.value.experience += reward.exp

    const ok = saveGame()
    if (!ok) {
      // 持久化失败：回滚资源与 pending，保持可重试且不双发。
      player.value.gold = prevGold
      player.value.experience = prevExp
      pendingOfflineReward.value = reward
      return null
    }
    return reward
  }
  
  function addGold(amount: number) {
    // Phase 3.1：恢复为不带任何隐式幸运的原始入账函数。
    // 战斗/击杀金币的幸运、转生、月卡等乘区由 calculateCombatGoldReward 统一计算后再调用本函数；
    // 固定奖励（任务/签到/回收/退款/离线）默认不享受幸运。
    const safeAmount = Number.isFinite(amount) ? Math.floor(amount) : 0
    player.value.gold += safeAmount
    // T8.1 战令：金币获取增加经验（基于原始入账金额）
    addBattlePassExp(Math.floor(safeAmount / 10))
  }

  // Phase 3.60：纯内存金币入账（含战令经验），不写盘。
  // 保留 addGold() 的奖励语义，但由外层补偿事务统一控制提交时机
  // （战令 key → 签到 key → 主存档），供 signinStore 补偿事务使用。
  function applyGoldRewardInMemory(amount: number) {
    const safeAmount = Number.isFinite(amount) ? Math.floor(amount) : 0
    player.value.gold += safeAmount
    applyBattlePassExpInMemory(Math.floor(safeAmount / 10))
  }
  
  function addDiamond(amount: number) {
    player.value.diamond += amount
  }

  // Phase 3.74：纯内存钻石入账（无战令/无写盘），供 challenge 补偿事务按序统一提交。
  function applyDiamondRewardInMemory(amount: number) {
    const safeAmount = Number.isFinite(amount) ? Math.max(0, Math.floor(amount)) : 0
    player.value.diamond += safeAmount
  }

  function spendDiamonds(amount: number): boolean {
    if (player.value.diamond < amount) return false
    player.value.diamond -= amount
    return true
  }

  /**
   * Phase 3.35：主题购买（主存档单一原子事务）。
   *
   * 权威执行顺序（全部校验通过后）：
   *   1. 快照 diamond 与完整 ownedThemes；
   *   2. 扣除主题价格；
   *   3. replaceOwnedThemes 加入目标主题（纯内存）；
   *   4. 调用 saveGame() 恰好一次（主存档同一 JSON 同时提交钻石与 themeData.ownedThemes）；
   *   5. 保存成功才返回 ok:true。
   *
   * 前置校验（任一失败 → { ok:false, cost:0 }，零修改、零写盘）：themeId 非空精确字符串、
   * 主题存在、价格是有限正整数、非免费主题、未拥有、diamond 有限非负且 ≥ 价格、当前
   * ownedThemes canonical（无未知 / 无重复 / 含 default）。
   *
   * replaceOwnedThemes / saveGame 抛异常或 saveGame 返回 false → 完整回滚 diamond 与 ownedThemes，
   * 不重试保存。购买不写 legacy nz_owned_themes。
   */
  function tryPurchaseTheme(themeId: string): ThemePurchaseResult {
    const themeStore = useThemeStore()

    // ─── 前置校验 ───
    if (typeof themeId !== 'string' || themeId.trim() === '') {
      return { ok: false, reason: 'invalid theme id', cost: 0 }
    }
    const theme = THEMES.find(t => t.id === themeId)
    if (!theme) {
      return { ok: false, reason: 'unknown theme', cost: 0 }
    }
    if (theme.price === 'free') {
      return { ok: false, reason: 'theme is free', cost: 0 }
    }
    if (!Number.isInteger(theme.price) || theme.price <= 0) {
      return { ok: false, reason: 'invalid theme price', cost: 0 }
    }
    if (themeStore.ownedThemes.includes(themeId)) {
      return { ok: false, reason: 'already owned', cost: 0 }
    }
    const diamond = player.value.diamond
    if (!Number.isInteger(diamond) || diamond < 0) {
      return { ok: false, reason: 'invalid diamond', cost: 0 }
    }
    if (diamond < theme.price) {
      return { ok: false, reason: 'insufficient diamond', cost: 0 }
    }
    // 当前 ownedThemes 必须 canonical（无未知 / 无重复 / 含 default）
    const canonicalOwned = normalizeOwnedThemeIds(themeStore.ownedThemes)
    const currentOwned = themeStore.ownedThemes
    if (
      canonicalOwned.length !== currentOwned.length ||
      canonicalOwned.some((id, i) => id !== currentOwned[i])
    ) {
      return { ok: false, reason: 'invalid owned themes', cost: 0 }
    }

    // ─── 快照 ───
    const snapDiamond = player.value.diamond
    const snapOwned = [...themeStore.ownedThemes]

    // Phase 3.35 Repair 1：回滚直接恢复精确快照（snapOwned 已在事务前验证 canonical），
    // 不得再次调用候选阶段可能失败的 replaceOwnedThemes——否则「先写入再抛错」的候选
    // mutation 故障会让第二次异常逃出 tryPurchaseTheme，违反「replaceOwnedThemes 抛错
    // 时完整回滚」契约。
    const rollback = () => {
      player.value.diamond = snapDiamond
      themeStore.ownedThemes = [...snapOwned]
    }

    try {
      // 2. 扣除钻石
      player.value.diamond -= theme.price
      // 3. 内存中加入主题（纯内存，不写盘）
      themeStore.replaceOwnedThemes([...snapOwned, themeId])
    } catch {
      rollback()
      return { ok: false, reason: 'theme purchase candidate failed', cost: 0 }
    }

    // 4. 恰好一次主存档提交
    if (!safeSave()) {

      rollback()
      return { ok: false, reason: 'save failed', cost: 0 }
    }

    return { ok: true, themeId, cost: theme.price }
  }

  function addMaterial(amount: number) {
    player.value.materials += amount
  }

  function addGachaTicket(amount: number) {
    player.value.gachaTickets += amount
  }

  function addPassiveShard(amount: number) {
    player.value.passiveShards += amount
  }

  function addAvatarFrame(amount: number) {
    player.value.avatarFrames += amount
  }

  function addSetPiece(amount: number) {
    player.value.setPieces += amount
  }

  function addExperience(amount: number) {
    const rebirthStore = useRebirthStore()
    const rebirthBonus = rebirthStore.rebirthStats.expBonusPercent / 100
    const bonusAmount = Math.floor(amount * rebirthBonus)
    player.value.experience += amount + bonusAmount
    // T8.1 战令：经验获取增加经验
    addBattlePassExp(Math.floor(amount / 5))
    checkLevelUp()
  }

  // Phase 3.74：纯内存经验增长（转生加成 / 战令经验 / level-up / stats / maxHp /
  // unlocked phases / 每级 talent point），不写盘、不触发 TalentStore 持久化。
  // 由外层 challenge 补偿事务按序统一提交（BattlePass → Talent → Player main）。
  // 升级产生的 talent point 走纯内存路径（persistTalent=false），避免此处直接写盘。
  function applyExperienceRewardInMemory(amount: number) {
    const rebirthStore = useRebirthStore()
    const rebirthBonus = rebirthStore.rebirthStats.expBonusPercent / 100
    const bonusAmount = Math.floor(amount * rebirthBonus)
    player.value.experience += amount + bonusAmount
    applyBattlePassExpInMemory(Math.floor(amount / 5))
    checkLevelUp(false)
  }
  
  function getExpNeeded(): number {
    return player.value.level * 100 * Math.pow(1.5, player.value.level - 1)
  }
  
  function getPlayerPhase(): number {
    return Math.min(Math.floor(player.value.level / 5) + 1, 7)
  }
  
  function getExpPerSecond(): number {
    const phase = getPlayerPhase()
    const baseExp = Math.pow(2, phase - 1)
    return baseExp
  }
  
  function getExpPerKill(): number {
    const phase = getPlayerPhase()
    return Math.floor(10 * Math.pow(1.5, phase - 1))
  }
  
  function getAverageExpPerSecond(): number {
    const expPerSec = getExpPerSecond()
    const monsterStore = useMonsterStore()
    const monster = monsterStore.currentMonster
    if (monster) {
      const killsPerSecond = monster.speed / 100
      const expFromKills = getExpPerKill() * killsPerSecond
      return expPerSec + expFromKills
    }
    return expPerSec
  }
  
  function getSecondsToLevelUp(): number {
    const expNeeded = getExpNeeded()
    const currentExp = player.value.experience
    const expNeededRemaining = expNeeded - currentExp
    const expPerSec = getAverageExpPerSecond()
    if (expPerSec <= 0) return Infinity
    return Math.ceil(expNeededRemaining / expPerSec)
  }
  
  // persistTalent 默认 true：保持既有 addExperience 的升级写盘行为（addTalentPoints 持久化）。
  // 传 false 时升级产生的 talent point 走纯内存路径（applyTalentPointsInMemory），供补偿事务统一提交。
  function checkLevelUp(persistTalent: boolean = true) {
    const expNeeded = player.value.level * 100 * Math.pow(1.5, player.value.level - 1)
    while (player.value.experience >= expNeeded) {
      player.value.experience -= expNeeded
      player.value.level++
      player.value.stats.attack += 2
      player.value.stats.defense += 2
      player.value.stats.maxHp += 20
      player.value.stats.speed += 1
      player.value.maxHp = player.value.stats.maxHp
      if (persistTalent) useTalentStore().addTalentPoints(1)
      else useTalentStore().applyTalentPointsInMemory(1)
      checkPhaseUnlock()
    }
  }
  
  function checkPhaseUnlock() {
    const newPhase = Math.min(Math.floor(player.value.level / 5) + 1, 7)
    for (let p = 1; p <= newPhase; p++) {
      if (!player.value.unlockedPhases.includes(p)) {
        player.value.unlockedPhases.push(p)
      }
    }
  }
  
  function isStatUnlocked(stat: StatType): boolean {
    const category = STAT_CATEGORY[stat]
    const requiredPhase = PHASE_UNLOCK[category]
    return player.value.unlockedPhases.includes(requiredPhase)
  }
  
  /**
   * 装备替换事务的结果。ok 表示已原子落盘；kind 暴露实际决策，便于调用方区分
   * 被锁定拒绝 / 不够好 / 非法输入等情形（不重复扣减或误显示成功）。
   */
  interface EquipmentReplacementResult {
    ok: boolean
    kind: EquipmentReplacementDecision['kind']
    recycleGold: number
  }

  /**
   * Phase 3.3 权威装备替换事务。所有替换动作（equipItem / autoEquipIfBetter / equipNewEquipment）
   * 必须经由本函数，禁止在别处自行实现"判断 → 发金币 → 写槽位 → saveGame"。
   *
   * 执行顺序：
   *   取得决策 → 拒绝则零修改返回
   *   → 快照旧装备 / 金币 / pendingEquipment
   *   → 一次性设置新装备与回收金币（仅 replace 时加金币）
   *   → saveGame()
   *   → 持久化失败则完整回滚（装备/金币/pending 全部恢复）
   *   → 成功后再执行非关键副作用（图鉴登记）
   *
   * 回收金币保证：只发放一次、只在替换未锁定旧装备时发放、空槽位/锁定/不够好/非法/保存失败均不发。
   */
  function tryReplaceEquipment(
    equipment: Equipment,
    options?: { threshold?: number; clearPendingOnSuccess?: boolean; discoverOnSuccess?: boolean }
  ): EquipmentReplacementResult {
    // 先过经济校验，再读取 slot：任何 malformed / null / 数字 / 空对象不得抛异常，
    // 直接返回 invalid（且装备/金币/pending 一律不变）。
    const validation = validateEquipmentForEconomy(equipment)
    if (!validation.ok) {
      return { ok: false, kind: 'invalid', recycleGold: 0 }
    }
    const validEquipment = validation.equipment
    const slot = validEquipment.slot
    const current = player.value.equipment[slot] ?? null
    const decision = planEquipmentReplacement(validEquipment, current, options?.threshold)

    if (decision.kind !== 'replace' && decision.kind !== 'equip-empty') {
      // 拒绝：装备/金币/pending 一律不改动
      return { ok: false, kind: decision.kind, recycleGold: 0 }
    }

    // 快照（用于持久化失败时完整回滚）
    const prevEquip = player.value.equipment[slot] // 空槽位时为 undefined
    const prevGold = player.value.gold
    const prevPending = pendingEquipment.value

    // 一次性应用：装备新装备 + （仅替换时）回收旧装备金币
    player.value.equipment[slot] = equipment
    if (decision.kind === 'replace') {
      player.value.gold += decision.recycleGold
    }
    if (options?.clearPendingOnSuccess) {
      pendingEquipment.value = null
    }

    const ok = saveGame()
    if (!ok) {
      // 完整回滚：装备、金币、pending 都恢复到事务前
      if (prevEquip === undefined) {
        delete player.value.equipment[slot]
      } else {
        player.value.equipment[slot] = prevEquip
      }
      player.value.gold = prevGold
      pendingEquipment.value = prevPending
      return { ok: false, kind: decision.kind, recycleGold: decision.kind === 'replace' ? decision.recycleGold : 0 }
    }

    // 成功落盘后再执行非关键副作用（图鉴登记）。其失败不得反向破坏已落盘的装备事务。
    if (options?.discoverOnSuccess) {
      try {
        const collectionStore = useCollectionStore()
        collectionStore.discoverEquipment(equipment.id)
      } catch {
        // 非关键副作用，静默
      }
    }

    return { ok: true, kind: decision.kind, recycleGold: decision.kind === 'replace' ? decision.recycleGold : 0 }
  }

  function equipItem(equipment: Equipment): boolean {
    return tryReplaceEquipment(equipment).ok
  }

  function autoEquipIfBetter(equipment: Equipment): boolean {
    return tryReplaceEquipment(equipment, { discoverOnSuccess: true }).ok
  }

  /**
   * 卸下并原子回收已装备物品（保留"卸下即回收"的既有产品语义）。
   * 空槽位 / 锁定装备 → 返回 false 且不改动任何状态；成功落盘后才发放一次回收金币；
   * 持久化失败则装备与金币完整回滚。
   */
  function tryRecycleEquippedItem(slot: EquipmentSlot): boolean {
    const equip = player.value.equipment[slot]
    if (!equip) return false
    if (equip.isLocked) return false

    // 复用统一经济校验：损坏装备（非法 slot/stat/value、score=NaN/Infinity/负、回收价非法）
    // 一律在此处被挡下，装备与金币均不改动。
    const plan = planEquipmentRecycle(equip)
    if (!plan.ok) return false
    const recycleGold = plan.recycleGold

    // 玩家金币本身也必须是有限非负数，避免损坏存档下继续污染。
    if (!Number.isFinite(player.value.gold) || player.value.gold < 0) return false

    const prevEquip = equip
    const prevGold = player.value.gold

    delete player.value.equipment[slot]
    player.value.gold += recycleGold

    const ok = saveGame()
    if (!ok) {
      player.value.equipment[slot] = prevEquip
      player.value.gold = prevGold
      return false
    }
    return true
  }

  function unequipItem(slot: EquipmentSlot) {
    tryRecycleEquippedItem(slot)
  }

  function toggleEquipLock(slot: EquipmentSlot) {
    const equip = player.value.equipment[slot]
    if (equip) {
      equip.isLocked = !equip.isLocked
      saveGame()
    }
  }
  
  /**
   * 装备词缀升级的唯一原子事务入口（Phase 3.4）。
   * 读取已装备物品 → 取得纯升级 plan → 拒绝则零修改 → 快照 → 扣 cost →
   * 同时写入 stats.value 与 affix.value → upgradeLevel+1 → saveGame → 失败完整回滚。
   * 只有本事务成功，词缀升级才真实生效（stats 与 affix 同步，totalStats / score / 磁盘一致）。
   */
  function tryUpgradeEquipmentAffix(slot: EquipmentSlot, affixIndex: number): EquipmentAffixUpgradeResult {
    const equip = player.value.equipment[slot]
    if (!equip) {
      return { ok: false, reason: 'no equipped item in slot', cost: 0 }
    }

    // 取得纯升级 plan（内含全部校验：装备经济 / affix 完整性 / 金币 / nextValue 递增）
    const plan = planEquipmentAffixUpgrade(equip, affixIndex, player.value.gold)
    if (!plan.ok) {
      // 拒绝：装备 / 金币 / affix 一律不改动
      return { ok: false, reason: plan.reason, cost: 0 }
    }

    // 快照（用于持久化失败时完整回滚）
    const prevGold = player.value.gold
    const statEntry = equip.stats[plan.statIndex]
    const affixEntry = equip.affixes[plan.affixIndex]
    const prevStatValue = statEntry.value
    const prevAffixValue = affixEntry.value
    const prevLevel = affixEntry.upgradeLevel

    // 一次性应用：扣 cost（直接减，与旧 UI 行为一致，不触发战令经验）+ 同步 stats/affix
    player.value.gold -= plan.cost
    statEntry.value = plan.nextValue
    affixEntry.value = plan.nextValue
    affixEntry.upgradeLevel = plan.nextLevel

    const ok = saveGame()
    if (!ok) {
      // 完整回滚：金币、stats.value、affix.value、upgradeLevel 都恢复到事务前
      player.value.gold = prevGold
      statEntry.value = prevStatValue
      affixEntry.value = prevAffixValue
      affixEntry.upgradeLevel = prevLevel
      return { ok: false, reason: 'save failed', cost: 0 }
    }

    return { ok: true, cost: plan.cost }
  }

  /**
   * 装备精炼的唯一原子事务入口（Phase 3.5）。
   * 读取已装备物品 → 取得纯精炼 plan（含 RNG 调用与全部校验）→ 拒绝则零修改 →
   * 快照 gold / refiningLevel / refiningSlots → 扣 cost → 写入 nextLevel + nextSlots →
   * saveGame → 失败完整回滚（金币 / level / slots 内容 / 磁盘）。
   * 成功后精炼属性通过 calculateTotalStats 立即进入 totalStats / persistentTotalStats / 战斗 / 离线 / 模拟。
   * 锁定装备仍允许精炼（锁只阻止替换与回收）。
   */
  function tryRefineEquipment(slot: EquipmentSlot, rng?: () => number): EquipmentRefiningResult {
    const equip = player.value.equipment[slot]
    if (!equip) {
      return { ok: false, reason: 'no equipped item in slot', cost: 0 }
    }

    // 取得纯精炼 plan（确定性校验全部通过后才在内部调用 RNG；拒绝则零修改、不扣款）。
    // 防御性 fail-closed：规划意外抛异常（含 malformed rng）也不得向外抛，返回失败且状态/磁盘不变。
    let plan: ReturnType<typeof planEquipmentRefinement>
    try {
      plan = planEquipmentRefinement(equip, player.value.gold, rng)
    } catch {
      return { ok: false, reason: 'refining planning threw', cost: 0 }
    }
    if (!plan.ok) {
      return { ok: false, reason: plan.reason, cost: 0 }
    }

    // 快照（用于持久化失败时完整回滚；slot 内容深拷贝，避免引用串改）
    const prevGold = player.value.gold
    const prevLevel = equip.refiningLevel
    const prevSlots = equip.refiningSlots.map(s => ({ ...s }))

    // 一次性应用：扣 cost（直接减，与旧 UI 行为一致，不触发战令经验）+ 写入 level/插槽
    player.value.gold -= plan.cost
    equip.refiningLevel = plan.nextLevel
    equip.refiningSlots = plan.nextSlots.map(s => ({ ...s }))

    const ok = saveGame()
    if (!ok) {
      // 完整回滚：金币、refiningLevel、refiningSlots 全部恢复事务前状态
      player.value.gold = prevGold
      equip.refiningLevel = prevLevel
      equip.refiningSlots = prevSlots
      return { ok: false, reason: 'save failed', cost: 0 }
    }

    return { ok: true, cost: plan.cost, level: plan.nextLevel }
  }

  /**
   * 装备符文镶嵌的唯一原子事务入口（Phase 3.6）。
   * 读取目标装备与 inventory → 取得纯 plan（含全局拓扑校验）→ 拒绝则零修改 →
   * 快照所有受影响装备的 runeSlots → 一次性应用候选状态 → saveGame → 失败完整回滚。
   * 一次移动可能同时影响原装备、目标装备、被替换 Rune、移动 Rune，全部包含在同一快照与一次写盘。
   * 锁定装备仍允许镶嵌/移除（与 affix/refining 语义一致）。镶嵌免费（无金币事务）。
   * 成功后符文属性通过 calculateTotalStats 立即进入 totalStats / persistentTotalStats / 战斗 / 离线 / 模拟。
   */
  function commitRunePlan(slotUpdates: RuneSlotUpdate[]): EquipmentRuneTransactionResult {
    const affectedSlots = new Set(slotUpdates.map(u => u.equipmentSlot))
    const snapshots: Partial<Record<EquipmentSlot, RuneSlot[]>> = {}
    for (const slot of affectedSlots) {
      const eq = player.value.equipment[slot]
      if (eq) snapshots[slot] = eq.runeSlots.map(s => ({ ...s }))
    }
    for (const u of slotUpdates) {
      const eq = player.value.equipment[u.equipmentSlot]
      if (eq && eq.runeSlots[u.slotIndex]) {
        eq.runeSlots[u.slotIndex] = { index: u.slotIndex, runeId: u.newRuneId }
      }
    }
    const ok = saveGame()
    if (!ok) {
      for (const slot of affectedSlots) {
        const eq = player.value.equipment[slot]
        const snap = snapshots[slot]
        if (eq && snap) eq.runeSlots = snap.map(s => ({ ...s }))
      }
      return { ok: false, reason: 'save failed' }
    }
    return { ok: true }
  }

  function tryEmbedEquipmentRune(
    equipmentSlot: EquipmentSlot,
    runeSlotIndex: number,
    runeId: string
  ): EquipmentRuneTransactionResult {
    const equip = player.value.equipment[equipmentSlot]
    if (!equip) return { ok: false, reason: 'no equipped item in slot' }

    let plan: ReturnType<typeof planEmbedEquipmentRune>
    try {
      plan = planEmbedEquipmentRune({
        targetEquipment: equip,
        slotIndex: runeSlotIndex,
        runeId,
        inventory: runeInventory.value,
        equipmentBySlot: player.value.equipment
      })
    } catch {
      return { ok: false, reason: 'rune planning threw' }
    }
    if (!plan.ok) return { ok: false, reason: plan.reason }

    // 快照所有受影响装备的 runeSlots（深拷贝），用于持久化失败时完整回滚
    return commitRunePlan(plan.slotUpdates)
  }

  /**
   * 装备符文移除的唯一原子事务入口（Phase 3.6）。
   * 与 tryEmbedEquipmentRune 同一套原子骨架：纯 plan → 拒绝零修改 → 快照 → 应用 → saveGame → 失败回滚。
   * 存在合法 Rune → Rune 回到未镶嵌状态（仅清空装备槽位，inventory 不变）；空槽/损坏拓扑 → no-op 失败。
   */
  function tryRemoveEquipmentRune(
    equipmentSlot: EquipmentSlot,
    runeSlotIndex: number
  ): EquipmentRuneTransactionResult {
    const equip = player.value.equipment[equipmentSlot]
    if (!equip) return { ok: false, reason: 'no equipped item in slot' }

    let plan: ReturnType<typeof planRemoveEquipmentRune>
    try {
      plan = planRemoveEquipmentRune({
        targetEquipment: equip,
        slotIndex: runeSlotIndex,
        inventory: runeInventory.value,
        equipmentBySlot: player.value.equipment
      })
    } catch {
      return { ok: false, reason: 'rune planning threw' }
    }
    if (!plan.ok) return { ok: false, reason: plan.reason }

    return commitRunePlan(plan.slotUpdates)
  }

  /**
   * 符文经验升级的唯一原子事务入口（Phase 3.7）。
   * 纯 plan → 拒绝零修改 → 深拷贝整个 inventory 快照 → 用 nextRune 替换目标 → saveGame → 失败完整回滚。
   *
   * 执行顺序：
   *   runeId trim 非空 → validateRuneInventory → canonical id 找恰好一枚 → planRuneExperienceGain
   *   → 拒绝则零修改 → 深拷贝整个 inventory 快照 → 替换目标 Rune → saveGame → 失败恢复整个 inventory。
   *
   * 要求：
   *   成功只写主存档一次；失败零写盘；inventory 数量/顺序不变；除目标 Rune 外所有 Rune 字节级不变；
   *   装备 runeSlots 拓扑完全不变；不扣任何资源。
   *   已镶嵌 Rune 升级后属性立即经 calculateTotalStats 生效（未镶嵌则仅 inventory 更新 + 持久化）。
   *   本阶段没有经验来源，UI 不提供“免费经验”按钮；该 API 供未来掉落/任务/合成等可信系统调用。
   */
  /**
   * 两枚 Rune 关键字段是否相等（用于事务后置校验，确认其他 Rune 未被改动）。
   * Phase 3.12：纳入 canonical 锁定状态（=== true 归一化——undefined 与 false 均为
   * canonical 未锁定，视为相等；true 与 false/缺失 视为不相等，防止锁定丢失/被篡改）。
   */
  function runeEquals(a: Rune, b: Rune): boolean {
    return (
      a.id === b.id &&
      a.type === b.type &&
      a.rarity === b.rarity &&
      a.level === b.level &&
      a.exp === b.exp &&
      a.statValue === b.statValue &&
      (a.isLocked === true) === (b.isLocked === true)
    )
  }

  function tryAddRuneExperience(runeId: string, expAmount: number): RuneExperienceTransactionResult {
    // 这些状态需被异常处理路径访问：当候选已写入内存（candidateApplied）而 saveGame 直接抛异常时，
    // 必须在 catch 中完整回滚 inventory，保证“事务报告失败则内存零修改”的原子性。
    let snapshot: Rune[] | null = null
    let candidateApplied = false

    try {
      // runeId 必须是 trim 后非空字符串
      if (typeof runeId !== 'string') return { ok: false, reason: 'runeId must be a string', levelsGained: 0 }
      const id = runeId.trim()
      if (id.length === 0) return { ok: false, reason: 'runeId must be non-empty after trim', levelsGained: 0 }

      // —— 唯一一次 raw inventory 读取（Phase 3.12.1 P1-A）——
      // 时变 Proxy / getter 之后再也不会被读取；validate / planner / target 查找 / next 构造 / 回滚
      // 全部基于此快照。解决「多次读取 raw inventory 在时变下丢失或篡改锁定状态」的隐患。
      snapshot = runeInventory.value.map(r => ({ ...r }))

      // inventory 必须通过校验（基于稳定快照）
      const inv = validateRuneInventory(snapshot)
      if (!inv.ok) return { ok: false, reason: `rune inventory invalid: ${inv.reason}`, levelsGained: 0 }

      // 按 canonical id 找到恰好一枚 Rune
      const targetIndex = inv.inventory.findIndex(r => r.id === id)
      if (targetIndex < 0) return { ok: false, reason: 'rune not found in inventory', levelsGained: 0 }
      const canonicalTarget = inv.inventory[targetIndex]

      // 纯规划（内部已 fail-closed，不抛异常；此处仍为防御性边界）
      const plan = planRuneExperienceGain(canonicalTarget, expAmount)
      if (!plan.ok) return { ok: false, reason: plan.reason, levelsGained: 0 }

      // 应用前锁定不变量（Phase 3.12.1 P1-A）：升级必须保留锁定状态。
      // planRuneExperienceGain 本身保留 isLocked；此处与 canonical target 显式对拍，
      // 防止 planner 与事务口径不一致、或时变输入让 planner 基于不同锁定态下结论。
      if (plan.nextRune.id !== canonicalTarget.id) {
        return { ok: false, reason: 'rune id mismatch', levelsGained: 0 }
      }
      if (plan.nextRune.type !== canonicalTarget.type) {
        return { ok: false, reason: 'rune type mismatch', levelsGained: 0 }
      }
      if (plan.nextRune.rarity !== canonicalTarget.rarity) {
        return { ok: false, reason: 'rune rarity mismatch', levelsGained: 0 }
      }
      if (plan.nextRune.isLocked !== canonicalTarget.isLocked) {
        return { ok: false, reason: 'rune lock state changed during planning', levelsGained: 0 }
      }

      // 按 targetIndex 替换（Phase 3.7.1 修复：不再以原始字符串 ID 二次匹配，
      // 避免 canonical 化前的 padded ID 在应用阶段匹配失败导致“成功但未升级”）。
      // 构造 next 使用同一 rawSnapshot（不再读 runeInventory.value）。
      const next: Rune[] = snapshot.map((r, index) =>
        index === targetIndex ? { ...plan.nextRune } : { ...r }
      )

      // 后置校验门（Phase 3.7.1 + Phase 3.12.1 P1-A）：应用前确认不变量，任一失败则不写盘、不修改当前 inventory。
      if (next.length !== snapshot.length) {
        return { ok: false, reason: 'rune inventory length changed', levelsGained: 0 }
      }
      if (!runeEquals(next[targetIndex], plan.nextRune)) {
        return { ok: false, reason: 'rune candidate mismatch', levelsGained: 0 }
      }
      // 锁定状态相对 canonical target 不得变化（升级只改 level / exp / statValue）
      if (next[targetIndex].isLocked !== canonicalTarget.isLocked) {
        return { ok: false, reason: 'rune lock state altered', levelsGained: 0 }
      }
      // 允许把目标 Rune 的带空白 ID canonical 化（canonical inventory 的 id 已 trim）
      if (next[targetIndex].id !== id) {
        return { ok: false, reason: 'rune id not canonicalized', levelsGained: 0 }
      }
      // 其他 index 内容与事务前一致（数量、顺序、字段均不变，含锁定状态）
      for (let i = 0; i < next.length; i++) {
        if (i === targetIndex) continue
        if (!runeEquals(next[i], snapshot[i])) {
          return { ok: false, reason: 'other rune altered', levelsGained: 0 }
        }
      }
      const invCheck = validateRuneInventory(next)
      if (!invCheck.ok) return { ok: false, reason: `rune inventory invalid after apply: ${invCheck.reason}`, levelsGained: 0 }
      const progCheck = validateRuneProgressionState(next[targetIndex])
      if (!progCheck.ok) return { ok: false, reason: 'rune progression invalid after apply', levelsGained: 0 }

      // 应用到内存
      runeInventory.value = next
      candidateApplied = true

      // 统一处理：saveGame 正常返回 false 或直接抛异常，均视为保存失败并完整回滚
      if (!safeSave()) {

        // 完整回滚整个 inventory（数量/顺序/内容全部恢复，含可能已被 canonical 化的 padded id）
        runeInventory.value = (snapshot as Rune[]).map(r => ({ ...r }))
        candidateApplied = false
        return { ok: false, reason: 'save failed', levelsGained: 0 }
      }

      return {
        ok: true,
        levelsGained: plan.levelsGained,
        level: plan.nextRune.level,
        exp: plan.nextRune.exp
      }
    } catch {
      // 应用后异常（saveGame 内部抛异常等）：防御性回滚，零修改零写盘
      if (candidateApplied && snapshot) {
        runeInventory.value = snapshot.map(r => ({ ...r }))
        candidateApplied = false
      }
      return { ok: false, reason: 'rune experience transaction threw', levelsGained: 0 }
    }
  }

  /**
   * 符文原子入库的唯一事务入口（Phase 3.8）。
   * 纯规划 planRuneAcquisition → 拒绝零修改 → 深拷贝整个 inventory 快照 → 应用 nextInventory
   * → saveGame → 失败（返回 false 或直接抛异常）完整回滚。
   *
   * 复用 tryAddRuneExperience 的异常回滚骨架：snapshot / candidateApplied 声明在外层，
   * 当候选已写入内存而 saveGame 直接抛异常（如 Date.now 抛）时，最外层 catch 完整回滚。
   *
   * 成功：inventory 恰好增加 1、新增 Rune 位于末尾、其他 Rune 字节级内容与顺序不变、
   *      装备 runeSlots 完全不变、玩家资源完全不变、只写主存档一次。
   * 失败：inventory 引用内容恢复、padded ID 原字节恢复、装备拓扑不变、磁盘原字符串不变、
   *      setItem 0 次或仅失败的那一次。新获得 Rune 默认未镶嵌，不进入 totalStats。
   */
  function tryAcquireRune(candidate: unknown): RuneAcquisitionResult {
    let snapshot: Rune[] | null = null
    let candidateApplied = false

    try {
      // —— 唯一一次 raw inventory 读取（Phase 3.12.1 P1-B）——
      // 时变 Proxy / getter 之后再也不会被读取；planner / topology / next 校验 / 回滚全部基于此快照。
      // 解决「planRuneAcquisition / tryAcquireRune 多次读取 raw inventory 在时变下改变已有 Rune 锁定状态」隐患。
      snapshot = runeInventory.value.map(r => ({ ...r }))

      // canonical 快照（基于稳定 rawSnapshot，供 topology 与 planner 复用，避免二次读 live store）。
      // validateRuneInventory 保序等长；topology validator 内部会再 validateRuneInventory，故传入已 canonical 的
      // canonicalSnapshot 防时变 Proxy 双读。
      const invSnap = validateRuneInventory(snapshot)
      if (!invSnap.ok) {
        return { ok: false, reason: `rune inventory invalid: ${invSnap.reason}` }
      }
      const canonicalSnapshot = invSnap.inventory
      if (canonicalSnapshot.length !== snapshot.length) {
        return { ok: false, reason: 'canonical snapshot length mismatch' }
      }

      // 纯规划（内部已 fail-closed，不抛异常；此处仍为防御性边界）。
      // 输入为稳定 rawSnapshot（不再传 raw runeInventory.value）；planner 内部亦仅读此快照一次。
      const plan = planRuneAcquisition(snapshot, candidate)
      if (!plan.ok) return { ok: false, reason: plan.reason }

      // 拓扑隔离门（Phase 3.8.1 P1-A）：新入库 Rune 的 canonical ID 在当前全局拓扑中必须有 0 个引用；
      // 任何损坏三孔 / 悬空引用 / 重复引用（含其他 Rune 的悬空引用）/ 读取异常一律失败，
      // 绝不允许把悬空引用视为“顺便恢复已有镶嵌”而隐式激活装备孔。
      const topo = validatePlayerRuneReferenceTopology(player.value.equipment, canonicalSnapshot)
      if (!topo.ok) return { ok: false, reason: `rune reference topology invalid: ${topo.reason}` }
      if (topo.references.has(plan.acquiredRune.id)) {
        return { ok: false, reason: 'rune id already referenced by equipment' }
      }

      const next = plan.nextInventory

      // 后置校验门：应用前确认不变量，任一失败则不写盘、不修改当前 inventory。
      if (next.length !== snapshot.length + 1) {
        return { ok: false, reason: 'rune inventory length mismatch' }
      }
      if (plan.insertIndex !== snapshot.length) {
        return { ok: false, reason: 'insert index must be the tail position' }
      }
      // 原有项与快照字节级一致（数量、顺序、字段均不变，含锁定状态）
      for (let i = 0; i < snapshot.length; i++) {
        if (!runeEquals(next[i], snapshot[i])) {
          return { ok: false, reason: 'existing rune altered' }
        }
      }
      const invCheck = validateRuneInventory(next)
      if (!invCheck.ok) return { ok: false, reason: `rune inventory invalid after apply: ${invCheck.reason}` }
      const progCheck = validateRuneProgressionState(next[plan.insertIndex])
      if (!progCheck.ok) return { ok: false, reason: 'appended rune progression invalid' }

      // 应用到内存
      runeInventory.value = next
      candidateApplied = true

      // 第二道拓扑门（Phase 3.8.1 P1-A）：用 next 重新校验全局拓扑（应用后允许读 next，不读 live store），
      // 并确认新增 Rune ID 仍 0 引用。
      // 防御：恶意 getter / 可变 Proxy / 规划与应用间读取结果变化 / 未来重构误把新增 ID 写进装备孔。
      // 不得保存“入库成功即已镶嵌”的状态。
      const topo2 = validatePlayerRuneReferenceTopology(player.value.equipment, next)
      if (!topo2.ok) {
        runeInventory.value = (snapshot as Rune[]).map(r => ({ ...r }))
        candidateApplied = false
        return { ok: false, reason: `rune reference topology invalid after apply: ${topo2.reason}` }
      }
      if (topo2.references.has(plan.acquiredRune.id)) {
        runeInventory.value = (snapshot as Rune[]).map(r => ({ ...r }))
        candidateApplied = false
        return { ok: false, reason: 'rune id referenced by equipment after apply' }
      }

      // 统一处理：saveGame 正常返回 false 或直接抛异常，均视为保存失败并完整回滚
      if (!safeSave()) {

        runeInventory.value = (snapshot as Rune[]).map(r => ({ ...r }))
        candidateApplied = false
        return { ok: false, reason: 'save failed' }
      }

      return { ok: true, rune: plan.acquiredRune, insertIndex: plan.insertIndex }
    } catch {
      if (candidateApplied && snapshot) {
        runeInventory.value = snapshot.map(r => ({ ...r }))
        candidateApplied = false
      }
      return { ok: false, reason: 'rune acquisition transaction threw' }
    }
  }

  /**
   * 生成并入库的权威入口（Phase 3.8）：先确定性生成，再原子入库。
   * 不调用 useRuneStore()（避免 playerStore ↔ runeStore 循环依赖），直接依赖纯生成模块。
   *
   *   - timestamp 显式提供 → 不读取 Date.now
   *   - timestamp 缺失 → 在本事务 try/catch 内读取 Date.now 一次；Date.now 抛异常 → 返回失败、
   *     RNG 0 次、inventory 零修改、零写盘（此时 planRuneGeneration 未被调用）
   *   - 生成 ID 与 inventory 中 canonical ID 冲突 → 直接失败，不重 roll、不额外消费 RNG、不写盘
   */
  function tryGenerateAndAcquireRune(
    rng: () => number = Math.random,
    timestamp?: number
  ): RuneAcquisitionResult {
    try {
      // 严格区分“缺省”与“显式非法”（Phase 3.8.1 P1-B）：
      //   - timestamp === undefined → 视为缺省，读取 Date.now 一次
      //   - timestamp 显式为合法 number → 不读取 Date.now
      //   - timestamp 显式为 null / 字符串 / 对象 / 数组 / boolean → 原样交给 planRuneGeneration，
      //     isValidTimestamp 拒绝（任意非有限正整数），RNG 0 次、inventory 零修改、零写盘
      // 禁止 typeof timestamp === 'number' ? timestamp : Date.now()（会把显式非法值吞掉）。
      const ts: unknown = timestamp === undefined ? Date.now() : timestamp
      const plan = planRuneGeneration(rng, ts)
      if (!plan.ok) return { ok: false, reason: `generation failed: ${plan.reason}` }
      return tryAcquireRune(plan.rune)
    } catch {
      return { ok: false, reason: 'generate-and-acquire transaction threw' }
    }
  }

  /**
   * 符文批量吞噬强化的唯一原子事务核心（Phase 3.13 §11-§17）。
   * 一个或多个材料的消耗 + 目标升级 + saveGame 必须为同一个原子事务：
   * 一次规划、一份 next inventory、一次 Store 应用、一次 saveGame、一个回滚边界。
   * 任一材料不合格或保存失败 → 整批零消耗（禁止部分成功 / 逐材料 tryFeedRune 循环）。
   *
   * 单稳定快照纪律（§13，延续 Phase 3.11.1 P1-A）：
   *   事务首行读取并深拷贝 raw runeInventory.value 恰好一次（rawSnapshot）
   *   → validateRuneInventory(rawSnapshot) 得到 canonicalSnapshot（保序等长）
   *   → planRuneBatchFeeding 基于稳定 rawSnapshot
   *   → planner index 与 canonicalSnapshot 全字段对拍（§14：
   *     id/type/rarity/level/exp/statValue/isLocked，目标 + 每个材料）
   *   → 应用前拓扑一致性门（§15）：当前拓扑快照必须与 planner topologySnapshot 完全一致
   *   → 构造 next 使用同一 rawSnapshot 单次有序遍历（§16：材料 index 跳过、
   *     targetIndex 替换为 nextTargetRune、其余原始字节保留（含 padded ID）、
   *     长度减少 materialCount，目标最终 index = targetIndex - 目标之前被删材料数，
   *     全在目标前 / 全在目标后 / 前后夹杂一致处理）
   *   → 后置校验门 → 应用到内存 → 应用后拓扑合法性门 → saveGame 恰一次
   *   → 失败/异常完整回滚 rawSnapshot（§17：材料全部回到原位置原字段、目标完整还原、
   *     锁定状态还原、拓扑不变、绝不报告成功）。
   *
   * 事务开始后禁止再迭代 / 索引 raw runeInventory.value 或用它重新计算 index；
   * 后续对 Store 的操作只有 runeInventory.value = next / = 回滚快照 两种赋值。
   *
   * rawSnapshot 与 canonicalSnapshot 职责分离：
   *   rawSnapshot     —— 构造 next 中未参与 Rune（保留原始字节）、失败回滚
   *   canonicalSnapshot —— 身份/index 对拍、应用前拓扑一致性门（topology validator 输入）
   *
   * 禁止实现为 tryAddRuneExperience + 删除材料 + 再次 save 的组合，
   * 不调用 reconcileRuneReferences（材料已验证 0 引用，删除不影响装备拓扑）。
   */
  function tryFeedRunes(
    targetRuneId: string,
    materialRuneIds: readonly string[]
  ): RuneBatchFeedingTransactionResult {
    let rawSnapshot: Rune[] | null = null
    let candidateApplied = false

    function fail(reason: string): RuneBatchFeedingTransactionResult {
      return { ok: false, reason, expAdded: 0, levelsGained: 0, materialsConsumed: 0, consumedRuneIds: [] }
    }

    try {
      // —— §13 事务首行：唯一一次 raw inventory 读取，建立稳定深快照 ——
      // 时变 Proxy / getter 之后再也不会被读取；planner、candidate、回滚全部基于此快照。
      rawSnapshot = runeInventory.value.map(rune => ({ ...rune }))

      // canonical 快照：用于身份/index 对拍与拓扑门（validateRuneInventory 保序等长）
      const invSnap = validateRuneInventory(rawSnapshot)
      if (!invSnap.ok) return fail(`rune inventory invalid: ${invSnap.reason}`)
      const canonicalSnapshot = invSnap.inventory
      if (canonicalSnapshot.length !== rawSnapshot.length) {
        return fail('canonical snapshot length mismatch')
      }

      // 纯批量规划：输入为稳定 rawSnapshot（不再传 raw runeInventory.value）
      const plan = planRuneBatchFeeding({
        targetRuneId,
        materialRuneIds,
        inventory: rawSnapshot,
        equipmentBySlot: player.value.equipment
      })
      if (!plan.ok) return fail(plan.reason)

      // —— §14 planner index 与事务快照对拍 ——
      // targetIndex 与每个 materialIndex 必须为合法整数、界内、互异且严格升序；
      // canonicalSnapshot[index] 与 plan 中对应 Rune 全字段一致（含 isLocked）。
      const mIdx = plan.materialIndices
      if (
        !Number.isInteger(plan.targetIndex) ||
        plan.targetIndex < 0 ||
        plan.targetIndex >= canonicalSnapshot.length ||
        !Array.isArray(mIdx) ||
        mIdx.length < 1 ||
        plan.materialRunes.length !== mIdx.length ||
        plan.consumedRuneIds.length !== mIdx.length
      ) {
        return fail('plan index invalid')
      }
      for (let i = 0; i < mIdx.length; i++) {
        const idx = mIdx[i]
        if (
          !Number.isInteger(idx) ||
          idx < 0 ||
          idx >= canonicalSnapshot.length ||
          idx === plan.targetIndex ||
          (i > 0 && idx <= mIdx[i - 1])
        ) {
          return fail('plan index invalid')
        }
      }
      if (!runeEquals(canonicalSnapshot[plan.targetIndex], plan.targetRune)) {
        return fail('plan target rune does not match snapshot')
      }
      for (let i = 0; i < mIdx.length; i++) {
        if (
          !runeEquals(canonicalSnapshot[mIdx[i]], plan.materialRunes[i]) ||
          plan.materialRunes[i].id !== plan.consumedRuneIds[i]
        ) {
          return fail('plan material rune does not match snapshot')
        }
      }

      // —— §15 应用前拓扑一致性门 ——
      // 重新读取当前装备拓扑并与 planner 所见 topologySnapshot 逐项比较：
      // 只验证「当前拓扑仍合法」不够——规划与应用之间任何引用增删 / 移孔都视为 stale plan。
      const preTopo = validatePlayerRuneReferenceTopology(player.value.equipment, canonicalSnapshot)
      if (!preTopo.ok) {
        return fail(`rune reference topology invalid before apply: ${preTopo.reason}`)
      }
      const currentTopoSnapshot = buildRuneTopologySnapshot(preTopo.references)
      if (!sameRuneTopologySnapshot(plan.topologySnapshot, currentTopoSnapshot)) {
        return fail('rune reference topology changed since planning')
      }

      // —— §16 构造候选：同一 rawSnapshot 单次有序遍历 ——
      // 材料 index 跳过、targetIndex 替换为 nextTargetRune（canonical 化）、
      // 其余 Rune 保留原始字节（含 padded ID），不顺带 canonical 化。
      const materialIndexSet = new Set<number>(mIdx)
      const next: Rune[] = []
      for (let i = 0; i < rawSnapshot.length; i++) {
        if (materialIndexSet.has(i)) continue
        if (i === plan.targetIndex) {
          next.push({ ...plan.nextTargetRune })
        } else {
          next.push({ ...rawSnapshot[i] })
        }
      }

      // 后置校验门：应用前确认不变量，任一失败则不写盘、不修改当前 inventory。
      if (next.length !== rawSnapshot.length - mIdx.length) {
        return fail('rune inventory length mismatch')
      }
      // 所有被消耗材料的 canonical ID 必须彻底消失、目标必须恰好一枚且为 nextTargetRune
      const consumedIdSet = new Set<string>(plan.consumedRuneIds)
      let targetSeen = 0
      for (const r of next) {
        if (consumedIdSet.has(r.id)) {
          return fail('material rune still present after apply')
        }
        if (r.id === plan.nextTargetRune.id) targetSeen++
      }
      if (targetSeen !== 1) {
        return fail('target rune count mismatch after apply')
      }
      // 其他 Rune 与 rawSnapshot 字节级一致（相对顺序不变；目标最终 index 前移量
      // = 目标之前被删材料数，由本压缩遍历的 j 游标自然保证）
      for (let i = 0, j = 0; i < rawSnapshot.length; i++) {
        if (materialIndexSet.has(i)) continue
        if (i === plan.targetIndex) {
          if (!runeEquals(next[j], plan.nextTargetRune)) {
            return fail('rune candidate mismatch')
          }
        } else if (!runeEquals(next[j], rawSnapshot[i])) {
          return fail('other rune altered')
        }
        j++
      }
      const invCheck = validateRuneInventory(next)
      if (!invCheck.ok) {
        return fail(`rune inventory invalid after apply: ${invCheck.reason}`)
      }
      const progCheck = validateRuneProgressionState(plan.nextTargetRune)
      if (!progCheck.ok) {
        return fail('rune progression invalid after apply')
      }

      // 应用到内存（事务中对 raw store 的第一种合法写：= next）
      runeInventory.value = next
      candidateApplied = true

      // 应用后拓扑合法性门：材料被删除后全局拓扑必须仍然合法（应用前一致性门已挡 stale plan，
      // 此处为最后一道防线：绝不写盘保存损坏拓扑）。
      const topo = validatePlayerRuneReferenceTopology(player.value.equipment, next)
      if (!topo.ok) {
        runeInventory.value = (rawSnapshot as Rune[]).map(r => ({ ...r }))
        candidateApplied = false
        return fail(`rune reference topology invalid after apply: ${topo.reason}`)
      }

      // §17 统一处理：saveGame 正常返回 false 或直接抛异常，均视为保存失败并完整回滚
      if (!safeSave()) {

        runeInventory.value = (rawSnapshot as Rune[]).map(r => ({ ...r }))
        candidateApplied = false
        return fail('save failed')
      }

      return {
        ok: true,
        expAdded: plan.expAdded,
        levelsGained: plan.levelsGained,
        level: plan.nextTargetRune.level,
        exp: plan.nextTargetRune.exp,
        materialsConsumed: plan.consumedRuneIds.length,
        consumedRuneIds: plan.consumedRuneIds.slice()
      }
    } catch {
      // 应用后异常（saveGame 内部抛异常等）：防御性回滚（恢复 rawSnapshot），零修改零写盘
      if (candidateApplied && rawSnapshot) {
        runeInventory.value = rawSnapshot.map(r => ({ ...r }))
        candidateApplied = false
      }
      return {
        ok: false,
        reason: 'rune batch feeding transaction threw',
        expAdded: 0,
        levelsGained: 0,
        materialsConsumed: 0,
        consumedRuneIds: []
      }
    }
  }

  /**
   * 符文单材料吞噬强化（Phase 3.11 原 API；Phase 3.13 §12 收口为批量事务的一元委托）。
   * 实现 = tryFeedRunes(targetRuneId, [materialRuneId]) 投影回原 RuneFeedingTransactionResult。
   * 禁止保留第二套独立单材料事务实现。语义完全不变：
   * 成功恰一次写盘、失败完整回滚零消耗、reason 透传（含 'save failed'）。
   */
  function tryFeedRune(targetRuneId: string, materialRuneId: string): RuneFeedingTransactionResult {
    try {
      const res = tryFeedRunes(targetRuneId, [materialRuneId])
      if (!res.ok) {
        return { ok: false, reason: res.reason, expAdded: 0, levelsGained: 0 }
      }
      return {
        ok: true,
        expAdded: res.expAdded,
        levelsGained: res.levelsGained,
        level: res.level,
        exp: res.exp
      }
    } catch {
      return { ok: false, reason: 'rune feeding transaction threw', expAdded: 0, levelsGained: 0 }
    }
  }

  /**
   * 符文手动批量锁定/解锁的唯一原子事务核心（Phase 3.15）。
   * 单 Rune trySetRuneLocked 为其一元委托（§12：禁止第二套独立 mutation transaction）。
   *
   * 单一事务纪律（§12/§13）：一个 batch plan、一个 next inventory、一次 Store 应用、
   * 一次 saveGame、一个整体回滚边界。禁止逐枚应用 / 逐枚 saveGame / 部分成功。
   *
   *   读取并深拷贝 raw inventory 恰好一次（rawSnapshot，事务中唯一 raw 读取）
   *   → validateRuneInventory(rawSnapshot) 得到 canonicalSnapshot（保序等长）
   *   → planRuneBatchLockChange 基于稳定 rawSnapshot
   *   → planner 对拍门（§14）：indices / 数量 / 分类 / 全字段 runeEquals 逐项验证
   *   → changedCount=0 幂等分支（§16）：零修改、零写盘、直接成功返回
   *   → 应用前 topology 合法门 + 稳定 topology snapshot（§17）
   *   → 构造 next：同一 rawSnapshot 单次顺序遍历（§15：只 canonical 化 changed 目标，
   *     unchanged selected 与未选择 Rune 均保留原始字节，含 padded ID）
   *   → validateRuneInventory(next) → 应用到内存 → 应用后 topology 合法且快照完全一致
   *   → saveGame 恰一次 → 失败/异常完整回滚 rawSnapshot（§18）。
   *
   * 锁定与拓扑无关：equipment / runeSlots / totalStats 完全不变。
   */
  function trySetRunesLocked(
    runeIds: readonly string[],
    isLocked: boolean
  ): RuneBatchLockTransactionResult {
    let rawSnapshot: Rune[] | null = null
    let candidateApplied = false

    function fail(reason: string): RuneBatchLockTransactionResult {
      return {
        ok: false,
        reason,
        selectedCount: 0,
        changedCount: 0,
        unchangedCount: 0,
        changedRuneIds: [],
        unchangedRuneIds: []
      }
    }

    try {
      // —— §13 事务首行：唯一一次 raw inventory 读取，建立稳定深快照 ——
      rawSnapshot = runeInventory.value.map(rune => ({ ...rune }))

      // canonical 快照：用于 planner 对拍与拓扑门（validateRuneInventory 保序等长）
      const invSnap = validateRuneInventory(rawSnapshot)
      if (!invSnap.ok) return fail(`rune inventory invalid: ${invSnap.reason}`)
      const canonicalSnapshot = invSnap.inventory
      if (canonicalSnapshot.length !== rawSnapshot.length) {
        return fail('canonical snapshot length mismatch')
      }

      // 纯批量规划：输入为稳定 rawSnapshot（不再读 raw runeInventory.value）；
      // runeIds 原样透传（planner 内部保证每个 raw index 至多读取一次）
      const plan = planRuneBatchLockChange({ inventory: rawSnapshot, runeIds, isLocked })
      if (!plan.ok) return fail(plan.reason)

      // —— §14 planner 与事务快照对拍门 ——
      const sIdx = plan.selectedIndices
      const cIdx = plan.changedIndices
      if (
        !Array.isArray(sIdx) ||
        sIdx.length < 1 ||
        plan.selectedCount !== sIdx.length ||
        plan.selectedRunes.length !== sIdx.length ||
        plan.nextRunes.length !== sIdx.length ||
        plan.selectedRuneIds.length !== sIdx.length ||
        !Array.isArray(cIdx) ||
        plan.changedCount !== cIdx.length ||
        plan.changedRuneIds.length !== cIdx.length ||
        plan.unchangedRuneIds.length !== plan.unchangedCount ||
        plan.changedCount + plan.unchangedCount !== plan.selectedCount ||
        plan.isLocked !== isLocked
      ) {
        return fail('plan shape invalid')
      }
      for (let i = 0; i < sIdx.length; i++) {
        const idx = sIdx[i]
        if (
          !Number.isInteger(idx) ||
          idx < 0 ||
          idx >= canonicalSnapshot.length ||
          (i > 0 && idx <= sIdx[i - 1])
        ) {
          return fail('plan index invalid')
        }
      }
      const selectedIndexSet = new Set<number>(sIdx)
      for (let i = 0; i < cIdx.length; i++) {
        const idx = cIdx[i]
        if (
          !Number.isInteger(idx) ||
          !selectedIndexSet.has(idx) ||
          (i > 0 && idx <= cIdx[i - 1])
        ) {
          return fail('plan changed index invalid')
        }
      }
      // 逐项身份与分类对拍：selectedRunes 与 canonicalSnapshot 全字段一致、
      // nextRunes 除 isLocked 外与 selectedRunes 全字段一致且 isLocked === 目标、
      // changed/unchanged 分类与 canonicalSnapshot 当前状态一致、ID 名单 identity 一致。
      const changedIndexSet = new Set<number>(cIdx)
      let changedSeen = 0
      let unchangedSeen = 0
      for (let i = 0; i < sIdx.length; i++) {
        const idx = sIdx[i]
        const snap = canonicalSnapshot[idx]
        const sel = plan.selectedRunes[i]
        const nxt = plan.nextRunes[i]
        if (!runeEquals(snap, sel) || snap.isLocked !== sel.isLocked) {
          return fail('plan selected rune does not match snapshot')
        }
        if (
          nxt.id !== sel.id ||
          nxt.type !== sel.type ||
          nxt.rarity !== sel.rarity ||
          nxt.level !== sel.level ||
          nxt.exp !== sel.exp ||
          nxt.statValue !== sel.statValue ||
          nxt.isLocked !== isLocked
        ) {
          return fail('plan next rune invalid')
        }
        if (plan.selectedRuneIds[i] !== sel.id) {
          return fail('plan selected rune id mismatch')
        }
        const shouldChange = snap.isLocked !== isLocked
        if (shouldChange !== changedIndexSet.has(idx)) {
          return fail('plan changed classification mismatch')
        }
        if (shouldChange) {
          if (plan.changedRuneIds[changedSeen] !== sel.id) {
            return fail('plan changed rune id mismatch')
          }
          changedSeen++
        } else {
          if (plan.unchangedRuneIds[unchangedSeen] !== sel.id) {
            return fail('plan unchanged rune id mismatch')
          }
          unchangedSeen++
        }
      }
      if (changedSeen !== plan.changedCount || unchangedSeen !== plan.unchangedCount) {
        return fail('plan classification count mismatch')
      }

      // —— §16 全部幂等分支：零 Store 赋值、零 saveGame、零 localStorage 写入 ——
      if (plan.changedCount === 0) {
        return {
          ok: true,
          isLocked,
          selectedCount: plan.selectedCount,
          changedCount: 0,
          unchangedCount: plan.unchangedCount,
          changedRuneIds: [],
          unchangedRuneIds: plan.unchangedRuneIds.slice()
        }
      }

      // —— §17 应用前 topology 合法门 + 稳定快照 ——
      const preTopo = validatePlayerRuneReferenceTopology(player.value.equipment, canonicalSnapshot)
      if (!preTopo.ok) {
        return fail(`rune reference topology invalid before apply: ${preTopo.reason}`)
      }
      const preTopoSnapshot = buildRuneTopologySnapshot(preTopo.references)

      // —— §15 构造候选：同一 rawSnapshot 单次顺序遍历 ——
      // changed index → 写入对应 canonical nextRune；unchanged selected 与未选择 index
      // 均保留 raw Rune 浅拷贝（不顺带 canonical 化 / 不补写幂等旧档形状）。
      const nextRuneByIndex = new Map<number, Rune>()
      for (let i = 0; i < sIdx.length; i++) {
        if (changedIndexSet.has(sIdx[i])) {
          nextRuneByIndex.set(sIdx[i], plan.nextRunes[i])
        }
      }
      if (nextRuneByIndex.size !== plan.changedCount) {
        return fail('plan changed mapping mismatch')
      }
      const next: Rune[] = []
      for (let i = 0; i < rawSnapshot.length; i++) {
        const replacement = nextRuneByIndex.get(i)
        next.push(replacement ? { ...replacement } : { ...rawSnapshot[i] })
      }

      // 后置校验门：应用前确认不变量，任一失败则不写盘、不修改当前 inventory。
      if (next.length !== rawSnapshot.length) {
        return fail('rune inventory length mismatch')
      }
      for (let i = 0; i < next.length; i++) {
        if (changedIndexSet.has(i)) {
          const expected = nextRuneByIndex.get(i)
          if (!expected || !runeEquals(next[i], expected) || next[i].isLocked !== isLocked) {
            return fail('rune candidate mismatch')
          }
        } else if (!runeEquals(next[i], rawSnapshot[i])) {
          return fail('other rune altered')
        }
      }
      const invCheck = validateRuneInventory(next)
      if (!invCheck.ok) {
        return fail(`rune inventory invalid after apply: ${invCheck.reason}`)
      }

      // 应用到内存（一次 Store 应用）
      runeInventory.value = next
      candidateApplied = true

      // 应用后 topology 门（§17）：合法且与应用前快照完全一致（锁定不改变拓扑）
      const postTopo = validatePlayerRuneReferenceTopology(player.value.equipment, next)
      if (!postTopo.ok) {
        runeInventory.value = (rawSnapshot as Rune[]).map(r => ({ ...r }))
        candidateApplied = false
        return fail(`rune reference topology invalid after apply: ${postTopo.reason}`)
      }
      const postTopoSnapshot = buildRuneTopologySnapshot(postTopo.references)
      if (!sameRuneTopologySnapshot(preTopoSnapshot, postTopoSnapshot)) {
        runeInventory.value = (rawSnapshot as Rune[]).map(r => ({ ...r }))
        candidateApplied = false
        return fail('rune reference topology drifted during apply')
      }

      // §18 统一处理：saveGame 正常返回 false 或直接抛异常，均视为保存失败并完整回滚
      if (!safeSave()) {

        runeInventory.value = (rawSnapshot as Rune[]).map(r => ({ ...r }))
        candidateApplied = false
        return fail('save failed')
      }

      return {
        ok: true,
        isLocked,
        selectedCount: plan.selectedCount,
        changedCount: plan.changedCount,
        unchangedCount: plan.unchangedCount,
        changedRuneIds: plan.changedRuneIds.slice(),
        unchangedRuneIds: plan.unchangedRuneIds.slice()
      }
    } catch {
      // 应用后异常（saveGame 内部抛异常 / topology validator 抛异常等）：
      // 防御性回滚（恢复完整 rawSnapshot），零修改零写盘，不报告部分成功
      if (candidateApplied && rawSnapshot) {
        runeInventory.value = rawSnapshot.map(r => ({ ...r }))
        candidateApplied = false
      }
      return fail('rune batch lock transaction threw')
    }
  }

  /**
   * 符文单 Rune 锁定/解锁（Phase 3.12 原 API；Phase 3.15 §12/§19 收口为批量事务的
   * 一元委托）。实现 = trySetRunesLocked([runeId], isLocked) 投影回原
   * RuneLockTransactionResult。禁止保留第二套独立 mutation transaction。
   * 语义完全不变：changed:true/false、最终 isLocked、幂等零写盘、保存失败回滚、
   * 异常 fail-closed、padded ID 只 canonical 化实际变化目标。
   * 单值入参的既有 reason 措辞映射回 3.12 文案（不回归）。
   */
  function trySetRuneLocked(runeId: string, isLocked: boolean): RuneLockTransactionResult {
    try {
      const res = trySetRunesLocked([runeId], isLocked)
      if (!res.ok) {
        return { ok: false, reason: projectSingleLockReason(res.reason), changed: false }
      }
      return { ok: true, changed: res.changedCount === 1, isLocked: res.isLocked }
    } catch {
      return { ok: false, reason: 'rune lock transaction threw', changed: false }
    }
  }

  /** Phase 3.15 §19：批量 reason → 单 Rune 既有 reason 措辞映射（语义不变）。 */
  function projectSingleLockReason(reason: string): string {
    switch (reason) {
      case 'runeIds items must be strings':
        return 'runeId must be a string'
      case 'runeIds items must be non-empty after trim':
        return 'runeId must be non-empty after trim'
      case 'rune batch lock planning threw':
        return 'rune lock planning threw'
      case 'rune batch lock transaction threw':
        return 'rune lock transaction threw'
      default:
        return reason
    }
  }

  /**
   * Phase 3.37：属性强化（主存档单一原子事务）。
   *
   * 返回语义：
   * - true：候选状态已成功写入主存档（金币 / 基础属性 / 购买次数 / 生命状态同一份 JSON 提交）；
   * - false：前置校验失败、候选计算失败或保存失败，内存与磁盘均无成功购买结果。
   *
   * 全部校验通过后：快照 → 候选修改（扣金 / 加属性 / 计数 +1 / maxHp 生命语义）→ saveGame()
   * 恰好一次 → 成功才返回 true。saveGame 返回 false 或抛异常（以及候选阶段任何异常）→
   * 完整回滚 gold、stats[stat]、currentHp、player.maxHp 与 statUpgradeCounts 精确拓扑，
   * 不重试保存。
   *
   * 注意：totalStats.value getter 会同步修改 player.maxHp。必须在第一次读取 totalStats.value
   * 前保存原始 player.maxHp，并保证后续校验失败时恢复它，避免「校验失败但 maxHp 被
   * computed 副作用修改」。首次 totalStats 读取本身也包在异常屏障内（Repair 1）：
   * computed 抛异常时返回 false 不外抛。statUpgradeCounts 以整份 Map 快照回滚（Repair 1），
   * 不重入候选阶段可能发生故障的同一 Map 实例的 set/delete。
   */
  function tryUpgradeStat(stat: StatType): boolean {
    const config = getAttributeUpgradeConfig(stat)
    if (!config) return false
    if (!isStatUnlocked(stat)) return false

    // —— 有限值校验 ——
    if (!Number.isFinite(player.value.gold) || player.value.gold < 0) return false
    if (!Number.isFinite(config.baseCost) || config.baseCost <= 0) return false
    if (!Number.isFinite(config.costGrowth) || config.costGrowth <= 0) return false
    if (!Number.isFinite(config.effectPerLevel) || config.effectPerLevel <= 0) return false

    const currentCount = statUpgradeCounts.value.get(stat) ?? 0
    if (currentCount < 0 || !Number.isInteger(currentCount) || !Number.isFinite(currentCount)) return false

    if (!Number.isFinite(player.value.stats[stat])) return false

    // 防御性校验：损坏存档可能把 currentHp / 有效 maxHp 存成字符串或 NaN，
    // 购买（尤其生命强化）会把它写成 NaN 或越界值，故在原子修改前拦截。
    if (!Number.isFinite(player.value.currentHp) || player.value.currentHp < 0) return false

    // totalStats.value 首次读取前保存原始 player.maxHp（getter 副作用会同步改写它）。
    // Phase 3.37 Repair 1：totalStats 是跨 Store computed（套装/天赋/称号/宠物/转生等），
    // 任一依赖计算抛异常都必须在此被吞掉并返回 false，绝不向 RoleTab 外抛。
    const previousMaxHp = player.value.maxHp
    let effectiveMaxHp: number
    try {
      effectiveMaxHp = totalStats.value.maxHp
    } catch {
      player.value.maxHp = previousMaxHp
      return false
    }
    if (!Number.isFinite(effectiveMaxHp) || effectiveMaxHp < 0) {
      player.value.maxHp = previousMaxHp
      return false
    }

    const cost = calculateStatUpgradeCost(config, currentCount)
    if (cost <= 0 || !Number.isInteger(cost) || !Number.isFinite(cost)) {
      player.value.maxHp = previousMaxHp
      return false
    }

    if (player.value.gold < cost) {
      player.value.maxHp = previousMaxHp
      return false
    }

    // —— 事务快照 ——
    const previousGold = player.value.gold
    const previousStatValue = player.value.stats[stat]!
    const previousCurrentHp = player.value.currentHp
    // Phase 3.37 Repair 1：保存整个 Map 的独立快照。rollback 通过替换 ref 恢复，
    // 不调用候选阶段可能发生故障的同一 Map 实例的 set/delete，避免重入同一故障方法。
    const previousUpgradeCounts = new Map(statUpgradeCounts.value)

    const rollback = () => {
      player.value.gold = previousGold
      player.value.stats[stat] = previousStatValue
      player.value.currentHp = previousCurrentHp
      player.value.maxHp = previousMaxHp
      statUpgradeCounts.value = new Map(previousUpgradeCounts)
    }

    // —— 候选状态（任何异常 → 同一 rollback） ——
    try {
      player.value.gold -= cost
      player.value.stats[stat] += config.effectPerLevel
      statUpgradeCounts.value.set(stat, currentCount + 1)

      // totalStats 的 computed 会自动合并所有外部加成并设置 player.maxHp
      if (stat === 'maxHp') {
        const oldCurrentHp = player.value.currentHp
        const newEffectiveMaxHp = totalStats.value.maxHp
        player.value.currentHp = Math.min(newEffectiveMaxHp, oldCurrentHp + config.effectPerLevel)
      }
    } catch {
      rollback()
      return false
    }

    // —— 单次主存档提交 ——
    let saved = false
    try {
      saved = saveGame()
    } catch {
      saved = false
    }
    if (!saved) {

      rollback()
      return false
    }

    return true
  }

  /** 旧 API 别名，供外部未迁移的 call-site 过渡使用 */
  function upgradeStat(stat: StatType, _goldAmount: number): boolean {
    return tryUpgradeStat(stat)
  }

  function getUpgradeCost(stat: StatType): number {
    const config = getAttributeUpgradeConfig(stat)
    if (!config) return Infinity
    const currentCount = statUpgradeCounts.value.get(stat) ?? 0
    return calculateStatUpgradeCost(config, currentCount)
  }

  function getPointsForGold(stat: StatType): number {
    const config = getAttributeUpgradeConfig(stat)
    return config?.effectPerLevel ?? 0
  }

  function isStatUpgradeable(stat: StatType): boolean {
    return getAttributeUpgradeConfig(stat) !== undefined
  }

  function canUpgradeStat(stat: StatType): boolean {
    if (!isStatUpgradeable(stat)) return false
    if (!isStatUnlocked(stat)) return false
    return player.value.gold >= getUpgradeCost(stat)
  }
  
  function generateRandomEquipment(rng: () => number = Math.random, source: 'normal' | 'boss' = 'normal'): Equipment | null {
    const monsterStore = useMonsterStore()
    const rebirthStore = useRebirthStore()
    const slot = EQUIPMENT_SLOTS[Math.floor(rng() * EQUIPMENT_SLOTS.length)]
    const talentBonus = useTalentStore().getSpecialBonuses()
    const rarity = generateRandomRarity(rebirthStore.rebirthStats.equipmentRarityBonus + talentBonus.rarityBonus, rng, source)
    const difficulty = monsterStore.difficultyValue || 1
    return generateEquipment(slot, rarity, difficulty, rng)
  }
  
  function equipNewEquipment(equipment: Equipment): boolean {
    // 委托权威事务：成功才清除 pendingEquipment；锁定/不够好/非法/保存失败均保留 pending。
    return tryReplaceEquipment(equipment, { clearPendingOnSuccess: true }).ok
  }

function takeDamage(damage: number): number {
    const actualDamage = Math.max(1, damage)
    player.value.currentHp = Math.max(0, player.value.currentHp - actualDamage)
    return actualDamage
  }
  
  function heal(amount: number) {
    player.value.currentHp = Math.min(player.value.maxHp, player.value.currentHp + amount)
  }
  
  function healPercent(percent: number) {
    const healAmount = calculateHealing(player.value, totalStats.value, percent)
    heal(healAmount)
  }
  
  function isDead(): boolean {
    return player.value.currentHp <= 0
  }
  
  function revive() {
    player.value.currentHp = player.value.maxHp
    saveGame()
  }
  
  // 施加战斗 Buff。重复施加同一属性：覆盖（刷新）value 与 remainingMs（不叠加、不无限增长）。
  // mode 默认为 'percent'（兼容旧调用，如幸运轮聚焦、速度 Buff）；flat 用于暴击率等绝对数值叠加。
  function applyBuff(stat: StatType, value: number, durationSeconds: number, mode: BuffValueMode = 'percent') {
    cleanupExpiredBuffs() // 避免过期 buff 堆积
    const ms = durationSeconds * 1000
    activeBuffs.value.set(stat, {
      value,
      mode,
      remainingMs: ms,
      totalDurationMs: ms
    })
  }

  // 按战斗时间递减所有 Buff；到期则从 Map 移除（从而退出 totalStats 计算）。
  // 由 gameStore.gameLoop 每帧调用，入参为已乘过 gameSpeed 的有效毫秒数。
  function updateActiveBuffs(deltaTimeMs: number) {
    if (activeBuffs.value.size === 0) return
    const next = new Map<StatType, { value: number; mode: BuffValueMode; remainingMs: number; totalDurationMs: number }>()
    for (const [stat, buff] of activeBuffs.value) {
      const remainingMs = buff.remainingMs - deltaTimeMs
      if (remainingMs > 0) next.set(stat, { value: buff.value, mode: buff.mode, remainingMs, totalDurationMs: buff.totalDurationMs })
    }
    // 重新赋值以触发 Vue 响应式（Map 内部对象属性变更不会自动触发）
    activeBuffs.value = next
  }
  
  function getActiveBuffs(): { stat: StatType; value: number; remainingTime: number; totalDuration: number; mode: BuffValueMode; percent: number }[] {
    const buffs: { stat: StatType; value: number; remainingTime: number; totalDuration: number; mode: BuffValueMode; percent: number }[] = []
    
    try {
      for (const [stat, buff] of activeBuffs.value) {
        if (buff.remainingMs > 0) {
          const remainingTime = buff.remainingMs / 1000
          const totalDuration = buff.totalDurationMs / 1000
          const percent = totalDuration > 0 ? (remainingTime / totalDuration) * 100 : 0
          buffs.push({ stat, value: buff.value, remainingTime, totalDuration, mode: buff.mode, percent })
        }
      }
    } catch {
      // silent
    }
    return buffs
  }
  
  function learnSkill(skill: Skill, slotIndex: number): boolean {
    if (slotIndex < 0 || slotIndex >= player.value.skills.length) return false
    if (skill.unlockPhase > (player.value.unlockedPhases[player.value.unlockedPhases.length - 1] || 1)) return false
    
    player.value.skills[slotIndex] = createSkillInstance(skill)
    saveGame()
    return true
  }
  
function unlockSkillSlot(): boolean {
    if (player.value.skills.length >= 5) return false

    player.value.skills.push(null)
    saveGame()
    return true
  }
  
  function getAvailableSkills(): Skill[] {
    return getUnlockedSkills(player.value.unlockedPhases[player.value.unlockedPhases.length - 1] || 1)
  }
  
  function incrementKillCount() {
    player.value.totalKillCount++
  }
  
  function updateOnlineTime(seconds: number) {
    player.value.totalOnlineTime += seconds
  }
  
  function resetGame(): boolean {
    const monsterStore = useMonsterStore()

    // Phase 3.52：原子重置事务。先快照全部受影响状态（玩家/pending/buffs/强化计数/
    // 怪物/encounter ID），应用候选重置状态并单次写盘；成功返回 true；false/throw 完整回滚。
    const previousPlayer = player.value
    const previousPending = pendingOfflineReward.value
    const previousBuffs = activeBuffs.value
    const previousCounts = statUpgradeCounts.value
    const previousMonster = monsterStore.currentMonster
    const previousEncounterId = monsterStore.currentEncounterId

    const rollback = () => {
      player.value = previousPlayer
      pendingOfflineReward.value = previousPending
      activeBuffs.value = previousBuffs
      statUpgradeCounts.value = previousCounts
      monsterStore.currentMonster = previousMonster
      monsterStore.currentEncounterId = previousEncounterId
    }

    try {
      player.value = createDefaultPlayer()
      pendingOfflineReward.value = null
      // 用新 Map 替换旧引用，不对旧容器调用 clear()，便于引用级回滚。
      activeBuffs.value = new Map()
      statUpgradeCounts.value = new Map()

      monsterStore.initMonster()

      if (!saveGame()) {
        rollback()
        return false
      }

      return true
    } catch {
      rollback()
      return false
    }
  }

  function resetForRebirth() {
    const defaultPlayer = createDefaultPlayer()
    player.value = {
      ...defaultPlayer,
      gold: 0,
      diamond: 0,
      equipment: {},
      skills: [null, null, null, null, null],
      // 保留累计数据
      totalKillCount: player.value.totalKillCount,
      totalComboCount: player.value.totalComboCount,
      maxComboCount: player.value.maxComboCount,
      totalOnlineTime: player.value.totalOnlineTime,
      totalOfflineTime: player.value.totalOfflineTime,
      lastLoginTime: Date.now()
    }
    pendingOfflineReward.value = null
    // Phase 3.58：改用新 Map 替换旧引用（不再 clear() 原地修改旧 Map），
    // 使 performRebirth 补偿事务可对 buffs/counts 做引用级回滚。
    activeBuffs.value = new Map()
    statUpgradeCounts.value = new Map()
    // Phase 3.58：纯内存重置，不再自行写盘；持久化由 performRebirth 事务统一完成。
  }

  /**
   * 计算当前已激活的套装效果
   * @param equippedItems - 当前穿戴的所有装备
   * @returns 激活的 StatBonus 列表
   */
  function calculateSetBonuses(equippedItems: Equipment[]): StatBonus[] {
    const setCounts: Record<string, number> = {}
    for (const item of equippedItems) {
      if (item.setId) {
        setCounts[item.setId] = (setCounts[item.setId] || 0) + 1
      }
    }

    const activeBonuses: StatBonus[] = []
    for (const setData of EQUIPMENT_SETS) {
      const count = setCounts[setData.id] || 0
      if (count >= 2) {
        for (const piece of setData.pieces[2]) {
          activeBonuses.push({
            type: piece.stat as StatType,
            value: piece.value,
            isPercent: piece.type === 'percent'
          })
        }
      }
      if (count >= 4) {
        for (const piece of setData.pieces[4]) {
          activeBonuses.push({
            type: piece.stat as StatType,
            value: piece.value,
            isPercent: piece.type === 'percent'
          })
        }
      }
    }
    return activeBonuses
  }

  /**
   * 判断是否应该提示替换装备
   * @param newItem - 新装备
   * @param currentItem - 当前装备（null表示空槽位）
   * @returns 是否应该提示替换（新装备评分高于当前5%以上）
   */
  function shouldPromptEquipReplace(newItem: Equipment, currentItem: Equipment | null): boolean {
    // 与权威决策保持一致：空槽位或新分数严格超过当前 105% 才提示；锁定装备不提示。
    const decision = planEquipmentReplacement(newItem, currentItem, 1.05)
    return decision.kind === 'replace' || decision.kind === 'equip-empty'
  }

  // T7.4 签到系统
  function dailyCheckIn(): AchievementReward {
    const today = new Date().setHours(0, 0, 0, 0)
    const last = localStorage.getItem(CHECKIN_KEY)

    if (last) {
      try {
        const state = JSON.parse(last) as CheckInState
        const lastDay = new Date(state.lastCheckIn).setHours(0, 0, 0, 0)
        if (lastDay === today) {
          return { gold: 0 }  // 已签到
        }
        const yesterday = today - 86400000
        if (lastDay === yesterday) {
          state.streak = Math.min(state.streak + 1, 7)
        } else {
          state.streak = 1  // 断签重置
        }
        state.lastCheckIn = Date.now()
        localStorage.setItem(CHECKIN_KEY, JSON.stringify(state))
        player.value.checkInStreak = state.streak
        player.value.lastCheckInTime = state.lastCheckIn
        const reward = CHECKIN_REWARDS[state.streak - 1]
        grantCheckInReward(reward)
        return reward
      } catch {
        // corrupted data - fall through to first checkin
      }
    }

    // 首次签到
    const state: CheckInState = { lastCheckIn: Date.now(), streak: 1 }
    localStorage.setItem(CHECKIN_KEY, JSON.stringify(state))
    player.value.checkInStreak = 1
    player.value.lastCheckInTime = Date.now()
    const reward = CHECKIN_REWARDS[0]
    grantCheckInReward(reward)
    return reward
  }

  function grantCheckInReward(reward: AchievementReward) {
    if (reward.gold) addGold(reward.gold)
    if (reward.diamond) addDiamond(reward.diamond)
    if (reward.equipmentTicket) player.value.equipmentTickets += reward.equipmentTicket
    if (reward.legendaryEquipment) {
      // 发放传说装备
      const equipment = generateRandomEquipment()
      if (equipment) {
        equipment.rarity = 'legend'
        autoEquipIfBetter(equipment)
      }
    }
  }

  function getCheckInState(): CheckInState | null {
    const last = localStorage.getItem(CHECKIN_KEY)
    if (!last) return null
    try {
      return JSON.parse(last) as CheckInState
    } catch {
      return null
    }
  }

  function canCheckInToday(): boolean {
    const today = new Date().setHours(0, 0, 0, 0)
    const state = getCheckInState()
    if (!state) return true
    const lastDay = new Date(state.lastCheckIn).setHours(0, 0, 0, 0)
    return lastDay !== today
  }

  // T49.4 新手首次奖励
  function claimNoviceReward(): boolean {
    const key = 'nz_novice_reward_claimed'
    if (!localStorage.getItem(key)) {
      addDiamond(FIRST_REWARD.diamond)
      addGold(FIRST_REWARD.gold)
      localStorage.setItem(key, 'true')
      return true
    }
    return false
  }

  // ========== T66 首次击杀系统 ==========

  /**
   * 从localStorage加载首次击杀数据
   */
  function loadFirstKills() {
    try {
      const saved = localStorage.getItem(FIRST_KILL_KEY)
      if (saved) {
        const data = JSON.parse(saved) as FirstKillState
        firstKillTemplates.value = new Set(data.templates || [])
      }
    } catch {
      firstKillTemplates.value = new Set()
    }
  }

  /**
   * 保存首次击杀数据到localStorage
   */
  function saveFirstKills() {
    const data: FirstKillState = {
      templates: Array.from(firstKillTemplates.value)
    }
    localStorage.setItem(FIRST_KILL_KEY, JSON.stringify(data))
  }

  /**
   * 获取怪物模板ID（用于首次击杀追踪）
   * 模板ID = name + level 的组合，用于识别不同类型的怪物
   * @param monster - 怪物对象
   * @returns 模板ID字符串
   */
  function getMonsterTemplateId(monster: { name: string; level: number }): string {
    return `${monster.name}_lv${monster.level}`
  }

  /**
   * 检查是否是首次击杀该模板的怪物
   * @param monster - 怪物对象
   * @returns 是否为首次击杀
   */
  function isFirstKill(monster: { name: string; level: number }): boolean {
    const templateId = getMonsterTemplateId(monster)
    return !firstKillTemplates.value.has(templateId)
  }

  /**
   * 标记怪物模板为已首次击杀
   * @param monster - 怪物对象
   */
  function markFirstKill(monster: { name: string; level: number }) {
    const templateId = getMonsterTemplateId(monster)
    firstKillTemplates.value.add(templateId)
    saveFirstKills()
  }

  /**
   * 处理首次击杀奖励（双倍金币和经验）
   * @param monster - 怪物对象
   * @param baseGold - 基础金币奖励
   * @param baseExp - 基础经验奖励
   * @returns 额外奖励（金币和经验各等于base，即双倍）
   */
  function processFirstKillReward(
    monster: { name: string; level: number },
    baseGold: number,
    baseExp: number
  ): { extraGold: number; extraExp: number } {
    if (!isFirstKill(monster)) {
      return { extraGold: 0, extraExp: 0 }
    }
    markFirstKill(monster)
    // 首次击杀奖励翻倍：额外获得与基础奖励相同的金币和经验
    return { extraGold: baseGold, extraExp: baseExp }
  }

  // ========== T66 每日目标系统 ==========

  /**
   * 从localStorage加载每日目标数据
   */
  function loadDailyKills() {
    try {
      const saved = localStorage.getItem(DAILY_KILL_KEY)
      if (saved) {
        const data = JSON.parse(saved) as DailyKillState
        const today = getTodayString()
        if (data.date === today) {
          dailyKillCount.value = data.count
          dailyKillClaimed.value = new Set(data.claimed || [])
        } else {
          // 新的一天，重置计数
          dailyKillCount.value = 0
          dailyKillClaimed.value = new Set()
        }
        dailyKillDate.value = today
      } else {
        dailyKillCount.value = 0
        dailyKillClaimed.value = new Set()
        dailyKillDate.value = getTodayString()
      }
    } catch {
      dailyKillCount.value = 0
      dailyKillClaimed.value = new Set()
      dailyKillDate.value = getTodayString()
    }
  }

  /**
   * 保存每日目标数据到localStorage
   */
  function saveDailyKills() {
    const data: DailyKillState = {
      date: dailyKillDate.value,
      count: dailyKillCount.value,
      claimed: Array.from(dailyKillClaimed.value)
    }
    localStorage.setItem(DAILY_KILL_KEY, JSON.stringify(data))
  }

  /**
   * 获取今天的日期字符串
   * @returns YYYY-MM-DD 格式字符串
   */
  function getTodayString(): string {
    const now = new Date()
    const yyyy = now.getFullYear()
    const mm = String(now.getMonth() + 1).padStart(2, '0')
    const dd = String(now.getDate()).padStart(2, '0')
    return `${yyyy}-${mm}-${dd}`
  }

  /**
   * 处理每日击杀目标进度
   * @returns 达到的每日目标索引及奖励（未达到返回null）
   * @description 每日完成3/6/9击杀时发放对应奖励，每个目标只发放一次
   */
  function processDailyKillGoal(): { targetIndex: number; gold: number } | null {
    const today = getTodayString()
    // 检查是否需要跨天重置
    if (dailyKillDate.value !== today) {
      dailyKillDate.value = today
      dailyKillCount.value = 0
      dailyKillClaimed.value = new Set()
      saveDailyKills()
    }

    dailyKillCount.value++
    const currentCount = dailyKillCount.value

    // 检查达到的目标（从低到高，满足条件且未领取）
    for (let i = 0; i < DAILY_KILL_REWARDS.length; i++) {
      const goal = DAILY_KILL_REWARDS[i]
      if (currentCount === goal.target && !dailyKillClaimed.value.has(i)) {
        dailyKillClaimed.value.add(i)
        saveDailyKills()
        return { targetIndex: i, gold: goal.gold }
      }
    }

    saveDailyKills()
    return null
  }

  /**
   * 获取每日目标当前进度
   * @returns 当前击杀数及下一目标信息
   */
  function getDailyKillProgress(): { current: number; nextTarget: number | null; claimedCount: number } {
    const today = getTodayString()
    if (dailyKillDate.value !== today) {
      return { current: 0, nextTarget: DAILY_KILL_REWARDS[0]?.target ?? null, claimedCount: 0 }
    }
    const nextIdx = DAILY_KILL_REWARDS.findIndex((_, i) => !dailyKillClaimed.value.has(i))
    return {
      current: dailyKillCount.value,
      nextTarget: nextIdx >= 0 ? DAILY_KILL_REWARDS[nextIdx].target : null,
      claimedCount: dailyKillClaimed.value.size
    }
  }

  /**
   * 综合处理击杀奖励（首次击杀 + 每日目标）
   * @param monster - 怪物对象
   * @param baseGold - 基础金币奖励
   * @param baseExp - 基础经验奖励
   * @returns 综合奖励结果
   */
  function processKillRewards(
    monster: { name: string; level: number },
    baseGold: number,
    baseExp: number
  ): KillBonusResult {
    // 首次击杀双倍
    const firstKillResult = processFirstKillReward(monster, baseGold, baseExp)
    // 每日目标检查
    const dailyGoalResult = processDailyKillGoal()

    return {
      firstKillBonus: firstKillResult.extraGold > 0,
      firstKillGold: firstKillResult.extraGold,
      firstKillExp: firstKillResult.extraExp,
      dailyGoalReached: dailyGoalResult ? dailyGoalResult.targetIndex : -1,
      dailyGoalGold: dailyGoalResult ? dailyGoalResult.gold : 0
    }
  }

  return {
    player,
    totalStats,
    persistentTotalStats,
    pendingOfflineReward,
    lastOfflineCheckpointAt,
    lastLoginTime,
    recordLogout,
    activeBuffs,
    statUpgradeCounts,
    pendingEquipment,
    loadGame,
    saveGame,
    claimOfflineReward,
    addGold,
    applyGoldRewardInMemory,
    addDiamond,
    applyDiamondRewardInMemory,
    spendDiamonds,
    tryPurchaseTheme,
    addMaterial,
    addGachaTicket,
    addPassiveShard,
    addAvatarFrame,
    addSetPiece,
    addExperience,
    applyExperienceRewardInMemory,
    checkLevelUp,
    getExpNeeded,
    getExpPerSecond,
    getExpPerKill,
    getAverageExpPerSecond,
    getSecondsToLevelUp,
    checkPhaseUnlock,
    isStatUnlocked,
    equipItem,
    autoEquipIfBetter,
    unequipItem,
    toggleEquipLock,
    tryReplaceEquipment,
    tryRecycleEquippedItem,
    tryUpgradeEquipmentAffix,
    tryRefineEquipment,
    tryEmbedEquipmentRune,
    tryRemoveEquipmentRune,
    tryAddRuneExperience,
    tryAcquireRune,
    tryGenerateAndAcquireRune,
    tryFeedRune,
    tryFeedRunes,
    trySetRuneLocked,
    trySetRunesLocked,
    runeInventory,
    upgradeStat,
    tryUpgradeStat,
    getUpgradeCost,
    getPointsForGold,
    isStatUpgradeable,
    canUpgradeStat,
    generateRandomEquipment,
    equipNewEquipment,
    takeDamage,
    heal,
    healPercent,
    isDead,
    revive,
    applyBuff,
    updateActiveBuffs,
    getActiveBuffs,
    learnSkill,
    unlockSkillSlot,
    getAvailableSkills,
    incrementKillCount,
    updateOnlineTime,
    resetGame,
    resetForRebirth,
    calculateSetBonuses,
    shouldPromptEquipReplace,
    // T7.4 签到系统
    dailyCheckIn,
    getCheckInState,
    canCheckInToday,
    CHECKIN_REWARDS,

    // T49.4 新手首次奖励
    claimNoviceReward,

    // T8.1 月卡/战令
    monthlyCard,
    battlePass,
    purchaseMonthlyCard,
    claimMonthlyCardReward,
    isMonthlyCardActive,
    getMonthlyCardRemainingDays,
    getMonthlyCardGoldBonus,
    purchaseBattlePass,
    addBattlePassExp,
    saveBattlePassData,
    claimBattlePassReward,
    claimBattlePassPremiumReward,
    getBattlePassProgress,
    BATTLE_PASS_REWARDS,

    // T8.3 排行榜
    leaderboard,
    updateLeaderboard,
    getLeaderboard,

    // T66 首次击杀系统
    firstKillTemplates,
    dailyKillCount,
    dailyKillClaimed,
    loadFirstKills,
    loadDailyKills,
    getMonsterTemplateId,
    isFirstKill,
    markFirstKill,
    processFirstKillReward,
    processDailyKillGoal,
    getDailyKillProgress,
    processKillRewards,
    DAILY_KILL_REWARDS
  }
})
