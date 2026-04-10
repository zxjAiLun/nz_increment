export interface Theme {
  id: string
  name: string
  price: number | 'free'  // 钻石价格，free为免费
  unlockCondition?: string
  colors: {
    primary: string
    secondary: string
    accent: string
    background: string
    surface: string
    text: string
    crit: string      // 暴击色
    heal: string      // 治疗色
    gold: string      // 金币色
    diamond: string   // 钻石色
  }
  particleEffect?: string  // 粒子特效类型
}

export const THEMES: Theme[] = [
  {
    id: 'default',
    name: '默认主题',
    price: 'free',
    colors: {
      primary: '#4a9eff',
      secondary: '#7c3aed',
      accent: '#ffd700',
      background: '#1a1a2e',
      surface: '#16213e',
      text: '#e0e0e0',
      crit: '#ffd700',
      heal: '#44ff44',
      gold: '#ffd700',
      diamond: '#60a5fa'
    }
  },
  {
    id: 'flame',
    name: '火焰地狱',
    price: 68,
    colors: {
      primary: '#ff4500',
      secondary: '#ff6b35',
      accent: '#ffd700',
      background: '#1a0a0a',
      surface: '#2d1515',
      text: '#ffe0e0',
      crit: '#ff0000',
      heal: '#ff6347',
      gold: '#ffa500',
      diamond: '#ff4500'
    },
    particleEffect: 'flame'
  },
  {
    id: 'ice',
    name: '寒冰北境',
    price: 68,
    colors: {
      primary: '#00bfff',
      secondary: '#87ceeb',
      accent: '#e0ffff',
      background: '#0a1a2e',
      surface: '#152535',
      text: '#e0f4ff',
      crit: '#00ffff',
      heal: '#7fffd4',
      gold: '#afeeee',
      diamond: '#00bfff'
    },
    particleEffect: 'ice'
  },
  {
    id: 'shadow',
    name: '暗影刺客',
    price: 128,
    colors: {
      primary: '#9b59b6',
      secondary: '#8e44ad',
      accent: '#e74c3c',
      background: '#0d0d0d',
      surface: '#1a1a1a',
      text: '#c0c0c0',
      crit: '#ff1744',
      heal: '#76ff03',
      gold: '#ffc400',
      diamond: '#d500f9'
    },
    particleEffect: 'shadow'
  },
  {
    id: 'divine',
    name: '神圣光辉',
    price: 128,
    colors: {
      primary: '#ffd700',
      secondary: '#ffec8b',
      accent: '#fffacd',
      background: '#1a1500',
      surface: '#2d2a00',
      text: '#fffacd',
      crit: '#fff700',
      heal: '#adff2f',
      gold: '#ffd700',
      diamond: '#ffbf00'
    },
    particleEffect: 'sparkle'
  }
]
