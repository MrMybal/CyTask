// Mode Live : le Markdown est rendu directement dans l'éditeur. La syntaxe (#, **, [](…)…)
// reste masquée au clic et pendant la sélection. Les URLs nues ont un
// aperçu sous leur ligne, comme sur Discord (<url> entre chevrons = pas d'aperçu).

import { EditorState, StateEffect, StateField, type Extension, type Range } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate, type WidgetType } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import type { SyntaxNode } from '@lezer/common'
import { kindFromPath } from '../doc/media'
import {
  BulletWidget,
  CheckboxWidget,
  EmbedWidget,
  FenceWidget,
  HrWidget,
  MediaWidget,
  RenderedBlockWidget,
  type LiveContext,
} from './widgets'

/** Force la reconstruction des décorations (ex. : le document a changé de dossier). */
export const refreshLive = StateEffect.define<null>()
// Les décorations ne sont calculées que dans une fenêtre autour de la partie visible,
// pour rester fluide sur les gros documents.
const MARGIN = 6000
interface Span {
  from: number
  to: number
}
const setWindow = StateEffect.define<Span>()

const windowField = StateField.define<Span>({
  create: (state) => ({ from: 0, to: Math.min(state.doc.length, 3 * MARGIN) }),
  update(v, tr) {
    for (const e of tr.effects) if (e.is(setWindow)) return e.value
    if (tr.docChanged) return { from: tr.changes.mapPos(v.from, -1), to: tr.changes.mapPos(v.to, 1) }
    return v
  },
})

const windowWatcher = ViewPlugin.fromClass(
  class {
    frame = 0
    constructor(readonly view: EditorView) {
      this.check()
    }
    update(u: ViewUpdate) {
      if (u.viewportChanged || u.docChanged) this.check()
    }
    check() {
      if (this.frame) return
      this.frame = requestAnimationFrame(() => {
        this.frame = 0
        const w = this.view.state.field(windowField, false)
        if (!w) return
        const { from, to } = this.view.viewport
        const len = this.view.state.doc.length
        if (w.from <= Math.max(0, from - MARGIN / 2) && w.to >= Math.min(len, to + MARGIN / 2)) return
        this.view.dispatch({ effects: setWindow.of({ from: Math.max(0, from - MARGIN), to: Math.min(len, to + MARGIN) }) })
      })
    }
    destroy() {
      cancelAnimationFrame(this.frame)
    }
  },
)

const hidden = Decoration.replace({})
const hrWidget = new HrWidget()
const inlineCode = Decoration.mark({ class: 'cm-lp-inline-code' })
const taskDone = Decoration.mark({ class: 'cm-lp-task-done' })
const listNumber = Decoration.mark({ class: 'cm-lp-list-number' })
const spoiler = Decoration.mark({ class: 'cm-lp-spoiler', attributes: { title: 'Spoiler' } })
const spoilerOpen = Decoration.mark({ class: 'cm-lp-spoiler cm-lp-spoiler-open' })
const INLINE_HTML: Record<string, string> = {
  u: 'cm-lp-underline',
  ins: 'cm-lp-underline',
  mark: 'cm-lp-highlight',
  kbd: 'cm-lp-kbd',
  sub: 'cm-lp-sub',
  sup: 'cm-lp-sup',
}

function linkMark(href: string) {
  return Decoration.mark({
    class: 'cm-lp-link',
    attributes: { 'data-href': href, title: `${href}\nCtrl+clic pour ouvrir` },
  })
}

function hrefOfBareUrl(url: string): string {
  if (/^www\./i.test(url)) return `https://${url}`
  if (!/^[a-z][a-z0-9+.-]*:/i.test(url) && url.includes('@')) return `mailto:${url}`
  return url
}

function listDepth(node: SyntaxNode): number {
  let d = 0
  for (let p = node.parent; p; p = p.parent) if (p.name === 'BulletList' || p.name === 'OrderedList') d++
  return Math.max(0, d - 1)
}

function inside(node: SyntaxNode, name: string): boolean {
  for (let p = node.parent; p; p = p.parent) if (p.name === name) return true
  return false
}

function build(state: EditorState, ctx: LiveContext): DecorationSet {
  const out: Range<Decoration>[] = []
  const doc = state.doc
  const gen = ctx.generation()
  // Le mode Live garde la syntaxe masquée, y compris au clic et à la sélection.
  const hide = (from: number, to: number) => {
    if (to > from) out.push(hidden.range(from, to))
  }
  const lineDeco = (lineNo: number, cls: string) => out.push(Decoration.line({ class: cls }).range(doc.line(lineNo).from))

  // Widgets affichés sous une ligne (aperçus de liens, médias de la ligne active).
  const below = new Map<number, WidgetType[]>()
  const addBelow = (pos: number, w: WidgetType) => {
    const end = doc.lineAt(pos).to
    const list = below.get(end) ?? []
    list.push(w)
    below.set(end, list)
  }

  const win = state.field(windowField)
  syntaxTree(state).iterate({
    from: win.from,
    to: win.to,
    enter: (ref) => {
      const { name, from, to } = ref
      const node = ref.node
      switch (name) {
        case 'ATXHeading1':
        case 'ATXHeading2':
        case 'ATXHeading3':
        case 'ATXHeading4':
        case 'ATXHeading5':
        case 'ATXHeading6': {
          const line = doc.lineAt(from)
          lineDeco(line.number, `cm-lp-h cm-lp-h${name.slice(-1)}`)
          for (let c = node.firstChild; c; c = c.nextSibling) {
            if (c.name !== 'HeaderMark') continue
            if (!doc.sliceString(line.from, c.from).trim()) hide(c.from, doc.sliceString(c.to, c.to + 1) === ' ' ? c.to + 1 : c.to)
            else {
              let s = c.from
              while (s > line.from && doc.sliceString(s - 1, s) === ' ') s--
              hide(s, c.to)
            }
          }
          break
        }

        case 'SetextHeading1':
        case 'SetextHeading2': {
          const mark = node.getChild('HeaderMark')
          const first = doc.lineAt(from).number
          const markLine = mark ? doc.lineAt(mark.from).number : doc.lineAt(to).number + 1
          for (let n = first; n < markLine; n++) lineDeco(n, `cm-lp-h cm-lp-h${name.slice(-1)}`)
          if (mark) lineDeco(markLine, 'cm-lp-setext-mark')
          break
        }

        case 'EmphasisMark':
        case 'StrikethroughMark': {
          hide(from, to)
          break
        }

        case 'InlineCode': {
          out.push(inlineCode.range(from, to))
          for (const c of node.getChildren('CodeMark')) hide(c.from, c.to)
          return false
        }

        case 'Escape':
          hide(from, from + 1)
          break

        case 'Spoiler': {
          const open = state.selection.ranges.some(r => r.from <= to && r.to >= from)
          out.push((open ? spoilerOpen : spoiler).range(from, to))
          for (const m of node.getChildren('SpoilerMark')) hide(m.from, m.to)
          break
        }

        case 'HTMLTag': {
          // <u>…</u>, <mark>…</mark>, <kbd>…</kbd>, <sub>/<sup> : rendus en ligne.
          const tag = /^<([a-z]+)>$/i.exec(doc.sliceString(from, to))?.[1].toLowerCase()
          const cls = tag && INLINE_HTML[tag]
          if (!cls) break
          let close: SyntaxNode | null = null
          for (let s = node.nextSibling; s; s = s.nextSibling) {
            if (s.name === 'HTMLTag' && doc.sliceString(s.from, s.to).toLowerCase() === `</${tag}>`) {
              close = s
              break
            }
          }
          if (!close) break
          if (close.from > to) out.push(Decoration.mark({ class: cls }).range(to, close.from))
          hide(from, to)
          hide(close.from, close.to)
          break
        }

        case 'Link': {
          const url = node.getChild('URL')
          const marks = node.getChildren('LinkMark')
          const close = marks.find((m) => doc.sliceString(m.from, m.to) === ']')
          if (!url || !close || !marks.length) break
          const href = doc.sliceString(url.from, url.to).replace(/^<|>$/g, '')
          hide(from, marks[0].to)
          hide(close.from, to)
          if (close.from > marks[0].to) out.push(linkMark(href).range(marks[0].to, close.from))
          break
        }

        case 'Image': {
          const url = node.getChild('URL')
          if (!url) break
          const marks = node.getChildren('LinkMark')
          const close = marks.find((m) => doc.sliceString(m.from, m.to) === ']')
          const alt = close && marks.length ? doc.sliceString(marks[0].to, close.from) : ''
          const src = doc.sliceString(url.from, url.to).replace(/^<|>$/g, '')
          const kind = kindFromPath(src)
          out.push(Decoration.replace({ widget: new MediaWidget(src, alt, kind, false, ctx, gen) }).range(from, to))
          return false
        }

        case 'Autolink': {
          for (const m of node.getChildren('LinkMark')) hide(m.from, m.to)
          const url = node.getChild('URL')
          if (url) out.push(linkMark(hrefOfBareUrl(doc.sliceString(url.from, url.to))).range(url.from, url.to))
          return false
        }

        case 'URL': {
          const parent = node.parent?.name
          if (parent === 'Link' || parent === 'Image' || parent === 'LinkReference') break
          const href = hrefOfBareUrl(doc.sliceString(from, to))
          out.push(linkMark(href).range(from, to))
          const embeddable = /^https?:\/\//i.test(href) && !inside(node, 'Table') && !inside(node, 'Link')
          if (embeddable) addBelow(to, new EmbedWidget(href, ctx, gen))
          break
        }

        case 'ListMark': {
          const item = node.parent
          const list = item?.parent
          if (!item || !list) break
          if (list.name === 'OrderedList') {
            out.push(listNumber.range(from, to))
            break
          }
          if (item.getChild('Task')) hide(from, Math.min(doc.lineAt(from).to, doc.sliceString(to, to + 1) === ' ' ? to + 1 : to))
          else out.push(Decoration.replace({ widget: new BulletWidget(listDepth(list)) }).range(from, to))
          break
        }

        case 'TaskMarker': {
          const checked = /x/i.test(doc.sliceString(from, to))
          out.push(Decoration.replace({ widget: new CheckboxWidget(checked) }).range(from, to))
          const task = node.parent
          if (checked && task && task.to > to + 1) out.push(taskDone.range(to + 1, task.to))
          break
        }

        case 'Blockquote': {
          const a = doc.lineAt(from).number
          const b = doc.lineAt(to).number
          for (let n = a; n <= b; n++) lineDeco(n, 'cm-lp-quote')
          break
        }

        case 'QuoteMark':
          hide(from, doc.sliceString(to, to + 1) === ' ' ? to + 1 : to)
          break

        case 'FencedCode':
        case 'CodeBlock': {
          const first = doc.lineAt(from)
          const last = doc.lineAt(to)
          for (let n = first.number; n <= last.number; n++) {
            let cls = 'cm-lp-codeblock'
            if (n === first.number) cls += ' cm-lp-codeblock-first'
            if (n === last.number) cls += ' cm-lp-codeblock-last'
            lineDeco(n, cls)
          }
          if (name === 'FencedCode') {
            const marks = node.getChildren('CodeMark')
            const info = node.getChild('CodeInfo')
            const lang = info ? doc.sliceString(info.from, info.to) : ''
            const closing = marks.length > 1 && doc.lineAt(marks[marks.length - 1].from).number !== first.number ? marks[marks.length - 1] : null
            const code = first.number < last.number ? doc.sliceString(first.to + 1, closing ? last.from - 1 : to) : ''
            if (marks.length) out.push(Decoration.replace({ widget: new FenceWidget(lang, code) }).range(marks[0].from, first.to))
            if (closing) hide(closing.from, last.to)
          }
          return false
        }

        case 'HorizontalRule':
          out.push(Decoration.replace({ widget: hrWidget }).range(from, to))
          break

        case 'Table': {
          const first = doc.lineAt(from)
          const last = doc.lineAt(to)
          const src = doc.sliceString(first.from, last.to)
          out.push(Decoration.replace({ widget: new RenderedBlockWidget(src, 'table', ctx, gen), block: true }).range(first.from, last.to))
          return false
        }

        case 'HTMLBlock': {
          const first = doc.lineAt(from)
          const last = doc.lineAt(to)
          const src = doc.sliceString(first.from, last.to)
          if (ctx.renderBlock(src).trim()) {
            out.push(Decoration.replace({ widget: new RenderedBlockWidget(src, 'html', ctx, gen), block: true }).range(first.from, last.to))
          }
          return false
        }

        case 'LinkReference':
          lineDeco(doc.lineAt(from).number, 'cm-lp-linkref')
          return false
      }
      return undefined
    },
  })

  for (const [pos, widgets] of below) {
    for (const widget of widgets) out.push(Decoration.widget({ widget, block: true, side: 1 }).range(pos))
  }
  return Decoration.set(out, true)
}

/** Ctrl+clic (ou Cmd+clic) sur un lien : l'ouvrir, dans tous les modes. */
export function linkClicks(open: (href: string) => void): Extension {
  return EditorView.domEventHandlers({
    mousedown(e, view) {
      if (!(e.ctrlKey || e.metaKey) || e.button !== 0) return false
      const marked = (e.target as HTMLElement).closest?.('[data-href]')
      let href = marked?.getAttribute('data-href') ?? null
      if (!href) {
        const pos = view.posAtCoords({ x: e.clientX, y: e.clientY })
        if (pos == null) return false
        for (let n: SyntaxNode | null = syntaxTree(view.state).resolveInner(pos, 1); n; n = n.parent) {
          const url = n.name === 'URL' ? n : n.name === 'Link' || n.name === 'Image' || n.name === 'Autolink' ? n.getChild('URL') : null
          if (url) {
            href = hrefOfBareUrl(view.state.sliceDoc(url.from, url.to).replace(/^<|>$/g, ''))
            break
          }
        }
      }
      if (!href) return false
      e.preventDefault()
      open(href)
      return true
    },
  })
}

export function livePreview(ctx: LiveContext): Extension {
  const field = StateField.define<DecorationSet>({
    create: (state) => build(state, ctx),
    update(deco, tr) {
      if (
        tr.docChanged ||
        tr.selection ||
        tr.effects.some((e) => e.is(refreshLive) || e.is(setWindow)) ||
        syntaxTree(tr.startState) !== syntaxTree(tr.state)
      ) {
        return build(tr.state, ctx)
      }
      return deco
    },
    provide: (f) => EditorView.decorations.from(f),
  })
  return [
    windowField,
    field,
    windowWatcher,
  ]
}
