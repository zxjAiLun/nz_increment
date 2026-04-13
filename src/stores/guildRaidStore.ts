import { defineStore } from 'pinia'
import { ref } from 'vue'
import { generateId } from '../utils/calc'

// T68 工会副本难度
export type RaidDifficulty = 'normal' | 'hard' | 'hell' | 'infernal'

// T68 副本状态
export type RaidStatus = 'not_started' | 'in_progress' | 'completed' | 'failed'

// T68 工会副本
export interface GuildRaid {
  id: string
  name: string
  description: string
  difficulty: RaidDifficulty
  totalHealth: number
  currentHealth: number
  maxAttempts: number       // 每日最大挑战次数
  currentAttempts: number  // 当日已用次数
  status: RaidStatus
  rewards: RaidReward[]
  bosses: RaidBoss[]
  resetAt: number          // 重置时间（每日凌晨）
}

export interface RaidBoss {
  id: string
  name: string
  health: number
  maxHealth: number
  isDefeated: boolean
  damageDealt: number      // 玩家累计造成伤害
}

export interface RaidReward {
  itemId: string
  name: string
  count: number
  rarity: string
}

// T68 玩家副本记录
export interface PlayerRaidRecord {
  playerId: string
  playerName: string
  raidId: string
  totalDamage: number
  lastDamage: number
  participatedAt: number
}

const STORAGE_KEY = 'nz_guild_raid_v1'
const DEFAULT_RAID_DATA: GuildRaid[] = [
  {
    id: 'raid_1',
    name: '深渊守护者',
    description: '沉睡在深渊中的古老守护者苏醒，威胁着整个大陆',
    difficulty: 'normal',
    totalHealth: 1000000,
    currentHealth: 1000000,
    maxAttempts: 3,
    currentAttempts: 0,
    status: 'not_started',
    rewards: [
      { itemId: 'gold', name: '金币', count: 5000, rarity: 'common' },
      { itemId: 'exp', name: '经验', count: 1000, rarity: 'common' },
    ],
    bosses: [
      { id: 'boss_1_1', name: '深渊之眼', health: 1000000, maxHealth: 1000000, isDefeated: false, damageDealt: 0 },
    ],
    resetAt: Date.now() + 86400000,
  },
  {
    id: 'raid_2',
    name: '虚空领主',
    description: '来自虚空维度的领主，试图撕裂现实与虚空的边界',
    difficulty: 'hard',
    totalHealth: 5000000,
    currentHealth: 5000000,
    maxAttempts: 2,
    currentAttempts: 0,
    status: 'not_started',
    rewards: [
      { itemId: 'gold', name: '金币', count: 15000, rarity: 'fine' },
      { itemId: 'diamond', name: '钻石', count: 50, rarity: 'epic' },
    ],
    bosses: [
      { id: 'boss_2_1', name: '虚空碎片', health: 2500000, maxHealth: 2500000, isDefeated: false, damageDealt: 0 },
      { id: 'boss_2_2', name: '虚空领主', health: 2500000, maxHealth: 2500000, isDefeated: false, damageDealt: 0 },
    ],
    resetAt: Date.now() + 86400000,
  },
  {
    id: 'raid_3',
    name: '永恒巨龙',
    description: '传说中统御元素位面的永恒巨龙，挑战者九死一生',
    difficulty: 'hell',
    totalHealth: 20000000,
    currentHealth: 20000000,
    maxAttempts: 1,
    currentAttempts: 0,
    status: 'not_started',
    rewards: [
      { itemId: 'gold', name: '金币', count: 50000, rarity: 'epic' },
      { itemId: 'diamond', name: '钻石', count: 200, rarity: 'legend' },
      { itemId: 'equip_rare', name: '稀有装备', count: 1, rarity: 'legend' },
    ],
    bosses: [
      { id: 'boss_3_1', name: '龙爪卫', health: 5000000, maxHealth: 5000000, isDefeated: false, damageDealt: 0 },
      { id: 'boss_3_2', name: '龙翼侍', health: 5000000, maxHealth: 5000000, isDefeated: false, damageDealt: 0 },
      { id: 'boss_3_3', name: '永恒巨龙', health: 10000000, maxHealth: 10000000, isDefeated: false, damageDealt: 0 },
    ],
    resetAt: Date.now() + 86400000,
  },
  {
    id: 'raid_4',
    name: '混沌起源',
    description: '创世之初的混沌实体，蕴含毁灭一切的力量',
    difficulty: 'infernal',
    totalHealth: 100000000,
    currentHealth: 100000000,
    maxAttempts: 1,
    currentAttempts: 0,
    status: 'not_started',
    rewards: [
      { itemId: 'gold', name: '金币', count: 200000, rarity: 'legend' },
      { itemId: 'diamond', name: '钻石', count: 500, rarity: 'myth' },
      { itemId: 'equip_myth', name: '神话装备', count: 1, rarity: 'myth' },
    ],
    bosses: [
      { id: 'boss_4_1', name: '混沌碎片', health: 20000000, maxHealth: 20000000, isDefeated: false, damageDealt: 0 },
      { id: 'boss_4_2', name: '混沌双子', health: 30000000, maxHealth: 30000000, isDefeated: false, damageDealt: 0 },
      { id: 'boss_4_3', name: '混沌起源', health: 50000000, maxHealth: 50000000, isDefeated: false, damageDealt: 0 },
    ],
    resetAt: Date.now() + 86400000,
  },
]

export const useGuildRaidStore = defineStore('guildRaid', () => {
  const raids = ref<GuildRaid[]>([...DEFAULT_RAID_DATA])
  const playerRecords = ref<PlayerRaidRecord[]>([])
  const guildMembers = ref<string[]>([]) // 参与副本的公会成员

  function load() {
    try {
      const raw = localStorage?.getItem(STORAGE_KEY)
      if (raw) {
        const data = JSON.parse(raw)
        raids.value = data.raids || DEFAULT_RAID_DATA
        playerRecords.value = data.records || []
        guildMembers.value = data.members || []
        checkDailyReset()
      }
    } catch { /* silent */ }
  }

  function save() {
    try {
      localStorage?.setItem(STORAGE_KEY, JSON.stringify({
        raids: raids.value,
        records: playerRecords.value,
        members: guildMembers.value,
      }))
    } catch { /* silent in test env */ }
  }

  // T68 每日重置
  function checkDailyReset() {
    const now = Date.now()
    raids.value.forEach(raid => {
      if (now >= raid.resetAt) {
        raid.currentAttempts = 0
        raid.resetAt = now + 86400000
        // 重置当前BOSS血量
        raid.bosses.forEach(boss => {
          if (boss.isDefeated) {
            boss.isDefeated = false
            boss.health = boss.maxHealth
            boss.damageDealt = 0
          }
        })
      }
    })
  }

  // T68 挑战副本
  function challengeRaid(raidId: string, playerId: string, playerName: string, damage: number): boolean {
    const raid = raids.value.find(r => r.id === raidId)
    if (!raid) return false
    if (raid.status === 'completed') return false
    if (raid.currentAttempts >= raid.maxAttempts) return false
    if (damage <= 0) return false

    raid.currentAttempts++
    raid.status = 'in_progress'

    // 找到当前存活的BOSS
    const currentBoss = raid.bosses.find(b => !b.isDefeated)
    if (!currentBoss) {
      raid.status = 'completed'
      return true
    }

    currentBoss.damageDealt += damage
    currentBoss.health = Math.max(0, currentBoss.health - damage)

    if (currentBoss.health <= 0) {
      currentBoss.isDefeated = true
      currentBoss.health = 0
      // 检查是否所有BOSS都击杀
      const allDefeated = raid.bosses.every(b => b.isDefeated)
      if (allDefeated) {
        raid.status = 'completed'
        raid.currentHealth = 0
      }
    }

    // 记录玩家伤害
    const existingRecord = playerRecords.value.find(
      r => r.raidId === raidId && r.playerId === playerId
    )
    if (existingRecord) {
      existingRecord.totalDamage += damage
      existingRecord.lastDamage = damage
      existingRecord.participatedAt = Date.now()
    } else {
      playerRecords.value.push({
        playerId,
        playerName,
        raidId,
        totalDamage: damage,
        lastDamage: damage,
        participatedAt: Date.now(),
      })
    }

    save()
    return true
  }

  // T68 获取玩家排名
  function getRaidRankings(raidId: string): PlayerRaidRecord[] {
    return playerRecords.value
      .filter(r => r.raidId === raidId)
      .sort((a, b) => b.totalDamage - a.totalDamage)
  }

  // T68 获取剩余挑战次数
  function getRemainingAttempts(raidId: string): number {
    const raid = raids.value.find(r => r.id === raidId)
    if (!raid) return 0
    return Math.max(0, raid.maxAttempts - raid.currentAttempts)
  }

  return {
    raids,
    playerRecords,
    guildMembers,
    load,
    challengeRaid,
    getRaidRankings,
    getRemainingAttempts,
    checkDailyReset,
  }
})
