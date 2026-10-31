import { tr } from '../i18n'
// Version navigateur : fonctionne partout, avec des limites (pas d'accès au dossier du
// fichier, aperçus de liens limités par CORS). Utilise l'API File System Access quand
// elle existe (Chrome, Edge) pour enregistrer directement dans le fichier ouvert.

import type { DocKind } from '../doc/document'
import type { OpenedFile, Platform, SaveTarget, WindowState } from './types'

interface FileHandle {
  name: string
  getFile(): Promise<File>
  createWritable(): Promise<{ write(data: Uint8Array | Blob): Promise<void>; close(): Promise<void> }>
}

interface FsWindow {
  showOpenFilePicker?: (opts: unknown) => Promise<FileHandle[]>
  showSaveFilePicker?: (opts: unknown) => Promise<FileHandle>
}

const fsw = window as unknown as FsWindow

const TYPES = {
  md: { description: 'Markdown', accept: { 'text/markdown': ['.md', '.markdown'] } },
  cymd: { get description() { return tr('Document CyMD tout-en-un') }, accept: { 'application/x-cymd': ['.cymd'] } },
}

function pickWithInput(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null))
    input.addEventListener('cancel', () => resolve(null))
    input.click()
  })
}

function download(name: string, data: Uint8Array) {
  const url = URL.createObjectURL(new Blob([data as BlobPart]))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

export function createWebPlatform(): Platform {
  return {
    isDesktop: false,
    canWriteBesideDoc: false,
    ready() {},
    windowId: async () => 0,
    setState(s: WindowState) {
      document.title = s.title
    },
    onCommand() {},
    onLoad() {},
    onFocusPath() {},
    onTabDetach() {},
    onTabAttach() {},
    moveTabHere: async () => false,
    tearOffTab() {},

    async openDialog(): Promise<OpenedFile[]> {
      if (fsw.showOpenFilePicker) {
        try {
          const handles = await fsw.showOpenFilePicker({
            multiple: true,
            types: [
              { description: 'Documents (md, cymd)', accept: { 'text/markdown': ['.md', '.markdown', '.txt'], 'application/x-cymd': ['.cymd'] } },
            ],
          })
          return Promise.all(
            handles.map(async (handle) => {
              const file = await handle.getFile()
              return { path: null, name: file.name, data: new Uint8Array(await file.arrayBuffer()), handle }
            }),
          )
        } catch {
          return []
        }
      }
      const file = await pickWithInput('.md,.markdown,.txt,.cymd')
      return file ? [{ path: null, name: file.name, data: new Uint8Array(await file.arrayBuffer()) }] : []
    },

    async saveDialog(defaultName: string, kind: DocKind): Promise<SaveTarget | null> {
      if (fsw.showSaveFilePicker) {
        try {
          const handle = await fsw.showSaveFilePicker({
            suggestedName: defaultName,
            types: kind === 'cymd' ? [TYPES.cymd, TYPES.md] : [TYPES.md, TYPES.cymd],
          })
          return { path: null, name: handle.name, handle }
        } catch {
          return null
        }
      }
      const name = window.prompt(tr('Nom du fichier (.md ou .cymd) :'), defaultName)
      return name ? { path: null, name } : null
    },

    async saveHtmlDialog(defaultName: string) {
      if (fsw.showSaveFilePicker) {
        try {
          const handle = await fsw.showSaveFilePicker({
            suggestedName: defaultName,
            types: [{ description: tr('Page HTML'), accept: { 'text/html': ['.html'] } }],
          })
          return { path: null, name: handle.name, handle }
        } catch {
          return null
        }
      }
      return { path: null, name: defaultName }
    },

    async write(target: SaveTarget, data: Uint8Array) {
      const handle = target.handle as FileHandle | undefined
      if (handle?.createWritable) {
        const w = await handle.createWritable()
        await w.write(data)
        await w.close()
      } else download(target.name, data)
    },

    async askUnsaved(name: string) {
      return window.confirm(tr("« {0} » contient des modifications non enregistrées.\nLes abandonner ?", name)) ? 'discard' : 'cancel'
    },
    showError: (message) => window.alert(message),

    fileUrl: () => null,
    readAsset: async () => null,
    assetExists: async () => false,
    writeAsset: async () => {
      throw new Error(tr('Non disponible dans la version web.'))
    },

    async fetchText(url: string) {
      try {
        const res = await fetch(url)
        return { url: res.url || url, status: res.status, contentType: res.headers.get('content-type') ?? '', text: await res.text() }
      } catch {
        return null // bloqué par CORS dans la plupart des cas
      }
    },
    async fetchBinary(url: string) {
      try {
        const res = await fetch(url)
        if (!res.ok) return null
        return { data: new Uint8Array(await res.arrayBuffer()), contentType: res.headers.get('content-type') ?? '' }
      } catch {
        return null
      }
    },

    openExternal(url: string) {
      if (/^(https?|mailto):/i.test(url)) window.open(url, '_blank', 'noopener,noreferrer')
    },
    openLinked: async () => false,
    showInFolder() {},
    openFileByPath: async () => false,
    pathForFile: () => null,
    newWindow() {
      window.open(location.href, '_blank')
    },
    closeWindow() {
      window.close()
    },
    setTheme() {},
    async readClipboardText() {
      try {
        return await navigator.clipboard.readText()
      } catch {
        return ''
      }
    },
  }
}
