import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Player, PlayerStats, Equipment, EquipmentSlot, Skill, StatType, StatBonus, BuffValueMode } from '../types'
import { createDefaultPlayer, calculateTotalStats, calculateHealing, applyEffectiveStatCaps } from '../utils/calc'
import { calculateOfflineSettlement, makeSettlement, mergeSettlements, normalizePendingOfflineReward, MIN_OFFLINE_SECONDS, type OfflineSettlement } from '../utils/offlineReward'
import { parsePositiveTimestamp } from '../utils/timestamp'
import { planEquipmentReplacement, validateEquipmentForEconomy, planEquipmentRecycle, type EquipmentReplacementDecision } from '../utils/equipmentReplacement'
import { planEquipmentAffixUpgrade } from '../utils/equipmentAffixUpgrade'
import { planEquipmentRefinement } from '../utils/equipmentRefining'
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

  function recordLogout() {
    // 仅在页面隐藏/关闭时记录最后活跃时刻并落盘；结算统一走 lastOfflineCheckpointAt。
    // checkpoint 不得在写入成功前推进：saveGame 仅在 setItem 成功后才会把
    // lastOfflineCheckpointAt 设为 now，因此即便 LAST_FLOOR_KEY 写入失败，内存 checkpoint
    // 也不会被提前推进；其失败被吞掉，不影响 checkpoint 落盘。
    const now = Date.now()
    try {
      localStorage.setItem(LAST_FLOOR_KEY, String(player.value.level))
    } catch {
      // 楼层信息保存失败不致命，不阻断 checkpoint 落盘
    }
    saveGame(now)
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

  // T8.1 月卡：领取每日奖励（100钻石+20%金币加成）
  function claimMonthlyCardReward(): AchievementReward | null {
    if (!monthlyCard.value) return null
    const now = Date.now()
    const purchasedAt = monthlyCard.value.purchasedAt
    const expiry = purchasedAt + MONTHLY_CARD_DURATION
    if (now > expiry) return null  // 已过期

    // 每日只能领一次
    const lastClaim = monthlyCard.value.lastClaimAt
    const today = new Date(now).setHours(0, 0, 0, 0)
    const lastDay = lastClaim > 0 ? new Date(lastClaim).setHours(0, 0, 0, 0) : 0
    if (lastDay === today) return null  // 今日已领取

    monthlyCard.value.lastClaimAt = now
    localStorage.setItem(MONTHLY_CARD_KEY, JSON.stringify(monthlyCard.value))

    const reward: AchievementReward = { gold: 0, diamond: 100 }
    addDiamond(100)
    // 20%金币加成记录到玩家状态（加成在addGold时自动生效）
    return reward
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

  // T8.1 战令：添加经验（升级用）
  function addBattlePassExp(amount: number) {
    battlePass.value.exp += amount
    // 升级：每1000 exp升1级，上限30级
    while (battlePass.value.exp >= 1000 && battlePass.value.level < 30) {
      battlePass.value.exp -= 1000
      battlePass.value.level++
    }
    battlePass.value.level = Math.min(battlePass.value.level, 30)
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
    })
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
    }
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
  
  function addDiamond(amount: number) {
    player.value.diamond += amount
  }

  function spendDiamonds(amount: number): boolean {
    if (player.value.diamond < amount) return false
    player.value.diamond -= amount
    return true
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
  
  function checkLevelUp() {
    const expNeeded = player.value.level * 100 * Math.pow(1.5, player.value.level - 1)
    while (player.value.experience >= expNeeded) {
      player.value.experience -= expNeeded
      player.value.level++
      player.value.stats.attack += 2
      player.value.stats.defense += 2
      player.value.stats.maxHp += 20
      player.value.stats.speed += 1
      player.value.maxHp = player.value.stats.maxHp
      useTalentStore().addTalentPoints(1)
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

    // 取得纯精炼 plan（确定性校验全部通过后才在内部调用 RNG；拒绝则零修改、不扣款）
    const plan = planEquipmentRefinement(equip, player.value.gold, rng)
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
    if (!Number.isFinite(totalStats.value.maxHp) || totalStats.value.maxHp < 0) return false

    const cost = calculateStatUpgradeCost(config, currentCount)
    if (cost <= 0 || !Number.isInteger(cost) || !Number.isFinite(cost)) return false

    if (player.value.gold < cost) return false

    // —— 原子购买：全部校验通过后一次性修改状态 ——
    player.value.gold -= cost
    player.value.stats[stat] += config.effectPerLevel
    statUpgradeCounts.value.set(stat, currentCount + 1)

    // totalStats 的 computed 会自动合并所有外部加成并设置 player.maxHp
    if (stat === 'maxHp') {
      const oldCurrentHp = player.value.currentHp
      const newEffectiveMaxHp = totalStats.value.maxHp
      player.value.currentHp = Math.min(newEffectiveMaxHp, oldCurrentHp + config.effectPerLevel)
    }

    saveGame()
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
  
  function resetGame() {
    const monsterStore = useMonsterStore()
    player.value = createDefaultPlayer()
    monsterStore.initMonster()
    pendingOfflineReward.value = null
    activeBuffs.value.clear()
    statUpgradeCounts.value = new Map()
    saveGame()
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
    activeBuffs.value.clear()
    statUpgradeCounts.value = new Map()
    saveGame()
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
    addDiamond,
    spendDiamonds,
    addMaterial,
    addGachaTicket,
    addPassiveShard,
    addAvatarFrame,
    addSetPiece,
    addExperience,
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
