import { defineStore } from 'pinia'
import { ref } from 'vue'
import { TITLES, type Title } from '../data/titles'

export const useTitleStore = defineStore('title', () => {
  const ownedTitles = ref<string[]>(['title_newbie'])  // 默认拥有
  const equippedTitle = ref<string | null>(null)

  function unlockTitle(titleId: string): boolean {
    if (ownedTitles.value.includes(titleId)) return false
    ownedTitles.value.push(titleId)
    return true
  }

  function equipTitle(titleId: string): boolean {
    if (!ownedTitles.value.includes(titleId)) return false
    equippedTitle.value = titleId
    return true
  }

  function unequipTitle() {
    equippedTitle.value = null
  }

  function getTitleEffect(titleId: string): Title['effect'] | null {
    return TITLES.find(t => t.id === titleId)?.effect || null
  }

  function getEquippedEffect() {
    if (!equippedTitle.value) return null
    return getTitleEffect(equippedTitle.value)
  }

  return { ownedTitles, equippedTitle, unlockTitle, equipTitle, unequipTitle, getTitleEffect, getEquippedEffect }
})
