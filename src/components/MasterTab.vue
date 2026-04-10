<script setup lang="ts">
import { useMasterStore } from '../stores/masterStore'
import { MASTER_TASKS } from '../data/masterTasks'

const master = useMasterStore()
</script>

<template>
  <div class="master-tab">
    <div v-if="!master.masterData.role" class="role-select">
      <h2>师徒系统</h2>
      <button @click="master.becomeMaster()">成为师父</button>
      <button @click="master.becomeApprentice('mock_master')">拜师</button>
    </div>

    <div v-else-if="master.masterData.role === 'master'" class="master-view">
      <h2>我的徒弟 ({{ master.masterData.apprenticeIds.length }})</h2>
      <p>师父点数: {{ master.masterData.teachingPower }}</p>
      <div class="tasks">
        <div v-for="task in MASTER_TASKS" :key="task.id" class="task-item">
          <span>{{ task.name }}</span>
          <span>{{ master.tasks[task.id]?.progress || 0 }}/{{ task.target }}</span>
          <button
            v-if="master.tasks[task.id]?.completed && !master.masterData.rewardsClaimed.includes(task.id)"
            @click="master.claimReward(task.id)">
            领取
          </button>
        </div>
      </div>
    </div>

    <div v-else class="apprentice-view">
      <h2>我的师父</h2>
      <p>出师进度: {{ master.masterData.graduationProgress }}/3 任务</p>
      <div class="tasks">
        <div v-for="task in MASTER_TASKS" :key="task.id" class="task-item">
          <span>{{ task.name }}</span>
          <span>{{ master.tasks[task.id]?.progress || 0 }}/{{ task.target }}</span>
          <span v-if="master.tasks[task.id]?.completed" class="done">已完成</span>
        </div>
      </div>
      <button v-if="master.graduate()" @click="master.graduate()">申请出师</button>
    </div>
  </div>
</template>
