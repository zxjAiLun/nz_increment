import { usePlayerStore } from '../stores/playerStore'
import type { StatType } from '../types'

const UPGRADE_COST_MULTIPLIER = 10
const UPGRADE_AMOUNT_BASE = 1

export function useUpgrade() {
  const playerStore = usePlayerStore()
  
  function getUpgradeCost(_stat: StatType, amount: number = UPGRADE_AMOUNT_BASE): number {
    return amount * UPGRADE_COST_MULTIPLIER * (playerStore.player.level || 1)
  }
  
  function canUpgrade(stat: StatType, amount: number = UPGRADE_AMOUNT_BASE): boolean {
    const cost = getUpgradeCost(stat, amount)
    return playerStore.player.gold >= cost
  }
  
  function upgrade(stat: StatType, amount: number = UPGRADE_AMOUNT_BASE): boolean {
    return playerStore.upgradeStat(stat, amount)
  }
  
  function getStatUpgradeInfo(stat: StatType) {
    const currentValue = playerStore.totalStats[stat]
    const cost = getUpgradeCost(stat)
    const affordable = canUpgrade(stat)
    
    return {
      currentValue,
      cost,
      affordable
    }
  }
  
  return {
    getUpgradeCost,
    canUpgrade,
    upgrade,
    getStatUpgradeInfo
  }
}
