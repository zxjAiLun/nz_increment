import type { GachaPool } from '../types/gacha'

export const PERMANENT_POOL_ID = 'permanent_abyss'
export const LIMITED_POOL_ID = 'limited_challenge'

export const GACHA_POOLS: Record<string, GachaPool> = {
  [PERMANENT_POOL_ID]: {
    id: PERMANENT_POOL_ID,
    name: '常驻奖池',
    type: 'permanent',
    description: '技能与材料',
    cost: 280,  // 280钻石一抽
    pity: { target: 90, softPity: 80 },
    rates: { common: 60, rare: 30, epic: 9, legendary: 1 },
    rewards: [
      // common (60%)
      { id: 'skill_book_1', type: 'skill', name: '技能书×1', value: 1, rarity: 'common' },
      { id: 'gold_1000', type: 'gold', name: '金币×1000', value: 1000, rarity: 'common' },
      // rare (30%)
      { id: 'skill_book_5', type: 'skill', name: '技能书×5', value: 5, rarity: 'rare' },
      { id: 'stat_critRate_1', type: 'statFragment', name: '暴击率碎片×1', value: 1, rarity: 'rare' },
      // epic (9%)
      { id: 'skill_book_10', type: 'skill', name: '技能书×10', value: 10, rarity: 'epic' },
      { id: 'stat_penetration_1', type: 'statFragment', name: '穿透碎片×1', value: 1, rarity: 'epic' },
      // legendary (1%)
      { id: 'skill_legendary_1', type: 'skill', name: '传说技能碎片×1', value: 1, rarity: 'legendary' },
    ]
  },

  [LIMITED_POOL_ID]: {
    id: LIMITED_POOL_ID,
    name: '限定奖池·深渊征服者',
    type: 'limited',
    description: '限定被动与稀有词缀',
    theme: '深渊征服者',
    cost: 280,
    pity: { target: 90, softPity: 80 },
    rates: { common: 50, rare: 35, epic: 13, legendary: 2 },
    rewards: [
      // common (50%)
      { id: 'material_1', type: 'material', name: '强化材料×1', value: 1, rarity: 'common' },
      { id: 'gold_2000', type: 'gold', name: '金币×2000', value: 2000, rarity: 'common' },
      // rare (35%)
      { id: 'passive_frag_1', type: 'passive', name: '被动碎片×1', value: 1, rarity: 'rare' },
      { id: 'stat_dodge_1', type: 'statFragment', name: '闪避碎片×1', value: 1, rarity: 'rare' },
      // epic (13%)
      { id: 'stat_critDamage_1', type: 'statFragment', name: '暴伤碎片×1', value: 1, rarity: 'epic' },
      { id: 'passive_frag_5', type: 'passive', name: '被动碎片×5', value: 5, rarity: 'epic' },
      // legendary (2%)
      { id: 'passive_legendary_1', type: 'passive', name: '限定被动碎片×1', value: 1, rarity: 'legendary' },
    ]
  }
}
