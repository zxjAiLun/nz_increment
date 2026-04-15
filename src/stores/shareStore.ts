import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { ShareContent } from '../data/shareContent'
import { SHARE_TEMPLATES } from '../data/shareContent'

export const useShareStore = defineStore('share', () => {
  const shareHistory = ref<ShareContent[]>([])
  const pendingShare = ref<ShareContent | null>(null)

  function generateShareCode(): string {
    return Math.random().toString(36).substring(2, 10).toUpperCase()
  }

  function createShare(type: ShareContent['type'], data: {
    title: string
    description: string
    stats?: Record<string, string | number>
  }): ShareContent {
    const content: ShareContent = {
      id: `share_${Date.now()}`,
      type,
      title: data.title,
      description: data.description,
      shareCode: generateShareCode(),
      timestamp: Date.now(),
      stats: data.stats
    }
    shareHistory.value.unshift(content)
    if (shareHistory.value.length > 50) shareHistory.value.pop()
    return content
  }

  function shareBattleVictory(floor: number, result: 'victory' | 'defeat') {
    return createShare('battle_victory', {
      title: `第${floor}层${result === 'victory' ? '胜利' : '失败'}`,
      description: `我在地牢第${floor}层${result === 'victory' ? '取得了胜利' : '惜败'}！`,
      stats: { floor, result }
    })
  }

  function shareAchievement(achievementName: string) {
    return createShare('achievement', {
      title: `成就解锁：${achievementName}`,
      description: `我解锁了成就：${achievementName}！`,
      stats: { achievement: achievementName }
    })
  }

  function shareRanking(rank: number) {
    return createShare('ranking', {
      title: `排行榜第${rank}名`,
      description: `我在排行榜上名列第${rank}名！`,
      stats: { rank }
    })
  }

  function shareEquipment(equipName: string, rarity: string) {
    return createShare('equipment', {
      title: `装备展示：${equipName}`,
      description: `看看我的${rarity}装备：${equipName}！`,
      stats: { equipment: equipName, rarity }
    })
  }

  function getShareLink(shareCode: string): string {
    return `https://nz-game.com/share/${shareCode}`
  }

  function copyShareText(share: ShareContent): string {
    const template = SHARE_TEMPLATES[share.type]
    return `${template.title}\n${share.description}\n${getShareLink(share.shareCode)}`
  }

  return { shareHistory, pendingShare, createShare, shareBattleVictory, shareAchievement, shareRanking, shareEquipment, getShareLink, copyShareText }
})
