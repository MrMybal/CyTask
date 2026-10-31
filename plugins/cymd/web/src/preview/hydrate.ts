import { tr } from '../i18n'
// Rend « vivant » le HTML produit par renderMarkdown : médias du document, aperçus
// de liens, cases à cocher cliquables, liens.

import { renderEmbed, type EmbedDeps } from '../embeds/embedCard'

export interface HydrateDeps extends EmbedDeps {
  openLink(href: string): void
  toggleTask?(line: number): void
}

export function brokenMedia(src: string): HTMLElement {
  const span = document.createElement('span')
  span.className = 'cy-broken'
  span.textContent = src
  span.title = tr("Média introuvable : {0}", src)
  return span
}

export function hydrate(root: HTMLElement, deps: HydrateDeps): void {
  for (const node of root.querySelectorAll<HTMLElement>('img[src], video[src], audio[src], source[src], video[poster]')) {
    for (const attr of ['src', 'poster'] as const) {
      const raw = node.getAttribute(attr)
      if (!raw) continue
      const url = deps.resolve(raw)
      if (url) {
        if (url !== raw) node.setAttribute(attr, url)
      } else if (attr === 'src' && node.tagName !== 'SOURCE') {
        node.replaceWith(brokenMedia(raw))
      }
    }
    if (node.isConnected && (node.tagName === 'IMG' || node.tagName === 'VIDEO')) {
      node.addEventListener(node.tagName === 'IMG' ? 'load' : 'loadedmetadata', () => deps.onLayout?.())
      if (node.tagName === 'IMG') {
        node.addEventListener('error', () => {
          const raw = node.getAttribute('src') ?? ''
          if (node.isConnected) node.replaceWith(brokenMedia(raw.startsWith('blob:') || raw.startsWith('cymd:') ? node.getAttribute('alt') || 'image' : raw))
        })
      }
    }
  }

  for (const host of root.querySelectorAll<HTMLElement>('.cy-embed[data-url]')) renderEmbed(host, host.dataset.url!, deps)

  for (const box of root.querySelectorAll<HTMLInputElement>('input.cy-task')) {
    const line = Number(box.dataset.line)
    if (deps.toggleTask && Number.isFinite(line)) {
      box.addEventListener('click', (e) => {
        e.preventDefault()
        deps.toggleTask!(line)
      })
    } else box.disabled = true
  }

  for (const s of root.querySelectorAll<HTMLElement>('.cy-spoiler')) {
    s.addEventListener('click', (e) => {
      if (s.classList.contains('revealed')) return
      e.preventDefault()
      e.stopPropagation()
      s.classList.add('revealed')
    })
  }

  for (const a of root.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    if (a.closest('.cy-embed')) continue
    a.addEventListener('click', (e) => {
      e.preventDefault()
      const href = a.getAttribute('href')!
      if (href.startsWith('#')) {
        const target = root.ownerDocument.getElementById(decodeURIComponent(href.slice(1)))
        target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      } else deps.openLink(href)
    })
    if (!a.title) a.title = a.getAttribute('href')!
  }
}
