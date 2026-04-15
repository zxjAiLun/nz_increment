<script setup lang="ts">
import { useGuildWarStore } from '../stores/guildWarStore'

const gw = useGuildWarStore()
</script>

<template>
  <div class="guild-war-tab">
    <h2>公会战</h2>

    <div v-if="!gw.currentWar" class="signup-section">
      <div v-if="gw.signupOpen" class="signup-open">
        <p>公会战报名进行中</p>
        <button @click="gw.signup()">报名参战</button>
      </div>
      <div v-else>
        <p>匹配中...</p>
        <button @click="gw.startWar('enemy_guild')">开始对战</button>
      </div>
    </div>

    <div v-else class="war-active">
      <div class="war-header">
        <span class="guild-name">我方: {{ gw.currentWar.score.guild }}</span>
        <span class="vs">VS</span>
        <span class="enemy-name">敌方: {{ gw.currentWar.score.opponent }}</span>
      </div>
      <div class="war-status">
        状态: {{ gw.currentWar.status }}
      </div>
      <button @click="gw.addScore('guild', 100)">我方得分+100</button>
      <button @click="gw.endWar()">结束战斗</button>
    </div>

    <div class="rewards-section">
      <h3>赛季奖励</h3>
      <div v-for="r in gw.rewards" :key="r.rank" class="reward-item">
        第{{ r.rank }}名: 💎{{ r.reward.diamond }} 🪙{{ r.reward.gold }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.guild-war-tab { padding: 16px; }
.signup-section { text-align: center; padding: 40px; }
.signup-section button {
  padding: 14px 32px;
  background: var(--color-primary);
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 18px;
  margin-top: 16px;
}
.war-header {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 24px;
  padding: 24px;
  background: var(--color-bg-panel);
  border-radius: 12px;
  margin-bottom: 16px;
}
.vs { font-size: 24px; font-weight: bold; color: #ef4444; }
.guild-name, .enemy-name { font-size: 20px; }
button {
  padding: 10px 24px;
  background: var(--color-primary);
  color: white;
  border: none;
  border-radius: 6px;
  margin-right: 8px;
}
.reward-item {
  padding: 10px;
  background: var(--color-bg-panel);
  border-radius: 8px;
  margin-bottom: 6px;
}
</style>
