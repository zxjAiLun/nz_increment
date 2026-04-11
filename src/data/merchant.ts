export interface MerchantItem {
  id: string
  name: string
  type: 'equipment' | 'material' | 'skin' | 'title'
  rarity: 'common' | 'rare' | 'epic' | 'legend'
  originalPrice: number
  discountedPrice?: number
  stock: number    // -1 = 无限
  discount?: number  // 0.8 = 20% off
}

export const MERCHANT_ITEMS: MerchantItem[] = [
  { id: 'm_atk_scroll', name: '攻击卷轴', type: 'material', rarity: 'rare', originalPrice: 500, stock: 10 },
  { id: 'm_def_scroll', name: '防御卷轴', type: 'material', rarity: 'rare', originalPrice: 500, stock: 10 },
  { id: 'm_legend_chest', name: '传说宝箱', type: 'equipment', rarity: 'legend', originalPrice: 5000, stock: 1 },
  { id: 'm_epic_skin', name: '史诗皮肤', type: 'skin', rarity: 'epic', originalPrice: 2000, stock: 3 },
  { id: 'm_rare_title', name: '稀有称号', type: 'title', rarity: 'rare', originalPrice: 1000, stock: 5 },
]
