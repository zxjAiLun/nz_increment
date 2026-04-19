# nz_increment 迭代 11-20 开发计划

> 基于 RESEARCH_IDEAS.md 研究文档和新目标制定
> 制定日期：2026-04-10

---

## 一、目标重构摘要

### 目标1：高级抽卡系统
- 限定池 + 常驻池双轨
- 保底机制（pity counter）
- 抽卡奖励：技能碎片的稀有被动、限定属性碎片
- 保留月卡/战令，新增限定卡池主题

### 目标2：扩展养成系统
- 角色星级（1-6星）
- 觉醒阶段（每次转生解锁新阶段）
- 命座系统（6个节点，被动效果递增）
- 拆分现有角色成长数值分配给星级/觉醒/命座

### 目标3：装备系统重构
- 移除金币抽奖，装备仅从打怪掉落
- 装备属性分两类：
  - **可金币提升**：attack、defense、maxHp、speed（基础战斗属性）
  - **不可金币提升**：critRate、critDamage、penetration、dodge、trueDamage、voidDamage 等（稀有词缀）
- 精英/Boss 掉落更稀有词缀

---

## 二、迭代依赖图

```
迭代 11
  │
  ├── 迭代 12（命座/星级/觉醒数据模型）
  │     │
  │     ├── 迭代 13（装备系统重构：属性分类 + 掉落表）
  │     │     │
  │     │     ├── 迭代 14（被动技能 + 条件触发）
  │     │     │     │
  │     │     │     └── 迭代 15（装备套装效果）
  │     │     │
  │     │     └── 迭代 17（战令完善，依赖迭代12数据模型）
  │     │
  │     └── 迭代 16（每日/每周挑战）
  │
  └── 迭代 18（生命偷取独立 + 暴击曲线重调）
        │
        └── 迭代 19（伤害动画特效）

迭代 20（全局优化 + 验收）
```

---

## 迭代 11：高级抽卡系统 v1

**目标**：建立限定池 + 常驻池双轨抽卡框架，引入保底机制，定义抽卡奖励类型（技能/被动/属性碎片）。

### 依赖
- 无（可独立实施）

### 任务

**T11.1 定义抽卡数据模型（`src/types/gacha.ts`）**
```
- GachaPool: { id, name, type: 'limited'|'permanent', pity, rates, rewards[] }
- GachaReward: { id, type: 'skill'|'passive'|'statFragment'|'diamond'|'material', value, rarity? }
- GachaRecord: { timestamp, poolId, result }
- 限定池每期有主题（如"深渊征服者"），含专属奖励
```

**T11.2 实现保底计数器（`src/stores/gachaStore.ts`）**
```
- pityCounter: number（当前抽数，溢出不清零）
- pityTarget: number（保底阈值，默认 90 抽）
- softPity: number（80 抽后概率逐渐提升）
- guaranteeBonus: boolean（当前是否在保底加成区间）
- 确保保底记录持久化
```

**T11.3 实现奖池配置（`src/data/gachaPools.ts`）**
```
- 常驻池：技能书、属性碎片、金币、钻石
- 限定池1（深渊主题）：限定被动碎片、高级穿透/暴击词缀、觉醒材料
- 每池定义独立概率表
```

**T11.4 移除 `LOTTERY` 常量和相关抽奖逻辑（`src/utils/constants.ts`、`src/stores/playerStore.ts`）**
```
- 删除 LOTTERY 常量
- 删除 playerStore 中的 lottery 相关方法
- 删除 ShopTab.vue 中的金币抽奖 UI
```

**T11.5 实现抽卡 Store 方法（`src/stores/gachaStore.ts`）**
```
- pull(poolId, count: 1|10): GachaResult[]
- claimDailyFree(poolId): GachaResult | null（每日免费单抽）
- getPityProgress(poolId): { current, target, bonus }
```

**T11.6 实现抽卡 UI 组件（`src/components/GachaTab.vue`，新 Tab）**
```
- 双池切换 Tab（限定/常驻）
- 展示当前保底进度
- 10连抽动画（逐个展示）
- 抽取结果展示弹窗
- 每日免费抽标识
```

**T11.7 持久化抽卡记录（`src/stores/gachaStore.ts`）**
```
- 保存已抽取记录到 localStorage
- 展示历史记录面板
```

### 验收
- [ ] `src/types/gacha.ts` 存在且包含完整类型定义
- [ ] 抽卡使用钻石（非金币），有保底进度 UI
- [ ] 金币抽奖相关代码已移除（grep 无 LOTTERY 引用）
- [ ] 限定池与常驻池可切换，奖励不同
- [ ] 每日免费单抽逻辑存在且可正确领取

---

## 迭代 12：命座/星级/觉醒系统数据模型

**目标**：建立角色星级、觉醒阶段、命座节点的完整数据模型，为迭代 13-17 提供基础。

### 依赖
- 迭代 11（抽卡系统框架）

### 任务

**T12.1 定义角色星级/觉醒/命座类型（`src/types/character.ts`）**
```
- StarLevel: 1-6
- AscensionPhase: 0-6（对应转生次数或等级阈值）
- ConstellationNode: { id, position, unlockCost, unlockEffect: PassiveEffect }
- CharacterCultivation: {
    starLevel: StarLevel
    ascensionPhase: AscensionPhase
    constellationNodes: boolean[]（6个节点解锁状态）
    starExp: number（升至下一星所需经验）
  }
```

**T12.2 实现角色养成 Store（`src/stores/cultivationStore.ts`）**
```
- 星级提升：消耗"星魂碎片"（抽卡获得），提升属性倍率
- 觉醒阶段：达到特定转生等级自动解锁（RebirthStore 联动）
- 命座节点：消耗对应材料解锁，被动效果叠加
- 属性加成公式：
  - 星级倍率：baseStats × (1 + (starLevel - 1) × 0.15)
  - 觉醒阶段：额外 +5% 基础属性 / 阶段
```

**T12.3 数值分配重构（`src/utils/calc.ts`、`src/stores/playerStore.ts`）**
```
- 将部分原本由装备/技能提供的数值迁移到星级/觉醒
- 初始角色属性：attack=10, defense=5, maxHp=100, speed=50
- 星级倍率：每升一星 +15% 全属性（基础成长提升）
- 觉醒额外：每阶段 +5% 基础属性
```

**T12.4 星魂碎片获取途径（`src/stores/gachaStore.ts`）**
```
- 抽卡奖励中增加星魂碎片掉落
- 抽卡界面可消耗碎片进行"命座祈愿"
```

**T12.5 角色养成 UI 面板（`src/components/CultivationTab.vue`，新 Tab）**
```
- 星级展示（1-6星，星星图标）
- 觉醒阶段进度条
- 6个命座节点（未解锁/已解锁态）
- 点击节点显示解锁材料和效果描述
```

**T12.6 命座效果定义（`src/data/constellations.ts`）**
```
- 6个命座效果（递增设计）：
  - 命座1：攻击时 5% 概率眩晕敌人 1 回合
  - 命座2：暴击率 +8%
  - 命座3：暴击伤害 +20%
  - 命座4：受到致命伤害时免疫一次（CD: 60s）
  - 命座5：穿透 +15%
  - 命座6：普通攻击有 10% 概率触发"连击"（再攻击一次）
```

### 验收
- [ ] `src/types/character.ts` 定义完整
- [ ] 星级提升后战斗属性实际提升（15%/星）
- [ ] 命座节点可解锁，效果正确叠加
- [ ] CultivationTab.vue 可正常打开，≤ 400 行
- [ ] 觉醒阶段与 RebirthStore 联动（转生解锁新阶段）

---

## 迭代 13：装备系统重构

**目标**：装备仅从打怪掉落，属性分为可金币提升/不可金币提升两类，取消金币抽奖。

### 依赖
- 迭代 11（抽卡系统已移除 LOTTERY）
- 迭代 12（角色养成数据模型）

### 任务

**T13.1 定义装备属性分类（`src/types/equipment.ts`）**
```
- 可金币提升（UPGRADEABLE_STATS）：attack, defense, maxHp, speed
- 不可金币提升（LOCKED_STATS）：critRate, critDamage, penetration,
  dodge, accuracy, critResist, combo, damageBonusI/II/III,
  trueDamage, voidDamage, luck, gravityRange, gravityStrength,
  timeWarp, massCollapse, dimensionTear
```

**T13.2 修改装备掉落逻辑（`src/utils/monsterGenerator.ts`）**
```
- 普通怪物：掉落 1 件装备（可升级词缀为主）
- 精英怪物：掉落 1-2 件装备（含更多不可升级词缀）
- Boss：掉落 1 件 guaranteed 紫色+装备（大概率不可升级词缀）
- 装备等级 = monsterLevel ± 5（随机波动）
```

**T13.3 装备可升级属性加成（`src/stores/equipmentUpgradeStore.ts`）**
```
- 消耗金币提升可升级词缀数值
- 公式：newValue = baseValue + level × effectPerLevel
- 升级成本：baseCost × (1.15 ^ currentUpgradeLevel)
- 每件装备可单独升级，显示当前升级等级
```

**T13.4 装备升级 UI（`src/components/EquipmentUpgradeModal.vue`）**
```
- 点击装备打开详情
- 显示"可升级词缀"和"锁定词缀"两个区域
- 可升级词缀右侧显示升级按钮（消耗金币）
- 显示升级成本和下次升级效果预览
```

**T13.5 移除金币抽奖 UI 和逻辑（`src/components/ShopTab.vue`、`src/stores/playerStore.ts`）**
```
- 删除 ShopTab 中的"金币抽奖"区块
- 保留月卡、战令购买入口
- 保留钻石购买入口（抽卡用）
```

**T13.6 装备稀有度与词缀数量调整（`src/utils/equipmentGenerator.ts`）**
```
- 降低装备整体数值（参考 RESEARCH_IDEAS.md 建议）
- 稀有装备（legend+）才出现不可升级词缀
- common/good 装备只有可升级词缀
```

### 验收
- [ ] 装备掉落来源仅为打怪（grep 无 lottery/gold-gacha 引用）
- [ ] 可升级词缀（attack/defense/maxHp/speed）有升级按钮和花费展示
- [ ] 不可升级词缀显示为锁定状态（图标区分）
- [ ] ShopTab.vue 不包含金币抽奖区块
- [ ] 精英/Boss 掉落装备稀有度显著高于普通怪物

---

## 迭代 14：被动技能系统

**目标**：实现条件触发型被动技能，提供策略深度。

### 依赖
- 迭代 12（角色养成 + 命座效果定义）

### 任务

**T14.1 定义被动技能接口（扩展 `src/types/skill.ts`）**
```
- PassiveEffect: {
    id, name, description, type: 'conditional'|'static'|'threshold',
    condition?: ConditionExpression（解析为条件函数）,
    effect: StatBonus | 'trigger_skill' | 'special',
    priority: number（优先级）
  }
- ConditionExpression: { field, operator, value }[]
```

**T14.2 条件解析引擎（`src/utils/passiveEvaluator.ts`）**
```
- 解析 conditionExpression → (player, enemy, context) => boolean
- 支持条件：attackSpeed > X, hpPercent < X, combo > X, hasEquipmentSet('X')
- 在 gameStore 战斗循环的伤害计算前调用被动效果判定
```

**T14.3 实现 10+ 个被动技能（`src/data/passiveSkills.ts`）**
```
- "血战"：HP < 30% 时，受到伤害 -20%
- "连击狂热"：combo > 5 时，伤害 +25%
- "护甲共鸣"：每 100 点防御，反击伤害 +5%
- "暴击传导"：每 10% 暴击率，暴击伤害 +10%
- "穿透专精"：penetration > 50 时，额外 +15% 穿透伤害
- "闪避流"：闪避率 > 20% 时，闪避后下次攻击 +30% 伤害
- "暴击回响"：暴击时 20% 概率恢复 5% 最大生命
- "濒死反击"：HP < 10% 时，攻击力 +50%
- "套装共鸣"：装备指定套装 2 件，攻击速度 +5%
- "命座守护"：命座4解锁时，受到致命伤害免疫（独立CD）
```

**T14.4 被动技能装配 UI 扩展（`src/components/PassiveSkillsPanel.vue`）**
```
- 分类展示：战斗型/生存型/特殊型
- 装配槽位（最多 4 个被动技能）
- 装配时显示触发条件预览
- 战斗中被动触发时在 BattleLog 显示
```

**T14.5 被动技能来源（`src/data/passiveSkills.ts`）**
```
- 命座节点解锁（命座2/3/5）
- 抽卡奖励（被动碎片合成）
- 限定池专属被动
```

### 验收
- [ ] 被动技能条件可正确解析和触发
- [ ] PassiveSkillsPanel.vue 可正常装配/卸下被动技能
- [ ] 被动触发时 BattleLog 有记录
- [ ] 至少 8 个被动技能可正常触发（写单元测试验证）

---

## 迭代 15：装备套装系统

**目标**：实现 3 件/5 件套装效果，增加收集动力。

### 依赖
- 迭代 13（装备系统重构，属性分类完成）
- 迭代 14（被动技能系统，技能触发引擎就绪）

### 任务

**T15.1 定义套装数据（`src/data/equipmentSets.ts`）**
```
- SetDefinition: { id, name, slots: EquipmentSlot[], effects: {2: Effect, 3: Effect, 5: Effect} }
- 套装示例：
  - "战士之力"（2件：攻击+10%，3件：生命偷取+3%，5件：必杀一击）
  - "游侠敏捷"（2件：攻速+8%，3件：暴击+5%，5件：连击触发）
  - "法师智慧"（2件：技能伤害+15%，3件：冷却缩减+10%，5件：奥术飞弹）
  - "深渊征服者"（2件：穿透+10%，3件：真实伤害+5%，5件：深渊祝福）
  - "永恒守护"（2件：防御+15%，3件：减伤+8%，5件：免疫一次致命伤/30s）
```

**T15.2 套装效果计算引擎（`src/utils/equipmentSetCalculator.ts`）**
```
- 根据当前装备槽位计算激活的套装数量
- 返回已激活效果列表（2件/3件/5件）
- 与被动技能引擎协同（套装效果可作为被动触发条件）
```

**T15.3 套装效果触发（`src/stores/gameStore.ts`）**
```
- 套装效果中的"必杀一击"/"连击触发"等写入战斗日志
- 套装中的属性加成纳入 calculateTotalStats
```

**T15.4 套装 UI（`src/components/EquipmentSetPanel.vue`）**
```
- 显示已装备套装名称和当前激活件数
- 2件/3件/5件效果预览（已激活高亮）
- 点击套装名称显示详情弹窗
```

**T15.5 套装掉落权重调整（`src/utils/monsterGenerator.ts`）**
```
- 套装装备仅从精英/Boss 掉落
- 不同难度区间掉落不同系列套装
```

### 验收
- [ ] 5 套完整套装数据已定义
- [ ] 装备 2/3/5 件时属性正确叠加（测试验证）
- [ ] 套装 UI 正确显示激活状态
- [ ] 精英/Boss 掉落套装装备（普通怪物不掉落）

---

## 迭代 16：每日/每周挑战系统

**目标**：提供日常目标，增加玩家留存。

### 依赖
- 迭代 12（角色养成数据模型就绪）
- 迭代 14（被动技能触发引擎）

### 任务

**T16.1 定义挑战数据模型（`src/types/challenge.ts`）**
```
- Challenge: { id, name, description, type: 'daily'|'weekly',
    condition: ChallengeCondition, reward: AchievementReward,
    resetInterval: number }
- ChallengeProgress: { id, progress, completed, claimed }
```

**T16.2 挑战生成逻辑（`src/utils/challengeGenerator.ts`）**
```
- 每日随机抽取 3 个挑战（从挑战池）
- 每周抽取 5 个挑战
- 挑战类型：
  - 击杀挑战：击败 N 个怪物
  - 暴击挑战：暴击击杀 N 个怪物
  - 连击挑战：单次战斗达成 N 连击
  - 速通挑战：N 秒内击败当前难度怪物
  - 生存挑战：N 回合内不失血通关
  - 收集挑战：获得 N 件紫色+装备
```

**T16.3 挑战进度追踪（`src/stores/challengeStore.ts`）**
```
- 在 gameStore 战斗循环中更新挑战进度
- 每日 00:00 重置每日挑战（用 timestamp 判断）
- 每周一 00:00 重置每周挑战
```

**T16.4 挑战奖励领取（`src/stores/challengeStore.ts`）**
```
- 进度达到目标后点击"领取"获得奖励
- 奖励类型：金币、钻石、抽卡券、装备碎片
```

**T16.5 挑战 UI（`src/components/DailyChallengesPanel.vue`）**
```
- 显示当前 3 个每日挑战 + 5 个每周挑战
- 进度条展示
- 完成态/未完成态区分
- 奖励预览
```

### 验收
- [ ] 每日 00:00 挑战正确重置（测试时间跳跃）
- [ ] 挑战进度随战斗正确增加
- [ ] 完成后奖励正确发放
- [ ] DailyChallengesPanel.vue ≤ 400 行

---

## 迭代 17：战令系统完善

**目标**：扩展战令等级、赛季任务、付费/免费档分离。

### 依赖
- 迭代 12（角色养成数据模型）
- 迭代 13（装备系统重构）

### 任务

**T17.1 战令数据扩展（`src/stores/battlePassStore.ts`）**
```
- 战令等级 1-50（从 30 扩展）
- 赛季持续时间（60 天）
- 赛季任务池（累计击杀/通关/金币获取等）
- 赛季专属套装奖励（"深渊征服者"主题）
```

**T17.2 战令等级奖励（`src/data/battlePassRewards.ts`）**
```
- 免费档（每5级奖励）：金币、强化材料、抽卡券
- 付费档（每5级奖励）：限定套装碎片、钻石、被动碎片、专属头像框
- 50级奖励：限定"深渊征服者"完整套装
```

**T17.3 赛季任务系统（`src/stores/seasonTaskStore.ts`）**
```
- 赛季期间累计目标（击败1000怪物/通关100次/获取50000金币）
- 每个任务有独立进度追踪
- 完成后解锁对应战令经验
```

**T17.4 战令 UI 升级（`src/components/BattlePassTab.vue`）**
```
- 战令等级进度条（当前级/总级）
- 免费档/付费档切换标签
- 赛季任务 Tab
- 领取状态（已领/可领/未达）
```

**T17.5 赛季切换逻辑（`src/stores/battlePassStore.ts`）**
```
- 赛季结束时自动结算
- 保存赛季历史记录
- 赛季间进度不继承（全新开始）
```

### 验收
- [ ] 战令等级 1-50 可正常升级和领取
- [ ] 付费档奖励需购买才能领取（状态校验）
- [ ] 赛季结束正确重置（测试 60 天跳跃）
- [ ] BattlePassTab.vue ≤ 400 行

---

## 迭代 18：生命偷取 + 暴击曲线重调

**目标**：解决 RESEARCH_IDEAS.md 中指出的 P0 问题——生命偷取绑定幸运值、暴击曲线失衡。

### 依赖
- 迭代 14（被动技能引擎，可实现"暴击回响"等）
- 迭代 15（套装效果，含生命偷取相关）

### 任务

**T18.1 生命偷取独立化（`src/types/combat.ts`）**
```
- 新增独立属性 lifesteal: number（百分比，0-15%）
- 移除生命偷取与幸运值的绑定
- 获取途径：
  - 命座效果（命座1：+3%）
  - 套装效果（战士之力3件：+3%）
  - 被动技能（特定被动提供 +2%）
  - 紫色武器词缀（+5%）
```

**T18.2 生命偷取战斗计算（`src/utils/calc.ts`）**
```
- calculateLifesteal: 从装备/命座/套装/被动汇总
- 战斗中实际回复 = damageDealt × lifestealRate
- 上限 15%（防止溢出）
```

**T18.3 暴击成长曲线重调（`src/utils/calc.ts`）**
```
- 分段函数（参考 RESEARCH_IDEAS.md）：
  - d < 500:  每 10 难度 +1%（基础 5%）
  - d >= 500: 每 50 难度 +1%（封顶 80%）
- 暴击伤害：150% + d × 0.05（封顶 300%）
```

**T18.4 防御/穿透成长重调（`src/utils/monsterGenerator.ts`）**
```
- 防御：monsterDef = baseDef × (1 + d × 0.02)（从 1.15^x 改为线性）
- 穿透：playerPenetration += d × 0.1（线性成长）
```

**T18.5 被动技能"暴击回响"实现（`src/data/passiveSkills.ts`）**
```
- 暴击时 20% 概率恢复 5% 最大生命
- 独立冷却显示
```

### 验收
- [ ] 生命偷取不再与幸运值关联（grep 无 lifesteal × luck）
- [ ] 暴击率在难度 500 前快速成长（可感知）
- [ ] 难度 500 后暴击率缓慢成长并封顶 80%
- [ ] 防御力不再指数爆炸（对数/线性曲线）
- [ ] 单元测试验证上述数值公式

---

## 迭代 19：伤害动画特效

**目标**：实现 Diablo/Hades 风格的伤害数字动画，提升打击感。

### 依赖
- 迭代 11（抽卡 UI 基础已建立）
- 迭代 18（暴击系统正常工作）

### 任务

**T19.1 伤害弹出组件增强（`src/components/DamagePopup.vue`）**
```
- 区分伤害类型颜色：
  - 白字：普攻
  - 黄字：暴击（放大 + 震动）
  - 紫字：真伤
  - 红字：生命偷取
  - 绿字：治疗
- 大数字缩写（1,234,567 → 1.23M）
```

**T19.2 暴击震动效果（`src/components/DamagePopup.vue`）**
```
- CSS animation: crit-pop（0%→180%→150%→120%，伴随 opacity 渐变）
- 屏幕轻微震动（通过 CSS transform: translate 模拟）
```

**T19.3 伤害弹出触发点改进（`src/stores/gameStore.ts`）**
```
- 伤害弹出位置 = 怪物头像区域（x: 50%, y: 30%）
- 暴击时随机左右偏移 ±20px 增加层次感
- 多个伤害同时出现时垂直错开
```

**T19.4 真伤/虚空伤害特效（`src/components/DamagePopup.vue`）**
```
- 真伤：紫色向上飘浮动画（true-damage-penetrate）
- 虚空伤害：带紫色拖尾效果
```

**T19.5 战斗日志增强（`src/components/BattleLog.vue`）**
```
- 被动技能触发信息（"[被动] 血战：HP<30%，减伤+20%"）
- 套装效果触发信息（"[套装] 战士之力3件：生命偷取+3%"）
- 伤害数值高亮（颜色对应伤害类型）
```

### 验收
- [ ] 普攻/暴击/真伤/治疗弹出颜色正确区分
- [ ] 暴击数字有放大+震动效果
- [ ] 大数字正确缩写（K/M 单位）
- [ ] 被动触发信息在 BattleLog 显示
- [ ] DamagePopup.vue ≤ 400 行

---

## 迭代 20：全局优化 + 验收

**目标**：收尾所有功能，进行全量测试和数值平衡验证。

### 依赖
- 迭代 11-19 所有前序迭代

### 任务

**T20.1 全局 TypeScript 严格检查**
```
- tsc --strict 全量编译通过
- 无 any 类型残留
- 所有 store 方法有完整类型签名
```

**T20.2 代码行数审查**
```
- App.vue ≤ 200 行
- 所有 .vue ≤ 400 行
- 无 console.log/console.error
```

**T20.3 数值平衡验证（对比 GAME_BALANCE_REPORT.md）**
```
- 防御/穿透曲线：指数 → 线性 ✓
- 暴击成长：分段函数 ✓
- 生命偷取：独立属性 ✓
- 装备数值：整体下调 ✓
```

**T20.4 全量单元测试（Vitest）**
```
- 所有 calc.ts 公式有测试
- gachaStore 核心方法有测试
- cultivationStore 星级提升有测试
- 被动技能触发有测试
- 覆盖率 ≥ 70%
```

**T20.5 持久化迁移验证**
```
- 旧存档（v1）→ 新存档（v2）数据迁移
- gachaStore 记录迁移
- cultivationStore 新字段默认值填充
```

**T20.6 最终 UI 审查**
```
- Tab 数量和顺序合理（Gacha/Cultivation/Equip/Role/Skills/Challenges/BattlePass/Shop/Settings）
- 无死链按钮
- 响应式适配
```

**T20.7 性能审查**
```
- gameStore 战斗循环无内存泄漏
- 大量伤害弹出时 DOM 节点清理（上限 50 个）
- localStorage 写入节流
```

### 验收
- [ ] `tsc --strict` 全量通过
- [ ] App.vue ≤ 200 行，所有 .vue ≤ 400 行
- [ ] Vitest 覆盖率 ≥ 70%
- [ ] 无 console.log（grep 验证）
- [ ] 所有数值公式测试通过
- [ ] 完整功能流程跑通（开新号 → 战斗 → 抽卡 → 升级 → 挑战 → 战令）

---

## 三、关键文件变更清单

| 迭代 | 新增文件 | 修改文件 | 删除文件 |
|------|---------|---------|---------|
| 11 | src/types/gacha.ts, src/stores/gachaStore.ts, src/data/gachaPools.ts, src/components/GachaTab.vue | src/utils/constants.ts, src/stores/playerStore.ts, src/components/ShopTab.vue | - |
| 12 | src/types/character.ts, src/stores/cultivationStore.ts, src/data/constellations.ts, src/components/CultivationTab.vue | src/stores/playerStore.ts, src/utils/calc.ts | - |
| 13 | src/types/equipment.ts, src/stores/equipmentUpgradeStore.ts, src/components/EquipmentUpgradeModal.vue | src/utils/monsterGenerator.ts, src/utils/equipmentGenerator.ts, src/components/ShopTab.vue | - |
| 14 | src/types/skill.ts (扩展), src/utils/passiveEvaluator.ts, src/data/passiveSkills.ts | src/components/PassiveSkillsPanel.vue, src/stores/gameStore.ts | - |
| 15 | src/data/equipmentSets.ts, src/utils/equipmentSetCalculator.ts, src/components/EquipmentSetPanel.vue | src/stores/gameStore.ts, src/utils/calc.ts | - |
| 16 | src/types/challenge.ts, src/stores/challengeStore.ts, src/utils/challengeGenerator.ts, src/components/DailyChallengesPanel.vue | src/stores/gameStore.ts | - |
| 17 | src/data/battlePassRewards.ts, src/stores/seasonTaskStore.ts | src/stores/battlePassStore.ts, src/components/BattlePassTab.vue | - |
| 18 | src/types/combat.ts | src/utils/calc.ts, src/utils/monsterGenerator.ts, src/data/passiveSkills.ts | - |
| 19 | - | src/components/DamagePopup.vue, src/stores/gameStore.ts, src/components/BattleLog.vue | - |
| 20 | - | 全局（测试 + 审查） | - |

---

## 四、数据迁移策略

每次迭代存储版本号递增（v11 → v12 → ... → v20）。

迁移时在 `src/utils/storageManager.ts` 中：
```typescript
function migrateFromV10ToV11(save: SaveDataV10): SaveDataV11 {
  return {
    ...save,
    version: 11,
    gacha: { records: [], pityCounters: {} },
    cultivation: { starLevel: 1, ascensionPhase: 0, constellationNodes: [false]*6, starExp: 0 },
    equipmentUpgrade: {}, // 装备升级等级
    challenges: { daily: [], weekly: [], lastResetAt: Date.now() },
  }
}
```

---

## 五、约束强化检查表

| 约束 | 适用迭代 |
|------|---------|
| 单个 .vue ≤ 400 行，App.vue ≤ 200 行 | 全部 |
| 禁止 any | 全部 |
| 禁止 options API（Composition API only） | 全部 |
| 禁止 console.log | 全部 |
| 禁止直接修改原生 JS 对象 | 全部 |
| 持久化校验（每个 store 有版本号） | 全部 |
| Vitest 测试覆盖 | 全部 |
| TypeScript 严格模式 | 全部 |
