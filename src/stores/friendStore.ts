import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Friend, BlacklistEntry } from '../data/friends'

// T67 好友赠送金币常量
const GIFT_COST = 1000
const GIFT_KEY = 'nz_friend_gift_v1'

interface GiftLog {
  [friendId: string]: number  // timestamp of last gift
}

export const useFriendStore = defineStore('friend', () => {
  const friends = ref<Friend[]>([])
  const blacklist = ref<BlacklistEntry[]>([])
  const pendingRequests = ref<Friend[]>([])
  const giftLog = ref<GiftLog>({})

  // T67 加载赠送记录
  function loadGiftLog() {
    try {
      const saved = localStorage?.getItem(GIFT_KEY)
      if (saved) giftLog.value = JSON.parse(saved)
    } catch { /* silent */ }
  }

  function saveGiftLog() {
    try {
      localStorage?.setItem(GIFT_KEY, JSON.stringify(giftLog.value))
    } catch { /* silent in test env */ }
  }

  // T67 今日是否可赠送
  function canSendGift(friendId: string): boolean {
    const last = giftLog.value[friendId]
    if (!last) return true
    const now = new Date()
    const lastDate = new Date(last)
    return now.toDateString() !== lastDate.toDateString()
  }

  // T67 赠送金币给好友（消耗1000金，好友获得800金）
  function sendGoldGift(friendId: string, deductGoldFn: (amount: number) => boolean): boolean {
    if (!canSendGift(friendId)) return false
    if (!friends.value.some(f => f.id === friendId)) return false
    if (!deductGoldFn(GIFT_COST)) return false
    giftLog.value[friendId] = Date.now()
    saveGiftLog()
    return true
  }

  // Mock friends
  function loadMockFriends() {
    friends.value = [
      { id: 'f1', name: '星之守护者', level: 60, status: 'online', lastActive: Date.now() },
      { id: 'f2', name: '暗夜刺客', level: 55, status: 'offline', lastActive: Date.now() - 3600000 },
      { id: 'f3', name: '永恒龙骑', level: 70, status: 'online', lastActive: Date.now() },
    ]
  }

  function addFriend(friend: Friend) {
    if (blacklist.value.some(b => b.id === friend.id)) return false
    if (friends.value.some(f => f.id === friend.id)) return false
    friends.value.push(friend)
    return true
  }

  function removeFriend(friendId: string) {
    friends.value = friends.value.filter(f => f.id !== friendId)
  }

  function blockPlayer(playerId: string, playerName: string) {
    removeFriend(playerId)
    if (!blacklist.value.some(b => b.id === playerId)) {
      blacklist.value.push({ id: playerId, name: playerName, blockedAt: Date.now() })
    }
  }

  function unblockPlayer(playerId: string) {
    blacklist.value = blacklist.value.filter(b => b.id !== playerId)
  }

  function sendFriendRequest(playerId: string) {
    pendingRequests.value.push({ id: playerId, name: `Player_${playerId}`, level: 50, status: 'offline', lastActive: Date.now() })
  }

  function acceptRequest(friendId: string) {
    const req = pendingRequests.value.find(r => r.id === friendId)
    if (req) {
      addFriend(req)
      pendingRequests.value = pendingRequests.value.filter(r => r.id !== friendId)
    }
  }

  loadMockFriends()
  loadGiftLog()
  return {
    friends, blacklist, pendingRequests, giftLog,
    canSendGift, sendGoldGift,
    addFriend, removeFriend, blockPlayer, unblockPlayer,
    sendFriendRequest, acceptRequest
  }
})

// T89 好友互动 - 赠送礼物获得好感度
export interface FriendGift {
  id: string
  type: 'gold' | 'diamond' | 'heart'
  value: number
  sentAt: number
  senderId: string
  senderName: string
}

// T89 好友亲密度等级
export function getFriendIntimacyLevel(intimacy: number): { level: number; title: string } {
  if (intimacy < 10) return { level: 1, title: '普通好友' }
  if (intimacy < 50) return { level: 2, title: '熟识好友' }
  if (intimacy < 100) return { level: 3, title: '挚友' }
  if (intimacy < 200) return { level: 4, title: '莫逆之交' }
  return { level: 5, title: '生死之交' }
}
