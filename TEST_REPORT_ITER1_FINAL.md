# 迭代 1 复测报告 @ 7cb5538

## 测试结果

| 文件 | 通过 | 失败 | 跳过 |
|------|------|------|------|
| src/utils/combo.test.ts | 25 | 0 | 0 |
| src/utils/boundaries.test.ts | 38 | 0 | 0 |
| src/stores/gameStore.test.ts | 40 | 0 | 0 |
| src/utils/calc.test.ts | 30 | 0 | 0 |
| src/utils/monsterGenerator.test.ts | 32 | 0 | 0 |
| src/utils/skillSystem.test.ts | 20 | 0 | 0 |
| src/utils/equipmentGenerator.test.ts | 16 | 0 | 0 |
| src/utils/constants.test.ts | 20 | 0 | 0 |
| **总计** | **221** | **0** | **0** |

## 失败用例（如有）

**无失败用例。** 全部 221 个测试通过。

### 上次问题验证

1. **combo.test.ts:310 语法错误（`await` 在非 async 函数内）**
   - **结论**: 已修复。本次运行 combo.test.ts 25 个测试全部通过，无语法错误。

2. **gameStore.calculateSpeedAdvantage 方法不存在**
   - **结论**: 已修复。gameStore.test.ts 中使用 `(gameStore as any).calculateSpeedAdvantage` 访问该方法，40 个测试全部通过。

3. **calculateTotalStats 不对负数做 clamp**
   - **结论**: 设计决策确认。frontenddev 表示这是设计意图，boundaries.test.ts 中专门编写了负数属性测试用例（负闪避率、负暴击率、负幸运值等），所有 38 个边界测试通过，验证了预期行为。

## 覆盖率

| 范围 | 语句覆盖 | 分支覆盖 | 函数覆盖 | 行覆盖 |
|------|---------|---------|---------|-------|
| **整体** | 32.13% | 29.43% | 34.48% | 32.6% |
| stores/ | 19.17% | 12.29% | 20.86% | 19.41% |
| utils/ | 77.77% | 70.51% | 88.57% | 79.35% |

**关键文件覆盖率详情:**
- `utils/calc.ts`: 85.05% 语句 / 80.51% 分支 / 93.33% 函数
- `utils/equipmentGenerator.ts`: 93.44% 语句 / 77.41% 分支 / 100% 函数
- `utils/monsterGenerator.ts`: 100% 语句 / 96% 分支 / 100% 函数
- `utils/skillSystem.ts`: 100% 全项覆盖
- `utils/constants.ts`: 100% 全项覆盖
- `stores/gameStore.ts`: 50.22% 语句 / 82.14% 函数

## 结论

**PASS** — 所有测试通过

- 8 个测试文件全部 PASS
- 221 个测试用例全部通过
- 上次报告的 3 个问题均已解决或确认为预期行为
- utils/ 工具函数覆盖率较高（77.77%），stores/ 覆盖率偏低（19.17%）但核心 gameStore 已达 50%+
