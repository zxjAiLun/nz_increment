import { onMounted, onUnmounted } from 'vue'

export interface KeyBinding {
  key: string
  action: string
  handler: () => void
  enabled: boolean
}

export function useKeyboard(
  keyBindings: () => KeyBinding[]
) {

  function handleKeyDown(event: KeyboardEvent) {
    const target = event.target as HTMLElement
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
      return
    }

    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
    if (isMobile) {
      return
    }

    for (const binding of keyBindings()) {
      if (binding.enabled && event.code === binding.key) {
        event.preventDefault()
        binding.handler()
        break
      }
    }
  }

  onMounted(() => {
    window.addEventListener('keydown', handleKeyDown)
  })

  onUnmounted(() => {
    window.removeEventListener('keydown', handleKeyDown)
  })

  return {
    handleKeyDown
  }
}

export function createDefaultKeyBindings(
  onPauseToggle: () => void,
  onOpenSkills: () => void,
  onOpenRole: () => void,
  onOpenShop: () => void,
  onEscape: () => void
): KeyBinding[] {
  return [
    {
      key: 'Space',
      action: '暂停/继续战斗',
      handler: onPauseToggle,
      enabled: true
    },
    {
      key: 'KeyS',
      action: '打开技能面板',
      handler: onOpenSkills,
      enabled: true
    },
    {
      key: 'KeyE',
      action: '打开装备面板',
      handler: onOpenRole,
      enabled: true
    },
    {
      key: 'KeyR',
      action: '打开角色属性',
      handler: onOpenRole,
      enabled: true
    },
    {
      key: 'KeyB',
      action: '打开商店',
      handler: onOpenShop,
      enabled: true
    },
    {
      key: 'Escape',
      action: '关闭当前面板',
      handler: onEscape,
      enabled: true
    }
  ]
}
