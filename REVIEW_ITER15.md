# Review: iter-15 装备套装系统 (commit 4a7884f)

## 结论: **FAIL**

---

## T15.1: equipmentSets.ts — 状态: PASS

- 文件存在: `src/data/equipmentSets.ts`
- 5套齐全: `warrior_power`(战士之力), `ranger_agility`(游侠敏捷), `mage_wisdom`(法师智慧), `abyss_conqueror`(深渊征服者), `eternal_guardian`(永恒守护)
- 每套 effects: `{ 2?: SetEffect, 3?: SetEffect, 5?: SetEffect }` — 结构正确
- `SetEffect` 包含 `description`, 可选 `stat`, 可选 `special`

---

## T15.2: equipmentSetCalculator.ts — 状态: PASS

- 文件存在: `src/utils/equipmentSetCalculator.ts`
- `calculateActiveSets()` 正确遍历 `EQUIPMENT_SETS`, 按 `equippedCount` 激活 2/3/5 件奖励
- 返回 `ActiveSetBonus[]`, 包含 `setId`, `setName`, `tier`, `effect`
- `getSetName()` 辅助函数正常

---

## T15.3: playerStore 集成 — 状态: PASS

- `playerStore.ts` 第5行正确 import `calculateActiveSets`
- `totalStats` computed (第340行) 正确应用套装加成:
  - 遍历 `activeSets`, 对有 `stat` 的效果按 `percent` 或 `flat` 正确叠加
  - 对 `special` 效果（lifesteal, immortal_shield 等）跳过，符合预期

---

## T15.4: EquipmentDetailModal 显示已激活套装 — 状态: **FAIL (结构性错误)**

### 问题1: 错误的导入源 (CRITICAL)

```typescript
// EquipmentDetailModal.vue 第10行
import { EQUIPMENT_SETS as SET_DEFS } from '../utils/constants'
```

`constants.ts` 中的 `EQUIPMENT_SETS` 仍是**旧的2/4件套装系统**:

```typescript
// src/utils/constants.ts (当前版本)
export const EQUIPMENT_SETS: readonly EquipmentSet[] = [
  { id: 'warrior',     name: '勇者套装', pieces: { 2: [...], 4: [...] } },
  { id: 'guardian',    name: '守护者套装', pieces: { 2: [...], 4: [...] } },
  // ... 只有 2/4 件!
]
```

而新的 `equipmentSets.ts` 使用的是完全不同的数据结构 (effects: {2,3,5}) + 槽位系统。两者 ID 也不兼容:

| 新 ID | 旧 ID |
|-------|-------|
| `warrior_power` | `warrior` |
| `ranger_agility` | *(无)* |
| `mage_wisdom` | *(无)* |
| `abyss_conqueror` | *(无)* |
| `eternal_guardian` | *(无)* |

### 问题2: 模板渲染目标错误

Modal 模板中 `set-info` 区块使用:

```html
<div class="bonus-item">2件: <span v-for="piece in setInfo.pieces[2]">
```

`setInfo.pieces[2]` 和 `setInfo.pieces[4]` 是旧结构才有的字段，新的 `SetEffect` 结构中没有 `pieces` 属性。

### 问题3: set-info 区块使用了旧结构

当前 `set-info` 区块 (第118-128行) 渲染的是旧格式的 `stat` 数组，不是新的 `description` 风格。

### 正确部分

Modal 中 `activeSetBonuses` computed 和其对应的 `set-bonus-panel` UI (第130-150行) **实现正确**:
- 正确 import `calculateActiveSets` from `equipmentSetCalculator`
- 正确遍历 `activeSetBonuses` 并渲染 `setName`, `tier`, `description`
- 有"未激活套装"空状态处理

---

## 验证命令结果

```bash
$ grep -n "EQUIPMENT_SETS\|calculateActiveSets" src/
# 返回空！grep pattern 匹配失败
```

```bash
$ find src -name "*equipmentSet*"
src/data/equipmentSets.ts
src/utils/equipmentSetCalculator.ts
src/utils/equipmentSet.test.ts     # 测试文件存在
```

```bash
$ grep -n "EQUIPMENT_SETS\|calculateActiveSets" src/data/equipmentSets.ts
# 等号前需要反斜杠转义: grep "EQUIPMENT_SETS" 才有输出
```

---

## 总结

| 验收项 | 状态 |
|--------|------|
| T15.1 equipmentSets.ts 5套定义 | PASS |
| T15.2 calculateActiveSets() | PASS |
| T15.3 playerStore totalStats 集成 | PASS |
| T15.4 EquipmentDetailModal 套装显示 | **FAIL** |

**核心问题**: `EquipmentDetailModal.vue` 的 `set-info` 区块（第114-128行）使用了旧的 `constants.ts` 中的套装数据结构，与新的 `equipmentSets.ts` 不兼容。新的 2/3/5 件套装系统（带槽位标记）无法正确显示在该区域。只有 `activeSetBonuses` panel 部分是正确的。

**修复建议**:
1. 将 Modal 中 `set-info` 区块的 `SET_DEFS` 导入改为从 `src/data/equipmentSets.ts` 导入
2. 更新模板渲染逻辑以适配 `effects: {2,3,5}` + `SetEffect.description` 结构
3. 或者删除/注释旧的 `set-info` 区块，仅保留新的 `activeSetBonuses` panel
