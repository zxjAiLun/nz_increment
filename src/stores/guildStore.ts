import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Guild, GuildDungeon } from '../types/guild'
import { generateId } from '../utils/calc'
import { GUILD_DUNGEONS } from '../data/guildDungeons'
import { usePlayerStore } from './playerStore'

const GUILD_KEY = 'nz_guild'

// T67 公会签到常量
const GUILD_SIGNIN_KEY = 'nz_guild_signin_v1'
const WEEKEND_BONUS_MULTIPLIER = 2

interface SignInRecord {
  lastSignIn: number  // timestamp
  streak: number      // 连续签到天数
}

// 模拟公会列表（简化：实际需要服务器）
const mockGuildList: Omit<Guild, 'members' | 'createdAt'>[] = [
  { id: 'guild_alpha', name: 'Alpha战队', level: 3, leaderId: 'p1', funds: 5000 },
  { id: 'guild_beta', name: 'Beta联盟', level: 2, leaderId: 'p2', funds: 3000 },
  { id: 'guild_gamma', name: 'Gamma公会', level: 1, leaderId: 'p3', funds: 1000 },
]

export const useGuildStore = defineStore('guild', () => {
  const currentGuild = ref<Guild | null>(null)
  const guildDungeon = ref<GuildDungeon | null>(null)
  const signInRecord = ref<SignInRecord>({ lastSignIn: 0, streak: 0 })

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

  function loadSignIn() {
    try {
      const saved = localStorage?.getItem(GUILD_SIGNIN_KEY)
      if (saved) signInRecord.value = JSON.parse(saved)
    } catch { /* silent */ }
  }

  function saveSignIn() {
    try {
      localStorage?.setItem(GUILD_SIGNIN_KEY, JSON.stringify(signInRecord.value))
    } catch { /* silent */ }
  }

  function isWeekend(): boolean {
    const day = new Date().getDay()
    return day === 0 || day === 6
  }

  function canSignIn(): boolean {
    if (!currentGuild.value) return false
    const now = new Date()
    const last = new Date(signInRecord.value.lastSignIn)
    return now.toDateString() !== last.toDateString()
  }

  /**
   * T67 公会签到
   * @returns 获得的贡献度（周末双倍）
   */
  function signIn(): number {
    if (!currentGuild.value) return 0
    if (!canSignIn()) return 0

    const now = Date.now()
    const last = signInRecord.value.lastSignIn
    const lastDate = new Date(last)

    // 计算连续签到
    if (last > 0 && lastDate.toDateString() === new Date(now - 86400000).toDateString()) {
      signInRecord.value.streak++
    } else {
      signInRecord.value.streak = 1
    }

    signInRecord.value.lastSignIn = now

    // 基础贡献 + 周末双倍
    let contribution = 50
    if (isWeekend()) contribution *= WEEKEND_BONUS_MULTIPLIER
    if (signInRecord.value.streak >= 7) contribution += 50  // 全勤额外奖励

    const playerStore = usePlayerStore()
    const member = currentGuild.value.members.find(m => m.odPlayerId === playerStore.player.id)
    if (member) {
      member.contribution += contribution
    }
    currentGuild.value.funds += contribution

    saveSignIn()
    save()
    return contribution
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
    const playerStore = usePlayerStore()
    const mockGuild: Guild = {
      id: guildId,
      name: `公会-${guildId.slice(-4)}`,
      level: Math.floor(Math.random() * 5) + 1,
      leaderId: 'mock_leader',
      members: [{
        odPlayerId: playerStore.player.id,
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
  loadSignIn()

  return {
    currentGuild,
    guildDungeon,
    signInRecord,
    canSignIn,
    signIn,
    createGuild,
    joinGuild,
    getMockGuilds,
    donateFunds,
    startDungeon
  }
})
