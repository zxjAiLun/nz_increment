import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Guild, GuildDungeon } from '../types/guild'
import { generateId } from '../utils/calc'
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
    // 简化：直接加入
    // 实际需要服务器验证
    return false
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
    guildDungeon.value = {
      id: dungeonId,
      name: dungeonId,
      difficulty: 1,
      status: 'in_progress',
      rewards: { gold: 1000 }
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
