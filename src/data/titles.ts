export interface Title {
  id: string
  name: string
  source: 'achievement' | 'rank' | 'purchase' | 'season'
  requirement: string
  effect?: { stat: string; value: number; stat2?: string; value2?: number }
  rarity: 'common' | 'rare' | 'epic' | 'legend'
  icon?: string
}

export const TITLES: Title[] = [
  { id: 'title_newbie', name: '初入江湖', source: 'rank', requirement: '注册账号', rarity: 'common', effect: { stat: 'attack', value: 5 } },
  { id: 'title_killer', name: '杀戮之心', source: 'achievement', requirement: '击杀1000怪物', rarity: 'rare', effect: { stat: 'attack', value: 20 } },
  { id: 'title_wealthy', name: '富甲一方', source: 'achievement', requirement: '累计获得10万金币', rarity: 'rare', effect: { stat: 'goldBonus', value: 5 } },
  { id: 'title_explorer', name: '无尽探索', source: 'achievement', requirement: '到达第100层', rarity: 'epic', effect: { stat: 'maxHp', value: 100 } },
  { id: 'title_legend', name: '传奇王者', source: 'rank', requirement: '排行榜第1名', rarity: 'legend', effect: { stat: 'attack', value: 50, stat2: 'defense', value2: 50 } },
  { id: 'title_speedster', name: '极速者', source: 'achievement', requirement: '连续击杀50怪物', rarity: 'epic', effect: { stat: 'speed', value: 10 } },
  { id: 'title_collector', name: '收藏家', source: 'achievement', requirement: '收集50件装备', rarity: 'rare', effect: { stat: 'critRate', value: 3 } },
  { id: 'title_og', name: 'OG会员', source: 'purchase', requirement: '购买永久会员', rarity: 'legend', effect: { stat: 'attack', value: 30, stat2: 'defense', value2: 30 } },
]
