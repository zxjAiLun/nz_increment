<script setup lang="ts">
import { ref } from 'vue'
import { useFriendStore } from '../stores/friendStore'

const friend = useFriendStore()
const activeTab = ref<'friends' | 'blacklist'>('friends')

function getStatusColor(status: string) {
  return status === 'online' ? '#4ade80' : '#666'
}
</script>

<template>
  <div class="friend-tab">
    <div class="tabs">
      <button :class="{ active: activeTab === 'friends' }" @click="activeTab = 'friends'">
        好友 ({{ friend.friends.length }})
      </button>
      <button :class="{ active: activeTab === 'blacklist' }" @click="activeTab = 'blacklist'">
        黑名单 ({{ friend.blacklist.length }})
      </button>
    </div>

    <div v-if="activeTab === 'friends'" class="friend-list">
      <div v-for="f in friend.friends" :key="f.id" class="friend-item">
        <div class="avatar" :style="{ borderColor: getStatusColor(f.status) }">
          {{ f.name.charAt(0) }}
        </div>
        <div class="info">
          <span class="name">{{ f.name }}</span>
          <span class="level">Lv.{{ f.level }}</span>
        </div>
        <div class="status" :style="{ color: getStatusColor(f.status) }">
          {{ f.status === 'online' ? '在线' : '离线' }}
        </div>
        <div class="actions">
          <button @click="friend.removeFriend(f.id)">删除</button>
          <button @click="friend.blockPlayer(f.id, f.name)">拉黑</button>
        </div>
      </div>
      <div v-if="friend.friends.length === 0" class="empty">暂无好友</div>
    </div>

    <div v-else class="blacklist">
      <div v-for="b in friend.blacklist" :key="b.id" class="blacklist-item">
        <span>{{ b.name }}</span>
        <button @click="friend.unblockPlayer(b.id)">解除</button>
      </div>
      <div v-if="friend.blacklist.length === 0" class="empty">黑名单为空</div>
    </div>
  </div>
</template>

<style scoped>
.tabs { display: flex; gap: 8px; margin-bottom: 16px; }
.tabs button { flex: 1; padding: 10px; border: none; background: var(--color-bg-panel); border-radius: 8px; cursor: pointer; }
.tabs button.active { background: var(--color-primary); color: white; }
.friend-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  background: var(--color-bg-panel);
  border-radius: 8px;
  margin-bottom: 8px;
}
.avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: var(--color-primary);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px solid;
}
.info { flex: 1; }
.name { font-weight: bold; display: block; }
.level { font-size: 12px; color: var(--color-text-secondary); }
.status { font-size: 12px; min-width: 40px; }
.actions { display: flex; gap: 4px; }
.actions button { padding: 4px 8px; font-size: 12px; border: none; border-radius: 4px; cursor: pointer; }
.actions button:first-child { background: #ef4444; color: white; }
.actions button:last-child { background: #6b7280; color: white; }
.blacklist-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px;
  background: var(--color-bg-panel);
  border-radius: 8px;
  margin-bottom: 8px;
}
.blacklist-item button { padding: 4px 12px; background: var(--color-primary); color: white; border: none; border-radius: 4px; }
.empty { text-align: center; padding: 40px; color: var(--color-text-secondary); }
</style>
