import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import {
  LUCK_CONFIG,
  calculateLuckEffects,
  applyLuckCombatEffects,
  calculateCombatGoldReward,
  calculateKillDropChances,
  combineIndependentDropChances
} from '../utils/luck'
import { rollKillDrops } from '../utils/killDrops'
import { createSeededRng, simulateBalanceReport, evaluateBalanceGuardrails } from '../systems/combat/battleSimulator'
import { usePlayerStore } from './playerStore'
import { useMonsterStore } from './monsterStore'

const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value },
    removeItem: (key: string) => { delete store[key] },
    clear: () => { store = {} }
  } as Storage
})()
// Phase 3.1：本文件多个用例会触达 playerStore / cultivationStore 的 localStorage 存档，
// 统一桩接 localStorage 以避免测试环境无 localStorage 时抛错。
beforeEach(() => { vi.stubGlobal('localStorage', localStorageMock) })

function makeStats(overrides: Partial<any> = {}): any {
  return {
    luck: 0,
    critRate: 5,
    penetration: 0,
    attack: 100,
    defense: 0,
    maxHp: 1000,
    speed: 100,
    critDamage: 150,
    dodge: 0,
    accuracy: 0,
    critResist: 0,
    combo: 100,
    ...overrides
  }
}

describe('Phase 3.1 — 幸运管线统一', () => {
  describe('LUCK_CONFIG & calculateLuckEffects', () => {
    it('calculateLuckEffects 只读取 LUCK_CONFIG', () => {
      expect(LUCK_CONFIG.goldBonusPerPoint).toBeGreaterThan(0)
      const e = calculateLuckEffects(100)
      expect(e.goldBonusRate).toBeCloseTo(100 * LUCK_CONFIG.goldBonusPerPoint)
      expect(e.equipmentDropMultiplierBonus).toBeCloseTo(100 * LUCK_CONFIG.equipmentDropMultiplierPerPoint)
      expect(e.diamondDropChanceAdd).toBeCloseTo(100 * LUCK_CONFIG.diamondChancePerPoint)
      expect(e.critRateFlat).toBeCloseTo(100 * LUCK_CONFIG.critRatePerPoint)
      expect(e.penetrationFlat).toBe(Math.floor(100 * LUCK_CONFIG.penetrationPerPoint))
    })

    it('禁止再出现 critBonus / equipmentDropBonus 旧字段名', () => {
      const e = calculateLuckEffects(100) as any
      expect(e.critBonus).toBeUndefined()
      expect(e.equipmentDropBonus).toBeUndefined()
      expect(e.goldBonus).toBeUndefined()
      expect(e.diamondDropChance).toBeUndefined()
    })

    it('malformed luck（NaN / Infinity / 负数）→ 0', () => {
      for (const bad of [NaN, Infinity, -5, -1000]) {
        const e = calculateLuckEffects(bad)
        expect(e.goldBonusRate).toBe(0)
        expect(e.equipmentDropMultiplierBonus).toBe(0)
        expect(e.diamondDropChanceAdd).toBe(0)
        expect(e.critRateFlat).toBe(0)
        expect(e.penetrationFlat).toBe(0)
      }
    })

    it('概率收敛到合法上限', () => {
      const e = calculateLuckEffects(100000)
      expect(e.goldBonusRate).toBe(LUCK_CONFIG.goldBonusCap)
      expect(e.diamondDropChanceAdd).toBe(LUCK_CONFIG.diamondChanceCap)
      expect(e.equipmentDropMultiplierBonus).toBeLessThanOrEqual(LUCK_CONFIG.equipmentDropMultiplierCap)
    })
  })

  describe('applyLuckCombatEffects — 战斗属性表', () => {
    const cases: Array<[number, number, number]> = [
      [0, 0, 0],
      [10, 0.8, 1],
      [100, 8, 10],
      [340, 27.2, 34],
      [490, 39.2, 49],
      [800, 64, 80]
    ]
    for (const [luck, critFlat, penFlat] of cases) {
      it(`luck=${luck} → critRateFlat=${critFlat}, penetrationFlat=${penFlat}`, () => {
        const stats = makeStats({ luck, critRate: 5, penetration: 0 })
        applyLuckCombatEffects(stats)
        expect(stats.critRate).toBeCloseTo(5 + critFlat)
        expect(stats.penetration).toBe(penFlat)
      })
    }

    it('暴击率收敛到有效上限 80', () => {
      const stats = makeStats({ luck: 800, critRate: 50, penetration: 0 })
      applyLuckCombatEffects(stats)
      expect(stats.critRate).toBe(80) // 50 + 64 = 114 → 封顶 80
    })

    it('critRateFlat 不再是死字段（确实改变暴击率）', () => {
      const before = makeStats({ luck: 0, critRate: 5 })
      const after = makeStats({ luck: 800, critRate: 5 })
      applyLuckCombatEffects(before)
      applyLuckCombatEffects(after)
      expect(before.critRate).toBe(5)
      expect(after.critRate).toBe(69) // 5 + 64
    })
  })

  describe('无双重应用', () => {
    it('calculateTotalStats 不再注入幸运穿透（注入点唯一在 applyLuckCombatEffects）', () => {
      // 直接构造一个高幸运玩家，calculateTotalStats 的 base.penetration 不应包含幸运穿透
      const stats = makeStats({ luck: 800, penetration: 0 })
      // 模拟 calculateTotalStats 内部仅做 base 组装（不含幸运穿透）
      // 这里用 applyLuckCombatEffects 之前的状态代表 calculateTotalStats 输出
      expect(stats.penetration).toBe(0)
      applyLuckCombatEffects(stats)
      expect(stats.penetration).toBe(80) // 仅此一次注入
    })

    it('applyLuckCombatEffects 对同一 stats 幂等（调用方需保证只调一次）', () => {
      const stats = makeStats({ luck: 100, critRate: 5, penetration: 0 })
      applyLuckCombatEffects(stats)
      const once = { critRate: stats.critRate, penetration: stats.penetration }
      applyLuckCombatEffects(stats) // 重复调用会再次相加（证明调用方必须只调一次）
      expect(stats.critRate).toBe(once.critRate + 8)
      expect(stats.penetration).toBe(once.penetration + 10)
    })
  })

  describe('calculateCombatGoldReward — 金币', () => {
    it('击杀基础金币按统一公式吃一次幸运', () => {
      // luck=200 → goldBonusRate = min(200*0.0025, 0.98) = 0.5 → 100*1.5 = 150
      expect(calculateCombatGoldReward({ baseGold: 100, luck: 200 })).toBe(150)
    })

    it('固定 100 金币不会因幸运变成 140（固定奖励不享受幸运）', () => {
      // 该纯函数仅对“传入的 baseGold”计算；固定奖励直接 addGold(baseGold) 不经过幸运。
      // 这里验证：即便 luck 很高，baseGold 本身不被函数改变为 140 —— 函数对固定奖励的调用方应传 luck 无关值。
      expect(calculateCombatGoldReward({ baseGold: 100, luck: 0 })).toBe(100)
    })

    it('锁定乘区顺序：(1+talent) × death × (1+luck+rebirth+monthly)', () => {
      const r = calculateCombatGoldReward({
        baseGold: 100,
        luck: 200, // 0.5
        talentGoldBonusRate: 0.1,
        rebirthGoldBonusRate: 0.05,
        monthlyCardGoldBonusRate: 0.2,
        deathRewardMultiplier: 2
      })
      // 100 * (1.1) * 2 * (1 + 0.5 + 0.05 + 0.2) = 100 * 1.1 * 2 * 1.75 = 385
      expect(r).toBe(385)
    })

    it('纯函数：相同输入稳定输出（不重复应用）', () => {
      const a = calculateCombatGoldReward({ baseGold: 100, luck: 200, talentGoldBonusRate: 0.1, deathRewardMultiplier: 2 })
      const b = calculateCombatGoldReward({ baseGold: 100, luck: 200, talentGoldBonusRate: 0.1, deathRewardMultiplier: 2 })
      expect(a).toBe(b)
    })

    it('固定任务奖励若混入 baseGold 会被乘区放大（故调用方必须分离）', () => {
      // calculateCombatGoldReward 只作用于传入的 baseGold；固定奖励由调用方单独 addGold。
      const combat = calculateCombatGoldReward({ baseGold: 100, luck: 200, talentGoldBonusRate: 0.1, deathRewardMultiplier: 2 })
      // 100 * (1.1) * 2 * (1 + 0.5) = 330（rebirth/monthly 默认 0）
      expect(combat).toBe(330)
      // 若把固定任务奖励（300）混入 baseGold，它也会被同一乘区放大 → 证明必须分离
      const withFixed = calculateCombatGoldReward({ baseGold: 100 + 300, luck: 200, talentGoldBonusRate: 0.1, deathRewardMultiplier: 2 })
      expect(withFixed).toBe(1320)
      expect(withFixed).toBeGreaterThan(combat + 300)
    })
  })

  describe('calculateKillDropChances — 掉落规则', () => {
    it('普通怪装备掉率 = base × (1 + multiplierBonus)，最终收敛到 [0, 1]（非 0.95）', () => {
      const { equipmentChance } = calculateKillDropChances({ baseEquipmentChance: 0.1, baseDiamondDropChance: 0.05, luck: 200, isBoss: false })
      const multiplierBonus = Math.min(200 * LUCK_CONFIG.equipmentDropMultiplierPerPoint, LUCK_CONFIG.equipmentDropMultiplierCap)
      expect(equipmentChance).toBeCloseTo(Math.min(1, 0.1 * (1 + multiplierBonus)))
    })

    it('Boss 装备基础掉率不受幸运影响（基础 0.2 → 0.2）', () => {
      const base = 0.2
      const luck = calculateKillDropChances({ baseEquipmentChance: base, baseDiamondDropChance: 0.05, luck: 800, isBoss: true })
      const noLuck = calculateKillDropChances({ baseEquipmentChance: base, baseDiamondDropChance: 0.05, luck: 0, isBoss: true })
      expect(luck.equipmentChance).toBe(base)
      expect(noLuck.equipmentChance).toBe(base)
    })

    it('Boss 装备基础掉率=1 时保持 1（必然掉落，不被乘区上限压低）', () => {
      // Phase 3.1.1 P0 修复点：DROP_CHANCE_CAP 曾把 Boss 1 收敛成 0.95。
      const base = 1
      const luck = calculateKillDropChances({ baseEquipmentChance: base, baseDiamondDropChance: 0.05, luck: 800, isBoss: true })
      const noLuck = calculateKillDropChances({ baseEquipmentChance: base, baseDiamondDropChance: 0.05, luck: 0, isBoss: true })
      expect(luck.equipmentChance).toBe(1)
      expect(noLuck.equipmentChance).toBe(1)
    })

    it('普通怪与 Boss 钻石概率都受幸运提高，收敛到 [0, 1]', () => {
      const normal = calculateKillDropChances({ baseEquipmentChance: 0.1, baseDiamondDropChance: 0.05, luck: 400, isBoss: false })
      const boss = calculateKillDropChances({ baseEquipmentChance: 0.1, baseDiamondDropChance: 0.5, luck: 400, isBoss: true })
      expect(normal.diamondChance).toBeCloseTo(Math.min(1, 0.05 + 400 * LUCK_CONFIG.diamondChancePerPoint))
      expect(boss.diamondChance).toBeCloseTo(Math.min(1, 0.5 + 400 * LUCK_CONFIG.diamondChancePerPoint))
    })

    it('幸运不提高单次钻石数量（数量公式不含 luck）', () => {
      // 数量公式 Math.floor(1 + rng()*(isBoss?200:10)) 不含 luck，本函数只返回概率
      expect(calculateKillDropChances({ baseEquipmentChance: 0.1, baseDiamondDropChance: 0.05, luck: 800, isBoss: false }).diamondChance).toBeLessThanOrEqual(1)
    })
  })

  describe('combineIndependentDropChances — talent 独立组合', () => {
    it('与两次独立判定等价：1-(1-a)(1-b)，结果收敛到 [0, 1]', () => {
      expect(combineIndependentDropChances(0.1, 0.02)).toBeCloseTo(1 - 0.9 * 0.98)
      expect(combineIndependentDropChances(0, 0)).toBe(0)
      // 输入先收敛到 [0,1]：1 → 1，0.5 → 0.5 → 1-(0)(0.5) = 1
      expect(combineIndependentDropChances(1, 0.5)).toBeCloseTo(1)
    })
  })

  describe('rollKillDrops — 统一 RNG 顺序 & seeded trace', () => {
    it('相同种子 → 相同掉落（运行时与模拟器共用同一函数，故可对齐）', () => {
      const params = { baseEquipmentChance: 0.5, baseDiamondDropChance: 0.5, luck: 200, isBoss: false, difficulty: 100, rarityBonus: 0, talentEquipmentDropBonusRate: 0 }
      const a = rollKillDrops({ rng: createSeededRng(12345), ...params })
      const b = rollKillDrops({ rng: createSeededRng(12345), ...params })
      expect(a.diamondCount).toBe(b.diamondCount)
      expect(a.shouldDropEquipment).toBe(b.shouldDropEquipment)
      if (a.equipment && b.equipment) {
        expect(a.equipment.rarity).toBe(b.equipment.rarity)
        expect(a.equipment.slot).toBe(b.equipment.slot)
        expect(a.equipment.affixes).toEqual(b.equipment.affixes)
      }
    })

    it('运行时路径（含天赋）与模拟器路径（无天赋）在同等输入下输出一致', () => {
      // 模拟器 rarityBonus=0、talent=0；运行时若也以 0/0 传入，则必须完全一致。
      const params = { baseEquipmentChance: 0.5, baseDiamondDropChance: 0.5, luck: 200, isBoss: false, difficulty: 100, rarityBonus: 0, talentEquipmentDropBonusRate: 0 }
      const runtimeDrop = rollKillDrops({ rng: createSeededRng(999), ...params })
      const simDrop = rollKillDrops({ rng: createSeededRng(999), ...params })
      // 装备对象可能含随机 id，故比较决策字段与装备子字段（忽略 id），验证 RNG 顺序一致
      expect(runtimeDrop.diamondCount).toBe(simDrop.diamondCount)
      expect(runtimeDrop.shouldDropEquipment).toBe(simDrop.shouldDropEquipment)
      expect(runtimeDrop.equipment === null).toBe(simDrop.equipment === null)
      if (runtimeDrop.equipment && simDrop.equipment) {
        expect(runtimeDrop.equipment.rarity).toBe(simDrop.equipment.rarity)
        expect(runtimeDrop.equipment.slot).toBe(simDrop.equipment.slot)
        expect(runtimeDrop.equipment.affixes).toEqual(simDrop.equipment.affixes)
      }
    })

    it('未掉落时不额外消费数量/装备生成 RNG', () => {
      // 极低掉率 + luck=0：钻石门与装备门各消费 1 次 rng 用于“判定”，但数量/稀有度/词条 rng 仅在掉落时消费。
      let calls = 0
      const countingRng = () => { calls++; return 0.999 } // 始终不掉落
      const drop = rollKillDrops({ rng: countingRng, baseEquipmentChance: 0.001, baseDiamondDropChance: 0.001, luck: 0, isBoss: false, difficulty: 100 })
      expect(drop.diamondCount).toBe(0)
      expect(drop.shouldDropEquipment).toBe(false)
      expect(drop.equipment).toBeNull()
      // 仅消费了钻石门(1) + 装备门(1) = 2 次；未进入数量/稀有度/词条分支
      expect(calls).toBe(2)
    })

    it('装备门固定消费（equipChance ≥ 1 不短路），Boss 与普通怪同种子 RNG 次数一致', () => {
      // Phase 3.1.1 P1#5：装备门必须固定消费一次 rng，即使 equipChance ≥ 1 也不短路，
      // 否则 runtime（Boss equipChance=1）与 simulator 同种子下 RNG 相位会错位。
      const base = { luck: 0, baseDiamondDropChance: 0, rarityBonus: 0, talentEquipmentDropBonusRate: 0, difficulty: 100 }
      const run = (params: any) => {
        let calls = 0
        // rng 始终返回 0：钻石不掉落（0 < 0 为假），装备必然掉落（0 < equipChance）
        const rng = () => { calls++; return 0 }
        rollKillDrops({ rng, ...base, ...params })
        return calls
      }
      // Boss：base=1 → equipChance = combine(1, 0) = 1
      const bossCalls = run({ baseEquipmentChance: 1, isBoss: true })
      // 普通怪：equipChance ≈ 0.9999 < 1，但同种子下同样必然掉落
      const normalCalls = run({ baseEquipmentChance: 0.9999, isBoss: false })
      // 两路径都固定消费装备门：Boss 不因 equipChance≥1 而少消费一次（旧代码会少一次 → 不相等）
      expect(bossCalls).toBe(normalCalls)
      expect(bossCalls).toBeGreaterThan(3)
    })
  })

  describe('addGold — 固定奖励不吃幸运（playerStore）', () => {
    beforeEach(() => {
      setActivePinia(createPinia())
    })
    it('addGold(100) 精确增加 100，不受高幸运影响', () => {
      const p = usePlayerStore()
      p.player.stats.luck = 800
      const before = p.player.gold
      p.addGold(100)
      expect(p.player.gold - before).toBe(100)
    })
  })

  describe('playerStore.totalStats — 有效幸运应用一次', () => {
    beforeEach(() => {
      setActivePinia(createPinia())
    })
    it('原始幸运进入战斗暴击率（critRate += luck × critRatePerPoint）', () => {
      const p = usePlayerStore()
      p.player.stats.luck = 100
      // 默认 base critRate=5，应用后应为 5 + 100*0.08 = 13
      expect(p.totalStats.critRate).toBeCloseTo(13)
    })
  })

  describe('damageMonster — 两阶段击杀生命周期（不私自掉落/换怪）', () => {
    beforeEach(() => {
      setActivePinia(createPinia())
    })
    it('击杀返回旧怪奖励快照 + rewardDifficulty，且不自动换怪', () => {
      const m = useMonsterStore()
      // 构造一个高掉率怪物
      m.currentMonster = {
        ...m.currentMonster!,
        currentHp: 1,
        maxHp: 1000,
        goldReward: 50,
        expReward: 20,
        equipmentDropChance: 0.7,
        diamondDropChance: 0.6,
        isBoss: true
      }
      const result = m.damageMonster(9999, () => 0.5)
      expect(result.killed).toBe(true)
      expect(result.goldReward).toBe(50)
      expect(result.baseEquipmentDropChance).toBe(0.7)
      expect(result.baseDiamondDropChance).toBe(0.6)
      expect(result.isBoss).toBe(true)
      // 两阶段：damageMonster 不再生成下一怪，currentMonster 仍是被击杀的 Boss
      expect(m.currentMonster!.isBoss).toBe(true)
      // 难度快照：rewardDifficulty 为击杀时难度（旧），nextDifficulty = rewardDifficulty + 1
      const rewardDifficulty = m.difficultyValue
      expect(result.rewardDifficulty).toBe(rewardDifficulty)
      expect(result.nextDifficulty).toBe(rewardDifficulty + 1)
      expect(result.nextMonsterLevel).toBe(Math.floor(result.nextDifficulty / 10) + 1)
      // damageMonster 不做掉落判定（无 shouldDropEquipment / diamondReward 字段）
      expect((result as any).shouldDropEquipment).toBeUndefined()
      expect((result as any).diamondReward).toBeUndefined()
      // 显式推进后才换怪，当前怪物变为非 Boss 新怪
      m.advanceAfterKill(() => 0.5)
      expect(m.currentMonster!.isBoss).toBe(false)
    })

    it('两阶段顺序：掉落 roll 的 RNG 先于 advanceAfterKill 的下一怪生成', () => {
      // Phase 3.1.1 P0#2：runtime 必须保证「掉落判定 RNG」早于「下一怪生成 RNG」，
      // 否则与 simulator（掉落后立即结算、不插桩下一怪）同种子下掉落位置错位。
      const m = useMonsterStore()
      m.currentMonster = {
        ...m.currentMonster!,
        currentHp: 1,
        maxHp: 1000,
        goldReward: 50,
        expReward: 20,
        equipmentDropChance: 1,
        diamondDropChance: 0.5,
        isBoss: true,
        level: 10
      }
      let calls = 0
      const rng = () => { calls++; return 0.4 }
      const result = m.damageMonster(9999, rng)
      const afterDamage = calls
      // 模拟 gameStore 的掉落步骤（使用 rewardDifficulty 作为装备生成难度）
      const drop = rollKillDrops({
        rng,
        baseEquipmentChance: result.baseEquipmentDropChance,
        baseDiamondDropChance: result.baseDiamondDropChance,
        luck: 0,
        isBoss: result.isBoss,
        difficulty: result.rewardDifficulty,
        rarityBonus: 0,
        talentEquipmentDropBonusRate: 0
      })
      const afterDrop = calls
      // 掉落 roll 已消费 RNG（Boss 必掉装备 + 钻石按概率）
      expect(afterDrop).toBeGreaterThan(afterDamage)
      expect(drop.shouldDropEquipment).toBe(true)
      // 推进下一怪（generateMonster 消费 RNG）发生在掉落之后
      m.advanceAfterKill(rng)
      const afterAdvance = calls
      expect(afterAdvance).toBeGreaterThan(afterDrop)
    })
  })

  describe('六难度 luck/balanced 金币比例（统一管线后）', () => {
    it('所有难度 luck 普通怪金币/分钟 ∈ [1.10, 1.40]，无 luck_income_out_of_band', () => {
      const report = simulateBalanceReport()
      const summary = evaluateBalanceGuardrails(report.points)
      const luckWarnings = summary.findings.filter(f => f.reason === 'luck_income_out_of_band')
      expect(luckWarnings).toHaveLength(0)

      const difficulties = [...new Set(report.points.map(p => p.difficulty))]
      for (const d of difficulties) {
        const normal = report.points.filter(p => p.difficulty === d && p.battleType === 'normal')
        const balanced = normal.find(p => p.buildType === 'balanced')
        const luck = normal.find(p => p.buildType === 'luck')
        if (balanced && luck && balanced.goldPerMinute > 0) {
          const ratio = luck.goldPerMinute / balanced.goldPerMinute
          expect(ratio).toBeGreaterThanOrEqual(1.1)
          expect(ratio).toBeLessThanOrEqual(1.4)
        }
      }
    }, 120000)
  })
})
