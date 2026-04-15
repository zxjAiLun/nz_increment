# 棒棒糖大冒险 (Lollipop Adventure)

一个基于Vue 3 + TypeScript + Pinia构建的增量/放置类RPG游戏。

## 📊 项目分析报告

### 1. 项目架构

```
nz_increment/
├── src/
│   ├── App.vue                    # 根组件 (125行)
│   ├── main.ts                   # 入口文件
│   ├── types/
│   │   └── index.ts              # 类型定义 (300行)
│   ├── stores/
│   │   ├── playerStore.ts         # 玩家状态管理 (594行)
│   │   ├── monsterStore.ts        # 怪物系统 (136行)
│   │   ├── gameStore.ts           # 战斗循环 (423行)
│   │   ├── trainingStore.ts       # 练功房系统 (161行)
│   │   ├── skillStore.ts          # 技能管理
│   │   ├── achievementStore.ts    # 成就系统
│   │   └── rebirthStore.ts        # 转生系统 (231行)
│   ├── utils/
│   │   ├── calc.ts                # 核心数值计算 (258行)
│   │   ├── equipmentGenerator.ts  # 装备生成 (172行)
│   │   ├── monsterGenerator.ts    # 怪物生成 (93行)
│   │   ├── skillSystem.ts         # 技能定义 (435行)
│   │   └── format.ts              # 格式化函数
│   ├── composables/
│   │   ├── useUpgrade.ts           # 属性升级逻辑
│   │   ├── useEquipment.ts        # 装备管理
│   │   └── useOffline.ts          # 离线收益
│   └── components/
│       ├── BattleHUD.vue           # 战斗HUD
│       ├── BattleLog.vue           # 战斗日志
│       ├── BattleTab.vue           # 战斗标签页
│       ├── ConfirmDialog.vue       # 确认对话框
│       ├── DamagePopup.vue         # 伤害弹出
│       ├── DebugPanel.vue          # 调试面板
│       ├── OverlayContainer.vue    # 弹窗/遮罩容器
│       ├── PauseOverlay.vue        # 暂停遮罩
│       ├── PlayerStatusBar.vue     # 顶部玩家状态
│       ├── RebirthModal.vue        # 转生弹窗
│       ├── RoleTab.vue             # 角色标签页
│       ├── SettingsTab.vue         # 设置标签页
│       ├── ShopTab.vue             # 商店标签页
│       ├── SkillsTab.vue           # 技能标签页
│       ├── TabNavigation.vue       # Tab导航
│       └── TabsContainer.vue       # Tab切换容器
│   ├── composables/
│   │   ├── useEquipment.ts        # 装备管理
│   │   ├── useGameLoop.ts         # requestAnimationFrame游戏循环
│   │   ├── useOffline.ts          # 离线收益
│   │   └── useUpgrade.ts          # 属性升级逻辑
│   ├── utils/
│   │   ├── constants.ts           # 集中管理魔法数字
└── package.json
```

**技术栈**：
- Vue 3 (Composition API)
- Pinia (状态管理)
- TypeScript
- Vite (构建工具)
- 原生CSS (无UI框架)

---

## 2. 核心系统分析

### 2.1 难度值系统 (Difficulty Value)

游戏使用"难度值"作为核心进度指标。

```
difficultyValue = 玩家累计击杀怪物总数
```

### 2.2 怪物属性公式

```typescript
baseValue = 10 * (1.15 ^ (difficultyValue / 10))

hp = baseValue * 100
attack = baseValue * 10
defense = baseValue * 6  // ⚠️ 问题：防御增长过快
goldReward = baseValue * 2
expReward = difficultyValue * 0.5

critRate = min(5 + difficultyValue * 0.01, 50)
critDamage = min(150 + difficultyValue * 0.1, 300)
speed = 10 + difficultyValue ^ 0.5 * 2
```

**难度对照表**：

| 难度值 | baseValue | 怪物HP | 怪物攻击 | 怪物防御 | 金币奖励 |
|--------|-----------|--------|----------|----------|----------|
| 0 | 10 | 1,000 | 100 | 60 | 20 |
| 100 | 117 | 11,700 | 1,170 | 702 | 234 |
| 500 | 909 | 90,900 | 9,090 | 5,454 | 1,818 |
| 1,000 | 2,268 | 226,800 | 22,680 | 13,608 | 4,536 |
| 5,000 | 43,871 | 4,387,100 | 438,710 | 263,226 | 87,742 |

### 2.3 玩家成长系统

**升级属性提升**：
```typescript
每级: 攻击+2, 防御+2, 生命+20, 速度+1
```

**金币购买属性**：
```typescript
upgradeCost = 10 ^ (currentCount + 1)  // 1, 10, 100, 1000...
pointsGained = floor(log10(gold + 1) * 2) + 1
```

---

## 3. 数值平衡性分析

### 3.1 杀怪金币 vs 抽奖成本

| 难度值 | 怪物金币 | 单抽成本 | 十连成本 | 击杀数/单抽 | 击杀数/十连 |
|--------|----------|----------|----------|-------------|-------------|
| 0 | 20 | 100 | 800 | 5 | 40 |
| 100 | 234 | 13,022 | 104,176 | 56 | 445 |
| 500 | 1,818 | 1,447,000 | 11,576,000 | 796 | 6,368 |
| 1,000 | 4,536 | 131,579,000 | 1,052,632,000 | 29,017 | 232,136 |

**⚠️ 问题**：抽奖成本以 `1.05^x` 指数增长，金币奖励以 `1.15^(x/10)` ≈ `1.0149^x` 增长。后期抽奖几乎不可能。

**建议**：调整单抽成本增长率为 `1.02^x` 或更低。

### 3.2 防御力 vs 穿透力失衡

**防御公式**：
```typescript
damageReduction = effectiveDef / (effectiveDef + 200)
```

| 怪物防御 | 伤害减免 | 穿透需达到 |
|----------|----------|------------|
| 200 | 50% | 200 |
| 1,000 | 83% | 1,000 |
| 5,000 | 96% | 5,000 |
| 10,000 | 98% | 10,000 |

**⚠️ 问题**：
- 怪物防御增长（baseValue × 6）远快于玩家穿透成长
- 后期普通攻击几乎打不动怪，只能靠真实伤害/虚空伤害

### 3.3 装备掉落分析

| 指标 | 当前值 | 评价 |
|------|--------|------|
| 基础掉落率 | 30% | ✅ 合理 |
| BOSS掉落率 | 30% | ⚠️ 应提高 |
| 钻石掉落率 | 1-50% | ✅ 合理 |
| 稀有度分布 | 阶梯式 | ✅ 合理 |

### 3.4 幸运值效果

| 幸运值 | 金币加成 | 装备加成 | 暴击加成 | 钻石概率 |
|--------|----------|----------|----------|----------|
| 10 (初始) | 20% | 8% | 0.8% | 0.2% |
| 100 | 200% | 80% | 8% | 2% |
| 500 | 1000% | 400% | 40% | 10% |
| 1000 | 2000% | 800% | 80% | 15% (上限) |

---

## 4. 主要玩法拆解

### 4.1 核心循环

```
击杀怪物 → 获得金币+经验 → 升级/购买属性 → 推图/练功
     ↓
  装备掉落 → 战力提升 → 更强怪物
     ↓
   转生 → 重置但保留永久属性
```

### 4.2 游戏模式

| 模式 | 描述 | 特点 |
|------|------|------|
| 主线模式 | 推进难度值 | 无限关卡，指数增长 |
| 练功房 | 固定难度刷怪 | 可调节难度，专注金币/经验 |
| 转生 | 重置进度 | 保留永久属性，获得转生点 |

### 4.3 技能系统

**当前技能池**：24个技能

| 类型 | 数量 | 代表技能 |
|------|------|----------|
| 伤害技能 | 15 | 重击、穿甲、维度斩击 |
| 增益技能 | 6 | 防御姿态、血性狂暴 |
| 治疗技能 | 3 | 生命恢复、神圣祝福 |

**技能设计问题**：
- 技能描述与实际效果不一致
- 部分技能无实战价值
- 技能冷却设计过于简单

---

## 5. 发现的问题

### 5.1 数值问题

| # | 问题 | 严重程度 | 建议 |
|---|------|----------|------|
| 1 | 怪物防御增长过快 | 🔴 高 | 降低防御增长系数或增加穿透获取 |
| 2 | 抽奖成本增长过快 | 🔴 高 | 降低增长率至1.02-1.03 |
| 3 | 真实伤害占比过高 | 🟡 中 | 增加穿透装备产出 |
| 4 | 装备等级跟不上难度 | 🟡 中 | 提高装备掉落品质 |
| 5 | 幸运值效果有限 | 🟡 中 | 增加更多幸运相关奖励 |

### 5.2 战斗系统问题

| # | 问题 | 严重程度 | 建议 |
|---|------|----------|------|
| 1 | 速度不影响先手 | 🟡 中 | 实现真正的速度优势 |
| 2 | 生命偷取未生效 | 🟡 中 | 修复技能系统 |
| 3 | 高级属性效果不明显 | 🟡 中 | 增加属性应用场景 |
| 4 | 战斗日志冗余 | 🟢 低 | 优化显示逻辑 |

### 5.3 UI/UX问题

| # | 问题 | 严重程度 | 建议 |
|---|------|----------|------|
| 1 | 界面信息过密 | 🔴 高 | 使用折叠/分页 |
| 2 | 无伤害数字动画 | 🟡 中 | 添加伤害弹出效果 |
| 3 | 装备信息显示不全 | 🟡 中 | 增加详情弹窗 |
| 4 | 无音效反馈 | 🟢 低 | 添加音效系统 |

---

## 6. 改进建议

### 6.1 数值平衡优化

```typescript
// 建议1: 降低怪物防御系数
defense = baseValue * 3  // 从6降到3

// 建议2: 降低抽奖成本增长
lotteryCost = 100 * Math.pow(1.02, difficultyValue)  // 从1.05降到1.02

// 建议3: 增加装备掉落品质
rarityBonus = difficultyValue * 0.001  // 随难度增加稀有度
```

### 6.2 战斗系统改进

```typescript
// 实现速度优势
function calculateTurnOrder(playerSpeed, monsterSpeed) {
  if (playerSpeed > monsterSpeed * 2) {
    return 'player_double_turn'  // 速度2倍以上获得双动
  } else if (playerSpeed > monsterSpeed) {
    return 'player_first'  // 速度优势先手
  }
  return 'normal'
}
```

### 6.3 UI/UX改进

- 添加装备详情弹窗（鼠标悬停显示）
- 实现伤害数字飘字效果
- 添加暂停/加速按钮
- 优化战斗日志显示
- 增加音效反馈
- 实现自动战斗开关

### 6.4 功能扩展建议

1. **技能系统重构**
   - 实现被动技能
   - 添加技能升级系统
   - 增加技能组合效果

2. **装备系统扩展**
   - 添加装备套装效果
   - 实现装备强化/进阶
   - 增加装备分解功能

3. **社交系统**
   - 成就系统扩展
   - 排行榜
   - 好友系统

---

## 7. 项目设计文档

### 7.1 核心数值系统

#### 难度值系统 (Difficulty Value)

游戏使用"难度值"作为核心进度指标，替代传统的时间/关卡系统。

```
difficultyValue = 玩家累计击杀怪物总数
```

**设计理念：**
- 单一成长指标，简化玩家理解
- 每击杀一个怪物，难度值+1
- 所有数值基于难度值进行平滑指数增长

#### 伤害计算公式

```typescript
function calculatePlayerDamage(totalStats, monster):
  // 1. 命中判定
  hitChance = max(0.05, 0.95 - monster.accuracy * 0.01 + totalStats.dodge * 0.01)
  if random() > hitChance: return 0

  // 2. 基础伤害
  damage = totalStats.attack

  // 3. 暴击
  critChance = min(totalStats.critRate - monster.critResist * 0.5, 50)
  if random() < critChance:
    critMult = max(1.2, totalStats.critDamage / 100 - monster.critResist * 0.2)
    damage *= critMult

  // 4. 增伤区加成
  damage *= (1 + totalStats.damageBonusI / 100)
  damage *= (1 + totalStats.damageBonusII / 100)
  damage *= (1 + totalStats.damageBonusIII / 100)

  // 5. 护甲计算
  effectiveDef = max(0, totalStats.defense - monster.penetration)
  damageReduction = effectiveDef / (effectiveDef + 200)
  damage *= (1 - damageReduction)
  damage = max(damage, totalStats.attack * 0.1)

  // 6. 真实伤害（穿透100%防御）
  damage += totalStats.trueDamage

  // 7. 虚空伤害（穿透防御，不暴击）
  damage += totalStats.voidDamage

  return floor(damage)
```

**防御力说明：**
- 防御200时，受到伤害降低50%
- 防御400时，受到伤害降低67%
- 防御600时，受到伤害降低75%
- 防御1000时，受到伤害降低83%

#### 装备系统

**装备等级 = 击杀怪物的难度值**

```typescript
function generateEquipment(difficultyValue):
  rarity = rollRarity()
  levelScale = 1.15 ^ (difficultyValue / 50)
  rarityScale = RARITY_MULTIPLIER[rarity]

  attack = baseAttack * levelScale * rarityScale * random(0.5, 1.5)
  defense = baseDefense * levelScale * rarityScale * random(0.5, 1.5)
  hp = baseHp * levelScale * rarityScale * random(0.5, 1.5)
```

**装备收益保证：**
- 装备提供的属性占怪物属性的40-50%比例
- 确保装备始终对玩家有提升价值

#### 练功房系统

**难度映射：**
- 练功房等级 × 10 = 难度值
- 等级1练功房 = 难度10
- 等级100练功房 = 难度1000

**难度对照表：**

| 练功房等级 | 难度值 | 相当于主线怪物等级 |
|------------|--------|-------------------|
| 1 | 10 | 10 |
| 10 | 100 | 100 |
| 50 | 500 | 500 |
| 100 | 1,000 | 1,000 |

**设计目的：**
- 练功房作为主线难度的"提前刷装区"
- 玩家可以刷低难度练功房获取高等级装备

### 属性分类

#### 基础属性 (Phase 1+)
- `attack` - 攻击力
- `defense` - 防御力
- `maxHp` - 最大生命
- `speed` - 速度（影响行动槽填充）

#### 进阶属性 (Phase 3+)
- `critRate` - 暴击率
- `critDamage` - 暴击伤害
- `penetration` - 穿透
- `dodge` - 闪避率
- `accuracy` - 必中概率
- `critResist` - 暴击抵抗
- `damageBonusI` - 增伤区I

#### 高级属性 (Phase 5+)
- `luck` - 幸运（影响金币、装备、钻石掉率）
- `voidDamage` - 虚空伤害
- `trueDamage` - 真实伤害
- `gravityRange` - 引力范围
- `gravityStrength` - 重力强度
- `combo` - 连击
- `damageBonusII` - 增伤区II

#### 终极属性 (Phase 7+)
- `timeWarp` - 时间扭曲
- `massCollapse` - 质量崩塌
- `dimensionTear` - 维度撕裂
- `damageBonusIII` - 增伤区III

### 装备稀有度

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

### 战斗机制

#### 行动槽系统
- 玩家和怪物各自有独立的行动槽
- 速度决定槽位填充速度
- 槽位满时自动执行行动

#### 技能系统
- 5个技能槽位（可扩展）
- 技能类型：伤害、治疗、增益、减益
- 技能根据解锁阶段开放

### 开发技术栈

- **框架**: Vue 3 (Composition API)
- **状态管理**: Pinia
- **语言**: TypeScript
- **构建工具**: Vite
- **样式**: 原生CSS

### 设计原则

1. **平滑成长** - 所有数值使用指数增长，但增长率控制在合理范围
2. **对称设计** - 玩家属性和怪物属性使用相似的成长曲线
3. **即时反馈** - 每次击杀都有可见的进度提升
4. **简化复杂** - 用单一难度值替代多维度进度追踪

---

## 8. 快速开始

```bash
# 安装依赖
npm install

# 开发模式
npm run dev

# 构建
npm run build

# 类型检查
npm run typecheck
```

---

## 9. 未来规划

### Phase 1: 数值平衡优化
- [ ] 调整怪物防御增长曲线
- [ ] 优化抽奖成本增长率
- [ ] 增加穿透属性获取途径
- [ ] 修复已知bug

### Phase 2: UI/UX改进
- [ ] 添加伤害数字动画
- [ ] 优化装备显示
- [ ] 添加音效系统
- [ ] 响应式布局优化

### Phase 3: 功能扩展
- [ ] 被动技能系统
- [ ] 装备套装效果
- [ ] 公会系统
- [ ] 多人副本

---

## 10. 平衡性关键结论（2026-04-10 深度分析）

> 详细分析见 `GAME_BALANCE_REPORT.md`，新功能设计见 `NEW_FEATURES_DESIGN.md`

### 核心发现

1. **防御体系崩溃（难度 300+）**
   - 怪物防御公式 `baseValue × 3` 导致难度 500 时防御值达 32,509
   - 玩家穿透仅从幸运值获得（`floor(luck × 0.1)`），满幸运 1000 仅提供 100 点穿透
   - 有效防御 = 32,509 - 100 = 32,409，减伤比例 99.4%，普攻伤害从 1,010 降至约 6 点
   - 难度 500 怪物 HP = 108 万，普通攻击需要约 18 万次才能击杀（不切实际）

2. **生命偷取机制无效**
   - 当前绑定于幸运值：`luck × 0.008%`，满幸运 1000 仅有 8%/次
   - 高难度普攻伤害个位数，实际回血 < 1 HP/次，完全无意义
   - 需要独立 lifesteal 属性来源（装备+技能）

3. **暴击率成长形同虚设**
   - 基础 5%，每难度 +0.01%，上限 30%（代码 cap）
   - 需 difficulty 2,500 才达到上限，普通游戏进度几乎感知不到暴击成长
   - 幸运值虽可提供额外暴击（`luck × 0.08%`），但投入产出比极低

4. **抽奖成本指数膨胀（已修复预期）**
   - 旧公式 `100 × 1.005^difficulty` 在高难度下成本极高
   - 建议调整为 `50 × 1.002^difficulty`，可降低 80-90% 成本

5. **速度属性缺乏实际战斗效果**
   - 战斗规则写明速度比 ≥2 双动先手，但 gameStore.ts 未完全实现
   - 速度主要影响行动槽填充，实际战斗差异不显著

### 建议优先修复

| 优先级 | 问题 | 修复方案 |
|--------|------|---------|
| P0 | 防御崩溃 | 怪物防御 baseValue×3 → ×1.5，穿透独立成长 |
| P0 | 生命偷取失效 | 独立 lifesteal 属性，装备/技能提供 |
| P1 | 暴击无感 | 移除 30% cap，提升至 75% |
| P1 | 速度无感 | 完整实现先手/双动机制 |
| P2 | 抽奖成本高 | 降低增长率至 1.002 |
