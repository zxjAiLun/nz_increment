export interface GuideStep {
  id: string
  targetSelector: string  // CSS selector for target element
  title: string
  description: string
  position: 'top' | 'bottom' | 'left' | 'right'
  action?: 'click' | 'wait' | 'highlight'
  completed: boolean
}

export const NOVICE_GUIDE: GuideStep[] = [
  { id: 'welcome', targetSelector: 'body', title: '欢迎来到游戏', description: '这是一个回合制战斗RPG游戏，完成任务获取奖励变强！', position: 'bottom', action: 'wait', completed: false },
  { id: 'start_battle', targetSelector: '[data-tab="battle"]', title: '开始战斗', description: '点击这里开始你的第一场战斗', position: 'bottom', action: 'click', completed: false },
  { id: 'view_inventory', targetSelector: '[data-tab="inventory"]', title: '查看背包', description: '查看你获得的装备和道具', position: 'bottom', action: 'click', completed: false },
  { id: 'sign_in', targetSelector: '[data-tab="signin"]', title: '每日签到', description: '每天签到可以获得奖励', position: 'bottom', action: 'click', completed: false },
  { id: 'check_achievement', targetSelector: '[data-tab="achievement"]', title: '查看成就', description: '完成成就解锁丰厚奖励', position: 'bottom', action: 'click', completed: false },
]
