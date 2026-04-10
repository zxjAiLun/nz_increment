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
]
