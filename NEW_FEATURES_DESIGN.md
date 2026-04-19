# nz_increment 新功能设计文档

---

## Phase A: 短期（迭代 2-4）

### A1. 速度先手系统

**设计目标**: 让速度属性在战斗中有实际存在感，当前速度仅影响行动槽填充速度，优势不够显著。

**方案**:

- 速度比（玩家速度 / 怪物速度）≥ 2: 玩家先手 + 该回合伤害 +50%
- 速度比 ≥ 3: 玩家必定先手，该回合执行双行动
- 速度比 ≥ 4: 额外获得 10% 回避率

**技术实现**:

```typescript
// composables/useSpeedAdvantage.ts
export interface SpeedAdvantage {
  firstStrike: boolean      // 是否先手
  doubleTurn: boolean       // 是否双动
  damageBonus: number       // 伤害加成（0.5 = +50%）
  dodgeBonus: number        // 回避加成
}

export function calculateSpeedAdvantage(
  playerSpeed: number,
  monsterSpeed: number
): SpeedAdvantage {
  const ratio = playerSpeed / monsterSpeed

  if (ratio >= 4) {
    return { firstStrike: true, doubleTurn: true, damageBonus: 0.5, dodgeBonus: 10 }
  }
  if (ratio >= 3) {
    return { firstStrike: true, doubleTurn: true, damageBonus: 0.5, dodgeBonus: 0 }
  }
  if (ratio >= 2) {
    return { firstStrike: true, doubleTurn: false, damageBonus: 0.5, dodgeBonus: 0 }
  }
  if (ratio >= 1.5) {
    return { firstStrike: true, doubleTurn: false, damageBonus: 0, dodgeBonus: 0 }
  }
  return { firstStrike: false, doubleTurn: false, damageBonus: 0, dodgeBonus: 0 }
}
```

**在 `gameStore.ts` 伤害计算中的集成**:

```typescript
// 每次行动前检查速度优势
const advantage = calculateSpeedAdvantage(totalStats.speed, monster.speed)
if (advantage.firstStrike) {
  // 先手逻辑
}
// 伤害加成
const finalDamage = calculatePlayerDamage(...) * (1 + advantage.damageBonus)
```

---

### A2. 装备套装效果

**设计目标**: 增加装备收集动力，目前 8 个稀有度各独立无关联，收集动力不足。

**方案**: 6 套套装，每套 2 件 + 4 件效果

| 套装名 | 触发条件 | 2件效果 | 4件效果 | 核心属性 |
|--------|----------|---------|---------|---------|
| 战士套 | 任意 2/4 件 | 攻击+10% | 攻击+30%，暴击+5% | 攻击、暴击 |
| 守护套 | 任意 2/4 件 | 防御+10% | 防御+30%，减伤+5% | 防御、生命 |
| 疾风套 | 任意 2/4 件 | 速度+10% | 速度+30%，先手率+15% | 速度、先手 |
| 吸血套 | 任意 2/4 件 | 生命偷取+3% | 生命偷取+10% | 生命偷取 |
| 暴怒套 | 任意 2/4 件 | 暴击+5% | 暴击+15%，暴伤+25% | 暴击、暴伤 |
| 虚空套 | 任意 2/4 件 | 真实伤害+5% | 真实伤害+20%，穿透+50 | 真实伤害、穿透 |

**技术实现**:

```typescript
// types/index.ts
export interface SetBonus {
  name: string
  minPieces: number
  effect: Partial<PlayerStats>  // 属性加成
}

// equipmentGenerator.ts 新增
export const EQUIPMENT_SETS: Record<string, SetBonus[]> = {
  warrior: [
    { name: '战士之心', minPieces: 2, effect: { attack: 0, attackPercent: 10 } },
    { name: '战士之魂', minPieces: 4, effect: { attack: 0, attackPercent: 30, critRate: 5 } }
  ],
  guardian: [...],
  swift: [...],
  lifesteal: [
    { name: '吸血之牙', minPieces: 2, effect: { lifesteal: 3 } },
    { name: '吸血之魂', minPieces: 4, effect: { lifesteal: 10 } }
  ],
  berserker: [...],
  void: [...]
}

// 计算套装加成
export function calculateSetBonuses(equipment: Equipment[]): Partial<PlayerStats> {
  // 统计各套装件数，应用最高档位效果
}
```

---

### A3. 被动技能系统

**设计目标**: 丰富技能策略维度，当前技能均为主动技能，无被动/光环效果。

**方案**: 首批 8 个被动技能，通过通关指定难度解锁

| 被动名 | 效果 | 解锁条件 | 稀有度 |
|--------|------|---------|--------|
| 铁壁 | 防御+5%（每 100 防御额外+1%，叠加上限 20%） | 通关难度 100 | common |
| 狂暴 | 生命 < 30% 时攻击+30% | 通关难度 200 | good |
| 灵敏 | 速度+10% | 通关难度 300 | fine |
| 吸血 | 生命偷取+2% | 通关难度 400 | fine |
| 连击 | 10% 概率额外攻击一次（50% 伤害） | 通关难度 500 | epic |
| 穿透 | 穿透+20 | 通关难度 600 | epic |
| 幸运 | 金币获取+10% | 通关难度 700 | legend |
| 坚韧 | 受到伤害-5% | 通关难度 800 | legend |

**技术实现**:

```typescript
// types/index.ts 新增
export interface PassiveSkill {
  id: string
  name: string
  description: string
  rarity: Rarity
  unlockDifficulty: number  // 解锁难度值
  effect: PassiveEffect
}

export type PassiveEffect =
  | { type: 'flat_stat'; stat: StatType; value: number }
  | { type: 'percent_stat'; stat: StatType; value: number }
  | { type: 'conditional'; condition: string; stat: StatType; value: number }
  | { type: 'proc'; procChance: number; effect: PassiveEffect }

// passiveSkills.ts
export const PASSIVE_SKILL_POOL: PassiveSkill[] = [
  {
    id: 'passive_iron_wall',
    name: '铁壁',
    description: '防御+5%，每 100 防御额外+1%（叠加上限 20%）',
    rarity: 'common',
    unlockDifficulty: 100,
    effect: {
      type: 'percent_stat',
      stat: 'defense',
      value: 5
    }
  },
  {
    id: 'passive_berserk',
    name: '狂暴',
    description: '生命低于 30% 时攻击+30%',
    rarity: 'good',
    unlockDifficulty: 200,
    effect: {
      type: 'conditional',
      condition: 'hp_below_30',
      stat: 'attack',
      value: 30
    }
  },
  // ... 以此类推
]

// skillStore.ts 新增
export const usePassiveSkillStore = defineStore('passive', {
  state: () => ({
    unlockedPassives: [] as string[],
    equippedPassives: [null, null] as [string | null, string | null]
  }),
  getters: {
    totalPassiveEffects(): Partial<PlayerStats> {
      // 计算已装备被动技能的总效果
    }
  }
})
```

---

## Phase B: 中期（迭代 5-7）

### B1. 每日挑战

**设计目标**: 提供每日目标，增加日活动力。

**方案**: 每天 00:00（本地时间）随机生成 3 个挑战

| 挑战类型 | 目标 | 奖励 |
|---------|------|------|
| 击杀任务 | 击杀 50 个怪物 | 100 钻石 |
| 精准挑战 | 单次战斗不受伤害通关 1 次 | 150 钻石 |
| 伤害任务 | 累计造成 50,000 伤害 | 200 钻石 |
| 生存挑战 | 单次战斗不死亡通关 1 次 | 150 钻石 |
| 连击任务 | 单次战斗连击数达到 50 | 200 钻石 |

```typescript
// dailyChallengeStore.ts
export interface DailyChallenge {
  id: string
  type: 'kill' | 'no_damage' | 'damage' | 'survive' | 'combo'
  target: number
  progress: number
  completed: boolean
  reward: number  // 钻石数量
  resetAt: number // 重置时间戳
}
```

### B2. 月卡/战令系统

**月卡**:

- 售价: 30 元（或 300 钻石）
- 有效期: 30 天
- 权益:
  - 每日登录奖励: 100 钻石 + 50,000 金币
  - 离线收益 +10%
  - 月卡专属装备抽卡池（仅月卡玩家可访问）

**战令（Pass 系统）**:

- 分免费档 / 付费档（68 元）
- 战令等级 1-50，完成任务获取经验升级
- 免费档: 基础奖励（装备/金币/材料）
- 付费档: 额外奖励（稀有装备/钻石/专属外观/专属被动技能）

### B3. 收藏品图鉴

**设计目标**: 收集动力 + 属性奖励。

```typescript
// achievementCollectionStore.ts
export interface CollectionEntry {
  id: string
  category: 'monster' | 'equipment' | 'skill'
  name: string
  unlocked: boolean
  unlockedAt?: number
}

// 图鉴奖励
const COLLECTION_REWARDS = {
  monster: { 25: { allStatPercent: 2 }, 50: { allStatPercent: 5 }, 100: { allStatPercent: 10 } },
  equipment: { 25: { allStatPercent: 2 }, 50: { allStatPercent: 5 }, 100: { allStatPercent: 10 } },
  skill: { 25: { allStatPercent: 2 }, 50: { allStatPercent: 5 }, 100: { allStatPercent: 10 } }
}
```

- 收集怪物种类 25%: 全属性+2%
- 收集装备种类 50%: 全属性+5%
- 收集技能种类 100%: 全属性+10%

---

## Phase C: 长期（迭代 8-10）

### C1. 公会系统（纯前端）

**功能**:

- 创建公会（消耗 10,000 金币）
- 加入/离开公会
- 公会成员列表（最多 20 人）
- 公会战排行（基于累计难度值）
- 公会捐赠: 每日可向公会捐赠金币，获得公会币
- 公会商店: 用公会币兑换材料/装备

```typescript
// guildStore.ts
export interface Guild {
  id: string
  name: string
  leaderId: string
  members: GuildMember[]
  totalPower: number  // 公会成员累计难度值之和
  createdAt: number
}
```

### C2. 活动框架

**可配置活动系统**:

```typescript
// eventSystem.ts
export interface GameEvent {
  id: string
  name: string
  startAt: number
  endAt: number
  type: 'double_gold' | 'double_drop' | 'new_gacha' | 'limited_challenge'
  config: Record<string, unknown>
}
```

- 双倍金币活动: 所有怪物金币奖励 × 2
- 新抽卡池: 上线限定装备/技能
- 限时挑战: 3 天内通关难度 X，奖励限定称号

### C3. 本地排行榜

**使用 localStorage 存储历史最佳成绩**:

```typescript
// leaderboardStore.ts (localStorage only)
const LEADERBOARD_KEY = 'nz_leaderboard_v1'

export interface LeaderboardEntry {
  rank: number
  difficultyReached: number
  totalKillCount: number
  totalPlayTime: number
  achievedAt: number
}

// 记录前 10 名成绩
export function updateLeaderboard(entry: LeaderboardEntry): boolean {
  // 与现有记录比较，插入并截断
}
```

排行榜维度:

- 历史最高难度值
- 累计击杀数
- 最长存活时间（无死亡通关）
- 最高连击数

---

## 附录: 新增类型定义

```typescript
// types/index.ts 新增

// 速度优势
export interface SpeedAdvantage {
  firstStrike: boolean
  doubleTurn: boolean
  damageBonus: number
  dodgeBonus: number
}

// 被动技能
export interface PassiveSkill {
  id: string
  name: string
  description: string
  rarity: Rarity
  unlockDifficulty: number
  effect: PassiveEffect
}

// 套装效果
export interface SetBonus {
  name: string
  minPieces: number
  effect: Partial<PlayerStats>
  description: string
}

// 每日挑战
export interface DailyChallenge {
  id: string
  type: 'kill' | 'no_damage' | 'damage' | 'survive' | 'combo'
  target: number
  progress: number
  completed: boolean
  reward: number
  resetAt: number
}

// 公会
export interface Guild {
  id: string
  name: string
  leaderId: string
  members: GuildMember[]
  totalPower: number
  level: number
}

// 活动
export interface GameEvent {
  id: string
  name: string
  type: 'double_gold' | 'double_drop' | 'new_gacha' | 'limited_challenge'
  startAt: number
  endAt: number
  active: boolean
}
```
