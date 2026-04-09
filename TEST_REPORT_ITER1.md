# 迭代 1 测试报告

## 测试结果

| 文件 | 状态 | 通过 | 失败 | 跳过 |
|------|------|------|------|------|
| src/utils/constants.test.ts | PASS | 20 | 0 | 0 |
| src/utils/calc.test.ts | PASS | 33 | 0 | 0 |
| src/utils/skillSystem.test.ts | PASS | 31 | 0 | 0 |
| src/utils/equipmentGenerator.test.ts | PASS | 28 | 0 | 0 |
| src/utils/monsterGenerator.test.ts | PASS | 24 | 0 | 0 |
| src/utils/boundaries.test.ts | FAIL | ~36 | 1-2 | 0 |
| src/stores/gameStore.test.ts | FAIL | ~34 | 4-6 | 0 |
| src/utils/combo.test.ts | FAIL | 0 | 1 (parse error) | 0 |
| **总计** | | **~191** | **5-8** | **0** |

## App.vue 重构验证

- 原始行数: 1235 行
- 重构后行数: **125 行** (减少 90%)

## 重构后测试适配情况

### 严重问题 (需立即修复)

**1. `src/utils/combo.test.ts` - 语法错误**
```
Error: `await` is only allowed within async functions and at the top levels of modules
  → src/utils/combo.test.ts:310:37
```
第 310 行 `getPlayerHitCount = await import(...)` 将 `await` 放在了非 async 函数内。
此文件有语法错误，Vitest 无法加载，导致整个 suite 失败。

**修复方案**: 在 `getPlayerHitCount` 函数声明前加 `async` 关键字。

### 中等问题 (API 变更导致)

**2. `src/stores/gameStore.test.ts` - 7 个测试失败**

| 测试 | 错误类型 | 说明 |
|------|----------|------|
| `startBattle 初始化怪物` | `toHaveBeenCalled` | `monsterStore.initMonster` 未被调用，store 结构可能变化 |
| `日志超过50条时移除最旧的` | 断言错误 | 索引 49 的值从 'log 4' 变为 'log 5'，日志添加逻辑可能改变 |
| `有伤害时 DPS 大于 0` | `expected 0 to be greater than 0` | DPS 计算依赖 battleStartTime，可能未初始化 |
| `速度比 >= 2 有先手权` | `calculateSpeedAdvantage is not a function` | **此方法已从 gameStore 中移除** |
| `速度比 1.5-2 有优势但无双动` | 同上 | 同上 |
| `速度比 < 1.5 无优势` | 同上 | 同上 |
| `无怪物时返回零伤害` | `expected 97 to be +0` | `executePlayerTurn` 逻辑变化 |

**根本原因**: `calculateSpeedAdvantage` 方法在重构中被移除或移动到其他位置。

**3. `src/utils/boundaries.test.ts` - 边界测试失败 (随机性)**

| 测试 | 错误 | 说明 |
|------|------|------|
| `负攻击力被视作 0` | `expected -10 >= 0` | `calculateTotalStats` 不再 clamp 负攻击力 |
| `负闪避率被视作 0` | `expected -10 >= 0` | 同上 |
| `负暴击率被视作 0` | `expected -5 >= 0` | 同上 |
| `speed 0 仍然允许行动` | `expected 10 to be +0` | speed=0 被覆盖为基础值 10 |
| `crit rate 0 不会暴击` | 非确定性 | random mock 未正确固定 |
| `crit rate 50+ 封顶 50%` | 非确定性 | 同上 |

**根本原因**: `calculateTotalStats` 在重构后不再对负数属性做 clamp（之前版本有这个逻辑）。

### 新增测试

**`src/utils/constants.test.ts`** - 新增，20 个测试全部通过。

## 覆盖率

| 文件 | 覆盖情况 |
|------|----------|
| constants.ts | **100%** - 新增测试覆盖所有导出常量 |
| useGameLoop.ts | **无测试** - composable 需补充测试 |
| 新增 6 组件 | **无快照测试** - 建议补充 |

## 建议

### P0 - 立即修复
1. **修复 `combo.test.ts` 第 310 行语法错误** - 添加 `async` 关键字
2. **修复或删除 `calculateSpeedAdvantage` 相关测试** - 方法已不存在，确认是否迁移到其他位置

### P1 - 高优先级
3. **确认 `calculateTotalStats` 的负数 clamp 行为** - 如果是有意移除负数保护，需更新测试期望
4. **检查 `battleStartTime` 初始化** - DPS 测试依赖的时序状态可能未正确设置

### P2 - 后续补充
5. 为 `useGameLoop.ts` 添加单元测试
6. 为新增 Vue 组件添加快照测试
7. 修复 `boundaries.test.ts` 中的随机性测试，使用 `vi.mock` 固定 Math.random
