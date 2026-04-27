<script setup lang="ts">
defineProps<{
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  type?: 'danger' | 'warning' | 'info'
}>()

const emit = defineEmits<{
  (e: 'confirm'): void
  (e: 'cancel'): void
}>()
</script>

<template>
  <div class="confirm-overlay" @click.self="emit('cancel')">
    <div class="confirm-dialog" :class="type || 'info'">
      <div class="confirm-header">
        <h3>{{ title }}</h3>
        <button class="close-btn" @click="emit('cancel')">&times;</button>
      </div>
      <div class="confirm-body">
        <p>{{ message }}</p>
      </div>
      <div class="confirm-actions">
        <button class="cancel-btn" @click="emit('cancel')">
          {{ cancelText || '取消' }}
        </button>
        <button class="confirm-btn" @click="emit('confirm')">
          {{ confirmText || '确认' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.confirm-overlay {
  position: fixed;
  inset: 0;
  background: rgba(2, 7, 17, 0.72);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 2000;
  animation: fade-in 0.2s ease;
  padding: 1rem;
  backdrop-filter: blur(8px);
}

.confirm-dialog {
  background: var(--gradient-panel);
  border-radius: var(--border-radius-lg);
  border: 1px solid var(--color-border);
  padding: 1rem;
  max-width: 400px;
  width: min(100%, 400px);
  box-shadow: var(--shadow-xl);
  animation: scale-in 0.2s ease;
}

.confirm-dialog.danger {
  border-color: rgba(255, 91, 110, 0.52);
}

.confirm-dialog.warning {
  border-color: rgba(246, 173, 85, 0.52);
}

.confirm-dialog.info {
  border-color: rgba(143, 122, 255, 0.45);
}

.confirm-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
}

.confirm-header h3 {
  color: var(--color-text-primary);
  margin: 0;
  font-size: 1.1rem;
}

.confirm-dialog.danger .confirm-header h3 {
  color: var(--color-danger);
}

.confirm-dialog.warning .confirm-header h3 {
  color: var(--color-warning);
}

.close-btn {
  background: none;
  border: none;
  color: var(--color-text-muted);
  font-size: 1.5rem;
  cursor: pointer;
  padding: 0;
  line-height: 1;
}

.close-btn:hover {
  color: var(--color-text-primary);
}

.confirm-body {
  margin-bottom: 1.5rem;
}

.confirm-body p {
  color: var(--color-text-secondary);
  margin: 0;
  line-height: 1.5;
  white-space: pre-line;
}

.confirm-actions {
  display: flex;
  gap: 1rem;
  justify-content: flex-end;
}

.cancel-btn,
.confirm-btn {
  padding: 0.6rem 1.2rem;
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius-md);
  cursor: pointer;
  font-size: 0.9rem;
  transition: all var(--transition-fast);
}

.cancel-btn {
  background: rgba(255, 255, 255, 0.045);
  color: var(--color-text-secondary);
}

.cancel-btn:hover {
  background: var(--color-bg-dark);
  color: var(--color-text-primary);
}

.confirm-btn {
  border-color: rgba(69, 230, 208, 0.34);
  background: rgba(69, 230, 208, 0.16);
  color: var(--color-text-primary);
  font-weight: 800;
}

.confirm-btn:hover {
  opacity: 0.9;
  transform: translateY(-1px);
}

.confirm-dialog.danger .confirm-btn {
  border-color: rgba(255, 91, 110, 0.42);
  background: rgba(255, 91, 110, 0.16);
}

.confirm-dialog.warning .confirm-btn {
  border-color: rgba(246, 173, 85, 0.42);
  background: rgba(246, 173, 85, 0.16);
}

@media (max-width: 560px) {
  .confirm-overlay {
    align-items: flex-end;
    padding: 0;
  }

  .confirm-dialog {
    width: 100%;
    max-width: none;
    border-radius: var(--border-radius-lg) var(--border-radius-lg) 0 0;
    padding-bottom: calc(1rem + env(safe-area-inset-bottom));
  }

  .confirm-actions {
    flex-direction: column-reverse;
    gap: 0.55rem;
  }

  .cancel-btn,
  .confirm-btn {
    width: 100%;
  }
}

@keyframes fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes scale-in {
  from {
    opacity: 0;
    transform: scale(0.9);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}
</style>
