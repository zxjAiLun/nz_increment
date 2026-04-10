export interface RecycleMaterial {
  id: string
  name: string
  rarity: 'common' | 'rare' | 'epic' | 'legend'
  icon: string
}

export const RECYCLE_MATERIALS: RecycleMaterial[] = [
  { id: 'dust_common', name: '普通粉尘', rarity: 'common', icon: '⬜' },
  { id: 'dust_rare', name: '稀有粉尘', rarity: 'rare', icon: '🟦' },
  { id: 'dust_epic', name: '史诗粉尘', rarity: 'epic', icon: '🟪' },
  { id: 'dust_legend', name: '传说粉尘', rarity: 'legend', icon: '🟧' },
  { id: 'essence_common', name: '普通精华', rarity: 'common', icon: '⬜' },
  { id: 'essence_rare', name: '稀有精华', rarity: 'rare', icon: '🟦' },
  { id: 'essence_epic', name: '史诗精华', rarity: 'epic', icon: '🟪' },
  { id: 'essence_legend', name: '传说精华', rarity: 'legend', icon: '🟧' },
]

// 分解配方
export const RECYCLE_RECIPES = {
  common: { dust: 5, essence: 0 },
  rare: { dust: 3, essence: 1 },
  epic: { dust: 2, essence: 2 },
  legend: { dust: 0, essence: 5 },
}
