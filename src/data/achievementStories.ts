export interface AchievementStory {
  id: string
  achievementId: string
  title: string
  description: string
  storyline: string[]  // 故事文本列表
  unlocksAt: number   // 达成进度
}

export const ACHIEVEMENT_STORIES: AchievementStory[] = [
  {
    id: 'story_killer',
    achievementId: 'kill_count',
    title: '杀戮之心',
    description: '累计击杀1000怪物',
    storyline: [
      '传说在古老的战场上，有一个被称为"杀戮者"的战士...',
      '他独自面对成千上万的敌人，毫无惧色...',
      '最终，他成为了真正的战场传奇。'
    ],
    unlocksAt: 1000,
  },
  {
    id: 'story_wealthy',
    achievementId: 'gold_earned',
    title: '富甲一方',
    description: '累计获得10万金币',
    storyline: [
      '从前有一个贫穷的少年...',
      '他通过智慧和努力，逐渐积累了巨额财富...',
      '最终，他成为了大陆上最富有的人。'
    ],
    unlocksAt: 100000,
  },
  {
    id: 'story_explorer',
    achievementId: 'floor_reached',
    title: '无尽探索',
    description: '到达第100层',
    storyline: [
      '在深渊的最深处，有人在黑暗中探索了无尽的岁月...',
      '他发现了世界的终极秘密...',
      '那是一个关于生命和死亡的故事。'
    ],
    unlocksAt: 100,
  },
]
