import { tr } from '../i18n'
// Carte d'aperçu de lien façon Discord, partagée par l'éditeur Live et la vue rendue.

import type { LinkPreview } from '../doc/document'
import type { LinkPreviews } from './linkPreview'

export interface EmbedDeps {
  previews: LinkPreviews
  /** Résout un média du document (miniatures stockées dans le .cymd). */
  resolve(src: string): string | null
  openExternal(url: string): void
  /** Retire l'aperçu en entourant l'URL de chevrons dans le texte (<url>). */
  suppress?(url: string): void
  onLayout?(): void
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (className) e.className = className
  if (text) e.textContent = text
  return e
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export function renderEmbed(host: HTMLElement, url: string, deps: EmbedDeps): void {
  host.classList.add('cy-embed')
  host.dataset.url = url
  const loading = el('div', 'cy-embed-card cy-embed-loading')
  loading.append(el('div', 'cy-embed-site', hostOf(url)), el('div', 'cy-embed-skeleton'))
  host.replaceChildren(loading)
  deps.previews.get(url).then(
    (p) => fill(host, url, p, deps),
    () => fill(host, url, null, deps),
  )
}

function imageSrc(p: LinkPreview, deps: EmbedDeps): string | null {
  if (!p.image) return null
  return /^[a-z][a-z0-9+.-]*:/i.test(p.image) ? p.image : deps.resolve(p.image)
}

function fill(host: HTMLElement, url: string, p: LinkPreview | null, deps: EmbedDeps) {
  host.replaceChildren()
  host.classList.toggle('cy-embed-empty', !p)
  if (!p) {
    deps.onLayout?.()
    return
  }
  const layout = () => deps.onLayout?.()

  if (p.kind === 'image' || p.kind === 'video') {
    const box = el('div', 'cy-embed-bare')
    if (p.kind === 'image') {
      const img = el('img')
      img.src = imageSrc(p, deps) ?? url
      img.alt = ''
      img.addEventListener('load', layout)
      box.append(img)
    } else {
      const v = el('video')
      v.src = url
      v.controls = true
      v.preload = 'metadata'
      v.addEventListener('loadedmetadata', layout)
      box.append(v)
    }
    box.append(actions(host, url, deps))
    host.append(box)
    layout()
    return
  }

  const card = el('div', 'cy-embed-card')
  if (p.color) card.style.setProperty('--embed-color', p.color)
  const body = el('div', 'cy-embed-body')

  if (p.siteName) {
    const site = el('div', 'cy-embed-site')
    if (p.icon) {
      const icon = el('img', 'cy-embed-icon')
      icon.src = imageSrc({ ...p, image: p.icon }, deps) ?? ''
      icon.alt = ''
      icon.addEventListener('error', () => icon.remove())
      site.append(icon)
    }
    site.append(document.createTextNode(p.siteName))
    body.append(site)
  }

  const title = el('a', 'cy-embed-title', p.title || url)
  title.href = url
  title.title = url
  title.addEventListener('click', (e) => {
    e.preventDefault()
    deps.openExternal(url)
  })
  body.append(title)
  if (p.description) body.append(el('div', 'cy-embed-desc', p.description))

  const src = imageSrc(p, deps)
  if (src && (p.imageLarge || p.kind === 'youtube')) {
    const media = el('div', 'cy-embed-media')
    const img = el('img')
    img.src = src
    img.alt = ''
    img.addEventListener('load', layout)
    img.addEventListener('error', () => {
      media.remove()
      layout()
    })
    media.append(img)
    if (p.kind === 'youtube' && p.videoId) {
      const play = el('button', 'cy-embed-play')
      play.title = tr('Lire la vidéo')
      play.setAttribute('aria-label', tr('Lire la vidéo'))
      media.append(play)
      media.addEventListener('click', (e) => {
        e.preventDefault()
        const frame = el('iframe')
        frame.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(p.videoId!)}?autoplay=1&rel=0`
        frame.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen'
        frame.allowFullscreen = true
        frame.referrerPolicy = 'strict-origin-when-cross-origin'
        media.replaceChildren(frame)
        media.classList.add('playing')
        layout()
      })
    }
    body.append(media)
    card.append(body)
  } else {
    card.append(body)
    if (src) {
      const thumb = el('img', 'cy-embed-thumb')
      thumb.src = src
      thumb.alt = ''
      thumb.addEventListener('load', layout)
      thumb.addEventListener('error', () => thumb.remove())
      card.append(thumb)
    }
  }
  card.append(actions(host, url, deps))
  host.append(card)
  layout()
}

function actions(host: HTMLElement, url: string, deps: EmbedDeps): HTMLElement {
  const bar = el('div', 'cy-embed-actions')
  const refresh = el('button', undefined, '↻')
  refresh.title = tr("Actualiser l'aperçu")
  refresh.addEventListener('click', (e) => {
    e.preventDefault()
    deps.previews.refresh(url).then((p) => fill(host, url, p, deps))
  })
  bar.append(refresh)
  if (deps.suppress) {
    const close = el('button', undefined, '✕')
    close.title = tr("Masquer l'aperçu (entoure l'URL de < >)")
    close.addEventListener('click', (e) => {
      e.preventDefault()
      deps.suppress!(url)
    })
    bar.append(close)
  }
  for (const b of bar.querySelectorAll('button')) b.addEventListener('mousedown', (e) => e.preventDefault())
  return bar
}
