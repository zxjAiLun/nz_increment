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
import { useTalentStore } from './talentStore'
import { calculateLifesteal, calculateSkillLifesteal, calculateLifestealCap } from '../utils/calc'
import { calculateMonsterDamageFromSource, calculatePlayerDamageFromSource, type CombatContext, type DamagePostMultiplier, type DamageResult, type DamageSource, type RNG } from '../systems/combat/damage'
import { estimateExpectedMonsterHitDamage } from '../utils/combatInsights'
import { getSkillById } from '../utils/skillSystem'
import { PASSIVE_SKILLS } from '../data/passiveSkills'
import { applyPassiveEffects } from '../utils/passiveEvaluator'
import { advanceCombatTimeline, shouldEnrage } from '../systems/combat/combatClock'
import type { Skill } from '../types'

export const GAUGE_MAX = 100
const GAUGE_TICK_RATE = 10
const BASE_REGEN_PERCENT_PER_SECOND = 0.4
const MAX_REGEN_PERCENT_PER_SECOND = 3
const BASE_KILL_HEAL_PERCENT = 8
const BASE_BOSS_KILL_HEAL_PERCENT = 25
const LOW_HP_KILL_HEAL_BONUS_PERCENT = 10
const LOW_HP_THRESHOLD = 0.3
const BASE_BLOCK_CHANCE = 5
const BASE_BLOCK_REDUCTION = 30
const MAX_BLOCK_CHANCE = 45
const MAX_BLOCK_REDUCTION = 70
const DEATH_SAFE_MODE_MS = 10_000

export const useGameStore = defineStore('game', () => {
  // ─── UI状态 ───────────────────────────────
  const isPaused = ref(false)
  const gameSpeed = ref(1)
  const battleError = ref<Error | null>(null)

  // ─── ATB 行动槽 ────────────────────────────
  const playerActionGauge = ref(0)
  const monsterActionGauge = ref(0)
  // 单帧逻辑事件安全上限：仅用于约束「一次同步游戏循环」的最坏工作量（极端倍速/极速场景），
  // 不构成第二套调度——超出部分以 carriedCombatSeconds 形式顺延到下一帧，且所有战斗系统（冷却/Buff/回血/狂暴）
  // 只推进到「已消费」的战斗时间，故仍是帧率无关、无时钟错位（详见 advanceBattleWindow）。
  const MAX_LOGIC_EVENTS_PER_FRAME = 2000
  // 怪物行动计数（用于运行时 / 模拟器 parity 校验）
  const monsterTurnCount = ref(0)
  // 跨帧保留的「未消费战斗时间（毫秒）」：本帧因达到安全上限而没处理完的战斗时间，下帧优先消费（保证顺序 + 无饥饿）。
  const carriedCombatSeconds = ref(0)

  // 运行时 / 模拟器 parity 校验遥测（crit/dodge/block 关闭时与模拟器严格相等）。
  // remainingHp / monsterRemainingHp / enraged / enrageTriggeredAtMs 直接读取实时 store 状态，不在此计数。
  interface CombatTelemetry {
    playerActions: number
    monsterActions: number
    skillCasts: number
    playerDamage: number
    incomingDamage: number
  }
  const combatTelemetry = ref<CombatTelemetry>({
    playerActions: 0,
    monsterActions: 0,
    skillCasts: 0,
    playerDamage: 0,
    incomingDamage: 0
  })

  // ─── 战斗日志 ──────────────────────────────
  interface BattleLogEvent {
    id: number
    message: string
    explanation?: Array<{ label: string; value: string }>
    type?: 'damage' | 'skill' | 'boss' | 'item' | 'level' | 'system'
    value?: number
  }

  const battleLog = ref<string[]>([])
  const battleEvents = ref<BattleLogEvent[]>([])
  let battleEventId = 0

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
  const combatRng = ref<RNG>(Math.random)
  const regenCarry = ref(0)

  // ─── 死亡与恢复状态 ───────────────────────
  const deathCount = ref(0)
  const lastDeathAt = ref(0)
  const deathPenaltyUntil = ref(0)
  const fatigue = ref(0)
  const safeModeUntil = ref(0)
  const lastDeathReason = ref('')

  // ─── Computed ──────────────────────────────
  // 唯一调度模型下：某一方「可行动」等价于其槽位已充满（已达到下一次行动的触发点）。
  // 不再存在 pending 计数（旧的第二套路径已删除，A2.2）。
  const canPlayerAct = computed(() => playerActionGauge.value >= GAUGE_MAX)
  const canMonsterAct = computed(() => monsterActionGauge.value >= GAUGE_MAX)
  const isSafeModeActive = computed(() => Date.now() < safeModeUntil.value)

  function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value))
  }

  function getRegenPercentPerSecond(): number {
    const playerStore = usePlayerStore()
    return clamp(BASE_REGEN_PERCENT_PER_SECOND + (playerStore.totalStats.hpRegenPercent ?? 0), 0, MAX_REGEN_PERCENT_PER_SECOND)
  }

  function getBlockChance(): number {
    const playerStore = usePlayerStore()
    return clamp(BASE_BLOCK_CHANCE + (playerStore.totalStats.blockChance ?? 0), 0, MAX_BLOCK_CHANCE)
  }

  function getBlockReduction(): number {
    const playerStore = usePlayerStore()
    return clamp(BASE_BLOCK_REDUCTION + (playerStore.totalStats.blockReduction ?? 0), 0, MAX_BLOCK_REDUCTION)
  }

  function getKillHealPercent(isBoss: boolean, hpPercent: number): number {
    const playerStore = usePlayerStore()
    const base = isBoss ? BASE_BOSS_KILL_HEAL_PERCENT : BASE_KILL_HEAL_PERCENT
    const lowHpBonus = hpPercent < LOW_HP_THRESHOLD ? LOW_HP_KILL_HEAL_BONUS_PERCENT : 0
    return base + (playerStore.totalStats.killHealPercent ?? 0) + lowHpBonus
  }

  function getDeathSetbackLevels(difficulty: number): number {
    const talentBonus = useTalentStore().getSpecialBonuses()
    const base = difficulty < 30 ? 3 : difficulty < 200 ? 7 : 10
    return Math.max(1, base - talentBonus.deathSetbackReduction)
  }

  function getDeathRewardMultiplier(now = Date.now()): number {
    const timedPenalty = now < deathPenaltyUntil.value ? 0.8 : 1
    const fatiguePenalty = 1 - Math.min(5, Math.max(0, fatigue.value)) * 0.05
    return clamp(timedPenalty * fatiguePenalty, 0.6, 1)
  }

  // ─── 日志 ──────────────────────────────────
  function createCombatContext(): CombatContext {
    const monsterStore = useMonsterStore()
    return { difficulty: monsterStore.difficultyValue, rng: combatRng.value }
  }

  function setCombatRng(rng: RNG) {
    combatRng.value = rng
  }

  function resetCombatRng() {
    combatRng.value = Math.random
  }

  function createDamageExplanation(result: DamageResult, applyResult?: { shieldDamage?: number; hpDamage?: number; healed?: number }) {
    const rows = [...result.steps]
    if (applyResult) {
      if ((applyResult.shieldDamage ?? 0) > 0) rows.push({ label: '护盾吸收', value: `${applyResult.shieldDamage}` })
      if ((applyResult.hpDamage ?? 0) > 0) rows.push({ label: '实际扣血', value: `${applyResult.hpDamage}` })
      if ((applyResult.healed ?? 0) > 0) rows.push({ label: 'Boss恢复', value: `${applyResult.healed}` })
    }
    return rows
  }

  function skillToDamageSource(skill: Skill): DamageSource {
    return {
      type: 'skill',
      name: skill.name,
      baseMultiplier: skill.damageMultiplier ?? 1,
      hitCount: skill.hitCount || 1,
      canCrit: true,
      ignoreDefense: skill.ignoreDefense,
      defenseIgnorePercent: skill.defenseIgnorePercent,
      trueDamage: skill.trueDamage,
      voidDamage: 0
    }
  }

  function detonateToDamageSource(skill: Skill, stacks: number): DamageSource {
    return {
      type: 'detonate',
      name: `${skill.name} 引爆 ${skill.detonateMark}`,
      baseMultiplier: (skill.detonateDamage || 1) * stacks,
      hitCount: 1,
      canCrit: true,
      ignoreDefense: skill.ignoreDefense,
      defenseIgnorePercent: skill.defenseIgnorePercent,
      trueDamage: 0,
      voidDamage: 0
    }
  }

  function addBattleLog(message: string, explanation?: BattleLogEvent['explanation']) {
    battleLog.value.unshift(message)
    battleEvents.value.unshift({ id: ++battleEventId, message, explanation })
    if (battleLog.value.length > 50) battleLog.value.pop()
    if (battleEvents.value.length > 50) battleEvents.value.pop()
  }

  function clearBattleLog() {
    battleLog.value = []
    battleEvents.value = []
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

  function applyCombatRegen(deltaTime: number) {
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    if (!monsterStore.currentMonster || playerStore.isDead()) return

    const regenPercent = getRegenPercentPerSecond()
    if (regenPercent <= 0) return

    // 按真实秒连续积分：累积本帧应恢复的生命（浮点），仅在跨过整数时结算。
    // +1e-9 抵消浮点累加速度在末段「差一点不到整数」的舍入误差，
    // 保证 30/60/144Hz 等任意帧率下 N 秒总恢复量一致（与模拟器秒级积分对齐，P0-1 同类修复）。
    regenCarry.value += playerStore.player.maxHp * regenPercent / 100 * (deltaTime / 1000)
    const healAmount = Math.floor(regenCarry.value + 1e-9)
    if (healAmount <= 0) return

    regenCarry.value -= healAmount
    playerStore.heal(healAmount)
  }

  function applyKillRecovery(killedMonster: { name: string; level: number; isBoss: boolean } | null) {
    if (!killedMonster) return
    const playerStore = usePlayerStore()
    const hpPercent = playerStore.player.maxHp > 0 ? playerStore.player.currentHp / playerStore.player.maxHp : 1
    const healPercent = getKillHealPercent(killedMonster.isBoss, hpPercent)
    const healAmount = Math.floor(playerStore.player.maxHp * healPercent / 100)
    if (healAmount <= 0) return

    playerStore.heal(healAmount)
    addBattleLog(`${killedMonster.isBoss ? 'Boss战后恢复' : '击杀恢复'}: +${healAmount} (${healPercent.toFixed(0)}%)`)
    addDamagePopup('heal', healAmount, true)
  }

  function applyOnHitRecovery(damage: number, sourceLabel = '命中回复') {
    if (damage <= 0) return
    const playerStore = usePlayerStore()
    const hitHeal = Math.floor(playerStore.totalStats.hitHealFlat ?? 0)
    if (hitHeal <= 0) return

    playerStore.heal(hitHeal)
    addBattleLog(`${sourceLabel}: +${hitHeal}`)
    addDamagePopup('heal', hitHeal, true)
  }

  function createDeathReason(): string {
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    if (!monsterStore.currentMonster) return '当前生命归零'

    const monster = monsterStore.currentMonster
    const incomingDps = estimateExpectedMonsterHitDamage(monster, playerStore.totalStats, monsterStore.difficultyValue) * Math.max(0.05, monster.speed / 100)
    const regenPerSecond = playerStore.player.maxHp * getRegenPercentPerSecond() / 100
    const netLoss = Math.max(0, incomingDps - regenPerSecond)
    if (netLoss > 0) return `预计每秒净损失 ${Math.ceil(netLoss)} 生命，生存不足`
    return '爆发伤害超过当前生命上限'
  }

  function handlePlayerDeath(source: 'playerTurn' | 'monsterTurn') {
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    const talentStore = useTalentStore()
    const now = Date.now()
    const setback = getDeathSetbackLevels(monsterStore.difficultyValue)
    const reason = createDeathReason()
    const talentBonus = talentStore.getSpecialBonuses()
    const safeModeMs = DEATH_SAFE_MODE_MS + talentBonus.safeModeBonusSeconds * 1000

    deathCount.value++
    lastDeathAt.value = now
    safeModeUntil.value = now + safeModeMs
    lastDeathReason.value = reason
    if (monsterStore.difficultyValue >= 30) deathPenaltyUntil.value = now + 30_000
    if (monsterStore.difficultyValue >= 200) fatigue.value += Math.max(0, 1 - talentBonus.fatigueReductionPercent / 100)

    monsterStore.goBackLevels(setback)
    playerStore.revive()
    playerActionGauge.value = GAUGE_MAX
    monsterActionGauge.value = 0
    regenCarry.value = 0

    addBattleLog(`你被击败了：${reason}`)
    addBattleLog(`已自动后退 ${setback} 层并恢复满血，获得 ${safeModeMs / 1000} 秒保护。`)
    if (source === 'monsterTurn') addDamagePopup('heal', playerStore.player.maxHp, true)
  }

  function getSustainSnapshot() {
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    const monster = monsterStore.currentMonster
    const regenPerSecond = playerStore.player.maxHp * getRegenPercentPerSecond() / 100
    const blockMitigation = getBlockChance() / 100 * getBlockReduction() / 100
    const incomingPerSecond = monster
      ? estimateExpectedMonsterHitDamage(monster, playerStore.totalStats, monsterStore.difficultyValue) * Math.max(0.05, monster.speed / 100) * (1 - blockMitigation)
      : 0
    const netHpPerSecond = regenPerSecond - incomingPerSecond
    const safeModeRemainingSeconds = Math.max(0, Math.ceil((safeModeUntil.value - Date.now()) / 1000))
    const penaltyRemainingSeconds = Math.max(0, Math.ceil((deathPenaltyUntil.value - Date.now()) / 1000))
    const tone = safeModeRemainingSeconds > 0
      ? 'protected'
      : netHpPerSecond >= 0
        ? 'good'
        : Math.abs(netHpPerSecond) < playerStore.player.maxHp * 0.02
          ? 'warning'
          : 'danger'

    return {
      regenPerSecond,
      incomingPerSecond,
      netHpPerSecond,
      killHealPercent: getKillHealPercent(monster?.isBoss ?? false, playerStore.player.maxHp > 0 ? playerStore.player.currentHp / playerStore.player.maxHp : 1),
      blockChance: getBlockChance(),
      blockReduction: getBlockReduction(),
      safeModeRemainingSeconds,
      penaltyRemainingSeconds,
      fatigue: fatigue.value,
      lastDeathReason: lastDeathReason.value,
      tone
    }
  }

  // ─── 伤害追踪 ──────────────────────────────
  function resetDamageStats() {
    damageStats.value = {
      totalDamage: 0, normalDamage: 0, critDamage: 0, skillDamage: 0,
      voidDamage: 0, trueDamage: 0, damageToPlayer: 0,
      dodgedAttacks: 0, critCount: 0, killCount: 0, startTime: Date.now()
    }
  }

  type DamageTrackTag = 'normal' | 'crit' | 'skill' | 'void' | 'true'

  function trackPlayerDamage(amount: number, tags: DamageTrackTag | DamageTrackTag[]) {
    damageStats.value.totalDamage += amount
    for (const type of Array.isArray(tags) ? tags : [tags]) {
      if (type === 'normal') damageStats.value.normalDamage += amount
      else if (type === 'crit') { damageStats.value.critDamage += amount; damageStats.value.critCount++ }
      else if (type === 'skill') damageStats.value.skillDamage += amount
      else if (type === 'void') damageStats.value.voidDamage += amount
      else if (type === 'true') damageStats.value.trueDamage += amount
    }
  }

  function trackDamageToPlayer(amount: number) { damageStats.value.damageToPlayer += amount }
  function trackDodgedAttack() { damageStats.value.dodgedAttacks++ }
  function trackKill() { damageStats.value.killCount++ }
  function getDPS(): number {
    const duration = (Date.now() - damageStats.value.startTime) / 1000
    return duration <= 0 ? 0 : Math.floor(damageStats.value.totalDamage / duration)
  }

  function getDamageBreakdown() {
    return getPrimaryDamageBreakdown()
  }

  function getPrimaryDamageBreakdown() {
    const s = damageStats.value
    return [
      { name: '普通伤害', value: s.normalDamage, color: '#4ecdc4' },
      { name: '技能伤害', value: s.skillDamage, color: '#9d4dff' }
    ].filter(i => i.value > 0).sort((a, b) => b.value - a.value)
  }

  function getTagDamageBreakdown() {
    const s = damageStats.value
    return [
      { name: '暴击贡献', value: s.critDamage, color: '#e94560' },
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

  function getSpeedPostMultipliers(playerSpeed: number, monsterSpeed: number): DamagePostMultiplier[] {
    const speedAdv = calculateSpeedAdvantage(playerSpeed, monsterSpeed)
    return speedAdv.damageBonus > 0
      ? [{ label: '速度优势', multiplier: 1 + speedAdv.damageBonus }]
      : []
  }

  function getPlayerDamageTags(result: DamageResult, fallback: 'normal' | 'skill'): DamageTrackTag[] {
    const tags: DamageTrackTag[] = [fallback]
    if (result.crit) tags.push('crit')
    if (result.trueDamage > 0) tags.push('true')
    if (result.voidDamage > 0) tags.push('void')
    return tags
  }

  interface PendingPlayerDamage {
    damageResult: DamageResult
    message: string
    popupType: 'normal' | 'crit' | 'skill'
    tags: DamageTrackTag[]
  }

  function getPlayerGaugePercent() { return (playerActionGauge.value / GAUGE_MAX) * 100 }
  function getMonsterGaugePercent() { return (monsterActionGauge.value / GAUGE_MAX) * 100 }

  // ─── 玩家回合执行 ─────────────────────────
  function executePlayerTurn(skillIndex: number | null = null) {
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    if (!monsterStore.currentMonster) return { damage: 0, isCrit: false, skill: null, isUltimate: false, extraDamages: [] as PendingPlayerDamage[] }

    let damage = 0
    let isCrit = false
    let usedSkill: Skill | null = null
    let actionResolved = false
    const extraDamages: PendingPlayerDamage[] = []

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
        actionResolved = true

        const damageResult = calculatePlayerDamageFromSource({
          player: playerStore.player,
          totalStats,
          monster: monsterStore.currentMonster,
          source: skillToDamageSource(skill),
          context: createCombatContext(),
          extraDamageBonusPercent: rebirthStats.skillDamageBonus + comboBonus,
          bossDamageBonusPercent: rebirthStats.bossDamageBonus,
          postMultipliers: getSpeedPostMultipliers(totalStats.speed, monsterStore.currentMonster.speed)
        })
        damage = damageResult.amount
        isCrit = damageResult.crit

        if (skill.type === 'heal' && skill.healPercent) {
          playerStore.healPercent(skill.healPercent)
          addBattleLog(`你使用了 ${skill.name}，恢复了 ${skill.healPercent}% 最大生命!`)
        }

        if (skill.buffEffect) {
          playerStore.applyBuff(skill.buffEffect.stat, skill.buffEffect.percentBoost, skill.buffEffect.duration)
          addBattleLog(`你使用了 ${skill.name}，${skill.buffEffect.stat}提升了 ${skill.buffEffect.percentBoost}%，持续${skill.buffEffect.duration}秒!`)
        }

        if (skill.type === 'damage') {
          if (damageResult.hit) {
            addBattleLog(
              `你对 ${monsterStore.currentMonster.name} 使用了 ${skill.name}，造成了 ${Math.floor(damage)} 点伤害${damageResult.crit ? ' (暴击!)' : ''}!`,
              createDamageExplanation(damageResult)
            )
            trackPlayerDamage(Math.floor(damage), getPlayerDamageTags(damageResult, 'skill'))
          } else {
            addBattleLog(`你对 ${monsterStore.currentMonster.name} 使用了 ${skill.name}，但是未命中!`)
          }
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
            const detonateResult = calculatePlayerDamageFromSource({
              player: playerStore.player,
              totalStats,
              monster: monsterStore.currentMonster,
              source: detonateToDamageSource(skill, stacks),
              context: createCombatContext(),
              extraDamageBonusPercent: rebirthStats.skillDamageBonus,
              bossDamageBonusPercent: rebirthStats.bossDamageBonus,
              postMultipliers: getSpeedPostMultipliers(totalStats.speed, monsterStore.currentMonster.speed)
            })
            const finalDmg = detonateResult.amount
            extraDamages.push({
              damageResult: detonateResult,
              message: `[引爆] ${skill.name} 触发 ${stacks} 层 ${skill.detonateMark}，造成 ${finalDmg} 伤害${detonateResult.crit ? ' (暴击!)' : ''}!`,
              popupType: detonateResult.crit ? 'crit' : 'skill',
              tags: getPlayerDamageTags(detonateResult, 'skill')
            })
          }
        }
      }
    }

    // 普攻
    if (!actionResolved) {
      const damageResult = calculatePlayerDamageFromSource({
        player: playerStore.player,
        totalStats,
        monster: monsterStore.currentMonster,
        source: { type: 'basic', name: isUltimate ? '必杀技' : '普攻', baseMultiplier: isUltimate ? 5 : 1, hitCount: 1, canCrit: true },
        context: createCombatContext(),
        extraDamageBonusPercent: comboBonus,
        bossDamageBonusPercent: rebirthStats.bossDamageBonus,
        postMultipliers: getSpeedPostMultipliers(totalStats.speed, monsterStore.currentMonster.speed)
      })
      damage = damageResult.amount
      isCrit = damageResult.crit

      if (!damageResult.hit) {
        addBattleLog(`你攻击 ${monsterStore.currentMonster.name}，但是未命中!`)
        addDamagePopup('miss', 0, false)
      }

      if (damageResult.hit && isUltimate) {
        addBattleLog(`【必杀技】解放！造成 ${Math.floor(damage)} 点伤害！`)
      }

      if (damageResult.hit && comboBonus > 0) addBattleLog(`连击加成: +${comboBonus}% (${currentCombo.value}连击)`)

      if (damageResult.hit) {
        trackPlayerDamage(Math.floor(damage), getPlayerDamageTags(damageResult, 'normal'))
      }

      if (damageResult.hit) addBattleLog(
        `你对 ${monsterStore.currentMonster.name} 造成了 ${Math.floor(damage)} 点伤害${isCrit ? ' (暴击!)' : ''}!`,
        createDamageExplanation(damageResult)
      )
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

    return { damage: Math.floor(damage), isCrit, skill: usedSkill, isUltimate, extraDamages }
  }

  // ─── 怪物回合执行 ─────────────────────────
  function executeMonsterTurn() {
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    if (!monsterStore.currentMonster) return { damage: 0, dodged: false }
    if (Date.now() < safeModeUntil.value) return { damage: 0, dodged: true }

    const totalStats = playerStore.totalStats
    const mechanic = monsterStore.currentMonster.bossMechanic
    const bossState = monsterStore.currentMonster.bossState
    if (mechanic?.id === 'shield' && bossState) {
      bossState.turnCounter++
      if (bossState.turnCounter % (mechanic.shieldIntervalTurns ?? 4) === 0) {
        const shield = Math.floor(monsterStore.currentMonster.maxHp * (mechanic.shieldPercent ?? 0))
        bossState.shield += shield
        addBattleLog(`${monsterStore.currentMonster.name} 生成了 ${shield} 点护盾!`)
      }
    }

    const postMultipliers: DamagePostMultiplier[] = []
    if (
      monsterStore.currentMonster.isBoss &&
      mechanic?.id === 'enrage' &&
      bossState &&
      shouldEnrage(bossState.combatElapsedMs, mechanic.enrageAfterMs ?? 30_000)
    ) {
      postMultipliers.push({ label: '狂暴倍率', multiplier: mechanic.enrageAttackMultiplier ?? 2 })
      if (!bossState.enraged) {
        bossState.enraged = true
        bossState.enrageTriggeredAtMs = Math.round(bossState.combatElapsedMs)
        addBattleLog(`${monsterStore.currentMonster.name} 进入狂暴状态，攻击翻倍!`)
      }
    }

    if (monsterStore.currentMonster.isBoss) {
      const monsterSkillId = monsterStore.performMonsterAction(combatRng.value)
      if (monsterSkillId) {
        const skill = getSkillById(monsterSkillId)
        if (skill && skill.damageMultiplier > 0) {
          postMultipliers.push({ label: `${skill.name} 技能倍率`, multiplier: skill.damageMultiplier })
        }
      }
    }

    const damageResult = calculateMonsterDamageFromSource({
      monster: monsterStore.currentMonster,
      player: playerStore.player,
      totalStats,
      source: { type: monsterStore.currentMonster.isBoss ? 'boss' : 'basic', name: `${monsterStore.currentMonster.name} 攻击`, baseMultiplier: 1, hitCount: 1, canCrit: true },
      context: createCombatContext(),
      postMultipliers
    })
    let damage = damageResult.amount

    if (!damageResult.hit) {
      trackDodgedAttack()
      addBattleLog(`你躲闪了 ${monsterStore.currentMonster.name} 的攻击!`)
      addDamagePopup('miss', 0, true)
      return { damage: 0, dodged: true }
    }

    const blocked = combatRng.value() < getBlockChance() / 100
    if (blocked) {
      const beforeBlock = damage
      damage = Math.max(1, Math.floor(damage * (1 - getBlockReduction() / 100)))
      damageResult.steps.push({ label: '格挡减伤', value: `${beforeBlock} → ${damage}` })
      addBattleLog(`你格挡了 ${monsterStore.currentMonster.name} 的攻击，伤害降低到 ${damage}!`)
    }

    playerStore.takeDamage(damage)
    trackDamageToPlayer(damage)
    currentCombo.value = 0
    addBattleLog(`${monsterStore.currentMonster.name} 对你造成了 ${damage} 点伤害${damageResult.crit ? ' (暴击!)' : ''}!`, createDamageExplanation(damageResult))
    addDamagePopup(damageResult.crit ? 'crit' : 'normal', damage, true)

    return { damage, dodged: false }
  }

  // ─── 完整攻击流程（效果执行） ──────────────
  // performPlayerAction：只负责「一次玩家行动」的所有效果（技能/普攻/必杀/双动/击杀奖励/吸血…），
  // 不消费 gauge——gauge 与行动额度完全由 gameLoop 的事件驱动窗口（advanceBattleWindow）负责。
  // 直接调用（UI/测试）请走 processPlayerAttack（含 gauge 守卫）。
  function performPlayerAction(skillIndex: number | null = null) {
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    const achievementStore = useAchievementStore()
    const challengeStore = useChallengeStore()
    const collectionStore = useCollectionStore()

    if (!monsterStore.currentMonster) return
    combatTelemetry.value.playerActions++

    const grantKillRewards = (
      killedMonster: { name: string; level: number; isBoss: boolean } | null,
      result: {
        goldReward: number
        expReward: number
        diamondReward: number
        shouldDropEquipment: boolean
      }
    ) => {
      const killBonus = killedMonster
        ? playerStore.processKillRewards(killedMonster, result.goldReward, result.expReward)
        : { firstKillBonus: false, firstKillGold: 0, firstKillExp: 0, dailyGoalReached: -1, dailyGoalGold: 0 }
      const talentStore = useTalentStore()
      const talentBonus = talentStore.getSpecialBonuses()
      trackKill()
      const deathRewardMultiplier = getDeathRewardMultiplier()
      const totalGold = Math.floor((result.goldReward + killBonus.firstKillGold + killBonus.dailyGoalGold) * (1 + talentBonus.goldBonusPercent / 100) * deathRewardMultiplier)
      const totalExp = Math.floor((result.expReward + killBonus.firstKillExp) * deathRewardMultiplier)
      playerStore.addGold(totalGold)
      playerStore.addExperience(totalExp)
      playerStore.incrementKillCount()

      if (killedMonster) collectionStore.discoverMonster(`${killedMonster.name}_lv${killedMonster.level}`)
      challengeStore.incrementProgress('kill', 1)
      applyKillRecovery(killedMonster)
      if (killedMonster?.isBoss && talentStore.grantBossTalentPoint(`boss-level-${killedMonster.level}`)) {
        addBattleLog(`首次击败该 Boss 层级，获得 1 点天赋点!`)
      }

      if (killBonus.firstKillBonus) addBattleLog(`首杀奖励！额外获得 ${killBonus.firstKillGold} 金币和 ${killBonus.firstKillExp} 经验！`)
      if (killBonus.dailyGoalReached >= 0) {
        const goal = playerStore.DAILY_KILL_REWARDS[killBonus.dailyGoalReached]
        if (goal) addBattleLog(`每日目标达成【${goal.description}】！获得 ${killBonus.dailyGoalGold} 金币！`)
      }

      if (result.diamondReward > 0) {
        playerStore.addDiamond(result.diamondReward)
        addBattleLog(`获得了 ${result.diamondReward} 钻石!`)
      }

      const extraDropChance = talentBonus.equipmentDropBonusPercent / 100
      const shouldDropFromTalent = !result.shouldDropEquipment && combatRng.value() < extraDropChance
      if (result.shouldDropEquipment || shouldDropFromTalent) {
        const equipment = playerStore.generateRandomEquipment(combatRng.value, killedMonster?.isBoss ? 'boss' : 'normal')
        if (equipment) {
          collectionStore.discoverEquipment(equipment.id)
          const equipped = playerStore.equipNewEquipment(equipment)
          if (equipped) addBattleLog(`获得了新装备: ${equipment.name}!`)
        }
      }

      achievementStore.checkAchievement('kill_count', playerStore.player.totalKillCount)
      addBattleLog(`你击败了 ${killedMonster?.name ?? '怪物'}! 获得 ${totalGold} 金币和 ${totalExp} 经验!`)
    }

    const applyPendingDamage = (pending: PendingPlayerDamage): boolean => {
      if (!monsterStore.currentMonster) return false
      const targetMonster = { name: monsterStore.currentMonster.name, level: monsterStore.currentMonster.level, isBoss: monsterStore.currentMonster.isBoss }
      const pendingDamage = pending.damageResult.amount
      const pendingResult = monsterStore.damageMonster(pendingDamage, combatRng.value)
      addBattleLog(pending.message, createDamageExplanation(pending.damageResult, pendingResult))
      addDamagePopup(pending.popupType, pendingDamage, false)
      trackPlayerDamage(pendingDamage, pending.tags)
      applyOnHitRecovery(pendingDamage, '额外命中回复')
      if (pendingResult.shieldDamage > 0) addBattleLog(`${targetMonster.name} 的护盾吸收了 ${pendingResult.shieldDamage} 点伤害!`)
      if (pendingResult.healed > 0) addBattleLog(`${targetMonster.name} 汲取生命，恢复了 ${pendingResult.healed} 点生命!`)
      if (pendingDamage > 0) currentCombo.value++
      if (pendingResult.killed) {
        grantKillRewards(targetMonster, pendingResult)
        return true
      }
      return false
    }

    const { damage, isCrit, skill, isUltimate, extraDamages } = executePlayerTurn(skillIndex)
    if (skill) combatTelemetry.value.skillCasts++
    combatTelemetry.value.playerDamage += damage

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

    // 第一击先结算，避免双动第二击先切换怪物导致第一击丢失。
    const killedMonster = monsterStore.currentMonster
      ? { name: monsterStore.currentMonster.name, level: monsterStore.currentMonster.level, isBoss: monsterStore.currentMonster.isBoss }
      : null
    const result = monsterStore.damageMonster(damage, combatRng.value)

    if (result.shieldDamage > 0) addBattleLog(`${killedMonster?.name ?? 'Boss'} 的护盾吸收了 ${result.shieldDamage} 点伤害!`)
    if (result.healed > 0) addBattleLog(`${killedMonster?.name ?? 'Boss'} 汲取生命，恢复了 ${result.healed} 点生命!`)

    if (damage > 0) {
      addDamagePopup(skill ? 'skill' : isCrit ? 'crit' : 'normal', damage, false)
    }
    if (damage > 0) currentCombo.value++
    battleTurnCount.value++

    // 注：标记不在玩家行动时扣减（见 Task 3）。标记仅在怪物完成行动后由 processMonsterAttack 扣减一次。

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
      applyOnHitRecovery(damage)

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

    if (result.killed) {
      grantKillRewards(killedMonster, result)
      return
    }

    for (const pending of extraDamages) {
      combatTelemetry.value.playerDamage += pending.damageResult.amount
      if (applyPendingDamage(pending)) return
    }

    // 速度双动：第一击存活时才对同一回合的当前怪物追加第二击。
    const advantage = getSpeedAdvantage(playerStore.totalStats.speed, monsterStore.currentMonster.speed)
    if (advantage.doubleAction) {
      addBattleLog('速度优势：追加一次行动！')
      const extra = executePlayerTurn(skillIndex)
      const extraDamage = extra.damage
      combatTelemetry.value.playerDamage += extraDamage
      if (extraDamage > 0 && monsterStore.currentMonster) {
        const extraKilledMonster = { name: monsterStore.currentMonster.name, level: monsterStore.currentMonster.level, isBoss: monsterStore.currentMonster.isBoss }
        const extraResult = monsterStore.damageMonster(extraDamage, combatRng.value)
        if (extraResult.shieldDamage > 0) addBattleLog(`${extraKilledMonster.name} 的护盾吸收了 ${extraResult.shieldDamage} 点伤害!`)
        if (extraResult.healed > 0) addBattleLog(`${extraKilledMonster.name} 汲取生命，恢复了 ${extraResult.healed} 点生命!`)
        addDamagePopup(extra.skill ? 'skill' : extra.isCrit ? 'crit' : 'normal', extraDamage, false)
        applyOnHitRecovery(extraDamage, '追加命中回复')
        currentCombo.value++
        if (extraResult.killed) {
          grantKillRewards(extraKilledMonster, extraResult)
          return
        }
      }
      if (monsterStore.currentMonster) {
        for (const pending of extra.extraDamages) {
          combatTelemetry.value.playerDamage += pending.damageResult.amount
          if (applyPendingDamage(pending)) return
        }
      }
    }

    // 玩家死亡
    if (playerStore.isDead()) {
      handlePlayerDeath('playerTurn')
    }
  }

  // ─── 怪物回合（效果执行） ──────────────────
  // performMonsterAction：只负责「一次怪物行动」的所有效果（护盾/狂暴/技能/伤害/格挡/标记扣减…），
  // 不消费 gauge——gauge 与行动额度完全由 gameLoop 的事件驱动窗口（advanceBattleWindow）负责。
  // 直接调用（UI/测试）请走 processMonsterAttack（含 gauge 守卫）。
  function performMonsterAction() {
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()

    if (isPaused.value || !monsterStore.currentMonster) return

    const res = executeMonsterTurn()
    monsterTurnCount.value++
    combatTelemetry.value.monsterActions++
    combatTelemetry.value.incomingDamage += res.damage

    // 标记仅在怪物完成行动后按「回合」扣减一次（不按帧、不按玩家行动）。
    if (monsterStore.currentMonster) monsterStore.tickMarks(monsterStore.currentMonster)

    if (playerStore.isDead()) {
      handlePlayerDeath('monsterTurn')
    }
  }

  function processMonsterAttack(force: boolean = false) {
    const monsterStore = useMonsterStore()
    if (isPaused.value || !monsterStore.currentMonster) return
    if (!force && monsterActionGauge.value < GAUGE_MAX) return
    performMonsterAction()
  }

  // ─── 玩家回合（效果执行 + gauge 守卫） ─────
  // performPlayerAction 已拆为「效果执行」纯函数（见上方）；这里是给 UI / 测试用的带 gauge 消费守卫的薄包装。
  // 唯一调度模型下，手动点击只是「若槽位已充满则立即执行一次」，不再维护独立的 pending 计数。
  function processPlayerAttack(skillIndex: number | null = null, force: boolean = false) {
    const monsterStore = useMonsterStore()
    if (isPaused.value || !monsterStore.currentMonster) return
    if (!force && playerActionGauge.value < GAUGE_MAX) return
    performPlayerAction(skillIndex)
  }

  // ─── 游戏循环 ─────────────────────────────
  // 冷却以「秒」为单位递减：deltaTimeMs 为本帧真实毫秒数。
  // 修复 P0-1：此前每帧无脑 -1，导致 6 秒技能约 0.1 秒转好，且与模拟器（秒级）不一致。
  function updateSkillCooldowns(deltaTimeMs: number) {
    const playerStore = usePlayerStore()
    const deltaSeconds = deltaTimeMs / 1000
    for (const skill of playerStore.player.skills) {
      if (skill && skill.currentCooldown > 0) {
        skill.currentCooldown = Math.max(0, skill.currentCooldown - deltaSeconds)
      }
    }
  }

  /**
   * 事件驱动战斗窗口（A2.2 核心）。
   *
   * 运行时与模拟器调用【同一份】 advanceCombatTimeline 纯函数解析本帧行动序列，
   * 因此行动次数/顺序/无饥饿两端必然一致。关键修正（A2.1→A2.2）：
   *   之前「先用完整 effectiveDelta 推进冷却/Buff/回血/狂暴，再只处理一部分行动」导致时钟错位。
   *   现在——所有战斗系统（冷却/Buff/回血/boss combatElapsedMs/行动槽）一起只推进
   *   「本帧实际消费掉的战斗时间」(consumedTime)，不消费的时间以 carriedCombatSeconds 顺延下帧。
   *   这样行动与所有战斗系统永远活在同一个战斗时间上。
   *
   * 单帧安全上限 MAX_LOGIC_EVENTS_PER_FRAME 仅约束「一次同步游戏循环」的最坏工作量；
   * 超出部分以未消费时间形式顺延——由于所有系统都只推进到已消费时间，仍是帧率无关、无错位。
   *
   * 换怪（encounter）保护：记录 startEncounterId，一旦某次行动导致换怪/玩家死亡，
   * 立即停止旧遭遇剩余事件、清空 carry，新怪物从自己的槽位/combatElapsedMs/新帧开始。
   */
  function advanceBattleWindow(totalDeltaMs: number) {
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    if (!monsterStore.currentMonster) return

    const startEncounterId = monsterStore.currentEncounterId
    const totalSeconds = totalDeltaMs / 1000 + carriedCombatSeconds.value

    // 同一份调度原语：解析本帧（含上一帧携带的未消费时间）完整有序事件序列。
    const timeline = advanceCombatTimeline({
      playerGauge: playerActionGauge.value,
      monsterGauge: monsterActionGauge.value,
      playerSpeed: playerStore.totalStats.speed,
      monsterSpeed: monsterStore.currentMonster.speed,
      deltaSeconds: totalSeconds,
      maxEvents: MAX_LOGIC_EVENTS_PER_FRAME
    })

    // 本帧实际消费的战斗时间 = 总窗口 − 未消费时间。所有系统只推进这段「已消费」时间（同钟、无错位）。
    const consumedSeconds = Math.max(0, totalSeconds - timeline.unconsumedSeconds)
    const pSpeed = playerStore.totalStats.speed
    const mSpeed = monsterStore.currentMonster.speed
    advanceWorldSystems(consumedSeconds * 1000, pSpeed, mSpeed)

    // 行动槽直接采用调度原语结算后的余数（与模拟器同源，不再各自累加）。
    playerActionGauge.value = timeline.playerGauge
    monsterActionGauge.value = timeline.monsterGauge

    const atbStore = useATBStore()
    atbStore.setPlayerATB(playerActionGauge.value)
    atbStore.setMonsterATB(monsterActionGauge.value)

    // 未消费时间顺延下帧（优先于新 delta 消费，保证跨帧顺序 == 一次性无 cap 解析）。
    carriedCombatSeconds.value = timeline.unconsumedSeconds

    const skillStore = useSkillStore()
    for (const side of timeline.events) {
      if (side === 'player') {
        const nextSkill = skillStore.getNextReadySkill()
        performPlayerAction(nextSkill ? nextSkill.index : null)
      } else {
        performMonsterAction()
      }
      // 换怪：旧遭遇剩余事件立刻停止，carry 清空（不允许旧怪物时间窗口攻击新怪，A2.2 P0）。
      if (monsterStore.currentEncounterId !== startEncounterId) {
        carriedCombatSeconds.value = 0
        return
      }
      if (playerStore.isDead()) {
        carriedCombatSeconds.value = 0
        return
      }
    }
  }

  // 所有战斗系统（冷却 / Buff / 回血 / boss 战斗经过时间）按 consumedMs 一起推进——与行动同钟。
  // 注意：行动槽本身由 advanceCombatTimeline 结算（见 advanceBattleWindow），此处不再累加槽位。
  function advanceWorldSystems(consumedMs: number, _pSpeed: number, _mSpeed: number) {
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()

    if (consumedMs <= 0) return
    updateSkillCooldowns(consumedMs)
    applyCombatRegen(consumedMs)
    playerStore.updateActiveBuffs(consumedMs)

    // boss 战斗经过时间：暂停时 gameLoop 已提前返回，故此处推进等价于「战斗时间」；
    // 新怪物生成时 combatElapsedMs 归零（createBossMechanicState），因此自动重置。
    const monster = monsterStore.currentMonster
    if (monster?.bossState) {
      monster.bossState.combatElapsedMs = (monster.bossState.combatElapsedMs ?? 0) + consumedMs
    }
  }

  function gameLoop(deltaTime: number) {
    if (isPaused.value) return
    try {
      const monsterStore = useMonsterStore()
      if (!monsterStore.currentMonster) return
      // effectiveDelta 含 gameSpeed（毫秒）；carriedCombatSeconds（秒）由 advanceBattleWindow 内部并入。
      const effectiveDeltaMs = deltaTime * gameSpeed.value
      advanceBattleWindow(effectiveDeltaMs)
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
    regenCarry.value = 0
    battleTurnCount.value = 0
    monsterTurnCount.value = 0
    carriedCombatSeconds.value = 0
    combatTelemetry.value = { playerActions: 0, monsterActions: 0, skillCasts: 0, playerDamage: 0, incomingDamage: 0 }
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
    regenCarry.value = 0
    battleTurnCount.value = 0
    monsterTurnCount.value = 0
    carriedCombatSeconds.value = 0
    combatTelemetry.value = { playerActions: 0, monsterActions: 0, skillCasts: 0, playerDamage: 0, incomingDamage: 0 }

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
    const playerStore = usePlayerStore()
    const talentBonus = useTalentStore().getSpecialBonuses()
    monsterStore.goBackLevels(10)
    playerStore.revive()
    safeModeUntil.value = Date.now() + DEATH_SAFE_MODE_MS + talentBonus.safeModeBonusSeconds * 1000
    regenCarry.value = 0
  }

  // ─── 返回 ─────────────────────────────────
  return {
    // 状态
    isPaused,
    gameSpeed,
    battleError,
    battleLog,
    battleEvents,
    damagePopups,
    damageStats,
    playerActionGauge,
    monsterActionGauge,
    canPlayerAct,
    canMonsterAct,
    lastSkillUsed,
    battleTurnCount,
    monsterTurnCount,
    currentCombo,
    ultimateGauge,
    deathCount,
    lastDeathAt,
    deathPenaltyUntil,
    fatigue,
    safeModeUntil,
    lastDeathReason,
    isSafeModeActive,

    // 日志
    addBattleLog,
    clearBattleLog,
    setCombatRng,
    resetCombatRng,

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
    getPrimaryDamageBreakdown,
    getTagDamageBreakdown,
    getSustainSnapshot,
    getRegenPercentPerSecond,
    getKillHealPercent,
    getBlockChance,
    getBlockReduction,
    getDeathRewardMultiplier,

    // ATB 辅助
    getSpeedAdvantage,
    getATBGain,
    calculateSpeedAdvantage,
    getPlayerGaugePercent,
    getMonsterGaugePercent,

    // 战斗流程
    executePlayerTurn,
    executeMonsterTurn,
    performPlayerAction,
    performMonsterAction,
    processPlayerAttack,
    processMonsterAttack,
    updateSkillCooldowns,
    gameLoop,
    startBattle,
    resumeBattle,
    togglePause,
    revive,

    // 运行时 / 模拟器 parity 校验遥测
    combatTelemetry,
    resetCombatTelemetry: () => {
      combatTelemetry.value = { playerActions: 0, monsterActions: 0, skillCasts: 0, playerDamage: 0, incomingDamage: 0 }
      carriedCombatSeconds.value = 0
    },

    // 导出常量（供外部使用）
    GAUGE_MAX
  }
})
