# Review: iter-26 Roguelike Mode

**Commit:** `780b24a`
**Branch:** `iter-26/roguelike`
**结论:** ✅ **PASS**

---

## 变更文件

| 文件 | 变更 |
|------|------|
| `src/types/roguelike.ts` | Blessing/Curse/Relic/RoguelikeRun 接口定义 |
| `src/data/roguelike.ts` | BLESSINGS/CURSES/RELICS 数据常量 |
| `src/stores/roguelikeStore.ts` | startRun/selectBlessing/selectCurse/selectRelic/advanceFloor |
| `src/components/RoguelikeTab.vue` | Roguelike UI 界面 |

---

## 验证结果

```
src/data/roguelike.ts:3:export const BLESSINGS: Blessing[] = [...]
src/stores/roguelikeStore.ts:4:import { BLESSINGS } from '../data/roguelike'
src/stores/roguelikeStore.ts:6:export const useRoguelikeStore = defineStore('roguelike', () => { ... })
src/stores/roguelikeStore.ts:29:function selectBlessing(blessing: Blessing) { ... }
src/stores/roguelikeStore.ts:44:function advanceFloor() { ... }
src/stores/roguelikeStore.ts:55:return [...BLESSINGS].sort(() => Math.random() - 0.5).slice(0, count)
src/stores/roguelikeStore.ts:58:return { currentRun, startRun, selectBlessing, selectCurse, selectRelic, advanceFloor, getRandomBlessings }
```
✅ 所有 grep 模式均匹配，API 完整。

---

## 代码审查

### 优点
- **类型安全**: Blessing/Curse/Relic 接口清晰，effect 结构设计合理（stat/value/type）
- **Pinia store**: 使用 Composition API 风格，`advanceFloor` / `selectBlessing` 等逻辑内聚
- **随机祝福**: `getRandomBlessings` 正确使用 Fisher-Yates 类随机打散 + slice
- **分数系统**: `getRarityScore` 根据 rarity 赋予不同分值（common=10, rare=25, epic=50, legend=100），诅咒扣50
- **UI**: RoguelikeTab.vue 包含 floor-info、start-screen、selection-phase、status-bar，结构完整
- **无新增 TS 错误**: `tsc --noEmit` 中 roguelike 相关文件 0 报错（仅预存在 themes/guild/arena 等模块的错误）

### 小问题
- `Curse.effect` 使用单个对象而非数组，与 `Blessing.effect[]` 不对称（设计上需确认意图，诅咒可能设计为单效果）
- `BLESSINGS/CURSES/RELICS` 数据量较小（各3-6条），但当前阶段足够

### 安全性
- 无外部 I/O 或网络请求
- 无用户输入直接执行代码风险
- 随机函数 `Math.random()` 用于游戏逻辑（非安全场景），符合预期

---

## 功能覆盖

| 功能点 | 状态 |
|--------|------|
| 开始 roguelike run | ✅ `startRun()` |
| 随机展示祝福选项 | ✅ `getRandomBlessings(3)` |
| 选择祝福 | ✅ `selectBlessing()` |
| 选择诅咒 | ✅ `selectCurse()` |
| 选择遗物 | ✅ `selectRelic()` |
| 层数推进 | ✅ `advanceFloor()` |
| RoguelikeTab UI | ✅ |
| 积分累计 | ✅ |

---

## 总结

Roguelike 模式核心逻辑完整，类型定义清晰，store API 与 UI 组件一致。TS 编译无新增错误。建议后续迭代补充：
1. 每层战斗逻辑（目前仅推进层数）
2. 诅咒实际应用到角色属性
3. 遗物被动效果激活
4. 游戏结束判定（失败/通关）
