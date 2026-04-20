/**
 * 游戏核心Store
 *
 * 负责管理战斗循环、行动槽(ATB)、伤害统计和战斗飘字
 *
 * ## 核心概念
 *
 * ### 行动槽系统（Action Gauge）
 * - 玩家和怪物各自有独立的行动槽，初始值0
 * - 每tick根据速度填充槽位：gauge += speed × normalizedTick × GAUGE_TICK_RATE / 100
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
import { useChallengeStore } from './challengeStore'
import { useCollectionStore } from './collectionStore'
import { useATBStore } from './atbStore'
import { calculatePlayerDamage, calculateMonsterDamage, calculateLuckEffects, calculateLifesteal, calculateSkillLifesteal, calculateLifestealCap, calculateElementalAdvantage } from '../utils/calc'
import { getSkillById } from '../utils/skillSystem'
import { PASSIVE_SKILLS } from '../data/passiveSkills'
import { applyPassiveEffects } from '../utils/passiveEvaluator'
import { GAME } from '../utils/constants'
import type { Skill } from '../types'

export const GAUGE_MAX = 100
const GAUGE_TICK_RATE = 10

export const useGameStore = defineStore('game', () => {
  // ─── UI状态 ───────────────────────────────
  const isPaused = ref(false)
  const gameSpeed = ref(1)
  const battleError = ref<Error | null>(null)

  // ─── ATB 行动槽 ────────────────────────────
  const playerActionGauge = ref(0)
  const monsterActionGauge = ref(0)

  // ─── 战斗日志 ──────────────────────────────
  const battleLog = ref<string[]>([])

  // ─── 伤害飘字 ──────────────────────────────
  const damagePopups = ref<Array<{
    id: number
    type: 'normal' | 'crit' | 'true' | 'void' | 'skill' | 'heal' | 'miss' | 'lifesteal'
    value: number
    x: number
    y: number
  }>>([])
  let popupId = 0

  // ─── 伤害统计 ──────────────────────────────
  interface DamageStats {
    totalDamage: number
    normalDamage: number
    critDamage: number
    skillDamage: number
    voidDamage: number
    trueDamage: number
    damageToPlayer: number
    dodgedAttacks: number
    critCount: number
    killCount: number
    startTime: number
  }

  const damageStats = ref<DamageStats>({
    totalDamage: 0, normalDamage: 0, critDamage: 0, skillDamage: 0,
    voidDamage: 0, trueDamage: 0, damageToPlayer: 0,
    dodgedAttacks: 0, critCount: 0, killCount: 0, startTime: Date.now()
  })

  // ─── 被动技能战斗上下文 ────────────────────
  const battleTurnCount = ref(0)
  const currentCombo = ref(0)

  // ─── 必杀技槽 ─────────────────────────────
  const ultimateGauge = ref(0)
  const MAX_COMBO_BONUS = 50
  const COMBO_BONUS_PER_HIT = 5

  // ─── 上次使用的技能（UI展示） ─────────────
  const lastSkillUsed = ref<Skill | null>(null)

  // ─── Computed ──────────────────────────────
  const canPlayerAct = computed(() => playerActionGauge.value >= GAUGE_MAX)
  const canMonsterAct = computed(() => monsterActionGauge.value >= GAUGE_MAX)

  // ─── 日志 ──────────────────────────────────
  function addBattleLog(message: string) {
    battleLog.value.unshift(message)
    if (battleLog.value.length > 50) battleLog.value.pop()
  }

  function clearBattleLog() {
    battleLog.value = []
  }

  // ─── 飘字 ─────────────────────────────────
  function addDamagePopup(
    type: 'normal' | 'crit' | 'true' | 'void' | 'skill' | 'heal' | 'miss' | 'lifesteal',
    value: number,
    isPlayer: boolean
  ) {
    popupId++
    const x = 50 + (Math.random() * 40 - 20)
    const y = isPlayer ? 60 : 40
    damagePopups.value.push({ id: popupId, type, value, x, y })
    setTimeout(() => {
      const idx = damagePopups.value.findIndex(p => p.id === popupId)
      if (idx !== -1) damagePopups.value.splice(idx, 1)
    }, 2000)
  }

  function removeDamagePopup(id: number) {
    const idx = damagePopups.value.findIndex(p => p.id === id)
    if (idx !== -1) damagePopups.value.splice(idx, 1)
  }

  // ─── 伤害追踪 ──────────────────────────────
  function resetDamageStats() {
    damageStats.value = {
      totalDamage: 0, normalDamage: 0, critDamage: 0, skillDamage: 0,
      voidDamage: 0, trueDamage: 0, damageToPlayer: 0,
      dodgedAttacks: 0, critCount: 0, killCount: 0, startTime: Date.now()
    }
  }

  function trackPlayerDamage(amount: number, type: 'normal' | 'crit' | 'skill' | 'void' | 'true') {
    damageStats.value.totalDamage += amount
    if (type === 'normal') damageStats.value.normalDamage += amount
    else if (type === 'crit') { damageStats.value.critDamage += amount; damageStats.value.critCount++ }
    else if (type === 'skill') damageStats.value.skillDamage += amount
    else if (type === 'void') damageStats.value.voidDamage += amount
    else if (type === 'true') damageStats.value.trueDamage += amount
  }

  function trackDamageToPlayer(amount: number) { damageStats.value.damageToPlayer += amount }
  function trackDodgedAttack() { damageStats.value.dodgedAttacks++ }
  function trackKill() { damageStats.value.killCount++ }
  function getDPS(): number {
    const duration = (Date.now() - damageStats.value.startTime) / 1000
    return duration <= 0 ? 0 : Math.floor(damageStats.value.totalDamage / duration)
  }

  function getDamageBreakdown() {
    const s = damageStats.value
    return [
      { name: '普通伤害', value: s.normalDamage, color: '#4ecdc4' },
      { name: '暴击伤害', value: s.critDamage, color: '#e94560' },
      { name: '技能伤害', value: s.skillDamage, color: '#9d4dff' },
      { name: '虚空伤害', value: s.voidDamage, color: '#ff6b6b' },
      { name: '真实伤害', value: s.trueDamage, color: '#ffd700' }
    ].filter(i => i.value > 0).sort((a, b) => b.value - a.value)
  }

  // ─── ATB 辅助 ───────────────────────────────
  function getSpeedAdvantage(playerSpeed: number, monsterSpeed: number) {
    const ratio = playerSpeed / monsterSpeed
    return {
      doubleAction: ratio >= 2,
      firstStrike: ratio >= 1.5 && ratio < 2
    }
  }

  function getATBGain(speed: number): number {
    return speed / 1000
  }

  function calculateSpeedAdvantage(playerSpeed: number, monsterSpeed: number) {
    const ratio = Math.round((playerSpeed / monsterSpeed) * 10) / 10
    // 顺序：先判 >= 2，再判 >= 1.5，剩下 < 1.5 无优势
    if (ratio >= 2) return { firstStrike: true, doubleTurn: false, damageBonus: 0.5 }
    if (ratio >= 1.5) return { firstStrike: true, doubleTurn: false, damageBonus: 0 }
    return { firstStrike: false, doubleTurn: false, damageBonus: 0 }
  }

  function getPlayerGaugePercent() { return (playerActionGauge.value / GAUGE_MAX) * 100 }
  function getMonsterGaugePercent() { return (monsterActionGauge.value / GAUGE_MAX) * 100 }

  // ─── 玩家回合执行 ─────────────────────────
  function executePlayerTurn(skillIndex: number | null = null) {
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    if (!monsterStore.currentMonster) return { damage: 0, isCrit: false, skill: null, isUltimate: false }

    let damage = 0
    let isCrit = false
    let usedSkill: Skill | null = null

    let totalStats = { ...playerStore.totalStats }
    const rebirthStore = useRebirthStore()
    const rebirthStats = rebirthStore.rebirthStats

    // 被动技能效果
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
      const stat = bonus.stat as keyof typeof totalStats
      if (bonus.type === 'percent') {
        (totalStats as any)[stat] = ((totalStats as any)[stat] || 0) * (1 + bonus.value / 100)
      } else {
        (totalStats as any)[stat] = ((totalStats as any)[stat] || 0) + bonus.value
      }
    }

    const comboBonus = Math.min(currentCombo.value * COMBO_BONUS_PER_HIT, MAX_COMBO_BONUS)
    const isUltimate = ultimateGauge.value >= 100 && skillIndex === null

    // 技能释放
    if (typeof skillIndex === 'number' && playerStore.player.skills[skillIndex]) {
      const skill = playerStore.player.skills[skillIndex]
      if (skill && skill.currentCooldown === 0) {
        usedSkill = skill
        lastSkillUsed.value = skill
        skill.currentCooldown = skill.cooldown

        if (skill.ignoreDefense) {
          damage = calculatePlayerDamage(playerStore.player, totalStats, monsterStore.currentMonster, true, 0, rebirthStats.skillDamageBonus, rebirthStats.bossDamageBonus, comboBonus)
        } else {
          damage = calculatePlayerDamage(playerStore.player, totalStats, monsterStore.currentMonster, false, 0, rebirthStats.skillDamageBonus, rebirthStats.bossDamageBonus, comboBonus)
        }

        if (skill.trueDamage) damage += skill.trueDamage

        if (skill.type === 'heal' && skill.healPercent) {
          playerStore.healPercent(skill.healPercent)
          addBattleLog(`你使用了 ${skill.name}，恢复了 ${skill.healPercent}% 最大生命!`)
        }

        if (skill.buffEffect) {
          playerStore.applyBuff(skill.buffEffect.stat, skill.buffEffect.percentBoost, skill.buffEffect.duration)
          addBattleLog(`你使用了 ${skill.name}，${skill.buffEffect.stat}提升了 ${skill.buffEffect.percentBoost}%，持续${skill.buffEffect.duration}秒!`)
        }

        if (skill.type === 'damage') {
          addBattleLog(`你对 ${monsterStore.currentMonster.name} 使用了 ${skill.name}，造成了 ${Math.floor(damage)} 点伤害!`)
          trackPlayerDamage(Math.floor(damage), 'skill')
        }

        // 标记施加
        if (skill.markType && monsterStore.currentMonster) {
          monsterStore.addMark(monsterStore.currentMonster, {
            type: skill.markType,
            stacks: skill.markStacks || 1,
            duration: skill.markDuration || 2,
          })
          addBattleLog(`[标记] ${monsterStore.currentMonster.name} 获得 ${skill.markStacks} 层 ${skill.markType}`)
        }

        // 引爆
        if (skill.isDetonator && skill.detonateMark && monsterStore.currentMonster) {
          const stacks = monsterStore.consumeMark(monsterStore.currentMonster, skill.detonateMark)
          if (stacks > 0) {
            const detonateDmg = (skill.detonateDamage || 1) * stacks * totalStats.attack
            const isCritDetonator = Math.random() * 100 < totalStats.critRate
            const finalDmg = isCritDetonator
              ? Math.floor(detonateDmg * totalStats.critDamage / 100)
              : Math.floor(detonateDmg)
            monsterStore.damageMonster(finalDmg)
            addBattleLog(`[引爆] ${skill.name} 触发 ${stacks} 层 ${skill.detonateMark}，造成 ${finalDmg} 伤害!`)
            addDamagePopup('crit', finalDmg, false)
            trackPlayerDamage(finalDmg, 'skill')
          }
        }
      }
    }

    // 普攻
    if (damage === 0) {
      damage = calculatePlayerDamage(playerStore.player, totalStats, monsterStore.currentMonster, false, 0, 0, rebirthStats.bossDamageBonus, comboBonus)

      if (isUltimate) {
        damage *= 5
        addBattleLog(`【必杀技】解放！造成 ${Math.floor(damage)} 点伤害！`)
      }

      isCrit = Math.random() * 100 < totalStats.critRate
      if (isCrit) {
        damage = Math.floor(damage * totalStats.critDamage / 100)
        trackPlayerDamage(Math.floor(damage), 'crit')
      } else {
        trackPlayerDamage(Math.floor(damage), 'normal')
      }

      const speedAdv = calculateSpeedAdvantage(totalStats.speed, monsterStore.currentMonster.speed)
      if (speedAdv.damageBonus > 0) {
        damage = Math.floor(damage * (1 + speedAdv.damageBonus))
        addBattleLog(`速度优势发动! 伤害提升${speedAdv.damageBonus * 100}%!`)
      }

      if (comboBonus > 0) addBattleLog(`连击加成: +${comboBonus}% (${currentCombo.value}连击)`)

      const elementalMult = calculateElementalAdvantage('none', monsterStore.currentMonster.element, totalStats.fireResist || 0)
      if (elementalMult > 1.0) {
        addBattleLog(`元素克制 [${monsterStore.currentMonster.element}]! +${Math.round((elementalMult - 1) * 100)}%伤害`)
      } else if (elementalMult < 1.0) {
        addBattleLog(`被元素克制 [${monsterStore.currentMonster.element}]... ${Math.round((1 - elementalMult) * 100)}%减伤`)
      }

      addBattleLog(`你对 ${monsterStore.currentMonster.name} 造成了 ${Math.floor(damage)} 点伤害${isCrit ? ' (暴击!)' : ''}!`)
    }

    // 被动吸血
    for (const bonus of passiveBonuses) {
      if (bonus.special === 'lifesteal' && damage > 0) {
        const healAmount = Math.floor(damage * bonus.value / 100)
        playerStore.heal(healAmount)
        addBattleLog(`生命偷取: +${healAmount}`)
        addDamagePopup('lifesteal', healAmount, true)
      }
    }

    return { damage: Math.floor(damage), isCrit, skill: usedSkill, isUltimate }
  }

  // ─── 怪物回合执行 ─────────────────────────
  function executeMonsterTurn() {
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    if (!monsterStore.currentMonster) return { damage: 0, dodged: false }

    const totalStats = playerStore.totalStats
    let damage = calculateMonsterDamage(monsterStore.currentMonster, playerStore.player, totalStats)

    const isDodged = Math.random() * 100 < totalStats.dodge
    if (isDodged) {
      trackDodgedAttack()
      addBattleLog(`你躲闪了 ${monsterStore.currentMonster.name} 的攻击!`)
      addDamagePopup('miss', 0, true)
      return { damage: 0, dodged: true }
    }

    if (monsterStore.currentMonster.isBoss) {
      const monsterSkillId = monsterStore.performMonsterAction()
      if (monsterSkillId) {
        const skill = getSkillById(monsterSkillId)
        if (skill && skill.damageMultiplier > 0) {
          damage = Math.floor(damage * skill.damageMultiplier)
        }
      }
    }

    playerStore.takeDamage(damage)
    trackDamageToPlayer(damage)
    currentCombo.value = 0
    addBattleLog(`${monsterStore.currentMonster.name} 对你造成了 ${damage} 点伤害!`)
    addDamagePopup('normal', damage, true)

    return { damage, dodged: false }
  }

  // ─── 完整攻击流程 ─────────────────────────
  function processPlayerAttack(skillIndex: number | null = null) {
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    const achievementStore = useAchievementStore()
    const challengeStore = useChallengeStore()
    const collectionStore = useCollectionStore()

    if (isPaused.value || !monsterStore.currentMonster) return
    if (!canPlayerAct.value) return

    const { damage, isCrit, skill, isUltimate } = executePlayerTurn(skillIndex)

    // 必杀技槽
    if (isUltimate) {
      ultimateGauge.value = 0
    } else {
      ultimateGauge.value = Math.min(100, ultimateGauge.value + 15)
      if (ultimateGauge.value < 100) {
        addBattleLog(`必杀槽: ${ultimateGauge.value}%`)
      } else {
        addBattleLog(`必杀槽满了! 下次普攻将释放必杀技!`)
      }
    }

    // 速度双动
    const advantage = getSpeedAdvantage(playerStore.totalStats.speed, monsterStore.currentMonster.speed)
    let extraDamage = 0
    if (advantage.doubleAction) {
      addBattleLog('速度优势：造成额外伤害！')
      const extra = executePlayerTurn(skillIndex)
      extraDamage = extra.damage
      if (extraDamage > 0) {
        const killedMonster = monsterStore.currentMonster ? { name: monsterStore.currentMonster.name, level: monsterStore.currentMonster.level } : null
        const extraResult = monsterStore.damageMonster(extraDamage)
        addDamagePopup('skill', extraDamage, false)
        currentCombo.value++

        if (extraResult.killed && killedMonster) {
          // 图鉴
          collectionStore.discoverMonster(`${killedMonster.name}_lv${killedMonster.level}`)
          // 奖励
          const killBonus = playerStore.processKillRewards(killedMonster, extraResult.goldReward, extraResult.expReward)
          const luckEffects = calculateLuckEffects(playerStore.player.stats.luck)
          const totalGold = extraResult.goldReward + Math.floor(extraResult.goldReward * luckEffects.goldBonus) + killBonus.firstKillGold
          const totalExp = extraResult.expReward + killBonus.firstKillExp
          if (killBonus.firstKillBonus) addBattleLog(`首杀奖励！额外获得 ${killBonus.firstKillGold} 金币和 ${killBonus.firstKillExp} 经验！`)
          if (killBonus.dailyGoalReached >= 0) {
            const goal = playerStore.DAILY_KILL_REWARDS[killBonus.dailyGoalReached]
            if (goal) addBattleLog(`每日目标达成【${goal.description}】！获得 ${killBonus.dailyGoalGold} 金币！`)
          }
          addBattleLog(`你击败了 ${killedMonster.name}! 获得 ${totalGold} 金币和 ${totalExp} 经验!`)
          trackKill()
          playerStore.addGold(totalGold)
          playerStore.addExperience(totalExp)
          playerStore.incrementKillCount()
          // 挑战进度
          challengeStore.incrementProgress('kill', 1)
          if (extraResult.diamondReward > 0) {
            playerStore.addDiamond(extraResult.diamondReward)
            addBattleLog(`获得了 ${extraResult.diamondReward} 钻石!`)
          }
          if (extraResult.shouldDropEquipment) {
            const equipment = playerStore.generateRandomEquipment()
            if (equipment) {
              collectionStore.discoverEquipment(equipment.id)
              const equipped = playerStore.equipNewEquipment(equipment)
              if (equipped) addBattleLog(`获得了新装备: ${equipment.name}!`)
            }
          }
          achievementStore.checkAchievement('kill_count', playerStore.player.totalKillCount)
          playerActionGauge.value -= GAUGE_MAX
          return
        }
      }
    }

    // 正常伤害
    const killedMonster = monsterStore.currentMonster ? { name: monsterStore.currentMonster.name, level: monsterStore.currentMonster.level } : null
    const result = monsterStore.damageMonster(damage)

    if (damage > 0) {
      addDamagePopup(skill ? 'skill' : isCrit ? 'crit' : 'normal', damage, false)
    }
    if (extraDamage > 0) addDamagePopup('skill', extraDamage, false)
    if (damage > 0) currentCombo.value++
    if (extraDamage > 0) currentCombo.value++
    battleTurnCount.value++
    playerActionGauge.value -= GAUGE_MAX

    // 技能生命偷取
    if (skill?.lifesteal && damage > 0) {
      const ls = calculateSkillLifesteal(skill, damage)
      if (ls > 0) {
        playerStore.heal(ls)
        addBattleLog(`生命偷取: +${ls}`)
        addDamagePopup('lifesteal', ls, true)
      }
    }

    // 生命偷取
    if (damage > 0) {
      const lsRate = calculateLifestealCap(playerStore.totalStats.lifesteal)
      if (lsRate > 0) {
        const ls = calculateLifesteal(damage, lsRate)
        if (ls > 0) {
          playerStore.heal(ls)
          addBattleLog(`生命偷取: +${ls}`)
          addDamagePopup('lifesteal', ls, true)
        }
      }
    }

    // 怪物死亡
    if (result.killed) {
      const killBonus = killedMonster
        ? playerStore.processKillRewards(killedMonster, result.goldReward, result.expReward)
        : { firstKillBonus: false, firstKillGold: 0, firstKillExp: 0, dailyGoalReached: -1, dailyGoalGold: 0 }
      trackKill()
      const luckEffects = calculateLuckEffects(playerStore.player.stats.luck)
      const bonusGold = Math.floor(result.goldReward * luckEffects.goldBonus)
      const totalGold = result.goldReward + bonusGold + killBonus.firstKillGold
      const totalExp = result.expReward + killBonus.firstKillExp
      playerStore.addGold(totalGold)
      playerStore.addExperience(totalExp)
      playerStore.incrementKillCount()

      // 图鉴
      if (killedMonster) collectionStore.discoverMonster(`${killedMonster.name}_lv${killedMonster.level}`)

      // 挑战进度
      challengeStore.incrementProgress('kill', 1)

      if (killBonus.firstKillBonus) addBattleLog(`首杀奖励！额外获得 ${killBonus.firstKillGold} 金币和 ${killBonus.firstKillExp} 经验！`)
      if (killBonus.dailyGoalReached >= 0) {
        const goal = playerStore.DAILY_KILL_REWARDS[killBonus.dailyGoalReached]
        if (goal) addBattleLog(`每日目标达成【${goal.description}】！获得 ${killBonus.dailyGoalGold} 金币！`)
      }

      if (result.diamondReward > 0) {
        playerStore.addDiamond(result.diamondReward)
        addBattleLog(`获得了 ${result.diamondReward} 钻石!`)
      }

      if (result.shouldDropEquipment) {
        const equipment = playerStore.generateRandomEquipment()
        if (equipment) {
          collectionStore.discoverEquipment(equipment.id)
          const equipped = playerStore.equipNewEquipment(equipment)
          if (equipped) addBattleLog(`获得了新装备: ${equipment.name}!`)
        }
      }

      achievementStore.checkAchievement('kill_count', playerStore.player.totalKillCount)
      addBattleLog(`你击败了 ${killedMonster?.name ?? '怪物'}! 获得 ${totalGold} 金币和 ${totalExp} 经验!`)
    }

    // 玩家死亡
    if (playerStore.isDead()) {
      addBattleLog('你被击败了! 自动返回10层前...')
      monsterStore.goBackLevels(10)
      playerStore.revive()
      clearBattleLog()
    }
  }

  function processMonsterAttack(_skillIndex: number | null = null) {
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()

    if (isPaused.value || !monsterStore.currentMonster) return
    if (!canMonsterAct.value) return

    executeMonsterTurn()
    monsterActionGauge.value -= GAUGE_MAX

    if (playerStore.isDead()) {
      addBattleLog('你被击败了! 自动返回10层前...')
      monsterStore.goBackLevels(10)
      playerStore.revive()
      clearBattleLog()
    }
  }

  // ─── 游戏循环 ─────────────────────────────
  function updateSkillCooldowns(_deltaTime: number) {
    const playerStore = usePlayerStore()
    for (const skill of playerStore.player.skills) {
      if (skill && skill.currentCooldown > 0) {
        skill.currentCooldown = Math.max(0, skill.currentCooldown - 1)
      }
    }
  }

  function updateGauges(deltaTime: number) {
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    if (!monsterStore.currentMonster) return

    const pSpeed = playerStore.totalStats.speed
    const mSpeed = monsterStore.currentMonster.speed
    const normalizedTicks = deltaTime / GAME.TICK_INTERVAL

    playerActionGauge.value = Math.min(GAUGE_MAX, playerActionGauge.value + pSpeed * normalizedTicks * GAUGE_TICK_RATE / 100)
    monsterActionGauge.value = Math.min(GAUGE_MAX, monsterActionGauge.value + mSpeed * normalizedTicks * GAUGE_TICK_RATE / 100)

    const atbStore = useATBStore()
    atbStore.setPlayerATB(playerActionGauge.value)
    atbStore.setMonsterATB(monsterActionGauge.value)
  }

  function gameLoop(deltaTime: number) {
    if (isPaused.value) return
    try {
      const effectiveDelta = deltaTime * gameSpeed.value
      updateSkillCooldowns(effectiveDelta)
      updateGauges(effectiveDelta)

      if (canMonsterAct.value) processMonsterAttack()
      if (canPlayerAct.value) {
        const skillStore = useSkillStore()
        const nextSkill = skillStore.getNextReadySkill()
        if (nextSkill) processPlayerAttack(nextSkill.index)
        else processPlayerAttack(null)
      }

      const ms = useMonsterStore()
      if (ms.currentMonster) ms.tickMarks(ms.currentMonster)
    } catch (e) {
      battleError.value = e as Error
    }
  }

  // ─── 战斗控制 ──────────────────────────────
  function startBattle() {
    const monsterStore = useMonsterStore()
    const playerStore = usePlayerStore()
    monsterStore.initMonster()
    if (!monsterStore.currentMonster) return

    const pSpeed = playerStore.totalStats.speed
    const mSpeed = monsterStore.currentMonster.speed
    const tickRate = GAUGE_TICK_RATE

    if (pSpeed >= mSpeed) {
      const offset = Math.min((pSpeed - mSpeed) * tickRate * 0.5, GAUGE_MAX * 0.5)
      playerActionGauge.value = offset
      monsterActionGauge.value = 0
    } else {
      const offset = Math.min((mSpeed - pSpeed) * tickRate * 0.5, GAUGE_MAX * 0.5)
      playerActionGauge.value = 0
      monsterActionGauge.value = offset
    }

    clearBattleLog()
    resetDamageStats()
    battleTurnCount.value = 0
    currentCombo.value = 0
    ultimateGauge.value = 0

    if (playerStore.player.currentHp <= 0) playerStore.revive()

    const atbStore = useATBStore()
    atbStore.reset()
    atbStore.setPlayerATB(playerActionGauge.value)
    atbStore.setMonsterATB(monsterActionGauge.value)
  }

  function resumeBattle() {
    playerActionGauge.value = GAUGE_MAX
    monsterActionGauge.value = 0
    clearBattleLog()
    resetDamageStats()

    const playerStore = usePlayerStore()
    if (playerStore.player.currentHp <= 0) playerStore.revive()

    const atbStore = useATBStore()
    atbStore.reset()
    atbStore.setPlayerATB(playerActionGauge.value)
    atbStore.setMonsterATB(monsterActionGauge.value)
  }

  function togglePause() { isPaused.value = !isPaused.value }
  function revive() {
    const monsterStore = useMonsterStore()
    monsterStore.goBackLevels(10)
    clearBattleLog()
  }

  // ─── 返回 ─────────────────────────────────
  return {
    // 状态
    isPaused,
    gameSpeed,
    battleError,
    battleLog,
    damagePopups,
    damageStats,
    playerActionGauge,
    monsterActionGauge,
    canPlayerAct,
    canMonsterAct,
    lastSkillUsed,
    battleTurnCount,
    currentCombo,
    ultimateGauge,

    // 日志
    addBattleLog,
    clearBattleLog,

    // 飘字
    addDamagePopup,
    removeDamagePopup,

    // 统计
    resetDamageStats,
    trackPlayerDamage,
    trackDamageToPlayer,
    trackDodgedAttack,
    trackKill,
    getDPS,
    getDamageBreakdown,

    // ATB 辅助
    getSpeedAdvantage,
    getATBGain,
    calculateSpeedAdvantage,
    getPlayerGaugePercent,
    getMonsterGaugePercent,

    // 战斗流程
    executePlayerTurn,
    executeMonsterTurn,
    processPlayerAttack,
    processMonsterAttack,
    updateSkillCooldowns,
    updateGauges,
    gameLoop,
    startBattle,
    resumeBattle,
    togglePause,
    revive,

    // 导出常量（供外部使用）
    GAUGE_MAX
  }
})
