import english from '../locales/en.json'

export type Language = 'fr' | 'en'
const normalize = (value: string): Language => value.toLowerCase().startsWith('fr') ? 'fr' : 'en'
let language: Language = normalize(navigator.language)
const native = (window as unknown as { cymdNative?: {
  getLanguage(): Promise<Language>
  setLanguage(value: Language): Promise<void>
  onLanguage(cb: (value: Language) => void): void
} }).cymdNative

export function getLanguage() { return language }
export function tr(text: string, ...values: unknown[]): string {
  const translated = language === 'en' && Object.hasOwn(english, text) ? (english as Record<string, string>)[text] : text
  return translated.replace(/\{(\d+)\}/g, (match, index) => index < values.length ? String(values[index]) : match)
}

function apply(value: Language) {
  language = value
  document.documentElement.lang = value
  window.dispatchEvent(new Event('cymd-language'))
}

export async function initLanguage() {
  if (native) {
    native.onLanguage(apply)
    apply(await native.getLanguage())
  } else {
    try { language = normalize(localStorage.getItem('cymd.language') || navigator.language) } catch { /* storage unavailable */ }
    apply(language)
    window.addEventListener('storage', (event) => {
      if (event.key === 'cymd.language') apply(normalize(event.newValue || navigator.language))
    })
  }
}

export async function setLanguage(value: Language) {
  if (native) await native.setLanguage(value)
  else {
    try { localStorage.setItem('cymd.language', value) } catch { /* session preference still applies */ }
    apply(value)
  }
}
