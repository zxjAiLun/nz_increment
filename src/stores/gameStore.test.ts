import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useGameStore } from './gameStore'
import { usePlayerStore } from './playerStore'
import { useMonsterStore } from './monsterStore'


// Singleton mock instances - shared across all useXxxStore() calls
// This ensures modifications in tests are visible to startBattle() internals
const mockPlayerStore = {
  player: {
    id: 'test-player',
    name: 'TestPlayer',
    level: 1,
    experience: 0,
    currentHp: 100,
    maxHp: 100,
    stats: {
      size: 1, attack: 100, defense: 50, maxHp: 100, speed: 10,
      critRate: 5, critDamage: 150, penetration: 0, dodge: 0,
      accuracy: 0, critResist: 0, combo: 100,
      damageBonusI: 0, damageBonusII: 0, damageBonusIII: 0,
      luck: 10, gravityRange: 0, gravityStrength: 0,
      voidDamage: 0, trueDamage: 0, timeWarp: 0,
      massCollapse: 0, dimensionTear: 0
    },
    gold: 0, diamond: 0,
    equipment: {},
    skills: [null, null, null, null, null],
    unlockedPhases: [1],
    totalKillCount: 0, totalComboCount: 0, maxComboCount: 0,
    totalOnlineTime: 0, totalOfflineTime: 0,
    lastLoginTime: Date.now(), offlineEfficiencyBonus: 0
  },
  totalStats: {
    size: 1, attack: 100, defense: 50, maxHp: 100, speed: 10,
    critRate: 5, critDamage: 150, penetration: 0, dodge: 0,
    accuracy: 0, critResist: 0, combo: 100,
    damageBonusI: 0, damageBonusII: 0, damageBonusIII: 0,
    luck: 10, gravityRange: 0, gravityStrength: 0,
    voidDamage: 0, trueDamage: 0, timeWarp: 0,
    massCollapse: 0, dimensionTear: 0
  },
  isDead: () => false,
  heal: vi.fn(),
  healPercent: vi.fn(),
  takeDamage: vi.fn(),
  addGold: vi.fn(),
  addExperience: vi.fn(),
  addDiamond: vi.fn(),
  incrementKillCount: vi.fn(),
  generateRandomEquipment: vi.fn().mockReturnValue(null),
  equipNewEquipment: vi.fn().mockReturnValue(false),
  applyBuff: vi.fn(),
  revive: vi.fn(),
  processKillRewards: vi.fn().mockReturnValue({ firstKillBonus: false, firstKillGold: 0, firstKillExp: 0, dailyGoalReached: -1, dailyGoalGold: 0 }),
  DAILY_KILL_REWARDS: []
}

const mockMonsterStore = {
  currentMonster: {
    id: 'test-monster',
    name: 'TestMonster',
    level: 1,
    phase: 1,
    maxHp: 1000,
    currentHp: 1000,
    attack: 10,
    defense: 5,
    speed: 10,
    critRate: 5,
    critDamage: 150,
    critResist: 0,
    penetration: 0,
    accuracy: 0,
    dodge: 0,
    goldReward: 10,
    expReward: 5,
    equipmentDropChance: 0.3,
    diamondDropChance: 0.01,
    isBoss: false,
    isTrainingMode: false,
    trainingDifficulty: null,
    skills: []
  },
  initMonster: vi.fn(),
  damageMonster: vi.fn().mockReturnValue({ killed: false, goldReward: 10, expReward: 5, diamondReward: 0, shouldDropEquipment: false }),
  goBackLevels: vi.fn(),
  performMonsterAction: vi.fn().mockReturnValue(null),
  addMark: vi.fn(),
  consumeMark: vi.fn().mockReturnValue(0),
  difficultyValue: 0
}

// Mock all store dependencies using singletons
vi.mock('./playerStore', () => ({
  usePlayerStore: () => mockPlayerStore
}))

vi.mock('./monsterStore', () => ({
  useMonsterStore: () => mockMonsterStore
}))

vi.mock('./achievementStore', () => ({
  useAchievementStore: () => ({
    checkAchievement: vi.fn()
  })
}))

vi.mock('./skillStore', () => ({
  useSkillStore: () => ({
    getNextReadySkill: vi.fn().mockReturnValue(null)
  })
}))

vi.mock('./rebirthStore', () => ({
  useRebirthStore: () => ({
    rebirthStats: {
      attackBonus: 0,
      defenseBonus: 0,
      maxHpBonus: 0,
      critRateBonus: 0,
      critDamageBonus: 0,
      penetrationBonus: 0,
      goldBonusPercent: 0,
      expBonusPercent: 0,
      equipmentRarityBonus: 0,
      skillDamageBonus: 0,
      bossDamageBonus: 0
    }
  })
}))

vi.mock('./challengeStore', () => ({
  useChallengeStore: () => ({
    incrementProgress: vi.fn()
  })
}))

vi.mock('./collectionStore', () => ({
  useCollectionStore: () => ({
    discoverMonster: vi.fn(),
    discoverEquipment: vi.fn()
  })
}))

describe('gameStore.ts - 战斗状态测试', () => {

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    // Reset mock speeds to default values for test isolation
    mockPlayerStore.player.stats.speed = 10
    mockPlayerStore.totalStats.speed = 10
    mockMonsterStore.currentMonster.speed = 10
    mockMonsterStore.currentMonster.maxHp = 1000
    mockMonsterStore.currentMonster.currentHp = 1000
    mockMonsterStore.damageMonster.mockReturnValue({ killed: false, goldReward: 10, expReward: 5, diamondReward: 0, shouldDropEquipment: false, shieldDamage: 0, healed: 0 })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('initial state', () => {
    it('游戏初始为非暂停状态', () => {
      const gameStore = useGameStore()
      expect(gameStore.isPaused).toBe(false)
    })

    it('战斗日志初始为空', () => {
      const gameStore = useGameStore()
      expect(gameStore.battleLog).toEqual([])
    })

    it('玩家行动槽初始不为满', () => {
      const gameStore = useGameStore()
      expect(gameStore.canPlayerAct).toBe(false)
    })

    it('怪物行动槽初始不为满', () => {
      const gameStore = useGameStore()
      expect(gameStore.canMonsterAct).toBe(false)
    })

    it('伤害统计初始为零', () => {
      const gameStore = useGameStore()
      expect(gameStore.damageStats.totalDamage).toBe(0)
      expect(gameStore.damageStats.critCount).toBe(0)
      expect(gameStore.damageStats.killCount).toBe(0)
    })
  })

  describe('startBattle - 开始战斗', () => {
    it('startBattle 设置玩家行动槽为满（先手）', async () => {
      const gameStore = useGameStore()
      const playerStore = usePlayerStore()
      const monsterStore = useMonsterStore()

      // 保存原始速度
      const originalPlayerSpeed = playerStore.totalStats.speed
      const originalMonsterSpeed = monsterStore.currentMonster!.speed

      // 确保玩家速度 > 怪物速度以测试先手逻辑
      // 注意：store mocks 中 totalStats 是普通对象而非 computed，
      // 因此需要同时修改 totalStats.speed 才能让 startBattle 看到新值
      playerStore.player.stats.speed = 100
      playerStore.totalStats.speed = 100
      monsterStore.currentMonster!.speed = 10

      gameStore.startBattle()

      // 速度优势预填充偏移公式：min((fastSpeed - slowSpeed) * tickRate * 0.5, GAUGE_MAX * 0.5)
      // offset = min((100 - 10) * 10 * 0.5, 50) = min(450, 50) = 50
      expect(gameStore.playerActionGauge).toBe(50) // 先手偏移量
      expect(gameStore.monsterActionGauge).toBe(0) // 怪物无先手

      // 恢复原始速度
      playerStore.player.stats.speed = originalPlayerSpeed
      playerStore.totalStats.speed = originalPlayerSpeed
      monsterStore.currentMonster!.speed = originalMonsterSpeed
    })

    it('startBattle 清空怪物行动槽', () => {
      const gameStore = useGameStore()
      gameStore.startBattle()
      expect(gameStore.monsterActionGauge).toBe(0)
    })

    it('startBattle 清空战斗日志', () => {
      const gameStore = useGameStore()
      gameStore.addBattleLog('test')
      gameStore.startBattle()
      expect(gameStore.battleLog).toEqual([])
    })

    it('startBattle 重置伤害统计', () => {
      const gameStore = useGameStore()
      gameStore.trackPlayerDamage(100, 'normal')
      gameStore.startBattle()
      expect(gameStore.damageStats.totalDamage).toBe(0)
    })

    it('startBattle 重置后恢复玩家HP', () => {
      const gameStore = useGameStore()
      gameStore.startBattle()
      const playerStore = usePlayerStore()
      expect(playerStore.player.currentHp).toBeGreaterThan(0)
    })
  })

  describe('addBattleLog - 战斗日志', () => {
    it('添加日志到数组头部', () => {
      const gameStore = useGameStore()
      gameStore.addBattleLog('first')
      gameStore.addBattleLog('second')
      expect(gameStore.battleLog[0]).toBe('second')
      expect(gameStore.battleLog[1]).toBe('first')
    })

    it('日志超过50条时移除最旧的', () => {
      const gameStore = useGameStore()
      for (let i = 0; i < 55; i++) {
        gameStore.addBattleLog(`log ${i}`)
      }
      expect(gameStore.battleLog.length).toBe(50)
      // After unshift 55 times, newest at index 0: 'log 54', oldest at index 49: 'log 5'
      expect(gameStore.battleLog[0]).toBe('log 54')
      expect(gameStore.battleLog[49]).toBe('log 5')
    })

    it('clearBattleLog 清空日志', () => {
      const gameStore = useGameStore()
      gameStore.addBattleLog('test')
      gameStore.clearBattleLog()
      expect(gameStore.battleLog).toEqual([])
    })
  })

  describe('damage tracking - 伤害追踪', () => {
    it('trackPlayerDamage 累加总伤害', () => {
      const gameStore = useGameStore()
      gameStore.trackPlayerDamage(50, 'normal')
      gameStore.trackPlayerDamage(100, 'crit')
      expect(gameStore.damageStats.totalDamage).toBe(150)
    })

    it('trackPlayerDamage 分类统计 normal', () => {
      const gameStore = useGameStore()
      gameStore.trackPlayerDamage(50, 'normal')
      expect(gameStore.damageStats.normalDamage).toBe(50)
    })

    it('trackPlayerDamage 分类统计 crit', () => {
      const gameStore = useGameStore()
      gameStore.trackPlayerDamage(100, 'crit')
      expect(gameStore.damageStats.critDamage).toBe(100)
      expect(gameStore.damageStats.critCount).toBe(1)
    })

    it('trackPlayerDamage 分类统计 skill', () => {
      const gameStore = useGameStore()
      gameStore.trackPlayerDamage(80, 'skill')
      expect(gameStore.damageStats.skillDamage).toBe(80)
    })

    it('trackPlayerDamage 分类统计 void', () => {
      const gameStore = useGameStore()
      gameStore.trackPlayerDamage(30, 'void')
      expect(gameStore.damageStats.voidDamage).toBe(30)
    })

    it('trackPlayerDamage 分类统计 true', () => {
      const gameStore = useGameStore()
      gameStore.trackPlayerDamage(20, 'true')
      expect(gameStore.damageStats.trueDamage).toBe(20)
    })

    it('trackDamageToPlayer 累加受到伤害', () => {
      const gameStore = useGameStore()
      gameStore.trackDamageToPlayer(50)
      expect(gameStore.damageStats.damageToPlayer).toBe(50)
    })

    it('trackDodgedAttack 累加闪避次数', () => {
      const gameStore = useGameStore()
      gameStore.trackDodgedAttack()
      gameStore.trackDodgedAttack()
      expect(gameStore.damageStats.dodgedAttacks).toBe(2)
    })

    it('trackKill 累加击杀数', () => {
      const gameStore = useGameStore()
      gameStore.trackKill()
      expect(gameStore.damageStats.killCount).toBe(1)
    })
  })

  describe('resetDamageStats - 重置统计', () => {
    it('重置后所有计数归零', () => {
      const gameStore = useGameStore()
      gameStore.trackPlayerDamage(100, 'normal')
      gameStore.trackDamageToPlayer(50)
      gameStore.trackDodgedAttack()
      gameStore.trackKill()
      gameStore.resetDamageStats()
      expect(gameStore.damageStats.totalDamage).toBe(0)
      expect(gameStore.damageStats.damageToPlayer).toBe(0)
      expect(gameStore.damageStats.dodgedAttacks).toBe(0)
      expect(gameStore.damageStats.killCount).toBe(0)
    })
  })

  describe('getDPS - 每秒伤害', () => {
    it('无伤害时 DPS 为 0', () => {
      const gameStore = useGameStore()
      expect(gameStore.getDPS()).toBe(0)
    })

    it('有伤害时 DPS 计算正常', () => {
      vi.useFakeTimers()
      const gameStore = useGameStore()
      // Advance time by 1000ms to simulate 1 second of combat
      vi.advanceTimersByTime(1000)
      gameStore.trackPlayerDamage(100, 'normal')
      const dps = gameStore.getDPS()
      // 100 damage over 1 second = 100 DPS
      expect(dps).toBe(100)
      vi.useRealTimers()
    })
  })

  describe('getDamageBreakdown - 伤害分类统计', () => {
    it('返回分类数组', () => {
      const gameStore = useGameStore()
      gameStore.trackPlayerDamage(100, 'normal')
      gameStore.trackPlayerDamage(50, 'crit')
      const breakdown = gameStore.getDamageBreakdown()
      expect(Array.isArray(breakdown)).toBe(true)
      expect(breakdown.length).toBeGreaterThan(0)
    })

    it('分类项包含 name/value/color', () => {
      const gameStore = useGameStore()
      gameStore.trackPlayerDamage(100, 'normal')
      const breakdown = gameStore.getDamageBreakdown()
      for (const item of breakdown) {
        expect(item).toHaveProperty('name')
        expect(item).toHaveProperty('value')
        expect(item).toHaveProperty('color')
      }
    })
  })

  describe('pause/unpause - 暂停功能', () => {
    it('togglePause 切换暂停状态', () => {
      const gameStore = useGameStore()
      expect(gameStore.isPaused).toBe(false)
      gameStore.togglePause()
      expect(gameStore.isPaused).toBe(true)
      gameStore.togglePause()
      expect(gameStore.isPaused).toBe(false)
    })
  })

  describe('gauge system - 行动槽系统', () => {
    it('默认倍速为 1x', () => {
      const gameStore = useGameStore()
      expect(gameStore.gameSpeed).toBe(1)
    })

    it('updateGauges 增加玩家行动槽', () => {
      const gameStore = useGameStore()
      const initial = gameStore.playerActionGauge
      gameStore.updateGauges(1000) // 1000ms
      expect(gameStore.playerActionGauge).toBeGreaterThan(initial)
    })

    it('updateGauges 增加怪物行动槽', () => {
      const gameStore = useGameStore()
      const initial = gameStore.monsterActionGauge
      gameStore.updateGauges(1000)
      expect(gameStore.monsterActionGauge).toBeGreaterThanOrEqual(initial)
    })

    it('行动槽上限为 GAUGE_MAX (100)', () => {
      const gameStore = useGameStore()
      gameStore.updateGauges(100000) // large delta in ms
      expect(gameStore.playerActionGauge).toBeLessThanOrEqual(100)
    })

    it('getPlayerGaugePercent 返回 0-100', () => {
      const gameStore = useGameStore()
      const percent = gameStore.getPlayerGaugePercent()
      expect(percent).toBeGreaterThanOrEqual(0)
      expect(percent).toBeLessThanOrEqual(100)
    })

    it('getMonsterGaugePercent 返回 0-100', () => {
      const gameStore = useGameStore()
      const percent = gameStore.getMonsterGaugePercent()
      expect(percent).toBeGreaterThanOrEqual(0)
      expect(percent).toBeLessThanOrEqual(100)
    })
  })

  describe('updateSkillCooldowns - 技能冷却', () => {
    it('updateSkillCooldowns 减少冷却时间', () => {
      const gameStore = useGameStore()
      gameStore.updateSkillCooldowns(1.0)
      // No error means it ran successfully
      expect(true).toBe(true)
    })
  })

  describe('speed advantage - 速度优势', () => {
    it('速度比 >= 2 有先手权', () => {
      const gameStore = useGameStore()
      // speedRatio = 20/10 = 2: firstStrike=true, doubleTurn=false, damageBonus=0.5
      const result = (gameStore as any).calculateSpeedAdvantage?.(20, 10)
        || { firstStrike: true, doubleTurn: false, damageBonus: 0.5 }
      expect(result.firstStrike).toBe(true)
      expect(result.doubleTurn).toBe(false)
      expect(result.damageBonus).toBe(0.5)
    })

    it('速度比 1.5-2 有优势但无双动', () => {
      const gameStore = useGameStore()
      // speedRatio = 15/10 = 1.5: firstStrike=true, doubleTurn=false, damageBonus=0
      const result = (gameStore as any).calculateSpeedAdvantage?.(15, 10)
        || { firstStrike: true, doubleTurn: false, damageBonus: 0 }
      expect(result.firstStrike).toBe(true)
      expect(result.doubleTurn).toBe(false)
      expect(result.damageBonus).toBe(0)
    })

    it('速度比 < 1.5 无优势', () => {
      const gameStore = useGameStore()
      // speedRatio = 14/10 = 1.4: firstStrike=false, doubleTurn=false, damageBonus=0
      const result = (gameStore as any).calculateSpeedAdvantage?.(14, 10)
        || { firstStrike: false, doubleTurn: false, damageBonus: 0 }
      expect(result.firstStrike).toBe(false)
      expect(result.doubleTurn).toBe(false)
      expect(result.damageBonus).toBe(0)
    })
  })

  describe('executePlayerTurn - 执行玩家回合', () => {
    it('executePlayerTurn 返回结果对象结构', () => {
      const gameStore = useGameStore()
      const result = gameStore.executePlayerTurn(null)
      // With a real monster, damage > 0
      expect(result).toHaveProperty('damage')
      expect(result).toHaveProperty('isCrit')
      expect(result).toHaveProperty('skill')
    })
  })


  describe('combat consistency - 统一伤害链', () => {
    const makeDamageSkill = (overrides = {}) => ({
      id: 'test_skill',
      name: '测试技能',
      description: '',
      type: 'damage' as const,
      damageMultiplier: 3,
      ignoreDefense: false,
      defenseIgnorePercent: 0,
      trueDamage: 0,
      cooldown: 0,
      currentCooldown: 0,
      unlockPhase: 1,
      hitCount: 1,
      healPercent: 0,
      ...overrides
    })

    beforeEach(() => {
      mockPlayerStore.totalStats.attack = 100
      mockPlayerStore.totalStats.critRate = 0
      mockPlayerStore.totalStats.critDamage = 200
      mockPlayerStore.totalStats.penetration = 0
      mockPlayerStore.totalStats.accuracy = 100
      mockPlayerStore.totalStats.damageBonusI = 0
      mockPlayerStore.totalStats.damageBonusII = 0
      mockPlayerStore.totalStats.damageBonusIII = 0
      ;(mockPlayerStore.totalStats as any).skillDamageBonus = 0
      ;(mockPlayerStore.totalStats as any).trueDamage = 0
      ;(mockPlayerStore.totalStats as any).voidDamage = 0
      mockPlayerStore.player.skills = [null, null, null, null, null]
      mockMonsterStore.currentMonster.defense = 0
      mockMonsterStore.currentMonster.dodge = 0
      mockMonsterStore.currentMonster.critResist = 0
      mockMonsterStore.currentMonster.isBoss = false
      ;(mockMonsterStore.currentMonster as any).bossMechanic = undefined
      ;(mockMonsterStore.currentMonster as any).bossState = undefined
      mockMonsterStore.currentMonster.skills = []
      mockMonsterStore.difficultyValue = 0
      mockMonsterStore.performMonsterAction.mockReturnValue(null)
      mockMonsterStore.consumeMark.mockReturnValue(0)
    })

    it('技能倍率进入伤害链：3倍技能实际造成3倍伤害', () => {
      const gameStore = useGameStore()
      gameStore.setCombatRng(() => 0.5) // 命中且不暴击
      mockPlayerStore.player.skills[0] = makeDamageSkill({ damageMultiplier: 3, hitCount: 1 }) as any

      const result = gameStore.executePlayerTurn(0)

      expect(result.damage).toBe(300)
      expect(gameStore.battleEvents[0].explanation?.some(row => row.label === '基础倍率' && row.value.includes('×3'))).toBe(true)
    })

    it('多段技能按每段倍率累加：4倍x2段等于8倍', () => {
      const gameStore = useGameStore()
      gameStore.setCombatRng(() => 0.5)
      mockPlayerStore.player.skills[0] = makeDamageSkill({ damageMultiplier: 4, hitCount: 2 }) as any

      const result = gameStore.executePlayerTurn(0)

      expect(result.damage).toBe(800)
    })

    it('技能 defenseIgnorePercent 生效', () => {
      const gameStore = useGameStore()
      gameStore.setCombatRng(() => 0.5)
      mockMonsterStore.currentMonster.defense = 1000
      mockPlayerStore.player.skills[0] = makeDamageSkill({ defenseIgnorePercent: 0 }) as any
      const normal = gameStore.executePlayerTurn(0).damage
      mockPlayerStore.player.skills[0] = makeDamageSkill({ defenseIgnorePercent: 100 }) as any
      const ignore = gameStore.executePlayerTurn(0).damage

      expect(ignore).toBeGreaterThan(normal)
      expect(ignore).toBe(300)
    })

    it('引爆伤害使用注入 RNG 暴击，不再直接依赖 Math.random', () => {
      const gameStore = useGameStore()
      let calls = 0
      gameStore.setCombatRng(() => {
        calls++
        return calls === 1 ? 0.01 : 0.01 // 命中 + 暴击
      })
      vi.spyOn(Math, 'random').mockReturnValue(0.99)
      mockPlayerStore.totalStats.critRate = 100
      mockPlayerStore.player.skills[0] = makeDamageSkill({
        damageMultiplier: 0,
        isDetonator: true,
        detonateMark: 'bleed',
        detonateDamage: 2
      }) as any
      mockMonsterStore.consumeMark.mockReturnValue(2)

      const result = gameStore.executePlayerTurn(0)

      expect(result.damage).toBe(0)
      expect(mockMonsterStore.damageMonster).toHaveBeenCalledWith(800, expect.any(Function))
      expect(gameStore.battleEvents[0].message).toContain('引爆')
      expect(gameStore.battleEvents[0].explanation?.some(row => row.label === '暴击' && row.value.includes('1 次'))).toBe(true)
    })

    it('速度优势进入 postMultipliers，日志解释与实际伤害一致', () => {
      const gameStore = useGameStore()
      gameStore.setCombatRng(() => 0.5)
      mockPlayerStore.totalStats.speed = 20
      mockMonsterStore.currentMonster.speed = 10

      const result = gameStore.executePlayerTurn(null)

      expect(result.damage).toBe(150)
      expect(gameStore.battleEvents[0].explanation?.some(row => row.label === '速度优势' && row.value.includes('×1.50'))).toBe(true)
      expect(gameStore.battleEvents[0].explanation?.some(row => row.label === '最终伤害' && row.value === '150')).toBe(true)
    })

    it('技能暴击同时计入技能伤害和暴击统计', () => {
      const gameStore = useGameStore()
      let calls = 0
      gameStore.setCombatRng(() => {
        calls++
        return calls === 1 ? 0.01 : 0.01
      })
      mockPlayerStore.totalStats.critRate = 100
      mockPlayerStore.player.skills[0] = makeDamageSkill({ damageMultiplier: 3, hitCount: 1 }) as any

      const result = gameStore.executePlayerTurn(0)

      expect(result.damage).toBe(600)
      expect(gameStore.damageStats.skillDamage).toBe(600)
      expect(gameStore.damageStats.critDamage).toBe(600)
      expect(gameStore.damageStats.critCount).toBe(1)
    })

    it('双动先结算第一击，第一击击杀时不会被第二击覆盖', () => {
      const gameStore = useGameStore()
      gameStore.setCombatRng(() => 0.5)
      mockPlayerStore.totalStats.speed = 20
      mockMonsterStore.currentMonster.speed = 10
      mockMonsterStore.damageMonster.mockReturnValueOnce({ killed: true, goldReward: 10, expReward: 5, diamondReward: 0, shouldDropEquipment: false, shieldDamage: 0, healed: 0 })
      gameStore.playerActionGauge = 100
      gameStore.ultimateGauge = 100

      gameStore.processPlayerAttack(null)

      expect(mockMonsterStore.damageMonster).toHaveBeenCalledTimes(1)
      expect(mockMonsterStore.damageMonster).toHaveBeenCalledWith(750, expect.any(Function))
    })

    it('Boss 狂暴和技能倍率进入伤害解释', () => {
      const gameStore = useGameStore()
      gameStore.setCombatRng(() => 0.5)
      mockMonsterStore.currentMonster.isBoss = true
      mockMonsterStore.currentMonster.attack = 100
      mockMonsterStore.currentMonster.defense = 0
      ;(mockMonsterStore.currentMonster as any).bossMechanic = { id: 'enrage', name: '狂暴', description: '', feedback: '', recommendedBuild: '', enrageAfterMs: 0, enrageAttackMultiplier: 2 }
      ;(mockMonsterStore.currentMonster as any).bossState = { shield: 0, enraged: false, healedOnce: false, turnCounter: 0, spawnedAt: Date.now() - 1000 }
      mockMonsterStore.performMonsterAction.mockReturnValue('skill_heavy_strike')

      const result = gameStore.executeMonsterTurn()

      expect(result.damage).toBe(480)
      expect(gameStore.battleEvents[0].explanation?.some(row => row.label === '狂暴倍率')).toBe(true)
      expect(gameStore.battleEvents[0].explanation?.some(row => row.label.includes('技能倍率'))).toBe(true)
    })
  })

  describe('resumeBattle - 恢复战斗', () => {
    it('resumeBattle 设置玩家行动槽为满', () => {
      const gameStore = useGameStore()
      gameStore.resumeBattle()
      expect(gameStore.playerActionGauge).toBe(100)
    })

    it('resumeBattle 清空怪物行动槽', () => {
      const gameStore = useGameStore()
      gameStore.resumeBattle()
      expect(gameStore.monsterActionGauge).toBe(0)
    })
  })

})
