export interface Pet {
  id: string
  name: string
  rarity: 'common' | 'rare' | 'epic' | 'legend'
  baseStats: { attack: number; defense: number; maxHp: number; speed: number }
  skillId: string
  evolutionStages: number  // 进化阶段数
  currentStage: number
}

export const PETS: Pet[] = [
  { id: 'pet_fire_sprite', name: '火焰精灵', rarity: 'rare', baseStats: { attack: 30, defense: 10, maxHp: 200, speed: 25 }, skillId: 'pet_fireball', evolutionStages: 2, currentStage: 1 },
  { id: 'pet_ice_golem', name: '寒冰傀儡', rarity: 'epic', baseStats: { attack: 20, defense: 50, maxHp: 500, speed: 10 }, skillId: 'pet_ice_shield', evolutionStages: 2, currentStage: 1 },
  { id: 'pet_thunder_bird', name: '雷霆之鸟', rarity: 'legend', baseStats: { attack: 60, defense: 20, maxHp: 300, speed: 50 }, skillId: 'pet_thunder', evolutionStages: 3, currentStage: 1 },
  { id: 'pet_earth_wolf', name: '大地狼', rarity: 'common', baseStats: { attack: 15, defense: 20, maxHp: 150, speed: 20 }, skillId: 'pet_earth_bite', evolutionStages: 2, currentStage: 1 },
]

export const PET_SKILLS = {
  pet_fireball: { name: '火焰冲击', damage: 80, description: '造成80火属性伤害' },
  pet_ice_shield: { name: '寒冰护盾', shield: 100, description: '生成100点护盾' },
  pet_thunder: { name: '雷霆一击', damage: 120, description: '造成120雷属性伤害' },
  pet_earth_bite: { name: '大地撕咬', damage: 50, description: '造成50土属性伤害' },
}
