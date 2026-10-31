import { tr } from '../i18n'
import type { DocKind } from '../doc/document'
import { basename } from '../doc/paths'
import type {
  FetchedBinary,
  FetchedText,
  OpenedFile,
  Platform,
  SaveTarget,
  TabPayload,
  ThemeChoice,
  UnsavedChoice,
  WindowState,
} from './types'

/** API exposée par electron/preload.cjs. */
export interface NativeApi {
  platform: string
  getLanguage(): Promise<'fr' | 'en'>
  setLanguage(value: 'fr' | 'en'): Promise<void>
  onLanguage(cb: (value: 'fr' | 'en') => void): void
  ready(): void
  windowId(): Promise<number>
  setState(state: WindowState): void
  onCommand(cb: (cmd: string, arg?: string) => void): void
  onLoad(cb: (file: { path: string; data: Uint8Array }) => void): void
  onFocusPath(cb: (path: string) => void): void
  onTabDetach(cb: (tabId: string) => Promise<TabPayload | null>): void
  onTabAttach(cb: (payload: TabPayload, index: number) => void): void
  moveTabHere(fromWindow: number, tabId: string, index: number): Promise<boolean>
  tearOffTab(payload: TabPayload, screenX: number, screenY: number): Promise<void>
  openDialog(): Promise<{ path: string; data: Uint8Array }[]>
  saveDialog(opts: { defaultName: string; kind: DocKind }): Promise<string | null>
  saveHtmlDialog(name: string): Promise<string | null>
  askUnsaved(name: string): Promise<UnsavedChoice>
  showError(message: string): Promise<void>
  writeFile(path: string, data: Uint8Array): Promise<boolean>
  readAsset(docPath: string, rel: string): Promise<Uint8Array | null>
  assetExists(docPath: string, rel: string): Promise<boolean>
  writeAsset(docPath: string, rel: string, data: Uint8Array): Promise<boolean>
  fetchText(url: string): Promise<FetchedText>
  fetchBinary(url: string): Promise<FetchedBinary>
  openExternal(url: string): Promise<void>
  openLinked(docPath: string, rel: string): Promise<boolean>
  showInFolder(path: string): Promise<void>
  openFile(path: string): Promise<boolean>
  newWindow(): Promise<void>
  closeWindow(): Promise<void>
  setTheme(theme: ThemeChoice): Promise<void>
  readClipboardText(): Promise<string>
  pathForFile(file: File): string | null
}

export function createElectronPlatform(api: NativeApi): Platform {
  return {
    isDesktop: true,
    canWriteBesideDoc: true,
    ready: () => api.ready(),
    windowId: () => api.windowId(),
    setState: (s) => api.setState(s),
    onCommand: (cb) => api.onCommand(cb),
    onLoad: (cb) => api.onLoad((f) => cb({ path: f.path, name: basename(f.path), data: f.data })),
    onFocusPath: (cb) => api.onFocusPath(cb),

    onTabDetach: (cb) => api.onTabDetach(cb),
    onTabAttach: (cb) => api.onTabAttach(cb),
    moveTabHere: (fromWindow, tabId, index) => api.moveTabHere(fromWindow, tabId, index),
    tearOffTab: (payload, x, y) => void api.tearOffTab(payload, x, y),

    async openDialog(): Promise<OpenedFile[]> {
      const files = await api.openDialog()
      return files.map((f) => ({ path: f.path, name: basename(f.path), data: f.data }))
    },
    async saveDialog(defaultName, kind): Promise<SaveTarget | null> {
      const p = await api.saveDialog({ defaultName, kind })
      return p ? { path: p, name: basename(p) } : null
    },
    async saveHtmlDialog(defaultName) {
      const p = await api.saveHtmlDialog(defaultName)
      return p ? { path: p, name: basename(p) } : null
    },
    async write(target, data) {
      if (!target.path) throw new Error(tr('Aucun chemin de fichier.'))
      await api.writeFile(target.path, data)
    },
    askUnsaved: (name) => api.askUnsaved(name),
    showError: (message) => void api.showError(message),

    fileUrl: (absPath) => `cymd://file/${encodeURIComponent(absPath)}`,
    readAsset: (docPath, rel) => api.readAsset(docPath, rel),
    assetExists: (docPath, rel) => api.assetExists(docPath, rel),
    async writeAsset(docPath, rel, data) {
      await api.writeAsset(docPath, rel, data)
    },

    async fetchText(url) {
      try {
        return await api.fetchText(url)
      } catch {
        return null
      }
    },
    async fetchBinary(url) {
      try {
        return await api.fetchBinary(url)
      } catch {
        return null
      }
    },

    openExternal: (url) => void api.openExternal(url),
    openLinked: (docPath, rel) => api.openLinked(docPath, rel),
    showInFolder: (p) => void api.showInFolder(p),
    openFileByPath: (p) => api.openFile(p),
    pathForFile: (file) => api.pathForFile(file),
    newWindow: () => void api.newWindow(),
    closeWindow: () => void api.closeWindow(),
    setTheme: (t) => void api.setTheme(t),
    readClipboardText: () => api.readClipboardText(),
  }
}
