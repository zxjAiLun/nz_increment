export interface Theme {
  id: string
  name: string
  price: number | 'free'  // 钻石价格，free为免费
  unlockCondition?: string
  colors: {
    primary: string
    primaryLight?: string
    primaryDark?: string
    secondary: string
    secondaryLight?: string
    secondaryDark?: string
    accent: string
    accentLight?: string
    accentDark?: string
    background: string
    surface: string
    text: string
    crit: string      // 暴击色
    heal: string      // 治疗色
    gold: string      // 金币色
    diamond: string   // 钻石色
    info?: string
    success?: string
    warning?: string
    danger?: string
    textPrimary?: string
    textSecondary?: string
    textMuted?: string
    textDisabled?: string
    bgPanel?: string
    bgCard?: string
    bgInput?: string
    bgDark?: string
    rarityCommon?: string
    rarityFine?: string
    rarityGood?: string
    rarityEpic?: string
    rarityLegend?: string
    rarityMyth?: string
    rarityEternal?: string
    rarityAncient?: string
  }
  particleEffect?: string  // 粒子特效类型
}

export const THEMES: Theme[] = [
  {
    id: 'default',
    name: '默认主题',
    price: 'free',
    colors: {
      primary: '#4a9eff', primaryLight: '#7cb8ff', primaryDark: '#2d7ad4',
      secondary: '#7c3aed', secondaryLight: '#a66be6', secondaryDark: '#5c21c4',
      accent: '#ffd700', accentLight: '#ffe566', accentDark: '#ccac00',
      background: '#1a1a2e', surface: '#16213e', text: '#e0e0e0',
      crit: '#ffd700', heal: '#44ff44', gold: '#ffd700', diamond: '#60a5fa',
      info: '#4a9eff', success: '#44ff44', warning: '#ffa500', danger: '#ff4444',
      textPrimary: '#ffffff', textSecondary: '#b0b0b0', textMuted: '#808080', textDisabled: '#555555',
      bgPanel: '#16213e', bgCard: '#1a2744', bgInput: '#0d1528', bgDark: '#0a0f1e',
      rarityCommon: '#9d9d9d', rarityFine: '#4ade80', rarityGood: '#60a5fa',
      rarityEpic: '#a855f7', rarityLegend: '#fb923c', rarityMyth: '#f472b6', rarityEternal: '#ffd700', rarityAncient: '#7c3aed'
    }
  },
  {
    id: 'flame',
    name: '火焰地狱',
    price: 68,
    colors: {
      primary: '#ff4500', primaryLight: '#ff6b35', primaryDark: '#cc3700',
      secondary: '#ff6b35', secondaryLight: '#ff8c5a', secondaryDark: '#cc5229',
      accent: '#ffd700', accentLight: '#ffe066', accentDark: '#ccac00',
      background: '#1a0a0a', surface: '#2d1515', text: '#ffe0e0',
      crit: '#ff0000', heal: '#ff6347', gold: '#ffa500', diamond: '#ff4500',
      info: '#ff6b35', success: '#ff6347', warning: '#ffa500', danger: '#ff0000',
      textPrimary: '#ffffff', textSecondary: '#ffcccc', textMuted: '#cc8888', textDisabled: '#883333',
      bgPanel: '#2d1515', bgCard: '#3d1f1f', bgInput: '#1f0a0a', bgDark: '#150505',
      rarityCommon: '#9d9d9d', rarityFine: '#4ade80', rarityGood: '#60a5fa',
      rarityEpic: '#a855f7', rarityLegend: '#fb923c', rarityMyth: '#f472b6', rarityEternal: '#ffd700', rarityAncient: '#7c3aed'
    },
    particleEffect: 'flame'
  },
  {
    id: 'ice',
    name: '寒冰北境',
    price: 68,
    colors: {
      primary: '#00bfff', primaryLight: '#5fceff', primaryDark: '#0099cc',
      secondary: '#87ceeb', secondaryLight: '#a8ddeb', secondaryDark: '#5fa8c9',
      accent: '#e0ffff', accentLight: '#ffffff', accentDark: '#a8cccc',
      background: '#0a1a2e', surface: '#152535', text: '#e0f4ff',
      crit: '#00ffff', heal: '#7fffd4', gold: '#afeeee', diamond: '#00bfff',
      info: '#00bfff', success: '#7fffd4', warning: '#afeeee', danger: '#ff6b6b',
      textPrimary: '#ffffff', textSecondary: '#c8e8f8', textMuted: '#88b8d8', textDisabled: '#446688',
      bgPanel: '#152535', bgCard: '#1a3040', bgInput: '#0d1f2e', bgDark: '#061020',
      rarityCommon: '#9d9d9d', rarityFine: '#4ade80', rarityGood: '#60a5fa',
      rarityEpic: '#a855f7', rarityLegend: '#fb923c', rarityMyth: '#f472b6', rarityEternal: '#ffd700', rarityAncient: '#7c3aed'
    },
    particleEffect: 'ice'
  },
  {
    id: 'shadow',
    name: '暗影刺客',
    price: 128,
    colors: {
      primary: '#9b59b6', primaryLight: '#b07cc8', primaryDark: '#7c3a9d',
      secondary: '#8e44ad', secondaryLight: '#a86fbf', secondaryDark: '#6b338c',
      accent: '#e74c3c', accentLight: '#f06b5d', accentDark: '#b83c2e',
      background: '#0d0d0d', surface: '#1a1a1a', text: '#c0c0c0',
      crit: '#ff1744', heal: '#76ff03', gold: '#ffc400', diamond: '#d500f9',
      info: '#9b59b6', success: '#76ff03', warning: '#ffc400', danger: '#ff1744',
      textPrimary: '#e0e0e0', textSecondary: '#909090', textMuted: '#606060', textDisabled: '#333333',
      bgPanel: '#1a1a1a', bgCard: '#242424', bgInput: '#111111', bgDark: '#080808',
      rarityCommon: '#9d9d9d', rarityFine: '#4ade80', rarityGood: '#60a5fa',
      rarityEpic: '#a855f7', rarityLegend: '#fb923c', rarityMyth: '#f472b6', rarityEternal: '#ffd700', rarityAncient: '#7c3aed'
    },
    particleEffect: 'shadow'
  },
  {
    id: 'divine',
    name: '神圣光辉',
    price: 128,
    colors: {
      primary: '#ffd700', primaryLight: '#ffe566', primaryDark: '#ccac00',
      secondary: '#ffec8b', secondaryLight: '#fff5b8', secondaryDark: '#ccbb00',
      accent: '#fffacd', accentLight: '#ffffff', accentDark: '#ccc7a0',
      background: '#1a1500', surface: '#2d2a00', text: '#fffacd',
      crit: '#fff700', heal: '#adff2f', gold: '#ffd700', diamond: '#ffbf00',
      info: '#ffd700', success: '#adff2f', warning: '#ffc400', danger: '#ff6b6b',
      textPrimary: '#ffffff', textSecondary: '#e8e0b0', textMuted: '#b0a870', textDisabled: '#665500',
      bgPanel: '#2d2a00', bgCard: '#3d3a00', bgInput: '#1f1a00', bgDark: '#121000',
      rarityCommon: '#9d9d9d', rarityFine: '#4ade80', rarityGood: '#60a5fa',
      rarityEpic: '#a855f7', rarityLegend: '#fb923c', rarityMyth: '#f472b6', rarityEternal: '#ffd700', rarityAncient: '#7c3aed'
    },
    particleEffect: 'sparkle'
  }
]
