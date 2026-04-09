# TEST_REPORT_ITER3 - 数值平衡测试报告

## 分支
`iter-3/numerical-balance`

## 测试时间
2026-04-10 04:56 GMT+8

## 测试结果

### 结论: **PARTIAL PASS**

---

## 新增测试: `src/utils/numericalBalance.test.ts` - 全部通过 (10/10)

| 测试项 | 期望值 | 实际值 | 状态 |
|--------|--------|--------|------|
| MONSTER.DEFENSE_MULTIPLIER | 1.5 | 1.5 | PASS |
| CRIT.RATE_GROWTH | 0.02 | 0.02 | PASS |
| CRIT.DAMAGE_GROWTH | 1.0 | 1.0 | PASS |
| CRIT.RATE_MAX | 50 | 50 | PASS |
| LOTTERY.GROWTH_RATE | 1.002 | 1.002 | PASS |
| difficulty 0: critRate = 5% | 5 | 5 | PASS |
| difficulty 500: critRate = 15% | 15 | 15 | PASS |
| difficulty 2500: critRate capped at 50% | 50 | 50 | PASS |
| difficulty 0: critDamage = 150 | 150 | 150 | PASS |
| difficulty 500: critDamage = 650 | 650 | 650 | PASS |

**数值变更验证成功** - 所有 iter-3 常量值符合预期。

---

## 现有测试失败 (6 failures)

| 测试文件 | 测试用例 | 原因 |
|----------|----------|------|
| monsterGenerator.test.ts | BOSS 怪物防御力是普通怪物 1.2 倍 | 旧测试期望 `×3`，实际 `×1.5` |
| monsterGenerator.test.ts | 防御力 = baseValue × 3 | 旧测试期望 `×3`，实际 `×1.5` |
| monsterGenerator.test.ts | 非 BOSS 防御力不加成 | 旧测试期望 `×3`，实际 `×1.5` |
| monsterGenerator.test.ts | 暴击率上限 30 | 旧测试期望 ≤30，实际 RATE_MAX=50 |
| monsterGenerator.test.ts | BOSS 暴击伤害更高 | 旧测试期望 `0.1` 增长率，实际 `1.0` |
| equipmentGenerator.test.ts | 装备等级匹配难度值 | 旧测试期望 level=100，实际 75 |

**分析**: 这 6 个失败是**预期内的** - 旧测试用例使用 iter-2/iter-1 的数值假设，iter-3 更改了平衡参数后未同步更新旧测试断言。

---

## 总体统计

| 指标 | 数值 |
|------|------|
| Test Files | 2 failed, 8 passed (10 total) |
| Tests | 6 failed, 229 passed (235 total) |
| 新增 numericalBalance 测试 | 10 passed |

---

## 建议

1. **必须**: 更新 `monsterGenerator.test.ts` 中防御力相关测试的断言（`×3` → `×1.5`）
2. **必须**: 更新 `monsterGenerator.test.ts` 中暴击率上限测试（`≤30` → `≤50`）
3. **必须**: 更新 `monsterGenerator.test.ts` 中 BOSS 暴击伤害测试的增长率假设（`0.1` → `1.0`）
4. **必须**: 更新 `equipmentGenerator.test.ts` 中装备等级匹配测试
