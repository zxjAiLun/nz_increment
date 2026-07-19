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
import { calculateLifestealCap, calculateAppliedLifesteal } from '../utils/calc'
import { calculateMonsterDamageFromSource, calculatePlayerDamageFromSource, type CombatContext, type DamagePostMultiplier, type DamageResult, type DamageSource, type RNG } from '../systems/combat/damage'
import { estimateExpectedMonsterHitDamage } from '../utils/combatInsights'
import { getSkillById, getSkillBuffEffects } from '../utils/skillSystem'
import { PASSIVE_SKILLS } from '../data/passiveSkills'
import { applyPassiveEffects } from '../utils/passiveEvaluator'
import { nextEventDelayMs, shouldEnrage } from '../systems/combat/combatClock'
import type { Skill, StatType } from '../types'

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
// 技能冷却「就绪」判定的容差（秒）：连续步进中冷却可能以 ~1e-9 的量越过 0 而不恰好等于 0，
// 若用 ===0 会导致「冷却与行动槽在同一瞬间同时就绪」时被漏判（边界相位滑移）。以「剩余冷却 ≤ 1ms」视为就绪，
// 对应连续语义（冷却到点即就绪），与模拟器 0.1s 网格误差 ≤100ms 的约定一致。
const COOLDOWN_READY_EPS = 1e-3

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

  // 运行时 / 模拟器 调度 parity 校验遥测（A2.3）。
  // actionLog 记录本场战斗的事件顺序（'P' = 玩家行动，'M' = 怪物行动），用于严格比较行动时序。
  // skillCastTimes / buffApplyMs / buffExpireMs 记录战斗毫秒时刻，用于严格比较技能/Buff 时间轴。
  interface CombatTelemetry {
    playerActions: number
    monsterActions: number
    skillCasts: number
    playerDamage: number
    incomingDamage: number
    actionLog: Array<'P' | 'M'>
    skillCastTimes: number[]
    playerActionTimes: number[]
    buffApplyMs: number | null
    buffExpireMs: number | null
  }
  const combatTelemetry = ref<CombatTelemetry>({
    playerActions: 0,
    monsterActions: 0,
    skillCasts: 0,
    playerDamage: 0,
    incomingDamage: 0,
    actionLog: [],
    skillCastTimes: [],
    playerActionTimes: [],
    buffApplyMs: null,
    buffExpireMs: null
  })

  function resetCombatTelemetry() {
    combatTelemetry.value = {
      playerActions: 0, monsterActions: 0, skillCasts: 0, playerDamage: 0, incomingDamage: 0,
      actionLog: [], skillCastTimes: [], playerActionTimes: [], buffApplyMs: null, buffExpireMs: null
    }
    prevBuffKeys.value = new Set()
    carriedCombatSeconds.value = 0
    battleTimeMs.value = 0
  }

  // 战斗经过时间（毫秒）：与所有战斗系统「逐事件」同步推进，是 parity 时间戳的统一时钟。
  const battleTimeMs = ref(0)

  // 跨帧持久记录上一次 activeBuffs 的 key 集合，用于在 gameLoop 层检测「循环外施加」的 Buff（手动技能路径）。
  const prevBuffKeys = ref<Set<StatType>>(new Set())

  // 战斗遥测（actionLog / skillCastTimes 等）只在显式开启时记录，避免长期挂机中响应式数组无限增长。
  // 生产热路径默认关闭；测试通过 enableCombatTelemetry(true) 开启。
  const telemetryEnabled = ref(false)
  function enableCombatTelemetry(on: boolean) { telemetryEnabled.value = on }

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

  // 判定「已达行动阈值」的容差：gauge 可能因浮点略超/略低于 GAUGE_MAX。
  const GAUGE_READY_EPS = 1e-6
  // 单步推进的容差（毫秒）：小于此视为「已到达行动边界」，避免浮点死循环。
  const STEP_EPS_MS = 1e-6

  // 每帧逻辑事件上限；默认与 MAX_LOGIC_EVENTS_PER_FRAME 一致，测试可经 setLogicEventCap 注入更小值以真正触发 cap。
  let logicEventCap = MAX_LOGIC_EVENTS_PER_FRAME
  function setLogicEventCap(cap: number) { logicEventCap = Math.max(1, Math.floor(cap)) }

  /**
   * 统一消费一次「已就绪」行动槽（A2.3 P0 修复）。
   *
   * - gauge < GAUGE_MAX：返回 false（不可行动，不消费）。
   * - gauge >= GAUGE_MAX：先减去 GAUGE_MAX（保留超过 100 的 remainder），同步 ATB Store，返回 true。
   * 一次就绪槽只能执行一次行动；`processPlayerAttack/MonsterAttack` 必须经由它扣槽，
   * 否则手动点击/自动循环会重复触发（A2.2 遗留的手动技能无限行动漏洞）。
   */
  function consumeReadyGauge(side: 'player' | 'monster'): boolean {
    if (side === 'player') {
      if (playerActionGauge.value < GAUGE_MAX - GAUGE_READY_EPS) return false
      playerActionGauge.value = Math.max(0, playerActionGauge.value - GAUGE_MAX)
      useATBStore().setPlayerATB(playerActionGauge.value)
      return true
    } else {
      if (monsterActionGauge.value < GAUGE_MAX - GAUGE_READY_EPS) return false
      monsterActionGauge.value = Math.max(0, monsterActionGauge.value - GAUGE_MAX)
      useATBStore().setMonsterATB(monsterActionGauge.value)
      return true
    }
  }

  // 测试辅助：把玩家行动槽直接置满，模拟「槽位已满、玩家点击技能」的瞬间（不用于生产路径）。
  function primePlayerGauge() { playerActionGauge.value = GAUGE_MAX }

  /**
   * 换怪（新 encounter）时把行动槽重置为该怪物「自己的初始值」（A2.3 P0 修复）。
   * 新怪物从新的 gauge 起始值、combatElapsedMs=0（createBossMechanicState 已归零）开始，
   * 不继承旧 encounter 的槽位债务或战斗时间。仅重置槽位/ATB，不动日志/统计/玩家状态。
   */
  function resetGaugesForEncounter() {
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    const monster = monsterStore.currentMonster
    if (!monster) return
    const pSpeed = playerStore.totalStats.speed
    const mSpeed = monster.speed
    if (pSpeed >= mSpeed) {
      playerActionGauge.value = Math.min((pSpeed - mSpeed) * GAUGE_TICK_RATE * 0.5, GAUGE_MAX * 0.5)
      monsterActionGauge.value = 0
    } else {
      playerActionGauge.value = 0
      monsterActionGauge.value = Math.min((mSpeed - pSpeed) * GAUGE_TICK_RATE * 0.5, GAUGE_MAX * 0.5)
    }
    const atbStore = useATBStore()
    atbStore.reset()
    atbStore.setPlayerATB(playerActionGauge.value)
    atbStore.setMonsterATB(monsterActionGauge.value)
    carriedCombatSeconds.value = 0
    battleTimeMs.value = 0
    prevBuffKeys.value = new Set()
  }

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
        if (skill && skill.currentCooldown <= COOLDOWN_READY_EPS) {
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

        // 统一多效果 Buff：通过唯一规范化入口取得效果列表，每个效果按其 mode 施加。
        // 重复施放同一属性会覆盖（刷新）而非叠加（见 playerStore.applyBuff）。
        const buffEffects = getSkillBuffEffects(skill)
        if (buffEffects.length > 0) {
          for (const eff of buffEffects) {
            playerStore.applyBuff(eff.stat, eff.value, eff.duration, eff.mode)
            const unit = eff.mode === 'flat' ? '' : '%'
            addBattleLog(`你使用了 ${skill.name}，${eff.stat}提升了 ${eff.value}${unit}，持续${eff.duration}秒!`)
          }
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
      shouldEnrage(Math.round(bossState.combatElapsedMs), mechanic.enrageAfterMs ?? 30_000)
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
    if (telemetryEnabled.value) combatTelemetry.value.playerActions++

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
    if (telemetryEnabled.value) {
      if (skill) {
        combatTelemetry.value.skillCasts++
        combatTelemetry.value.skillCastTimes.push(Math.round(battleTimeMs.value))
      }
      combatTelemetry.value.playerDamage += damage
      combatTelemetry.value.actionLog.push('P')
      combatTelemetry.value.playerActionTimes.push(Math.round(battleTimeMs.value))
    }

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

    // 吸血结算（技能吸血 + 属性吸血）共用同一 pure helper，基数 = 目标实际承受伤害 appliedDamage。
    // 区分日志避免两个相同的「生命偷取」让人误判为重复结算。
    const applyLifestealFromDamage = (srcSkill: Skill | null | undefined, appliedDamage: number) => {
      if (appliedDamage <= 0) return
      const skillRate = srcSkill?.lifesteal ?? 0
      const globalRate = calculateLifestealCap(playerStore.totalStats.lifesteal)
      const { skillHeal, globalHeal } = calculateAppliedLifesteal({
        appliedDamage,
        skillLifestealRate: skillRate,
        globalLifestealRate: globalRate
      })
      if (skillHeal > 0) {
        playerStore.heal(skillHeal)
        addBattleLog(`生命汲取技能：+${skillHeal}`)
        addDamagePopup('lifesteal', skillHeal, true)
      }
      if (globalHeal > 0) {
        playerStore.heal(globalHeal)
        addBattleLog(`属性吸血：+${globalHeal}`)
        addDamagePopup('lifesteal', globalHeal, true)
      }
    }

    applyLifestealFromDamage(skill, result.appliedDamage ?? damage)

    // 命中回复（装备 on-hit 类，独立于吸血）
    if (damage > 0) applyOnHitRecovery(damage)

    if (result.killed) {
      grantKillRewards(killedMonster, result)
      return
    }

    for (const pending of extraDamages) {
      if (telemetryEnabled.value) combatTelemetry.value.playerDamage += pending.damageResult.amount
      if (applyPendingDamage(pending)) return
    }

    // 速度双动：第一击存活时才对同一回合的当前怪物追加第二击。
    const advantage = getSpeedAdvantage(playerStore.totalStats.speed, monsterStore.currentMonster.speed)
    if (advantage.doubleAction) {
      addBattleLog('速度优势：追加一次行动！')
      const extra = executePlayerTurn(skillIndex)
      const extraDamage = extra.damage
      if (telemetryEnabled.value) combatTelemetry.value.playerDamage += extraDamage
      if (extraDamage > 0 && monsterStore.currentMonster) {
        const extraKilledMonster = { name: monsterStore.currentMonster.name, level: monsterStore.currentMonster.level, isBoss: monsterStore.currentMonster.isBoss }
        const extraResult = monsterStore.damageMonster(extraDamage, combatRng.value)
        if (extraResult.shieldDamage > 0) addBattleLog(`${extraKilledMonster.name} 的护盾吸收了 ${extraResult.shieldDamage} 点伤害!`)
        if (extraResult.healed > 0) addBattleLog(`${extraKilledMonster.name} 汲取生命，恢复了 ${extraResult.healed} 点生命!`)
        addDamagePopup(extra.skill ? 'skill' : extra.isCrit ? 'crit' : 'normal', extraDamage, false)
        applyOnHitRecovery(extraDamage, '追加命中回复')
        // 双动额外命中：必须用「本次实际施放的技能」结算技能吸血——首击技能此刻已在冷却，
        // extra.skill 为 null（退化为普攻），因此额外普攻不再继承首击技能的 lifesteal（P0 修复）。
        applyLifestealFromDamage(extra.skill, extraResult.appliedDamage ?? extraDamage)
        currentCombo.value++
        if (extraResult.killed) {
          grantKillRewards(extraKilledMonster, extraResult)
          return
        }
      }
      if (monsterStore.currentMonster) {
        for (const pending of extra.extraDamages) {
          if (telemetryEnabled.value) combatTelemetry.value.playerDamage += pending.damageResult.amount
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
    if (telemetryEnabled.value) {
      combatTelemetry.value.monsterActions++
      combatTelemetry.value.incomingDamage += res.damage
      combatTelemetry.value.actionLog.push('M')
    }

    // 标记仅在怪物完成行动后按「回合」扣减一次（不按帧、不按玩家行动）。
    if (monsterStore.currentMonster) monsterStore.tickMarks(monsterStore.currentMonster)

    if (playerStore.isDead()) {
      handlePlayerDeath('monsterTurn')
    }
  }

  function processMonsterAttack(force: boolean = false) {
    const monsterStore = useMonsterStore()
    if (isPaused.value || !monsterStore.currentMonster) return
    if (!force && !consumeReadyGauge('monster')) return
    performMonsterAction()
  }

  // ─── 玩家回合（效果执行 + gauge 守卫） ─────
  // performPlayerAction 已拆为「效果执行」纯函数（见上方）；这里是给 UI / 测试用的带 gauge 消费守卫的薄包装。
  // 必须通过 consumeReadyGauge 扣减槽位，否则手动点击（App.useSkill → processPlayerAttack）不会清空槽位，
  // 导致紧接着可再点其它技能、且下一帧 gameLoop 把仍为 100 的槽位再解析成一场行动（A2.3 P0 手动技能无限行动漏洞）。
  // 自动战斗（gameLoop）路径：消费一次 player gauge，然后解析一次玩家行动（优先选就绪的 damage 技能，否则普攻/必杀）。
  function processPlayerAttack(_skillIndex: number | null = null, force: boolean = false) {
    const monsterStore = useMonsterStore()
    if (isPaused.value || !monsterStore.currentMonster) return
    if (!force && !consumeReadyGauge('player')) return
    resolvePlayerAction()
  }

  // 玩家行动的「统一解析」入口：自动战斗与手动技能都复用它。
  // 调用方（processPlayerAttack / tryUsePlayerSkill）已消费一次 gauge；这里只决定「本回合释放哪个技能」，
  // 真正的释放（设冷却一次、应用 Buff/治疗一次、伤害/标记/引爆一次）全部在 executePlayerTurn 内完成——
  // 它只在技能 currentCooldown===0 时进入释放分支，因此无论自动还是手动，效果都只发生一次。
  function resolvePlayerAction(manualSkillIndex?: number) {
    const skillStore = useSkillStore()
    if (typeof manualSkillIndex === 'number') {
      performPlayerAction(manualSkillIndex)
    } else {
      const nextSkill = skillStore.getNextReadySkill()
      performPlayerAction(nextSkill ? nextSkill.index : null)
    }
  }

  // ─── 手动技能原子入口（A2.4 P0 修复） ─────
  // 取代旧 App 中的双调用 skillStore.useSkill(idx) + processPlayerAttack(idx)。
  // 在一个原子流程里完成：校验（怪物/暂停/技能存在/冷却为 0）→ 消费一次 player gauge → 经统一入口 resolvePlayerAction 结算。
  // 关键：不再由 skillStore.useSkill 提前设冷却/应用 Buff，因此 executePlayerTurn 在 currentCooldown===0 时
  // 会真正释放该技能（设一次冷却、应用一次 Buff/治疗、打一次伤害），手动与自动走完全相同的结算语义。
  function tryUsePlayerSkill(slotIndex: number): boolean {
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    if (isPaused.value || !monsterStore.currentMonster) return false
    const skills = playerStore.player.skills
    if (slotIndex < 0 || slotIndex >= skills.length) return false
    const skill = skills[slotIndex]
    if (!skill || skill.currentCooldown > COOLDOWN_READY_EPS) return false
    // 必须先消费一次行动额度（gauge），否则手动点击不会清空槽位（A2.3 P0：无限行动）。
    if (!consumeReadyGauge('player')) return false
    // 经统一解析入口结算：executePlayerTurn 在 cooldown===0 时释放一次（冷却/效果/伤害各一次）。
    resolvePlayerAction(slotIndex)
    return true
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
   * 逐事件战斗窗口（A2.3 核心）。
   *
   * 不再「先整窗推进所有系统再执行事件」，而是严格按「时间片 → 事件 → 重新读取状态」循环：
   *   1. 用 nextEventDelayMs 算出到【下一个行动】还需多少毫秒（取双方中先到者，并与本帧剩余时间取小）；
   *   2. 只推进这段毫秒的：技能冷却 / Buff / 回血 / Boss combatElapsedMs / 双方行动槽 / battleTimeMs；
   *   3. 若本步恰好推进到一次（或同刻双方）行动边界，则执行该行动——同刻时怪物优先；
   *   4. 每个事件后重新读取玩家速度 / 怪物速度 / 技能就绪 / Buff / 当前怪物 / encounter token，
   *      因此首个事件施加的速度 Buff、减速、换怪、技能冷却都立即影响本窗口后续事件；
   *   5. 换怪（encounter token 变更）立刻停止旧遭遇剩余事件并重置新怪物槽位，不回滚也不继续推进旧时间；
   *   6. 达到 MAX_LOGIC_EVENTS_PER_FRAME 时，仅把尚未推进的 remainingMs 顺延下帧（已消费的时间已如实推进）。
   *
   * 这样冷却不会「提前转好」、Buff 不会「本窗口持续过久」、速度 Buff 能改变后续行动、
   * Boss 不会「提前狂暴」、回血与攻击按真实时间顺序发生——所有战斗系统真正活在同一个战斗时间上。
   */
  // 当前所有生效 Buff 中，最早到期的剩余毫秒（作为「速度/状态变化」时间边界）。
  // 没有 Buff 时返回 Infinity。注意：只关心会「改变行动积分」的 Buff 到期时刻，
  // 这里对所有 activeBuff 取最早到期（任何 Buff 到期都会改变 stats 快照，统一以最短为准最安全）。
  function earliestBuffExpiryMs(): number {
    const playerStore = usePlayerStore()
    const buffs = playerStore.activeBuffs
    if (!buffs || buffs.size === 0) return Infinity
    let min = Infinity
    for (const buff of buffs.values()) {
      if (buff.remainingMs > 0 && buff.remainingMs < min) min = buff.remainingMs
    }
    return min
  }

  function advanceBattleWindow(totalDeltaMs: number) {
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    if (!monsterStore.currentMonster) return

    let remainingMs = totalDeltaMs + carriedCombatSeconds.value * 1000
    let eventsThisFrame = 0

    while (remainingMs > STEP_EPS_MS && eventsThisFrame < logicEventCap) {
      const encounterId = monsterStore.currentEncounterId
      // 片段开始时快照速度与槽位，整段积分都用这份快照，避免「先删 Buff 再用删后速度积分整段」。
      const pSpeed = playerStore.totalStats.speed
      const mSpeed = monsterStore.currentMonster ? monsterStore.currentMonster.speed : 0

      // 到下一次行动还需推进的毫秒（Infinity 表示该方永不行动）。
      const pDelay = nextEventDelayMs(playerActionGauge.value, pSpeed)
      const mDelay = nextEventDelayMs(monsterActionGauge.value, mSpeed)
      // 到下一次「速度/Buff 状态变化」还需推进的毫秒（任何 Buff 到期都会改变积分速度）。
      const buffDelay = earliestBuffExpiryMs()

      // 到最近的时间边界（可用时间耗尽 / 玩家就绪 / 怪物就绪 / Buff 到期）。
      const availableMs = remainingMs
      const nextDelayMs = Math.min(availableMs, pDelay, mDelay, buffDelay)

      // 只有「恰好落在这个边界」的一方才是真正 Due Now。
      // 不能用剩余窗口 availableMs 代替 nextDelayMs 去判断谁 Due，
      // 否则慢的一方（例如 pDelay=5、mDelay=10、availableMs=16.67）会被误认为双方都 Due，
      // 导致只推进 5ms 后怪物在 gauge 未满时提前攻击。
      const playerDueNow = Number.isFinite(pDelay) && pDelay <= nextDelayMs + STEP_EPS_MS
      const monsterDueNow = Number.isFinite(mDelay) && mDelay <= nextDelayMs + STEP_EPS_MS
      const buffDueNow = Number.isFinite(buffDelay) && buffDelay <= nextDelayMs + STEP_EPS_MS

      // —— 用快照速度把整段（到最近边界）同步推进：槽位 / 冷却 / Buff / 回血 / Boss 时间 / battleTimeMs ——
      advanceAllSystems(nextDelayMs)
      advanceBothGauges(nextDelayMs, pSpeed, mSpeed)
      remainingMs -= nextDelayMs

      // Buff-only 边界：不执行行动，重新读取速度后继续。
      if (buffDueNow && !playerDueNow && !monsterDueNow) {
        continue
      }

      // 无行动边界：双方都未达行动阈值（例如窗口耗尽或 gauge 差一丝才满）。
      if (!playerDueNow && !monsterDueNow) {
        break
      }

      // 怪物先行动（同刻或单独 Due）。
      if (monsterDueNow) {
        if (!consumeReadyGauge('monster')) throw new Error('monster gauge not ready when due')
        performMonsterAction()
        if (monsterStore.currentEncounterId !== encounterId) { resetGaugesForEncounter(); return }
        if (playerStore.isDead()) { carriedCombatSeconds.value = 0; return }
      }
      if (playerDueNow) {
        // 怪物事件可能已换怪/致死玩家，本同刻玩家事件失效。
        if (monsterStore.currentEncounterId !== encounterId) { resetGaugesForEncounter(); return }
        if (playerStore.isDead()) { carriedCombatSeconds.value = 0; return }
        if (!consumeReadyGauge('player')) throw new Error('player gauge not ready when due')
        resolvePlayerAction()
        if (monsterStore.currentEncounterId !== encounterId) { resetGaugesForEncounter(); return }
        if (playerStore.isDead()) { carriedCombatSeconds.value = 0; return }
      }
      eventsThisFrame++
    }

    // 未消费时间（毫秒）顺延下帧优先消费，保证跨帧顺序 == 一次性无 cap 解析。
    carriedCombatSeconds.value = Math.max(0, remainingMs) / 1000
  }

  // 同步推进所有「非槽位」战斗系统：技能冷却 / Buff（含施加/到期检测）/ 回血 / Boss 战斗经过时间 / battleTimeMs。
  function advanceAllSystems(deltaMs: number) {
    const playerStore = usePlayerStore()
    const monsterStore = useMonsterStore()
    if (deltaMs <= 0) return

    // Buff 施加/到期检测在 gameLoop 层统一处理（见 detectBuffTransitions），此处仅推进系统。
    updateSkillCooldowns(deltaMs)
    applyCombatRegen(deltaMs)
    playerStore.updateActiveBuffs(deltaMs)

    // boss 战斗经过时间：暂停时 gameLoop 已提前返回，故此处推进等价于「战斗时间」；
    // 新怪物生成时 combatElapsedMs 归零（createBossMechanicState），因此自动重置。
    const monster = monsterStore.currentMonster
    if (monster?.bossState) {
      monster.bossState.combatElapsedMs = (monster.bossState.combatElapsedMs ?? 0) + deltaMs
    }
    battleTimeMs.value += deltaMs
  }

  // 跨帧检测 Buff 施加/到期：比较当前 activeBuffs 与上一次 gameLoop 结尾的 key 集合。
  // 放在 gameLoop 层（而非 advanceAllSystems 内）以捕获「循环外经 useSkill 路径施加」的 Buff。
  function detectBuffTransitions() {
    const playerStore = usePlayerStore()
    const current = new Set(playerStore.activeBuffs ? Array.from(playerStore.activeBuffs.keys()) : [])
    if (telemetryEnabled.value) {
      for (const key of current) {
        if (!prevBuffKeys.value.has(key) && combatTelemetry.value.buffApplyMs === null) {
          combatTelemetry.value.buffApplyMs = Math.round(battleTimeMs.value)
        }
      }
      for (const key of prevBuffKeys.value) {
        if (!current.has(key) && combatTelemetry.value.buffExpireMs === null) {
          combatTelemetry.value.buffExpireMs = Math.round(battleTimeMs.value)
        }
      }
    }
    prevBuffKeys.value = current
  }

  // 同步推进双方行动槽（用调用方快照的速度积分整段时间片，不在此处重新读取 totalStats.speed，
  // 以免 Buff 在本时间片内到期后被「删后速度」积分整段——A2.4 P0 速度边界修复）。
  function advanceBothGauges(deltaMs: number, pSpeed: number, mSpeed: number) {
    const atbStore = useATBStore()
    playerActionGauge.value = playerActionGauge.value + pSpeed * (deltaMs / 1000)
    monsterActionGauge.value = monsterActionGauge.value + mSpeed * (deltaMs / 1000)
    atbStore.setPlayerATB(playerActionGauge.value)
    atbStore.setMonsterATB(monsterActionGauge.value)
  }

  function gameLoop(deltaTime: number) {
    if (isPaused.value) return
    try {
      const monsterStore = useMonsterStore()
      if (!monsterStore.currentMonster) return
      // effectiveDelta 含 gameSpeed（毫秒）；carriedCombatSeconds（秒）由 advanceBattleWindow 内部并入。
      const effectiveDeltaMs = deltaTime * gameSpeed.value
      advanceBattleWindow(effectiveDeltaMs)
      detectBuffTransitions()
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
    resetCombatTelemetry()
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
    resetCombatTelemetry()

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
    tryUsePlayerSkill,
    primePlayerGauge,
    updateSkillCooldowns,
    setLogicEventCap,
    gameLoop,
    startBattle,
    resumeBattle,
    togglePause,
    revive,

    // 运行时 / 模拟器 parity 校验遥测
    combatTelemetry,
    enableCombatTelemetry,
    resetCombatTelemetry,

    // 测试 / 排空 carry 访问
    carriedCombatSeconds,
    battleTimeMs,

    // 导出常量（供外部使用）
    GAUGE_MAX
  }
})
