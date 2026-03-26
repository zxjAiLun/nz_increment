import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { usePlayerStore } from './playerStore'
import { useMonsterStore } from './monsterStore'
import { useAchievementStore } from './achievementStore'
import { useSkillStore } from './skillStore'
import { useRebirthStore } from './rebirthStore'
import { calculatePlayerDamage, calculateMonsterDamage, calculateLuckEffects, calculateLifesteal } from '../utils/calc'
import { getSkillById } from '../utils/skillSystem'
import type { Skill } from '../types'

export const useGameStore = defineStore('game', () => {
  const isPaused = ref(false)
  const battleLog = ref<string[]>([])
  const lastSkillUsed = ref<Skill | null>(null)
  
  const playerActionGauge = ref(0)
  const monsterActionGauge = ref(0)
  
  const GAUGE_MAX = 100
  const GAUGE_TICK_RATE = 10
  
  const gameSpeed = ref(8)
  
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
  
  const canPlayerAct = computed(() => playerActionGauge.value >= GAUGE_MAX)
  const canMonsterAct = computed(() => monsterActionGauge.value >= GAUGE_MAX)
  
  function addBattleLog(message: string) {
    battleLog.value.unshift(message)
    if (battleLog.value.length > 50) {
      battleLog.value.pop()
    }
  }
  
  function clearBattleLog() {
    battleLog.value = []
  }
  
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
  
  function trackDamageToPlayer(amount: number) {
    damageStats.value.damageToPlayer += amount
  }
  
  function calculateSpeedAdvantage(playerSpeed: number, monsterSpeed: number): { hasAdvantage: boolean, hasDoubleTurn: boolean, damageBonus: number } {
    const speedRatio = playerSpeed / monsterSpeed
    if (speedRatio >= 2) {
      return { hasAdvantage: true, hasDoubleTurn: true, damageBonus: 10 }
    } else if (speedRatio >= 1.5) {
      return { hasAdvantage: true, hasDoubleTurn: false, damageBonus: 0 }
    }
    return { hasAdvantage: false, hasDoubleTurn: false, damageBonus: 0 }
  }
  
  function trackDodgedAttack() {
    damageStats.value.dodgedAttacks++
  }
  
  function trackKill() {
    damageStats.value.killCount++
  }
  
  function getDPS(): number {
    const duration = (Date.now() - damageStats.value.startTime) / 1000
    if (duration <= 0) return 0
    return Math.floor(damageStats.value.totalDamage / duration)
  }
  
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
  
  function executePlayerTurn(skillIndex: number | null = null): { damage: number, isCrit: boolean, skill: Skill | null } {
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    
    if (!monsterStore.currentMonster) {
      return { damage: 0, isCrit: false, skill: null }
    }
    
    let damage = 0
    let isCrit = false
    let usedSkill: Skill | null = null
    
    const totalStats = playerStore.totalStats
    const rebirthStore = useRebirthStore()
    const rebirthStats = rebirthStore.rebirthStats
    
    if (skillIndex !== null && playerStore.player.skills[skillIndex]) {
      const skill = playerStore.player.skills[skillIndex]
      if (skill && skill.currentCooldown <= 0) {
        usedSkill = skill
        lastSkillUsed.value = skill
        skill.currentCooldown = skill.cooldown
        
        damage = totalStats.attack * skill.damageMultiplier
        
        if (skill.ignoreDefense) {
          damage = calculatePlayerDamage(playerStore.player, totalStats, monsterStore.currentMonster, true, 0, rebirthStats.skillDamageBonus, rebirthStats.bossDamageBonus)
        } else {
          damage = calculatePlayerDamage(playerStore.player, totalStats, monsterStore.currentMonster, false, 0, rebirthStats.skillDamageBonus, rebirthStats.bossDamageBonus)
        }
        
        if (skill.trueDamage) {
          damage += skill.trueDamage
        }
        
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
      }
    }
    
    if (damage === 0) {
      damage = calculatePlayerDamage(playerStore.player, totalStats, monsterStore.currentMonster, false, 0, 0, rebirthStats.bossDamageBonus)
      isCrit = Math.random() * 100 < totalStats.critRate
      if (isCrit) {
        damage = Math.floor(damage * totalStats.critDamage / 100)
        trackPlayerDamage(Math.floor(damage), 'crit')
      } else {
        trackPlayerDamage(Math.floor(damage), 'normal')
      }
      
      const speedAdvantage = calculateSpeedAdvantage(totalStats.speed, monsterStore.currentMonster.speed)
      if (speedAdvantage.damageBonus > 0) {
        damage = Math.floor(damage * (1 + speedAdvantage.damageBonus / 100))
        addBattleLog(`速度优势发动! 伤害提升${speedAdvantage.damageBonus}%!`)
      }
      
      addBattleLog(`你对 ${monsterStore.currentMonster.name} 造成了 ${Math.floor(damage)} 点伤害${isCrit ? ' (暴击!)' : ''}!`)
    }
    
    return { damage: Math.floor(damage), isCrit, skill: usedSkill }
  }
  
  function executeMonsterTurn(): { damage: number, dodged: boolean } {
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    
    if (!monsterStore.currentMonster) {
      return { damage: 0, dodged: false }
    }
    
    const totalStats = playerStore.totalStats
    let damage = calculateMonsterDamage(monsterStore.currentMonster, playerStore.player, totalStats)
    
    const isDodged = Math.random() * 100 < totalStats.dodge
    if (isDodged) {
      trackDodgedAttack()
      addBattleLog(`你躲闪了 ${monsterStore.currentMonster.name} 的攻击!`)
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
    addBattleLog(`${monsterStore.currentMonster.name} 对你造成了 ${damage} 点伤害!`)
    
    return { damage, dodged: false }
  }
  
  function processPlayerAttack(skillIndex: number | null = null) {
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    const achievementStore = useAchievementStore()
    
    if (isPaused.value || !monsterStore.currentMonster) return
    if (!canPlayerAct.value) return
    
    const { damage } = executePlayerTurn(skillIndex)
    
    const result = monsterStore.damageMonster(damage)
    
    playerActionGauge.value -= GAUGE_MAX
    
    if (damage > 0 && result.killed) {
      const luckEffects = calculateLuckEffects(playerStore.player.stats.luck)
      const lifestealRate = luckEffects.critBonus * 10
      if (lifestealRate > 0) {
        const healAmount = calculateLifesteal(damage, lifestealRate)
        if (healAmount > 0) {
          playerStore.heal(healAmount)
          addBattleLog(`生命汲取: 恢复了 ${healAmount} 点生命!`)
        }
      }
    }
    
    if (result.killed) {
      trackKill()
      const luckEffects = calculateLuckEffects(playerStore.player.stats.luck)
      const bonusGold = Math.floor(result.goldReward * luckEffects.goldBonus)
      playerStore.addGold(result.goldReward + bonusGold)
      playerStore.addExperience(result.expReward)
      playerStore.incrementKillCount()
      
      if (result.diamondReward > 0) {
        playerStore.addDiamond(result.diamondReward)
        addBattleLog(`获得了 ${result.diamondReward} 钻石!`)
      }
      
      if (result.shouldDropEquipment) {
        const equipment = playerStore.generateRandomEquipment()
        if (equipment) {
          const equipped = playerStore.equipNewEquipment(equipment)
          if (equipped) {
            addBattleLog(`获得了新装备: ${equipment.name}!`)
          }
        }
      }
      
      achievementStore.checkAndUpdateAchievements(playerStore.player)
      
      addBattleLog(`你击败了 ${monsterStore.currentMonster.name}! 获得 ${result.goldReward} 金币和 ${result.expReward} 经验!`)
    }
    
    if (playerStore.isDead()) {
      addBattleLog('你被击败了! 自动返回10层前...')
      monsterStore.goBackLevels(10)
      playerStore.revive()
      clearBattleLog()
    }
  }
  
  function processMonsterAttack() {
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
  
  function togglePause() {
    isPaused.value = !isPaused.value
  }
  
  function revive() {
    const monsterStore = useMonsterStore()
    monsterStore.goBackLevels(10)
    clearBattleLog()
  }
  
  function updateSkillCooldowns(deltaTime: number) {
    const playerStore = usePlayerStore()
    for (const skill of playerStore.player.skills) {
      if (skill && skill.currentCooldown > 0) {
        skill.currentCooldown = Math.max(0, skill.currentCooldown - deltaTime)
      }
    }
  }
  
  function updateGauges(deltaTime: number) {
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    
    if (!monsterStore.currentMonster) return
    
    const playerSpeed = playerStore.totalStats.speed
    const monsterSpeed = monsterStore.currentMonster.speed
    
    playerActionGauge.value = Math.min(GAUGE_MAX, playerActionGauge.value + playerSpeed * deltaTime * GAUGE_TICK_RATE / 100)
    monsterActionGauge.value = Math.min(GAUGE_MAX, monsterActionGauge.value + monsterSpeed * deltaTime * GAUGE_TICK_RATE / 100)
    
    const speedAdvantage = calculateSpeedAdvantage(playerSpeed, monsterSpeed)
    if (speedAdvantage.hasAdvantage && monsterActionGauge.value > 0) {
      monsterActionGauge.value = 0
      addBattleLog(`先手攻击! 你的速度优势让你抢先行动!`)
    }
  }
  
  function gameLoop(deltaTime: number) {
    if (isPaused.value) return
    
    try {
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
      console.error('Error in gameLoop:', e)
    }
  }
  
  function startBattle() {
    const monsterStore = useMonsterStore()
    monsterStore.initMonster()
    playerActionGauge.value = GAUGE_MAX
    monsterActionGauge.value = 0
    clearBattleLog()
    resetDamageStats()
    
    const playerStore = usePlayerStore()
    if (playerStore.player.currentHp <= 0) {
      playerStore.revive()
    }
  }
  
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
  
  function getPlayerGaugePercent() {
    return (playerActionGauge.value / GAUGE_MAX) * 100
  }
  
  function getMonsterGaugePercent() {
    return (monsterActionGauge.value / GAUGE_MAX) * 100
  }
  
  return {
    isPaused,
    battleLog,
    lastSkillUsed,
    playerActionGauge,
    monsterActionGauge,
    canPlayerAct,
    canMonsterAct,
    gameSpeed,
    damageStats,
    addBattleLog,
    clearBattleLog,
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
    getMonsterGaugePercent
  }
})