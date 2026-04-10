/**
 * 装备精炼系统 Store
 * 精炼附加额外词缀，精炼等级 0-15
 */

import { defineStore } from 'pinia'
import type { Equipment, RefiningSlot } from '../types'

export const REFINING_MATERIAL_ID = 'refining_stone'

export const useRefiningStore = defineStore('refining', () => {
  /**
   * 添加精炼槽位（最多3个）
   */
  function addRefiningSlot(equipment: Equipment): RefiningSlot | null {
    if (equipment.refiningSlots.length >= 3) return null
    const slots = equipment.refiningSlots
    const availableStats = ['attack', 'defense', 'maxHp', 'critRate', 'critDamage', 'lifesteal']
    const stat = availableStats[Math.floor(Math.random() * availableStats.length)]
    const slot: RefiningSlot = {
      index: slots.length,
      stat,
      value: Math.floor(equipment.level * 0.5) + 1,
      type: 'flat'
    }
    slots.push(slot)
    return slot
  }

  /**
   * 获取精炼所需金币
   */
  function getRefiningCost(level: number): number {
    return Math.floor(100 * Math.pow(1.2, level))
  }

  /**
   * 检查是否可以精炼
   */
  function canRefine(equipment: Equipment, playerGold: number): boolean {
    if (equipment.refiningLevel >= 15) return false
    return playerGold >= getRefiningCost(equipment.refiningLevel)
  }

  /**
   * 执行精炼
   * @returns 是否成功精炼
   */
  function refine(equipment: Equipment, playerGold: number): boolean {
    if (!canRefine(equipment, playerGold)) return false
    const cost = getRefiningCost(equipment.refiningLevel)
    playerGold -= cost
    equipment.refiningLevel++
    // 精炼成功时给一个精炼槽位（满3个后不再添加）
    if (equipment.refiningSlots.length < 3) {
      addRefiningSlot(equipment)
    } else {
      // 强化已有精炼槽位
      for (const slot of equipment.refiningSlots) {
        slot.value = Math.floor(slot.value * 1.1)
      }
    }
    return true
  }

  return { addRefiningSlot, getRefiningCost, canRefine, refine }
})
