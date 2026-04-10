import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Friend, BlacklistEntry } from '../data/friends'

export const useFriendStore = defineStore('friend', () => {
  const friends = ref<Friend[]>([])
  const blacklist = ref<BlacklistEntry[]>([])
  const pendingRequests = ref<Friend[]>([])

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
    // Mock: 直接添加
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
  return { friends, blacklist, pendingRequests, addFriend, removeFriend, blockPlayer, unblockPlayer, sendFriendRequest, acceptRequest }
})
