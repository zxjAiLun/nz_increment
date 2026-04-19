# nz_increment Test Report

**Date:** 2026-04-10
**Framework:** Vitest 4.1.4
**Total Test Files:** 8
**Total Tests:** 221
**Passed:** 221
**Failed:** 0

---

## Test Files Summary

| File | Tests | Passed | Failed | Duration |
|------|-------|--------|--------|----------|
| `src/stores/gameStore.test.ts` | 40 | 40 | 0 | 84ms |
| `src/utils/combo.test.ts` | 25 | 25 | 0 | 114ms |
| `src/utils/skillSystem.test.ts` | 28 | 28 | 0 | 40ms |
| `src/utils/boundaries.test.ts` | 38 | 38 | 0 | 112ms |
| `src/utils/equipmentGenerator.test.ts` | 25 | 25 | 0 | 24ms |
| `src/utils/monsterGenerator.test.ts` | 24 | 24 | 0 | 33ms |
| `src/utils/calc.test.ts` | 21 | 21 | 0 | 22ms |
| `src/utils/constants.test.ts` | 20 | 20 | 0 | 19ms |

---

## Coverage Report (v8)

| File | Stmts % | Branch % | Funcs % | Lines % |
|------|---------|----------|---------|---------|
| **Overall** | 32.04 | 29.24 | 34.48 | 32.60 |
| `stores/` | 19.05 | 12.03 | 20.86 | 19.41 |
| `stores/achievementStore.ts` | 6.25 | 100 | 0 | 7.14 |
| `stores/gameStore.ts` | 49.77 | 36.97 | 82.14 | 49.75 |
| `stores/monsterStore.ts` | 19.29 | 0 | 7.14 | 20.75 |
| `stores/playerStore.ts` | 6.50 | 0 | 4.16 | 6.79 |
| `stores/rebirthStore.ts` | 19.09 | 2.50 | 15.78 | 21.42 |
| `stores/skillStore.ts` | 2.85 | 0 | 0 | 3.22 |
| `stores/trainingStore.ts` | 0.91 | 0 | 0 | 0.93 |
| `types/index.ts` | 100 | 100 | 100 | 100 |
| `utils/` | 77.77 | 70.51 | 88.57 | 79.35 |
| `utils/achievementChecker.ts` | 0 | 0 | 0 | 0 |
| `utils/calc.ts` | 85.05 | 80.51 | 93.33 | 87.05 |
| `utils/constants.ts` | 100 | 100 | 100 | 100 |
| `utils/equipmentGenerator.ts` | 93.44 | 77.41 | 100 | 100 |
| `utils/monsterGenerator.ts` | 100 | 96 | 100 | 100 |
| `utils/skillSystem.ts` | 100 | 100 | 100 | 100 |

---

## Test Cases by Category

### 1. `src/utils/calc.test.ts` — 伤害公式 (21 tests)
- **命中判定:** miss 时伤害为 0
- **基础伤害计算:** 基础伤害等于玩家攻击力
- **暴击伤害计算:** 暴击时伤害翻倍
- **护甲减伤计算:** 高防御怪物减少玩家伤害、最小伤害不低于攻击力 10%
- **真实伤害:** ignoreDefense=true 绕过护甲、真实伤害叠加
- **虚空伤害:** 虚空伤害叠加
- **溢出保护:** 极大数值攻击不会溢出 Infinity
- **怪物对玩家伤害:** miss 时 0、高防御减少伤害
- **治疗/吸血/幸运效果/离线奖励/装备评分等**

### 2. `src/utils/equipmentGenerator.test.ts` — 装备生成 (25 tests)
- **generateEquipment:** id 和名称生成、稀有度/槽位/等级匹配、词条数量范围
- **稀有度倍率:** common=1、epic>common、eternal 最高
- **generateRandomRarity:** roll=50 返回 fine、bonus 提高稀有度、边界值 (0/99)
- **随机种子确定性:** 相同 random 序列生成相同装备
- **所有槽位可生成:** head/neck/shoulder/chest/back/hand/waist/legs/leftHand/rightHand/ringLeft/ringRight

### 3. `src/utils/monsterGenerator.test.ts` — 怪物生成 (24 tests)
- **难度值对应属性:** difficulty=0 基础怪物、高难度属性更高、BOSS 倍率
- **防御力计算:** baseValue x3、非 BOSS 不加成
- **暴击属性:** 暴击率上限 30、伤害随难度增长、BOSS 暴击更高
- **技能系统:** 高难度技能更多、最多 4 个
- **阶段计算:** phase 随 difficultyValue 提升、上限 7
- **随机性:** 固定 random 序列生成相同名称
- **掉落率:** 普通怪物钻石极低、BOSS 钻石 0.5、装备掉落 0.3

### 4. `src/utils/skillSystem.test.ts` — 技能系统 (28 tests)
- **SKILL_POOL:** 非空、必需字段、类型合法、unlockPhase 范围、冷却非负
- **getSkillById:** 正常查询、不存在返回 undefined、结果一致
- **getSkillsForPhase:** phase1 只有 phase1 技能、phase7 全部、递增性
- **createSkillInstance:** 新 id、初始冷却 0、保留属性、独立对象
- **getUnlockedSkills:** phase 限制、与 getSkillsForPhase 等价
- **技能描述匹配实际效果:** 重击/雷霆一击/防御姿态/穿甲打击

### 5. `src/stores/gameStore.test.ts` — 战斗状态 (40 tests)
- **初始状态:** 非暂停、日志为空、行动槽不满、统计为零
- **startBattle:** 玩家行动槽满、怪物行动槽空、日志清空、统计重置、玩家HP恢复
- **addBattleLog:** 头部添加、超50条移除最旧
- **伤害追踪:** totalDamage/normal/crit/skill/void/true 分类累加、受到伤害、闪避、击杀
- **resetDamageStats:** 所有计数归零
- **getDPS:** 无伤害为0、有伤害正常计算
- **getDamageBreakdown:** 分类数组结构正确
- **pause/unpause:** 切换状态
- **行动槽系统:** updateGauges 增加、上限100、百分比计算
- **speed advantage:** >=2 先手+双动、1.5-2 有优势、<1.5 无优势
- **executePlayerTurn:** 返回结果对象结构
- **resumeBattle:** 玩家槽满、怪物槽清

### 6. `src/utils/boundaries.test.ts` — 边界条件 (38 tests)
- **伤害溢出保护:** 1e12 有限数、不超过 1e15、1e16 有限数
- **防御力边界:** 0防御不减伤、极高防御趋向100%但有保底、负穿透处理
- **攻击力边界:** 0攻击力、负攻击力（实际值-10）、极大攻击力
- **负数属性处理:** 负闪避率/暴击率/幸运值的实际行为
- **速度边界:** speed=0 默认值为10（||操作符）、极低速度
- **幸运值边界:** luck=0/1000/2000 的各项加成效果、穿透公式
- **暴击率边界:** critRate=0 不暴击、critRate=100 封顶50%、极低值不异常
- **命中/闪避边界:** accuracy 上限80%、dodge 无上限（原始值存储）
- **真实/虚空伤害边界:** 0攻击+真实伤害有效、分别叠加、都为0无加成
- **等级属性边界:** createDefaultPlayer 有效、0等级有效
- **怪物伤害边界:** 0攻击力为0、极高防御保底、miss为0
- **BOSS增伤:** 非BOSS不生效、BOSS正确放大
- **防御无视百分比:** 100%完全无视、50%半无视、0%正常计算
- **命中概率边界:** 最低5%、高闪避提高命中率

### 7. `src/utils/combo.test.ts` — 技能连招 (25 tests)
- **冷却系统:** 每秒减少1、归零时不再减少、使用后设置正确冷却
- **技能队列处理:** 冷却为0可立即用、未好不可用、多技能按顺序
- **零冷却技能:** cooldown=0 每tick可用、使用后立即可用
- **N秒冷却技能:** cooldown=5 跳过5ticks、分数tick处理
- **连续技能使用:** 同tick多技能、队列顺序、高冷却阻止低冷却
- **连击伤害计算:** combo=100->1次、combo=200->2次、combo=50->1次（最小）、combo=1000->10次
- **多段打击技能:** hitCount>1存在、连刺=2次、旋风斩=4次
- **技能执行与冷却:** 使用后设置冷却、未就绪返回普攻
- **游戏循环冷却更新:** 每tick更新、冷却中不可用、冷却好后可用

---

## Failed Tests

**None.** All 221 tests passed.

---

## Notes

- 所有测试使用 `vi.spyOn(Math, 'random').mockReturnValue()` 确保确定性
- 禁止使用 `describe.skip`/`it.skip`
- 覆盖：伤害公式、技能连招、边界状态、数值溢出
- `gameStore.test.ts` 使用 Pinia mock 和 store 依赖 mock 进行隔离测试
- `combo.test.ts` 验证了 `getPlayerHitCount` 连击次数计算
- 覆盖率最高的是 `utils/` 模块（calc/skillSystem/monsterGenerator/equipmentGenerator 达到 85-100%）
- stores 模块因依赖复杂，覆盖率较低（gameStore 约 50%）
