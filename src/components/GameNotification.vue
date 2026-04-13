<script setup lang="ts">
import { ref, onMounted } from 'vue'

export interface Notification {
  id: number
  message: string
  type: 'info' | 'success' | 'warning' | 'error' | 'achievement'
  duration: number
}

const props = defineProps<{
  notifications: Notification[]
}>()

const emit = defineEmits<{
  (e: 'dismiss', id: number): void
}>()

function getIcon(type: string): string {
  switch (type) {
    case 'success': return '✓'
    case 'warning': return '⚠'
    case 'error': return '✗'
    case 'achievement': return '🏆'
    default: return 'ℹ'
  }
}
</script>

<template>
  <div class="notification-container">
    <TransitionGroup name="notif">
      <div
        v-for="notif in notifications"
        :key="notif.id"
        :class="['notification', `notif-${notif.type}`]"
        @click="emit('dismiss', notif.id)"
      >
        <span class="notif-icon">{{ getIcon(notif.type) }}</span>
        <span class="notif-message">{{ notif.message }}</span>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.notification-container {
  position: fixed;
  top: 60px;
  right: 16px;
  z-index: 9999;
  display: flex;
  flex-direction: column;
  gap: 8px;
  pointer-events: none;
}

.notification {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  border-radius: 8px;
  font-size: 14px;
  min-width: 200px;
  max-width: 320px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  pointer-events: auto;
  cursor: pointer;
}

.notif-info { background: #2a2a4a; color: #fff; border-left: 3px solid #4a9eff; }
.notif-success { background: #1a3a2a; color: #4ade80; border-left: 3px solid #4ade80; }
.notif-warning { background: #3a3a1a; color: #fbbf24; border-left: 3px solid #fbbf24; }
.notif-error { background: #3a1a1a; color: #f87171; border-left: 3px solid #f87171; }
.notif-achievement { background: linear-gradient(135deg, #2a2a1a 0%, #3a2a0a 100%); color: #fbbf24; border-left: 3px solid #f59e0b; }

.notif-icon { font-size: 16px; flex-shrink: 0; }

.notif-enter-active { transition: all 0.3s ease-out; }
.notif-leave-active { transition: all 0.3s ease-in; }
.notif-enter-from { opacity: 0; transform: translateX(100px); }
.notif-leave-to { opacity: 0; transform: translateX(100px); }
</style>
