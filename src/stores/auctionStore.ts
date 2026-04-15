import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { generateId } from '../utils/calc'

// T68 拍卖行物品状态
export type AuctionStatus = 'active' | 'sold' | 'cancelled' | 'expired'

// T68 拍卖物品
export interface AuctionItem {
  id: string
  sellerId: string
  sellerName: string
  equipmentId?: string
  name: string
  rarity: string
  price: number          // 金币价格，0表示钻石定价
  diamondPrice?: number  // 钻石价格
  currentBid?: number    // 当前最高出价
  currentBidderId?: string
  currentBidderName?: string
  bids: AuctionBid[]
  status: AuctionStatus
  createdAt: number
  endsAt: number         // 12小时后结束
  category: AuctionCategory
}

export interface AuctionBid {
  id: string
  bidderId: string
  bidderName: string
  amount: number
  timestamp: number
}

export type AuctionCategory = 'weapon' | 'armor' | 'accessory' | 'material' | 'all'

const STORAGE_KEY = 'nz_auction_v1'
const AUCTION_DURATION = 12 * 60 * 60 * 1000 // 12小时
const PLATFORM_FEE = 0.05 // 5% 平台费

export const useAuctionStore = defineStore('auction', () => {
  const listings = ref<AuctionItem[]>([])
  const myListings = ref<AuctionItem[]>([])
  const myBids = ref<AuctionItem[]>([])

  function load() {
    try {
      const raw = localStorage?.getItem(STORAGE_KEY)
      if (raw) {
        const data = JSON.parse(raw)
        listings.value = data.listings || []
        myListings.value = data.myListings || []
        myBids.value = data.myBids || []
        cleanupExpired()
      }
    } catch { /* silent */ }
  }

  function save() {
    try {
      localStorage?.setItem(STORAGE_KEY, JSON.stringify({
        listings: listings.value,
        myListings: myListings.value,
        myBids: myBids.value,
      }))
    } catch { /* silent in test env */ }
  }

  // T68 清理过期
  function cleanupExpired() {
    const now = Date.now()
    listings.value.forEach(item => {
      if (item.status === 'active' && item.endsAt <= now) {
        item.status = 'expired'
      }
    })
    // 重新分类
    myListings.value = listings.value.filter(l => l.sellerId === 'player')
    myBids.value = listings.value.filter(l => l.currentBidderId === 'player' && l.status === 'active')
  }

  // T68 上架物品
  function listItem(
    sellerId: string,
    sellerName: string,
    equipmentId: string,
    name: string,
    rarity: string,
    price: number,
    category: AuctionCategory,
    diamondPrice?: number
  ): AuctionItem {
    const item: AuctionItem = {
      id: generateId(),
      sellerId,
      sellerName,
      equipmentId,
      name,
      rarity,
      price,
      diamondPrice,
      bids: [],
      status: 'active',
      createdAt: Date.now(),
      endsAt: Date.now() + AUCTION_DURATION,
      category,
    }
    listings.value.unshift(item)
    if (sellerId === 'player') myListings.value.unshift(item)
    save()
    return item
  }

  // T68 出价
  function placeBid(itemId: string, bidderId: string, bidderName: string, amount: number): boolean {
    const item = listings.value.find(l => l.id === itemId)
    if (!item || item.status !== 'active') return false
    if (Date.now() > item.endsAt) {
      item.status = 'expired'
      save()
      return false
    }
    if (bidderId === item.sellerId) return false // 不能给自己出价
    const currentBid = item.currentBid || item.price
    if (amount <= currentBid) return false // 必须高于当前价

    const bid: AuctionBid = {
      id: generateId(),
      bidderId,
      bidderName,
      amount,
      timestamp: Date.now(),
    }
    item.bids.push(bid)
    item.currentBid = amount
    item.currentBidderId = bidderId
    item.currentBidderName = bidderName
    if (bidderId === 'player') {
      const existingIdx = myBids.value.findIndex(b => b.id === itemId)
      if (existingIdx >= 0) myBids.value[existingIdx] = item
      else myBids.value.unshift(item)
    }
    save()
    return true
  }

  // T68 立即购买（有的物品可以一口价）
  function buyNow(itemId: string, buyerId: string): boolean {
    const item = listings.value.find(l => l.id === itemId)
    if (!item || item.status !== 'active') return false
    if (Date.now() > item.endsAt) {
      item.status = 'expired'
      save()
      return false
    }
    item.status = 'sold'
    item.currentBidderId = buyerId
    if (buyerId === 'player') {
      const idx = myBids.value.findIndex(b => b.id === itemId)
      if (idx >= 0) myBids.value.splice(idx, 1)
    }
    save()
    return true
  }

  // T68 取消上架
  function cancelListing(itemId: string, sellerId: string): boolean {
    const item = listings.value.find(l => l.id === itemId && l.sellerId === sellerId)
    if (!item || item.status !== 'active') return false
    if (item.bids.length > 0) return false // 有人出价不能取消
    item.status = 'cancelled'
    save()
    return true
  }

  // T68 计算卖家实际收入
  function calculateSellerRevenue(goldReceived: number): number {
    return Math.floor(goldReceived * (1 - PLATFORM_FEE))
  }

  // T68 按分类筛选
  const activeListings = computed(() =>
    listings.value.filter(l => l.status === 'active' && l.endsAt > Date.now())
  )

  function getByCategory(category: AuctionCategory) {
    if (category === 'all') return activeListings.value
    return activeListings.value.filter(l => l.category === category)
  }

  function getEndingSoon(limit = 5) {
    const now = Date.now()
    return activeListings.value
      .filter(l => l.endsAt - now < 2 * 60 * 60 * 1000) // 2小时内
      .sort((a, b) => a.endsAt - b.endsAt)
      .slice(0, limit)
  }

  return {
    listings,
    myListings,
    myBids,
    activeListings,
    load,
    listItem,
    placeBid,
    buyNow,
    cancelListing,
    calculateSellerRevenue,
    getByCategory,
    getEndingSoon,
    cleanupExpired,
  }
})
