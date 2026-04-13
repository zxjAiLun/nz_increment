import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { WORLD_BOSSES, type WorldBoss } from '../data/worldBoss'

export const useWorldBossStore = defineStore('worldBoss', () => {
  const currentBoss = ref<WorldBoss | null>(null)
  const bossHp = ref(0)
  const totalDamage = ref(0)
  const myContribution = ref(0)
  const challengeTickets = ref(3)
  const damageRankings = ref<{ playerId: string; name: string; damage: number }[]>([])
  const isDefeated = ref(false)
  
  // T82 世界Boss赛季系统
  const currentSeason = ref({
    seasonId: 'wb_s1',
    totalSeasonDamage: 0,
    topDamage: 0,
    topPlayer: '',
    participationCount: 0,
  })
  
  // T82 Boss当前阶段
  const bossPhase = ref(1)
  
  // T82 Boss怒气值（满时释放技能）
  const bossRage = ref(0)
  
  // T82 已领取的奖励记录
  const claimedRewards = ref<Set<string>>(new Set())

  function spawnBoss(bossId: string) {
    const boss = WORLD_BOSSES.find((b) => b.id === bossId)
    if (!boss) return
    currentBoss.value = boss
    bossHp.value = boss.maxHp
    totalDamage.value = 0
    myContribution.value = 0
    isDefeated.value = false
    bossPhase.value = 1
    bossRage.value = 0
  }

  function attackBoss(damage: number): number {
    if (!currentBoss.value || isDefeated.value) return 0
    
    // T82 阶段增强：每个阶段boss受到伤害减少10%
    const phaseMultiplier = 1 - (bossPhase.value - 1) * 0.1
    const effectiveDamage = Math.floor(damage * phaseMultiplier)
    
    bossHp.value = Math.max(0, bossHp.value - effectiveDamage)
    totalDamage.value += effectiveDamage
    myContribution.value += effectiveDamage
    
    // T82 积累怒气
    bossRage.value = Math.min(100, bossRage.value + damage * 0.01)
    
    // T82 检测阶段变化（每损失25% HP触发一次）
    const hpPercent = bossHp.value / currentBoss.value.maxHp
    if (hpPercent <= 0.25 && bossPhase.value < 4) {
      bossPhase.value = 4
    } else if (hpPercent <= 0.5 && bossPhase.value < 3) {
      bossPhase.value = 3
    } else if (hpPercent <= 0.75 && bossPhase.value < 2) {
      bossPhase.value = 2
    }

    if (bossHp.value <= 0) {
      isDefeated.value = true
      // T82 更新赛季统计
      currentSeason.value.totalSeasonDamage += totalDamage.value
      currentSeason.value.participationCount++
      if (totalDamage.value > currentSeason.value.topDamage) {
        currentSeason.value.topDamage = totalDamage.value
        currentSeason.value.topPlayer = 'player'
      }
      return currentBoss.value.rewards.diamond
    }
    return 0
  }

  function useTicket(): boolean {
    if (challengeTickets.value <= 0) return false
    challengeTickets.value--
    return true
  }

  function addTickets(count: number) {
    challengeTickets.value += count
  }

  function getBossHpPercent(): number {
    if (!currentBoss.value) return 0
    return Math.floor((bossHp.value / currentBoss.value.maxHp) * 100)
  }

  function getMyRank(): number {
    const sorted = [...damageRankings.value].sort((a, b) => b.damage - a.damage)
    return sorted.findIndex((r) => r.damage === myContribution.value) + 1
  }
  
  // T82 获取阶段名称
  const phaseName = computed(() => {
    switch (bossPhase.value) {
      case 1: return '第一阶段'
      case 2: return '第二阶段'
      case 3: return '第三阶段'
      case 4: return '狂暴阶段'
      default: return '第一阶段'
    }
  })
  
  // T82 领取贡献奖励
  function claimContributionReward(threshold: number): string | null {
    const rewardId = `contrib_${threshold}`
    if (claimedRewards.value.has(rewardId)) return null
    if (myContribution.value < threshold) return null
    
    claimedRewards.value.add(rewardId)
    
    if (threshold >= 100000) return 'legend_chest'
    if (threshold >= 50000) return 'epic_chest'
    if (threshold >= 10000) return 'rare_chest'
    return 'common_chest'
  }
  
  // T82 获取赛季排名奖励
  function getSeasonRewards(): string[] {
    const rewards: string[] = []
    const myRank = getMyRank()
    
    if (myRank === 1) {
      rewards.push('world_boss_king_title', 'diamond_1000', 'unique_boss_skin')
    } else if (myRank <= 10) {
      rewards.push('world_boss_elite_title', 'diamond_500')
    } else if (myRank <= 50) {
      rewards.push('world_boss_warrior_title', 'diamond_200')
    } else {
      rewards.push('world_boss_participant_title', 'diamond_50')
    }
    return rewards
  }
  
  // T82 重置赛季
  function resetSeason() {
    currentSeason.value = {
      seasonId: `wb_s${parseInt(currentSeason.value.seasonId.split('s')[1]) + 1}`,
      totalSeasonDamage: 0,
      topDamage: 0,
      topPlayer: '',
      participationCount: 0,
    }
    claimedRewards.value.clear()
  }

  return {
    currentBoss,
    bossHp,
    totalDamage,
    myContribution,
    challengeTickets,
    damageRankings,
    isDefeated,
    currentSeason,
    bossPhase,
    bossRage,
    phaseName,
    spawnBoss,
    attackBoss,
    useTicket,
    addTickets,
    getBossHpPercent,
    getMyRank,
    claimContributionReward,
    getSeasonRewards,
    resetSeason,
  }
})
