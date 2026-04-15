# REVIEW_ITER18.md

**分支**: `iter-18/seasonal-content` | **Commit**: `260644c9` | **日期**: 2026-04-10

---

## 变更摘要

- T18.1: lifesteal 从 luck 解绑，成为独立属性
- T18.2: calculateLifestealCap 上限15%，gameStore 应用独立 lifesteal
- T18.3: calculateCritRate 分段函数，critDamage 线性成长
- T18.4: 防御线性成长，穿透线性

---

## 审查结果

### T18.1: lifesteal 独立属性 ✅ PASS

| 检查项 | 位置 | 结果 |
|--------|------|------|
| `PlayerStats.lifesteal` 类型定义 | `src/types/index.ts:191` | `lifesteal: number // 0-15` |
| gameStore 获取 lifesteal | `src/stores/gameStore.ts:762` | `playerStore.totalStats.lifesteal`（非 luck） |

**结论**: 正确从 luck 解绑，独立字段存在于类型定义和 store 引用中。

---

### T18.2: calculateLifestealCap 上限15% ✅ PASS

| 检查项 | 代码 | 结果 |
|--------|------|------|
| `calculateLifestealCap` | `Math.min(baseLifesteal, 15)` | ✅ 上限 15% |
| gameStore 应用 | `gameStore.ts:762` 调用 `calculateLifestealCap` | ✅ |

**结论**: 实现正确。

---

### T18.3: 暴击曲线 ✅ PASS

**`calculateCritRate`** (`src/utils/calc.ts:169`):
```typescript
if (difficulty < 500) {
  return Math.min(5 + Math.floor(difficulty / 10), 50)
} else {
  return Math.min(50 + Math.floor((difficulty - 500) / 50), 80)
}
```
- d<500: +1%/10难度，起始5%，上限50% ✅
- d>=500: +1%/50难度，上限80% ✅

**`calculateCritDamage`** (`src/utils/calc.ts:181`):
```typescript
return Math.min(150 + Math.floor(difficulty * 0.05), 300)
```
- 150 + d*0.05，上限300 ✅

**结论**: 两函数均符合规格。

---

### T18.4: 防御/穿透线性成长 ⚠️ PARTIAL FAIL

**防御** (`src/utils/monsterGenerator.ts:30-31`):
```typescript
const baseDef = 20
const monsterDef = Math.floor(baseDef * (1 + difficultyValue * 0.02))
```
- 公式: `20 * (1 + d*0.02)` = `20 + d*0.4`
- 规格: `base*1 + d*0.02` → `20 + d*0.02`
- **问题**: 系数 0.4 与规格不符，成长速度是预期的 20 倍

**穿透** (`src/utils/monsterGenerator.ts:34`):
```typescript
const basePenetration = difficultyValue * 0.05
```
- 代码: `d * 0.05`
- 规格: `d * 0.1`
- **问题**: 穿透值是规格的一半

---

## 最终判定

| 变更点 | 结论 |
|--------|------|
| T18.1 lifesteal 独立 | ✅ PASS |
| T18.2 lifestealCap 15% | ✅ PASS |
| T18.3 critRate/critDamage 曲线 | ✅ PASS |
| T18.4 defense 线性成长 | ⚠️ 系数偏差（0.4 vs 0.02，差20倍） |
| T18.4 penetration 线性成长 | ⚠️ 数值偏差（0.05 vs 0.1，差2倍） |

**综合结论**: **PARTIAL PASS**

T18.4 两项数值均与规格不符，建议修正后重新审查。
