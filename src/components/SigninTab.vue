<script setup lang="ts">
import { useSigninStore } from '../stores/signinStore'
import { SIGNIN_REWARDS } from '../data/signin'

const signin = useSigninStore()
const emit = defineEmits<{ claimed: [reward: any]; fault: [error: unknown] }>()
// Phase 3.60 Repair 2：App runtime-ready 的单向下传开关；缺省视为启用（独立使用/旧调用兼容）。
const props = withDefaults(defineProps<{ interactionEnabled?: boolean }>(), {
  interactionEnabled: true
})

function doSignin() {
  // 交互闸门：非 ready（initializing/blocked/faulted）时在 Store 调用前 fail-closed。
  if (!props.interactionEnabled) return
  try {
    const result = signin.signin()
    // Phase 3.60：仅在 ok:true（奖励与持久化全部成功）时 emit；失败零 success emit。
    if (result.ok) emit('claimed', result.reward)
  } catch (error) {
    // Phase 3.60 Repair 1：补偿失败属严重持久化故障，上送 App fail-stop，不吞掉。
    emit('fault', error)
  }
}

function getDayReward(day: number) {
  const r = SIGNIN_REWARDS[day - 1]
  if (r.type === 'gold') return `${r.amount} 金币`
  if (r.type === 'diamond') return `${r.amount} 钻石`
  return `${r.amount} 材料`
}
</script>

<template>
  <div class="signin-tab">
    <h2>每日签到</h2>
    <p>连续签到: {{ signin.consecutiveDays }} 天</p>

    <div class="signin-grid">
      <div v-for="day in 7" :key="day" class="day-cell"
           :class="{
             'signed': day <= (signin.consecutiveDays % 7 || 7),
             'today': day === (signin.consecutiveDays % 7 || 7) && !signin.todaySigned,
             'current': day === (signin.consecutiveDays % 7 || 7)
           }">
        <span class="day-num">第{{ day }}天</span>
        <span class="reward">{{ getDayReward(day) }}</span>
      </div>
    </div>

    <button v-if="signin.canSignin()" @click="doSignin()" class="signin-btn" :disabled="!interactionEnabled">
      立即签到
    </button>
    <button v-else class="signed-btn" disabled>
      今日已签到
    </button>
  </div>
</template>

<style scoped>
.signin-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 8px;
  margin: 20px 0;
}
.day-cell {
  padding: 12px 8px;
  background: var(--color-bg-panel);
  border-radius: 8px;
  text-align: center;
  opacity: 0.5;
}
.day-cell.signed { opacity: 1; background: var(--color-primary); color: white; }
.day-cell.current { border: 2px solid var(--color-primary); opacity: 1; }
.signin-btn {
  width: 100%;
  padding: 16px;
  background: var(--color-primary);
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 18px;
}
.signed-btn {
  width: 100%;
  padding: 16px;
  background: var(--color-bg-panel);
  color: var(--color-text-secondary);
  border: none;
  border-radius: 8px;
  font-size: 18px;
}
</style>
