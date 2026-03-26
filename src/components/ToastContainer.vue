<script setup lang="ts">
import { ref } from 'vue'

interface Toast {
  id: number
  message: string
  type: 'success' | 'error' | 'info' | 'warning'
  duration: number
}

const toasts = ref<Toast[]>([])
let toastIdCounter = 0

function showToast(message: string, type: Toast['type'] = 'info', duration: number = 3000) {
  const id = toastIdCounter++
  const toast: Toast = { id, message, type, duration }
  toasts.value.push(toast)

  setTimeout(() => {
    removeToast(id)
  }, duration)
}

function removeToast(id: number) {
  const index = toasts.value.findIndex(t => t.id === id)
  if (index !== -1) {
    toasts.value.splice(index, 1)
  }
}

function getIcon(type: Toast['type']): string {
  const icons = {
    success: '✓',
    error: '✗',
    info: 'ℹ',
    warning: '⚠'
  }
  return icons[type]
}

defineExpose({ showToast })
</script>

<template>
  <div class="toast-container">
    <TransitionGroup name="toast">
      <div
        v-for="toast in toasts"
        :key="toast.id"
        class="toast-item"
        :class="[`toast-${toast.type}`]"
      >
        <span class="toast-icon">{{ getIcon(toast.type) }}</span>
        <span class="toast-message">{{ toast.message }}</span>
        <button class="toast-close" @click="removeToast(toast.id)">×</button>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toast-container {
  position: fixed;
  top: 20px;
  right: 20px;
  z-index: 10000;
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
  max-width: 400px;
  pointer-events: none;
}

.toast-item {
  display: flex;
  align-items: center;
  gap: 0.8rem;
  padding: 1rem 1.2rem;
  background: linear-gradient(145deg, rgba(30, 30, 50, 0.95), rgba(20, 20, 35, 0.98));
  border: 2px solid rgba(255, 255, 255, 0.2);
  border-radius: 12px;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.4);
  pointer-events: auto;
  backdrop-filter: blur(10px);
}

.toast-icon {
  font-size: 1.5rem;
  font-weight: bold;
  min-width: 30px;
  text-align: center;
}

.toast-message {
  flex: 1;
  font-size: 0.95rem;
  color: white;
  line-height: 1.4;
}

.toast-close {
  background: rgba(255, 255, 255, 0.1);
  border: none;
  color: rgba(255, 255, 255, 0.6);
  font-size: 1.5rem;
  cursor: pointer;
  padding: 0 0.3rem;
  line-height: 1;
  border-radius: 50%;
  transition: all 0.2s;
  min-width: 30px;
  height: 30px;
}

.toast-close:hover {
  background: rgba(255, 255, 255, 0.2);
  color: white;
}

/* 不同类型的样式 */
.toast-success {
  border-color: rgba(68, 255, 68, 0.5);
  box-shadow: 0 10px 40px rgba(68, 255, 68, 0.2);
}

.toast-success .toast-icon {
  color: #44ff44;
}

.toast-error {
  border-color: rgba(255, 68, 68, 0.5);
  box-shadow: 0 10px 40px rgba(255, 68, 68, 0.2);
}

.toast-error .toast-icon {
  color: #ff4444;
}

.toast-info {
  border-color: rgba(102, 126, 234, 0.5);
  box-shadow: 0 10px 40px rgba(102, 126, 234, 0.2);
}

.toast-info .toast-icon {
  color: #667eea;
}

.toast-warning {
  border-color: rgba(255, 215, 0, 0.5);
  box-shadow: 0 10px 40px rgba(255, 215, 0, 0.2);
}

.toast-warning .toast-icon {
  color: #ffd700;
}

/* 动画 */
.toast-enter-active {
  animation: toast-in 0.3s ease-out;
}

.toast-leave-active {
  animation: toast-out 0.3s ease-in;
}

@keyframes toast-in {
  from {
    opacity: 0;
    transform: translateX(100px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

@keyframes toast-out {
  from {
    opacity: 1;
    transform: translateX(0);
  }
  to {
    opacity: 0;
    transform: translateX(100px);
  }
}

/* 移动端适配 */
@media (max-width: 600px) {
  .toast-container {
    top: auto;
    bottom: 20px;
    left: 20px;
    right: 20px;
    max-width: none;
  }

  .toast-item {
    width: 100%;
  }
}
</style>
