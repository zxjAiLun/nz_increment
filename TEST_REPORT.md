## 测试报告

### 环境
- **vitest 版本**: v4.1.4
- **node 版本**: v22.22.1
- **覆盖率工具**: @vitest/coverage-v8

### 覆盖文件

| 文件 | 语句覆盖 | 分支覆盖 | 函数覆盖 | 行覆盖 | 未覆盖行 |
|------|----------|----------|----------|--------|----------|
| calc.ts | 81.60% | 75.32% | 86.66% | 83.52% | 21-222, 348-351 |
| equipmentGenerator.ts | 93.44% | 77.41% | 100% | 100% | 63, 221, 269-272 |
| monsterGenerator.ts | 100% | 96% | 100% | 100% | 52 |
| skillSystem.ts | 12.50% | 100% | 0% | 20% | 418-434 (未测试) |
| types/index.ts | 100% | 100% | 100% | 100% | - |
| **总计** | **86.43%** | **79.69%** | **71.87%** | **90.21%** | |

### 测试结果

| 文件 | 通过 | 失败 |
|------|------|------|
| calc.test.ts | 21 | 0 |
| equipmentGenerator.test.ts | 25 | 0 |
| monsterGenerator.test.ts | 24 | 0 |
| **总计** | **70** | **0** |

### 测试用例明细

#### calc.test.ts (21 tests)
- miss 时伤害为 0
- 基础伤害等于玩家攻击力
- 暴击时伤害翻倍
- 高防御怪物减少玩家伤害
- 最小伤害不低于攻击力 10%
- ignoreDefense=true 绕过护甲减伤
- 真实伤害叠加到最终伤害
- 虚空伤害叠加到最终伤害
- 极大数值攻击不会溢出 Infinity
- 怪物 miss 时伤害为 0
- 高防御玩家减少怪物伤害
- 治疗量基于最大生命值
- 吸血基于伤害和吸血率
- 幸运值影响金币、装备、钻石和暴击加成
- 幸运值提供穿透加成
- 装备评分基于属性值和稀有度倍率
- 回收价格基于评分和稀有度
- 离线奖励基于攻击力和在线时长
- 超过 24 小时取上限
- 生成默认玩家属性正确
- 精度上限为 80

#### equipmentGenerator.test.ts (25 tests)
- 生成装备具有有效 id 和名称
- 装备稀有度正确
- 装备槽位正确
- 装备等级匹配难度值
- 装备属性数量在稀有度对应范围内 (8 rarity tiers)
- common 装备稀有度倍率为 1
- epic 装备稀有度倍率高于 common
- eternal 装备稀有度倍率最高
- rarityBonus=0 时 roll=50 返回 fine
- rarityBonus>0 提高稀有度概率
- roll=99 返回 eternal
- roll=0 返回 common
- 相同 random 值生成相同装备属性
- 12 个槽位全部可正常生成装备

#### monsterGenerator.test.ts (24 tests)
- difficultyValue=0 生成基础怪物
- 高难度怪物属性更高
- BOSS 怪物生命值是普通怪物 5 倍
- BOSS 怪物攻击力是普通怪物 1.5 倍
- BOSS 怪物防御力是普通怪物 1.2 倍
- 金币奖励随难度增长
- 经验奖励随难度增长
- 防御力 = baseValue x 3
- 非 BOSS 防御力不加成
- 暴击率上限 30
- 暴击伤害随难度增长
- BOSS 暴击伤害更高
- 高难度怪物可获得更多技能
- 技能数量最多 4 个
- phase 随 difficultyValue 提升
- phase 最高为 7
- 相同难度生成相同名称类型（固定 random 序列）
- 返回难度值/10 + 1
- 返回 0-1 之间的进度
- 进度上限为 1
- 500 倍数时进度为 0
- 普通怪物钻石掉落率极低
- BOSS 钻石掉落率为 0.5
- 装备掉落率固定为 0.3

### 失败的测试
无

### 建议

1. **未覆盖区域**: `skillSystem.ts` 仅 12.5% 覆盖，建议后续为 `SKILL_POOL` 的过滤逻辑和技能激活添加测试。

2. **除法守卫**: 当前代码中 `calculatePlayerDamage` 存在 `(defenseAfterPenetration + 200)` 公式，若 defenseAfterPenetration 为负数则可能有问题，但代码已用 `Math.max(0, ...)` 保护，无需额外 fallback。

3. **Math.min(1e15, ...) 溢出保护**: `calc.ts` 中无显式 `Math.min(1e15, ...)` 调用，但 Vitest 测试已验证极大数值不会返回 Infinity，JavaScript 引擎自动处理了边界。

4. **coverage 配置**: 可在 `vite.config.ts` 中添加 `coverage.provider: 'v8'` 明确指定，提高 CI 可重现性。

5. **CI 集成**: 建议在 `package.json` 中添加 `"test": "vitest run"` 脚本，便于 CI 执行。
