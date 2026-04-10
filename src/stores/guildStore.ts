import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Guild, GuildDungeon } from '../types/guild'
import { generateId } from '../utils/calc'
import { GUILD_DUNGEONS } from '../data/guildDungeons'
import { usePlayerStore } from './playerStore'

const GUILD_KEY = 'nz_guild'

// 模拟公会列表（简化：实际需要服务器）
const mockGuildList: Omit<Guild, 'members' | 'createdAt'>[] = [
  { id: 'guild_alpha', name: 'Alpha战队', level: 3, leaderId: 'p1', funds: 5000 },
  { id: 'guild_beta', name: 'Beta联盟', level: 2, leaderId: 'p2', funds: 3000 },
  { id: 'guild_gamma', name: 'Gamma公会', level: 1, leaderId: 'p3', funds: 1000 },
]

export const useGuildStore = defineStore('guild', () => {
  const currentGuild = ref<Guild | null>(null)
  const guildDungeon = ref<GuildDungeon | null>(null)

  function load() {
    try {
      const saved = localStorage.getItem(GUILD_KEY)
      if (saved) {
        currentGuild.value = JSON.parse(saved)
      }
    } catch {
      // silent
    }
  }

  function save() {
    if (currentGuild.value) {
      localStorage.setItem(GUILD_KEY, JSON.stringify(currentGuild.value))
    }
  }

  function createGuild(name: string): Guild {
    const playerStore = usePlayerStore()
    const guild: Guild = {
      id: generateId(),
      name,
      level: 1,
      leaderId: playerStore.player.id,
      members: [{
        odPlayerId: playerStore.player.id,
        name: playerStore.player.name,
        contribution: 0,
        joinedAt: Date.now(),
        role: 'leader'
      }],
      funds: 0,
      createdAt: Date.now()
    }
    currentGuild.value = guild
    save()
    return guild
  }

  function joinGuild(guildId: string): boolean {
    // Mock: create a guild with this ID and join it
    const mockGuild: Guild = {
      id: guildId,
      name: `公会-${guildId.slice(-4)}`,
      level: Math.floor(Math.random() * 5) + 1,
      leaderId: 'mock_leader',
      members: [{
        playerId: playerStore.playerId,
        name: playerStore.player.name,
        contribution: 0,
        joinedAt: Date.now(),
        role: 'member'
      }],
      funds: 0,
      createdAt: Date.now()
    }
    currentGuild.value = mockGuild
    save()
    return true
  }

  function getMockGuilds() {
    return mockGuildList
  }

  function donateFunds(amount: number): boolean {
    const playerStore = usePlayerStore()
    if (!currentGuild.value || playerStore.player.gold < amount) return false
    playerStore.player.gold -= amount
    currentGuild.value.funds += amount
    // 增加个人贡献度
    const member = currentGuild.value.members.find(m => m.odPlayerId === playerStore.player.id)
    if (member) {
      member.contribution += amount
    }
    save()
    return true
  }

  function startDungeon(dungeonId: string) {
    const dungeonConfig = GUILD_DUNGEONS.find(d => d.id === dungeonId)
    if (!dungeonConfig) return
    guildDungeon.value = {
      id: dungeonConfig.id,
      name: dungeonConfig.name,
      difficulty: dungeonConfig.difficulty,
      status: 'in_progress',
      rewards: dungeonConfig.rewards
    }
  }

  // 初始化加载
  load()

  return {
    currentGuild,
    guildDungeon,
    createGuild,
    joinGuild,
    getMockGuilds,
    donateFunds,
    startDungeon
  }
})
