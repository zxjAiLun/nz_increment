<script setup lang="ts">
import { useGuildStore } from '../stores/guildStore'
import { usePlayerStore } from '../stores/playerStore'
import { GUILD_DUNGEONS } from '../data/guildDungeons'
import { GUILD_SHOP } from '../data/guildShop'

const guild = useGuildStore()
const player = usePlayerStore()

const mockGuilds = guild.getMockGuilds()

function donate(amount: number) {
  if (guild.donateFunds(amount)) {
    alert(`捐献 ${amount} 金币成功！`)
  }
}
</script>

<template>
  <div class="guild-tab">
    <div v-if="!guild.currentGuild" class="no-guild">
      <h2>加入公会</h2>
      <button @click="guild.createGuild('我的公会')">创建公会（消耗1000金币）</button>
      <div class="guild-list">
        <div v-for="g in mockGuilds" :key="g.id" class="guild-item">
          <span>{{ g.name }}</span>
          <span>Lv.{{ g.level }}</span>
          <button @click="guild.joinGuild(g.id)">申请</button>
        </div>
      </div>
    </div>

    <div v-else class="guild-home">
      <div class="guild-header">
        <h2>{{ guild.currentGuild.name }}</h2>
        <span>Lv.{{ guild.currentGuild.level }}</span>
        <span>金币: {{ guild.currentGuild.funds }}</span>
      </div>

      <div class="donate-section">
        <h3>捐献金币</h3>
        <button @click="donate(100)">捐献100</button>
        <button @click="donate(1000)">捐献1000</button>
      </div>

      <div class="dungeon-section">
        <h3>公会副本</h3>
        <div v-for="d in GUILD_DUNGEONS" :key="d.id" class="dungeon-item">
          <span>{{ d.name }}</span>
          <span>奖励: {{ d.rewards.gold }}金币</span>
          <button
            v-if="guild.guildDungeon?.id !== d.id"
            @click="guild.startDungeon(d.id)">
            挑战
          </button>
          <span v-else-if="guild.guildDungeon.status === 'in_progress'">进行中</span>
        </div>
      </div>

      <div class="shop-section">
        <h3>公会商店</h3>
        <div v-for="item in GUILD_SHOP" :key="item.id" class="shop-item">
          <span>{{ item.name }}</span>
          <span>{{ item.price }} 贡献</span>
          <button>购买</button>
        </div>
      </div>
    </div>
  </div>
</template>
