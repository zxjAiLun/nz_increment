# 数值设计文档

> 记录游戏核心数值框架与平衡设计思路，供后续内容扩展参考。

---

## 1. 难度值系统

**难度值（Difficulty Value）** = 玩家累计击杀怪物总数

所有数值基于难度值进行指数增长，是游戏的单一进度指标。

### 基础增长公式

```
baseValue = 10 × 1.15^(difficulty / 10)
```

### 怪物属性

| 属性 | 公式 |
|------|------|
| HP | baseValue × 100 |
| 攻击 | baseValue × 10 |
| 防御 | baseValue × 3 |
| 金币奖励 | baseValue × 2 |
| 经验奖励 | difficulty × 0.5 |

### 难度对照表

| 难度值 | baseValue | 怪物HP | 怪物攻击 | 怪物防御 | 金币奖励 |
|--------|-----------|--------|----------|----------|----------|
| 0 | 10 | 1,000 | 100 | 30 | 20 |
| 100 | 117 | 11,700 | 1,170 | 351 | 234 |
| 500 | 909 | 90,900 | 9,090 | 2,727 | 1,818 |
| 1,000 | 2,268 | 226,800 | 22,680 | 6,804 | 4,536 |
| 5,000 | 43,871 | 4,387,100 | 438,710 | 131,613 | 87,742 |

---

## 2. 伤害计算

### 公式概览

```
1. 命中判定
   hitChance = max(0.05, 0.95 - monsterAccuracy×0.01 + playerDodge×0.01)

2. 基础伤害 = 攻击

3. 暴击
   critChance = min(playerCritRate - monsterCritResist×0.5, 80%)
   critMult = max(1.2, playerCritDamage/100 - monsterCritResist×0.2)

4. 增伤区加成
   damage ×= (1 + damageBonusI/100)
   damage ×= (1 + damageBonusII/100)
   damage ×= (1 + damageBonusIII/100)

5. 护甲计算
   effectiveDef = max(0, playerDefense - monsterPenetration)
   damageReduction = effectiveDef / (effectiveDef + 200)
   damage ×= (1 - damageReduction)
   damage = max(damage, playerAttack × 0.1)  // 最低伤害保底

6. 真实伤害（穿透100%防御，不暴击）
   damage += trueDamage

7. 虚空伤害（穿透防御，不暴击）
   damage += voidDamage
```

### 防御力-减伤曲线

| 防御力 | 减伤比例 |
|--------|----------|
| 200 | 50% |
| 400 | 67% |
| 600 | 75% |
| 1,000 | 83% |
| 2,000 | 91% |

---

## 3. 暴击率与暴击伤害

### 暴击率曲线（iter-18 调整后）

```
d < 500:  critRate = 5 + d × 0.01, 上限 50%
d ≥ 500:  critRate = 5 + 50 + (d-500) × 0.01, 上限 80%
```

| 难度值 | 暴击率 |
|--------|--------|
| 0 | 5% |
| 500 | 50% |
| 1,000 | 55% |
| 3,000 | 75% |
| 3,000+ | 80%（上限） |

### 暴击伤害

```
critDamage = 150 + d × 0.05, 上限 300
```

---

## 4. 防御与穿透

### 防御力（iter-18 调整后）

```
defense = 20 + d × 0.02
```

对比：旧版使用 `baseValue × 3`，导致难度 500 时防御值高达 32,509，严重破坏平衡。

### 穿透

```
penetration = d × 0.1
```

---

## 5. 生命偷取（iter-18 独立化）

从幸运值解绑，改为独立属性来源：
- 上限：**15%**
- 来源：装备词条、被动技能

---

## 6. 装备系统

### 装备等级

装备等级 = 掉落时击杀怪物的难度值

### 稀有度倍率

| 稀有度 | 词条数量 | 强度倍率 |
|--------|----------|----------|
| common | 1 | 1x |
| good | 1-2 | 2x |
| fine | 2 | 4x |
| epic | 2-3 | 8x |
| legend | 3 | 16x |
| myth | 3-4 | 32x |
| ancient | 4 | 64x |
| eternal | 4-5 | 128x |

### 装备属性分类

**可升级属性**（消耗金币提升）：
- 攻击、防御、最大生命、速度

**不可升级属性**（固定，随装备掉落）：
- 暴击率、暴击伤害、穿透、闪避、必中、暴击抵抗
- 幸运、虚空伤害、真实伤害、连击
- 增伤区I/II/III、时间扭曲、质量崩塌、维度撕裂

---

## 7. 抽卡系统

### 保底机制

| 保底类型 | 条件 |
|----------|------|
| 硬保底 | 90 抽必出 4-5 星 |
| 软保底 | 80 抽起概率逐渐增加 |

### 抽卡成本

```
单抽成本 = 50 × 1.002^difficulty
```

---

## 8. 属性分类总览

| 阶段 | 属性 |
|------|------|
| 基础 (Phase 1+) | attack, defense, maxHp, speed |
| 进阶 (Phase 3+) | critRate, critDamage, penetration, dodge, accuracy, critResist, damageBonusI |
| 高级 (Phase 5+) | luck, voidDamage, trueDamage, gravityRange, gravityStrength, combo, damageBonusII |
| 终极 (Phase 7+) | timeWarp, massCollapse, dimensionTear, damageBonusIII |

---

## 9. 练功房系统

练功房等级 × 10 = 对应难度值

| 练功房等级 | 难度值 |
|------------|--------|
| 1 | 10 |
| 10 | 100 |
| 50 | 500 |
| 100 | 1,000 |

练功房允许在低于主线难度的环境下刷取高等级装备。

---

## 10. 关键平衡结论

### 已修复

1. **防御崩溃**：旧版防御增长过快（baseValue×3），iter-18 调整为 `20 + d×0.02`
2. **暴击率上限**：从 30% 提升至 80%
3. **生命偷取失效**：从幸运值解绑，设为独立属性，上限 15%
4. **抽卡成本膨胀**：增长率从 1.005 降至 1.002

### 待关注

- 穿透成长是否能跟上怪物防御
- 高级/终极属性在实际战斗中的效果显著性
- 速度属性对战斗节奏的实际影响
