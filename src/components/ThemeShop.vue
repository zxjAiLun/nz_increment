<script setup lang="ts">
import { useThemeStore } from '../stores/themeStore'
import { usePlayerStore } from '../stores/playerStore'
import { THEMES } from '../data/themes'

const themeStore = useThemeStore()
const playerStore = usePlayerStore()

function buyTheme(themeId: string) {
  const theme = THEMES.find(t => t.id === themeId)
  if (!theme || theme.price === 'free') return
  if (playerStore.player.diamond < (theme.price as number)) {
    alert('钻石不足')
    return
  }
  if (playerStore.spendDiamonds(theme.price as number)) {
    themeStore.unlockTheme(themeId)
  }
}
</script>

<template>
  <div class="theme-shop">
    <h2>主题商店</h2>
    <div class="theme-grid">
      <div
        v-for="theme in THEMES"
        :key="theme.id"
        class="theme-card"
        :class="{
          owned: themeStore.ownedThemes.includes(theme.id),
          active: themeStore.currentThemeId === theme.id
        }"
        @click="themeStore.ownedThemes.includes(theme.id) && themeStore.setTheme(theme.id)"
      >
        <div class="theme-preview" :style="{ background: theme.colors.background }">
          <div class="preview-bar" :style="{ background: theme.colors.primary }"></div>
          <div class="preview-bar secondary" :style="{ background: theme.colors.secondary }"></div>
          <div class="preview-accent" :style="{ background: theme.colors.accent }"></div>
        </div>
        <div class="theme-info">
          <span class="theme-name">{{ theme.name }}</span>
          <span v-if="theme.price === 'free'" class="price free">免费</span>
          <span
            v-else-if="!themeStore.ownedThemes.includes(theme.id)"
            class="price"
            @click.stop="buyTheme(theme.id)"
          >&#x1F48E; {{ theme.price }}</span>
          <span v-else class="price owned">已拥有</span>
        </div>
        <button
          v-if="themeStore.currentThemeId === theme.id"
          class="equipped"
          disabled
        >使用中</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.theme-shop {
  padding: 16px;
}
.theme-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 12px;
}
.theme-card {
  border: 2px solid transparent;
  border-radius: 8px;
  overflow: hidden;
  cursor: pointer;
  transition: transform 0.2s;
}
.theme-card.active {
  border-color: var(--color-accent, #ffd700);
}
.theme-card:hover {
  transform: scale(1.02);
}
.theme-preview {
  height: 60px;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.preview-bar {
  height: 8px;
  border-radius: 4px;
}
.preview-accent {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  margin-top: auto;
}
.theme-info {
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.theme-name {
  font-size: 13px;
  font-weight: bold;
}
.price {
  font-size: 12px;
}
.price.owned {
  color: #44ff44;
}
.price.free {
  color: #aaa;
}
.equipped {
  width: 100%;
  padding: 4px;
  background: var(--color-primary);
  color: white;
  border: none;
  font-size: 12px;
}
</style>
