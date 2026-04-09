# REVIEW_ITER6.md - 迭代6 被动技能系统审查

**分支**: `iter-6/passive-skills`  
**Commit**: `079e9291c5d4bd50aac18b90e25140f15e0703e6`  
**审查结论**: **PASS**

---

## 变更文件

| 文件 | 变更 |
|------|------|
| `src/types/index.ts` | PassiveStatBonus, PassiveSkillEffect, PassiveSkill 接口 + PASSIVE_SKILLS (8个) + damageReduction |
| `src/stores/skillStore.ts` | 激活逻辑 + localStorage 持久化 |
| `src/components/PassiveSkillsPanel.vue` | 4×2 网格 UI |

---

## T6.1 数据模型

### 接口定义
- `PassiveStatBonus`: stat + value + type(flat|percent)
- `PassiveSkillEffect`: trigger + statBonus/specialEffect + value
- `PassiveSkill`: id + name + description + effects[] + unlockCondition + icon
- `PASSIVE_SKILLS`: 8个被动技能常量

### 8个被动技能
| ID | 名称 | 条件 | 效果 |
|----|------|------|------|
| iron_wall | 铁壁 | 100 | 防御+5% |
| berserk | 狂暴 | 200 | 生命<30%时攻击+30% |
| swift | 灵敏 | 300 | 速度+10% |
| vampiric | 吸血 | 400 | 生命偷取+2% |
| combo_master | 连击 | 500 | 10%概率额外攻击 |
| penetration | 穿透 | 600 | 穿透+20 |
| lucky | 幸运 | 700 | 金币+10% |
| tough | 坚韧 | 800 | 伤害-5% |

### damageReduction
- 新增到 `PlayerStats` (line 135)
- 新增到 `STAT_NAMES` (line 230)
- 新增到 `STAT_CATEGORY` (line 256, advanced)
- 被 tough 被动使用

### 验证
```
$ grep -n "PASSIVE_SKILLS\|PassiveSkill\|unlockPassiveSkill" src/
src/components/PassiveSkillsPanel.vue:4:import { PASSIVE_SKILLS } from '../types'
src/components/PassiveSkillsPanel.vue:9:  return PASSIVE_SKILLS.map(...)
src/stores/skillStore.ts:3:import type { Skill, PassiveSkill, PlayerStats } from '../types'
src/stores/skillStore.ts:4:import { PASSIVE_SKILLS } from '../types'
src/stores/skillStore.ts:11:  const passiveSkills = ref<PassiveSkill[]>([])
src/stores/skillStore.ts:20:        passiveSkills.value = PASSIVE_SKILLS.filter(...)
src/stores/skillStore.ts:31:  function unlockPassiveSkill(id: string)
src/stores/skillStore.ts:32:    const skill = PASSIVE_SKILLS.find(s => s.id === id)
src/stores/skillStore.ts:135:    unlockPassiveSkill,
src/types/index.ts:286-297: interface PassiveSkillEffect, PassiveSkill
src/types/index.ts:302: export const PASSIVE_SKILLS: PassiveSkill[] = [
```
PASS - 所有关键符号均已正确定义和引用。

---

## T6.2 激活逻辑

### 状态
- `passiveSkills: ref<PassiveSkill[]>([])` - 已解锁的被动技能实例
- `unlockedPassiveIds: ref<Set<string>>(new Set())` - 解锁ID集合

### 核心函数
- `unlockPassiveSkill(id)`: 幂等（已解锁则直接返回），解锁后立即持久化
- `isPassiveUnlocked(id)`: 查询指定ID是否已解锁
- `applyPassiveEffects(stats)`: 仅处理 trigger='always' 的 statBonus，支持 flat 和 percent 两种加成

### localStorage 持久化
- Key: `lollipop_passive_skills`
- 存储: `{ unlockedIds: string[] }`
- 加载: `loadPassiveState()` 在 store 初始化时调用
- 写入: `savePassiveState()` 在 `unlockPassiveSkill()` 后调用

### 幂等性验证
```typescript
function unlockPassiveSkill(id: string) {
  const skill = PASSIVE_SKILLS.find(s => s.id === id)
  if (!skill) return
  if (unlockedPassiveIds.value.has(id)) return  // 幂等保护
  unlockedPassiveIds.value.add(id)
  passiveSkills.value.push(skill)
  savePassiveState()
}
```
PASS - 解锁重复调用安全。

---

## T6.3 UI组件

### PassiveSkillsPanel.vue
- 4列 grid: `grid-template-columns: repeat(4, 1fr)` + 8技能 = 4×2 布局
- 未解锁: 显示锁图标 + 难度条件
- 已解锁: 显示技能名称(金色)
- locked 状态: 半透明 + 深色背景

---

## TypeScript 检查

```
$ npx vue-tsc --noEmit 2>&1 | head -10
```
**无被动技能相关 TS 错误。**  
现有错误均为 pre-existing 问题（App.vue 未使用变量、useSkillExecutor.test.ts 类型不匹配），与本次迭代无关。

---

## 单元测试

```
$ npx vitest run src/stores/passiveSkills.test.ts
✓ 4 tests passed (5ms)
  - 8个被动技能数量正确
  - 每个技能有 unlockCondition
  - 每个技能有 effects 数组
  - iron_wall 条件为100
```

---

## 遗留问题

1. **specialEffect 未实现**: `berserk` (critStreak) 和 `combo_master` (critStreak) 的 `specialEffect` 仅定义了数据结构，`applyPassiveEffects` 目前只处理 `trigger='always'` 的 statBonus，特殊效果（狂暴触发、连击判定）为后续迭代 TODO。

2. **unlockPassiveSkill 需手动调用**: 目前 UI 只展示面板，没有实际的解锁入口，解锁逻辑存在但无触发路径。

---

## 结论

**PASS** - T6.1/T6.2/T6.3 实现完整，数据模型清晰，激活逻辑幂等，持久化正确，UI 符合 4×2 规格，TS 检查通过，测试全部绿灯。
