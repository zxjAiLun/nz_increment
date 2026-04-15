export interface GuildWar {
  id: string
  guildId: string
  opponentGuildId: string
  status: 'signup' | 'matching' | 'fighting' | 'finished'
  startTime: number
  endTime: number
  score: { guild: number; opponent: number }
}

export const GUILD_WAR_SEASONS = [
  { id: 'gw_s1', name: '公会战S1', startDate: Date.now(), duration: 7 * 24 * 60 * 60 * 1000 },
]
