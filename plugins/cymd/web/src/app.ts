import { tr, getLanguage } from './i18n'
import { redo, undo } from '@codemirror/commands'
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import { openSearchPanel } from '@codemirror/search'
import type { ChangeSpec, EditorState } from '@codemirror/state'
import type { ViewUpdate } from '@codemirror/view'
import { CyDoc, type DocKind, type LinkPreview } from './doc/document'
import { isZip, packCymd, unpackCymd } from './doc/cymd'
import { extFromMime, kindFromMime, mimeFromPath, type MediaKind } from './doc/media'
import {
  dirname,
  extname,
  isExternalUrl,
  joinPath,
  mdDestination,
  normalizeRel,
  relativeInside,
  safeFileName,
  sameDocumentPath as samePath,
  stem,
} from './doc/paths'
import { formatCommands } from './editor/commands'
import { refreshLive } from './editor/livePreview'
import { armPlainPaste, insertOnOwnLine } from './editor/paste'
import { Editor } from './editor/setup'
import { renderEmbed, type EmbedDeps } from './embeds/embedCard'
import { LinkPreviews } from './embeds/linkPreview'
import type { OpenedFile, Platform, TabPayload, ThemeChoice } from './platform/types'
import { hydrate, type HydrateDeps } from './preview/hydrate'
import { collectLocalRefs, renderMarkdown, slugify } from './preview/render'
import { showMenu } from './ui/menu'
import { TAB_MIME, TabBar, type TabDragData, type TabInfo } from './ui/tabbar'
import { MODES, Toolbar, type ViewMode } from './ui/toolbar'
import guideText from './guide.md?raw'
import guideEnglish from './guide.en.md?raw'
const getGuide = () => getLanguage() === 'fr' ? guideText : guideEnglish
import themeCss from './styles/theme.css?raw'
import markdownCss from './styles/markdown.css?raw'

/** Un document ouvert dans un onglet. */
interface Tab {
  id: string
  doc: CyDoc
  /** État de l'éditeur (texte, sélection, annulation) ; à jour quand l'onglet n'est pas affiché. */
  state: EditorState
  scrollTop: number
  dirty: boolean
  version: number
}

let tabSeq = 0
const newTabId = () => `t${Date.now().toString(36)}${(tabSeq++).toString(36)}`

function store(key: string, value?: string): string | null {
  try {
    if (value === undefined) return localStorage.getItem(key)
    localStorage.setItem(key, value)
  } catch {
    /* stockage indisponible */
  }
  return null
}

function decodeText(data: Uint8Array): { text: string; bom: boolean; encoding: string } {
  if (data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf) {
    return { text: new TextDecoder('utf-8').decode(data.subarray(3)), bom: true, encoding: 'UTF-8' }
  }
  if (data[0] === 0xff && data[1] === 0xfe) return { text: new TextDecoder('utf-16le').decode(data.subarray(2)), bom: true, encoding: 'UTF-16 LE' }
  if (data[0] === 0xfe && data[1] === 0xff) return { text: new TextDecoder('utf-16be').decode(data.subarray(2)), bom: true, encoding: 'UTF-16 BE' }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(data), bom: false, encoding: 'UTF-8' }
  } catch {
    return { text: new TextDecoder('windows-1252').decode(data), bom: false, encoding: 'Windows-1252' }
  }
}

function isReferenced(text: string, path: string): boolean {
  return text.includes(path) || text.includes(encodeURI(path))
}

function timestamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

function blobToDataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })
}

function h<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (className) e.className = className
  if (text) e.textContent = text
  return e
}

export class App {
  private tabs: Tab[] = []
  private active!: Tab
  private mode: ViewMode = 'live'
  private lineNumbers = store('cymd.lineNumbers') === '1'
  private gen = 0
  private saving = false
  private windowId = 0
  private editor: Editor
  private previews: LinkPreviews
  private tabbar!: TabBar
  private toolbar!: Toolbar
  private blockCache = new Map<string, string>()
  private previewTimer = 0
  private statsTimer = 0
  private toastTimer = 0
  private syncingScroll = false

  private els!: {
    workspace: HTMLElement
    editorPane: HTMLElement
    previewPane: HTMLElement
    preview: HTMLElement
    pos: HTMLElement
    words: HTMLElement
    kind: HTMLElement
    eol: HTMLElement
    encoding: HTMLElement
    toast: HTMLElement
  }

  /** Document de l'onglet affiché. */
  private get doc(): CyDoc {
    return this.active.doc
  }

  constructor(
    private platform: Platform,
    root: HTMLElement,
  ) {
    this.buildUi(root)
    this.previews = new LinkPreviews(platform, () => this.doc)
    this.editor = new Editor(this.els.editorPane, {
      live: {
        resolve: (src) => this.resolve(src),
        generation: () => this.gen,
        renderEmbed: (host, url, onLayout) => renderEmbed(host, url, this.embedDeps(onLayout)),
        hasPreview: (url) => this.previews.has(url),
        renderBlock: (src) => this.renderBlock(src),
        hydrateBlock: (el, onLayout) => hydrate(el, this.hydrateDeps(onLayout)),
        openLink: (href) => this.openLink(href),
      },
      paste: {
        filesToMarkdown: (files) => this.filesToMarkdown(files),
        storeDataImage: (uri) => this.storeDataImage(uri),
        openDocFile: (file) => this.openDroppedDoc(file),
      },
      openLink: (href) => this.openLink(href),
      onUpdate: (u) => this.onEditorUpdate(u),
      format: (cmd) => void this.command('format', cmd),
      extraKeys: [],
    })
    this.editor.setLineNumbers(this.lineNumbers)
    this.toolbar.setLineNumbers(this.lineNumbers)
    this.editor.view.scrollDOM.addEventListener('scroll', () => this.syncPreviewScroll(), { passive: true })

    // Premier onglet : le guide au tout premier lancement, sinon un document vide.
    const first = !platform.embedded && !store('cymd.welcomed')
      ? this.makeTab(Object.assign(new CyDoc(), { name: tr('Bienvenue.md') }), getGuide())
      : this.makeTab(new CyDoc(), '')
    store('cymd.welcomed', '1')
    this.tabs.push(first)
    this.showTab(first)

    void platform.windowId().then((id) => {
      this.windowId = id
      this.tabbar.windowId = id
    })
    platform.onCommand((cmd, arg) => void this.command(cmd, arg))
    platform.onLoad((f) => void this.openFile(f))
    platform.onFocusPath((p) => {
      const tab = this.tabs.find((t) => t.doc.path && samePath(t.doc.path, p))
      if (tab) this.activate(tab)
    })
    platform.onTabDetach(async (id) => this.detachTab(id))
    platform.onTabAttach((payload, index) => this.attachTab(payload, index))

    this.bindGlobalEvents()
    this.applyTheme((store('cymd.theme') as ThemeChoice) || 'system')
    this.els.workspace.classList.toggle('narrow', store('cymd.narrow') !== '0')
    this.setMode('live')
    platform.ready()
    this.editor.view.focus()
    window.addEventListener('cymd-language', () => {
      const toolbar = new Toolbar((cmd, arg) => void this.command(cmd, arg))
      this.toolbar.el.replaceWith(toolbar.el)
      this.toolbar = toolbar
      toolbar.setMode(this.mode)
      toolbar.setLineNumbers(this.lineNumbers)
      this.editor.setLanguage()
      if (this.mode === 'live') {
        this.editor.setLive(false)
        this.editor.setLive(true)
      }
      this.blockCache.clear()
      this.gen++
      this.updateState()
      this.updateStats()
      this.updatePos()
      if (this.mode === 'split' || this.mode === 'read') this.renderPreview()
    })
  }

  // -------------------------------------------------------------------------
  // Interface

  private buildUi(root: HTMLElement) {
    this.tabbar = new TabBar({
      activate: (id) => this.withTab(id, (t) => this.activate(t)),
      close: (id) => this.withTab(id, (t) => void this.closeTab(t)),
      newTab: () => this.newTab(),
      reorder: (id, index) => this.reorderTab(id, index),
      contextMenu: (id, x, y) => this.withTab(id, (t) => this.tabMenu(t, x, y)),
      dropForeign: (data, index) => void this.platform.moveTabHere(data.win, data.tab, index),
      dragOut: (id, x, y) => this.withTab(id, (t) => this.tearOff(t, x, y)),
    })
    const logo = h('img', 'app-logo')
    logo.src = `${import.meta.env.BASE_URL}logo.png`
    logo.alt = 'CyMD'
    logo.title = 'CyMD'
    logo.draggable = false
    this.tabbar.el.prepend(logo)

    this.toolbar = new Toolbar((cmd, arg) => void this.command(cmd, arg))

    const workspace = h('main', 'workspace')
    const editorPane = h('section', 'pane pane-editor')
    const previewPane = h('section', 'pane pane-preview')
    const preview = h('article', 'markdown-body preview')
    previewPane.append(preview)
    workspace.append(editorPane, previewPane)

    const status = h('footer', 'statusbar')
    const pos = h('span', 'st-pos')
    const words = h('span', 'st-words')
    const kind = h('span', 'st-kind')
    const eol = h('span', 'st-eol')
    const encoding = h('span', 'st-enc')
    status.append(pos, words, h('span', 'spacer'), kind, eol, encoding)
    if (import.meta.env.MODE === 'pages') {
      for (const [label, href] of [['AGPL v3.0', './LICENSE.txt'], ['Source', './source.zip'], ['GitHub', 'https://github.com/MrMybal/CyMD']]) {
        const link = h('a', '', label)
        link.href = href
        link.target = '_blank'
        link.rel = 'noopener noreferrer'
        status.append(link)
      }
    }

    const toast = h('div', 'toast')
    toast.setAttribute('role', 'status')
    root.append(this.tabbar.el, this.toolbar.el, workspace, status, toast)
    this.els = { workspace, editorPane, previewPane, preview, pos, words, kind, eol, encoding, toast }
  }

  private toast(message: string, ms = 2200) {
    const t = this.els.toast
    t.textContent = message
    t.classList.add('show')
    clearTimeout(this.toastTimer)
    this.toastTimer = window.setTimeout(() => t.classList.remove('show'), ms)
  }

  private bindGlobalEvents() {
    window.addEventListener(
      'keydown',
      (e) => {
        const mod = e.ctrlKey || e.metaKey
        if (!mod || e.altKey) return
        const key = e.key.toLowerCase()
        if (e.shiftKey && (key === 'v' || e.code === 'KeyV')) {
          armPlainPaste() // laisse passer : le collage se fera en texte brut
          return
        }
        let handled = true
        if (!e.shiftKey && /^Digit[1-4]$/.test(e.code)) this.setMode(MODES[Number(e.code.slice(5)) - 1].id, true)
        else if (key === 's' && e.shiftKey) void this.saveAs()
        else if (key === 's') void this.save()
        else if (key === 'o' && !e.shiftKey) void this.open()
        else if ((key === 'n' || key === 't') && !e.shiftKey) this.newTab()
        else if (key === 'n' && e.shiftKey && !this.platform.isDesktop) this.platform.newWindow()
        else if (key === 'w' && !e.shiftKey) void this.closeTab(this.active)
        else if (key === 'tab' || key === 'pagedown' || key === 'pageup') this.cycleTab(key === 'pageup' || (key === 'tab' && e.shiftKey) ? -1 : 1)
        else if (key === 'f' && this.mode === 'read') {
          this.setMode('live', true)
          openSearchPanel(this.editor.view)
        } else handled = false
        if (handled) {
          e.preventDefault()
          e.stopPropagation()
        }
      },
      true,
    )

    // Fichiers ou onglets déposés en dehors de l'éditeur.
    window.addEventListener('dragover', (e) => {
      e.preventDefault()
      if (e.dataTransfer?.types.includes(TAB_MIME)) e.dataTransfer.dropEffect = 'move'
    })
    window.addEventListener('drop', (e) => {
      if (e.defaultPrevented) return
      e.preventDefault()
      if (e.dataTransfer?.types.includes(TAB_MIME)) {
        // Onglet d'une autre fenêtre lâché n'importe où : il rejoint cette fenêtre.
        try {
          const data = JSON.parse(e.dataTransfer.getData(TAB_MIME)) as TabDragData
          if (data.win !== this.windowId) void this.platform.moveTabHere(data.win, data.tab, -1)
        } catch {
          /* données illisibles */
        }
        return
      }
      const files = Array.from(e.dataTransfer?.files ?? [])
      const docs = files.filter((f) => ['.md', '.markdown', '.cymd'].includes(extname(f.name)))
      const media = files.filter((f) => !docs.includes(f))
      docs.forEach((f) => this.openDroppedDoc(f))
      if (media.length) {
        void this.filesToMarkdown(media).then((md) => {
          const { from, to } = this.editor.view.state.selection.main
          if (md) insertOnOwnLine(this.editor.view, from, to, md)
        })
      }
    })

    window.addEventListener('beforeunload', (e) => {
      if (!this.platform.isDesktop && this.tabs.some((t) => t.dirty)) e.preventDefault()
    })

    this.els.previewPane.addEventListener('dblclick', (e) => {
      // Double-clic dans la vue Lecture : retour à l'édition, à cet endroit.
      if (this.mode !== 'read') return
      const line = (e.target as HTMLElement).closest('[data-line]')?.getAttribute('data-line')
      this.setMode('live', true)
      if (line != null) this.gotoLine(Number(line) + 1)
    })
  }

  private applyTheme(choice: ThemeChoice) {
    store('cymd.theme', choice)
    if (choice === 'system') delete document.documentElement.dataset.theme
    else document.documentElement.dataset.theme = choice
    this.platform.setTheme(choice)
  }

  setMode(mode: ViewMode, focus = false) {
    this.mode = mode
    this.els.workspace.dataset.mode = mode
    this.toolbar.setMode(mode)
    this.editor.setLive(mode === 'live')
    if (mode === 'split' || mode === 'read') this.renderPreview()
    if (mode !== 'read') {
      this.editor.view.requestMeasure()
      if (focus) this.editor.view.focus()
    }
  }

  private setLineNumbers(on: boolean) {
    this.lineNumbers = on
    store('cymd.lineNumbers', on ? '1' : '0')
    this.editor.setLineNumbers(on)
    this.toolbar.setLineNumbers(on)
  }

  // -------------------------------------------------------------------------
  // Commandes (menu natif, raccourcis, boutons)

  async command(cmd: string, arg?: string) {
    const view = this.editor.view
    const needsEditor = () => {
      if (this.mode === 'read') this.setMode('live')
      view.focus()
    }
    switch (cmd) {
      case 'new':
      case 'new-tab':
        return this.newTab()
      case 'open':
        return this.open()
      case 'save':
        return void (await this.save())
      case 'save-as':
        return void (await this.saveAs())
      case 'close-tab':
        return void (await this.closeTab(this.active))
      case 'close-window':
        return this.closeWindow()
      case 'next-tab':
        return this.cycleTab(1)
      case 'prev-tab':
        return this.cycleTab(-1)
      case 'export-html':
        return this.exportHtml()
      case 'show-in-folder':
        if (this.doc.path) this.platform.showInFolder(this.doc.path)
        else this.toast(tr("Ce document n'est pas encore enregistré."))
        return
      case 'undo':
        needsEditor()
        undo(view)
        return
      case 'redo':
        needsEditor()
        redo(view)
        return
      case 'paste-plain': {
        needsEditor()
        const text = await this.platform.readClipboardText()
        if (text) view.dispatch(view.state.replaceSelection(text), { scrollIntoView: true, userEvent: 'input.paste' })
        return
      }
      case 'find':
        needsEditor()
        openSearchPanel(view)
        return
      case 'insert-media':
        if (this.mode === 'read') return
        needsEditor()
        return this.pickMedia()
      case 'format':
        if (arg && formatCommands[arg] && this.mode !== 'read') {
          needsEditor()
          formatCommands[arg](view)
        }
        return
      case 'mode':
        if (MODES.some((m) => m.id === arg)) this.setMode(arg as ViewMode, true)
        return
      case 'toggle-line-numbers':
        return this.setLineNumbers(!this.lineNumbers)
      case 'theme':
        return this.applyTheme((arg as ThemeChoice) || 'system')
      case 'toggle-narrow': {
        const narrow = !this.els.workspace.classList.contains('narrow')
        this.els.workspace.classList.toggle('narrow', narrow)
        store('cymd.narrow', narrow ? '1' : '0')
        this.editor.view.requestMeasure()
        return
      }
      case 'open-guide': {
        const existing = this.tabs.find((t) => !t.doc.path && t.doc.name === 'Guide CyMD.md')
        if (existing) return this.activate(existing)
        return this.addTab(this.makeTab(Object.assign(new CyDoc(), { name: 'Guide CyMD.md' }), getGuide()))
      }
    }
  }

  // -------------------------------------------------------------------------
  // Onglets

  private makeTab(doc: CyDoc, text: string, selection?: { anchor: number; head?: number }): Tab {
    return { id: newTabId(), doc, state: this.editor.createState(text, selection), scrollTop: 0, dirty: false, version: 0 }
  }

  private withTab(id: string, fn: (t: Tab) => void) {
    const t = this.tabs.find((x) => x.id === id)
    if (t) fn(t)
  }

  private stateOf(tab: Tab): EditorState {
    return tab === this.active ? this.editor.view.state : tab.state
  }

  private textOf(tab: Tab): string {
    return this.stateOf(tab).doc.toString()
  }

  /** Nouvel onglet vide, jamais modifié : on peut le remplacer par un fichier ouvert. */
  private pristine(tab: Tab): boolean {
    return !tab.doc.path && !tab.doc.handle && !tab.dirty && this.stateOf(tab).doc.length === 0
  }

  /** Affiche un onglet (sans lui donner le focus). */
  private showTab(tab: Tab) {
    const prev = this.active
    if (prev && prev !== tab && this.tabs.includes(prev)) {
      prev.state = this.editor.view.state
      prev.scrollTop = this.editor.view.scrollDOM.scrollTop
    }
    this.active = tab
    this.gen++
    this.blockCache.clear()
    this.editor.setState(tab.state, tab.scrollTop)
    this.updateState()
    this.updateStats()
    this.updatePos()
    if (this.mode === 'split' || this.mode === 'read') {
      this.renderPreview()
      this.els.previewPane.scrollTop = 0
    }
  }

  private activate(tab: Tab) {
    if (tab !== this.active) this.showTab(tab)
    if (this.mode !== 'read') this.editor.view.focus()
  }

  private addTab(tab: Tab, index?: number) {
    const at = index === undefined || index < 0 || index > this.tabs.length ? this.tabs.indexOf(this.active) + 1 : index
    this.tabs.splice(at, 0, tab)
    this.activate(tab)
  }

  newTab() {
    this.addTab(this.makeTab(new CyDoc(), ''))
  }

  private cycleTab(dir: number) {
    if (this.tabs.length < 2) return
    const i = this.tabs.indexOf(this.active)
    this.activate(this.tabs[(i + dir + this.tabs.length) % this.tabs.length])
  }

  private reorderTab(id: string, index: number) {
    const from = this.tabs.findIndex((t) => t.id === id)
    if (from < 0) return
    const [tab] = this.tabs.splice(from, 1)
    this.tabs.splice(index > from ? index - 1 : index, 0, tab)
    this.renderTabs()
  }

  /** Retire un onglet sans rien demander (fermeture confirmée ou déplacement). */
  private removeTab(tab: Tab) {
    const i = this.tabs.indexOf(tab)
    if (i < 0) return
    this.tabs.splice(i, 1)
    tab.doc.dispose()
    if (!this.tabs.length) {
      if (this.platform.isDesktop) {
        // Plus d'onglet : la fenêtre se ferme (après avoir répondu au processus principal).
        setTimeout(() => this.platform.closeWindow(), 0)
        return
      }
      const fresh = this.makeTab(new CyDoc(), '')
      this.tabs.push(fresh)
      this.showTab(fresh)
      return
    }
    if (tab === this.active) this.activate(this.tabs[Math.min(i, this.tabs.length - 1)])
    else this.updateState()
  }

  async closeTab(tab: Tab): Promise<boolean> {
    if (tab.dirty) {
      this.activate(tab)
      const choice = await this.platform.askUnsaved(tab.doc.title)
      if (choice === 'cancel') return false
      if (choice === 'save' && !(await this.save())) return false
    }
    this.removeTab(tab)
    return true
  }

  /** Fermeture de la fenêtre : demande pour chaque onglet modifié. */
  private async closeWindow() {
    for (const tab of [...this.tabs]) {
      if (!tab.dirty) continue
      this.activate(tab)
      const choice = await this.platform.askUnsaved(tab.doc.title)
      if (choice === 'cancel') return
      if (choice === 'save' && !(await this.save())) return
    }
    this.platform.closeWindow()
  }

  private tabMenu(tab: Tab, x: number, y: number) {
    const others = this.tabs.filter((t) => t !== tab)
    showMenu(
      [
        { label: tr('Nouvel onglet'), hint: 'Ctrl+T', action: () => this.newTab() },
        { separator: true },
        { label: tr("Fermer l'onglet"), hint: 'Ctrl+W', action: () => void this.closeTab(tab) },
        {
          label: tr('Fermer les autres onglets'),
          disabled: !others.length,
          action: async () => {
            for (const t of others) if (!(await this.closeTab(t))) break
          },
        },
        { separator: true },
        {
          label: tr('Déplacer dans une nouvelle fenêtre'),
          disabled: !this.platform.isDesktop || this.tabs.length < 2,
          action: () => this.tearOff(tab, window.screenX + 60, window.screenY + 60),
        },
        {
          label: tr("Afficher dans l'explorateur"),
          disabled: !this.platform.isDesktop || !tab.doc.path,
          action: () => tab.doc.path && this.platform.showInFolder(tab.doc.path),
        },
      ],
      { x, y },
    )
  }

  private serializeTab(tab: Tab): TabPayload {
    const state = this.stateOf(tab)
    const d = tab.doc
    return {
      text: state.doc.toString(),
      kind: d.kind,
      path: d.path,
      name: d.name,
      eol: d.eol,
      bom: d.bom,
      encoding: d.encoding,
      created: d.created,
      dirty: tab.dirty,
      assets: [...d.assets.entries()].map(([p, a]) => [p, { data: a.data, mime: a.mime, pending: a.pending }]),
      previews: [...d.previews.entries()],
      selection: { anchor: state.selection.main.anchor, head: state.selection.main.head },
      scrollTop: tab === this.active ? this.editor.view.scrollDOM.scrollTop : tab.scrollTop,
    }
  }

  /** Demandé par une autre fenêtre qui récupère l'onglet. */
  private detachTab(id: string): TabPayload | null {
    const tab = this.tabs.find((t) => t.id === id)
    if (!tab) return null
    const payload = this.serializeTab(tab)
    this.removeTab(tab)
    return payload
  }

  private attachTab(p: TabPayload, index: number) {
    const doc = new CyDoc()
    Object.assign(doc, { kind: p.kind, path: p.path, name: p.name, eol: p.eol, bom: p.bom, encoding: p.encoding, created: p.created })
    for (const [path, a] of p.assets) doc.assets.set(path, a.data, a.mime, a.pending)
    for (const [url, prev] of p.previews) doc.previews.set(url, prev)
    const tab = this.makeTab(doc, p.text, p.selection)
    tab.dirty = p.dirty
    tab.scrollTop = p.scrollTop
    const lone = this.tabs.length === 1 && this.pristine(this.active) ? this.active : null
    this.addTab(tab, index)
    if (lone) this.removeTab(lone)
  }

  /** Onglet lâché hors de la fenêtre : il part dans une nouvelle fenêtre. */
  private tearOff(tab: Tab, x: number, y: number) {
    if (!this.platform.isDesktop || this.tabs.length < 2) return
    const payload = this.serializeTab(tab)
    this.removeTab(tab)
    this.platform.tearOffTab(payload, x, y)
  }

  private renderTabs() {
    this.tabbar.render(
      this.tabs.map(
        (t): TabInfo => ({ id: t.id, title: t.doc.title, tooltip: t.doc.path ?? t.doc.title, dirty: t.dirty, kind: t.doc.kind }),
      ),
      this.active.id,
    )
  }

  // -------------------------------------------------------------------------
  // État, titre, barre d'état

  private onEditorUpdate(u: ViewUpdate) {
    if (u.docChanged) {
      const tab = this.active
      tab.version++
      if (!tab.dirty) {
        tab.dirty = true
        this.updateState()
      }
      this.schedulePreview()
      clearTimeout(this.statsTimer)
      this.statsTimer = window.setTimeout(() => this.updateStats(), 250)
    }
    if (u.docChanged || u.selectionSet) this.updatePos()
  }

  private updateState() {
    const d = this.doc
    const title = `${this.active.dirty ? '• ' : ''}${d.title} — CyMD`
    this.platform.setState({
      title,
      paths: this.tabs.map((t) => t.doc.path).filter((p): p is string => !!p),
      dirty: this.tabs.some((t) => t.dirty),
    })
    this.renderTabs()
    this.els.eol.textContent = d.eol === '\r\n' ? 'CRLF' : 'LF'
    this.els.encoding.textContent = d.encoding + (d.bom && d.encoding === 'UTF-8' ? ' BOM' : '')
    this.updateKind()
  }

  private updateKind() {
    const d = this.doc
    if (d.kind === 'cymd') {
      const n = [...d.assets.entries()].filter(([p]) => !p.startsWith('previews/')).length
      this.els.kind.textContent = tr("CyMD tout-en-un · {0} média{1}", n, (getLanguage() === 'en' ? n !== 1 : n > 1) ? 's' : '')
    } else this.els.kind.textContent = d.path ? tr('Markdown · dossier') : 'Markdown'
    this.els.kind.title =
      d.kind === 'cymd'
        ? tr('Document tout-en-un : texte, médias et aperçus de liens dans un seul fichier .cymd')
        : tr('Markdown simple : les images et vidéos sont lues depuis le dossier du fichier')
  }

  private updatePos() {
    const { state } = this.editor.view
    const r = state.selection.main
    const line = state.doc.lineAt(r.head)
    const sel = r.empty ? '' : tr(" ({0} sélectionnés)", r.to - r.from)
    this.els.pos.textContent = `Ln ${line.number}, Col ${r.head - line.from + 1}${sel}`
  }

  private updateStats() {
    const text = this.editor.text
    const words = text.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)?.length ?? 0
    this.els.words.textContent = tr("{0} mot{1} · {2} caractères", words, (getLanguage() === 'en' ? words !== 1 : words > 1) ? 's' : '', text.length)
    this.updateKind()
  }

  // -------------------------------------------------------------------------
  // Aperçu rendu (Côte à côte / Lecture)

  private schedulePreview() {
    if (this.mode !== 'split' && this.mode !== 'read') return
    clearTimeout(this.previewTimer)
    this.previewTimer = window.setTimeout(() => this.renderPreview(), 150)
  }

  private renderPreview() {
    clearTimeout(this.previewTimer)
    const pane = this.els.previewPane
    const scroll = pane.scrollTop
    this.els.preview.innerHTML = renderMarkdown(this.editor.text)
    hydrate(this.els.preview, this.hydrateDeps())
    pane.scrollTop = scroll
  }

  private syncPreviewScroll() {
    if (this.mode !== 'split' || this.syncingScroll) return
    const view = this.editor.view
    const top = view.scrollDOM.getBoundingClientRect().top
    const block = view.lineBlockAtHeight(top - view.documentTop)
    const line = view.state.doc.lineAt(block.from).number - 1
    const frac = block.height ? Math.min(1, Math.max(0, (top - view.documentTop - block.top) / block.height)) : 0
    const nodes = Array.from(this.els.preview.querySelectorAll<HTMLElement>('[data-line]'))
    if (!nodes.length) return
    let prev = nodes[0]
    let next: HTMLElement | null = null
    for (const n of nodes) {
      const l = Number(n.dataset.line)
      if (l <= line) prev = n
      else {
        next = n
        break
      }
    }
    const pane = this.els.previewPane
    const base = pane.getBoundingClientRect().top - pane.scrollTop
    const prevTop = prev.getBoundingClientRect().top - base
    const prevLine = Number(prev.dataset.line)
    let target = prevTop
    if (next) {
      const nextTop = next.getBoundingClientRect().top - base
      const span = Math.max(1, Number(next.dataset.line) - prevLine)
      target = prevTop + ((line - prevLine + frac) / span) * (nextTop - prevTop)
    }
    this.syncingScroll = true
    pane.scrollTop = Math.max(0, target - 8)
    requestAnimationFrame(() => (this.syncingScroll = false))
  }

  private gotoLine(n: number) {
    const view = this.editor.view
    const line = view.state.doc.line(Math.min(Math.max(1, n), view.state.doc.lines))
    view.dispatch({ selection: { anchor: line.from }, scrollIntoView: true })
    view.focus()
  }

  // -------------------------------------------------------------------------
  // Résolution des médias, liens, aperçus

  /** Transforme une source d'image/vidéo du document en URL affichable. */
  resolve(src: string): string | null {
    const s = src.trim().replace(/^<|>$/g, '')
    if (/^(https?:|data:|blob:|cymd:)/i.test(s)) return s
    if (s.startsWith('//')) return `https:${s}`
    if (isExternalUrl(s)) return null
    const rel = normalizeRel(s)
    if (!rel) return null
    const mem = this.doc.assets.url(rel)
    if (mem) return mem
    if (this.doc.kind === 'md' && this.doc.dir) return this.platform.fileUrl(joinPath(this.doc.dir, rel))
    return null
  }

  private openLink(href: string) {
    const h = href.trim()
    if (/^(https?:|mailto:)/i.test(h)) return this.platform.openExternal(h)
    if (/^www\./i.test(h)) return this.platform.openExternal(`https://${h}`)
    if (h.startsWith('#')) return this.gotoHeading(decodeURIComponent(h.slice(1)))
    const rel = normalizeRel(h)
    if (!rel) return
    if (this.doc.assets.has(rel)) {
      const a = document.createElement('a')
      a.href = this.doc.assets.url(rel)!
      a.download = rel.split('/').pop()!
      a.click()
      return
    }
    if (this.doc.path && this.doc.kind === 'md') {
      void this.platform.openLinked(this.doc.path, rel).then((ok) => {
        if (!ok) this.toast(`Fichier introuvable : ${rel}`)
      })
    } else this.toast(`Lien local non disponible : ${rel}`)
  }

  private gotoHeading(slug: string) {
    const { doc } = this.editor.view.state
    for (let i = 1; i <= doc.lines; i++) {
      const m = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(doc.line(i).text)
      if (m && slugify(m[1]) === slug) {
        if (this.mode === 'read') this.setMode('live')
        return this.gotoLine(i)
      }
    }
  }

  private embedDeps(onLayout?: () => void): EmbedDeps {
    return {
      previews: this.previews,
      resolve: (s) => this.resolve(s),
      openExternal: (u) => this.platform.openExternal(u),
      suppress: (u) => this.suppressEmbed(u),
      onLayout,
    }
  }

  private hydrateDeps(onLayout?: () => void): HydrateDeps {
    return {
      ...this.embedDeps(onLayout),
      openLink: (href) => this.openLink(href),
      toggleTask: (line) => this.toggleTask(line),
    }
  }

  private renderBlock(src: string): string {
    let html = this.blockCache.get(src)
    if (html === undefined) {
      html = renderMarkdown(src)
      if (this.blockCache.size > 300) this.blockCache.clear()
      this.blockCache.set(src, html)
    }
    return html
  }

  /** Comme sur Discord : entourer l'URL de < > masque son aperçu. */
  private suppressEmbed(url: string) {
    const view = this.editor.view
    const state = view.state
    const tree = ensureSyntaxTree(state, state.doc.length, 1000) ?? syntaxTree(state)
    const changes: ChangeSpec[] = []
    tree.iterate({
      enter: (n) => {
        if (n.name !== 'URL') return
        const parent = n.node.parent?.name
        if (parent === 'Link' || parent === 'Image' || parent === 'Autolink' || parent === 'LinkReference') return
        const raw = state.sliceDoc(n.from, n.to)
        if ((/^www\./i.test(raw) ? `https://${raw}` : raw) === url) changes.push({ from: n.from, insert: '<' }, { from: n.to, insert: '>' })
      },
    })
    if (changes.length) view.dispatch({ changes, userEvent: 'input' })
  }

  private toggleTask(line: number) {
    const view = this.editor.view
    const { doc } = view.state
    if (line + 1 > doc.lines) return
    const l = doc.line(line + 1)
    const m = /^(\s*(?:>\s*)*(?:[-*+]|\d+[.)])\s+\[)([ xX])\]/.exec(l.text)
    if (!m) return
    const pos = l.from + m[1].length
    view.dispatch({ changes: { from: pos, to: pos + 1, insert: m[2] === ' ' ? 'x' : ' ' }, userEvent: 'input.toggle' })
  }

  private refreshMedia() {
    this.gen++
    this.blockCache.clear()
    this.editor.view.dispatch({ effects: refreshLive.of(null) })
    if (this.mode === 'split' || this.mode === 'read') this.renderPreview()
  }

  // -------------------------------------------------------------------------
  // Médias collés / glissés

  private assetName(original: string, mime: string, kind: MediaKind): string {
    const ext = extname(original) || extFromMime(mime) || (kind === 'image' ? '.png' : '')
    const generic = !original || /^(image|blob|clipboard|unknown|screenshot)(\.\w+)?$/i.test(original)
    if (generic) return `${kind === 'other' ? 'fichier' : kind}-${timestamp()}${ext}`
    return safeFileName(stem(original)) + ext.toLowerCase()
  }

  private mediaMarkdown(name: string, path: string, kind: MediaKind): string {
    const dest = mdDestination(path)
    if (kind === 'other') return `[${name}](${dest})`
    const alt = /^(image|video|audio)-\d{8}-\d{6}/.test(path.split('/').pop()!) ? '' : stem(name)
    return `![${alt}](${dest})`
  }

  async filesToMarkdown(files: File[]): Promise<string> {
    const doc = this.doc
    const lines: string[] = []
    for (const f of files) {
      const mime = f.type || mimeFromPath(f.name)
      const kind = kindFromMime(mime)
      // Mode dossier : un fichier déjà dans le dossier du .md est simplement référencé.
      const local = this.platform.pathForFile(f)
      if (local && doc.kind === 'md' && doc.dir) {
        const rel = relativeInside(doc.dir, local)
        if (rel) {
          lines.push(this.mediaMarkdown(f.name, rel, kind))
          continue
        }
      }
      if (f.size > 300 * 1024 * 1024) {
        this.toast(`« ${f.name} » est trop volumineux (plus de 300 Mo).`)
        continue
      }
      const data = new Uint8Array(await f.arrayBuffer())
      const path = doc.assets.add(`assets/${this.assetName(f.name, mime, kind)}`, data, mime || 'application/octet-stream')
      lines.push(this.mediaMarkdown(f.name, path, kind))
    }
    if (lines.length) this.updateKind()
    return lines.join('\n')
  }

  private storeDataImage(uri: string): string | null {
    const m = /^data:(image\/[\w.+-]+)(;base64)?,(.*)$/is.exec(uri)
    if (!m) return null
    try {
      let data: Uint8Array
      if (m[2]) {
        const bin = atob(m[3])
        data = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i)
      } else data = new TextEncoder().encode(decodeURIComponent(m[3]))
      const ext = extFromMime(m[1]) || '.png'
      return this.doc.assets.add(`assets/image-${timestamp()}${ext}`, data, m[1])
    } catch {
      return null
    }
  }

  private pickMedia() {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    input.accept = 'image/*,video/*,audio/*'
    input.addEventListener('change', async () => {
      const md = await this.filesToMarkdown(Array.from(input.files ?? []))
      const { from, to } = this.editor.view.state.selection.main
      if (md) insertOnOwnLine(this.editor.view, from, to, md)
    })
    input.click()
  }

  private openDroppedDoc(file: File) {
    const p = this.platform.pathForFile(file)
    if (p) {
      void this.platform.openFileByPath(p)
      return
    }
    void (async () => this.openFile({ path: null, name: file.name, data: new Uint8Array(await file.arrayBuffer()) }))()
  }

  // -------------------------------------------------------------------------
  // Ouvrir

  async open() {
    for (const f of await this.platform.openDialog()) await this.openFile(f)
  }

  /** Ouvre un fichier dans un onglet (ou active l'onglet où il est déjà ouvert). */
  async openFile(f: OpenedFile) {
    if (f.path) {
      const existing = this.tabs.find((t) => t.doc.path && samePath(t.doc.path, f.path!))
      if (existing) return this.activate(existing)
    }
    const doc = new CyDoc()
    let text: string
    try {
      if (extname(f.name) === '.cymd' || isZip(f.data)) {
        const c = unpackCymd(f.data)
        doc.kind = 'cymd'
        doc.created = c.created
        text = c.text
        for (const [p, a] of c.assets) doc.assets.set(p, a.data, a.mime, false)
        for (const [u, p] of Object.entries(c.previews)) doc.previews.set(u, p)
      } else {
        const d = decodeText(f.data)
        text = d.text
        doc.bom = d.bom
        doc.encoding = d.encoding
      }
    } catch (err) {
      this.platform.showError(`Impossible de lire « ${f.name} » :\n${(err as Error).message}`)
      return
    }
    doc.eol = text.includes('\r\n') ? '\r\n' : '\n'
    doc.path = f.path
    doc.name = f.name
    doc.handle = f.handle ?? null

    // Un onglet vide jamais modifié est remplacé, comme la page « Nouvel onglet » de Chrome.
    const blank = this.pristine(this.active) ? this.active : null
    this.addTab(this.makeTab(doc, text))
    if (blank) this.removeTab(blank)
  }

  // -------------------------------------------------------------------------
  // Enregistrer

  async save(): Promise<boolean> {
    const tab = this.active
    if (!tab.doc.path && !tab.doc.handle) return this.saveAs()
    return this.persist(tab)
  }

  async saveAs(): Promise<boolean> {
    if (this.saving) return false
    const tab = this.active
    const doc = tab.doc
    const text = this.textOf(tab)
    const hasMedia = [...doc.assets.entries()].some(([p]) => isReferenced(text, p))
    const suggested: DocKind = doc.kind === 'cymd' || (!doc.path && hasMedia) ? 'cymd' : 'md'
    const heading = /^#{1,6}\s+(.+)$/m.exec(text)?.[1]
    const fromHeading = heading ? safeFileName(heading).replace(/-/g, ' ') : ''
    const base = doc.path || doc.handle || doc.name !== 'Sans titre' ? stem(doc.title) : fromHeading || tr('Sans titre')
    const target = await this.platform.saveDialog(`${base}.${suggested}`, suggested)
    if (!target) return false
    const newKind: DocKind = extname(target.name) === '.cymd' ? 'cymd' : 'md'

    // Les fichiers du dossier d'origine suivent le document (vers le .cymd ou le nouveau dossier).
    if (doc.kind === 'md' && doc.path && (newKind === 'cymd' || !target.path || dirname(target.path) !== dirname(doc.path))) {
      await this.importLocalRefs(doc, doc.path, text)
    }
    if (newKind === 'md') for (const [, a] of doc.assets.entries()) a.pending = true

    doc.kind = newKind
    doc.path = target.path
    doc.name = target.name
    doc.handle = target.handle ?? null
    const ok = await this.persist(tab)
    if (tab === this.active) this.refreshMedia()
    this.updateState()
    return ok
  }

  private async importLocalRefs(doc: CyDoc, docPath: string, text: string) {
    for (const rel of collectLocalRefs(text)) {
      if (doc.assets.has(rel)) continue
      const data = await this.platform.readAsset(docPath, rel)
      if (data) doc.assets.set(rel, data, mimeFromPath(rel), true)
    }
  }

  private async persist(tab: Tab): Promise<boolean> {
    if (this.saving) return false
    this.saving = true
    try {
      const written = await this.writeDoc(tab)
      tab.dirty = tab.version !== written
      this.updateState()
      this.toast(tr("Enregistré : {0}", tab.doc.title), 1400)
      return true
    } catch (err) {
      this.platform.showError(tr("Échec de l'enregistrement de « {0} » :\n{1}", tab.doc.title, (err as Error).message))
      return false
    } finally {
      this.saving = false
    }
  }

  /** Écrit le document de l'onglet ; renvoie la version du texte effectivement écrite. */
  private async writeDoc(tab: Tab): Promise<number> {
    const doc = tab.doc
    const target = { path: doc.path, name: doc.name, handle: doc.handle }
    let text = this.textOf(tab)
    let version = tab.version

    if (doc.kind === 'cymd') {
      const urls = [...doc.previews.keys()].filter((u) => text.includes(u) || (u.startsWith('https://www.') && text.includes(u.slice(8))))
      await this.previews.localizeAll(doc, urls)
      const previews: Record<string, LinkPreview> = {}
      const keep = new Set<string>()
      for (const u of urls) {
        const p = doc.previews.get(u)!
        previews[u] = p
        if (p.image && !isExternalUrl(p.image)) keep.add(p.image)
      }
      // Les médias qui ne sont plus utilisés dans le texte ne sont pas enregistrés.
      const assets = [...doc.assets.entries()].filter(([p]) => keep.has(p) || isReferenced(text, p))
      await this.platform.write(target, packCymd(text, assets, previews, doc.created))
      for (const [, a] of assets) a.pending = false
      doc.created ??= new Date().toISOString()
      return version
    }

    const pending = [...doc.assets.entries()].filter(([p, a]) => a.pending && isReferenced(text, p))
    if (pending.length) {
      if (doc.path && this.platform.canWriteBesideDoc) {
        text = await this.writePendingAssets(tab, doc.path, text)
        version = tab.version // des références ont pu être renommées
      } else this.toast(tr('Les médias collés ne peuvent pas être écrits à côté du fichier ici : enregistrez en .cymd pour les garder.'), 5000)
    }
    const out = (doc.bom && doc.encoding === 'UTF-8' ? '﻿' : '') + (doc.eol === '\r\n' ? text.replace(/\n/g, '\r\n') : text)
    await this.platform.write(target, new TextEncoder().encode(out))
    if (doc.encoding !== 'UTF-8') {
      doc.encoding = 'UTF-8'
      doc.bom = false
    }
    return version
  }

  /** Écrit les médias collés à côté du .md (dossier assets/), sans écraser de fichier existant. */
  private async writePendingAssets(tab: Tab, docPath: string, text: string): Promise<string> {
    const doc = tab.doc
    for (const [path, asset] of [...doc.assets.entries()]) {
      if (!asset.pending || !isReferenced(text, path)) continue
      let target = path
      if (await this.platform.assetExists(docPath, target)) {
        const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : ''
        const ext = extname(path)
        const base = stem(path)
        for (let i = 2; ; i++) {
          target = `${dir}${base}-${i}${ext}`
          if (!doc.assets.has(target) && !(await this.platform.assetExists(docPath, target))) break
        }
        doc.assets.rename(path, target)
        text = this.replaceRefs(tab, path, target)
      }
      await this.platform.writeAsset(docPath, target, asset.data)
      asset.pending = false
    }
    return text
  }

  private replaceRefs(tab: Tab, from: string, to: string): string {
    const state = this.stateOf(tab)
    const text = state.doc.toString()
    const changes: ChangeSpec[] = []
    const seen = new Set<number>()
    for (const [a, b] of [
      [from, to],
      [encodeURI(from), encodeURI(to)],
    ]) {
      for (let i = text.indexOf(a); i !== -1; i = text.indexOf(a, i + a.length)) {
        if (seen.has(i)) continue
        seen.add(i)
        changes.push({ from: i, to: i + a.length, insert: b })
      }
    }
    if (!changes.length) return text
    if (tab === this.active) this.editor.view.dispatch({ changes })
    else {
      tab.state = state.update({ changes }).state
      tab.version++
    }
    return this.textOf(tab)
  }

  // -------------------------------------------------------------------------
  // Export HTML autonome (médias intégrés)

  private async exportHtml() {
    const target = await this.platform.saveHtmlDialog(`${stem(this.doc.title)}.html`)
    if (!target) return
    try {
      const text = this.editor.text
      const box = document.createElement('div')
      box.innerHTML = renderMarkdown(text)
      const urls = Array.from(box.querySelectorAll<HTMLElement>('.cy-embed[data-url]'), (e) => e.dataset.url!)
      await Promise.all(urls.map((u) => this.previews.get(u).catch(() => null)))
      hydrate(box, { ...this.hydrateDeps(), suppress: undefined, toggleTask: undefined })
      await new Promise((r) => setTimeout(r, 50))
      box.querySelectorAll('.cy-embed-actions, .cy-embed-play, .cy-embed-empty').forEach((e) => e.remove())
      for (const el of box.querySelectorAll<HTMLElement>('[src]')) {
        const src = el.getAttribute('src')!
        if (!/^(blob|cymd):/i.test(src)) continue
        try {
          const blob = await (await fetch(src)).blob()
          if (blob.size <= 60 * 1024 * 1024) el.setAttribute('src', await blobToDataUri(blob))
        } catch {
          /* média laissé tel quel */
        }
      }
      const title = this.doc.title.replace(/[<>&]/g, '')
      const html = `<!doctype html>
<html lang="${getLanguage()}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="CyMD">
<title>${title}</title>
<style>
${themeCss}
${markdownCss}
body { margin: 0; background: var(--bg); color: var(--fg); }
.markdown-body { max-width: 860px; margin: 0 auto; padding: 40px 24px 80px; }
.markdown-body .cy-spoiler:hover, .markdown-body .cy-spoiler:hover * { color: var(--fg) !important; background: var(--spoiler-open); }
</style>
</head>
<body>
<main class="markdown-body">
${box.innerHTML}
</main>
</body>
</html>
`
      await this.platform.write(target, new TextEncoder().encode(html))
      this.toast(tr("Exporté : {0}", target.name))
    } catch (err) {
      this.platform.showError(tr("Échec de l'export HTML :\n{0}", (err as Error).message))
    }
  }
}
