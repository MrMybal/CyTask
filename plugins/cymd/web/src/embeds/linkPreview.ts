// Récupération des aperçus de liens (Open Graph / Twitter Cards / oEmbed YouTube).
// Ordre de recherche : aperçus du document (.cymd) → cache de l'app → réseau.
// Pour un .cymd, la miniature est téléchargée dans le document (lecture hors-ligne).

import type { CyDoc, LinkPreview } from '../doc/document'
import { extFromMime, kindFromMime } from '../doc/media'
import type { Platform } from '../platform/types'

const CACHE_KEY = 'cymd.previewCache'
const CACHE_MAX = 400

function loadCache(): Map<string, LinkPreview> {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    return new Map(raw ? (JSON.parse(raw) as [string, LinkPreview][]) : [])
  } catch {
    return new Map()
  }
}

export function youtubeId(url: string): string | null {
  try {
    const u = new URL(url)
    const host = u.hostname.replace(/^(www\.|m\.|music\.)/, '')
    if (host === 'youtu.be') return u.pathname.slice(1).split('/')[0] || null
    if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      if (u.pathname === '/watch') return u.searchParams.get('v')
      const m = /^\/(?:shorts|embed|live|v)\/([\w-]{6,})/.exec(u.pathname)
      if (m) return m[1]
    }
  } catch {
    /* URL invalide */
  }
  return null
}

function hash(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

function isAssetPath(src: string | undefined): boolean {
  return !!src && !/^[a-z][a-z0-9+.-]*:/i.test(src)
}

export class LinkPreviews {
  private cache = loadCache()
  private inflight = new Map<string, Promise<LinkPreview | null>>()
  private failed = new Set<string>()
  private saveTimer = 0

  constructor(
    private platform: Platform,
    private getDoc: () => CyDoc,
  ) {}

  /** Aperçu déjà connu (sans réseau) ? */
  has(url: string): boolean {
    return this.getDoc().previews.has(url) || this.cache.has(url)
  }

  get(url: string): Promise<LinkPreview | null> {
    const doc = this.getDoc()
    const own = doc.previews.get(url)
    if (own) return Promise.resolve(own)
    const cached = this.cache.get(url)
    if (cached) {
      doc.previews.set(url, cached)
      if (doc.kind === 'cymd') void this.localize(doc, url)
      return Promise.resolve(cached)
    }
    if (this.failed.has(url)) return Promise.resolve(null)
    let p = this.inflight.get(url)
    if (!p) {
      p = this.fetchPreview(url)
        .then((prev) => {
          if (prev) this.remember(prev)
          else this.failed.add(url)
          return prev
        })
        .finally(() => this.inflight.delete(url))
      this.inflight.set(url, p)
    }
    // Rangé dans le document qui l'a demandé (l'onglet actif a pu changer entre-temps).
    return p.then(async (prev) => {
      if (!prev) return null
      if (!doc.previews.has(url)) doc.previews.set(url, prev)
      if (doc.kind === 'cymd') await this.localize(doc, url)
      return doc.previews.get(url) ?? prev
    })
  }

  /** Oublie l'aperçu et le récupère à nouveau. */
  refresh(url: string): Promise<LinkPreview | null> {
    const doc = this.getDoc()
    const old = doc.previews.get(url)
    if (old?.image && isAssetPath(old.image)) doc.assets.delete(old.image)
    doc.previews.delete(url)
    this.cache.delete(url)
    this.failed.delete(url)
    return this.get(url)
  }

  /**
   * Télécharge la miniature d'un aperçu dans les médias du document (.cymd) pour
   * qu'il s'affiche sans connexion.
   */
  async localize(doc: CyDoc, url: string): Promise<void> {
    const prev = doc.previews.get(url)
    if (!prev?.image || isAssetPath(prev.image)) return
    const bin = await this.platform.fetchBinary(prev.image)
    if (!bin || kindFromMime(bin.contentType) !== 'image') return
    const path = `previews/${hash(url)}${extFromMime(bin.contentType) || '.img'}`
    doc.assets.set(path, bin.data, bin.contentType.split(';')[0], false)
    doc.previews.set(url, { ...prev, image: path })
  }

  /** Localise toutes les miniatures (avant d'enregistrer en .cymd). */
  async localizeAll(doc: CyDoc, urls: string[]): Promise<void> {
    await Promise.all(urls.map((u) => this.localize(doc, u).catch(() => {})))
  }

  private remember(prev: LinkPreview) {
    this.cache.delete(prev.url)
    this.cache.set(prev.url, prev)
    while (this.cache.size > CACHE_MAX) this.cache.delete(this.cache.keys().next().value!)
    clearTimeout(this.saveTimer)
    this.saveTimer = window.setTimeout(() => {
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify([...this.cache]))
      } catch {
        /* stockage plein ou indisponible */
      }
    }, 500)
  }

  private async fetchPreview(url: string): Promise<LinkPreview | null> {
    const now = Date.now()
    const yt = youtubeId(url)
    if (yt) {
      const base: LinkPreview = {
        url,
        kind: 'youtube',
        siteName: 'YouTube',
        color: '#ff0033',
        videoId: yt,
        image: `https://i.ytimg.com/vi/${yt}/hqdefault.jpg`,
        imageLarge: true,
        fetchedAt: now,
      }
      const r = await this.platform.fetchText(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`)
      if (r?.text) {
        try {
          const j = JSON.parse(r.text) as { title?: string; author_name?: string }
          return { ...base, title: j.title, description: j.author_name }
        } catch {
          /* on garde l'aperçu minimal */
        }
      }
      return base
    }

    const r = await this.platform.fetchText(url)
    if (!r || r.status >= 400) return null
    const type = r.contentType.split(';')[0].trim().toLowerCase()
    if (type.startsWith('image/')) return { url, kind: 'image', image: url, imageLarge: true, fetchedAt: now }
    if (type.startsWith('video/')) return { url, kind: 'video', fetchedAt: now }
    if (!r.text) return null
    return parseHtmlPreview(url, r.url || url, r.text, now)
  }
}

export function parseHtmlPreview(url: string, finalUrl: string, html: string, now = Date.now()): LinkPreview | null {
  // DOMParser crée un document inerte : aucun script exécuté, aucune ressource chargée.
  const d = new DOMParser().parseFromString(html, 'text/html')
  const meta = (...names: string[]) => {
    for (const n of names) {
      const v = d.querySelector(`meta[property="${n}"], meta[name="${n}"]`)?.getAttribute('content')?.trim()
      if (v) return v
    }
    return undefined
  }
  const abs = (u: string | undefined | null) => {
    if (!u) return undefined
    try {
      return new URL(u, finalUrl).toString()
    } catch {
      return undefined
    }
  }
  const host = (() => {
    try {
      return new URL(finalUrl).hostname.replace(/^www\./, '')
    } catch {
      return undefined
    }
  })()

  const title = meta('og:title', 'twitter:title') ?? d.title?.trim()
  const description = meta('og:description', 'twitter:description', 'description')
  const image = abs(meta('og:image:secure_url', 'og:image', 'og:image:url', 'twitter:image', 'twitter:image:src'))
  if (!title && !description && !image) return null

  const card = meta('twitter:card')
  const w = Number(meta('og:image:width') ?? 0)
  const h = Number(meta('og:image:height') ?? 0)
  const imageLarge = card === 'summary_large_image' || (w >= 600 && (!h || w > h * 1.3))
  const iconHref = d.querySelector('link[rel~="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]')?.getAttribute('href')

  return {
    url,
    kind: 'link',
    title: title?.slice(0, 300),
    description: description && description.length > 350 ? `${description.slice(0, 347)}…` : description,
    siteName: meta('og:site_name', 'application-name') ?? host,
    color: meta('theme-color'),
    image,
    imageLarge,
    icon: abs(iconHref) ?? abs('/favicon.ico'),
    fetchedAt: now,
  }
}
