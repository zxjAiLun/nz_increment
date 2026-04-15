import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { generateId } from '../utils/calc'

// T68 交易状态
export type TradeStatus = 'pending' | 'accepted' | 'rejected' | 'cancelled' | 'completed'

// T68 交易项
export interface TradeItem {
  id: string
  equipmentId?: string
  gold?: number
  diamond?: number
}

// T68 交易请求
export interface TradeRequest {
  id: string
  fromId: string       // 发起方玩家ID
  fromName: string     // 发起方名字
  toId: string         // 接收方玩家ID
  items: TradeItem[]   // 发起方提供的物品
  gold: number        // 发起方金币
  status: TradeStatus
  createdAt: number
  expiresAt: number    // 24小时后过期
}

// T68 交易记录
export interface TradeHistory {
  id: string
  fromId: string
  fromName: string
  toId: string
  toName: string
  items: TradeItem[]
  gold: number
  completedAt: number
}

const STORAGE_KEY = 'nz_trade_v1'
const TRADE_DURATION = 24 * 60 * 60 * 1000 // 24小时

export const useTradeStore = defineStore('trade', () => {
  const outgoingRequests = ref<TradeRequest[]>([])  // 我发起的
  const incomingRequests = ref<TradeRequest[]>([]) // 别人发给我的
  const tradeHistory = ref<TradeHistory[]>([])
  const activeTrade = ref<{ request: TradeRequest; myItems: TradeItem[]; myGold: number } | null>(null)

  // T68 加载
  function load() {
    try {
      const raw = localStorage?.getItem(STORAGE_KEY)
      if (raw) {
        const data = JSON.parse(raw)
        outgoingRequests.value = data.outgoing || []
        incomingRequests.value = data.incoming || []
        tradeHistory.value = data.history || []
        cleanupExpired()
      }
    } catch { /* silent */ }
  }

  function save() {
    try {
      localStorage?.setItem(STORAGE_KEY, JSON.stringify({
        outgoing: outgoingRequests.value,
        incoming: incomingRequests.value,
        history: tradeHistory.value,
      }))
    } catch { /* silent in test env */ }
  }

  // T68 清理过期请求
  function cleanupExpired() {
    const now = Date.now()
    outgoingRequests.value = outgoingRequests.value.filter(r => r.expiresAt > now && r.status === 'pending')
    incomingRequests.value = incomingRequests.value.filter(r => r.expiresAt > now && r.status === 'pending')
  }

  // T68 发起交易请求
  function createTradeRequest(
    myId: string,
    myName: string,
    toId: string,
    items: TradeItem[],
    gold: number
  ): TradeRequest {
    const request: TradeRequest = {
      id: generateId(),
      fromId: myId,
      fromName: myName,
      toId,
      items,
      gold,
      status: 'pending',
      createdAt: Date.now(),
      expiresAt: Date.now() + TRADE_DURATION,
    }
    outgoingRequests.value.push(request)
    // 同时添加到接收方的 incoming
    incomingRequests.value.push(request)
    save()
    return request
  }

  // T68 接受交易
  function acceptTrade(requestId: string, myItems: TradeItem[], myGold: number): boolean {
    const idx = incomingRequests.value.findIndex(r => r.id === requestId)
    if (idx < 0) return false
    const request = incomingRequests.value[idx]
    if (request.status !== 'pending') return false
    if (Date.now() > request.expiresAt) {
      request.status = 'cancelled'
      save()
      return false
    }
    request.status = 'accepted'
    activeTrade.value = { request, myItems, myGold }
    save()
    return true
  }

  // T68 拒绝交易
  function rejectTrade(requestId: string) {
    const idx = incomingRequests.value.findIndex(r => r.id === requestId)
    if (idx >= 0) {
      incomingRequests.value[idx].status = 'rejected'
      save()
    }
  }

  // T68 取消交易
  function cancelTrade(requestId: string) {
    let idx = outgoingRequests.value.findIndex(r => r.id === requestId)
    if (idx >= 0) {
      outgoingRequests.value[idx].status = 'cancelled'
      save()
      return
    }
    idx = incomingRequests.value.findIndex(r => r.id === requestId)
    if (idx >= 0) {
      incomingRequests.value[idx].status = 'cancelled'
      save()
    }
  }

  // T68 完成交易（双方确认后）
  function completeTrade(requestId: string): TradeHistory | null {
    if (!activeTrade.value || activeTrade.value.request.id !== requestId) return null
    const { request, myItems, myGold } = activeTrade.value
    const history: TradeHistory = {
      id: generateId(),
      fromId: request.fromId,
      fromName: request.fromName,
      toId: request.toId,
      toName: 'player',
      items: [...request.items, ...myItems],
      gold: request.gold + myGold,
      completedAt: Date.now(),
    }
    tradeHistory.value.unshift(history)
    request.status = 'completed'
    activeTrade.value = null
    save()
    return history
  }

  // T68 获取发给某玩家的请求
  function getIncomingForPlayer(toId: string): TradeRequest[] {
    return incomingRequests.value.filter(r => r.toId === toId && r.status === 'pending')
  }

  const pendingIncomingCount = computed(() =>
    incomingRequests.value.filter(r => r.status === 'pending' && r.expiresAt > Date.now()).length
  )

  return {
    outgoingRequests,
    incomingRequests,
    tradeHistory,
    activeTrade,
    pendingIncomingCount,
    load,
    createTradeRequest,
    acceptTrade,
    rejectTrade,
    cancelTrade,
    completeTrade,
    getIncomingForPlayer,
    cleanupExpired,
  }
})
