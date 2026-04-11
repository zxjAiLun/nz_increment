<script setup lang="ts">
import { ref } from 'vue'
import { useInheritanceStore } from '../stores/inheritanceStore'

const inh = useInheritanceStore()
const sourceEquipId = ref('')
const targetEquipId = ref('')

function doInherit() {
  // Mock: in real app, would lookup actual equipment
  const mockResult = inh.canInherit({ level: 10, isLocked: false }, { level: 5, isLocked: false }, 1000)
  if (mockResult.can) {
    alert('传承成功!')
  } else {
    alert('传承失败: ' + mockResult.reason)
  }
}
</script>

<template>
  <div class="inheritance-tab">
    <h2>装备传承</h2>
    <p class="hint">将高等级装备的经验传承给低等级装备，手续费10%</p>

    <div class="cost-info">
      传承手续费: {{ (inh.inheritanceFeeRate * 100) }}%
    </div>

    <div class="inheritance-form">
      <div class="equip-slot">
        <label>源装备（等级将被重置为1）</label>
        <input v-model="sourceEquipId" placeholder="装备ID" />
      </div>
      <div class="equip-slot">
        <label>目标装备（接收经验）</label>
        <input v-model="targetEquipId" placeholder="装备ID" />
      </div>
      <button @click="doInherit">执行传承</button>
    </div>

    <div class="records">
      <h3>传承记录</h3>
      <div v-for="r in inh.getRecords()" :key="r.timestamp" class="record-item">
        {{ r.sourceEquipId }} -> {{ r.targetEquipId }}: +{{ r.levelTransferred }}级, 花费{{ r.goldCost }}金币
      </div>
      <div v-if="inh.records.length === 0" class="empty">暂无记录</div>
    </div>
  </div>
</template>

<style scoped>
.inheritance-tab { padding: 16px; }
.hint { font-size: 12px; color: var(--color-text-secondary); margin-bottom: 16px; }
.cost-info { padding: 12px; background: var(--color-bg-panel); border-radius: 8px; margin-bottom: 16px; font-weight: bold; }
.inheritance-form { display: flex; flex-direction: column; gap: 12px; margin-bottom: 24px; }
.equip-slot { display: flex; flex-direction: column; gap: 4px; }
label { font-size: 14px; font-weight: bold; }
input { padding: 10px; border: 1px solid var(--color-border); border-radius: 6px; background: var(--color-bg-panel); color: var(--color-text); }
button { padding: 12px; background: var(--color-primary); color: white; border: none; border-radius: 8px; font-size: 16px; cursor: pointer; }
.record-item { padding: 10px; background: var(--color-bg-panel); border-radius: 8px; margin-bottom: 8px; font-size: 13px; }
.empty { text-align: center; padding: 20px; color: var(--color-text-secondary); }
</style>
