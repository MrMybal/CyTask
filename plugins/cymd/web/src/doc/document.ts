import { tr } from '../i18n'
import { basename, dirname, extname, stem } from './paths'

export type DocKind = 'md' | 'cymd'

export interface Asset {
  data: Uint8Array
  mime: string
  /** Pas encore écrit à côté du fichier .md (mode dossier). */
  pending: boolean
}

/** Aperçu de lien, façon Discord. Stocké dans previews.json pour les .cymd. */
export interface LinkPreview {
  url: string
  kind: 'link' | 'image' | 'video' | 'youtube'
  title?: string
  description?: string
  siteName?: string
  color?: string
  /** URL distante, ou chemin d'un média du .cymd (ex. "previews/ab12.jpg"). */
  image?: string
  imageLarge?: boolean
  icon?: string
  videoId?: string
  fetchedAt: number
}

/** Médias du document gardés en mémoire (collés, glissés, ou issus d'un .cymd). */
export class AssetStore {
  private items = new Map<string, Asset>()
  private urls = new Map<string, string>()

  get size(): number {
    return this.items.size
  }

  has(path: string): boolean {
    return this.items.has(path)
  }

  get(path: string): Asset | undefined {
    return this.items.get(path)
  }

  entries(): IterableIterator<[string, Asset]> {
    return this.items.entries()
  }

  set(path: string, data: Uint8Array, mime: string, pending = true): void {
    this.revoke(path)
    this.items.set(path, { data, mime, pending })
  }

  /** Ajoute un média sous un chemin libre (suffixe -2, -3… si besoin) et renvoie ce chemin. */
  add(path: string, data: Uint8Array, mime: string, pending = true, taken?: (p: string) => boolean): string {
    const free = this.freePath(path, taken)
    this.set(free, data, mime, pending)
    return free
  }

  freePath(path: string, taken?: (p: string) => boolean): string {
    const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : ''
    const ext = extname(path)
    const base = stem(path)
    let candidate = path
    for (let i = 2; this.items.has(candidate) || taken?.(candidate); i++) candidate = `${dir}${base}-${i}${ext}`
    return candidate
  }

  rename(from: string, to: string): void {
    const a = this.items.get(from)
    if (!a) return
    this.delete(from)
    this.items.set(to, a)
  }

  delete(path: string): void {
    this.revoke(path)
    this.items.delete(path)
  }

  /** URL blob: affichable pour ce média (créée à la demande, mise en cache). */
  url(path: string): string | null {
    const a = this.items.get(path)
    if (!a) return null
    let u = this.urls.get(path)
    if (!u) {
      u = URL.createObjectURL(new Blob([a.data as BlobPart], { type: a.mime }))
      this.urls.set(path, u)
    }
    return u
  }

  clear(): void {
    for (const u of this.urls.values()) URL.revokeObjectURL(u)
    this.urls.clear()
    this.items.clear()
  }

  private revoke(path: string) {
    const u = this.urls.get(path)
    if (u) URL.revokeObjectURL(u)
    this.urls.delete(path)
  }
}

export class CyDoc {
  kind: DocKind = 'md'
  /** Chemin sur disque (bureau) ; null pour un nouveau document ou en version web. */
  path: string | null = null
  name = 'Sans titre'
  /** Poignée de fichier (File System Access API) en version web. */
  handle: unknown = null
  assets = new AssetStore()
  previews = new Map<string, LinkPreview>()
  eol: '\n' | '\r\n' = '\n'
  bom = false
  encoding = 'UTF-8'
  created: string | null = null

  get dir(): string | null {
    return this.path ? dirname(this.path) : null
  }

  get title(): string {
    return this.path ? basename(this.path) : !this.handle && this.name === 'Sans titre' ? tr('Sans titre') : this.name
  }

  dispose(): void {
    this.assets.clear()
  }
}
