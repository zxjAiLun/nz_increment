import { zh } from './zh'
import { en } from './en'

export type Locale = 'zh' | 'en'

export const LOCALES: { code: Locale; name: string }[] = [
  { code: 'zh', name: '简体中文' },
  { code: 'en', name: 'English' },
]

const translations: Record<Locale, Record<string, string>> = {
  zh,
  en,
}

export function t(key: string, locale: Locale = 'zh'): string {
  return translations[locale]?.[key] || translations['zh'][key] || key
}
