# Incremental World Runtime — 架构审计

> 审计基线：freeze checkpoint `5c29e83807be3e17ed99bbda6fa97fe0ab1ceaed`（Phase 3.84 APPROVED）
> 日期：2026-08-08 · 性质：只读审计，未修改任何生产代码，未 commit
> 范围：`src/stores`（~100 文件含测试）/ `src/systems` / `src/composables` / `src/utils` / `src/components`（47 .vue）/ `src/data`（37 文件）
>
> **发布状态（v2 修订）**：本文件已发布于 commit `fdf8d31`（Publish incremental world runtime audit docs，docs-only，未触碰生产代码）；旧产品 production freeze SHA 仍为 `5c29e83…`。
>
> **修订 v2（2026-08-08）**：审计获战略批准为正式基线（旧产品线 FROZEN / Phase 3.xx PAUSED）。已吸收 11 条调整：
> 1. Combat 前置到首个 vertical slice（双域切片，不再 R3）
> 2. 红线：Simulation 必须产生可渲染语义事件（AttackStarted/Impact/DamageApplied/EntityKilled/LootSpawned），Renderer 纯订阅
> 3. Action 分层：simulation 只关心时间边界（startAt/reachAt/impactAt/finishAt），动画细节归 presentation
> 4. Offline 不逐事件重放：Real-time / Fast-forward 两种执行模式共享同一规则
> 5. 新仓库优先继承 contract + tests，不复制旧文件结构
> 6. 确认仓库策略 C（新 repo）
> 7. 第一版无装备系统（先证明“可观察”，再拼回复杂度）
> 8. 第一版美术故意简单（圆形/方形/小方块 + tween），但动作必须真实
> 9. 新增验收原则：Screensaver Test（30 秒不点击仍有可理解事件发生）与 Mute-the-UI Test（隐藏数值仍能判断系统状态）
> 10. 可见瓶颈是战斗与生产的共同核心
> 11. 产品宣言三句话（见 §12）

---

## 1. Executive summary

当前产品是一个**数值驱动的 combat incremental**：玩家属性/怪物属性按单一 `difficultyValue` 指数膨胀，战斗在 gauge 时间轴上以瞬时伤害结算，UI 用文本日志、血条与 CSS 动画呈现结果。**不存在"可观察世界"**：没有实体位置、移动、动作生命周期、投射物或战利品的世界表示——数值变化是唯一的真相，视觉只是附庸。

对 Incremental World Runtime 而言，项目最有价值的资产不是玩法内容，而是**基础设施层**：

- 确定性战斗时间轴原语（`combatClock.ts`）——已实现"帧率无关、同钟多系统推进、限流不饥饿"，这正是 headless simulation 与可视化共用的调度核心；
- 运行时故障隔离体系（`useGameLoop` + App 启动门 + fault latch）——业界级健壮性，可直接继承；
- 纯函数层纪律（`src/utils` 禁 import Vue/Pinia）与补偿事务原语（`storageCompensation.ts`）——持久化安全骨架可通用；
- 平衡模拟器（`battleSimulator.ts`）——一个"headless 战斗即服务"的现成样板：注入 RNG、纯函数、与运行时对拍（`runtimeSimulatorParity.test.ts`）。

**四问速答**：

| 问题 | 结论 |
|---|---|
| 1. 哪些可直接成通用底座 | clock/timing、fault containment、storage 安全、事务原语、数值校验、纯函数层纪律、概率/RNG 系统、headless 模拟与对拍测试法（详见 §3 KEEP） |
| 2. 哪些可抽象后复用 | 战斗模拟（DamageResult/时间轴）、技能效果、装备经济、离线结算快照模式、导航/解锁框架、成就/图鉴/挑战框架、回放事件序列（详见 §3 ADAPT） |
| 3. 哪些属旧产品特有 | gacha/小游戏/战令/赛季/签到/公会/师徒/竞技场/排行榜（多为 mock）、BossRush/WorldBoss/Dungeon/Roguelike/Adventure、全部具体奖励表（详见 §3 LEGACY） |
| 4. 新 runtime 缺哪些核心能力 | 实体模型（id/position/状态）、空间/区域、动作生命周期（approach→windup→active→impact→recovery）、语义事件总线（simulation→world→renderer）、渲染器与动画状态机、摄像机、战利品世界表示、离线与在线同一结果的事件源（详见 §4/§6） |

---

## 2. Current architecture map

```
entry → App.vue（装配 + 运行时门 + fail-stop）
├── playerStore（静态，全局玩家中枢；60+ 事务化 action；主存档 lollipop_adventure_save）
│   └── 依赖 rebirthStore/gameStore/monsterStore/talentStore/…（延迟调用）
├── gameStore（战斗运行时 ~2000 行：事件驱动战斗窗口、9 store 结算中枢、battleEvents/damagePopups/telemetry）
├── monsterStore（difficultyValue 单轴 + currentMonster 数值 + encounter 令牌）
└── TabsContainer → 18+ 异步 Tab（BattlePass/Gacha/Dungeon/BossRush/WorldBoss/…）
    战斗显示链：BattleTab（CSS 方块怪 + HP 环）→ BattleHUD（血条/emoji 状态）→ BattleLog（文本）→ DamagePopup（CSS 飘字）
```

关键事实（源码证据）：

- **确定性时间轴**：`src/systems/combat/combatClock.ts` 的 `advanceCombatTimeline`（按真实时间排序的双侧行动序列，浮点 epsilon 防丢行动）与 `nextEventDelayMs`（事件驱动循环：把所有系统推进到"下一个行动时刻"再执行）——`gameStore.advanceBattleWindow` 与 `battleSimulator.simulateCombatScenario` 复用同一份数学，`runtimeSimulatorParity.test.ts` 证明帧率无关（30/60/144Hz 事件序列一致）。
- **补偿事务骨架**：`src/utils/storageCompensation.ts`（纯 storage 逆序 raw 还原）+ 各 store 内 `commitSidecarPersistence` 模式（资格门→快照→raw 预读→纯内存候选→Main→sidecar→失败回滚）。33–84 阶段全部奖励发放已事务化。
- **纯函数层**：`src/utils/` 禁 import Vue/Pinia（`calc.ts` 战斗数值、`skillSystem.ts`、`monsterGenerator.ts`、`killDrops.ts`、`luck.ts` 等均为 runtime 与 simulator 共享）。
- **持久化双轨**：主存档 + **40 个独立 localStorage key**（`nz_*`/`lollipop_*`/`rebirth_data` 等，grep `const .*_KEY = '` 可见），大面积 sidecar 双轨。
- **单轴进度**：`difficultyValue`（累计击杀数）驱动怪物公式、解锁（`navigationStore` MAINLINE_UNLOCK_STAGES）、转生收益（`rebirthStore.calculateRebirthPoints`）、排行榜（`leaderboardStore`）、练功房（`trainingStore` 内联第二份公式 `10*Math.pow(1.15, difficulty/10)`）。
- **跨 store 结算 sprawl**：`gameStore.performPlayerAction` 内 `grantKillRewards` 一次结算 6+ store（talent/rebirth/challenge/collection/achievement/…）；`monopolyStore` 依赖 5 store、6 个 storage key、自建战斗模拟。
- **死代码**：`storageManager.ts`（旧 schema，零引用）、`auctionStore/guildRaidStore/mentorStore/tradeStore`（零生产引用）、`elementalReactions.ts`/`bossSkillSystem.ts`（零引用）、~15 个组件零挂载点。

---

## 3. KEEP / ADAPT / LEGACY / RETIRE inventory

### 3.1 KEEP — 可直接成为通用 runtime 底座

| 资产 | 证据与理由 |
|---|---|
| `src/systems/combat/combatClock.ts` | 确定性时间轴原语（gauge 推进/行动序列/事件驱动推进/Buff 计时/狂暴判定）。纯函数、帧率无关、已对拍验证。→ 未来 `core/clock` 与 `core/scheduler` 的直接种子 |
| `src/composables/useGameLoop.ts` | rAF 主循环 + shouldRun/暂停/visibility 挂起 + 生命周期故障回调 + ownership-first 取消。浏览器框架无关部分可直接复用 |
| `src/utils/storageCompensation.ts` | 纯 storage 逆序补偿原语，零业务耦合 |
| `src/utils/timestamp.ts` | `parsePositiveTimestamp` 正向时间戳规范化（缺失 key 陷阱防御） |
| `src/utils/format.ts` | 纯格式化（K/M/B、时长），零业务依赖 |
| `src/utils/luck.ts` | 唯一幸运配置 + 效果计算，runtime/simulator 共享来源 |
| `src/systems/probability/`（rng/pity/probability/probabilityModifier/rewardResolver/probabilityAudit） | 注入式 RNG、保底、概率审计——通用概率底座（已服务 5 个小游戏） |
| `src/utils/offlineReward.ts` | 离线结算**纯函数 + 不可变快照 + 规范化**模式（Model A 结算 / Model B 展示共享同一快照）——离线系统架构样板 |
| 故障隔离模式 | App 启动门（initializing/ready/blocked/faulted）+ fault latch + 每帧/每定时器独立 containment（phase340–353 全套）——运行时稳定性架构可平移 |
| 补偿事务模式 | 资格门→快照→raw 预读→候选→顺序落盘→逆序补偿（3.33–3.84 实践定型） |
| 测试方法论 | `runtimeSimulatorParity`（对拍）、红-绿验证、one-shot 失败注入、`it.each` 拆维——headless 与呈现层共用的验证法 |
| `atbStore.ts` / `battleSpeedStore.ts` / `i18nStore.ts` / `themeStore.ts` / `guideStore.ts` | 零/低耦合基础设施（计时状态机、倍率偏好、i18n、主题、引导流程机） |

### 3.2 ADAPT — 思想可复用，但绑定旧产品

| 资产 | 当前 coupling | 建议抽出的 contract | 未来归属层 |
|---|---|---|---|
| `battleSimulator.ts` + `damage/hit/crit/lifesteal` | 绑定 PlayerStats/Monster/Skill 旧模型 | `SimulationContext`（stats+rng+时间轴）→ 事件序列 | `gameplay/combat` headless 核心 |
| `gameStore` 战斗窗口 | 9 store 结算 sprawl、player 全局耦合 | 纯战斗状态机（gauge/cooldown/buff/hp）+ 语义事件输出 | `gameplay/combat` |
| 装备经济（equipmentGenerator/Replacement/AffixUpgrade/Refining/Runes/SetCalculator + playerStore 收口） | 绑定旧 Equipment/StatAffix 模型 | `ItemDef` + 纯校验/规划函数 | `gameplay/production`（物品系统） |
| `skillSystem.ts` / `useSkillExecutor` | 绑定 `Skill.unlockPhase` 与旧 buff 模型 | `ActionDef` + 效果函数（damage/heal/buff/shield/lifesteal） | `gameplay/combat` action 效果 |
| `navigationStore` | 解锁轴绑 `difficultyValue` | `UnlockCondition`（谓词集合） | `incremental/unlocks` |
| `monsterGenerator.ts` / `bossMechanics.ts` | 绑定 Monster 旧模型 | `UnitDef` 生成器 + 机制模板 | `content/units` |
| `killDrops.ts` / `runeDrop.ts` | 绑定钻石/装备/Rune 三通道掉落经济 | `LootTable` + roll 原语（RNG 相位锁定） | `gameplay/combat` loot |
| `replayStore` + `data/battleReplay.ts` | 绑定旧战斗事件格式 | 事件序列录制/回放协议 | `presentation` 或 `core/eventlog` |
| 成就/图鉴/挑战框架（achievement/collection/challengeStore） | 直接写 playerStore 发奖、mutate 常量对象 | `Condition`/`ProgressTracker` 声明式框架 | `incremental/`（milestone/achievement） |
| `profileStore` 只读聚合 / `refiningStore` 薄委托 / `friendStore` 注入式依赖 | 绑定旧模型 | 只读视图 + 依赖注入模式 | 各层通用模式 |
| `useSkillExecutor.executeSkillLogic` | 技能类型 switch + 硬编码 `skill_energy_shield` | 效果描述符数组（无硬编码） | `gameplay/combat` |
| `trainingStore` 练功房 | 内联第二份难度公式 | 抽取共享公式 | `gameplay/`（expedition） |

### 3.3 LEGACY — 保留作 reference / compatibility（不删除）

gacha 经济（`gachaStore`/`gachaPools`）、幸运轮/大富翁/弹珠机/打砖块（luckyWheel/monopoly/pachinko/pinball + chanceGames）、战令（battlePass + battlePassRewards，**注意第二套**：`seasonStore`+`seasonTaskStore` 无持久化并存）、签到（signin）、公会（guild/guildWar/guildDungeons/guildShop）、好友/师徒（friend/master + 死掉的 mentor）、竞技场（arena，setTimeout+Math.random mock）、世界Boss/BossRush/Dungeon/Roguelike/Adventure 内容、赛季/排行榜（含 `generateMockLeaderboard` mock 数据）、全部具体奖励表（recycleMaterials/refiningMaterials/breakthroughMaterials/merchant 等）。

### 3.4 RETIRE CANDIDATE — 新 runtime 不应继承的架构模式

| 模式 | 实例（源码证据） |
|---|---|
| 全局 player-centric 耦合 | 几乎所有 store action 直接 `usePlayerStore()` 读写 `player.value.*`；`gameStore.grantKillRewards` 单点结算 6+ store；UI 直写：`AutoBuildTab.vue:237` 直接 `playerStore.player.skills = …`、`SettingsTab.vue:140` 模板内 `gameStore.gameSpeed = speed` |
| difficultyValue 单轴进度 | navigation/rebirth/leaderboard/training 全部单轴换算；`leaderboardStore` 影子玩家 `totalPower = difficultyValue*50` |
| 跨 store 产品特定结算 sprawl | `monopolyStore`（5 store + 6 key + 自建战斗模拟）、`challengeStore`（硬编码 3 个外部 key）、`luckyWheelStore`（经 gachaStore 发奖） |
| 组件内玩法规则 | 各 Tab 内联奖励/规则逻辑（DungeonTab FLOOR_DATA 硬编码在 store、EventTab 活动硬编码） |
| 装饰动画脱离模拟 | `BattleTab` CSS 方块怪无限循环动画不响应战斗事件；`DamagePopup` 飘字 x/y 为 `50+Math.random()*40` 随机偏移 + setTimeout 生命周期 |
| 死代码/双轨 | `storageManager.ts`（旧 schema 零引用）、`auction/guildRaid/mentor/trade` store、`elementalReactions/bossSkillSystem`、~15 零挂载组件；40 个 sidecar key 与主存档双轨 |
| 复用复制 | fail-closed 水合 helper 在 5 个 chance store 整段复制；`constants.ts` 与 `data/equipmentSets.ts` 两套套装定义并存 |

---

## 4. Current visual gameplay gap（战斗显示链专项）

| 问题 | 现状（源码证据） |
|---|---|
| Simulation 目前发出什么？ | gauge 行动序列（`combatClock`）、`DamageResult`（含 `steps` 伤害解释）、`battleEvents`（文本消息+explanation，上限 50）、`damagePopups`（数值+类型）、`combatTelemetry`（actionLog/skillCastTimes/buffApplyMs 时间戳——**默认关闭**，仅测试开启）、`damageStats` 聚合 |
| UI 目前读什么？ | `battleEvents` 最近文本、`damageStats`、HP/gauge 百分比、`activeMonsterHpPercent`（conic-gradient 环）；怪物仅名字 + HP 条 + emoji 状态标记（`BattleHUD` `getMarkIcon`：⛳❤️⛨☀☁） |
| Animations 由什么驱动？ | 纯 CSS 无限循环 keyframes（`core-pulse/core-spin/grid-drift`），**不随战斗事件驱动**；飘字由 setTimeout 回收。唯一响应数据的是血条宽度/HP 环 |
| Skill use 生命周期？ | 无视觉生命周期：gauge 满 → `executePlayerTurn` 瞬时伤害/效果 → 冷却计时（`updateSkillCooldowns`）。无 windup/active/impact/recovery 阶段 |
| Hit/damage/death 语义事件？ | 有数值结果（`DamageResult`/`killed`）与文本日志，但**无结构化实体事件**（无"哪个实体对哪个实体何时造成多少伤害"的可订阅事件对象；`battleEvents` 是展示字符串） |
| Entity position / movement / projectile / animation state？ | **全部不存在**。Monster 类型无 position；怪物视觉为 9 个 CSS 方块 + HP 环；无投射物生命周期；无动画状态机（只有 CSS class 切换） |
| Loot 世界表示？ | 无。掉落直接进 `killDrops` 结果 → 背包/日志文本（`[装备] 获得…`），世界中没有可见的战利品 |

**三层明确区分**：

- simulation event：gauge 行动、DamageResult（数值真源）、击杀/掉落判定——**已有，但多为函数返回值而非事件流**；
- UI state：damageStats、HP/Gauge percent、battleEvents 文本——**已有，响应式 ref**；
- decorative animation：CSS 无限循环、飘字、方块拼怪——**已存在但完全与模拟解耦**（这正是目标哲学禁止的"数值变化+无关循环动画"）。

---

## 5. Proposed future layers（第一版，不实现）

```
core/        clock（combatClock 种子）、scheduler（事件驱动推进）、ids（entity/event id）、
             rng（注入式，seedable）、persistence（raw 快照/补偿原语/规范化）
world/       entity（id+type+state）、position（空间坐标+邻接）、task（worker 任务声明）、
             action（生命周期状态机）、event（语义事件：时间戳+actor+target+payload）、
             zone（区域：节点/实体归属）
presentation/ renderer（订阅 world events → 绘制）、animation（实体动画状态机，纯展示）、
             fx（飘字/特效，从事件派生）、camera、asset adapter（精灵/资源加载）
gameplay/    gathering（采集）、production（加工/转化）、logistics（搬运）、combat（战斗）、
             exploration（探索）
incremental/ resources（资源定义/上限）、upgrades（升级）、automation（自动指派）、
             unlocks（解锁谓词）、offline（headless 结算）、prestige（重置/加成）
content/     definitions（物品/配方）、recipes、units、skills、zones（静态内容表）
```

边界解释：

- `core` 与 `world` 是**无 UI 依赖的纯 TypeScript 层**（沿用当前 `src/utils` 禁 Vue/Pinia 纪律）；`presentation` 是唯一接触渲染 API 的层；
- `gameplay` 是规则实现（消费 `core`，产出 `world` 变更 + `event`）；`incremental` 是 meta 层（作用于 gameplay 的参数与解锁）；
- `content` 是纯数据，与当前 `src/data` 同构；
- **分层验证规则**：上层只通过下层的公开 contract 通信；`core`/`world`/`gameplay` 必须可 headless 测试（无 DOM），`presentation` 只做订阅派生。

---

## 6. Universal Entity / Action / Event model

### 6.1 Action 生命周期（候选）

```
queued → approach → windup → active → impact → recovery → complete
（cancelled 分支：死亡/目标消失/中断）
```

对 `mine / harvest / carry / craft / attack / cast / heal / build` 的适用性分析：

| 阶段 | 必须进 deterministic simulation？ | 说明 |
|---|---|---|
| queued → approach | 目标与到达**时点**进模拟（移动耗时是结算的一部分）；**移动插值本身**是 presentation | 现在 `attack` 的"approach"被 gauge 时间轴隐含（行动发生时立即命中） |
| windup | **是**（决定"命中/产出发生的战斗时刻"，影响死亡竞态与打断） | 现在无 windup：gauge 满即结算 |
| active | **是**（多段命中/持续产出/DoT 的逐段时刻） | 现在 `hitCount` 在单次结算内一次性完成 |
| impact | **是**（伤害/资源/状态变更的确定性应用点——产生 `DamageResult`/产出事件） | 现有 `executePlayerTurn` 即此 |
| recovery | 是否影响下一行动**时间**→是（后摇并入 gauge/冷却数学）；后摇动画→presentation | 现有冷却即 recovery 的数值化 |
| complete | **是**（清态/触发后续：击杀→掉落→换怪） | 现有 `advanceAfterKill` 即此 |

### 6.2 Renderer 订阅而不影响结果（v2 补充：语义事件红线）

- simulation 每步产出 `WorldEvent { id, t, type, actor, target, payload }`（带**模拟时间戳**，非墙钟）；
- **红线**：Simulation 必须产生可渲染语义，禁止 `damageEnemy(100)` 后让 UI 猜。最小事件集：`AttackStarted / AttackImpact / DamageApplied / EntityKilled / LootSpawned`（以及生产侧 `ResourceGained / ResourceConsumed / ResourceStored`），示例：

```
t=1240 AttackStarted  actor=hero1  target=slime3
 t=1480 AttackImpact    actor=hero1  target=slime3
 t=1480 DamageApplied   source=hero1 target=slime3 amount=27
 t=1480 EntityKilled    entity=slime3
 t=1510 LootSpawned     item=iron_scrap position=(8.3, 4.1)
```

- Renderer 才决定：AttackStarted→挥剑前摇、AttackImpact→刀光、DamageApplied→飘字/受击闪光、EntityKilled→死亡动画、LootSpawned→地面物品；
- 同份事件流可服务 Pixel/Canvas/Pixi/headless/Replay viewer——**比选渲染引擎更重要**；
- 倍速/暂停只影响 presentation 消费速率，模拟时间轴独立。

### 6.3 Action 分层（v2）：simulation 时间边界 ≠ presentation 动画

Action 只携带**由规则计算的时间边界**，不携带任何视觉参数：

```
Action {
  startAt: SimTime   // 开始
  reachAt: SimTime   // 到达目标（approach 结束）
  impactAt: SimTime  // 命中/产出时刻
  finishAt: SimTime  // 可开始下一个 action
}
```

- simulation 关心：何时可打断、何时真正扣血/产资源、何时可开始下一个 action；
- presentation 关心：抬手多少帧、脚步频率、剑光时长、受击 shake 强度、死亡淡出或倒地——全部从时间边界派生（如 castStart=1000/impact=1600/complete=1900 可映射为 1000–1350 举杖、1350–1600 蓄力、1600 爆炸、1600–1900 后摇）；
- 换资产不影响玩法；headless 测试只验证时间边界。

---

## 7. Combat as flagship module（边界定义）

**Headless combat simulation（真源）**：

- 输入：`SimulationContext`（双方 unit stats、技能/效果、zone 地形、注入 RNG、时间轴参数）；
- 过程：确定性事件序列（gauge 行动、技能 cast、命中/伤害/治疗/护盾/死亡判定、掉落 roll）——`combatClock` + `systems/combat/damage|hit|crit|lifesteal` + `killDrops` 已是骨架；
- 输出：`WorldEvent[]`（带 t/actor/target）+ 结算聚合（经验/资源/掉落清单）；
- 验证：与 `battleSimulator` 同种子对拍（现有 `runtimeSimulatorParity` 直接迁移）。

**Combat presentation（纯派生）**：

- 实体渲染（单位外观/朝向/状态指示）、空间关系（接近/距离）、移动与攻击动画（从 approach/impact 事件补间）、技能 cast 时间线（windup→impact 可视化）、命中反馈（飘字/震屏/受击）、死亡生命周期（死亡动画→尸体/清除）、战利品呈现（掉落实体→拾取）。

**"真正可视化"最低标准**（逐项）：

```
visible entities：单位在世界中有位置与可辨外观（非纯 CSS 方块+名字）
spatial relation：攻击/技能有距离概念（approach 阶段有实际移动）
movement/targeting：单位能移动、目标选择可见
attack timeline：普攻有 windup→impact→recovery 时间线
skill cast timeline：施法前摇→命中点可观察
hit feedback：命中/闪避/格挡有区别于数值的反馈
death lifecycle：死亡→尸体→消失有阶段
loot/result lifecycle：掉落物出现在世界并可被拾取
```

Combat 既可为主玩法（垂直切片含战斗），也可作为后期模块挂接（世界其余部分不依赖它）。

---

## 8. Production/logistics reference module（最小非战斗验证）

```
resource node（矿点：资源+储量+位置）
→ worker（entity：位置+任务+携带量）
→ gather（action：approach→windup→active(逐秒产出)→complete）
→ carry（action：approach→complete，携带量）
→ storage（entity：容量+存量）
→ processor（entity：配方+输入输出，产出物可见）
```

验证目标：**同一套 Entity/Action/Event/Renderer contract 同时支撑 combat 与 production**——combat 的 attack 与 production 的 gather 共享 action 状态机，只是 payload/规则不同。不实现完整矿业游戏。

---

## 9. Offline / headless simulation implications（v2：Fast-forward，不逐事件重放）

**两种执行模式共享同一规则**（核心调整）：

- **Real-time execution**：`advance(world, until)` 逐 deadline 推进，产出完整事件流；
- **Fast-forward execution**：同一规则函数但跳过 presentation 事件，批量聚合（如机器 cycle=4s、离线 8h → `cycles = floor(28800/4)`，不再逐 action 产出），但资源不足/输入耗尽/storage 满/单位死亡等规则判定必须与在线一致；
- 目标不是"重放 8 小时所有事件"（几百万事件不可行），而是共享 **state transition semantics**；
- 一致性验证：同一初始状态与时长下，real-time 聚合结果 == fast-forward 结果（对拍测试）。

其它结论：

1. **RNG 纪律**：现有 `combatRng` 注入 + `createSeededRng` 已是标准，需扩展为"每实体/每 action 共享单一时间轴 RNG 流"（离线 fast-forward 可复现）；
2. **时间源统一**：现有 `combatElapsedMs`（战斗内）与 `Date.now()`（结算）双轨——新 runtime 统一为 simulation clock，离线只吃 wall-clock 差；
3. **presentation 降级**：离线/后台时跳过渲染层但保留事件摘要（"你不在时：采集了 120 矿、击杀了 8 只"）——聚合已产生/已跳过的区间，不是重新计算；
4. **性能预算**：现有 `MAX_LOGIC_EVENTS_PER_FRAME` + `carriedCombatSeconds` 限流模型（不饥饿）可直接继承为 headless 预算；
5. 现有 `offlineReward.ts` 的"结算快照（Model A）与展示快照（Model B）共享同一不可变对象"模式继续复用。

---

## 10. Rendering-engine options（技术选型分析，不安装）

| 方案 | 优点 | 缺点 | 适配度 |
|---|---|---|---|
| **DOM + CSS**（现状） | 零依赖、Vue 生态无缝、bundle 友好、可访问性好 | 实体数量/复杂场景性能差；无游戏坐标系；动画编排弱 | 适合 UI-heavy 界面层，不适合世界层 |
| **Canvas 2D 自绘** | 无依赖、中等成本、完全控制 | 无场景图/碰撞/精灵工具；需自建相机与渲染循环 | 垂直切片 MVP 可行（自定义 renderer 的轻量版） |
| **PixiJS**（WebGL/WebGL2） | 2D 标准、场景图/精灵/滤镜/批渲染成熟、树形结构易与 Vue 宿主组件集成 | 新增运行时依赖（当前红线"禁新增运行时依赖"需为本项目重开例外）；需要自建游戏循环与相机 | **推荐主力**：世界层渲染 |
| **Phaser**（完整引擎） | 场景/物理/动画/输入全家桶 | 重量级、与 Vue 集成侵入大、自带循环与 Vue 生命周期冲突风险 | 不推荐（重复造轮子且与框架打架） |

建议：**presentation 层抽象出 `renderer` contract（场景/精灵/动画状态机），MVP 用 Canvas 2D 实现，预留 PixiJS 适配器**——避免过早锁定引擎；bundle 预算问题在 §11 的仓库策略中解决（新 runtime 不应被旧 400000 硬门约束）。

---

## 11. Repository migration options

| 方案 | legacy coupling | migration burden | test reuse | release risk | velocity |
|---|---|---|---|---|---|
| A. nz_increment 内 runtime-v2 目录 | 高（旧 bundle 门/旧测试堆/旧 git 历史混入） | 低（原地开发） | 高（共享 CI） | 中（旧产品冻结中，改动面被旧约束污染） | 中（每次构建跑 3000+ 旧测试、bundle 门收紧） |
| B. 新 branch 大规模重构 | 高（重构期不可交付、无法冻结推进） | 极高 | 中 | 高 | 低 |
| **C. 新 repository/package 提取通用 runtime** | **低（干净边界）** | 中（复制 KEEP 资产，量小且纯） | 高（对拍/红绿测试可直接搬） | **低（旧仓库零触碰，Vercel/CI 不受影响）** | **高（独立 CI、独立版本、独立 bundle 预算）** |

**推荐 C**：KEEP 清单（§3.1）几乎全部是纯函数或低耦合模块，复制成本低且无历史包袱；ADAPT 资产先留在旧仓库作为 reference（§3.3 语义），新 runtime 按新 contract 重写；旧产品继续在 freeze checkpoint 上维护。`core`/`world` 层以 npm workspace/独立 package 起步，避免一开始就建私有 registry。

---

## 12. Recommended first vertical slice（v2：双域切片，Gather + Combat 同片）

**"矿村 + 守卫"（Dual-domain slice）**——5–10 分钟，首个切片同时包含 production 与 combat：

```
生产域：矿工 → 走向矿石 → 挖矿（windup→active 逐秒产出）→ 搬运 → 仓库
战斗域：守卫 → 发现怪物 → 接近 → 攻击（windup→impact→recovery）→ 怪物受击 → 死亡 → 掉落
两个域必须共享：Entity / Position / Target / Action / ActionPhase / Event / Renderer
```

1. 自动化：任务可重复指派（矿工自动 gather→carry；守卫自动索敌→攻击）——Screensaver Test 通过（30 秒不点击仍有可理解事件）；
2. 一个**可见瓶颈**（生产：携带量/往返距离；战斗：移动慢→接敌耗时、拾取慢→地上掉落堆积）——优化从 Excel 变成世界里的问题；
3. 一个有意义的解锁：熔炉（矿石→锭，改变世界视觉）+ 第二个 worker/守卫；
4. 第一版**无装备系统**：Hero HP 100 / Slime HP 30、普攻 windup 300ms/damage 10/recovery 500ms、一个技能（Fireball cast 700ms + 弹道 + impact 25）——先证明"发生时玩家能看到"，旧项目复杂度以后可拼回；
5. 美术故意简单：圆形角色/方形怪物/资源小方块/简单颜色/tween——但移动、目标、弹道、受击、掉落、搬运必须是真的；
6. **验收**：Mute-the-UI Test——隐藏 DPS/资源/s/HP 数字/生产率/日志后，仅凭世界（矿点塌陷/仓库堆积/工人往返/怪物逼近/Boss 堆积）可判断系统在工作和变强。

**产品宣言（三句话）**：

1. 数字必须对应一个玩家可以观察的世界变化；
2. 自动化的价值，是让玩家看到曾经需要自己完成的过程开始自行运转；
3. Combat、Production、Logistics 必须建立在同一套 Entity → Action → Event → Presentation contract 上。

---

## 13. Risks / unknowns

1. **事件流吞吐**：实体数量增多时事件订阅/派发性能未知——需先定事件预算与聚合策略（现有 `MAX_LOGIC_EVENTS_PER_FRAME` 为参考）；
2. **确定性边界**：CSS/DOM 渲染的时序抖动不能回灌模拟——presentation 与 simulation 时钟分离的纪律需要测试护栏；
3. **离线一致性**：事件源重放 vs 增量快照的正确性——需对拍测试（现有 parity 方法可迁移）；
4. **持久化 schema**：新 runtime 应从第一天用版本化 schema + raw 补偿原语（旧仓库 40 个双轨 key 是反例教材）；
5. **bundle 红线**：旧仓库 400000 硬门不应约束新 runtime——仓库策略 C 直接消除此风险；
6. **"数值面板隐藏可见性"是产品目标而非架构目标**：架构只能保证事件完整，呈现质量仍需专门设计（asset/动画/摄像机）；
7. **旧产品并行演进**：freeze 期间若出现 P0 仍须回旧线修复——新 runtime 与旧仓库保持零耦合以隔离风险。

---

## 14. Recommended roadmap（v2：Combat 前置到首个切片）

| 阶段 | 内容 | 出口标准 |
|---|---|---|
| R0 立项 | 新 repo 骨架；**继承 contract + tests（不复制旧文件结构）**；core 层（SimulationTime/scheduler/ids/rng/persistence） | headless 测试全绿，零旧仓库依赖 |
| R1 World primitives | entity/position/action 时间边界/event 总线/zone；ActionPhase 派生规则 | 纯 TS 测试：通用 action 生命周期（含 interrupt/queue） |
| **R2 双域 vertical slice** | **矿村 + 守卫同片**：Gather 与 Combat 共享同一 Entity/Action/Event/Renderer contract；无 Miner-specific hack、无 Combat-specific scheduler、无 Renderer mutation | 两域同时跑通；Screensaver Test + Mute-the-UI Test 通过 |
| R3 Automation + Expansion | 自动指派/多单位/扩张新区/熔炉解锁 | 世界变化可归因于自动化与扩张 |
| R4 Offline / Headless parity | Real-time / Fast-forward 双模式对拍 | 同初始状态同时长下聚合结果一致 |
| R5 Incremental meta | resources/upgrades/unlocks/prestige 声明式框架 | 第二个切片（扩张/转生）验证 meta 层 |

每阶段保持：**headless 测试为唯一真源、presentation 只订阅、事件带模拟时间戳、持久化走版本化 schema + 补偿原语**。

---

*本审计基于 freeze checkpoint `5c29e83` 的源码快照；死代码判定均经"组件 0 引用 + store 间 0 引用"双重 grep 确认；未修改任何生产代码。本文件已发布（commit `fdf8d31`，docs-only）。*
