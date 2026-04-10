export interface SkillSkin {
  id: string
  name: string
  skillId: string
  rarity: 'common' | 'rare' | 'epic' | 'legend'
  unlockType: 'purchase' | 'reputation' | 'achievement' | 'battlePass'
  cost?: number
  reputationLevel?: number
  description: string
  effectColor: string
  particleEffect?: string
}

export const SKILL_SKINS: SkillSkin[] = [
  { id: 'skin_fire_bolt', name: '烈焰冲击', skillId: 'fire_bolt', rarity: 'rare', unlockType: 'purchase', cost: 1000, description: '火焰系技能皮肤', effectColor: '#ef4444', particleEffect: 'fire_particle' },
  { id: 'skin_ice_arrow', name: '寒冰箭矢', skillId: 'ice_arrow', rarity: 'rare', unlockType: 'purchase', cost: 1000, description: '寒冰系技能皮肤', effectColor: '#3b82f6', particleEffect: 'ice_crystal' },
  { id: 'skin_thunder_strike', name: '雷霆一击', skillId: 'thunder_strike', rarity: 'epic', unlockType: 'reputation', reputationLevel: 10, description: '雷霆系终极皮肤', effectColor: '#f59e0b', particleEffect: 'lightning_bolt' },
  { id: 'skin_void_blade', name: '虚空之刃', skillId: 'void_blade', rarity: 'legend', unlockType: 'achievement', description: '击杀1000Boss解锁', effectColor: '#a855f7', particleEffect: 'void_portal' },
  { id: 'skin_dragon_fist', name: '龙拳', skillId: 'dragon_fist', rarity: 'epic', unlockType: 'battlePass', description: '战令限定皮肤', effectColor: '#f97316', particleEffect: 'dragon_trail' },
  { id: 'skin_shadow_dagger', name: '暗影匕首', skillId: 'shadow_dagger', rarity: 'rare', unlockType: 'purchase', cost: 800, description: '刺客系技能皮肤', effectColor: '#6b7280', particleEffect: 'shadow_trail' },
]
