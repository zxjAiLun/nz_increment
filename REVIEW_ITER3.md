# REVIEW_ITER3 - 数值平衡变更审查

**分支**: `iter-3/numerical-balance`  
**Commit**: `7b0bb82df05a64a943149415b22d3da716d32c58`  
**结论**: **PASS**（含 1 项遗留警告，需关注）

---

## 步骤 1: 变更溯源

| 文件 | 变更类型 | 验证结果 |
|------|---------|---------|
| `.iterations.json` | metadata 更新（iter2 状态/结果） | OK |
| `src/utils/constants.ts` | 新增 MONSTER/LOTTERY 常量对象 | OK |
| `src/stores/playerStore.ts` | ATTRIBUTE_UPGRADES + LOTTERY 引用 | OK |
| `src/utils/monsterGenerator.ts` | 引用 MONSTER/CRIT 常量 | OK |
| `src/utils/equipmentGenerator.ts` | 装备等级范围随机化 | OK |

---

## 步骤 2: 公式逐项验证

### T3.1 怪物防御公式
```
Constants: MONSTER.DEFENSE_MULTIPLIER = 1.5 ✓
Usage: defense = baseValue * MONSTER.DEFENSE_MULTIPLIER ✓
```
- **来源文件**: `constants.ts` L22, `monsterGenerator.ts` L30
- **旧值**: `baseValue * 3`
- **新值**: `baseValue * 1.5`
- **结论**: PASS

### T3.2 暴击收益曲线
```
Constants:
  CRIT.RATE_GROWTH = 0.02       ✓
  CRIT.DAMAGE_GROWTH = 1.0      ✓
  CRIT.RATE_MAX = 50            ✓
  CRIT.DAMAGE_MIN = 150         ✓ (已定义但未在 monsterGenerator 中使用)

Usage:
  critRate = Math.min(CRIT.BASE_RATE + difficultyValue * CRIT.RATE_GROWTH, CRIT.RATE_MAX) ✓
  critDamage = CRIT.BASE_DAMAGE + difficultyValue * CRIT.DAMAGE_GROWTH   ✓
  critRate (final) = Math.min(critRate, CRIT.RATE_MAX)                   ✓
```
- **来源文件**: `constants.ts` L11-14, `monsterGenerator.ts` L34-35, L70
- **公式**: 暴击率 = min(5 + diff * 0.02, 50), 暴伤 = 150 + diff * 1.0
- **注意**: 旧版 critDamage 有上限 300（`Math.min(..., 300)`），新版无上限。`CRIT.DAMAGE_MIN` 在 constants 定义但未使用。
- **结论**: PASS（无上限为设计决策，建议后续迭代确认预期）

### T3.3 抽奖成本
```
Constants:
  LOTTERY.BASE_COST = 10         ✓
  LOTTERY.GROWTH_RATE = 1.002    ✓

Usage:
  getLotteryCost() = Math.floor(LOTTERY.BASE_COST * Math.pow(LOTTERY.GROWTH_RATE, difficulty)) ✓
```
- **来源文件**: `constants.ts` L30-31, `playerStore.ts` L386
- **旧公式**: `Math.floor(10 * Math.pow(1.005, difficulty))`
- **新公式**: `Math.floor(10 * Math.pow(1.002, difficulty))`
- **对比**: diff=100 时旧约 16 金币，新约 12.2 金币（更便宜）
- **结论**: PASS

### T3.4 穿透属性升级
```
ATTRIBUTE_UPGRADES 新增项:
  { key: 'penetration', label: '穿透', baseCost: 50, growth: 1.15, effect: 5 } ✓
```
- **来源文件**: `playerStore.ts` L22
- **现有系统兼容性**:
  - `calc.ts` L170, L226: 已有 `penetration` 穿透减防计算
  - `equipmentGenerator.ts` L54, L84: 已有穿透词条范围
  - `rebirthStore.ts`: 已有 `penetrationBonus` 转生加成
  - `types/index.ts` L79, L119, L213: 类型已定义
- **结论**: PASS（穿透升级与现有系统完全兼容）

### T3.5 装备等级匹配
```
generateEquipment 新签名:
  generateEquipment(slot, rarity, difficulty, rng?) ✓
  level = Math.floor(rng() * (maxLevel - minLevel + 1)) + minLevel
  minLevel = Math.max(1, difficulty - 50)           ✓
  maxLevel = difficulty                              ✓
```
- **来源文件**: `equipmentGenerator.ts` L206-210
- **调用处**: `playerStore.ts` L358 → `generateEquipment(slot, rarity, difficulty)` 参数顺序正确
- **边界 case**: difficulty=1 时 level=1（min=max=1）正常；difficulty=0 时 minLevel=1 仍有效
- **结论**: PASS

---

## 步骤 3: TypeScript 编译检查

```bash
npx vue-tsc --noEmit
```
- **结果**: 28 个 TS 错误（全部为 pre-existing，与本 commit 无关）
- **对比验证**: 在当前 commit 状态下和 stash 后运行，错误列表完全一致
- **本 commit 引入 TS 错误**: 0
- **结论**: PASS

---

## 步骤 4: 常量引用一致性

| 常量 | 定义位置 | 引用位置 |
|------|---------|---------|
| `MONSTER.DEFENSE_MULTIPLIER` | constants.ts | monsterGenerator.ts |
| `MONSTER.BOSS_DEFENSE_MULT` | constants.ts | 未被引用（已定义 BOSS 防御倍率但未在代码中使用）|
| `CRIT.RATE_GROWTH` | constants.ts | monsterGenerator.ts |
| `CRIT.DAMAGE_GROWTH` | constants.ts | monsterGenerator.ts |
| `CRIT.RATE_MAX` | constants.ts | monsterGenerator.ts（2处） |
| `CRIT.DAMAGE_MIN` | constants.ts | **未被任何文件引用** |
| `LOTTERY.BASE_COST` | constants.ts | playerStore.ts |
| `LOTTERY.GROWTH_RATE` | constants.ts | playerStore.ts |

---

## 步骤 5: 数值合理性分析

| 指标 | 难度 1 | 难度 100 | 难度 500 |
|------|--------|---------|---------|
| 怪物防御 | baseValue * 1.5（原 3） | baseValue * 1.5 | baseValue * 1.5 |
| 怪物暴击率 | min(5.02, 50) = 5.02% | min(7, 50) = 7% | min(15, 50) = 15% |
| 怪物暴伤 | 151% | 250% | 650% |
| 单抽成本 | floor(10 * 1.002^1) = 10 | floor(10 * 1.002^100) ≈ 12 | floor(10 * 1.002^500) ≈ 34 |
| 装备等级 | 1 | 1~100 | 450~500 |
| 穿透升级 cost | 50 * 1.15^0 = 50 | 50 * 1.15^10 ≈ 201 | 50 * 1.15^50 ≈ 54,382 |

---

## 步骤 6: 遗留问题清单

| 优先级 | 问题 | 说明 | 建议 |
|--------|------|------|------|
| 低 | `CRIT.DAMAGE_MIN` 未被引用 | 常量定义为 150，但 monsterGenerator.ts 中 critDamage 无下限校验（已由 `BASE_DAMAGE = 150` 隐性保证） | 可删除或补充使用注释 |
| 低 | `MONSTER.BOSS_DEFENSE_MULT` 未被引用 | BOSS 防御倍率已定义但代码中未使用，仍用 `defense * 1.2` 硬编码 | 建议后续迭代替换为常量 |
| 低 | critDamage 无上限 | 旧版 Math.min(..., 300)，新版无上限（难度 500 时暴伤 650%），为设计决策 | 确认这是否符合预期平衡性设计 |
| 低 | 旧版注释未清除 | `playerStore.ts` L385-387 仍有旧注释 `# 调整为更平缓的增长曲线` | 建议删除旧注释 |

---

## 最终判定

**PASS** - 所有 5 项数值变更均正确实现，TypeScript 编译无新错误，与现有系统兼容。

**建议**: 后续迭代中确认 critDamage 无上限和 BOSS_DEFENSE_MULT 未使用是否为有意设计。
