export type AchievementCategory = 'combat' | 'collection' | 'challenge' | 'social' | 'endless' | 'special' | 'pvp' | 'rebirth' | 'speedKill'

export interface Achievement {
  id: string
  category: AchievementCategory
  name: string
  description: string
  condition: AchievementCondition
  reward: AchievementReward
  unlockedAt?: number
}

export interface AchievementReward {
  diamond?: number
  title?: string
  avatarFrame?: string
  gold?: number
}

export interface AchievementCondition {
  type: AchievementConditionType
  target: number
  element?: string
}

export type AchievementConditionType = 
  | 'kill_count' 
  | 'gold_earned' 
  | 'floor_reached' 
  | 'boss_kills' 
  | 'crit_count' 
  | 'combo_max' 
  | 'gacha_pulls' 
  | 'equip_collected'
  | 'dungeon_floor'
  | 'element_reaction'
  | 'guild_donate'
  | 'guild_raid_complete'
  | 'friend_count'
  | 'trade_complete'
  | 'apprentice_graduate'
  | 'adventure_complete'
  | 'speed_kill'
  | 'rebirth_count'
  | 'pet_capture'
  | 'arena_wins'
  | 'battlepass_level'
  | 'total_damage'
  | 'login_streak'
  | 'equipment_upgrade'
  | 'achievement_count'
  | 'pet_count'
  | 'accessory_set_complete'
