import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Locale } from '../i18n'
import { t } from '../i18n'

export const useI18nStore = defineStore('i18n', () => {
  const currentLocale = ref<Locale>('zh')

  function setLocale(locale: Locale) {
    currentLocale.value = locale
    localStorage.setItem('nz_locale', locale)
  }

  function loadLocale() {
    const saved = localStorage.getItem('nz_locale') as Locale | null
    if (saved && (saved === 'zh' || saved === 'en')) {
      currentLocale.value = saved
    }
  }

  loadLocale()

  function translate(key: string): string {
    return t(key, currentLocale.value)
  }

  return { currentLocale, setLocale, t: translate }
})
