# 迭代 2 代码审查报告

**分支**: `iter-2/combat-system`  
**Commit**: `4c942fe`  
**审查时间**: 2026-04-10 04:40 GMT+8  
**审查者**: reviewer (6步溯源模板)

---

## Step 1: 复述问题

本次迭代在 nz_increment 项目中实现战斗系统的四项改进：速度先手双动判定（3x/2x/1x 阈值）、技能生命偷取计算、伤害弹出 UI 集成，以及战斗循环错误捕获。

---

## Step 2: 列 15 条可能根因

1. **BUG-1**: `updateGauges()` 中 `firstStrike && monsterActionGauge.value > 0` 的零化逻辑每 tick 执行，导致怪物在玩家速度优势时永远无法行动
2. **BUG-2**: `startBattle()` 中当 `playerSpeed === monsterSpeed` 时 `offset = 0`，双方 gauge 均为 0，无先手方
3. **BUG-3**: `calculateSkillLifesteal` 导入但从未调用（TypeScript TS6133 警告），旧版 `calculateLifesteal` 仍在使用
4. **BUG-4**: `updateGauges()` 中缺少 T2.1 描述的"怪物速度劣势时强制清零"逻辑（只处理了玩家优势，未处理怪物劣势）
5. **BUG-5**: `processPlayerAttack()` 中 damagePopup 类型判断逻辑错误 — skill 时机判断在技能未就绪时不生效，但 popup 逻辑无条件执行
6. **BUG-6**: `battleError.value = e as Error` 捕获的异常没有被 UI 层展示，错误静默吞掉但无恢复机制
7. **BUG-7**: `addDamagePopup` 中 `setTimeout` 闭包捕获 `popupId`，但 `popupId++` 在 `addDamagePopup` 外部，两者时机可能存在竞态
8. **BUG-8**: `startBattle()` 偏移公式 `tickRate * 0.5` 中 `0.5` 为 magic number，未定义常量
9. **BUG-9**: `updateGauges()` 每 tick 都执行 `addBattleLog`，先手日志会重复打印（每帧一次）
10. **BUG-10**: `executePlayerTurn` 返回 `skill: usedSkill`，但当技能在冷却或不存在时 `usedSkill` 为 `null`，popup 仍可能显示 `'skill'` 类型
11. **BUG-11**: TypeScript TS2322/TS2820 类型错误存在于 `achievementChecker.ts`，与本次迭代无关但存在于代码库中
12. **BUG-12**: `gameLoop` 中 `try/catch` 吞掉错误后没有状态恢复，后续 tick 仍会继续执行可能出错的状态
13. **BUG-13**: `processPlayerAttack` 中 `skill` 参数从 `nextSkill.index` 获取但 `getNextReadySkill` 可能返回 null
14. **BUG-14**: `startBattle()` 中 `playerActionGauge` 和 `monsterActionGauge` 的偏移量 `offset` 上限为 `GAUGE_MAX * 0.5`，但 offset 的设计意图需要验证
15. **BUG-15**: 伤害弹出 `x` 坐标计算 `50 + (Math.random() * 40 - 20)` 范围为 [30, 70]，固定了水平分散但对 monster 和 player 都用同一范围

---

## Step 3: 验证命令

```bash
cd /home/ubuntu/.openclaw/workspace/nz_increment

# 查看变更文件
git show --stat 4c942fe

# 检查 calc.ts 中 calculateSkillLifesteal
grep -n "calculateSkillLifesteal" src/utils/calc.ts

# 检查 gameStore.ts 中的新功能
grep -n "damagePopups\|addDamagePopup\|battleError\|calculateSpeedAdvantage" src/stores/gameStore.ts

# TypeScript 检查
npx vue-tsc --noEmit 2>&1 | head -30
```

---

## Step 4: 执行验证

### git show --stat 4c942fe

```
3 files changed, 120 insertions(+), 22 deletions(-)
src/stores/gameStore.ts | 106 +++++++++++++++++++++
src/utils/calc.ts       |  12 +++
.iterations.json        |  24 ++++
```

### grep calculateSkillLifesteal (calc.ts)

```
266:export function calculateSkillLifesteal(skill: { lifesteal?: number } | null, damage: number): number {
```

函数定义存在，但 grep 检查 `gameStore.ts` 中使用情况：

```
37:import { ..., calculateSkillLifesteal } from '../utils/calc'
```
**导入存在，但 gameStore.ts 中没有任何调用点。** TS6133 警告：`'calculateSkillLifesteal' is declared but its value is never read.`

### grep 新功能 (gameStore.ts)

```
49:  const battleError = ref<Error | null>(null)
52:  const damagePopups = ref<Array<{...}>>
151:  function addDamagePopup(...)
155:    damagePopups.value.push(...)
159:    setTimeout(...)
217:  function calculateSpeedAdvantage(...)
343:  // 速度优势伤害加成（executePlayerTurn 中）
373:  addDamagePopup('miss', 0, true)
376:  addDamagePopup('normal', damage, true)
428-432: addDamagePopup 集成到 processPlayerAttack
571:  speedAdvantage.firstStrike 应用（updateGauges）
614:  battleError.value = e
689:  battleError 暴露到返回对象
697:  damagePopups 暴露
702:  addDamagePopup 暴露
```

### TypeScript 检查

```
TS6133: 'addDamagePopup' is declared but its value is never read. (App.vue:50)
TS6133: 'calculateSkillLifesteal' is declared but its value is never read. (gameStore.ts:37)
TS6133: 'skillIndex' is declared but its value is never read. (gameStore.ts:498)
TS2322/TS2820: AchievementCategory 类型错误 (achievementChecker.ts:74-84)
... (共 ~26 个 TS6133 未使用警告)
```

**无编译阻塞错误**（全部为 TS6133 警告和已存在的类型错误，不影响编译）。

---

## Step 5: 选根因

### 根因 A — updateGauges 每 tick 零化怪物 gauge（严重性：高，来源：T2.1 实现缺陷）

**位置**: `src/stores/gameStore.ts` 第 573 行

```typescript
// updateGauges() 每 tick 执行这段:
if (speedAdvantage.firstStrike && monsterActionGauge.value > 0) {
    monsterActionGauge.value = 0  // <-- 每 tick 零化！
    addBattleLog(`先手攻击! 你的速度优势让你抢先行动!`)
}
```

**后果**: 当 `playerSpeed >= monsterSpeed`（`firstStrike = true`）时，怪物的 action gauge 每帧被强制清零，永远无法达到 `GAUGE_MAX(100)`，`canMonsterAct` 永远为 `false`，**怪物永久无法行动**。

**对比**: `startBattle()` 中先手通过偏移量实现一次性的先手优势是正确的。但 `updateGauges` 中的零化逻辑是**额外的每 tick 约束**，与 startBattle 的设计冲突。

**根因分析**: T2.1 重写了 `calculateSpeedAdvantage()`，将 `hasAdvantage` 改为 `firstStrike` 后，`updateGauges` 中的条件 `hasAdvantage && monsterActionGauge.value > 0` 也随之更新为 `firstStrike && monsterActionGauge.value > 0`。但原来的设计意图（只在战斗开始时清零一次）被误解为"每 tick 持续清零"，这是一个逻辑层错误而非语法错误。

---

### 根因 B — calculateSkillLifesteal 导入但从未使用（严重性：低，来源：T2.2 未完成）

**位置**: `src/stores/gameStore.ts` 第 37 行

```typescript
import { ..., calculateSkillLifesteal } from '../utils/calc'
```

该函数已正确定义在 `calc.ts:266`，但 `gameStore.ts` 中没有任何调用点。`executePlayerTurn` 和 `processPlayerAttack` 中均未使用它进行生命偷取计算。

**后果**: T2.2 功能实际上未集成，只是写了一个孤立函数。

---

## Step 6: 最小化修改建议 + diff

### Fix-A: updateGauges 先手零化逻辑（核心 BUG）

**问题**: `firstStrike` 判断每 tick 执行，等同于永久禁用怪物行动。

**最小化修复**: 将一次性清零逻辑移到 `startBattle()` 中，`updateGauges()` 移除先手零化逻辑。

```diff
--- a/src/stores/gameStore.ts
+++ b/src/stores/gameStore.ts
@@ -558,7 +558,6 @@ export const useGameStore = defineStore('game', () => {
     monsterActionGauge.value = Math.min(GAUGE_MAX, monsterActionGauge.value + monsterSpeed * deltaTime * GAUGE_TICK_RATE / 100)
     
     // 速度优势：先手权
-    const speedAdvantage = calculateSpeedAdvantage(playerSpeed, monsterSpeed)
-    if (speedAdvantage.firstStrike && monsterActionGauge.value > 0) {
-      monsterActionGauge.value = 0
-      addBattleLog(`先手攻击! 你的速度优势让你抢先行动!`)
-    }
   }
```

**注意**: 先手优势已在 `startBattle()` 中通过偏移量实现，怪物 gauge 在玩家有先手时预填充为 0，不需要在 `updateGauges` 中重复零化。

---

### Fix-B: calculateSkillLifesteal 集成（功能缺失）

**问题**: 函数已定义但未调用。

**最小化修复**: 在 `processPlayerAttack()` 中使用 `calculateSkillLifesteal` 替代或补充现有的 `calculateLifesteal` 调用。

由于缺少具体上下文（lifesteal 的 UI 展示方式），建议审查者确认 lifesteal 是否需要独立的 damagePopup 类型。

如果暂不集成，至少**移除未使用的导入**以消除 TS6133 警告：

```diff
--- a/src/stores/gameStore.ts
+++ b/src/stores/gameStore.ts
@@ -34,7 +34,7 @@ import { useRebirthStore } from './rebirthStore'
-import { calculatePlayerDamage, calculateMonsterDamage, calculateLuckEffects, calculateLifesteal, calculateSkillLifesteal } from '../utils/calc'
+import { calculatePlayerDamage, calculateMonsterDamage, calculateLuckEffects, calculateLifesteal } from '../utils/calc'
```

---

## 最终结论

### FAIL

**核心原因**: `updateGauges()` 中的 `firstStrike && monsterActionGauge.value > 0` 零化逻辑是一个严重的逻辑错误，会导致任何玩家速度 >= 怪物速度的战斗中怪物永久无法行动。这不是边界 case，而是几乎所有战斗场景都会触发的完全功能性破坏。

**次要原因**: T2.2 `calculateSkillLifesteal` 虽然函数已实现，但未集成到任何调用点，功能实际上为空。

**说明**: T2.3（伤害弹出）和 T2.4（错误处理）的基础结构正确，但因 BUG-1 的存在，战斗循环无法正常运行到需要这些功能的阶段。

---

## 建议优先级

| 优先级 | 问题 | 修复方式 |
|--------|------|----------|
| P0 | updateGauges 每 tick 零化怪物 gauge | 删除零化逻辑（先手已在 startBattle 实现） |
| P1 | calculateSkillLifesteal 未集成 | 集成调用或移除导入 |
| P2 | 先手日志每 tick 打印（Fix-A 附带修复） | 已在 Fix-A 中清除 |
| P3 | startBattle offset 为 0 时双方均无 gauge | 考虑 fallback 到 GAUGE_MAX/2 |
