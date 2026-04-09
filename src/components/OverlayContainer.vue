<script setup lang="ts">
import type { DamagePopupData } from './DamagePopup.vue'

defineProps<{
  damagePopups: DamagePopupData[]
  showEquipConfirm: boolean
  equipConfirmNewScore: number
  equipConfirmOldScore: number
  showResetConfirm: boolean
}>()

const emit = defineEmits<{
  removePopup: [id: number]
  confirmEquip: []
  cancelEquip: []
  confirmReset: []
  cancelReset: []
}>()
</script>

<template>
  <div class="overlay-container">
    <!-- 伤害飘字 -->
    <DamagePopup
      v-for="popup in damagePopups"
      :key="popup.id"
      :popup="popup"
      @remove="emit('removePopup', popup.id)"
    />

    <!-- 装备确认对话框 -->
    <ConfirmDialog
      v-if="showEquipConfirm"
      title="替换装备"
      :message="`新装备战力: ${equipConfirmNewScore}\n当前装备战力: ${equipConfirmOldScore}\n是否确认替换？`"
      confirm-text="确认替换"
      @confirm="emit('confirmEquip')"
      @cancel="emit('cancelEquip')"
    />

    <!-- 重置确认对话框 -->
    <ConfirmDialog
      v-if="showResetConfirm"
      title="重置游戏"
      message="确定要重置游戏吗？所有进度将丢失！"
      type="danger"
      confirm-text="确认重置"
      @confirm="emit('confirmReset')"
      @cancel="emit('cancelReset')"
    />
  </div>
</template>

<style scoped>
.overlay-container {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  pointer-events: none;
  z-index: 100;
}

.overlay-container > :deep(*) {
  pointer-events: auto;
}
</style>
