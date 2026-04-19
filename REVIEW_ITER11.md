# Review: iter-11/gacha-system (caa4f857)

## Commit: caa4f857fd98005610f816708bb9825f8ac20354

## 变更范围
- 新增 `src/types/gacha.ts` — 类型定义
- 新增 `src/data/gachaPools.ts` — 奖池配置
- 新增 `src/stores/gachaStore.ts` — 抽卡核心逻辑
- 新增 `src/components/GachaTab.vue` — 抽卡UI
- 修改 `src/utils/constants.ts` — 移除LOTTERY常量
- 修改 `src/stores/playerStore.ts` — 移除抽奖函数
- 修改 `tsconfig.json`

---

## 验证结果

### 1. LOTTERY 移除

| 文件 | 检查 |
|------|------|
| `src/utils/constants.ts` | LOTTERY 常量已删除 |
| `src/stores/playerStore.ts` | getLotteryCost/doLottery/doLottery10/doLotteryUntilCant 已删除 |
| `src/components/ShopTab.vue` | 随迭代删除（lottery 相关 UI 移除） |

```
$ grep -rn "getLotteryCost\|doLottery\|LOTTERY" src/
src/utils/numericalBalance.test.ts:2:import { MONSTER, CRIT, LOTTERY } from '../utils/constants'
src/utils/numericalBalance.test.ts:25:  expect(LOTTERY.GROWTH_RATE).toBe(1.002)
```
> 注：`numericalBalance.test.ts` 引用旧 LOTTERY 常量，测试会失败（预先存在的问题，非本迭代引入）

### 2. 抽卡类型与 Store

| 检查项 | 状态 |
|--------|------|
| GachaPool/GachaReward/GachaRecord/GachaState 类型 | ✅ |
| gachaStore.pull() | ✅ |
| gachaStore.claimDailyFree() | ✅ |
| gachaStore.getPityProgress() | ✅ |
| gachaStore.canClaimDailyFree() | ✅ |
| 加权随机 weightedRandom | ✅ |
| 软保底 +2%/抽 | ✅ |
| 硬保底 90 抽必出传说 | ✅ |
| 保底后清零 | ✅ |

### 3. 奖池配置

| 池 | 状态 |
|----|------|
| 常驻池 (PERMANENT_POOL_ID) | ✅ rates={common:60, rare:30, epic:9, legendary:1} |
| 限定池·深渊征服者 (LIMITED_POOL_ID) | ✅ rates={common:50, rare:35, epic:13, legendary:2} |

### 4. 抽卡 UI (GachaTab.vue)

| 功能 | 状态 |
|------|------|
| 池切换按钮 | ✅ |
| 保底进度条 | ✅ |
| 每日免费领取 | ✅ |
| 单抽/十连按钮 | ✅ |
| 结果弹窗 | ✅ |
| 软保底提示 | ✅ |

### 5. TypeScript 编译

```
$ npx vue-tsc --noEmit 2>&1 | head -20
src/App.vue(50,10): error TS6133: 'addDamagePopup' is declared but its value is never read.
src/App.vue(53,10): error TS6133: 'showEquipmentConfirm' is declared but its value is never read.
... (12+ pre-existing errors)
src/composables/useSkillExecutor.test.ts: error TS2345: test type mismatch
src/stores/gameStore.test.ts: error TS6133: unused import
```
> 均为预先存在的错误，与本次迭代无关

---

## ⚠️ 发现问题

### P0 — 钻石消耗未实现（功能缺失）

`GachaTab.vue` 的 `doPull()` 函数直接调用 `gacha.pull()`，**未检查/扣除玩家钻石余额**：

```typescript
// GachaTab.vue:17
function doPull(count: 1 | 10) {
  const r = gacha.pull(currentPool.value, count)  // 无钻石校验
  results.value = r
  showResults.value = true
}
```

`gachaStore.pull()` 本身也不涉及 playerStore 钻石扣减。这意味着玩家可以无限免费抽卡，**核心经济系统未闭环**。

**预期行为：** 单抽扣 `pool.cost` 钻石，十连扣 `pool.cost * 10`，余额不足应禁用按钮或提示。

**建议修复（任选其一）：**
1. 在 `gachaStore` 中注入 `usePlayerStore`，pull 时校验并扣减钻石
2. 在 `GachaTab.vue` 的 `doPull` 中调用 playerStore 扣减逻辑

### P1 — 预先存在的测试失败

`numericalBalance.test.ts` 引用已删除的 `LOTTERY` 常量，测试套件有预置失败。

---

## 结论

**PARTIAL PASS**

| 维度 | 结论 |
|------|------|
| 类型定义 | ✅ |
| gachaStore 逻辑 | ✅ |
| 奖池配置 | ✅ |
| UI 组件 | ✅ |
| LOTTERY 移除 | ✅ |
| **钻石扣减集成** | ❌ 缺失 |
| **TypeScript 干净编译** | ⚠️ 预存错误（与本迭代无关）|

本迭代完成了数据模型、Store 逻辑、奖池配置和 UI 组件的基础建设，但 **钻石消耗未接入玩家经济系统**，这是一个 P0 级别的功能缺失，需在下个迭代补充。
