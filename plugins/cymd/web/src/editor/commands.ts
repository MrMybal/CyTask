// Commandes de mise en forme Markdown (Ctrl+B, Ctrl+K, titres, listes…).

import { EditorSelection, type ChangeSpec } from '@codemirror/state'
import { indentLess, indentMore, insertTab } from '@codemirror/commands'
import type { Command, EditorView, KeyBinding } from '@codemirror/view'
import { tr } from '../i18n'

/** Entoure la sélection de `open`…`close`, ou retire ces marques si elles y sont déjà. */
function toggleWrap(open: string, close = open): Command {
  return (view) => {
    const { state } = view
    const a = open.length
    const b = close.length
    view.dispatch(
      state.changeByRange((range) => {
        const before = state.sliceDoc(range.from - a, range.from)
        const after = state.sliceDoc(range.to, range.to + b)
        if (before === open && after === close) {
          return {
            changes: [
              { from: range.from - a, to: range.from },
              { from: range.to, to: range.to + b },
            ],
            range: EditorSelection.range(range.from - a, range.to - a),
          }
        }
        const text = state.sliceDoc(range.from, range.to)
        if (text.length > a + b && text.startsWith(open) && text.endsWith(close)) {
          return {
            changes: { from: range.from, to: range.to, insert: text.slice(a, -b) },
            range: EditorSelection.range(range.from, range.to - a - b),
          }
        }
        return {
          changes: [
            { from: range.from, insert: open },
            { from: range.to, insert: close },
          ],
          range: EditorSelection.range(range.from + a, range.to + a),
        }
      }),
      { userEvent: 'input.format', scrollIntoView: true },
    )
    return true
  }
}

const URL_RE = /^(https?:\/\/|www\.|mailto:)\S+$/i

const insertLink: Command = (view) => {
  const { state } = view
  view.dispatch(
    state.changeByRange((range) => {
      const text = state.sliceDoc(range.from, range.to)
      if (URL_RE.test(text.trim())) {
        const insert = `[](${text.trim()})`
        return { changes: { from: range.from, to: range.to, insert }, range: EditorSelection.cursor(range.from + 1) }
      }
      const insert = `[${text}](https://)`
      const urlStart = range.from + text.length + 3
      return { changes: { from: range.from, to: range.to, insert }, range: EditorSelection.range(urlStart, urlStart + 8) }
    }),
    { userEvent: 'input.format', scrollIntoView: true },
  )
  return true
}

/** Lignes (numéros) couvertes par la sélection. */
function selectedLines(view: EditorView): number[] {
  const lines = new Set<number>()
  for (const r of view.state.selection.ranges) {
    const a = view.state.doc.lineAt(r.from).number
    const b = view.state.doc.lineAt(r.to).number
    for (let i = a; i <= b; i++) lines.add(i)
  }
  return [...lines].sort((x, y) => x - y)
}

/** Titre de niveau `level` (0 = texte normal) ; le même niveau une 2e fois l'enlève. */
function setHeading(level: number): Command {
  return (view) => {
    const changes: ChangeSpec[] = []
    for (const n of selectedLines(view)) {
      const line = view.state.doc.line(n)
      const m = /^(#{1,6})\s+/.exec(line.text)
      const current = m ? m[1].length : 0
      const prefix = current === level || level === 0 ? '' : `${'#'.repeat(level)} `
      changes.push({ from: line.from, to: line.from + (m ? m[0].length : 0), insert: prefix })
    }
    view.dispatch({ changes, userEvent: 'input.format' })
    return true
  }
}

const PREFIXES: Record<string, { re: RegExp; make: (i: number) => string }> = {
  bullet: { re: /^(\s*)[-*+]\s+(?!\[[ xX]\])/, make: () => '- ' },
  ordered: { re: /^(\s*)\d+[.)]\s+/, make: (i) => `${i + 1}. ` },
  task: { re: /^(\s*)[-*+]\s+\[[ xX]\]\s+/, make: () => '- [ ] ' },
  quote: { re: /^(\s*)>\s?/, make: () => '> ' },
}
const ANY_PREFIX = /^(\s*)(?:[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+|>\s?)/

function toggleLinePrefix(kind: keyof typeof PREFIXES): Command {
  return (view) => {
    const lines = selectedLines(view)
    const spec = PREFIXES[kind]
    const doc = view.state.doc
    const all = lines.every((n) => spec.re.test(doc.line(n).text))
    const changes: ChangeSpec[] = []
    lines.forEach((n, i) => {
      const line = doc.line(n)
      if (all) {
        const m = spec.re.exec(line.text)!
        changes.push({ from: line.from + m[1].length, to: line.from + m[0].length })
      } else {
        const m = ANY_PREFIX.exec(line.text)
        const indent = m ? m[1].length : /^\s*/.exec(line.text)![0].length
        changes.push({ from: line.from + indent, to: line.from + (m ? m[0].length : indent), insert: spec.make(i) })
      }
    })
    view.dispatch({ changes, userEvent: 'input.format' })
    return true
  }
}

function insertBlock(text: string, cursorOffset?: number): Command {
  return (view) => {
    const { state } = view
    const r = state.selection.main
    const line = state.doc.lineAt(r.from)
    const selected = state.sliceDoc(r.from, r.to)
    const body = text.replace('$SEL', selected)
    const needBefore = r.from > line.from ? '\n\n' : line.number > 1 && state.doc.line(line.number - 1).text.trim() ? '\n' : ''
    const insert = `${needBefore}${body}\n`
    const anchor = r.from + needBefore.length + (cursorOffset ?? body.length)
    view.dispatch({
      changes: { from: r.from, to: r.to, insert },
      selection: { anchor: Math.min(anchor, r.from + insert.length) },
      userEvent: 'input.format',
      scrollIntoView: true,
    })
    return true
  }
}

export const formatCommands: Record<string, Command> = {
  bold: toggleWrap('**'),
  italic: toggleWrap('*'),
  underline: toggleWrap('<u>', '</u>'),
  strike: toggleWrap('~~'),
  code: toggleWrap('`'),
  spoiler: toggleWrap('||'),
  link: insertLink,
  p: setHeading(0),
  h1: setHeading(1),
  h2: setHeading(2),
  h3: setHeading(3),
  h4: setHeading(4),
  h5: setHeading(5),
  h6: setHeading(6),
  bullet: toggleLinePrefix('bullet'),
  ordered: toggleLinePrefix('ordered'),
  task: toggleLinePrefix('task'),
  quote: toggleLinePrefix('quote'),
  codeblock: insertBlock('```\n$SEL\n```', 3),
  table: (view) => insertBlock(tr('| Colonne 1 | Colonne 2 |\n| --- | --- |\n| | |'), 2)(view),
  hr: insertBlock('---'),
}

const LIST_LINE = /^\s*(?:[-*+]|\d+[.)])\s/

/** Tab : indente les listes et les sélections, sinon insère une tabulation (comme Notepad). */
const smartTab: Command = (view) => {
  const { state } = view
  const r = state.selection.main
  if (!r.empty || LIST_LINE.test(state.doc.lineAt(r.from).text)) return indentMore(view)
  return insertTab(view)
}

export const formatKeymap: KeyBinding[] = [
  { key: 'Mod-b', run: formatCommands.bold },
  { key: 'Mod-i', run: formatCommands.italic },
  { key: 'Mod-u', run: formatCommands.underline },
  { key: 'Mod-Shift-x', run: formatCommands.strike },
  { key: 'Mod-e', run: formatCommands.code },
  { key: 'Mod-k', run: formatCommands.link },
  { key: 'Mod-Shift-1', run: formatCommands.h1 },
  { key: 'Mod-Shift-2', run: formatCommands.h2 },
  { key: 'Mod-Shift-3', run: formatCommands.h3 },
  { key: 'Mod-Shift-8', run: formatCommands.bullet },
  { key: 'Mod-Shift-7', run: formatCommands.ordered },
  { key: 'Mod-Shift-9', run: formatCommands.task },
  { key: 'Mod-Shift-.', run: formatCommands.quote },
  { key: 'Tab', run: smartTab, shift: indentLess },
]
