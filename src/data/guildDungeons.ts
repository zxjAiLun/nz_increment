import type { GuildDungeon } from '../types/guild'

export const GUILD_DUNGEONS: Omit<GuildDungeon, 'status'>[] = [
  {
    id: 'dungeon_easy',
    name: '初级副本',
    difficulty: 1,
    rewards: { gold: 5000, diamond: 5 }
  },
  {
    id: 'dungeon_medium',
    name: '中级副本',
    difficulty: 3,
    rewards: { gold: 15000, diamond: 15, equipment: 'epic' }
  },
  {
    id: 'dungeon_hard',
    name: '高级副本',
    difficulty: 5,
    rewards: { gold: 50000, diamond: 50, equipment: 'legend' }
  },
]
