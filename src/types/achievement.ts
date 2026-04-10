export type AchievementCategory = 'combat' | 'collection' | 'challenge' | 'social'

export interface Achievement {
  id: string
  category: AchievementCategory
  name: string
  description: string
  condition: AchievementCondition
  reward: { diamond?: number; title?: string; avatarFrame?: string }
  unlockedAt?: number
}

export interface AchievementCondition {
  type: 'kill_count' | 'gold_earned' | 'floor_reached' | 'boss_kills' |
        'crit_count' | 'combo_max' | 'gacha_pulls' | 'equip_collected'
  target: number
}
