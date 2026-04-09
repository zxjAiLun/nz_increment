/**
 * 游戏核心Store
 * 
 * 负责管理战斗循环、行动槽、伤害统计和战斗日志
 * 
 * ## 核心概念
 * 
 * ### 行动槽系统（Action Gauge）
 * - 玩家和怪物各自有独立的行动槽，初始值0
 * - 每tick根据速度填充槽位：gauge += speed × deltaTime × GAUGE_TICK_RATE / 100
 * - 槽位达到GAUGE_MAX(100)时触发行动
 * - 行动后槽位清零（减去GAUGE_MAX）
 * 
 * ### 速度优势
 * - 速度比 ≥ 2：获得先手权（对手槽位清零）+ 同tick双动
 * - 速度比 ≥ 1.5：伤害+10%
 * 
 * ### 伤害计算链（严格顺序）
 * 命中判定 → 基础伤害 → 暴击 → 增伤 → 护甲 → 真实/虚空
 * 
 * ### 战斗流程
 * 1. 更新技能冷却
 * 2. 更新行动槽
 * 3. 怪物行动（如果槽位满）
 * 4. 玩家行动（如果槽位满，自动选择最优先技能或普攻）
 * 
 * @module gameStore
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { usePlayerStore } from './playerStore'
import { useMonsterStore } from './monsterStore'
import { useAchievementStore } from './achievementStore'
import { useSkillStore } from './skillStore'
import { useRebirthStore } from './rebirthStore'
import { calculatePlayerDamage, calculateMonsterDamage, calculateLuckEffects, calculateLifesteal, calculateSkillLifesteal, calculateLifestealCap } from '../utils/calc'
import { getSkillById } from '../utils/skillSystem'
import { PASSIVE_SKILLS } from '../data/passiveSkills'
import { applyPassiveEffects } from '../utils/passiveEvaluator'
import type { Skill } from '../types'
import type { AchievementReward } from '../utils/achievementChecker'

// T8.2 图鉴系统常量
const COLLECTION_KEY = 'nz_collection_v1'

// 怪物和装备总数（实际值由怪物库和装备库决定）
const MONSTER_COUNT = 50
const EQUIPMENT_COUNT = 30

interface CollectionState {
  discoveredMonsters: string[]  // 怪物id数组（Set转JSON用数组）
  discoveredEquipments: string[]  // 装备id数组
  milestonesClaimed: number[]  // 已领取的里程碑奖励阶段
}

// T8.3 每日/每周挑战接口
export interface DailyChallenge {
  id: string
  name: string
  description: string
  target: number
  progress: number
  reward: AchievementReward
  resetAt: number  // timestamp，挑战重置时间
  type: 'daily' | 'weekly'
}

export const useGameStore = defineStore('game', () => {
  /** 游戏是否暂停 */
  const isPaused = ref(false)
  
  /** 战斗日志数组，最新日志在前面，最多保留50条 */
  const battleLog = ref<string[]>([])
  
  /** 战斗循环错误状态 */
  const battleError = ref<Error | null>(null)
  
  /** 伤害弹出数组 */
  const damagePopups = ref<Array<{
    id: number
    type: 'normal' | 'crit' | 'true' | 'void' | 'skill' | 'heal' | 'miss'
    value: number
    x: number
    y: number
  }>>([])
  
  /** 伤害弹出ID计数器 */
  let popupId = 0
  
  /** 上次使用的技能（用于UI展示） */
  const lastSkillUsed = ref<Skill | null>(null)
  
  /** 玩家行动槽当前值 */
  const playerActionGauge = ref(0)
  
  /** 怪物行动槽当前值 */
  const monsterActionGauge = ref(0)

  // T14 被动技能战斗上下文
  /** 当前战斗回合计数 */
  const battleTurnCount = ref(0)
  /** 当前连击计数（玩家攻击累积，被击中时重置） */
  const currentCombo = ref(0)
  
  /** 行动槽上限值（固定100，禁止修改） */
  const GAUGE_MAX = 100
  
  /** 行动槽填充速率系数 */
  const GAUGE_TICK_RATE = 10
  
  /** 游戏速度倍率（影响deltaTime的放大系数） */
  const gameSpeed = ref(8)

  // T7.3 每日/每周挑战
  const dailyChallenges = ref<DailyChallenge[]>([])
  const weeklyChallenges = ref<DailyChallenge[]>([])

  // T8.2 图鉴系统
  const collection = ref<CollectionState>({
    discoveredMonsters: [],
    discoveredEquipments: [],
    milestonesClaimed: []
  })

  // T8.2 图鉴里程碑奖励配置（10%/25%/50%/75%/100%）
  const COLLECTION_MILESTONES = [
    { percent: 10, reward: { gold: 500 } },
    { percent: 25, reward: { diamond: 5 } },
    { percent: 50, reward: { exp: 1000 } },
    { percent: 75, reward: { gold: 2000, diamond: 10 } },
    { percent: 100, reward: { legendaryEquipment: 1 } }
  ]

  // T7.3 生成每日挑战
  function generateDailyChallenges(): DailyChallenge[] {
    const now = Date.now()
    const tomorrow = new Date(now)
    tomorrow.setDate(tomorrow.getDate() + 1)
    tomorrow.setHours(0, 0, 0, 0)
    const resetAt = tomorrow.getTime()

    const templates: Omit<DailyChallenge, 'progress' | 'resetAt' | 'type'>[] = [
      { id: 'daily_kill_50', name: '每日击杀', description: '击杀50只怪物', target: 50, reward: { gold: 1000 } },
      { id: 'daily_kill_100', name: '每日猎手', description: '击杀100只怪物', target: 100, reward: { diamond: 5 } },
      { id: 'daily_gold_10k', name: '每日赚金', description: '累计获得10K金币', target: 10000, reward: { gold: 2000 } },
      { id: 'daily_training_20', name: '每日修炼', description: '练功房击杀20只', target: 20, reward: { exp: 500 } },
    ]

    return templates.map(t => ({ ...t, progress: 0, resetAt, type: 'daily' as const }))
  }

  // T7.3 生成每周挑战
  function generateWeeklyChallenges(): DailyChallenge[] {
    const now = Date.now()
    const nextWeek = new Date(now)
    nextWeek.setDate(nextWeek.getDate() + (7 - nextWeek.getDay()))
    nextWeek.setHours(0, 0, 0, 0)
    const resetAt = nextWeek.getTime()

    const templates: Omit<DailyChallenge, 'progress' | 'resetAt' | 'type'>[] = [
      { id: 'weekly_kill_1000', name: '每周击杀', description: '击杀1000只怪物', target: 1000, reward: { diamond: 50 } },
      { id: 'weekly_kill_5000', name: '每周猎手', description: '击杀5000只怪物', target: 5000, reward: { gold: 50000, diamond: 20 } },
      { id: 'weekly_training_500', name: '每周修炼', description: '练功房击杀500只', target: 500, reward: { passive: 1 } },
      { id: 'weekly_gold_1m', name: '每周赚金', description: '累计获得1M金币', target: 1000000, reward: { gold: 200000 } },
    ]

    return templates.map(t => ({ ...t, progress: 0, resetAt, type: 'weekly' as const }))
  }

  // T7.3 初始化挑战
  function initChallenges() {
    const savedDaily = localStorage.getItem('nz_daily_challenges_v1')
    const savedWeekly = localStorage.getItem('nz_weekly_challenges_v1')
    const now = Date.now()

    if (savedDaily) {
      const parsed = JSON.parse(savedDaily) as DailyChallenge[]
      // 过滤已过期的挑战并重新生成
      const expired = parsed.filter(c => c.resetAt <= now)
      if (expired.length > 0) {
        dailyChallenges.value = generateDailyChallenges()
        localStorage.setItem('nz_daily_challenges_v1', JSON.stringify(dailyChallenges.value))
      } else {
        dailyChallenges.value = parsed
      }
    } else {
      dailyChallenges.value = generateDailyChallenges()
      localStorage.setItem('nz_daily_challenges_v1', JSON.stringify(dailyChallenges.value))
    }

    if (savedWeekly) {
      const parsed = JSON.parse(savedWeekly) as DailyChallenge[]
      const expired = parsed.filter(c => c.resetAt <= now)
      if (expired.length > 0) {
        weeklyChallenges.value = generateWeeklyChallenges()
        localStorage.setItem('nz_weekly_challenges_v1', JSON.stringify(weeklyChallenges.value))
      } else {
        weeklyChallenges.value = parsed
      }
    } else {
      weeklyChallenges.value = generateWeeklyChallenges()
      localStorage.setItem('nz_weekly_challenges_v1', JSON.stringify(weeklyChallenges.value))
    }

    // T8.2 加载图鉴数据
    loadCollectionData()
  }

  // T8.2 加载图鉴数据
  function loadCollectionData() {
    try {
      const saved = localStorage.getItem(COLLECTION_KEY)
      if (saved) {
        const parsed = JSON.parse(saved) as CollectionState
        collection.value = parsed
      }
    } catch {
      // silent
    }
  }

  // T8.2 发现怪物
  function discoverMonster(id: string) {
    if (!collection.value.discoveredMonsters.includes(id)) {
      collection.value.discoveredMonsters.push(id)
      checkCollectionMilestone()
      saveCollectionData()
    }
  }

  // T8.2 发现装备
  function discoverEquipment(id: string) {
    if (!collection.value.discoveredEquipments.includes(id)) {
      collection.value.discoveredEquipments.push(id)
      checkCollectionMilestone()
      saveCollectionData()
    }
  }

  // T8.2 检查图鉴里程碑
  function checkCollectionMilestone(): AchievementReward[] {
    const playerStore = usePlayerStore()
    const total = MONSTER_COUNT + EQUIPMENT_COUNT
    const discovered = collection.value.discoveredMonsters.length + collection.value.discoveredEquipments.length
    const percent = Math.floor((discovered / total) * 100)
    const rewards: AchievementReward[] = []

    for (const milestone of COLLECTION_MILESTONES) {
      if (percent >= milestone.percent && !collection.value.milestonesClaimed.includes(milestone.percent)) {
        collection.value.milestonesClaimed.push(milestone.percent)
        const reward = milestone.reward
        if (reward.gold) playerStore.addGold(reward.gold)
        if (reward.diamond) playerStore.addDiamond(reward.diamond)
        if (reward.exp) playerStore.addExperience(reward.exp)
        if (reward.legendaryEquipment) {
          const equipment = playerStore.generateRandomEquipment()
          if (equipment) {
            equipment.rarity = 'legend'
            playerStore.autoEquipIfBetter(equipment)
          }
        }
        rewards.push(reward)
      }
    }

    if (rewards.length > 0) saveCollectionData()
    return rewards
  }

  function saveCollectionData() {
    localStorage.setItem(COLLECTION_KEY, JSON.stringify(collection.value))
  }

  // T8.2 获取图鉴进度
  function getCollectionProgress(): { discovered: number; total: number; percent: number } {
    const total = MONSTER_COUNT + EQUIPMENT_COUNT
    const discovered = collection.value.discoveredMonsters.length + collection.value.discoveredEquipments.length
    return {
      discovered,
      total,
      percent: total > 0 ? Math.floor((discovered / total) * 100) : 0
    }
  }

  // T8.2 领取图鉴里程碑奖励
  function claimCollectionMilestone(percent: number): AchievementReward | null {
    const milestone = COLLECTION_MILESTONES.find(m => m.percent === percent)
    if (!milestone) return null
    if (collection.value.milestonesClaimed.includes(percent)) return null

    const progress = getCollectionProgress()
    if (progress.percent < percent) return null

    collection.value.milestonesClaimed.push(percent)
    saveCollectionData()
    return milestone.reward
  }

  // T7.3 更新挑战进度
  function updateChallengeProgress(type: 'kill' | 'trainingKill' | 'gold', amount: number) {
    const playerStore = usePlayerStore()
    const now = Date.now()

    // 更新每日挑战
    for (const challenge of dailyChallenges.value) {
      if (challenge.resetAt <= now) continue
      if (challenge.id.startsWith('daily_kill') && type === 'kill') {
        challenge.progress = Math.min(challenge.progress + amount, challenge.target)
      } else if (challenge.id.startsWith('daily_training') && type === 'trainingKill') {
        challenge.progress = Math.min(challenge.progress + amount, challenge.target)
      } else if (challenge.id.startsWith('daily_gold') && type === 'gold') {
        challenge.progress = Math.min(challenge.progress + amount, challenge.target)
      }
    }

    // 更新每周挑战
    for (const challenge of weeklyChallenges.value) {
      if (challenge.resetAt <= now) continue
      if (challenge.id.startsWith('weekly_kill') && type === 'kill') {
        challenge.progress = Math.min(challenge.progress + amount, challenge.target)
      } else if (challenge.id.startsWith('weekly_training') && type === 'trainingKill') {
        challenge.progress = Math.min(challenge.progress + amount, challenge.target)
      } else if (challenge.id.startsWith('weekly_gold') && type === 'gold') {
        challenge.progress = Math.min(challenge.progress + amount, challenge.target)
      }
    }

    localStorage.setItem('nz_daily_challenges_v1', JSON.stringify(dailyChallenges.value))
    localStorage.setItem('nz_weekly_challenges_v1', JSON.stringify(weeklyChallenges.value))
  }

  // T7.3 检查挑战完成状态并发放奖励
  function checkChallengeCompletion(): DailyChallenge[] {
    const playerStore = usePlayerStore()
    const completed: DailyChallenge[] = []
    const now = Date.now()

    const allChallenges = [...dailyChallenges.value, ...weeklyChallenges.value]
    for (const challenge of allChallenges) {
      if (challenge.resetAt <= now) continue
      if (challenge.progress >= challenge.target) {
        // 发放奖励
        if (challenge.reward.gold) playerStore.addGold(challenge.reward.gold)
        if (challenge.reward.diamond) playerStore.addDiamond(challenge.reward.diamond)
        if (challenge.reward.exp) playerStore.addExperience(challenge.reward.exp)
        completed.push(challenge)
        // 重置进度以便再次完成
        challenge.progress = challenge.target // 标记为已完成
      }
    }

    return completed
  }

  /**
   * 伤害统计数据接口
   * 追踪战斗过程中的各类伤害输出
   */
  interface DamageStats {
    totalDamage: number    // 总伤害
    normalDamage: number   // 普通伤害
    critDamage: number     // 暴击伤害
    skillDamage: number    // 技能伤害
    voidDamage: number     // 虚空伤害
    trueDamage: number     // 真实伤害
    damageToPlayer: number // 受到的总伤害
    dodgedAttacks: number  // 闪避次数
    critCount: number      // 暴击次数
    killCount: number      // 击杀数
    startTime: number      // 战斗开始时间戳
  }

  /** 伤害统计状态 */
  const damageStats = ref<DamageStats>({
    totalDamage: 0,
    normalDamage: 0,
    critDamage: 0,
    skillDamage: 0,
    voidDamage: 0,
    trueDamage: 0,
    damageToPlayer: 0,
    dodgedAttacks: 0,
    critCount: 0,
    killCount: 0,
    startTime: Date.now()
  })

  /**
   * 玩家是否可以行动（槽位已满）
   * @computed
   */
  const canPlayerAct = computed(() => playerActionGauge.value >= GAUGE_MAX)

  /**
   * 怪物是否可以行动（槽位已满）
   * @computed
   */
  const canMonsterAct = computed(() => monsterActionGauge.value >= GAUGE_MAX)

  /**
   * 添加战斗日志
   * @param message - 日志内容
   * @description 新日志添加到数组头部，超过50条时移除最旧的日志
   */
  function addBattleLog(message: string) {
    battleLog.value.unshift(message)
    if (battleLog.value.length > 50) {
      battleLog.value.pop()
    }
  }

  /**
   * 清空战斗日志
   */
  function clearBattleLog() {
    battleLog.value = []
  }

  /**
   * 添加伤害弹出
   * @param type - 弹出类型
   * @param value - 伤害/治疗值
   * @param isPlayer - 是否对玩家造成（true=玩家受伤，false=怪物受伤）
   */
  function addDamagePopup(type: 'normal' | 'crit' | 'true' | 'void' | 'skill' | 'heal' | 'miss', value: number, isPlayer: boolean) {
    popupId++
    const x = 50 + (Math.random() * 40 - 20)
    const y = isPlayer ? 60 : 40
    damagePopups.value.push({ id: popupId, type, value, x, y })
    
    // 2秒后自动移除
    setTimeout(() => {
      const idx = damagePopups.value.findIndex(p => p.id === popupId)
      if (idx !== -1) damagePopups.value.splice(idx, 1)
    }, 2000)
  }

  /**
   * 重置伤害统计
   * 将所有计数归零，并重置开始时间为当前时间
   */
  function resetDamageStats() {
    damageStats.value = {
      totalDamage: 0,
      normalDamage: 0,
      critDamage: 0,
      skillDamage: 0,
      voidDamage: 0,
      trueDamage: 0,
      damageToPlayer: 0,
      dodgedAttacks: 0,
      critCount: 0,
      killCount: 0,
      startTime: Date.now()
    }
  }

  /**
   * 追踪玩家造成的伤害
   * @param amount - 伤害量
   * @param type - 伤害类型（normal/crit/skill/void/true）
   * @description 根据类型分别累加到对应统计字段
   */
  function trackPlayerDamage(amount: number, type: 'normal' | 'crit' | 'skill' | 'void' | 'true') {
    damageStats.value.totalDamage += amount
    if (type === 'normal') damageStats.value.normalDamage += amount
    else if (type === 'crit') {
      damageStats.value.critDamage += amount
      damageStats.value.critCount++
    }
    else if (type === 'skill') damageStats.value.skillDamage += amount
    else if (type === 'void') damageStats.value.voidDamage += amount
    else if (type === 'true') damageStats.value.trueDamage += amount
  }

  /**
   * 追踪玩家受到的伤害
   * @param amount - 伤害量
   */
  function trackDamageToPlayer(amount: number) {
    damageStats.value.damageToPlayer += amount
  }

  /**
   * 计算速度优势
   * @param playerSpeed - 玩家速度
   * @param monsterSpeed - 怪物速度
   * @returns 速度优势结果
   * @description 根据速度比返回先手、双动和伤害加成
   */
  function calculateSpeedAdvantage(playerSpeed: number, monsterSpeed: number): { firstStrike: boolean, doubleTurn: boolean, damageBonus: number } {
    const ratio = playerSpeed / monsterSpeed
    if (ratio >= 3) return { firstStrike: true, doubleTurn: true, damageBonus: 0.5 }
    if (ratio >= 2) return { firstStrike: true, doubleTurn: false, damageBonus: 0.5 }
    if (ratio >= 1) return { firstStrike: true, doubleTurn: false, damageBonus: 0 }
    return { firstStrike: false, doubleTurn: false, damageBonus: 0 }
  }

  /**
   * 追踪闪避次数
   */
  function trackDodgedAttack() {
    damageStats.value.dodgedAttacks++
  }

  /**
   * 追踪击杀数
   */
  function trackKill() {
    damageStats.value.killCount++
  }

  /**
   * 计算DPS（每秒伤害）
   * @returns 当前DPS值
   */
  function getDPS(): number {
    const duration = (Date.now() - damageStats.value.startTime) / 1000
    if (duration <= 0) return 0
    return Math.floor(damageStats.value.totalDamage / duration)
  }

  /**
   * 获取伤害分类统计
   * @returns 按伤害类型分类的统计数据数组
   */
  function getDamageBreakdown(): { name: string; value: number; color: string }[] {
    const stats = damageStats.value
    const breakdown = [
      { name: '普通伤害', value: stats.normalDamage, color: '#4ecdc4' },
      { name: '暴击伤害', value: stats.critDamage, color: '#e94560' },
      { name: '技能伤害', value: stats.skillDamage, color: '#9d4dff' },
      { name: '虚空伤害', value: stats.voidDamage, color: '#ff6b6b' },
      { name: '真实伤害', value: stats.trueDamage, color: '#ffd700' }
    ].filter(item => item.value > 0)
    
    return breakdown.sort((a, b) => b.value - a.value)
  }

  /**
   * 执行玩家回合
   * @param skillIndex - 技能槽索引（null表示普攻）
   * @returns 行动结果（伤害值、是否暴击、使用的技能）
   * @description 若指定技能已就绪（冷却=0）则释放技能，否则普攻
   */
  function executePlayerTurn(skillIndex: number | null = null): { damage: number, isCrit: boolean, skill: Skill | null } {
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    
    if (!monsterStore.currentMonster) {
      return { damage: 0, isCrit: false, skill: null }
    }
    
    let damage = 0
    let isCrit = false
    let usedSkill: Skill | null = null
    
    let totalStats = { ...playerStore.totalStats }
    const rebirthStore = useRebirthStore()
    const rebirthStats = rebirthStore.rebirthStats
    
    // T14 被动技能效果应用
    const passiveBonuses = applyPassiveEffects(
      PASSIVE_SKILLS,
      playerStore.player.currentHp,
      playerStore.player.maxHp,
      currentCombo.value,
      monsterStore.currentMonster.isBoss,
      battleTurnCount.value,
      totalStats.speed
    )
    for (const bonus of passiveBonuses) {
      if (bonus.type === 'percent') {
        totalStats[bonus.stat] = (totalStats[bonus.stat] || 0) * (1 + bonus.value / 100)
      } else {
        totalStats[bonus.stat] = (totalStats[bonus.stat] || 0) + bonus.value
      }
    }
    
    // 尝试释放技能
    if (skillIndex !== null && playerStore.player.skills[skillIndex]) {
      const skill = playerStore.player.skills[skillIndex]
      if (skill && skill.currentCooldown === 0) {
        usedSkill = skill
        lastSkillUsed.value = skill
        skill.currentCooldown = skill.cooldown
        
        // 技能基础伤害
        damage = totalStats.attack * skill.damageMultiplier
        
        // 应用技能特殊效果
        if (skill.ignoreDefense) {
          damage = calculatePlayerDamage(playerStore.player, totalStats, monsterStore.currentMonster, true, 0, rebirthStats.skillDamageBonus, rebirthStats.bossDamageBonus)
        } else {
          damage = calculatePlayerDamage(playerStore.player, totalStats, monsterStore.currentMonster, false, 0, rebirthStats.skillDamageBonus, rebirthStats.bossDamageBonus)
        }
        
        // 技能附加真实伤害
        if (skill.trueDamage) {
          damage += skill.trueDamage
        }
        
        // 治疗技能
        if (skill.type === 'heal' && skill.healPercent) {
          playerStore.healPercent(skill.healPercent)
          addBattleLog(`你使用了 ${skill.name}，恢复了 ${skill.healPercent}% 最大生命!`)
        }
        
        // 增益技能
        if (skill.buffEffect) {
          playerStore.applyBuff(skill.buffEffect.stat, skill.buffEffect.percentBoost, skill.buffEffect.duration)
          addBattleLog(`你使用了 ${skill.name}，${skill.buffEffect.stat}提升了 ${skill.buffEffect.percentBoost}%，持续${skill.buffEffect.duration}秒!`)
        }
        
        // 伤害技能日志
        if (skill.type === 'damage') {
          addBattleLog(`你对 ${monsterStore.currentMonster.name} 使用了 ${skill.name}，造成了 ${Math.floor(damage)} 点伤害!`)
          trackPlayerDamage(Math.floor(damage), 'skill')
        }
      }
    }
    
    // 普攻（技能未就绪或无技能）
    if (damage === 0) {
      damage = calculatePlayerDamage(playerStore.player, totalStats, monsterStore.currentMonster, false, 0, 0, rebirthStats.bossDamageBonus)
      isCrit = Math.random() * 100 < totalStats.critRate
      if (isCrit) {
        damage = Math.floor(damage * totalStats.critDamage / 100)
        trackPlayerDamage(Math.floor(damage), 'crit')
      } else {
        trackPlayerDamage(Math.floor(damage), 'normal')
      }
      
      // 速度优势伤害加成
      const speedAdvantage = calculateSpeedAdvantage(totalStats.speed, monsterStore.currentMonster.speed)
      if (speedAdvantage.damageBonus > 0) {
        damage = Math.floor(damage * (1 + speedAdvantage.damageBonus))
        addBattleLog(`速度优势发动! 伤害提升${speedAdvantage.damageBonus * 100}%!`)
      }
      
      addBattleLog(`你对 ${monsterStore.currentMonster.name} 造成了 ${Math.floor(damage)} 点伤害${isCrit ? ' (暴击!)' : ''}!`)
    }
    
    // T14 被动技能特殊效果：吸血
    for (const bonus of passiveBonuses) {
      if (bonus.special === 'lifesteal' && damage > 0) {
        const healAmount = Math.floor(damage * bonus.value / 100)
        playerStore.heal(healAmount)
        addBattleLog(`生命偷取: +${healAmount}`)
        addDamagePopup('heal', healAmount, true)
      }
    }
    
    return { damage: Math.floor(damage), isCrit, skill: usedSkill }
  }

  /**
   * 执行怪物回合
   * @returns 行动结果（伤害值、是否被闪避）
   * @description 包含：命中判定、闪避处理、boss技能加成
   */
  function executeMonsterTurn(): { damage: number, dodged: boolean } {
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    
    if (!monsterStore.currentMonster) {
      return { damage: 0, dodged: false }
    }
    
    const totalStats = playerStore.totalStats
    let damage = calculateMonsterDamage(monsterStore.currentMonster, playerStore.player, totalStats)
    
    // 闪避判定
    const isDodged = Math.random() * 100 < totalStats.dodge
    if (isDodged) {
      trackDodgedAttack()
      addBattleLog(`你躲闪了 ${monsterStore.currentMonster.name} 的攻击!`)
      addDamagePopup('miss', 0, true)
      return { damage: 0, dodged: true }
    }
    
    // BOSS技能加成
    if (monsterStore.currentMonster.isBoss) {
      const monsterSkillId = monsterStore.performMonsterAction()
      if (monsterSkillId) {
        const skill = getSkillById(monsterSkillId)
        if (skill && skill.damageMultiplier > 0) {
          damage = Math.floor(damage * skill.damageMultiplier)
        }
      }
    }
    
    // 扣除玩家生命
    playerStore.takeDamage(damage)
    trackDamageToPlayer(damage)
    // T14 玩家受击时重置连击
    currentCombo.value = 0
    addBattleLog(`${monsterStore.currentMonster.name} 对你造成了 ${damage} 点伤害!`)
    addDamagePopup('normal', damage, true)
    
    return { damage, dodged: false }
  }

  /**
   * 处理玩家攻击（完整流程）
   * 
   * 流程：执行攻击 → 扣除怪物HP → 处理击杀奖励 → 检查死亡
   * 
   * 击杀后处理：
   * 1. 生命偷取（基于幸运暴击加成）
   * 2. 击杀计数 + 成就检查
   * 3. 获得金币/经验/钻石
   * 4. 装备掉落判定与穿戴
   * 
   * @param skillIndex - 技能索引（null表示普攻）
   */
  function processPlayerAttack(skillIndex: number | null = null) {
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    const achievementStore = useAchievementStore()
    
    if (isPaused.value || !monsterStore.currentMonster) return
    if (!canPlayerAct.value) return
    
    const { damage, isCrit, skill } = executePlayerTurn(skillIndex)
    
    const result = monsterStore.damageMonster(damage)
    
    // 添加伤害弹出
    if (damage > 0) {
      if (skill) {
        addDamagePopup('skill', damage, false)
      } else if (isCrit) {
        addDamagePopup('crit', damage, false)
      } else {
        addDamagePopup('normal', damage, false)
      }
    }
    
    // T14 被动技能战斗上下文更新
    if (damage > 0) {
      currentCombo.value++
    }
    battleTurnCount.value++
    
    // 扣除行动槽
    playerActionGauge.value -= GAUGE_MAX
    
    // 技能生命偷取
    if (skill && skill.lifesteal && damage > 0) {
      const lifesteal = calculateSkillLifesteal(skill, damage)
      if (lifesteal > 0) {
        playerStore.heal(lifesteal)
        addBattleLog(`生命偷取: +${lifesteal}`)
        addDamagePopup('heal', lifesteal, true)
      }
    }
    
    // T18.2 生命偷取（独立于幸运值，从 playerStore.totalStats.lifesteal 获取）
    if (damage > 0) {
      const lifestealRate = calculateLifestealCap(playerStore.totalStats.lifesteal)
      if (lifestealRate > 0) {
        const healAmount = calculateLifesteal(damage, lifestealRate)
        if (healAmount > 0) {
          playerStore.heal(healAmount)
          addBattleLog(`生命偷取: +${healAmount}`)
          addDamagePopup('heal', healAmount, true)
        }
      }
    }
    
    // 怪物死亡处理
    if (result.killed) {
      trackKill()
      const luckEffects = calculateLuckEffects(playerStore.player.stats.luck)
      const bonusGold = Math.floor(result.goldReward * luckEffects.goldBonus)
      playerStore.addGold(result.goldReward + bonusGold)
      playerStore.addExperience(result.expReward)
      playerStore.incrementKillCount()
      
      // 钻石掉落
      if (result.diamondReward > 0) {
        playerStore.addDiamond(result.diamondReward)
        addBattleLog(`获得了 ${result.diamondReward} 钻石!`)
      }
      
      // 装备掉落
      if (result.shouldDropEquipment) {
        const equipment = playerStore.generateRandomEquipment()
        if (equipment) {
          discoverEquipment(equipment.id)
          const equipped = playerStore.equipNewEquipment(equipment)
          if (equipped) {
            addBattleLog(`获得了新装备: ${equipment.name}!`)
          }
        }
      }
      
      // 成就检查
      achievementStore.checkAndUpdateAchievements(playerStore.player)

      // T8.2 图鉴：记录击杀的怪物
      if (monsterStore.currentMonster) {
        discoverMonster(monsterStore.currentMonster.id)
      }

      addBattleLog(`你击败了 ${monsterStore.currentMonster.name}! 获得 ${result.goldReward} 金币和 ${result.expReward} 经验!`)
    }
    
    // 玩家死亡处理
    if (playerStore.isDead()) {
      addBattleLog('你被击败了! 自动返回10层前...')
      monsterStore.goBackLevels(10)
      playerStore.revive()
      clearBattleLog()
    }
  }

  /**
   * 处理怪物攻击（完整流程）
   * 执行攻击 → 检查玩家死亡
   * @param skillIndex - 技能索引（预留参数）
   */
  function processMonsterAttack(skillIndex: number | null = null) {
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    
    if (isPaused.value || !monsterStore.currentMonster) return
    if (!canMonsterAct.value) return
    
    executeMonsterTurn()
    
    // 扣除行动槽
    monsterActionGauge.value -= GAUGE_MAX
    
    // 玩家死亡处理
    if (playerStore.isDead()) {
      addBattleLog('你被击败了! 自动返回10层前...')
      monsterStore.goBackLevels(10)
      playerStore.revive()
      clearBattleLog()
    }
  }

  /**
   * 切换暂停状态
   */
  function togglePause() {
    isPaused.value = !isPaused.value
  }

  /**
   * 复活并返回10层前
   */
  function revive() {
    const monsterStore = useMonsterStore()
    monsterStore.goBackLevels(10)
    clearBattleLog()
  }

  /**
   * 更新所有技能冷却
   * @param deltaTime - 真实时间增量（秒）
   * @description 每tick冷却减少1（与游戏速度解耦，cooldown值本身代表tick数）
   */
  function updateSkillCooldowns(_deltaTime: number) {
    const playerStore = usePlayerStore()
    for (const skill of playerStore.player.skills) {
      if (skill && skill.currentCooldown > 0) {
        skill.currentCooldown = Math.max(0, skill.currentCooldown - 1)
      }
    }
  }

  /**
   * 更新行动槽
   * 
   * @param deltaTime - 真实时间增量（秒）
   * @description 
   * - 每tick填充量 = speed × deltaTime × GAUGE_TICK_RATE / 100
   * - 玩家速度优势时，怪物槽位清零（先手）
   * - 槽位上限为GAUGE_MAX(100)
   */
  function updateGauges(deltaTime: number) {
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    
    if (!monsterStore.currentMonster) return
    
    const playerSpeed = playerStore.totalStats.speed
    const monsterSpeed = monsterStore.currentMonster.speed
    
    playerActionGauge.value = Math.min(GAUGE_MAX, playerActionGauge.value + playerSpeed * deltaTime * GAUGE_TICK_RATE / 100)
    monsterActionGauge.value = Math.min(GAUGE_MAX, monsterActionGauge.value + monsterSpeed * deltaTime * GAUGE_TICK_RATE / 100)
    
    // 速度优势：先手权（先手优势已在startBattle()的偏移量中实现，此处无需额外处理）
  }

  /**
   * 游戏主循环
   * 
   * @param deltaTime - 真实时间增量（秒）
   * @description 每帧调用，执行：
   * 1. 技能冷却更新
   * 2. 行动槽更新
   * 3. 怪物行动（如果可行动）
   * 4. 玩家行动（如果可行动，自动选择技能或普攻）
   * 
   * 异常处理：捕获所有错误但不打印console，而是存储到错误状态
   */
  function gameLoop(deltaTime: number) {
    if (isPaused.value) return
    
    try {
      // 实际deltaTime = 真实deltaTime × gameSpeed
      const effectiveDelta = deltaTime * gameSpeed.value
      
      updateSkillCooldowns(effectiveDelta)
      updateGauges(effectiveDelta)
      
      if (canMonsterAct.value) {
        processMonsterAttack()
      }
      
      if (canPlayerAct.value) {
        const skillStore = useSkillStore()
        const nextSkill = skillStore.getNextReadySkill()
        if (nextSkill) {
          processPlayerAttack(nextSkill.index)
        } else {
          processPlayerAttack(null)
        }
      }
    } catch (e) {
      battleError.value = e as Error
    }
  }

  /**
   * 开始新战斗
   * @description 初始化怪物、清空行动槽、重置统计
   */
  function startBattle() {
    const monsterStore = useMonsterStore()
    const playerStore = usePlayerStore()
    
    monsterStore.initMonster()
    
    if (!monsterStore.currentMonster) return
    
    // 速度优势预填充偏移
    const playerSpeed = playerStore.totalStats.speed
    const monsterSpeed = monsterStore.currentMonster.speed
    
    // 偏移公式：min((fastSpeed - slowSpeed) * tickRate * 0.5, GAUGE_MAX * 0.5)
    const tickRate = GAUGE_TICK_RATE
    if (playerSpeed >= monsterSpeed) {
      const offset = Math.min((playerSpeed - monsterSpeed) * tickRate * 0.5, GAUGE_MAX * 0.5)
      playerActionGauge.value = offset
      monsterActionGauge.value = 0
    } else {
      const offset = Math.min((monsterSpeed - playerSpeed) * tickRate * 0.5, GAUGE_MAX * 0.5)
      playerActionGauge.value = 0
      monsterActionGauge.value = offset
    }
    
    clearBattleLog()
    resetDamageStats()
    // T14 重置战斗上下文
    battleTurnCount.value = 0
    currentCombo.value = 0
    
    if (playerStore.player.currentHp <= 0) {
      playerStore.revive()
    }
  }

  /**
   * 恢复战斗（从暂停或重置后）
   */
  function resumeBattle() {
    playerActionGauge.value = GAUGE_MAX
    monsterActionGauge.value = 0
    clearBattleLog()
    resetDamageStats()
    
    const playerStore = usePlayerStore()
    if (playerStore.player.currentHp <= 0) {
      playerStore.revive()
    }
  }

  /**
   * 获取玩家行动槽百分比
   * @returns 0-100的百分比数值
   */
  function getPlayerGaugePercent() {
    return (playerActionGauge.value / GAUGE_MAX) * 100
  }

  /**
   * 获取怪物行动槽百分比
   * @returns 0-100的百分比数值
   */
  function getMonsterGaugePercent() {
    return (monsterActionGauge.value / GAUGE_MAX) * 100
  }

  return {
    // 状态
    isPaused,
    battleLog,
    battleError,
    lastSkillUsed,
    playerActionGauge,
    monsterActionGauge,
    canPlayerAct,
    canMonsterAct,
    gameSpeed,
    damageStats,
    damagePopups,
    // T14 被动技能战斗上下文
    battleTurnCount,
    currentCombo,
    
    // 方法
    addBattleLog,
    clearBattleLog,
    addDamagePopup,
    resetDamageStats,
    trackPlayerDamage,
    trackDamageToPlayer,
    trackDodgedAttack,
    trackKill,
    getDPS,
    getDamageBreakdown,
    executePlayerTurn,
    executeMonsterTurn,
    processPlayerAttack,
    processMonsterAttack,
    togglePause,
    revive,
    updateSkillCooldowns,
    updateGauges,
    gameLoop,
    startBattle,
    resumeBattle,
    getPlayerGaugePercent,
    getMonsterGaugePercent,

    // T7.3
    dailyChallenges,
    weeklyChallenges,
    initChallenges,
    updateChallengeProgress,
    checkChallengeCompletion,

    // T8.2 图鉴系统
    collection,
    discoverMonster,
    discoverEquipment,
    checkCollectionMilestone,
    getCollectionProgress,
    claimCollectionMilestone,
    COLLECTION_MILESTONES
  }
})
