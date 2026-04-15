# nz_increment 迭代 2 测试报告

## 分支
`iter-2/combat-system`

## 测试执行时间
2026-04-10 04:43 GMT+8

---

## 测试结果总览

| 指标 | 数值 |
|------|------|
| 测试文件数 | 9 |
| 通过文件数 | 8 |
| 失败文件数 | 1 |
| 测试用例总数 | 225 |
| 通过用例数 | 224 |
| 失败用例数 | 1 |

**结论: FAIL**

---

## 失败测试详情

### 1. `startBattle 设置玩家行动槽为满（先手）` (gameStore.test.ts)

**文件**: `src/stores/gameStore.test.ts:169`
**错误**: `expected +0 to be 100 // Object.is equality`

**问题分析**:
- **测试期望**: `gameStore.playerActionGauge` 在 `startBattle()` 后为 100
- **实际结果**: `playerActionGauge` 为 0
- **原因**: 迭代 2 实现了速度先手判定系统 (`startBattle` 使用基于速度差的偏移量公式)
  - 新逻辑: `offset = min((fastSpeed - slowSpeed) * tickRate * 0.5, GAUGE_MAX * 0.5)`
  - 当玩家速度 <= 怪物速度时, `playerActionGauge` 被设为 0
  - 测试环境中玩家默认速度 (10) 与怪物初始速度 (12) 相近, 导致偏移为 0

**根本原因**: 测试未更新以匹配新的速度先手机制。`startBattle` 不再将 `playerActionGauge` 直接设为 100, 而是通过速度差计算偏移量。

---

## 新增测试文件

### `src/utils/lifesteal.test.ts` - 4/4 PASS

| 测试用例 | 结果 |
|----------|------|
| null skill returns 0 | PASS |
| skill without lifesteal returns 0 | PASS |
| skill with 10% lifesteal on 1000 damage returns 100 | PASS |
| skill with 0 lifesteal returns 0 | PASS |

### `src/utils/speedAdvantage.test.ts` - 未创建

**原因**: `calculateSpeedAdvantage` 是 `gameStore` 内部函数, 未导出。独立测试文件需要 Pinia 设置, 但现有测试框架未提供该基础设施。

**替代方案**: `gameStore.test.ts` 中已有 `speed advantage - 速度优势` 测试组 (带 fallback), 通过内部访问覆盖该功能。

---

## 迭代 2 任务完成情况

| 任务 | 状态 | 备注 |
|------|------|------|
| T2.1 速度先手判定 | 已实现 | startBattle 使用速度偏移公式 |
| T2.2 calculateSkillLifesteal | 已实现 | 4/4 测试通过 |
| T2.3 伤害弹出集成 | - | 无独立测试, 需手动验证 |
| T2.4 战斗循环错误处理 | - | 无独立测试, 需手动验证 |

---

## 待修复问题

1. **[高优先级]** `startBattle` 测试用例与新实现不兼容, 需更新测试预期或调整 `startBattle` 在速度劣势时的行为

---

## 附录: 速度先手公式 (来自 gameStore.ts:217)

```typescript
function calculateSpeedAdvantage(playerSpeed: number, monsterSpeed: number) {
  const ratio = playerSpeed / monsterSpeed
  if (ratio >= 3) return { firstStrike: true, doubleTurn: true, damageBonus: 0.5 }
  if (ratio >= 2) return { firstStrike: true, doubleTurn: false, damageBonus: 0.5 }
  if (ratio >= 1) return { firstStrike: true, doubleTurn: false, damageBonus: 0 }
  return { firstStrike: false, doubleTurn: false, damageBonus: 0 }
}
```

`startBattle` 偏移量公式 (gameStore.ts:632):
```typescript
const offset = Math.min((fastSpeed - slowSpeed) * tickRate * 0.5, GAUGE_MAX * 0.5)
```
