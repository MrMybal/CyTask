import { setLanguage, tr } from '../i18n'
import { createWebPlatform } from './web'
import type { OpenedFile, Platform } from './types'

const PROTOCOL = 'cymd.integration'
const MAX_BYTES = 50 * 1024 * 1024

/** Explicit, versioned iframe integration; never enabled in the desktop app. */
export function createEmbeddedPlatform(): Platform | null {
  const query = new URLSearchParams(location.search)
  if (query.get('integration') !== '1' || window.parent === window) return null
  const origin = query.get('parentOrigin') || ''
  const session = query.get('session') || ''
  try {
    const url = new URL(origin)
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin || !session) return null
  } catch { return null }
  const web = createWebPlatform()
  let load: (file: OpenedFile) => void = () => {}
  let command: (cmd: string, arg?: string) => void = () => {}
  let opened = false
  const pending = new Map<string, { resolve(): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>()
  const send = (type: string, payload: Record<string, unknown> = {}) => window.parent.postMessage({
    protocol: PROTOCOL, version: 1, session, source: 'cymd', type, ...payload,
  }, origin)
  window.addEventListener('message', async event => {
    const m = event.data
    if (event.source !== window.parent || event.origin !== origin || !m || m.protocol !== PROTOCOL || m.version !== 1 || m.session !== session || m.source !== 'host') return
    if (m.type === 'save-result' && typeof m.requestId === 'string') {
      const item = pending.get(m.requestId)
      if (!item) return
      clearTimeout(item.timer)
      pending.delete(m.requestId)
      m.ok === true ? item.resolve() : item.reject(new Error(typeof m.error === 'string' ? m.error : tr('Enregistrement refusé par l’application hôte.')))
    } else if (m.type === 'open' && !opened) {
      if (!(m.file instanceof Blob) || m.file.size > MAX_BYTES || typeof m.name !== 'string' || !/\.(cymd|md|markdown)$/i.test(m.name)) {
        send('error', { message: tr('Document intégré invalide ou trop volumineux (50 Mo maximum).') })
        return
      }
      opened = true
      try {
        if (m.locale === 'fr' || m.locale === 'en') await setLanguage(m.locale)
        load({ path: null, name: m.name.replace(/^.*[\\/]/, ''), data: new Uint8Array(await m.file.arrayBuffer()), handle: { embedded: true } })
      } catch (error) { send('error', { message: String(error) }) }
    } else if (m.type === 'command' && ['save', 'save-as'].includes(m.command)) command(m.command)
  })
  return {
    ...web,
    embedded: true,
    ready() { send('ready') },
    onLoad(cb) { load = cb },
    onCommand(cb) { command = cb },
    setState(state) { web.setState(state); send('state', { title: state.title, dirty: state.dirty }) },
    async saveDialog(defaultName) {
      const name = window.prompt(tr('Nom du fichier (.md ou .cymd) :'), defaultName)
      if (!name) return null
      if (!/\.(cymd|md|markdown)$/i.test(name)) throw new Error(tr('Utilisez une extension .md ou .cymd.'))
      return { path: null, name: name.replace(/^.*[\\/]/, ''), handle: { embedded: true } }
    },
    async write(target, data) {
      if (!(target.handle as { embedded?: boolean } | undefined)?.embedded) return web.write(target, data)
      if (data.byteLength > MAX_BYTES) throw new Error(tr('Document intégré invalide ou trop volumineux (50 Mo maximum).'))
      const requestId = crypto.randomUUID()
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(tr('L’application hôte ne répond pas. Réessayez l’enregistrement.'))) }, 60000)
        pending.set(requestId, { resolve, reject, timer })
        send('save', { requestId, name: target.name, file: new Blob([data as BlobPart], { type: /\.cymd$/i.test(target.name) ? 'application/x-cymd' : 'text/markdown' }) })
      })
    },
    showError(message) { send('error', { message }); web.showError(message) },
    newWindow() {},
    closeWindow() { send('close-request') },
  }
}
