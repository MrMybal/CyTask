import { extname } from './paths'

export type MediaKind = 'image' | 'video' | 'audio' | 'other'

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.ogv': 'video/ogg',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.json': 'application/json',
  '.zip': 'application/zip',
}

/** Extensions déjà compressées : inutile de les recompresser dans le .cymd. */
export const PRECOMPRESSED = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.mp4', '.m4v', '.webm', '.mov', '.mkv',
  '.mp3', '.ogg', '.oga', '.opus', '.m4a', '.aac', '.flac', '.zip', '.pdf', '.ogv',
])

function cleanPath(src: string): string {
  return src.replace(/^<|>$/g, '').replace(/[?#].*$/, '')
}

export function mimeFromPath(p: string): string {
  return MIME[extname(cleanPath(p))] ?? 'application/octet-stream'
}

export function kindFromMime(mime: string): MediaKind {
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  return 'other'
}

/** Type de média d'après l'extension ; les URLs sans extension connue sont des images. */
export function kindFromPath(p: string): MediaKind {
  const ext = extname(cleanPath(p))
  if (!ext || !MIME[ext]) return 'image'
  return kindFromMime(MIME[ext])
}

export function extFromMime(mime: string): string {
  const m = mime.split(';')[0].trim().toLowerCase()
  if (m === 'image/jpeg') return '.jpg'
  if (m === 'image/svg+xml') return '.svg'
  if (m === 'audio/mpeg') return '.mp3'
  for (const [ext, type] of Object.entries(MIME)) if (type === m) return ext
  return ''
}
