import './styles/theme.css'
import './styles/app.css'
import './styles/markdown.css'
import { App } from './app'
import { detectPlatform } from './platform'
import { initLanguage } from './i18n'

await initLanguage()
const app = new App(detectPlatform(), document.getElementById('app')!)
if (import.meta.env.DEV) (window as unknown as { cymd: App }).cymd = app
