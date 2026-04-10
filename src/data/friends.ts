export interface Friend {
  id: string
  name: string
  level: number
  status: 'online' | 'offline'
  lastActive: number
}

export interface BlacklistEntry {
  id: string
  name: string
  blockedAt: number
}
