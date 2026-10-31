import { tr } from '../i18n'
// Rendu Markdown → HTML (vues Côte à côte / Lecture, tableaux du mode Live, export).
// Même conventions que l'éditeur : retours à la ligne conservés, GFM, cases à cocher,
// images/vidéos/audio, et aperçu (embed) sous chaque URL « nue », comme Discord.

import MarkdownIt, { type StateCore, type Token } from 'markdown-it'
import hljs from 'highlight.js/lib/common'
import DOMPurify from 'dompurify'
import { kindFromPath } from '../doc/media'
import { normalizeRel } from '../doc/paths'

const md = new MarkdownIt({
  html: true,
  linkify: true,
  breaks: true,
  typographer: false,
  highlight(code, lang) {
    const language = lang.trim().split(/\s+/)[0]
    if (language && hljs.getLanguage(language)) {
      try {
        return hljs.highlight(code, { language, ignoreIllegals: true }).value
      } catch {
        /* rendu sans coloration */
      }
    }
    return ''
  },
})
md.linkify.set({ fuzzyLink: false })

const esc = (s: string) => md.utils.escapeHtml(s)

/** "texte|300" → { alt: "texte", width: 300 } (taille d'image façon Obsidian). */
export function parseAltSize(alt: string): { alt: string; width?: number; height?: number } {
  const m = /^(.*?)\|\s*(\d+)(?:\s*x\s*(\d+))?\s*$/.exec(alt)
  if (!m) return { alt }
  return { alt: m[1].trim(), width: +m[2], height: m[3] ? +m[3] : undefined }
}

// La règle « texte » de markdown-it avale tout jusqu'au prochain caractère spécial ;
// on ajoute « | » à cette liste pour que la règle du spoiler puisse s'y déclencher.
const TERMINATORS = new Set([0x0a, 0x21, 0x23, 0x24, 0x25, 0x26, 0x2a, 0x2b, 0x2d, 0x3a, 0x3c, 0x3d, 0x40, 0x5b, 0x5c, 0x5d, 0x5e, 0x5f, 0x60, 0x7b, 0x7c, 0x7d, 0x7e])
md.inline.ruler.at('text', (state, silent) => {
  let pos = state.pos
  while (pos < state.posMax && !TERMINATORS.has(state.src.charCodeAt(pos))) pos++
  if (pos === state.pos) return false
  if (!silent) state.pending += state.src.slice(state.pos, pos)
  state.pos = pos
  return true
})

// Spoiler façon Discord : ||texte caché|| (cliquer pour révéler).
md.inline.ruler.before('emphasis', 'cy_spoiler', (state, silent) => {
  const start = state.pos
  const src = state.src
  if (src.charCodeAt(start) !== 0x7c || src.charCodeAt(start + 1) !== 0x7c || src.charCodeAt(start + 2) === 0x7c) return false
  const end = src.indexOf('||', start + 2)
  if (end < 0 || end > state.posMax - 2 || !src.slice(start + 2, end).trim()) return false
  if (!silent) {
    const open = state.push('spoiler_open', 'span', 1)
    open.attrSet('class', 'cy-spoiler')
    open.attrSet('title', tr('Spoiler : cliquer pour afficher'))
    const max = state.posMax
    state.pos = start + 2
    state.posMax = end
    state.md.inline.tokenize(state)
    state.posMax = max
    state.push('spoiler_close', 'span', -1)
  }
  state.pos = end + 2
  return true
})

// Numéros de ligne source sur les blocs, pour synchroniser le défilement.
md.core.ruler.push('cy_lines', (state: StateCore) => {
  for (const t of state.tokens) if (t.block && t.map && t.nesting >= 0) t.attrSet('data-line', String(t.map[0]))
})

// Identifiants de titres pour les ancres (#mon-titre).
md.core.ruler.push('cy_heading_ids', (state: StateCore) => {
  const seen = new Map<string, number>()
  const toks = state.tokens
  for (let i = 0; i < toks.length; i++) {
    if (toks[i].type !== 'heading_open') continue
    const text = toks[i + 1]?.content ?? ''
    let slug = slugify(text)
    const n = seen.get(slug) ?? 0
    seen.set(slug, n + 1)
    if (n) slug += `-${n}`
    toks[i].attrSet('id', slug)
  }
})

export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .trim()
      .replace(/[^\p{L}\p{N}\s_-]/gu, '')
      .replace(/\s+/g, '-') || 'section'
  )
}

// Listes de tâches GFM : "- [ ] tâche" / "- [x] faite".
md.core.ruler.after('inline', 'cy_tasks', (state: StateCore) => {
  const toks = state.tokens
  for (let i = 2; i < toks.length; i++) {
    const t = toks[i]
    if (t.type !== 'inline' || toks[i - 1].type !== 'paragraph_open' || toks[i - 2].type !== 'list_item_open') continue
    const m = /^\[([ xX])\](?=\s|$)\s?/.exec(t.content)
    const first = t.children?.[0]
    if (!m || !first || first.type !== 'text' || !first.content.startsWith(m[0].trimEnd())) continue
    first.content = first.content.slice(m[0].length).replace(/^\s/, '')
    const checked = m[1] !== ' '
    const item = toks[i - 2]
    const box = new state.Token('html_inline', '', 0)
    box.content = `<input type="checkbox" class="cy-task" data-line="${item.map?.[0] ?? ''}"${checked ? ' checked' : ''}>`
    t.children!.unshift(box)
    item.attrJoin('class', checked ? 'cy-task-item done' : 'cy-task-item')
    for (let j = i - 3; j >= 0; j--) {
      if ((toks[j].type === 'bullet_list_open' || toks[j].type === 'ordered_list_open') && toks[j].level === item.level - 1) {
        if (!String(toks[j].attrGet('class') ?? '').includes('cy-task-list')) toks[j].attrJoin('class', 'cy-task-list')
        break
      }
    }
  }
})

// Aperçus de liens : un bloc .cy-embed après chaque paragraphe contenant une URL nue.
// Comme sur Discord, <https://…> (entre chevrons) n'affiche pas d'aperçu.
md.core.ruler.push('cy_embeds', (state: StateCore) => {
  const out: Token[] = []
  let inParagraph = false
  let urls: string[] = []
  for (const t of state.tokens) {
    out.push(t)
    if (t.type === 'paragraph_open') {
      inParagraph = true
      urls = []
    } else if (t.type === 'inline' && inParagraph && t.children) {
      for (const c of t.children) {
        if (c.type !== 'link_open' || c.markup !== 'linkify') continue
        const href = String(c.attrGet('href') ?? '')
        if (/^https?:\/\//i.test(href) && !urls.includes(href)) urls.push(href)
      }
    } else if (t.type === 'paragraph_close') {
      inParagraph = false
      for (const u of urls.slice(0, 5)) {
        const e = new state.Token('html_block', '', 0)
        e.content = `<div class="cy-embed" data-url="${esc(u)}"></div>\n`
        out.push(e)
      }
      urls = []
    }
  }
  state.tokens = out
})

// Images : vidéo / audio selon l'extension, taille optionnelle "![alt|300](…)".
md.renderer.rules.image = (tokens, idx, options, env, self) => {
  const t = tokens[idx]
  const src = String(t.attrGet('src') ?? '')
  const { alt, width, height } = parseAltSize(self.renderInlineAsText(t.children ?? [], options, env))
  const size = `${width ? ` width="${width}"` : ''}${height ? ` height="${height}"` : ''}`
  const kind = kindFromPath(src)
  if (kind === 'video') return `<video class="cy-media" controls preload="metadata" src="${esc(src)}" title="${esc(alt)}"${size}></video>`
  if (kind === 'audio') return `<audio class="cy-media" controls preload="metadata" src="${esc(src)}" title="${esc(alt)}"></audio>`
  const title = t.attrGet('title')
  return `<img src="${esc(src)}" alt="${esc(alt)}"${title ? ` title="${esc(String(title))}"` : ''}${size} loading="lazy">`
}

const PURIFY_CONFIG = {
  ADD_TAGS: ['video', 'audio', 'source'],
  ADD_ATTR: ['controls', 'preload', 'loading', 'checked', 'data-line', 'data-url'],
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|blob|cymd):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
  FORBID_TAGS: ['style', 'form', 'button', 'textarea', 'select'],
}

export function renderMarkdown(src: string): string {
  return DOMPurify.sanitize(md.render(src), PURIFY_CONFIG) as string
}

/**
 * Chemins locaux référencés par le document (images, médias, liens vers des fichiers),
 * normalisés. Sert à regrouper les fichiers dans un .cymd ou à les recopier.
 */
export function collectLocalRefs(src: string): string[] {
  const refs = new Set<string>()
  const add = (raw: string, isLink: boolean) => {
    const rel = normalizeRel(raw)
    if (!rel || !/\.[a-z0-9]+$/i.test(rel)) return
    if (isLink && /\.(md|markdown|cymd|html?)$/i.test(rel)) return
    refs.add(rel)
  }
  const walk = (tokens: Token[]) => {
    for (const t of tokens) {
      if (t.type === 'image') add(String(t.attrGet('src') ?? ''), false)
      else if (t.type === 'link_open') add(String(t.attrGet('href') ?? ''), true)
      else if (t.type === 'html_block' || t.type === 'html_inline') {
        for (const m of t.content.matchAll(/\s(?:src|poster)\s*=\s*["']([^"']+)["']/gi)) add(m[1], false)
      }
      if (t.children) walk(t.children)
    }
  }
  walk(md.parse(src, {}))
  return [...refs]
}
