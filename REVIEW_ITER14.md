# REVIEW_ITER14.md - 被动技能系统审查

**分支**: `iter-14/passive-skills` | **Commit**: `7be0900` | **审查时间**: 2026-04-10

---

## 摘要

迭代14实现了一套基于条件表达式的被动技能系统，包含 `ConditionExpression`/`ConditionalPassiveEffect` 接口、`passiveEvaluator.ts` 求值引擎、10个被动技能定义，以及 `gameStore` 中的 `battleTurnCount`/`currentCombo` 状态集成。

**结论: PARTIAL**

核心机制正确，但存在2个功能性bug和1个架构隐患需要修复。

---

## T14.1: ConditionExpression / ConditionalPassiveEffect 接口

### 验证命令
```bash
grep -n "ConditionExpression\|ConditionalPassiveEffect" src/types/index.ts
```

### 结果: PASS

- `ConditionExpression` (line 29): `{ field, operator, value }` - 正确
- `ConditionalPassiveEffect` (line 35): `{ id, name, description, type, condition?, effect, priority }` - 正确

### 隐患: 架构冲突

`types/index.ts` 同时存在两套互不兼容的被动技能系统：

| | 旧系统 | 新系统 |
|---|---|---|
| 文件位置 | `types/index.ts:350` | `data/passiveSkills.ts` |
| 接口名 | `PassiveSkill` | `ConditionalPassiveEffect` |
| 数组名 | `PASSIVE_SKILLS` | `PASSIVE_SKILLS` |
| 结构 | `effects: PassiveSkillEffect[]`, `unlockCondition: number` | `condition?`, `effect` |
| 数量 | 8个 | 10个 |

`passiveSkills.test.ts` 导入 `PASSIVE_SKILLS from '../types'` 测试旧系统格式，测试通过但与新系统完全脱节。

---

## T14.2: passiveEvaluator.ts

### 验证命令
```bash
grep -n "evaluateCondition\|applyPassiveEffects" src/utils/passiveEvaluator.ts
```

### 结果: PARTIAL

**正确的部分**:
- `evaluateCondition()`: 正确处理 `hpPercent`, `combo`, `isBoss`, `turnCount`, `speed` 五个字段
- `applyPassiveEffects()`: 正确区分 `static` / `conditional` 两种类型，正确应用 `percent` / `flat` 加成
- 条件操作符 `<`, `>`, `>=`, `<=`, `==`, `has` 均已实现

**Bug 1: `special: 'lifesteal'` 是死代码**

`data/passiveSkills.ts` 第64行:
```ts
effect: { stat: 'critDamage', value: 10, type: 'flat', special: 'lifesteal' }
```

`passiveEvaluator.ts` 中 `applyPassiveEffects` 只处理 `stat` 和 `value`，完全忽略 `special` 字段。`gameStore.ts` 中也无任何代码处理被动技能特效。`crit_lifesteal` 被动（暴击率>=50%时吸血）的 `special: 'lifesteal'` 永远不会被执行。

---

## T14.3: passiveSkills.ts — 10个被动技能

### 验证命令
```bash
grep -n "PASSIVE_SKILLS" src/data/passiveSkills.ts
```

### 结果: PASS

10个被动技能全部正确定义，使用 `ConditionalPassiveEffect` 类型：

| ID | 名称 | 条件 | 效果 |
|---|---|---|---|
| bloodlust | 血战 | HP < 30% | 伤害-20% |
| combo_fury | 连击狂热 | combo > 5 | 攻击+25% |
| boss_slayer | Boss杀手 | isBoss==1 | 伤害+30% |
| first_strike | 先发制人 | turnCount==1 | 攻击+20% |
| pearlessence | 珍珠守护 | HP > 80% | 防御+15% |
| swift_attack | 疾风攻击 | speed > 100 | 暴击+10% |
| crit_lifesteal | 暴击吸血 | critRate >= 50% | 暴伤+10%，特效: lifesteal |
| anti_boss | 反Boss专家 | isBoss==1 | 穿透+30 |
| low_hp_fury | 低血狂暴 | HP < 50% | 攻击+15% |
| damage_shield | 伤害护盾 | static | 伤害-5% |

---

## T14.4: gameStore 集成

### 验证命令
```bash
grep -n "battleTurnCount\|currentCombo" src/stores/gameStore.ts
```

### 结果: PASS

- `battleTurnCount` (line 102) 和 `currentCombo` (line 104) 正确初始化为 `ref(0)`
- `applyPassiveEffects` 在 `executePlayerTurn` (line 564) 中被调用，使用正确的上下文参数
- 两者在战斗开始时重置为0 (line 961)
- `currentCombo` 在攻击时递增 (line 733)，被击中时重置 (line 688)
- `battleTurnCount` 在每次玩家回合递增 (line 735)

---

## 测试结果

```bash
npx vitest run
```

| 文件 | 结果 | 数量 |
|---|---|---|
| src/stores/passiveSkills.test.ts | PASS | 4/4 |
| src/stores/gameStore.test.ts | PASS (flaky) | 40/40 |
| 其他17个测试文件 | PASS | 214/214 |

### 关于 DPS 测试 flaky 问题

`gameStore.test.ts` 中 `getDPS - 有伤害时 DPS 计算正常` 偶发失败（期望100，得到99），原因是 `Date.now()` 计时精度问题，与被动技能系统无直接关系。单独运行 `getDPS` 测试时全部通过。

---

## 必须修复的问题

### Bug 1 (高优先级): `special: 'lifesteal'` 死代码

`passiveEvaluator.ts` 不处理 `special` 字段。需要在 `applyPassiveEffects` 返回值中包含 `special` 信息，并在 `gameStore.ts` 的 `executePlayerTurn` 中处理 `special === 'lifesteal'` 时的回血逻辑。

### Bug 2 (中优先级): 双 PASSIVE_SKILLS 歧义

`types/index.ts` 和 `data/passiveSkills.ts` 导出同名的 `PASSIVE_SKILLS` 但类型完全不同。建议：
- 旧系统改名为 `LEGACY_PASSIVE_SKILLS` 或移除
- 或新系统导入时使用明确路径 `from '../data/passiveSkills'`

---

## 最终判定

| 检查项 | 状态 |
|---|---|
| T14.1 接口定义 | ✅ PASS |
| T14.2 求值引擎 | ⚠️ PARTIAL (special未实现) |
| T14.3 技能定义 | ✅ PASS |
| T14.4 gameStore集成 | ✅ PASS |
| 测试通过 | ✅ PASS (含1个flaky) |
| TypeScript编译 | ⚠️ 无新增错误 (既有错误与T14无关) |

**判定: PARTIAL** — 系统可运行，但 `special: 'lifesteal'` 未实现是明确的功能遗漏，应在合并前修复。
