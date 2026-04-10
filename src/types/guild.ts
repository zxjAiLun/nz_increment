export interface Guild {
  id: string
  name: string
  level: number
  leaderId: string
  members: GuildMember[]
  funds: number  // 公会金币
  createdAt: number
}

export interface GuildMember {
  odPlayerId: string
  name: string
  contribution: number  // 个人贡献度
  joinedAt: number
  role: 'leader' | 'officer' | 'member'
}

export interface GuildDungeon {
  id: string
  name: string
  difficulty: number
  rewards: { gold?: number; diamond?: number; equipment?: string }
  status: 'available' | 'in_progress' | 'completed'
}
