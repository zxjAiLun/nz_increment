/**
 * 装备传承系统 Store
 * T56 - 装备等级传承、金币转移、锁定保护
 */

import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { InheritanceRecord } from '../types'

export const useInheritanceStore = defineStore('inheritance', () => {
  const records = ref<InheritanceRecord[]>([])
  const inheritanceFeeRate = 0.1  // 传承手续费10%

  function getInheritanceCost(sourceLevel: number): number {
    return Math.floor(sourceLevel * 100 * inheritanceFeeRate)
  }

  function canInherit(sourceEquip: any, targetEquip: any, playerGold: number): { can: boolean; reason?: string } {
    if (sourceEquip.isLocked) return { can: false, reason: '源装备已锁定' }
    if (targetEquip.isLocked) return { can: false, reason: '目标装备已锁定' }
    if (sourceEquip.level <= 1) return { can: false, reason: '源装备等级过低' }
    if (targetEquip.level >= sourceEquip.level) return { can: false, reason: '目标装备等级更高' }
    const cost = getInheritanceCost(sourceEquip.level)
    if (playerGold < cost) return { can: false, reason: `金币不足 (需要${cost})` }
    return { can: true }
  }

  function inheritLevel(sourceEquip: any, targetEquip: any, playerGold: number): boolean {
    const check = canInherit(sourceEquip, targetEquip, playerGold)
    if (!check.can) return false

    const cost = getInheritanceCost(sourceEquip.level)
    const transferredLevel = sourceEquip.level - 1
    const targetNewLevel = targetEquip.level + transferredLevel

    // eslint-disable-next-line no-param-reassign
    playerGold -= cost
    // eslint-disable-next-line no-param-reassign
    sourceEquip.level = 1
    // eslint-disable-next-line no-param-reassign
    targetEquip.level = Math.min(targetNewLevel, 100)  // cap at 100

    records.value.unshift({
      sourceEquipId: sourceEquip.id,
      targetEquipId: targetEquip.id,
      levelTransferred: transferredLevel,
      goldCost: cost,
      timestamp: Date.now()
    })

    return true
  }

  function getRecords(): InheritanceRecord[] {
    return records.value
  }

  return { records, inheritanceFeeRate, getInheritanceCost, canInherit, inheritLevel, getRecords }
})
