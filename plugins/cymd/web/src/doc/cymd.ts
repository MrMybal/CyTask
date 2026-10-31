import { tr } from '../i18n'
// Format .cymd : archive ZIP contenant le document et ses ressources.
//
//   mimetype        "application/x-cymd" (non compressé, en premier)
//   manifest.json   { format, version, main, created, modified, generator }
//   document.md     le texte Markdown
//   previews.json   aperçus de liens { [url]: LinkPreview }
//   assets/…        images, vidéos, fichiers collés ou glissés
//   previews/…      miniatures des aperçus de liens (pour la lecture hors-ligne)
//
// Le Markdown reste accessible avec un lecteur ZIP standard.

import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate'
import type { LinkPreview } from './document'
import { mimeFromPath, PRECOMPRESSED } from './media'
import { extname } from './paths'

export const CYMD_MIME = 'application/x-cymd'
export const CYMD_MAIN = 'document.md'
const RESERVED = new Set(['mimetype', 'manifest.json', 'previews.json', CYMD_MAIN])

export interface CymdContent {
  text: string
  assets: Map<string, { data: Uint8Array; mime: string }>
  previews: Record<string, LinkPreview>
  created: string | null
}

export function isZip(data: Uint8Array): boolean {
  return data.length > 4 && data[0] === 0x50 && data[1] === 0x4b && data[2] === 0x03 && data[3] === 0x04
}

export function unpackCymd(data: Uint8Array): CymdContent {
  const files = unzipSync(data)
  let manifest: { main?: string; created?: string } = {}
  if (files['manifest.json']) {
    try {
      manifest = JSON.parse(strFromU8(files['manifest.json']))
    } catch {
      /* manifeste illisible : on continue avec les valeurs par défaut */
    }
  }
  const main =
    (manifest.main && files[manifest.main] ? manifest.main : undefined) ??
    (files[CYMD_MAIN] ? CYMD_MAIN : undefined) ??
    Object.keys(files).find((n) => /^[^/]+\.(md|markdown)$/i.test(n))
  if (!main) throw new Error(tr('Archive .cymd invalide : aucun document Markdown trouvé.'))

  let previews: Record<string, LinkPreview> = {}
  if (files['previews.json']) {
    try {
      previews = JSON.parse(strFromU8(files['previews.json']))
    } catch {
      previews = {}
    }
  }

  const assets = new Map<string, { data: Uint8Array; mime: string }>()
  for (const [name, bytes] of Object.entries(files)) {
    if (name.endsWith('/') || name === main || RESERVED.has(name)) continue
    assets.set(name, { data: bytes, mime: mimeFromPath(name) })
  }

  return { text: strFromU8(files[main]).replace(/^﻿/, ''), assets, previews, created: manifest.created ?? null }
}

export function packCymd(
  text: string,
  assets: Iterable<[string, { data: Uint8Array }]>,
  previews: Record<string, LinkPreview>,
  created: string | null,
): Uint8Array {
  const now = new Date()
  const files: Zippable = {
    mimetype: [strToU8(CYMD_MIME), { level: 0 }],
    'manifest.json': strToU8(
      JSON.stringify(
        {
          format: 'cymd',
          version: 1,
          main: CYMD_MAIN,
          generator: 'CyMD',
          created: created ?? now.toISOString(),
          modified: now.toISOString(),
        },
        null,
        2,
      ),
    ),
    [CYMD_MAIN]: strToU8(text),
  }
  if (Object.keys(previews).length) files['previews.json'] = strToU8(JSON.stringify(previews, null, 2))
  for (const [path, asset] of assets) {
    if (RESERVED.has(path)) continue
    files[path] = [asset.data, { level: PRECOMPRESSED.has(extname(path)) ? 0 : 6 }]
  }
  return zipSync(files, { level: 6, mtime: now })
}
