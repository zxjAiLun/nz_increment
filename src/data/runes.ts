// T31.2 符文数据

export interface Rune {
  id: string
  name: string
  rarity: 'common' | 'rare' | 'epic' | 'legend'
  primaryStat: { stat: string; value: number; type: 'flat' | 'percent' }
  secondaryStat?: { stat: string; value: number }
  setBonus?: string  // 同色符文2件套效果
  color: 'red' | 'blue' | 'yellow' | 'green'
}

export const RUNES: Rune[] = [
  { id: 'rune_atk_1', name: '攻击符文', rarity: 'common', primaryStat: { stat: 'attack', value: 10, type: 'flat' }, color: 'red' },
  { id: 'rune_atk_2', name: '攻击符文', rarity: 'rare', primaryStat: { stat: 'attack', value: 25, type: 'flat' }, color: 'red' },
  { id: 'rune_def_1', name: '防御符文', rarity: 'common', primaryStat: { stat: 'defense', value: 10, type: 'flat' }, color: 'blue' },
  { id: 'rune_hp_1', name: '生命符文', rarity: 'common', primaryStat: { stat: 'maxHp', value: 50, type: 'flat' }, color: 'green' },
  { id: 'rune_crit_1', name: '暴击符文', rarity: 'rare', primaryStat: { stat: 'critRate', value: 5, type: 'flat' }, color: 'yellow' },
  { id: 'rune_cd_1', name: '暴伤符文', rarity: 'rare', primaryStat: { stat: 'critDamage', value: 10, type: 'flat' }, color: 'yellow' },
  { id: 'rune_lifesteal_1', name: '吸血符文', rarity: 'epic', primaryStat: { stat: 'lifesteal', value: 3, type: 'flat' }, color: 'green' },
  { id: 'rune_speed_1', name: '速度符文', rarity: 'epic', primaryStat: { stat: 'speed', value: 8, type: 'percent' }, color: 'yellow' },
  { id: 'rune_legend_1', name: '传说符文', rarity: 'legend', primaryStat: { stat: 'attack', value: 50, type: 'flat' }, secondaryStat: { stat: 'critRate', value: 5 }, color: 'red' },
]

export const RUNE_SETS = {
  red: { name: '炽焰套装', pieces: 2, effect: '攻击+10%' },
  blue: { name: '寒霜套装', pieces: 2, effect: '防御+10%' },
  yellow: { name: '雷霆套装', pieces: 2, effect: '暴击+5%' },
  green: { name: '翡翠套装', pieces: 2, effect: '生命+8%' },
}
