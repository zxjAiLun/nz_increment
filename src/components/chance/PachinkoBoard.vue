<script setup lang="ts">
import PachinkoPanel from '../PachinkoPanel.vue'

defineProps<{
  poolId: string
}>()
</script>

<template>
  <PachinkoPanel :pool-id="poolId" />
</template>
