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
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.8);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 2000;
  animation: fade-in 0.2s ease;
}

.confirm-dialog {
  background: var(--color-bg-panel);
  border-radius: var(--border-radius-lg);
  padding: 1.5rem;
  max-width: 400px;
  width: 90%;
  box-shadow: var(--shadow-xl);
  animation: scale-in 0.2s ease;
}

.confirm-dialog.danger {
  border: 2px solid var(--color-danger);
}

.confirm-dialog.warning {
  border: 2px solid var(--color-warning);
}

.confirm-dialog.info {
  border: 2px solid var(--color-accent);
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
}

.confirm-actions {
  display: flex;
  gap: 1rem;
  justify-content: flex-end;
}

.cancel-btn,
.confirm-btn {
  padding: 0.6rem 1.2rem;
  border: none;
  border-radius: var(--border-radius-md);
  cursor: pointer;
  font-size: 0.9rem;
  transition: all var(--transition-fast);
}

.cancel-btn {
  background: var(--color-bg-card);
  color: var(--color-text-secondary);
}

.cancel-btn:hover {
  background: var(--color-bg-dark);
  color: var(--color-text-primary);
}

.confirm-btn {
  background: var(--gradient-primary);
  color: white;
}

.confirm-btn:hover {
  opacity: 0.9;
  transform: translateY(-1px);
}

.confirm-dialog.danger .confirm-btn {
  background: linear-gradient(135deg, var(--color-danger), #ff6b6b);
}

.confirm-dialog.warning .confirm-btn {
  background: linear-gradient(135deg, var(--color-warning), #ffb366);
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
