# 任务列表 - 数值平衡优化

## 一、怪物属性平衡调整

### 1.1 防御力系数调整
- [x] **任务 1.1.1**: 修改 monsterGenerator.ts 中的防御力公式
  - 将 `defense = baseValue * 6` 改为 `defense = baseValue * 3`
  - 更新注释说明
  - 验证难度0时防御为30

### 1.2 暴击率上限调整
- [x] **任务 1.2.1**: 修改 monsterGenerator.ts 中的暴击率上限
  - 将 `critRate上限 = 50` 改为 `critRate上限 = 30`
  - 验证高难度怪物的暴击率不会过高

### 1.3 BOSS属性倍率调整
- [x] **任务 1.3.1**: 修改 monsterGenerator.ts 中的BOSS属性
  - 将 `bossAttack = attack * 2` 改为 `bossAttack = attack * 1.5`
  - 将 `bossDefense = defense * 2` 改为 `bossDefense = defense * 1.2`
  - 验证BOSS战的平衡性

---

## 二、抽奖系统平衡调整

### 2.1 抽奖成本增长率优化
- [x] **任务 2.1.1**: 修改 playerStore.ts 中的抽奖成本公式
  - 将 `lotteryCost = 100 * (1.05 ^ difficulty)` 改为 `lotteryCost = 100 * (1.02 ^ difficulty)`
  - 更新十连抽成本 `cost10 = cost * 8`
  - 验证难度1000时成本约550,000

### 2.2 抽奖奖励优化
- [x] **任务 2.2.1**: 优化 doLottery 函数中的奖励分布
  - 增加基础四维属性的出现概率
  - 调整装备/属性/金币的掉落比例
  - 确保抽奖有足够的吸引力

---

## 三、穿透属性增强

### 3.1 装备穿透词条权重提升
- [x] **任务 3.1.1**: 修改 equipmentGenerator.ts 中的词条生成逻辑
  - 进阶(epic)及以上装备必定包含穿透词条
  - 调整穿透词条的数值范围
  - 验证穿透装备的出现率

### 3.2 幸运值穿透加成
- [x] **任务 3.2.1**: 修改 calc.ts 添加幸运穿透加成
  - 新增函数 `calculateLuckPenetrationBonus(luck: number): number`
  - 公式: `return luck * 0.1`
  - 在 calculateTotalStats 中应用此加成
  - 验证幸运值对穿透的影响

---

## 四、战斗系统改进

### 4.1 速度优势实现
- [x] **任务 4.1.1**: 修改 gameStore.ts 中的行动槽逻辑
  - 新增速度优势判断函数
  - 当 `playerSpeed > monsterSpeed * 1.5` 时，玩家先手
  - 当 `playerSpeed > monsterSpeed * 2` 时，额外+10%伤害
  - 添加战斗日志提示
  - 验证速度优势生效

### 4.2 生命偷取效果修复
- [x] **任务 4.2.1**: 修改 calc.ts 中的伤害计算
  - 新增 `calculateLifesteal(damage: number, rate: number): number`
  - 公式: `return damage * (rate / 100)`
  - 在 calculatePlayerDamage 中集成生命偷取
  - 在 gameStore.ts 中触发回血效果
  - 验证技能"生命汲取"正确回血

---

## 五、装备系统优化

### 5.1 装备等级缩放调整
- [x] **任务 5.1.1**: 修改 equipmentGenerator.ts 中的缩放公式
  - 将 `levelScale = 1.15 ^ (difficulty / 50)` 改为 `levelScale = 1.12 ^ (difficulty / 50)`
  - 验证装备成长曲线更平滑

### 5.2 低稀有度装备价值提升
- [x] **任务 5.2.1**: 修改 getRandomStatsForRarity 函数
  - common装备10%概率额外生成一条词条
  - good装备20%概率生成2条词条
  - 验证低稀有度装备仍有价值

---

## 六、文档与测试

### 6.1 文档更新
- [x] **任务 6.1.1**: 更新 README.md 中的数值文档
  - 更新难度对照表
  - 添加新的属性说明
  - 更新测试方法文档

### 6.2 验证测试
- [x] **任务 6.2.1**: 编写验证测试用例
  - 怪物属性验证
  - 抽奖成本验证
  - 速度优势验证
  - 生命偷取验证

---

## 任务依赖关系

```
1.1 (防御调整) → 1.2 (暴击调整) → 1.3 (BOSS调整)
3.1 (穿透词条) → 3.2 (幸运穿透)
4.1 (速度优势)
4.2 (生命偷取)
5.1 (装备缩放) → 5.2 (低稀有提升)
6.1 (文档) ← 所有其他任务
```

## 建议实施顺序

1. **第一阶段 (核心数值)**: 1.1 → 1.2 → 1.3 → 2.1 ✅ 已完成
2. **第二阶段 (战斗系统)**: 4.1 → 4.2 ✅ 已完成
3. **第三阶段 (装备系统)**: 3.1 → 3.2 → 5.1 → 5.2 → 2.2 ✅ 已完成
4. **第四阶段 (文档测试)**: 6.1 → 6.2 ✅ 已完成

---

## ✅ 完成状态

所有 13 个主要任务已全部完成！
