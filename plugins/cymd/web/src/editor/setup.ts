import { Compartment, EditorState, type Extension, type StateEffect } from '@codemirror/state'
import {
  EditorView,
  keymap,
  drawSelection,
  dropCursor,
  highlightSpecialChars,
  rectangularSelection,
  crosshairCursor,
  placeholder,
  lineNumbers,
  highlightActiveLineGutter,
  type ViewUpdate,
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown, markdownKeymap } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { GFM } from '@lezer/markdown'
import { HighlightStyle, indentUnit, syntaxHighlighting } from '@codemirror/language'
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search'
import { tags as t } from '@lezer/highlight'
import { formatKeymap } from './commands'
import { linkClicks, livePreview } from './livePreview'
import { pasteAndDrop, type PasteDeps } from './paste'
import { selectionToolbar } from './selectionToolbar'
import { Spoiler } from './syntax'
import type { LiveContext } from './widgets'
import { getLanguage, tr } from '../i18n'

const highlight = HighlightStyle.define([
  { tag: t.heading, fontWeight: '700', color: 'var(--c-heading)' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through', color: 'var(--c-muted)' },
  { tag: t.link, color: 'var(--c-link)' },
  { tag: t.url, color: 'var(--c-url)' },
  { tag: t.monospace, fontFamily: 'var(--font-mono)' },
  { tag: t.processingInstruction, color: 'var(--c-mark)' },
  { tag: t.quote, color: 'var(--c-quote)' },
  { tag: t.contentSeparator, color: 'var(--c-mark)' },
  { tag: t.labelName, color: 'var(--c-mark)' },
  { tag: t.comment, color: 'var(--c-comment)', fontStyle: 'italic' },
  { tag: t.escape, color: 'var(--c-mark)' },
  { tag: t.atom, color: 'var(--c-accent)' },
  // Code dans les blocs ```lang
  { tag: [t.keyword, t.modifier, t.operatorKeyword, t.controlKeyword, t.definitionKeyword, t.moduleKeyword], color: 'var(--hl-keyword)' },
  { tag: [t.string, t.special(t.string), t.regexp, t.character], color: 'var(--hl-string)' },
  { tag: [t.number, t.bool, t.null, t.unit], color: 'var(--hl-number)' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName], color: 'var(--hl-function)' },
  { tag: [t.typeName, t.className, t.namespace, t.standard(t.name)], color: 'var(--hl-type)' },
  { tag: [t.propertyName, t.attributeName], color: 'var(--hl-property)' },
  { tag: [t.tagName, t.angleBracket], color: 'var(--hl-tag)' },
  { tag: [t.meta, t.annotation], color: 'var(--hl-meta)' },
  { tag: t.invalid, color: 'var(--hl-invalid)' },
])

const frenchPhrases = EditorState.phrases.of({
  Find: 'Rechercher',
  Replace: 'Remplacer',
  next: 'suivant',
  previous: 'précédent',
  all: 'tout',
  'match case': 'respecter la casse',
  'by word': 'mot entier',
  regexp: 'regex',
  replace: 'remplacer',
  'replace all': 'tout remplacer',
  close: 'fermer',
  'current match': 'occurrence actuelle',
  'on line': 'ligne',
  'replaced match on line $': 'occurrence remplacée ligne $',
  'replaced $ matches': '$ occurrences remplacées',
  'Go to line': 'Aller à la ligne',
  go: 'OK',
  'Control character': 'Caractère de contrôle',
})

export interface EditorOptions {
  live: LiveContext
  paste: PasteDeps
  openLink(href: string): void
  onUpdate(update: ViewUpdate): void
  /** Commande de mise en forme lancée depuis la barre flottante. */
  format(cmd: string): void
  extraKeys: Parameters<typeof keymap.of>[0]
}

/**
 * Un seul EditorView pour toute la fenêtre ; chaque onglet garde son propre EditorState
 * (texte, sélection, historique d'annulation) qu'on échange à l'activation.
 */
export class Editor {
  readonly view: EditorView
  private liveComp = new Compartment()
  private gutterComp = new Compartment()
  private languageComp = new Compartment()
  private languageExtensions: Extension = []
  private live = true
  private numbers = false
  private liveOn: Extension
  private liveOff: Extension
  private gutterOn: Extension
  private gutterOff: Extension = []
  private base: Extension[]

  constructor(
    parent: HTMLElement,
    private opts: EditorOptions,
  ) {
    this.liveOn = [livePreview(opts.live), EditorView.editorAttributes.of({ class: 'cm-live' })]
    this.liveOff = EditorView.editorAttributes.of({ class: 'cm-raw' })
    this.gutterOn = [lineNumbers(), highlightActiveLineGutter()]
    this.languageExtensions = this.translations()
    this.base = this.extensions()
    this.view = new EditorView({ parent, state: this.createState('') })
  }

  /** Nouvel état d'éditeur (pour un nouvel onglet). */
  createState(doc: string, selection?: { anchor: number; head?: number }): EditorState {
    return EditorState.create({
      doc,
      selection: selection && selection.anchor <= doc.length && (selection.head ?? 0) <= doc.length ? selection : undefined,
      extensions: [
        EditorView.cspNonce.of(document.querySelector<HTMLMetaElement>('meta[name="cytask-style-nonce"]')?.content ?? ''),
        ...this.base,
        this.liveComp.of(this.live ? this.liveOn : this.liveOff),
        this.gutterComp.of(this.numbers ? this.gutterOn : this.gutterOff),
        this.languageComp.of(this.languageExtensions),
      ],
    })
  }

  /** Affiche l'état d'un onglet, en lui appliquant les réglages d'affichage actuels. */
  setState(state: EditorState, scrollTop = 0) {
    this.view.setState(state)
    const effects: StateEffect<unknown>[] = []
    const live = this.live ? this.liveOn : this.liveOff
    const gutter = this.numbers ? this.gutterOn : this.gutterOff
    if (this.liveComp.get(state) !== live) effects.push(this.liveComp.reconfigure(live))
    if (this.gutterComp.get(state) !== gutter) effects.push(this.gutterComp.reconfigure(gutter))
    if (this.languageComp.get(state) !== this.languageExtensions) effects.push(this.languageComp.reconfigure(this.languageExtensions))
    if (effects.length) this.view.dispatch({ effects })
    this.view.scrollDOM.scrollTop = scrollTop
    if (!scrollTop) this.view.dispatch({ effects: EditorView.scrollIntoView(0, { y: 'start' }) })
    else requestAnimationFrame(() => (this.view.scrollDOM.scrollTop = scrollTop))
  }

  private extensions(): Extension[] {
    return [
      history(),
      drawSelection(),
      dropCursor(),
      highlightSpecialChars(),
      rectangularSelection(),
      crosshairCursor(),
      EditorState.allowMultipleSelections.of(true),
      EditorView.lineWrapping,
      indentUnit.of('    '),
      EditorState.tabSize.of(4),
      markdown({ extensions: [GFM, Spoiler], codeLanguages: languages, addKeymap: false }),
      syntaxHighlighting(highlight),
      search({ top: true }),
      highlightSelectionMatches(),
      EditorView.contentAttributes.of({ spellcheck: 'true', autocorrect: 'on', autocapitalize: 'off' }),
      keymap.of([...this.opts.extraKeys, ...formatKeymap, ...markdownKeymap, ...searchKeymap, ...historyKeymap, ...defaultKeymap]),
      pasteAndDrop(this.opts.paste),
      linkClicks(this.opts.openLink),
      EditorView.updateListener.of((u) => this.opts.onUpdate(u)),
    ]
  }

  setLive(live: boolean) {
    if (live === this.live) return
    this.live = live
    this.view.dispatch({ effects: this.liveComp.reconfigure(live ? this.liveOn : this.liveOff) })
  }

  private translations(): Extension {
    return [
      getLanguage() === 'fr' ? frenchPhrases : EditorState.phrases.of({}),
      placeholder(tr('Écrivez en Markdown… Collez des images, glissez des fichiers, collez des liens.')),
      selectionToolbar((cmd) => this.opts.format(cmd)),
    ]
  }

  setLanguage() {
    this.languageExtensions = this.translations()
    this.view.dispatch({ effects: this.languageComp.reconfigure(this.languageExtensions) })
  }

  setLineNumbers(on: boolean) {
    if (on === this.numbers) return
    this.numbers = on
    this.view.dispatch({ effects: this.gutterComp.reconfigure(on ? this.gutterOn : this.gutterOff) })
  }

  get text(): string {
    return this.view.state.doc.toString()
  }
}
