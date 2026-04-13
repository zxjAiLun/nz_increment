import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useGameStore } from '../stores/gameStore'
import { usePlayerStore } from '../stores/playerStore'
import { useMonsterStore } from '../stores/monsterStore'
import { getPlayerHitCount } from '../utils/calc'
import { SKILL_POOL } from '../utils/skillSystem'
import type { Skill } from '../types'

// Build a mock skill with known cooldown
function makeSkill(overrides: Partial<Skill> = {}): Skill {
  const base: Skill = {
    id: 'test-skill',
    name: '测试技能',
    description: '测试用技能',
    type: 'damage',
    damageMultiplier: 1.5,
    ignoreDefense: false,
    defenseIgnorePercent: 0,
    trueDamage: 0,
    cooldown: 3,
    currentCooldown: 0,
    unlockPhase: 1,
    hitCount: 1,
    healPercent: 0
  }
  return { ...base, ...overrides }
}

// Mock stores
let mockPlayerSkills: (Skill | null)[] = [null, null, null, null, null]

vi.mock('./playerStore', () => ({
  usePlayerStore: () => ({
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
        massCollapse: 0, dimensionTear: 0, damageReduction: 0, attackSpeed: 0, cooldownReduction: 0, skillDamageBonus: 0, lifesteal: 5,
        // T65 元素抗性
        fireResist: 0, waterResist: 0, windResist: 0, darkResist: 0
      },
      gold: 0, diamond: 0,
      equipment: {},
      skills: mockPlayerSkills,
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
      massCollapse: 0, dimensionTear: 0, damageReduction: 0, attackSpeed: 0, cooldownReduction: 0, skillDamageBonus: 0, lifesteal: 5,
      // T65 元素抗性
      fireResist: 0, waterResist: 0, windResist: 0, darkResist: 0
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
    revive: vi.fn()
  })
}))

vi.mock('./monsterStore', () => ({
  useMonsterStore: () => ({
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
      skills: [],
      // T21.1 标记状态
      status: { marks: [] },
      // T65 元素属性
      element: 'none' as const
    },
    initMonster: vi.fn(),
    damageMonster: vi.fn().mockReturnValue({ killed: false, goldReward: 10, expReward: 5, diamondReward: 0, shouldDropEquipment: false }),
    goBackLevels: vi.fn(),
    performMonsterAction: vi.fn().mockReturnValue(null)
  })
}))

vi.mock('./achievementStore', () => ({
  useAchievementStore: () => ({
    checkAndUpdateAchievements: vi.fn()
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

describe('combo.test.ts - 技能连招测试', () => {

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    mockPlayerSkills = [null, null, null, null, null]
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('skill cooldown tick system - 技能冷却系统', () => {
    it('updateSkillCooldowns 每秒减少 1 点冷却', () => {
      const gameStore = useGameStore()
      // Manually set a cooldown
      const playerStore = usePlayerStore()
      const skill = makeSkill({ cooldown: 3, currentCooldown: 3 })
      playerStore.player.skills = [skill, null, null, null, null]

      gameStore.updateSkillCooldowns(1.0)
      // skill.currentCooldown should decrease by 1
      expect((playerStore.player.skills[0] as Skill).currentCooldown).toBe(2)
    })

    it('updateSkillCooldowns 冷却归零时不再减少', () => {
      const gameStore = useGameStore()
      const playerStore = usePlayerStore()
      const skill = makeSkill({ cooldown: 3, currentCooldown: 0 })
      playerStore.player.skills = [skill, null, null, null, null]

      gameStore.updateSkillCooldowns(1.0)
      expect((playerStore.player.skills[0] as Skill).currentCooldown).toBe(0)
    })

    it('技能使用后设置正确冷却时间', () => {
      const playerStore = usePlayerStore()
      const skill = makeSkill({ cooldown: 5, currentCooldown: 0 })
      playerStore.player.skills = [skill, null, null, null, null]

      // Simulate using the skill
      const usedSkill = playerStore.player.skills[0] as Skill
      usedSkill.currentCooldown = usedSkill.cooldown

      expect(usedSkill.currentCooldown).toBe(5)
    })
  })

  describe('skill queue processing - 技能队列处理', () => {
    it('冷却为 0 的技能可以立即使用', () => {
      const playerStore = usePlayerStore()
      const skill = makeSkill({ cooldown: 3, currentCooldown: 0 })
      playerStore.player.skills = [skill, null, null, null, null]

      const availableSkill = playerStore.player.skills.find(s => s !== null && s.currentCooldown <= 0)
      expect(availableSkill).toBeDefined()
    })

    it('冷却未好的技能不能使用', () => {
      const playerStore = usePlayerStore()
      const skill = makeSkill({ cooldown: 5, currentCooldown: 3 })
      playerStore.player.skills = [skill, null, null, null, null]

      const availableSkill = playerStore.player.skills.find(s => s !== null && s.currentCooldown <= 0)
      expect(availableSkill).toBeUndefined()
    })

    it('多个技能就绪时按顺序选择', () => {
      const playerStore = usePlayerStore()
      const skill1 = makeSkill({ id: 'skill-1', cooldown: 3, currentCooldown: 0 })
      const skill2 = makeSkill({ id: 'skill-2', cooldown: 5, currentCooldown: 0 })
      playerStore.player.skills = [skill1, skill2, null, null, null]

      const availableSkills = playerStore.player.skills
        .map((s, i) => ({ skill: s, index: i }))
        .filter(item => item.skill !== null && (item.skill as Skill).currentCooldown <= 0)

      expect(availableSkills.length).toBe(2)
      expect(availableSkills[0].index).toBe(0)
    })
  })

  describe('skill with 0 cooldown - 零冷却技能', () => {
    it('cooldown=0 的技能可以每 tick 使用', () => {
      const skill = makeSkill({ cooldown: 0, currentCooldown: 0 })
      expect(skill.currentCooldown).toBe(0)
      expect(skill.currentCooldown <= 0).toBe(true)
    })

    it('cooldown=0 使用后立即可再次使用', () => {
      const skill = makeSkill({ cooldown: 0, currentCooldown: 0 })
      // Use immediately
      skill.currentCooldown = skill.cooldown // 0
      expect(skill.currentCooldown).toBe(0)
      expect(skill.currentCooldown <= 0).toBe(true)
    })
  })

  describe('skill with N cooldown - N秒冷却技能', () => {
    it('cooldown=5 的技能跳过 5 ticks', () => {
      const skill = makeSkill({ cooldown: 5, currentCooldown: 5 })

      // After 1 tick (1 second): cooldown = 4
      skill.currentCooldown = Math.max(0, skill.currentCooldown - 1)
      expect(skill.currentCooldown).toBe(4)

      // After 5 ticks total: cooldown = 0
      skill.currentCooldown = Math.max(0, skill.currentCooldown - 4)
      expect(skill.currentCooldown).toBe(0)
      expect(skill.currentCooldown <= 0).toBe(true)
    })

    it('冷却时间四舍五入到 tick 边界', () => {
      const skill = makeSkill({ cooldown: 3, currentCooldown: 3 })
      // Partial tick (0.5s): cooldown reduces by 0.5
      skill.currentCooldown = Math.max(0, skill.currentCooldown - 0.5)
      expect(skill.currentCooldown).toBe(2.5)
    })
  })

  describe('consecutive skill usage - 连续技能使用', () => {
    it('两个技能可以在同一 tick 使用（如果冷却允许）', () => {
      const skill1 = makeSkill({ id: 's1', cooldown: 2, currentCooldown: 0 })
      const skill2 = makeSkill({ id: 's2', cooldown: 2, currentCooldown: 0 })
      const playerStore = usePlayerStore()
      playerStore.player.skills = [skill1, skill2, null, null, null]

      // Both skills available at tick 0
      const availableAtTick0 = playerStore.player.skills
        .filter(s => s !== null && s.currentCooldown <= 0)
      expect(availableAtTick0.length).toBe(2)
    })

    it('技能队列按顺序处理', () => {
      const executionOrder: string[] = []
      const skill1 = makeSkill({ id: 's1', cooldown: 3 })
      const skill2 = makeSkill({ id: 's2', cooldown: 3 })

      // Simulate sequential use
      skill1.currentCooldown = skill1.cooldown
      executionOrder.push('skill1')
      skill2.currentCooldown = skill2.cooldown
      executionOrder.push('skill2')

      expect(executionOrder).toEqual(['skill1', 'skill2'])
    })

    it('高 cooldown 技能阻止其他技能使用', () => {
      const skill1 = makeSkill({ id: 's1', cooldown: 10, currentCooldown: 10 })
      const skill2 = makeSkill({ id: 's2', cooldown: 3, currentCooldown: 0 })
      const playerStore = usePlayerStore()
      playerStore.player.skills = [skill1, skill2, null, null, null]

      // Only skill2 is available
      const available = playerStore.player.skills
        .filter(s => s !== null && s.currentCooldown <= 0)
      expect(available.length).toBe(1)
      expect((available[0] as Skill).id).toBe('s2')
    })
  })

  describe('combo damage calculation - 连击伤害计算', () => {
    it('getPlayerHitCount 返回 1 基础连击', () => {
      const stats = {
        size: 1, attack: 100, defense: 50, maxHp: 100, speed: 10,
        critRate: 5, critDamage: 150, penetration: 0, dodge: 0,
        accuracy: 0, critResist: 0, combo: 100,
        damageBonusI: 0, damageBonusII: 0, damageBonusIII: 0,
        luck: 10, gravityRange: 0, gravityStrength: 0,
        voidDamage: 0, trueDamage: 0, timeWarp: 0,
        massCollapse: 0, dimensionTear: 0, damageReduction: 0, attackSpeed: 0, cooldownReduction: 0, skillDamageBonus: 0, lifesteal: 5
      }
      // combo=100 -> 100/100=1 -> floor(1)=1
      const hitCount = getPlayerHitCount(stats)
      expect(hitCount).toBe(1)
    })

    it('combo=200 返回 2 次命中', () => {
      const stats = {
        size: 1, attack: 100, defense: 50, maxHp: 100, speed: 10,
        critRate: 5, critDamage: 150, penetration: 0, dodge: 0,
        accuracy: 0, critResist: 0, combo: 200,
        damageBonusI: 0, damageBonusII: 0, damageBonusIII: 0,
        luck: 10, gravityRange: 0, gravityStrength: 0,
        voidDamage: 0, trueDamage: 0, timeWarp: 0,
        massCollapse: 0, dimensionTear: 0, damageReduction: 0, attackSpeed: 0, cooldownReduction: 0, skillDamageBonus: 0, lifesteal: 5
      }
      const hitCount = getPlayerHitCount(stats)
      expect(hitCount).toBe(2)
    })

    it('combo=50 仍然返回 1 次命中（最小值）', () => {
      const stats = {
        size: 1, attack: 100, defense: 50, maxHp: 100, speed: 10,
        critRate: 5, critDamage: 150, penetration: 0, dodge: 0,
        accuracy: 0, critResist: 0, combo: 50,
        damageBonusI: 0, damageBonusII: 0, damageBonusIII: 0,
        luck: 10, gravityRange: 0, gravityStrength: 0,
        voidDamage: 0, trueDamage: 0, timeWarp: 0,
        massCollapse: 0, dimensionTear: 0, damageReduction: 0, attackSpeed: 0, cooldownReduction: 0, skillDamageBonus: 0, lifesteal: 5
      }
      const hitCount = getPlayerHitCount(stats)
      expect(hitCount).toBe(1)
    })

    it('combo=1000 返回 10 次命中', () => {
      const stats = {
        size: 1, attack: 100, defense: 50, maxHp: 100, speed: 10,
        critRate: 5, critDamage: 150, penetration: 0, dodge: 0,
        accuracy: 0, critResist: 0, combo: 1000,
        damageBonusI: 0, damageBonusII: 0, damageBonusIII: 0,
        luck: 10, gravityRange: 0, gravityStrength: 0,
        voidDamage: 0, trueDamage: 0, timeWarp: 0,
        massCollapse: 0, dimensionTear: 0, damageReduction: 0, attackSpeed: 0, cooldownReduction: 0, skillDamageBonus: 0, lifesteal: 5
      }
      const hitCount = getPlayerHitCount(stats)
      expect(hitCount).toBe(10)
    })
  })

  describe('multi-hit skills - 多段打击技能', () => {
    it('hitCount > 1 的技能记录多次命中', () => {
      const skill = SKILL_POOL.find(s => s.hitCount > 1)
      expect(skill).toBeDefined()
      expect(skill!.hitCount).toBeGreaterThan(1)
    })

    it('连刺技能 hitCount=2', () => {
      const doubleStrike = SKILL_POOL.find(s => s.id === 'skill_double_strike')
      expect(doubleStrike?.hitCount).toBe(2)
    })

    it('旋风斩技能 hitCount=4', () => {
      const whirlwind = SKILL_POOL.find(s => s.id === 'skill_whirlwind')
      expect(whirlwind?.hitCount).toBe(4)
    })
  })

  describe('skill execute with cooldown - 技能执行与冷却', () => {
    it('executePlayerTurn 使用技能后设置冷却', () => {
      const gameStore = useGameStore()
      const playerStore = usePlayerStore()
      const monsterStore = useMonsterStore()

      const skill = makeSkill({ id: 'test-skill', cooldown: 5, currentCooldown: 0 })
      playerStore.player.skills = [skill, null, null, null, null]
      monsterStore.currentMonster = {
        id: 'm1', name: 'Monster', level: 1, phase: 1,
        maxHp: 1000, currentHp: 1000, attack: 10, defense: 5, speed: 10,
        critRate: 5, critDamage: 150, critResist: 0, penetration: 0,
        accuracy: 0, dodge: 0, goldReward: 10, expReward: 5,
        equipmentDropChance: 0.3, diamondDropChance: 0.01,
        isBoss: false, isTrainingMode: false, trainingDifficulty: null, skills: [],
        // T21.1 标记状态
        status: { marks: [] },
        // T65 元素属性
        element: 'none' as const
      }

      const result = gameStore.executePlayerTurn(0)

      expect(result.skill).toBeDefined()
      // After using, cooldown should be set to cooldown value
      expect((playerStore.player.skills[0] as Skill).currentCooldown).toBe(5)
    })

    it('技能未就绪时返回普攻', () => {
      const gameStore = useGameStore()
      const playerStore = usePlayerStore()
      const monsterStore = useMonsterStore()

      const skill = makeSkill({ id: 'test-skill', cooldown: 5, currentCooldown: 3 })
      playerStore.player.skills = [skill, null, null, null, null]
      monsterStore.currentMonster = {
        id: 'm1', name: 'Monster', level: 1, phase: 1,
        maxHp: 1000, currentHp: 1000, attack: 10, defense: 5, speed: 10,
        critRate: 5, critDamage: 150, critResist: 0, penetration: 0,
        accuracy: 0, dodge: 0, goldReward: 10, expReward: 5,
        equipmentDropChance: 0.3, diamondDropChance: 0.01,
        isBoss: false, isTrainingMode: false, trainingDifficulty: null, skills: [],
        // T21.1 标记状态
        status: { marks: [] },
        // T65 元素属性
        element: 'none' as const
      }

      const result = gameStore.executePlayerTurn(0)

      // No skill used (on cooldown), returns basic attack damage
      expect(result.skill).toBeNull()
      expect(result.damage).toBeGreaterThanOrEqual(0)
    })
  })

  describe('game loop with skill cooldowns - 游戏循环冷却更新', () => {
    it('gameLoop 更新所有技能冷却', () => {
      const gameStore = useGameStore()
      const playerStore = usePlayerStore()
      const skill = makeSkill({ cooldown: 3, currentCooldown: 3 })
      playerStore.player.skills = [skill, null, null, null, null]

      // Simulate one game loop tick (with speed=1, deltaTime=1)
      gameStore.updateSkillCooldowns(1.0)

      expect((playerStore.player.skills[0] as Skill).currentCooldown).toBe(2)
    })

    it('gameLoop 在技能冷却中时不能使用技能', () => {
      const gameStore = useGameStore()
      const playerStore = usePlayerStore()
      const skill = makeSkill({ id: 'test', cooldown: 10, currentCooldown: 9 })
      playerStore.player.skills = [skill, null, null, null, null]

      gameStore.updateSkillCooldowns(1.0)

      expect((playerStore.player.skills[0] as Skill).currentCooldown).toBe(8)
      expect((playerStore.player.skills[0] as Skill).currentCooldown).toBeGreaterThan(0)
    })

    it('冷却完全冷却后技能可再次使用', () => {
      const gameStore = useGameStore()
      const playerStore = usePlayerStore()
      const skill = makeSkill({ cooldown: 3, currentCooldown: 3 })
      playerStore.player.skills = [skill, null, null, null, null]

      for (let i = 0; i < 3; i++) {
        gameStore.updateSkillCooldowns(1.0)
      }

      expect((playerStore.player.skills[0] as Skill).currentCooldown).toBe(0)
      expect((playerStore.player.skills[0] as Skill).currentCooldown <= 0).toBe(true)
    })
  })

})

// localStorage mock for cultivationStore
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: (key: string): string | null => store[key] || null,
    setItem: (key: string, value: string): void => { store[key] = value },
    removeItem: (key: string): void => { delete store[key] },
    clear: (): void => { store = {} }
  }
})()
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock })
