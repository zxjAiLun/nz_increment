/**
 * 装备词缀升级系统 Store
 * 可金币提升的词缀（attack/defense/maxHp/speed）可通过消耗金币进行升级
 */

import { defineStore } from 'pinia'
import type { Equipment, StatAffix } from '../types'

export const UPGRADE_BASE_COST = 100
export const UPGRADE_GROWTH = 1.15

export const useEquipmentUpgradeStore = defineStore('equipmentUpgrade', () => {
  /**
   * 计算升级所需金币
   * @param baseValue - 词缀基础值
   * @param currentLevel - 当前升级等级
   * @returns 升级所需金币
   */
  function calculateUpgradeCost(baseValue: number, currentLevel: number): number {
    return Math.floor(UPGRADE_BASE_COST * UPGRADE_GROWTH ** currentLevel)
  }

  /**
   * 升级指定装备的词缀
   * @param equipment - 装备
   * @param affixIndex - 词缀索引
   * @param playerGold - 玩家当前金币
   * @returns 是否升级成功
   */
  function upgradeAffix(equipment: Equipment, affixIndex: number, playerGold: number): boolean {
    const affix = equipment.affixes[affixIndex]
    if (!affix) return false
    if (!affix.isUpgradeable) return false

    const cost = calculateUpgradeCost(affix.value, affix.upgradeLevel)
    if (playerGold < cost) return false

    // 每级+10% value
    affix.value += Math.floor(affix.value * 0.1)
    affix.upgradeLevel++
    return true
  }

  /**
   * 获取词缀升级信息
   */
  function getAffixUpgradeInfo(affix: StatAffix): { canUpgrade: boolean; nextCost: number; nextValue: number } {
    const nextCost = calculateUpgradeCost(affix.value, affix.upgradeLevel)
    const nextValue = affix.value + Math.floor(affix.value * 0.1)
    return { canUpgrade: affix.isUpgradeable, nextCost, nextValue }
  }

  return { calculateUpgradeCost, upgradeAffix, getAffixUpgradeInfo, UPGRADE_BASE_COST, UPGRADE_GROWTH }
})
