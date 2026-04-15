import { defineStore } from 'pinia'
import { ref } from 'vue'
import { usePlayerStore } from './playerStore'
import { MERCHANT_ITEMS, type MerchantItem } from '../data/merchant'

export const useMerchantStore = defineStore('merchant', () => {
  const playerStore = usePlayerStore()
  const currentItems = ref<MerchantItem[]>([])
  const refreshCost = ref(100)  // 刷新花费金币
  const refreshCountdown = ref(0)  // 下次刷新倒计时(秒)
  const discountActive = ref(false)

  function generateItems() {
    // 随机选3-5个商品，打乱顺序
    const shuffled = [...MERCHANT_ITEMS].sort(() => Math.random() - 0.5)
    const count = 3 + Math.floor(Math.random() * 3)
    currentItems.value = shuffled.slice(0, count).map(item => ({
      ...item,
      discountedPrice: item.discount ? Math.floor(item.originalPrice * item.discount) : undefined,
      stock: item.stock
    }))
  }

  function refresh(): boolean {
    if (playerStore.player.gold < refreshCost.value) return false
    playerStore.addGold(-refreshCost.value)
    refreshCost.value = Math.floor(refreshCost.value * 1.2)  // 涨价
    generateItems()
    return true
  }

  function buyItem(itemId: string): boolean {
    const item = currentItems.value.find(i => i.id === itemId)
    if (!item) return false
    if (item.stock === 0) return false

    const price = item.discountedPrice || item.originalPrice
    if (playerStore.player.gold < price) return false

    playerStore.addGold(-price)
    if (item.stock > 0) item.stock--
    return true
  }

  function activateDiscount() {
    discountActive.value = true
    for (const item of currentItems.value) {
      item.discountedPrice = Math.floor(item.originalPrice * 0.7)
    }
  }

  function startCountdown(seconds: number) {
    refreshCountdown.value = seconds
    const interval = setInterval(() => {
      refreshCountdown.value--
      if (refreshCountdown.value <= 0) {
        clearInterval(interval)
        generateItems()
      }
    }, 1000)
  }

  generateItems()
  return { currentItems, refreshCost, refreshCountdown, discountActive, refresh, buyItem, activateDiscount, startCountdown }
})
