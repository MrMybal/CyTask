// Extensions de syntaxe Markdown propres à CyMD (sur le modèle de GFM Strikethrough).

import type { MarkdownConfig } from '@lezer/markdown'
import { tags } from '@lezer/highlight'

const SpoilerDelim = { resolve: 'Spoiler', mark: 'SpoilerMark' }

/** Spoiler façon Discord : `||texte caché||`. */
export const Spoiler: MarkdownConfig = {
  defineNodes: [
    { name: 'Spoiler', style: { 'Spoiler/...': tags.special(tags.content) } },
    { name: 'SpoilerMark', style: tags.processingInstruction },
  ],
  parseInline: [
    {
      name: 'Spoiler',
      parse(cx, next, pos) {
        if (next != 124 /* | */ || cx.char(pos + 1) != 124 || cx.char(pos + 2) == 124) return -1
        const before = cx.slice(pos - 1, pos)
        const after = cx.slice(pos + 2, pos + 3)
        const sBefore = /\s|^$/.test(before)
        const sAfter = /\s|^$/.test(after)
        return cx.addDelimiter(SpoilerDelim, pos, pos + 2, !sAfter, !sBefore)
      },
      after: 'Emphasis',
    },
  ],
}
