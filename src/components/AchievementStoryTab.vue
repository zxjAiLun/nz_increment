<script setup lang="ts">
import { ref } from 'vue'
import { ACHIEVEMENT_STORIES } from '../data/achievementStories'
import type { AchievementStory } from '../data/achievementStories'
import { useAchievementStoryStore } from '../stores/achievementStoryStore'

const storyStore = useAchievementStoryStore()
const selectedStory = ref<AchievementStory | null>(null)

function openStory(story: AchievementStory) {
  selectedStory.value = story
}
</script>

<template>
  <div class="story-tab">
    <h2>成就故事</h2>
    <p class="hint">探索成就背后的故事</p>

    <div class="story-grid">
      <div v-for="story in ACHIEVEMENT_STORIES" :key="story.id"
           class="story-card" :class="{ unlocked: storyStore.isUnlocked(story.id) }"
           @click="openStory(story)">
        <div class="story-title">{{ story.title }}</div>
        <div class="story-desc">{{ story.description }}</div>
        <div class="story-status">
          <span v-if="storyStore.isUnlocked(story.id)" class="unlocked">已解锁</span>
          <span v-else class="locked">未解锁</span>
        </div>
      </div>
    </div>

    <div v-if="selectedStory" class="story-modal">
      <div class="modal-content">
        <h3>{{ selectedStory.title }}</h3>
        <div class="story-body">
          <p v-for="(para, i) in selectedStory.storyline" :key="i" class="story-para">
            {{ para }}
          </p>
        </div>
        <button @click="selectedStory = null">关闭</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.story-tab { padding: 16px; }
.story-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; margin-top: 16px; }
.story-card {
  padding: 16px;
  background: var(--color-bg-panel);
  border-radius: 12px;
  cursor: pointer;
  border: 2px solid transparent;
  transition: all 0.2s;
}
.story-card.unlocked { border-color: #f59e0b; }
.story-card:not(.unlocked) { opacity: 0.5; }
.story-card:hover { transform: translateY(-2px); }
.story-title { font-weight: bold; margin-bottom: 4px; }
.story-desc { font-size: 12px; color: var(--color-text-secondary); margin-bottom: 8px; }
.story-status { font-size: 12px; }
.unlocked { color: #f59e0b; }
.locked { color: #666; }
.story-modal {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.8);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.modal-content {
  background: var(--color-surface);
  border-radius: 16px;
  padding: 32px;
  max-width: 400px;
  max-height: 80vh;
  overflow-y: auto;
  text-align: center;
}
.story-para { font-size: 14px; line-height: 1.6; color: var(--color-text-secondary); margin-bottom: 16px; text-align: left; }
button { width: 100%; padding: 12px; background: var(--color-primary); color: white; border: none; border-radius: 8px; margin-top: 16px; cursor: pointer; }
.hint { font-size: 12px; color: var(--color-text-secondary); margin-bottom: 0; }
h2 { margin: 0 0 4px 0; font-size: 18px; }
h3 { margin: 0 0 16px 0; font-size: 16px; }
</style>
