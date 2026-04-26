export type PrimaryTabId = 'adventure' | 'build' | 'growth' | 'challenge' | 'resources'

export type SecondaryPageId =
  | 'main'
  | 'training'
  | 'report'
  | 'autoBuild'
  | 'equipment'
  | 'skills'
  | 'bonus'
  | 'stats'
  | 'cultivation'
  | 'pet'
  | 'longterm'
  | 'dungeon'
  | 'bossRush'
  | 'worldEvent'
  | 'roguelikeAdventure'
  | 'signinOffline'
  | 'shopGacha'
  | 'monopoly'
  | 'seasonPass'
  | 'achievementReward'
  | 'menu'

export interface NavRoute {
  primary: PrimaryTabId
  secondary: SecondaryPageId
  source?: 'primary' | 'menu' | 'shortcut'
}

export interface NavigationNode {
  id: string
  label: string
  primary: PrimaryTabId | 'menu'
  visibility: 'primary' | 'secondary' | 'hidden'
  singleplayerMode: 'native' | 'mirror' | 'mock'
  component: string
}

export type BuildTarget = 'critBurst' | 'lifestealTank' | 'armorTrueDamage' | 'speedSkill' | 'luckTreasure'

export interface AutoBuildRecommendation {
  target: BuildTarget
  equipmentIds: string[]
  skillIds: string[]
  titleId?: string
  petId?: string
  summary: string
  delta: { attack?: number; defense?: number; maxHp?: number; speed?: number }
}

export interface PrimaryTabConfig {
  id: PrimaryTabId
  name: string
  icon: string
  defaultSecondary: SecondaryPageId
  minDifficulty?: number
}

export interface SecondaryPageConfig {
  id: SecondaryPageId
  name: string
  minDifficulty?: number
  unlockPain?: string
  unlockChoice?: string
  buildImpact?: string
}

export interface MainlineUnlockStage {
  minDifficulty: number
  title: string
  systems: SecondaryPageId[]
  pain: string
  choice: string
  buildImpact: string
}

export const PRIMARY_TABS: PrimaryTabConfig[] = [
  { id: 'adventure', name: '冒险', icon: '⚔️', defaultSecondary: 'main' },
  { id: 'build', name: '构筑', icon: '🧠', defaultSecondary: 'equipment' },
  { id: 'growth', name: '养成', icon: '🌟', defaultSecondary: 'stats' },
  { id: 'challenge', name: '挑战', icon: '🏆', defaultSecondary: 'dungeon' },
  { id: 'resources', name: '资源', icon: '💎', defaultSecondary: 'signinOffline' }
]

export const SECONDARY_PAGES: Record<PrimaryTabId, SecondaryPageConfig[]> = {
  adventure: [
    { id: 'main', name: '主线挂机', minDifficulty: 0, unlockPain: '需要一个不用选择太多的基础战斗循环', unlockChoice: '观察战斗并决定先强化攻击、防御或生命', buildImpact: '建立攻击/防御/生命的基础权重' },
    { id: 'training', name: '训练模式', minDifficulty: 100, unlockPain: '主线推不动时需要安全试伤害', unlockChoice: '用训练难度验证不同装备与技能循环', buildImpact: '让 build 调整有可复现的测试场' },
    { id: 'report', name: '战报详情', minDifficulty: 20, unlockPain: '开始出现多来源伤害后需要复盘', unlockChoice: '查看暴击、技能、吸血等贡献', buildImpact: '帮助判断继续堆哪条输出链' }
  ],
  build: [
    { id: 'equipment', name: '装备方案', minDifficulty: 0, unlockPain: '掉装后需要替换更高基础属性', unlockChoice: '选择攻击、防御、生命、速度倾向', buildImpact: '装备成为第一条可感知构筑线' },
    { id: 'autoBuild', name: '自动构筑', minDifficulty: 30, unlockPain: '装备数量变多后手动比较成本上升', unlockChoice: '按推图、挂机、Boss 目标自动选装', buildImpact: '开始围绕目标切换构筑' },
    { id: 'skills', name: '技能循环', minDifficulty: 20, unlockPain: '普攻成长不足，需要主动技能制造节奏', unlockChoice: '配置伤害、治疗、增益与标记技能', buildImpact: '技能循环改变输出窗口和生存方式' },
    { id: 'bonus', name: '加成组件', minDifficulty: 20, unlockPain: '单件装备提升变小，需要组合收益', unlockChoice: '追求套装、称号、词条组合', buildImpact: '进入套装与词条锁定的构筑阶段' }
  ],
  growth: [
    { id: 'stats', name: '属性强化', minDifficulty: 0, unlockPain: '前期卡关需要稳定数值成长', unlockChoice: '把金币投入攻击、防御、生命或穿透', buildImpact: '决定基础成长曲线偏输出还是生存' },
    { id: 'cultivation', name: '命座觉醒', minDifficulty: 10, unlockPain: '击败首个 Boss 后需要第一个长期目标', unlockChoice: '用抽卡资源点亮命座节点', buildImpact: '给核心属性提供长期定向加成' },
    { id: 'pet', name: '伙伴成长', minDifficulty: 100, unlockPain: '挑战玩法需要额外专精来源', unlockChoice: '培养伙伴补足输出或生存短板', buildImpact: '为 Boss/地下城提供副构筑位' },
    { id: 'longterm', name: '长期养成', minDifficulty: 200, unlockPain: '后期数值膨胀后需要重置与长线追求', unlockChoice: '通过转生、继承、长期资源换永久收益', buildImpact: '把短期 build 转化为跨周期收益' }
  ],
  challenge: [
    { id: 'dungeon', name: '地下城', minDifficulty: 100, unlockPain: '主线以外需要专门 build 的关卡', unlockChoice: '针对楼层压力选择生存或爆发', buildImpact: '要求从通用推图转向副本构筑' },
    { id: 'bossRush', name: 'Boss Rush', minDifficulty: 100, unlockPain: '玩家需要检验单体爆发能力', unlockChoice: '牺牲续航换取限时击杀速度', buildImpact: '催生 Boss 专用输出 build' },
    { id: 'worldEvent', name: '世界事件', minDifficulty: 200, unlockPain: '后期需要周期性变化目标', unlockChoice: '根据事件规则调整参与方式', buildImpact: '让长期 build 有环境适配需求' },
    { id: 'roguelikeAdventure', name: '冒险模式', minDifficulty: 200, unlockPain: '后期需要一次性策略挑战', unlockChoice: '在局内奖励中做取舍', buildImpact: '提供临时 build 与主线 build 的差异体验' }
  ],
  resources: [
    { id: 'shopGacha', name: '抽卡商店', minDifficulty: 10, unlockPain: '首个 Boss 后需要长期随机追求', unlockChoice: '花钻石/每日免费抽取技能与资源', buildImpact: '为命座与技能池提供长期输入' },
    { id: 'monopoly', name: '资源大富翁', minDifficulty: 10, unlockPain: '长期活跃需要可视化资源路线', unlockChoice: '每日掷骰推进周常地图，选择接受 Boss 战力校验', buildImpact: '把抽卡资源、保底和流派 token 连接到长期活跃' },
    { id: 'signinOffline', name: '签到离线', minDifficulty: 30, unlockPain: '中期升级消耗变大，需要稳定补给', unlockChoice: '领取每日与离线资源补足成长', buildImpact: '降低频繁卡关导致的 build 停滞' },
    { id: 'achievementReward', name: '成就奖励', minDifficulty: 30, unlockPain: '系统变多后需要阶段性回馈', unlockChoice: '按目标领取一次性奖励', buildImpact: '引导尝试暴击、击杀、元素等不同方向' },
    { id: 'seasonPass', name: '赛季任务', minDifficulty: 200, unlockPain: '长线玩家需要周期任务与重置目标', unlockChoice: '完成赛季任务换持续资源', buildImpact: '给后期 build 提供赛季环境约束' }
  ]
}

export const MAINLINE_UNLOCK_STAGES: MainlineUnlockStage[] = [
  {
    minDifficulty: 0,
    title: '0-5 分钟：战斗与装备',
    systems: ['main', 'equipment', 'stats'],
    pain: '玩家需要先理解攻击、掉落、装备如何互相驱动。',
    choice: '在装备替换和属性强化之间分配资源。',
    buildImpact: '形成攻击/防御/生命的第一层构筑偏好。'
  },
  {
    minDifficulty: 10,
    title: '10-20 分钟：抽卡与修炼',
    systems: ['shopGacha', 'cultivation'],
    pain: '第一次 Boss 压力后，玩家需要一个可持续追求。',
    choice: '选择抽卡投入与命座节点方向。',
    buildImpact: '把随机奖励转化为长期属性路线。'
  },
  {
    minDifficulty: 20,
    title: '20-30 分钟：开始形成构筑',
    systems: ['skills', 'bonus', 'report'],
    pain: '装备和伤害来源变多，玩家需要知道强在哪里。',
    choice: '配置技能，查看套装/加成，并用战报解释伤害链。',
    buildImpact: '构筑开始从单纯战力转向暴击、吸血、破甲等方向。'
  },
  {
    minDifficulty: 30,
    title: '30 难度：自动构筑与稳定补给',
    systems: ['autoBuild', 'signinOffline', 'achievementReward'],
    pain: '装备数量变多后，手动比较和资源补给成本提高。',
    choice: '围绕推图、挂机或 Boss 选择自动构筑目标。',
    buildImpact: '开始围绕目标切换构筑，而不是只看战力高低。'
  },
  {
    minDifficulty: 100,
    title: '100 难度：专门挑战',
    systems: ['dungeon', 'bossRush', 'training', 'pet'],
    pain: '主线 build 不能覆盖所有挑战，需要专项验证。',
    choice: '为地下城、Boss Rush 或训练目标切换 build。',
    buildImpact: '出现副本 build、Boss build、测试 build 的分化。'
  },
  {
    minDifficulty: 200,
    title: '200+ 难度：长线扩展',
    systems: ['longterm', 'seasonPass', 'worldEvent', 'roguelikeAdventure'],
    pain: '后期需要重置、赛季和高级挑战承接长期投入。',
    choice: '在转生收益、赛季目标和高阶挑战之间规划周期。',
    buildImpact: '短期构筑开始服务跨周期成长。'
  }
]

export const LEGACY_TAB_MIGRATION_MAP: Record<string, NavRoute> = {
  battle: { primary: 'adventure', secondary: 'main', source: 'shortcut' },
  role: { primary: 'growth', secondary: 'stats', source: 'shortcut' },
  cultivation: { primary: 'growth', secondary: 'cultivation', source: 'shortcut' },
  skills: { primary: 'build', secondary: 'skills', source: 'shortcut' },
  shop: { primary: 'resources', secondary: 'shopGacha', source: 'shortcut' },
  signin: { primary: 'resources', secondary: 'signinOffline', source: 'shortcut' },
  leaderboard: { primary: 'adventure', secondary: 'menu', source: 'menu' },
  master: { primary: 'adventure', secondary: 'menu', source: 'menu' },
  title: { primary: 'build', secondary: 'bonus', source: 'shortcut' },
  bossrush: { primary: 'challenge', secondary: 'bossRush', source: 'shortcut' },
  skillskin: { primary: 'adventure', secondary: 'menu', source: 'menu' },
  pet: { primary: 'growth', secondary: 'pet', source: 'shortcut' },
  achievementstory: { primary: 'resources', secondary: 'achievementReward', source: 'shortcut' },
  worldboss: { primary: 'challenge', secondary: 'worldEvent', source: 'shortcut' },
  inheritance: { primary: 'growth', secondary: 'longterm', source: 'shortcut' },
  merchant: { primary: 'resources', secondary: 'shopGacha', source: 'shortcut' },
  replay: { primary: 'adventure', secondary: 'menu', source: 'menu' },
  share: { primary: 'adventure', secondary: 'menu', source: 'menu' },
  settings: { primary: 'adventure', secondary: 'menu', source: 'menu' },
  dungeon: { primary: 'challenge', secondary: 'dungeon', source: 'shortcut' },
  adventure: { primary: 'challenge', secondary: 'roguelikeAdventure', source: 'shortcut' }
}
