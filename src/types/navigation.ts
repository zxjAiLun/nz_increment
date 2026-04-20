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

export type BuildTarget = 'push' | 'idle' | 'boss' | 'roguelike'

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
}

export interface SecondaryPageConfig {
  id: SecondaryPageId
  name: string
}

export const PRIMARY_TABS: PrimaryTabConfig[] = [
  { id: 'adventure', name: '冒险', icon: '⚔️', defaultSecondary: 'main' },
  { id: 'build', name: '构筑', icon: '🧠', defaultSecondary: 'autoBuild' },
  { id: 'growth', name: '养成', icon: '🌟', defaultSecondary: 'stats' },
  { id: 'challenge', name: '挑战', icon: '🏆', defaultSecondary: 'dungeon' },
  { id: 'resources', name: '资源', icon: '💎', defaultSecondary: 'signinOffline' }
]

export const SECONDARY_PAGES: Record<PrimaryTabId, SecondaryPageConfig[]> = {
  adventure: [
    { id: 'main', name: '主线挂机' },
    { id: 'training', name: '训练模式' },
    { id: 'report', name: '战报详情' }
  ],
  build: [
    { id: 'autoBuild', name: '自动构筑' },
    { id: 'equipment', name: '装备方案' },
    { id: 'skills', name: '技能循环' },
    { id: 'bonus', name: '加成组件' }
  ],
  growth: [
    { id: 'stats', name: '属性强化' },
    { id: 'cultivation', name: '命座觉醒' },
    { id: 'pet', name: '伙伴成长' },
    { id: 'longterm', name: '长期养成' }
  ],
  challenge: [
    { id: 'dungeon', name: '地下城' },
    { id: 'bossRush', name: 'Boss Rush' },
    { id: 'worldEvent', name: '世界事件' },
    { id: 'roguelikeAdventure', name: '冒险模式' }
  ],
  resources: [
    { id: 'signinOffline', name: '签到离线' },
    { id: 'shopGacha', name: '抽卡商店' },
    { id: 'seasonPass', name: '赛季任务' },
    { id: 'achievementReward', name: '成就奖励' }
  ]
}

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
