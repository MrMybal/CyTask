// Utilitaires de chemins compatibles Windows (\) et POSIX (/).

/** Windows ignore la casse ; les chemins POSIX peuvent désigner des fichiers distincts. */
export function sameDocumentPath(a: string, b: string): boolean {
  const windows = /^(?:[a-z]:[\\/]|\\\\)/i.test(a)
  const normalize = (value: string) => windows ? value.replace(/\\/g, '/').toLowerCase() : value
  return normalize(a) === normalize(b)
}

export function dirname(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return i <= 0 ? p.slice(0, i + 1) : p.slice(0, i)
}

export function basename(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return p.slice(i + 1)
}

/** Extension en minuscules, avec le point (".md"), ou "" si aucune. */
export function extname(p: string): string {
  const b = basename(p)
  const i = b.lastIndexOf('.')
  return i > 0 ? b.slice(i).toLowerCase() : ''
}

export function stem(p: string): string {
  const b = basename(p)
  const i = b.lastIndexOf('.')
  return i > 0 ? b.slice(0, i) : b
}

/** Joint un dossier absolu et un chemin relatif "a/b.png" avec le séparateur du dossier. */
export function joinPath(dir: string, rel: string): string {
  const sep = dir.includes('\\') ? '\\' : '/'
  return dir.replace(/[\\/]+$/, '') + sep + rel.split('/').join(sep)
}

function splitAbs(p: string): string[] {
  return p.replace(/\\/g, '/').split('/').filter(Boolean)
}

/**
 * Chemin relatif (séparateurs "/") de `target` par rapport au dossier `dir`,
 * ou null si `target` n'est pas dans `dir` (ou un de ses sous-dossiers).
 */
export function relativeInside(dir: string, target: string): string | null {
  const a = splitAbs(dir)
  const b = splitAbs(target)
  const winLike = /^[a-z]:/i.test(dir) || dir.includes('\\')
  const same = (x: string, y: string) => (winLike ? x.toLowerCase() === y.toLowerCase() : x === y)
  if (b.length <= a.length) return null
  for (let i = 0; i < a.length; i++) if (!same(a[i], b[i])) return null
  return b.slice(a.length).join('/')
}

export function isExternalUrl(src: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(src) && !/^[a-z]:[\\/]/i.test(src)
}

/**
 * Normalise une référence locale d'un document ("./img/a b.png", "img%20x.png"…) en
 * chemin relatif propre ("img/a b.png"). Refuse les URLs, chemins absolus et
 * toute sortie du dossier racine via "..".
 */
export function normalizeRel(src: string): string | null {
  let s = src.trim()
  if (s.startsWith('<') && s.endsWith('>')) s = s.slice(1, -1)
  s = s.replace(/[?#].*$/, '')
  try {
    s = decodeURI(s)
  } catch {
    /* garder tel quel */
  }
  s = s.replace(/\\/g, '/')
  if (!s || s.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(s)) return null
  const parts: string[] = []
  for (const seg of s.split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') {
      if (!parts.length) return null
      parts.pop()
    } else parts.push(seg)
  }
  return parts.length ? parts.join('/') : null
}

/** Écrit une destination de lien Markdown sûre (chevrons si espaces/parenthèses). */
export function mdDestination(path: string): string {
  return /[\s()<>]/.test(path) ? `<${path.replace(/[<>]/g, encodeURIComponent)}>` : path
}

/** Nom de fichier sans caractères problématiques. */
export function safeFileName(name: string): string {
  const cleaned = name
    .normalize('NFC')
    .replace(/[\\/:*?"<>|#%\u0000-\u001f]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.-]+/, '')
  return cleaned.slice(0, 120) || 'fichier'
}
