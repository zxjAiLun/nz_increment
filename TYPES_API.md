# API 参考文档

本文档详细说明 nz_increment 项目中的所有类型定义、接口和常量。

---

## 稀有度 (Rarity)

```typescript
type Rarity = 'common' | 'good' | 'fine' | 'epic' | 'legend' | 'myth' | 'ancient' | 'eternal'
```

| 稀有度 | 强度倍率 | 词条数量 | 颜色 |
|--------|----------|----------|------|
| common | 1x | 1条 | #9d9d9d |
| good | 2x | 1-2条 | #4dff4d |
| fine | 4x | 2条 | #4d9dff |
| epic | 8x | 2-3条 | #9d4dff |
| legend | 16x | 3条 | #ff9d4d |
| myth | 32x | 3-4条 | #ff4d9d |
| ancient | 64x | 4条 | #ffd700 |
| eternal | 128x | 4-5条 | #00ffff |

---

## 装备槽位 (EquipmentSlot)

```typescript
type EquipmentSlot = 
  | 'head' | 'neck' | 'shoulder' | 'chest' | 'back'
  | 'hand' | 'waist' | 'legs' | 'leftHand' | 'rightHand'
  | 'ringLeft' | 'ringRight'
```

| 槽位 | 中文名 |
|------|--------|
| head | 头部 |
| neck | 颈部 |
| shoulder | 肩部 |
| chest | 胸部 |
| back | 背部 |
| hand | 手部 |
| waist | 腰部 |
| legs | 腿部 |
| leftHand | 左手 |
| rightHand | 右手 |
| ringLeft | 左戒指 |
| ringRight | 右戒指 |

---

## 属性类型 (StatType)

### 基础属性 (Phase 1+)

| 属性名 | 类型 | 说明 | 初始值 |
|--------|------|------|--------|
| attack | 数值 | 攻击力 | 10 |
| defense | 数值 | 防御力 | 5 |
| maxHp | 数值 | 最大生命 | 100 |
| speed | 数值 | 速度（影响行动槽填充） | 10 |
| luck | 数值 | 幸运（影响金币/装备/钻石掉率） | 10 |

### 进阶属性 (Phase 3+)

| 属性名 | 类型 | 说明 | 初始值 |
|--------|------|------|--------|
| critRate | % | 暴击率（上限95%） | 5% |
| critDamage | % | 暴击伤害倍率 | 150% |
| penetration | 数值 | 穿透（直接削减怪物防御） | 0 |
| dodge | % | 闪避率（上限80%） | 0 |
| accuracy | % | 必中概率（上限100%） | 0 |
| critResist | % | 暴击抵抗 | 0 |
| damageBonusI | % | 增伤区I | 0 |

### 高级属性 (Phase 5+)

| 属性名 | 类型 | 说明 |
|--------|------|------|
| combo | 数值 | 连击（影响命中次数） |
| luck | 数值 | 幸运值 |
| voidDamage | 数值 | 虚空伤害（穿透防御，不暴击） |
| trueDamage | 数值 | 真实伤害（穿透防御，不暴击） |
| gravityRange | 数值 | 引力范围 |
| gravityStrength | 数值 | 重力强度 |
| damageBonusII | % | 增伤区II |

### 终极属性 (Phase 7+)

| 属性名 | 类型 | 说明 |
|--------|------|------|
| timeWarp | % | 时间扭曲 |
| massCollapse | 数值 | 质量崩塌 |
| dimensionTear | 数值 | 维度撕裂 |
| damageBonusIII | % | 增伤区III |

---

## 核心接口

### StatBonus（词条）

```typescript
interface StatBonus {
  type: StatType       // 属性类型
  value: number        // 属性值
  isPercent: boolean   // 是否为百分比属性
}
```

### Equipment（装备）

```typescript
interface Equipment {
  id: string           // 唯一标识
  slot: EquipmentSlot // 装备槽位
  name: string         // 装备名称
  rarity: Rarity       // 稀有度
  level: number        // 装备等级（=掉落时的难度值）
  stats: StatBonus[]   // 词条列表
  isLocked: boolean    // 是否锁定（锁定后不会自动替换）
}
```

### Skill（技能）

```typescript
interface Skill {
  id: string
  name: string
  description: string
  type: SkillType       // 'damage' | 'heal' | 'buff' | 'debuff'
  damageMultiplier: number    // 伤害倍率
  ignoreDefense: boolean      // 是否无视防御
  defenseIgnorePercent: number // 防御无视百分比
  trueDamage: number         // 附加真实伤害
  cooldown: number           // 冷却时间
  currentCooldown: number     // 当前冷却（tick计数）
  unlockPhase: number        // 解锁阶段
  hitCount: number           // 命中次数
  healPercent: number        // 治疗百分比
  buffEffect?: {            // 增益效果（可选）
    stat: StatType
    percentBoost: number
    duration: number
  }
}
```

### Monster（怪物）

```typescript
interface Monster {
  id: string
  name: string
  level: number
  phase: number
  maxHp: number
  currentHp: number
  attack: number
  defense: number
  speed: number
  critRate: number
  critDamage: number
  critResist: number
  penetration: number
  accuracy: number
  dodge: number
  goldReward: number
  expReward: number
  equipmentDropChance: number
  diamondDropChance: number
  isBoss: boolean
  isTrainingMode: boolean
  trainingDifficulty: 'easy' | 'medium' | 'hard' | null
  skills: string[]
}
```

### Player（玩家）

```typescript
interface Player {
  id: string
  name: string
  level: number
  experience: number
  currentHp: number
  maxHp: number
  stats: PlayerStats       // 基础属性
  gold: number
  diamond: number
  equipment: Partial<Record<EquipmentSlot, Equipment>>
  skills: (Skill | null)[] // 5个技能槽
  unlockedPhases: number[]
  totalKillCount: number
  totalComboCount: number
  maxComboCount: number
  totalOnlineTime: number
  totalOfflineTime: number
  lastLoginTime: number
  offlineEfficiencyBonus: number
}
```

### PlayerStats（玩家属性汇总）

```typescript
interface PlayerStats {
  size: number
  attack: number
  defense: number
  maxHp: number
  speed: number
  critRate: number
  critDamage: number
  penetration: number
  dodge: number
  accuracy: number
  critResist: number
  combo: number
  damageBonusI: number
  damageBonusII: number
  damageBonusIII: number
  luck: number
  gravityRange: number
  gravityStrength: number
  voidDamage: number
  trueDamage: number
  timeWarp: number
  massCollapse: number
  dimensionTear: number
}
```

---

## 核心计算函数 (utils/calc.ts)

### calculatePlayerDamage

```typescript
calculatePlayerDamage(
  player: Player,
  totalStats: PlayerStats,
  monster: Monster,
  ignoreDefense?: boolean,
  defenseIgnorePercent?: number,
  skillDamageBonus?: number,
  bossDamageBonus?: number
): number
```

**计算顺序**：
1. 命中判定：`hitChance = max(0.05, 0.95 - monster.accuracy * 0.01 + totalStats.dodge * 0.01)`
2. 基础伤害 = `totalStats.attack`
3. 暴击：`critMult = max(1.2, totalStats.critDamage / 100 - monster.critResist * 0.2)`
4. 增伤：`damage *= (1 + (damageBonusI + damageBonusII + damageBonusIII + skillDamageBonus) / 100)`
5. 护甲：`damageReduction = effectiveDefense / (effectiveDefense + 200)`，最低保底10%
6. 真实伤害 + 虚空伤害（最后加入）

### calculateMonsterDamage

```typescript
calculateMonsterDamage(monster: Monster, player: Player, totalStats: PlayerStats): number
```

### calculateTotalStats

```typescript
calculateTotalStats(player: Player): PlayerStats
```

合并基础属性 + 装备属性 + 幸运穿透加成。

### calculateEquipmentScore

```typescript
calculateEquipmentScore(equipment: Equipment): number
```

评分 = Σ(词条值 / 词条基础值 × 稀有度倍率)

### isEquipmentBetter

```typescript
isEquipmentBetter(newEq: Equipment, oldEq: Equipment | null, threshold?: number): boolean
```

新装备评分 > 旧装备评分 × threshold 时返回 true。

### calculateLuckEffects

```typescript
calculateLuckEffects(luck: number): {
  goldBonus: number,
  equipmentDropBonus: number,
  diamondDropChance: number,
  critBonus: number
}
```

### calculateOfflineReward

```typescript
calculateOfflineReward(player: Player, offlineSeconds: number): { gold: number, exp: number }
```

离线时间分段倍率：
- < 1小时：1x
- ≥ 1小时：金币1.5x / 经验1.2x
- ≥ 4小时：金币2.0x / 经验1.5x
- ≥ 8小时：金币2.5x / 经验2.0x

---

## 常量

### RARITY_MULTIPLIER

```typescript
const RARITY_MULTIPLIER: Record<Rarity, number> = {
  common: 1,
  good: 2,
  fine: 4,
  epic: 8,
  legend: 16,
  myth: 32,
  ancient: 64,
  eternal: 128
}
```

### PHASE_NAMES

```typescript
const PHASE_NAMES = [
  '', '建筑物', '城市', '地理', '星球', '恒星系', '星系', '宇宙'
]
```

### PHASE_UNLOCK

```typescript
const PHASE_UNLOCK: Record<StatCategory, number> = {
  basic: 1,       // Phase 1 解锁
  advanced: 3,     // Phase 3 解锁
  high: 5,         // Phase 5 解锁
  ultimate: 7      // Phase 7 解锁
}
```

### 难度公式

```typescript
// 基础值
baseValue = 10 * (1.15 ^ (difficultyValue / 10))

// 怪物属性
hp = baseValue * 100
attack = baseValue * 10
defense = baseValue * 3  // ⚠️ 实际为3，README曾误写为6
goldReward = baseValue * 2
expReward = difficultyValue * 0.5

// 怪物暴击
critRate = min(5 + difficultyValue * 0.01, 50)
critDamage = min(150 + difficultyValue * 0.1, 300)

// 幸运效果
goldBonus = luck * 0.02
equipmentDropBonus = luck * 0.008
diamondDropChance = min(luck * 0.0002, 0.15)
critBonus = luck * 0.08

// 护甲公式
damageReduction = effectiveDef / (effectiveDef + 200)
```
