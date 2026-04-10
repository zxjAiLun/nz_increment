export interface PlayerProfile {
  playerName: string
  level: number
  title: string
  joinDate: string
  stats: {
    totalBattles: number
    victories: number
    defeat: number
    winRate: number
    totalDamage: number
    totalGoldEarned: number
    bossKills: number
    daysPlayed: number
  }
  achievements: string[]
  equippedTitle: string
  avatarFrame: string
}
