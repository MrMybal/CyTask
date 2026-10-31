import { tr } from '../i18n'
// Barre d'onglets façon Chrome : clic, clic milieu pour fermer, double-clic sur le vide
// pour un nouvel onglet, glisser pour réordonner, vers une autre fenêtre ou hors de la
// fenêtre (nouvelle fenêtre).

import { icon } from './icons'

export const TAB_MIME = 'application/x-cymd-tab'

export interface TabInfo {
  id: string
  title: string
  tooltip: string
  dirty: boolean
  kind: 'md' | 'cymd'
}

/** Onglet transporté par glisser-déposer : fenêtre d'origine + identifiant. */
export interface TabDragData {
  win: number
  tab: string
}

export interface TabBarEvents {
  activate(id: string): void
  close(id: string): void
  newTab(): void
  reorder(id: string, index: number): void
  contextMenu(id: string, x: number, y: number): void
  /** Onglet venant d'une autre fenêtre déposé ici, à la position `index`. */
  dropForeign(data: TabDragData, index: number): void
  /** Onglet lâché en dehors de toute fenêtre CyMD (coordonnées écran). */
  dragOut(id: string, screenX: number, screenY: number): void
}

export class TabBar {
  readonly el: HTMLElement
  private list: HTMLElement
  private marker: HTMLElement
  private dragId: string | null = null
  private lastScreen = { x: 0, y: 0 }
  windowId = 0

  constructor(private events: TabBarEvents) {
    this.el = document.createElement('div')
    this.el.className = 'tabbar'
    this.list = document.createElement('div')
    this.list.className = 'tabs'
    this.list.setAttribute('role', 'tablist')
    this.marker = document.createElement('div')
    this.marker.className = 'tab-drop-marker'
    const add = document.createElement('button')
    add.className = 'tab-new'
    add.title = tr('Nouvel onglet (Ctrl+T)')
    add.append(icon('plus', 16))
    add.addEventListener('click', () => events.newTab())
    const filler = document.createElement('div')
    filler.className = 'tab-filler'
    filler.addEventListener('dblclick', () => events.newTab())
    this.el.append(this.list, add, filler, this.marker)

    this.el.addEventListener('dragover', (e) => this.onDragOver(e))
    this.el.addEventListener('dragleave', (e) => {
      if (!this.el.contains(e.relatedTarget as Node)) this.marker.classList.remove('show')
    })
    this.el.addEventListener('drop', (e) => this.onDrop(e))
  }

  render(tabs: TabInfo[], activeId: string) {
    this.el.querySelector<HTMLButtonElement>('.tab-new')!.title = tr('Nouvel onglet (Ctrl+T)')
    const existing = new Map<string, HTMLElement>()
    for (const el of this.list.children) existing.set((el as HTMLElement).dataset.id!, el as HTMLElement)
    const els = tabs.map((t) => {
      const el = existing.get(t.id) ?? this.createTab(t.id)
      el.classList.toggle('active', t.id === activeId)
      el.classList.toggle('dirty', t.dirty)
      el.setAttribute('aria-selected', String(t.id === activeId))
      el.title = t.tooltip
      el.querySelector<HTMLButtonElement>('.tab-close')!.title = tr("Fermer l'onglet (Ctrl+W)")
      el.querySelector('.tab-title')!.textContent = t.title
      const badge = el.querySelector('.tab-kind')!
      badge.textContent = t.kind === 'cymd' ? 'CY' : 'MD'
      badge.classList.toggle('cymd', t.kind === 'cymd')
      return el
    })
    this.list.replaceChildren(...els)
    this.list.querySelector('.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }

  private createTab(id: string): HTMLElement {
    const el = document.createElement('div')
    el.className = 'tab'
    el.dataset.id = id
    el.draggable = true
    el.setAttribute('role', 'tab')
    const kind = document.createElement('span')
    kind.className = 'tab-kind'
    const title = document.createElement('span')
    title.className = 'tab-title'
    const dot = document.createElement('span')
    dot.className = 'tab-dirty'
    const close = document.createElement('button')
    close.className = 'tab-close'
    close.title = tr("Fermer l'onglet (Ctrl+W)")
    close.append(icon('close', 14))
    close.addEventListener('mousedown', (e) => e.stopPropagation())
    close.addEventListener('click', (e) => {
      e.stopPropagation()
      this.events.close(id)
    })
    el.append(kind, title, dot, close)

    el.addEventListener('mousedown', (e) => {
      if (e.button === 0) this.events.activate(id)
      if (e.button === 1) e.preventDefault() // pas de défilement automatique
    })
    el.addEventListener('auxclick', (e) => {
      if (e.button === 1) this.events.close(id)
    })
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      this.events.contextMenu(id, e.clientX, e.clientY)
    })
    el.addEventListener('dragstart', (e) => {
      this.dragId = id
      this.lastScreen = { x: e.screenX, y: e.screenY }
      e.dataTransfer!.effectAllowed = 'move'
      e.dataTransfer!.setData(TAB_MIME, JSON.stringify({ win: this.windowId, tab: id } satisfies TabDragData))
      el.classList.add('dragging')
    })
    el.addEventListener('drag', (e) => {
      if (e.screenX || e.screenY) this.lastScreen = { x: e.screenX, y: e.screenY }
    })
    el.addEventListener('dragend', (e) => {
      el.classList.remove('dragging')
      this.marker.classList.remove('show')
      const dragged = this.dragId
      this.dragId = null
      if (!dragged || e.dataTransfer?.dropEffect !== 'none') return
      const x = e.screenX || this.lastScreen.x
      const y = e.screenY || this.lastScreen.y
      const outside =
        x < window.screenX || x > window.screenX + window.outerWidth || y < window.screenY || y > window.screenY + window.outerHeight
      if (outside) this.events.dragOut(dragged, x, y)
    })
    return el
  }

  /** Index d'insertion selon la position horizontale du pointeur. */
  private dropIndex(clientX: number): number {
    const tabs = [...this.list.children] as HTMLElement[]
    for (let i = 0; i < tabs.length; i++) {
      const r = tabs[i].getBoundingClientRect()
      if (clientX < r.left + r.width / 2) return i
    }
    return tabs.length
  }

  private onDragOver(e: DragEvent) {
    if (!e.dataTransfer?.types.includes(TAB_MIME)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const index = this.dropIndex(e.clientX)
    const tabs = [...this.list.children] as HTMLElement[]
    const barLeft = this.el.getBoundingClientRect().left
    const x = index < tabs.length ? tabs[index].getBoundingClientRect().left : (tabs.at(-1)?.getBoundingClientRect().right ?? barLeft)
    this.marker.style.left = `${x - barLeft - 1}px`
    this.marker.classList.add('show')
  }

  private onDrop(e: DragEvent) {
    if (!e.dataTransfer?.types.includes(TAB_MIME)) return
    e.preventDefault()
    e.stopPropagation()
    this.marker.classList.remove('show')
    let data: TabDragData
    try {
      data = JSON.parse(e.dataTransfer.getData(TAB_MIME))
    } catch {
      return
    }
    const index = this.dropIndex(e.clientX)
    if (data.win === this.windowId && this.dragId) this.events.reorder(data.tab, index)
    else this.events.dropForeign(data, index)
  }
}
