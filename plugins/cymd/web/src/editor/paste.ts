// Copier-coller et glisser-déposer :
//  - images / vidéos / fichiers collés ou glissés → ajoutés au document ;
//  - HTML riche (page web, Word…) → converti en Markdown ;
//  - URL collée sur une sélection → [sélection](url) ;
//  - Ctrl+Shift+V → texte brut, sans conversion.

import TurndownService from 'turndown'
import { gfm } from 'turndown-plugin-gfm'
import { EditorView } from '@codemirror/view'
import type { Extension } from '@codemirror/state'
import { extname } from '../doc/paths'

export interface PasteDeps {
  /** Ajoute des fichiers au document et renvoie le Markdown à insérer. */
  filesToMarkdown(files: File[]): Promise<string>
  /** Image en data: URI trouvée dans du HTML collé → chemin du média créé (ou null). */
  storeDataImage(dataUri: string): string | null
  /** Fichier .md/.cymd déposé : à ouvrir plutôt qu'à insérer. */
  openDocFile(file: File): void
}

const DOC_EXTS = new Set(['.md', '.markdown', '.cymd'])
const URL_RE = /^(https?:\/\/|www\.)[^\s<>]+$/i
const RICH_SELECTOR = 'h1,h2,h3,h4,h5,h6,p,ul,ol,li,table,blockquote,pre,img,a[href],strong,b,em,i,code,hr,del,s'

let plainPasteUntil = 0

/** Ctrl+Shift+V : le prochain collage se fait en texte brut. */
export function armPlainPaste() {
  plainPasteUntil = Date.now() + 800
}

function isRichHtml(html: string): boolean {
  const d = new DOMParser().parseFromString(html, 'text/html')
  return !!d.body.querySelector(RICH_SELECTOR)
}

function makeTurndown(storeDataImage: PasteDeps['storeDataImage']) {
  const td = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '*',
    strongDelimiter: '**',
    hr: '---',
    linkStyle: 'inlined',
  })
  td.use(gfm)
  td.remove(['script', 'style', 'meta', 'title', 'head', 'noscript', 'iframe'])
  // Puces compactes ("- texte" plutôt que "-   texte").
  td.addRule('compactListItem', {
    filter: 'li',
    replacement: (content, node, options) => {
      const parent = node.parentNode as HTMLElement | null
      let prefix = `${options.bulletListMarker} `
      if (parent?.nodeName === 'OL') {
        const start = Number(parent.getAttribute('start') ?? 1)
        prefix = `${start + Array.prototype.indexOf.call(parent.children, node)}. `
      }
      const body = content
        .replace(/^\n+/, '')
        .replace(/\n+$/, '\n')
        .replace(/\n(?=.)/g, `\n${' '.repeat(prefix.length)}`)
      return prefix + body + (node.nextSibling && !body.endsWith('\n') ? '\n' : '')
    },
  })
  td.addRule('dataImages', {
    filter: (node) => node.nodeName === 'IMG' && /^data:image\//i.test(node.getAttribute('src') ?? ''),
    replacement: (_content, node) => {
      const img = node as HTMLImageElement
      const path = storeDataImage(img.getAttribute('src')!)
      return path ? `![${img.alt || ''}](${path})` : ''
    },
  })
  return td
}

export function htmlToMarkdown(html: string, storeDataImage: PasteDeps['storeDataImage']): string {
  return makeTurndown(storeDataImage)
    .turndown(html)
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Insère un bloc (médias) sur sa propre ligne à la position donnée. */
export function insertOnOwnLine(view: EditorView, from: number, to: number, text: string) {
  const { doc } = view.state
  const before = from > doc.lineAt(from).from ? '\n' : ''
  const after = to < doc.lineAt(to).to ? '\n' : ''
  const insert = before + text + after
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + before.length + text.length },
    scrollIntoView: true,
    userEvent: 'input.paste',
  })
}

export function pasteAndDrop(deps: PasteDeps): Extension {
  return EditorView.domEventHandlers({
    paste(e, view) {
      const dt = e.clipboardData
      if (!dt) return false
      const files = Array.from(dt.files)
      if (files.length) {
        e.preventDefault()
        const { from, to } = view.state.selection.main
        deps.filesToMarkdown(files).then((md) => md && insertOnOwnLine(view, from, to, md))
        return true
      }
      if (Date.now() < plainPasteUntil) {
        plainPasteUntil = 0
        return false // collage par défaut de CodeMirror = texte brut
      }

      const text = dt.getData('text/plain')
      const sel = view.state.selection.main
      if (!sel.empty && URL_RE.test(text.trim())) {
        const label = view.state.sliceDoc(sel.from, sel.to)
        if (!URL_RE.test(label.trim()) && !label.includes('\n')) {
          e.preventDefault()
          const insert = `[${label}](${text.trim()})`
          view.dispatch({
            changes: { from: sel.from, to: sel.to, insert },
            selection: { anchor: sel.from + insert.length },
            userEvent: 'input.paste',
          })
          return true
        }
      }

      const html = dt.getData('text/html')
      if (html && isRichHtml(html)) {
        const md = htmlToMarkdown(html, deps.storeDataImage)
        if (md) {
          e.preventDefault()
          view.dispatch(view.state.replaceSelection(md), { scrollIntoView: true, userEvent: 'input.paste' })
          return true
        }
      }
      return false
    },

    drop(e, view) {
      const files = Array.from(e.dataTransfer?.files ?? [])
      if (!files.length) return false
      e.preventDefault()
      const docs = files.filter((f) => DOC_EXTS.has(extname(f.name)))
      const media = files.filter((f) => !DOC_EXTS.has(extname(f.name)))
      docs.forEach((f) => deps.openDocFile(f))
      if (media.length) {
        const pos = view.posAtCoords({ x: e.clientX, y: e.clientY }) ?? view.state.selection.main.head
        deps.filesToMarkdown(media).then((md) => md && insertOnOwnLine(view, pos, pos, md))
      }
      return true
    },
  })
}
