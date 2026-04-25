# 更新日志

## [Unreleased]

### 阶段 1：战斗一致性收口
- 新增统一战斗伤害链，玩家普攻、技能、引爆与 Boss 后置倍率统一走 `DamageResult` 解释结构。
- 修复技能 `damageMultiplier` 未进入玩家技能伤害的问题，3 倍、8 倍与多段技能会正确影响最终伤害。
- 修复 `defenseIgnorePercent` 未进入技能伤害链的问题，穿甲、贯穿、无视防御技能会正确降低有效护甲。
- 引爆伤害改为复用统一命中、暴击、护甲、真伤/虚空伤害流程，避免旁路随机和重复推断。
- `battleEvents.explanation` 接入战报视图，伤害记录可展开查看来源、倍率、暴击、护甲减免、护盾吸收等步骤。
- 战斗系统支持可注入 RNG，实战与模拟器可复现。

### 阶段 2：数值模拟器升级为数值护栏
- `balance-report` 升级为输出护栏状态、主要失败原因与推荐关注属性的生成式报告。
- 新增 `npm run balance-check`，复用同一模拟矩阵并在护栏 `fail` 时以非零状态退出。
- 新增五类温和护栏：普通怪 TTK 过长、Boss 长期低胜率、高防 Boss 未要求破甲、高闪避 Boss 未要求命中、幸运流同时成为最高战斗收益。
- 平衡报告新增 `Guardrail Summary`、`Findings`、精简主表与 `Raw Combat Metrics` 附表。
- 补充护栏单元测试，规则测试使用构造数据，不依赖当前实战曲线。

### 阶段 3：核心体验收束到 30 分钟主线
- 前 30 分钟主线重排为：战斗+装备、Boss+基础养成、抽卡+修炼、技能+套装+装备比较。
- 主界面新增决策信息：下一目标、当前瓶颈、推荐行动、预计收益。
- 导航解锁节奏调整：20 难度开放技能/加成/战报，30 难度开放自动构筑与稳定补给。
- 新增 `getMainlineGuidance`，根据 TTK、TTL、Boss 生存率给出主线推荐。

### 阶段 4：五大流派落地
- 五大流派补齐闭环定义：核心属性、代表词条、代表套装、代表技能、克制 Boss、弱点 Boss、UI 标签与取舍说明。
- 装备词条池补入 `lifesteal`、`damageReduction`、`attackSpeed`、`cooldownReduction`、`skillDamageBonus` 等关键属性。
- 新增吸血坦克代表套装 `blood_guardian` 与幸运寻宝代表套装 `fortune`。
- 明确生命偷取装备软上限 10%、最终上限 15%。
- 当前构筑摘要展示流派标签与取舍，幸运寻宝流明确“收益高但战斗弱”。

### 阶段 5：UI 信息组织改造
- 页面定位从“系统展示”改为“决策辅助”。
- 战斗页显示 TTK、TTL、Boss 生存率、下一解锁、当前瓶颈与推荐行动。
- 装备页新增 DPS 代理、生存代理、收益代理与构筑评分。
- 养成页新增属性升级收益推荐，按单位金币收益排序。
- 挑战页新增失败原因、推荐构筑、推荐属性与预计修正。
- 抽卡页新增保底、每日免费、目标奖池对流派提升的说明。

### 架构重建
- 新建 `src/utils/constants.ts` 集中管理魔法数字
- 新建 `src/composables/useGameLoop.ts` 用 requestAnimationFrame 替代 setInterval
- 重构 App.vue：1235行 → 125行，拆分为 6 个组件
- 禁用 Vue options API（vite.config.ts）

### 新增
- 项目初始架构完成（Vue 3 + TypeScript + Pinia）
- 12个属性系统（基础/进阶/高级/终极）
- 24个主动技能
- 8级装备稀有度系统（common → eternal）
- 12个装备槽位
- 练功房系统
- 转生系统
- 成就系统
- 离线收益系统

### 修复
- （暂无修复记录）

### 优化
- （暂无优化记录）

### 文档
- 初始项目文档（README.md、RULES.md、DEVELOPMENT_PLAN.md）
- 类型定义文档（src/types/index.ts）
