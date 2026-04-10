export interface GuildShopItem {
  id: string
  name: string
  price: number  // 贡献度价格
  type: 'avatar_frame' | 'title' | 'equipment' | 'passive_shard'
  reward: any
}

export const GUILD_SHOP: GuildShopItem[] = [
  { id: 'gf_avatar_1', name: '公会徽章头像框', price: 500, type: 'avatar_frame', reward: { id: 'guild_badge' } },
  { id: 'gf_title_1', name: '公会精英称号', price: 300, type: 'title', reward: { id: 'guild_elite' } },
  { id: 'gf_passive_1', name: '公会被动碎片', price: 200, type: 'passive_shard', reward: { amount: 1 } },
  { id: 'gf_equip_1', name: '公会限定装备', price: 1000, type: 'equipment', reward: { id: 'guild_weapon' } },
]
