import type { Blessing, Curse, Relic } from '../types/roguelike'

export const BLESSINGS: Blessing[] = [
  { id: 'bless_atk', name: '攻击祝福', description: '攻击+10%', rarity: 'common', effect: [{ stat: 'attack', value: 10, type: 'percent' }] },
  { id: 'bless_def', name: '防御祝福', description: '防御+10%', rarity: 'common', effect: [{ stat: 'defense', value: 10, type: 'percent' }] },
  { id: 'bless_crit', name: '暴击祝福', description: '暴击率+8%', rarity: 'rare', effect: [{ stat: 'critRate', value: 8, type: 'flat' }] },
  { id: 'bless_lifesteal', name: '吸血祝福', description: '生命偷取+5%', rarity: 'epic', effect: [{ stat: 'lifesteal', value: 5, type: 'flat' }] },
  { id: 'bless_speed', name: '疾风祝福', description: '速度+15%', rarity: 'rare', effect: [{ stat: 'speed', value: 15, type: 'percent' }] },
  { id: 'bless_damage', name: '伤害祝福', description: '伤害+20%', rarity: 'legend', effect: [{ stat: 'damageBonus', value: 20, type: 'percent' }] },
]

export const CURSES: Curse[] = [
  { id: 'curse_atk', name: '虚弱', description: '攻击-15%', effect: { stat: 'attack', value: -15 } },
  { id: 'curse_def', name: '易伤', description: '受到伤害+10%', effect: { stat: 'defense', value: -10 } },
  { id: 'curse_crit', name: '散漫', description: '暴击率-5%', effect: { stat: 'critRate', value: -5 } },
]

export const RELICS: Relic[] = [
  { id: 'relic_sword', name: '断剑', description: '攻击时有几率秒杀小怪', rarity: 'rare', passive: 'kill_small_enemies' },
  { id: 'relic_shield', name: '残盾', description: '每回合抵消一次伤害', rarity: 'rare', passive: 'damage_block_once' },
  { id: 'relic_ring', name: '诅咒戒指', description: '攻击+20%但受到伤害+15%', rarity: 'epic', passive: 'atk_up_hp_down' },
]
