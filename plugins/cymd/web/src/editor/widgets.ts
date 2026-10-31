import { tr } from '../i18n'
// Widgets du mode Live : rendu des médias et des blocs à la place de leur syntaxe.

import { EditorView, WidgetType } from '@codemirror/view'
import type { MediaKind } from '../doc/media'
import { parseAltSize } from '../preview/render'
import { brokenMedia } from '../preview/hydrate'

export interface LiveContext {
  /** Résout une source de média (chemin relatif, URL…) en URL affichable. */
  resolve(src: string): string | null
  /** Change quand le document change d'emplacement (force le rafraîchissement des médias). */
  generation(): number
  renderEmbed(host: HTMLElement, url: string, onLayout: () => void): void
  hasPreview(url: string): boolean
  renderBlock(source: string): string
  hydrateBlock(el: HTMLElement, onLayout: () => void): void
  openLink(href: string): void
}

export class MediaWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string,
    readonly kind: MediaKind,
    readonly block: boolean,
    readonly ctx: LiveContext,
    readonly gen: number,
  ) {
    super()
  }

  eq(o: MediaWidget) {
    return o.src === this.src && o.alt === this.alt && o.kind === this.kind && o.block === this.block && o.gen === this.gen
  }

  toDOM(view: EditorView) {
    const wrap = document.createElement(this.block ? 'div' : 'span')
    wrap.className = this.block ? 'cm-lp-media cm-lp-media-block' : 'cm-lp-media'
    const url = this.ctx.resolve(this.src)
    const measure = () => view.requestMeasure()
    if (!url) {
      wrap.append(brokenMedia(this.src))
      return wrap
    }
    const { alt, width, height } = parseAltSize(this.alt)
    if (this.kind === 'video' || this.kind === 'audio') {
      const m = document.createElement(this.kind)
      m.controls = true
      m.preload = 'metadata'
      m.src = url
      if (width) m.style.width = `${width}px`
      m.addEventListener('loadedmetadata', measure)
      wrap.append(m)
    } else {
      const img = document.createElement('img')
      img.src = url
      img.alt = alt
      img.title = alt || this.src
      if (width) img.width = width
      if (height) img.height = height
      img.addEventListener('load', measure)
      img.addEventListener('error', () => {
        img.replaceWith(brokenMedia(this.src))
        measure()
      })
      wrap.append(img)
    }
    return wrap
  }

  // Les contrôles vidéo/audio doivent rester utilisables ; un clic sur une image
  // place le curseur (et révèle la syntaxe).
  ignoreEvent() {
    return this.kind === 'video' || this.kind === 'audio'
  }

  get estimatedHeight() {
    return this.block ? 240 : -1
  }
}

export class EmbedWidget extends WidgetType {
  constructor(
    readonly url: string,
    readonly ctx: LiveContext,
    readonly gen: number,
  ) {
    super()
  }

  eq(o: EmbedWidget) {
    return o.url === this.url && o.gen === this.gen
  }

  toDOM(view: EditorView) {
    const host = document.createElement('div')
    host.className = 'cm-lp-embed'
    this.ctx.renderEmbed(host, this.url, () => view.requestMeasure())
    return host
  }

  ignoreEvent() {
    return true
  }

  get estimatedHeight() {
    return 110
  }
}

export class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super()
  }

  eq(o: CheckboxWidget) {
    return o.checked === this.checked
  }

  toDOM(view: EditorView) {
    const wrap = document.createElement('span')
    wrap.className = 'cm-lp-task'
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.checked = this.checked
    box.addEventListener('mousedown', (e) => e.preventDefault())
    box.addEventListener('click', (e) => {
      e.preventDefault()
      const pos = view.posAtDOM(wrap)
      if (!/^\[[ xX]\]$/.test(view.state.doc.sliceString(pos, pos + 3))) return
      view.dispatch({ changes: { from: pos + 1, to: pos + 2, insert: this.checked ? ' ' : 'x' }, userEvent: 'input.toggle' })
    })
    wrap.append(box)
    return wrap
  }

  ignoreEvent() {
    return true
  }
}

const BULLETS = ['•', '◦', '▪']

export class BulletWidget extends WidgetType {
  constructor(readonly depth: number) {
    super()
  }

  eq(o: BulletWidget) {
    return o.depth === this.depth
  }

  toDOM() {
    const s = document.createElement('span')
    s.className = 'cm-lp-bullet'
    s.textContent = BULLETS[this.depth % BULLETS.length]
    return s
  }
}

export class HrWidget extends WidgetType {
  eq() {
    return true
  }

  toDOM() {
    const s = document.createElement('span')
    s.className = 'cm-lp-hr'
    return s
  }
}

export class FenceWidget extends WidgetType {
  constructor(
    readonly lang: string,
    readonly code: string,
  ) {
    super()
  }

  eq(o: FenceWidget) {
    return o.lang === this.lang && o.code === this.code
  }

  toDOM() {
    const s = document.createElement('span')
    s.className = 'cm-lp-fence'
    const label = document.createElement('span')
    label.className = 'cm-lp-fence-lang'
    label.textContent = this.lang
    const btn = document.createElement('button')
    btn.className = 'cm-lp-copy'
    btn.textContent = tr('Copier')
    btn.title = tr('Copier le code')
    btn.addEventListener('mousedown', (e) => e.preventDefault())
    btn.addEventListener('click', async (e) => {
      e.preventDefault()
      try {
        await navigator.clipboard.writeText(this.code)
        btn.textContent = tr('Copié !')
      } catch {
        btn.textContent = tr('Échec')
      }
      setTimeout(() => (btn.textContent = tr('Copier')), 1200)
    })
    s.append(label, btn)
    return s
  }

  ignoreEvent(e: Event) {
    return e.target instanceof HTMLButtonElement
  }
}

/** Bloc rendu sélectionnable ; sa syntaxe reste réservée aux modes source. */
export class RenderedBlockWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly variant: 'table' | 'html',
    readonly ctx: LiveContext,
    readonly gen: number,
  ) {
    super()
  }

  eq(o: RenderedBlockWidget) {
    return o.source === this.source && o.gen === this.gen
  }

  toDOM(view: EditorView) {
    const el = document.createElement('div')
    el.className = `cm-lp-block cm-lp-${this.variant} markdown-body`
    el.innerHTML = this.ctx.renderBlock(this.source)
    this.ctx.hydrateBlock(el, () => view.requestMeasure())
    return el
  }

  ignoreEvent() {
    return true
  }

  get estimatedHeight() {
    return 120
  }
}
