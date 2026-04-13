export interface SeasonContent {
  id: string
  name: string
  theme: string        // 'fire' | 'ice' | 'shadow' | 'holy'
  startDate: number
  endDate: number
  exclusiveSkins: string[]   // 限定皮肤ID
  exclusiveTitles: string[]   // 限定称号ID
  exclusiveItems: { id: string; name: string; type: string }[]
  seasonPassReward: { level: number; item: string }[]
  resetOnEnd: string[]  // 赛季结束清空的内容
}

export const SEASONS: SeasonContent[] = [
  {
    id: 'season1',
    name: 'S1 火焰之魂',
    theme: 'fire',
    startDate: Date.now(),
    endDate: Date.now() + 30 * 24 * 60 * 60 * 1000,
    exclusiveSkins: ['skin_fire_bolt', 'skin_dragon_fist'],
    exclusiveTitles: ['title_legend'],
    exclusiveItems: [
      { id: 'fire_charm', name: '火焰护符', type: 'accessory' },
      { id: 'phoenix_feather', name: '凤凰羽毛', type: 'material' },
    ],
    seasonPassReward: [
      { level: 1, item: 'fire_charm' },
      { level: 10, item: 'phoenix_feather' },
      { level: 25, item: 'title_legend' },
    ],
    resetOnEnd: ['season_points', 'season_daily_tasks'],
  },
  {
    id: 'season2',
    name: 'S2 寒冰之誓',
    theme: 'ice',
    startDate: Date.now() + 30 * 24 * 60 * 60 * 1000,
    endDate: Date.now() + 60 * 24 * 60 * 60 * 1000,
    exclusiveSkins: ['skin_ice_arrow'],
    exclusiveTitles: ['title_frost'],
    exclusiveItems: [
      { id: 'ice_crystal', name: '寒冰水晶', type: 'material' },
    ],
    seasonPassReward: [
      { level: 1, item: 'ice_crystal' },
    ],
    resetOnEnd: ['season_points', 'season_daily_tasks'],
  },
  {
    id: 'season3',
    name: 'S3 虚空风暴',
    theme: 'shadow',
    startDate: Date.now() + 60 * 24 * 60 * 60 * 1000,
    endDate: Date.now() + 90 * 24 * 60 * 60 * 1000,
    exclusiveSkins: ['skin_void_blade', 'skin_shadow_cloak'],
    exclusiveTitles: ['title_void_lord'],
    exclusiveItems: [
      { id: 'void_essence', name: '虚空精华', type: 'material' },
      { id: 'shadow_crystal', name: '暗影水晶', type: 'material' },
    ],
    seasonPassReward: [
      { level: 1, item: 'void_essence' },
      { level: 15, item: 'shadow_crystal' },
      { level: 30, item: 'skin_void_blade' },
    ],
    resetOnEnd: ['season_points', 'season_daily_tasks'],
  },
  {
    id: 'season4',
    name: 'S4 神圣之光',
    theme: 'holy',
    startDate: Date.now() + 90 * 24 * 60 * 60 * 1000,
    endDate: Date.now() + 120 * 24 * 60 * 60 * 1000,
    exclusiveSkins: ['skin_holy_aegis', 'skin_light_wing'],
    exclusiveTitles: ['title_holy_champion'],
    exclusiveItems: [
      { id: 'holy_grail', name: '圣杯', type: 'accessory' },
      { id: 'light_feather', name: '光之羽', type: 'material' },
    ],
    seasonPassReward: [
      { level: 1, item: 'light_feather' },
      { level: 20, item: 'holy_grail' },
      { level: 40, item: 'skin_holy_aegis' },
    ],
    resetOnEnd: ['season_points', 'season_daily_tasks'],
  },
  {
    id: 'season5',
    name: 'S5 自然之力',
    theme: 'nature',
    startDate: Date.now() + 120 * 24 * 60 * 60 * 1000,
    endDate: Date.now() + 150 * 24 * 60 * 60 * 1000,
    exclusiveSkins: ['skin_nature_spirit', 'skin_treant_form'],
    exclusiveTitles: ['title_nature_guardian'],
    exclusiveItems: [
      { id: 'nature_essence', name: '自然精华', type: 'material' },
      { id: 'ancient_seed', name: '古老种子', type: 'material' },
    ],
    seasonPassReward: [
      { level: 1, item: 'nature_essence' },
      { level: 25, item: 'ancient_seed' },
      { level: 50, item: 'skin_nature_spirit' },
    ],
    resetOnEnd: ['season_points', 'season_daily_tasks'],
  },
]
