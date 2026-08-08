<script setup lang="ts">
import { useBattlePassStore, type BattlePassRewardItem } from '../stores/battlePassStore'
import { useSeasonTaskStore } from '../stores/seasonTaskStore'
import { usePlayerStore } from '../stores/playerStore'
import { BATTLE_PASS_REWARDS } from '../data/battlePassRewards'

const battlePass = useBattlePassStore()
const seasonTask = useSeasonTaskStore()
const playerStore = usePlayerStore()

function claim(level: number, track: 'free' | 'premium') {
  let item: BattlePassRewardItem | null = null
  if (track === 'free') {
    // Phase 3.82：free gold 走三存储补偿事务（gold + legacy BP EXP + Main + sidecar 同事务）。
    const reward = BATTLE_PASS_REWARDS.find(r => r.level === level)
    item = reward?.free?.type === 'gold'
      ? battlePass.claimFreeGoldReward(level)
      : battlePass.claimLevelReward(level, 'free')
  } else if (track === 'premium') {
    // Phase 3.81：premium diamond 走跨存储补偿事务（marker + diamond + Main + sidecar 同事务）。
    const reward = BATTLE_PASS_REWARDS.find(r => r.level === level)
    item = reward?.premium?.type === 'diamond'
      ? battlePass.claimPremiumDiamondReward(level)
      : battlePass.claimLevelReward(level, 'premium')
  }
  if (!item) return
  // gold/diamond：已由 3.82/3.81 事务统一入账（含 legacy BP EXP），此处不再发放，避免双发。
  if (item.type === 'material') playerStore.addMaterial?.(item.amount)
  if (item.type === 'gachaTicket') playerStore.addGachaTicket?.(item.amount)
  if (item.type === 'passiveShard') playerStore.addPassiveShard?.(item.amount)
  if (item.type === 'avatarFrame') playerStore.addAvatarFrame?.(item.amount)
  if (item.type === 'setPiece') playerStore.addSetPiece?.(item.amount)
}

function getRewardIcon(type: string): string {
  const icons: Record<string, string> = {
    gold: '🪙', diamond: '💎', gachaTicket: '🎫',
    material: '📦', passiveShard: '✨', setPiece: '🧩', avatarFrame: '🖼️'
  }
  return icons[type] || '📦'
}

function claimSeasonTask(taskId: string) {
  const exp = seasonTask.claimTask(taskId)
  if (exp > 0) {
    battlePass.addExp(exp)
  }
}
</script>

<template>
  <div class="battle-pass-tab">
    <div class="season-header">
      <h2>深渊战令 · 第三赛季</h2>
      <span class="days-left">剩余 {{ battlePass.seasonDaysLeft }} 天</span>
    </div>

    <div class="level-progress">
      <span>等级 {{ battlePass.currentLevel }}/50</span>
      <div class="progress-bar">
        <div class="progress-fill" :style="{ width: (battlePass.totalExp / battlePass.expToNextLevel * 100) + '%' }"></div>
      </div>
      <span>{{ battlePass.totalExp }}/{{ battlePass.expToNextLevel }} EXP</span>
    </div>

    <div class="tab-section">
      <h3>等级奖励</h3>
      <div class="rewards-grid">
        <div v-for="reward in BATTLE_PASS_REWARDS" :key="reward.level" class="reward-item">
          <span class="level-badge">L{{ reward.level }}</span>
          <div v-if="reward.free" class="free-reward">
            <span>{{ getRewardIcon(reward.free.type) }}</span>
            <span>{{ reward.free.amount }}</span>
            <button 
              v-if="battlePass.currentLevel >= reward.level && !battlePass.claimedFreeLevels.includes(reward.level)"
              @click="claim(reward.level, 'free')">领取</button>
            <span v-else-if="battlePass.claimedFreeLevels.includes(reward.level)" class="claimed">已领</span>
          </div>
          <div v-if="reward.premium" class="premium-reward">
            <span>{{ getRewardIcon(reward.premium.type) }}</span>
            <span>{{ reward.premium.amount }}</span>
            <button 
              v-if="battlePass.currentLevel >= reward.level && battlePass.isPremium && !battlePass.claimedPremiumLevels.includes(reward.level)"
              @click="claim(reward.level, 'premium')">领取</button>
            <span v-else-if="battlePass.claimedPremiumLevels.includes(reward.level)">已领</span>
            <span v-else class="locked">🔒</span>
          </div>
        </div>
      </div>
    </div>

    <div class="tab-section">
      <h3>赛季任务</h3>
      <div v-for="task in seasonTask.tasks" :key="task.id" class="season-task">
        <div class="task-info">
          <span class="task-name">{{ task.name }}</span>
          <span class="task-desc">{{ task.description }}</span>
        </div>
        <div class="task-progress">
          <span>{{ task.current }}/{{ task.target }}</span>
          <span class="exp-badge">+{{ task.expReward }}EXP</span>
          <button 
            v-if="task.completed"
            @click="claimSeasonTask(task.id)">领取</button>
        </div>
      </div>
    </div>
  </div>
</template>
