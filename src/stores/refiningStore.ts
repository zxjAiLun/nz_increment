/**
 * 装备精炼系统 Store（Phase 3.5 收口）
 *
 * 所有精炼数值与规则的唯一来源已迁至 src/utils/equipmentRefining.ts。
 * 本 Store 只保留**展示用纯委托**（getRefiningCost / canRefine），复用 equipmentRefining.ts，
 * 不得继续持有另一份成本/成长公式。
 *
 * 生产精炼写入只经 playerStore.tryRefineEquipment（原子事务 + 主存档）。
 * 旧的 mutating API（addRefiningSlot / refine）已删除。
 */

import { defineStore } from 'pinia'
import type { Equipment } from '../types'
import {
  calculateRefiningCost,
  MAX_REFINING_LEVEL,
  type RefiningValidationResult
} from '../utils/equipmentRefining'
import { validateEquipmentRefiningState } from '../utils/equipmentRefining'

export const REFINING_MATERIAL_ID = 'refining_stone'

export const useRefiningStore = defineStore('refining', () => {
  /**
   * 获取精炼所需金币（展示用；公式唯一来源在 equipmentRefining.calculateRefiningCost）。
   */
  function getRefiningCost(level: number): number {
    return calculateRefiningCost(level)
  }

  /**
   * 检查是否可以精炼（展示用；仅基于等级上限与金币是否足够，不含 RNG/写入）。
   */
  function canRefine(equipment: Equipment, playerGold: number): boolean {
    const valid: RefiningValidationResult = validateEquipmentRefiningState(equipment)
    if (!valid.ok) return false
    if (equipment.refiningLevel >= MAX_REFINING_LEVEL) return false
    return playerGold >= calculateRefiningCost(equipment.refiningLevel)
  }

  return { getRefiningCost, canRefine }
})
