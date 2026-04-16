import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Player, PlayerStats, Equipment, EquipmentSlot, Skill, StatType, StatBonus } from '../types'
import { createDefaultPlayer, calculateTotalStats, calculateOfflineReward, isEquipmentBetter, calculateRecyclePrice, calculateHealing, calculateLuckEffects } from '../utils/calc'
import { calculateActiveSets } from '../utils/equipmentSetCalculator'
import { generateEquipment, generateRandomRarity } from '../utils/equipmentGenerator'
import type { AchievementReward } from '../types'
import { EQUIPMENT_SLOTS, PHASE_UNLOCK, STAT_CATEGORY } from '../types'
import { getUnlockedSkills, createSkillInstance } from '../utils/skillSystem'
import { useMonsterStore } from './monsterStore'
import { useGameStore } from './gameStore'
import { useCollectionStore } from './collectionStore'
import { useTrainingStore } from './trainingStore'
import { useRebirthStore } from './rebirthStore'
import { useCultivationStore } from './cultivationStore'
import { EQUIPMENT_SETS } from '../utils/constants'
import { FIRST_REWARD } from './guideStore'

/**
 * 可升级属性配置列表
 */
export const ATTRIBUTE_UPGRADES = [
  { key: 'attack' as StatType, label: '攻击', baseCost: 10, growth: 1.1, effect: 2 },
  { key: 'defense' as StatType, label: '防御', baseCost: 10, growth: 1.1, effect: 2 },
  { key: 'maxHp' as StatType, label: '生命', baseCost: 10, growth: 1.1, effect: 20 },
  { key: 'speed' as StatType, label: '速度', baseCost: 10, growth: 1.1, effect: 1 },
  { key: 'penetration' as StatType, label: '穿透', baseCost: 50, growth: 1.15, effect: 5 },
] as const

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
  const pendingOfflineReward = ref<{ gold: number; exp: number } | null>(null)
  const activeBuffs = ref<Map<StatType, { value: number; endTime: number }>>(new Map())
  const statUpgradeCounts = ref<Map<StatType, number>>(new Map())
  const pendingEquipment = ref<Equipment | null>(null)

  // T28 离线收益追踪
  const lastLoginTime = ref(Date.now())

  // T66 首次击杀追踪
  const firstKillTemplates = ref<Set<string>>(new Set())

  // T66 每日目标追踪
  const dailyKillCount = ref(0)
  const dailyKillDate = ref('')
  const dailyKillClaimed = ref<Set<number>>(new Set())

  function recordLogout() {
    localStorage.setItem(LAST_LOGIN_KEY, String(Date.now()))
    localStorage.setItem(LAST_FLOOR_KEY, String(player.value.level))
  }

  function calculateOfflineProgress() {
    const lastLogin = Number(localStorage.getItem(LAST_LOGIN_KEY)) || Date.now()
    const elapsed = Date.now() - lastLogin  // ms
    const maxOffline = 8 * 60 * 60 * 1000  // 8小时
    const cappedElapsed = Math.min(elapsed, maxOffline)

    // 每分钟基础收益
    const minutes = cappedElapsed / 60000
    const baseGold = minutes * 10  // 每分钟10金币
    const baseExp = minutes * 5   // 每分钟5经验

    return { gold: Math.floor(baseGold), exp: Math.floor(baseExp), minutes: Math.floor(minutes) }
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
  
  // T73 清理过期buff（从computed中移出，避免副作用）
  function cleanupExpiredBuffs() {
    for (const [stat, buff] of activeBuffs.value) {
      if (Date.now() >= buff.endTime) {
        activeBuffs.value.delete(stat)
      }
    }
  }

  const totalStats = computed<PlayerStats>(() => {
    const cultivation = useCultivationStore()
    const stats = calculateTotalStats(player.value, {
      starMultiplier: cultivation.starMultiplier,
      ascensionMultiplier: cultivation.ascensionMultiplier,
      constellationBonus: cultivation.getConstellationBonus()
    })
    const rebirthStore = useRebirthStore()
    const rebirthStats = rebirthStore.rebirthStats
    
    for (const [stat, buff] of activeBuffs.value) {
      stats[stat] = stats[stat] * (1 + buff.value / 100)
    }
    
    stats.attack += rebirthStats.attackBonus
    stats.defense += rebirthStats.defenseBonus
    stats.maxHp += rebirthStats.maxHpBonus
    stats.critRate += rebirthStats.critRateBonus
    stats.critDamage += rebirthStats.critDamageBonus
    stats.penetration += rebirthStats.penetrationBonus

    // T18.4 穿透线性成长（每难度 +0.1）
    const monsterStore = useMonsterStore()
    stats.penetration += Math.floor(monsterStore.difficultyValue * 0.1)

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

    player.value.maxHp = stats.maxHp
    
    return stats
  })
  
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

        if (data.pendingOfflineReward) {
          pendingOfflineReward.value = data.pendingOfflineReward
        }

        const offlineSeconds = (Date.now() - player.value.lastLoginTime) / 1000
        if (offlineSeconds > 60) {
          pendingOfflineReward.value = calculateOfflineReward(player.value, offlineSeconds)
          player.value.totalOfflineTime += offlineSeconds
        }

        player.value.lastLoginTime = Date.now()
        cleanupExpiredBuffs() // T73 加载时清理过期buff
      }

      // T28 初始化离线登录时间
      const savedLastLogin = localStorage.getItem(LAST_LOGIN_KEY)
      if (savedLastLogin) {
        lastLoginTime.value = Number(savedLastLogin)
      } else {
        lastLoginTime.value = Date.now()
        localStorage.setItem(LAST_LOGIN_KEY, String(lastLoginTime.value))
      }

      loadBattlePassData()

      // T66 加载首次击杀数据
      loadFirstKills()
      // T66 加载每日目标数据
      loadDailyKills()
    } catch (e) {
      player.value = createDefaultPlayer()
    }
  }
  
  function saveGame() {
    const monsterStore = useMonsterStore()
    const gameStore = useGameStore()
    const trainingStore = useTrainingStore()

    const saveData = {
      player: player.value,
      pendingOfflineReward: pendingOfflineReward.value,
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
      recordLogout()
    } catch {
      // silent save failure
    }
  }
  
  function claimOfflineReward() {
    if (pendingOfflineReward.value) {
      player.value.gold += pendingOfflineReward.value.gold
      player.value.experience += pendingOfflineReward.value.exp
      pendingOfflineReward.value = null
      saveGame()
    }
  }
  
  function addGold(amount: number) {
    const rebirthStore = useRebirthStore()
    const luckEffects = calculateLuckEffects(player.value.stats.luck)
    const rebirthBonus = rebirthStore.rebirthStats.goldBonusPercent / 100
    const monthlyCardBonus = getMonthlyCardGoldBonus()
    const bonusAmount = Math.floor(amount * (luckEffects.goldBonus + rebirthBonus + monthlyCardBonus))
    player.value.gold += amount + bonusAmount
    // T8.1 战令：金币获取增加经验
    addBattlePassExp(Math.floor(amount / 10))
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
  
  function equipItem(equipment: Equipment) {
    const slot = equipment.slot
    const currentEquip = player.value.equipment[slot] ?? null
    
    if (currentEquip && !currentEquip.isLocked) {
      const recycleGold = calculateRecyclePrice(currentEquip)
      player.value.gold += recycleGold
    }
    
    if (isEquipmentBetter(equipment, currentEquip)) {
      player.value.equipment[slot] = equipment
      saveGame()
      return true
    } else if (!currentEquip) {
      player.value.equipment[slot] = equipment
      saveGame()
      return true
    }
    return false
  }
  
  function autoEquipIfBetter(equipment: Equipment): boolean {
    const slot = equipment.slot
    const currentEquip = player.value.equipment[slot] ?? null
    
    if (isEquipmentBetter(equipment, currentEquip)) {
      if (currentEquip && !currentEquip.isLocked) {
        const recycleGold = calculateRecyclePrice(currentEquip)
        player.value.gold += recycleGold
      }
      // T8.2 图鉴：记录装备
      try {
        const collectionStore = useCollectionStore()
        collectionStore.discoverEquipment(equipment.id)
      } catch { /* silent */ }
      player.value.equipment[slot] = equipment
      saveGame()
      return true
    } else if (!currentEquip) {
      player.value.equipment[slot] = equipment
      saveGame()
      return true
    }
    return false
  }
  
  function unequipItem(slot: EquipmentSlot) {
    const equip = player.value.equipment[slot]
    if (equip) {
      const recycleGold = calculateRecyclePrice(equip)
      player.value.gold += recycleGold
      delete player.value.equipment[slot]
      saveGame()
    }
  }
  
  function toggleEquipLock(slot: EquipmentSlot) {
    const equip = player.value.equipment[slot]
    if (equip) {
      equip.isLocked = !equip.isLocked
      saveGame()
    }
  }
  
  function upgradeStat(stat: StatType, goldAmount: number): boolean {
    if (!isStatUnlocked(stat)) return false
    
    if (player.value.gold < goldAmount) return false
    
    const currentCount = statUpgradeCounts.value.get(stat) || 0
    const pointsToGain = Math.floor(Math.log10(goldAmount + 1) * 2) + 1
    
    if (pointsToGain <= 0) return false
    
    player.value.gold -= goldAmount
    player.value.stats[stat] += pointsToGain
    statUpgradeCounts.value.set(stat, currentCount + 1)
    
    if (stat === 'maxHp') {
      player.value.maxHp = player.value.stats.maxHp
    }
    saveGame()
    return true
  }
  
  function getUpgradeCost(stat: StatType): number {
    const currentCount = statUpgradeCounts.value.get(stat) || 0
    return Math.floor(Math.pow(10, currentCount + 1))
  }
  
  function getPointsForGold(stat: StatType): number {
    const gold = getUpgradeCost(stat)
    return Math.floor(Math.log10(gold + 1) * 2) + 1
  }
  
  function canUpgradeStat(stat: StatType): boolean {
    if (!isStatUnlocked(stat)) return false
    return player.value.gold >= getUpgradeCost(stat)
  }
  
  function generateRandomEquipment(): Equipment | null {
    const monsterStore = useMonsterStore()
    const rebirthStore = useRebirthStore()
    const slot = EQUIPMENT_SLOTS[Math.floor(Math.random() * EQUIPMENT_SLOTS.length)]
    const rarity = generateRandomRarity(rebirthStore.rebirthStats.equipmentRarityBonus)
    const difficulty = monsterStore.difficultyValue || 1
    return generateEquipment(slot, rarity, difficulty)
  }
  
  function equipNewEquipment(equipment: Equipment): boolean {
    const slot = equipment.slot
    const currentEquip = player.value.equipment[slot] ?? null
    
    if (isEquipmentBetter(equipment, currentEquip)) {
      if (currentEquip && !currentEquip.isLocked) {
        const recycleGold = calculateRecyclePrice(currentEquip)
        player.value.gold += recycleGold
      }
      player.value.equipment[slot] = equipment
      saveGame()
      pendingEquipment.value = null
      return true
    } else if (!currentEquip) {
      player.value.equipment[slot] = equipment
      saveGame()
      pendingEquipment.value = null
      return true
    }
    return false
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
  
  function applyBuff(stat: StatType, value: number, durationSeconds: number) {
    cleanupExpiredBuffs() // T73 避免过期buff堆积
    activeBuffs.value.set(stat, {
      value,
      endTime: Date.now() + durationSeconds * 1000
    })
  }
  
  function getActiveBuffs(): { stat: StatType; value: number; remainingTime: number; totalDuration: number; percent: number }[] {
    const buffs: { stat: StatType; value: number; remainingTime: number; totalDuration: number; percent: number }[] = []
    const now = Date.now()
    
    try {
      for (const [stat, buff] of activeBuffs.value) {
        if (now < buff.endTime) {
          const remainingTime = (buff.endTime - now) / 1000
          const originalDuration = getBuffOriginalDuration(stat)
          const percent = originalDuration > 0 ? (remainingTime / originalDuration) * 100 : 0
          buffs.push({ stat, value: buff.value, remainingTime, totalDuration: originalDuration, percent })
        }
      }
    } catch {
      // silent
    }
    return buffs
  }
  
  function getBuffOriginalDuration(stat: StatType): number {
    const skills = player.value.skills
    if (!skills) return 5
    for (const skill of skills) {
      if (skill && skill.buffEffect && skill.buffEffect.stat === stat) {
        return skill.buffEffect.duration
      }
    }
    return 5
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
    return isEquipmentBetter(newItem, currentItem, 1.05)
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
    pendingOfflineReward,
    lastLoginTime,
    recordLogout,
    calculateOfflineProgress,
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
    upgradeStat,
    getUpgradeCost,
    getPointsForGold,
    canUpgradeStat,
    generateRandomEquipment,
    equipNewEquipment,
    takeDamage,
    heal,
    healPercent,
    isDead,
    revive,
    applyBuff,
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
