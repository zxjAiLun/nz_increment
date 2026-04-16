/**
 * 图鉴系统 Store
 * 
 * 负责：怪物/装备发现记录、里程碑进度追踪与奖励发放
 * 
 * @module collectionStore
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { usePlayerStore } from './playerStore'
import type { AchievementReward } from '../types'

const COLLECTION_KEY = 'nz_collection_v1'
const MONSTER_COUNT = 50
const EQUIPMENT_COUNT = 30

interface CollectionState {
  discoveredMonsters: string[]
  discoveredEquipments: string[]
  milestonesClaimed: number[]
}

export const COLLECTION_MILESTONES = [
  { percent: 10, reward: { gold: 500 } },
  { percent: 25, reward: { diamond: 5 } },
  { percent: 50, reward: { exp: 1000 } },
  { percent: 75, reward: { gold: 2000, diamond: 10 } },
  { percent: 100, reward: { legendaryEquipment: 1 } }
]

export const useCollectionStore = defineStore('collection', () => {
  const collection = ref<CollectionState>({
    discoveredMonsters: [],
    discoveredEquipments: [],
    milestonesClaimed: []
  })

  const totalCount = computed(() => MONSTER_COUNT + EQUIPMENT_COUNT)
  const discoveredCount = computed(
    () => collection.value.discoveredMonsters.length + collection.value.discoveredEquipments.length
  )
  const progressPercent = computed(() =>
    totalCount.value > 0 ? Math.floor((discoveredCount.value / totalCount.value) * 100) : 0
  )

  function load() {
    try {
      const saved = localStorage.getItem(COLLECTION_KEY)
      if (saved) {
        collection.value = JSON.parse(saved) as CollectionState
      }
    } catch {
      // silent
    }
  }

  function save() {
    localStorage.setItem(COLLECTION_KEY, JSON.stringify(collection.value))
  }

  function discoverMonster(id: string) {
    if (!collection.value.discoveredMonsters.includes(id)) {
      collection.value.discoveredMonsters.push(id)
      save()
      checkMilestone()
    }
  }

  function discoverEquipment(id: string) {
    if (!collection.value.discoveredEquipments.includes(id)) {
      collection.value.discoveredEquipments.push(id)
      save()
      checkMilestone()
    }
  }

  /** 检查并发放已达成的里程碑奖励，返回新发放的奖励列表 */
  function checkMilestone(): AchievementReward[] {
    const playerStore = usePlayerStore()
    const rewards: AchievementReward[] = []

    for (const milestone of COLLECTION_MILESTONES) {
      if (
        progressPercent.value >= milestone.percent &&
        !collection.value.milestonesClaimed.includes(milestone.percent)
      ) {
        collection.value.milestonesClaimed.push(milestone.percent)
        const reward = milestone.reward
        if (reward.gold) playerStore.addGold(reward.gold)
        if (reward.diamond) playerStore.addDiamond(reward.diamond)
        if (reward.exp) playerStore.addExperience(reward.exp)
        if (reward.legendaryEquipment) {
          const equipment = playerStore.generateRandomEquipment()
          if (equipment) {
            equipment.rarity = 'legend'
            playerStore.autoEquipIfBetter(equipment)
          }
        }
        rewards.push(reward)
      }
    }

    if (rewards.length > 0) save()
    return rewards
  }

  function claimMilestone(percent: number): AchievementReward | null {
    const milestone = COLLECTION_MILESTONES.find(m => m.percent === percent)
    if (!milestone) return null
    if (collection.value.milestonesClaimed.includes(percent)) return null
    if (progressPercent.value < percent) return null

    collection.value.milestonesClaimed.push(percent)
    save()
    return milestone.reward
  }

  function isMilestoneClaimed(percent: number): boolean {
    return collection.value.milestonesClaimed.includes(percent)
  }

  // 初始化时加载数据
  load()

  return {
    collection,
    discoveredCount,
    totalCount,
    progressPercent,
    discoverMonster,
    discoverEquipment,
    checkMilestone,
    claimMilestone,
    isMilestoneClaimed,
    COLLECTION_MILESTONES
  }
})
