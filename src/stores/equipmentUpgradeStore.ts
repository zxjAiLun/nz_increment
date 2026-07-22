/**
 * 装备词缀升级系统 Store（Phase 3.4 收口）
 *
 * 升级的「生产写入」已统一到 playerStore.tryUpgradeEquipmentAffix()（唯一原子事务入口）。
 * 本 store 不再持有任何 mutating 的升级 API；仅保留展示用的纯计算委托，
 * 成本公式与数值现由 src/utils/equipmentAffixUpgrade.ts 单一来源提供（禁止复制 1.15）。
 */

import { defineStore } from 'pinia'
import type { StatAffix } from '../types'
import { calculateUpgradeCost, calculateUpgradeNextValue, UPGRADE_GROWTH } from '../utils/equipmentAffixUpgrade'

// 单一事实来源已迁至 equipmentAffixUpgrade.ts，此处仅 re-export 以兼容既有引用。
export { UPGRADE_GROWTH }

export const useEquipmentUpgradeStore = defineStore('equipmentUpgrade', () => {
  /**
   * 获取词缀升级信息（仅用于 UI 展示，不修改任何状态）。
   * 计算逻辑现复用 src/utils/equipmentAffixUpgrade.ts 的纯函数，保证与事务入口一致。
   */
  function getAffixUpgradeInfo(affix: StatAffix): { canUpgrade: boolean; nextCost: number; nextValue: number } {
    const nextCost = calculateUpgradeCost(affix.value, affix.upgradeLevel)
    const nextValue = calculateUpgradeNextValue(affix.value)
    return { canUpgrade: affix.isUpgradeable, nextCost, nextValue }
  }

  return { calculateUpgradeCost, getAffixUpgradeInfo, UPGRADE_GROWTH }
})
