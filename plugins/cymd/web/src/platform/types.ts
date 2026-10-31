import type { DocKind, LinkPreview } from '../doc/document'

export interface OpenedFile {
  path: string | null
  name: string
  data: Uint8Array
  handle?: unknown
}

export interface SaveTarget {
  path: string | null
  name: string
  handle?: unknown
}

export interface FetchedText {
  url: string
  status: number
  contentType: string
  text: string
}

export interface FetchedBinary {
  data: Uint8Array
  contentType: string
}

export type UnsavedChoice = 'save' | 'discard' | 'cancel'
export type ThemeChoice = 'system' | 'light' | 'dark'

export interface WindowState {
  title: string
  /** Chemins des documents ouverts dans les onglets de la fenêtre. */
  paths: string[]
  /** Au moins un onglet a des modifications non enregistrées. */
  dirty: boolean
}

/** Onglet sérialisé pour passer d'une fenêtre à l'autre. */
export interface TabPayload {
  text: string
  kind: DocKind
  path: string | null
  name: string
  eol: '\n' | '\r\n'
  bom: boolean
  encoding: string
  created: string | null
  dirty: boolean
  assets: [string, { data: Uint8Array; mime: string; pending: boolean }][]
  previews: [string, LinkPreview][]
  selection: { anchor: number; head: number }
  scrollTop: number
}

/** Tout ce qui dépend de l'environnement (Electron ou navigateur). */
export interface Platform {
  readonly embedded?: boolean
  readonly isDesktop: boolean
  ready(): void
  windowId(): Promise<number>
  setState(state: WindowState): void
  onCommand(cb: (cmd: string, arg?: string) => void): void
  onLoad(cb: (file: OpenedFile) => void): void
  onFocusPath(cb: (path: string) => void): void

  // Onglets entre fenêtres
  onTabDetach(cb: (tabId: string) => Promise<TabPayload | null>): void
  onTabAttach(cb: (payload: TabPayload, index: number) => void): void
  moveTabHere(fromWindow: number, tabId: string, index: number): Promise<boolean>
  tearOffTab(payload: TabPayload, screenX: number, screenY: number): void

  openDialog(): Promise<OpenedFile[]>
  saveDialog(defaultName: string, kind: DocKind): Promise<SaveTarget | null>
  saveHtmlDialog(defaultName: string): Promise<SaveTarget | null>
  write(target: SaveTarget, data: Uint8Array): Promise<void>
  askUnsaved(name: string): Promise<UnsavedChoice>
  showError(message: string): void

  /** URL affichable pour un fichier local (mode dossier), si la plateforme le permet. */
  fileUrl(absPath: string): string | null
  readonly canWriteBesideDoc: boolean
  readAsset(docPath: string, rel: string): Promise<Uint8Array | null>
  assetExists(docPath: string, rel: string): Promise<boolean>
  writeAsset(docPath: string, rel: string, data: Uint8Array): Promise<void>

  fetchText(url: string): Promise<FetchedText | null>
  fetchBinary(url: string): Promise<FetchedBinary | null>

  openExternal(url: string): void
  openLinked(docPath: string, rel: string): Promise<boolean>
  showInFolder(path: string): void
  openFileByPath(path: string): Promise<boolean>
  pathForFile(file: File): string | null
  newWindow(): void
  closeWindow(): void
  setTheme(theme: ThemeChoice): void
  readClipboardText(): Promise<string>
}
