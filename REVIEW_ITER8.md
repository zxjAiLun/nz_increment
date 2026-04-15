# Review: iter-8/more-features (commit 490099f3)

## Summary

| Feature | Status |
|---------|--------|
| T8.1 月卡/战令系统 | PARTIAL |
| T8.2 图鉴系统 | PASS |
| T8.3 本地排行榜 | PASS |

**结论: FAIL**

---

## T8.1 月卡/战令系统

### 月卡 (PARTIAL)

| 需求 | 实现 | 状态 |
|------|------|------|
| 30钻石购买 | `purchaseMonthlyCard()` 扣除30钻石 | PASS |
| 30天有效期 | `MONTHLY_CARD_DURATION = 30 * 24 * 60 * 60 * 1000` | PASS |
| 每日100钻石 | `claimMonthlyCardReward()` 返回 `{ diamond: 100 }` | PASS |
| 20%金币加成 | `getMonthlyCardGoldBonus()` 定义了但**从未使用** | **FAIL** |

**关键Bug**: `addGold()` (playerStore.ts:467) 计算金币加成时只用了 `luckEffects.goldBonus + rebirthBonus`，完全忽略了 `getMonthlyCardGoldBonus()`。月卡激活时 20% 金币加成永远不会生效。

```typescript
// playerStore.ts:467-471 (addGold函数)
const bonusAmount = Math.floor(amount * (luckEffects.goldBonus + rebirthBonus))
// 缺少: + getMonthlyCardGoldBonus()
```

`getMonthlyCardGoldBonus()` 被导出但从未在 `addGold` 或任何其他地方被调用。

### 战令 (PASS)

| 需求 | 实现 | 状态 |
|------|------|------|
| 50钻石购买付费版 | `purchaseBattlePass()` 扣除50钻石 | PASS |
| 30级 | `BATTLE_PASS_REWARDS` 共30级 | PASS |
| 免费+付费奖励 | freeRewards / premiumRewards 双轨领取 | PASS |
| localStorage持久化 | `BATTLEPASS_KEY` | PASS |

---

## T8.2 图鉴系统 (PASS)

| 需求 | 实现 | 状态 |
|------|------|------|
| 击杀怪物自动记录 | `recordMonsterDiscovery()` push到discoveredMonsters | PASS |
| 装备掉落/抽奖记录 | `recordEquipmentDiscovery()` push到discoveredEquipments | PASS |
| 里程碑奖励(10/25/50/75/100%) | `COLLECTION_MILESTONES` 数组 + `claimCollectionMilestone()` | PASS |
| localStorage持久化 | `COLLECTION_KEY` | PASS |

---

## T8.3 本地排行榜 (PASS)

| 需求 | 实现 | 状态 |
|------|------|------|
| difficultyValue排序 | `sort((a,b) => b.difficultyValue - a.difficultyValue)` | PASS |
| 最多100条 | `slice(0, 100)` | PASS |
| 同名合并 | findIndex + 原地替换 | PASS |
| localStorage持久化 | `LEADERBOARD_KEY` | PASS |

---

## TypeScript 检查

```
npx vue-tsc --noEmit
```

- **iter-8**: 52 个 TS 错误
- **main**: 35 个 TS 错误
- **新增**: 17 个 TS 错误 (均为 TS6133 未使用变量和 TS18047 空值检查)

新功能代码（月卡/战令/图鉴/排行榜）**没有 TS 错误**。现有错误均为 pre-existing。

```
src/stores/gameStore.ts(294,11): error TS6133: 'playerStore' is declared but its value is never read.
src/stores/gameStore.ts(781,33): error TS6133: 'skillIndex' is declared but its value is never read.
src/stores/playerStore.ts(480,12): error TS6133: 'addStatReward' is declared but its value is never read.
src/composables/useSkillExecutor.test.ts: TS2345 类型错误 (pre-existing)
src/stores/gameStore.test.ts: TS18047 空值检查 (pre-existing)
```

---

## 必须修复的问题

1. **[CRITICAL] 月卡20%金币加成未生效**
   - 文件: `src/stores/playerStore.ts`
   - 函数: `addGold()`
   - 修复: 在 bonusAmount 计算中加入 `+ getMonthlyCardGoldBonus()`
   ```typescript
   const monthlyBonus = getMonthlyCardGoldBonus()
   const bonusAmount = Math.floor(amount * (luckEffects.goldBonus + rebirthBonus + monthlyBonus))
   ```
