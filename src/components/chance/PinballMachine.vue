<script setup lang="ts">
import PinballPanel from '../PinballPanel.vue'

defineProps<{
  poolId: string
}>()
</script>

<template>
  <PinballPanel :pool-id="poolId" />
</template>
