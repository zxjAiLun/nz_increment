# Review: iter-27/achievements (commit 6b7806fa)

## 变更文件

| 文件 | 状态 |
|------|------|
| `src/types/achievement.ts` | 新增类型定义 |
| `src/data/achievements.ts` | 10个成就定义 |
| `src/stores/achievementStore.ts` | Store 实现 |
| `src/components/AchievementTab.vue` | Tab UI |
| `src/stores/gameStore.ts` | 集成 checkAchievement 调用 |

---

## 验证结果

```bash
$ grep -n "ACHIEVEMENTS\|useAchievementStore\|checkAchievement" src/ --include="*.ts" -r | head -10
src/data/achievements.ts:3:export const ACHIEVEMENTS: Achievement[] = [
src/stores/achievementStore.ts:6:export const useAchievementStore = defineStore('achievement', () => {
src/stores/achievementStore.ts:10:function checkAchievement(type, value)
src/stores/gameStore.ts:34:import { useAchievementStore }
src/stores/gameStore.ts:771:const achievementStore = useAchievementStore()
src/stores/gameStore.ts:814:achievementStore.checkAchievement('kill_count', ...)
src/stores/gameStore.ts:903:achievementStore.checkAchievement('kill_count', ...)
```

---

## 结论: **PARTIAL** (有遗留问题，需修复后通过)

---

## 问题清单

### 1. [严重] `achievementChecker.ts` 是死代码

`src/utils/achievementChecker.ts` 中的 `checkAchievements()` 函数从未被调用。它有自己的 `Achievement` 接口（带 `requirement/progress/completed` 字段），与新系统完全独立。两套系统共存会造成混淆。

```bash
$ grep -rn "achievementChecker\|createDefaultAchievements" src/ --include="*.ts" | grep -v "achievementChecker.ts"
# 无结果 —— 被新系统完全废弃但未删除
```

### 2. [严重] 只检查了一种成就条件类型

`AchievementCondition` 定义了 8 种 condition type，但 `gameStore.ts` 中只有 `kill_count` 被调用了两次（行 814 和行 903）。

以下 condition types **从未触发检查**：
- `boss_kills` — Boss克星
- `crit_count` — 暴击达人
- `combo_max` — 连击之王
- `gold_earned` — 小有资产
- `gacha_pulls` — 抽卡爱好者
- `equip_collected` — 装备收藏家
- `floor_reached` — 深渊探索者、深渊征服者

这意味着 8/10 的成就实际上无法解锁。

### 3. [严重] 成就奖励从未发放

`unlock()` 函数只设置了 `unlockedAt` 时间戳，但奖励（钻石、称号、头像框）从未实际发放给玩家。`AchievementTab.vue` 显示奖励图标，但没有任何代码路径实际增加玩家的钻石或设置称号。

### 4. [中等] `AchievementReward` 命名冲突

`src/types/achievement.ts` 和 `src/utils/achievementChecker.ts` 都导出了 `AchievementReward` 接口，用途不同（一个是成就奖励，一个是签到奖励）。`gameStore.ts` 和 `playerStore.ts` 导入的 `AchievementReward` 来自 `achievementChecker`，与成就系统无关。

### 5. [中等] 缺少进度显示

`AchievementTab.vue` 只显示 `unlocked` 状态，没有 progress 进度条。用户不知道距离成就达成还有多远。

---

## 通过的部分

- 类型定义清晰（`AchievementCategory`、`AchievementCondition` 结构合理）
- `achievementStore` API 完整（`checkAchievement/unlock/getByCategory/isUnlocked`）
- `AchievementTab.vue` UI 结构正确，分类标签 + 列表渲染正常
- Store 与 gameStore 集成正确（引入了 store，在击杀时调用）
- 10 个成就定义完整，奖励字段与 UI 对应

---

## 建议修复

1. 删除 `src/utils/achievementChecker.ts`（或重构合并到新系统）
2. 在 gameStore/processPlayerAttack 中补充其他 condition type 的检查调用
3. 在 `unlock()` 中添加奖励发放逻辑（`playerStore.addDiamond()` 等）
4. 统一 `AchievementReward` 类型，避免命名冲突
5. 添加 progress 字段到 Vue UI
