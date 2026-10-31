import { tr, getLanguage, setLanguage, type Language } from '../i18n'
// Barre d'outils : fichiers, mise en forme, numéros de ligne et mode d'affichage.

import { icon, type IconName } from './icons'
import { showMenu } from './menu'

export type ViewMode = 'live' | 'split' | 'raw' | 'read'

export const MODES: { id: ViewMode; label: string; hint: string }[] = [
  { id: 'live', label: 'Live', hint: 'Rendu en direct (Ctrl+1)' },
  { id: 'split', label: 'Côte à côte', hint: 'Brut + aperçu (Ctrl+2)' },
  { id: 'raw', label: 'Brut', hint: 'Markdown brut (Ctrl+3)' },
  { id: 'read', label: 'Lecture', hint: 'Lecture seule (Ctrl+4)' },
]

type Run = (cmd: string, arg?: string) => void

interface Btn {
  icon: IconName
  title: string
  cmd: string
  arg?: string
}

const FILE: Btn[] = [
  { icon: 'new', title: 'Nouveau (Ctrl+N)', cmd: 'new' },
  { icon: 'open', title: 'Ouvrir (Ctrl+O)', cmd: 'open' },
  { icon: 'save', title: 'Enregistrer (Ctrl+S)', cmd: 'save' },
  { icon: 'saveAs', title: 'Enregistrer sous (Ctrl+Shift+S)', cmd: 'save-as' },
]

const FORMAT: (Btn | '|' | 'heading')[] = [
  { icon: 'bold', title: 'Gras (Ctrl+B)', cmd: 'format', arg: 'bold' },
  { icon: 'italic', title: 'Italique (Ctrl+I)', cmd: 'format', arg: 'italic' },
  { icon: 'underline', title: 'Souligné (Ctrl+U)', cmd: 'format', arg: 'underline' },
  { icon: 'strike', title: 'Barré (Ctrl+Shift+X)', cmd: 'format', arg: 'strike' },
  '|',
  'heading',
  { icon: 'quote', title: 'Citation (Ctrl+Shift+.)', cmd: 'format', arg: 'quote' },
  { icon: 'code', title: 'Code (Ctrl+E)', cmd: 'format', arg: 'code' },
  { icon: 'spoiler', title: 'Spoiler ||texte|| (comme sur Discord)', cmd: 'format', arg: 'spoiler' },
  { icon: 'link', title: 'Lien (Ctrl+K)', cmd: 'format', arg: 'link' },
  '|',
  { icon: 'bullet', title: 'Liste à puces (Ctrl+Shift+8)', cmd: 'format', arg: 'bullet' },
  { icon: 'ordered', title: 'Liste numérotée (Ctrl+Shift+7)', cmd: 'format', arg: 'ordered' },
  { icon: 'task', title: 'Cases à cocher (Ctrl+Shift+9)', cmd: 'format', arg: 'task' },
  '|',
  { icon: 'image', title: 'Insérer une image ou une vidéo', cmd: 'insert-media' },
  { icon: 'codeblock', title: 'Bloc de code', cmd: 'format', arg: 'codeblock' },
  { icon: 'table', title: 'Tableau', cmd: 'format', arg: 'table' },
  { icon: 'hr', title: 'Ligne horizontale', cmd: 'format', arg: 'hr' },
]

const HEADINGS = [
  { arg: 'p', label: 'Texte normal', cls: '' },
  { arg: 'h1', label: 'Titre 1', hint: 'Ctrl+Shift+1', cls: 'menu-h1' },
  { arg: 'h2', label: 'Titre 2', hint: 'Ctrl+Shift+2', cls: 'menu-h2' },
  { arg: 'h3', label: 'Titre 3', hint: 'Ctrl+Shift+3', cls: 'menu-h3' },
  { arg: 'h4', label: 'Titre 4', cls: 'menu-h4' },
  { arg: 'h5', label: 'Titre 5', cls: 'menu-h5' },
  { arg: 'h6', label: 'Titre 6', cls: 'menu-h6' },
]

function button(b: Btn, run: Run): HTMLButtonElement {
  const el = document.createElement('button')
  el.type = 'button'
  el.className = 'tb'
  el.title = tr(b.title)
  el.setAttribute('aria-label', tr(b.title))
  el.append(icon(b.icon))
  // Ne pas voler le focus à l'éditeur : la sélection reste intacte.
  el.addEventListener('mousedown', (e) => e.preventDefault())
  el.addEventListener('click', () => run(b.cmd, b.arg))
  return el
}

function sep(): HTMLElement {
  return Object.assign(document.createElement('span'), { className: 'tb-sep' })
}

export class Toolbar {
  readonly el: HTMLElement
  private modeButtons = new Map<ViewMode, HTMLButtonElement>()
  private numbersBtn: HTMLButtonElement
  private formatGroup: HTMLElement

  constructor(run: Run) {
    this.el = document.createElement('div')
    this.el.className = 'toolbar'
    this.el.setAttribute('role', 'toolbar')

    const scroll = document.createElement('div')
    scroll.className = 'tb-scroll'
    const files = document.createElement('div')
    files.className = 'tb-group'
    for (const b of FILE) files.append(button(b, run))

    this.formatGroup = document.createElement('div')
    this.formatGroup.className = 'tb-group tb-format'
    for (const b of FORMAT) {
      if (b === '|') this.formatGroup.append(sep())
      else if (b === 'heading') {
        const h = document.createElement('button')
        h.type = 'button'
        h.className = 'tb tb-drop'
        h.title = tr('Titre')
        h.setAttribute('aria-label', tr('Titre'))
        h.append(icon('heading'), icon('chevron', 13))
        h.addEventListener('mousedown', (e) => e.preventDefault())
        h.addEventListener('click', () =>
          showMenu(
            HEADINGS.map((it) => ({ label: tr(it.label), hint: it.hint, className: it.cls, action: () => run('format', it.arg) })),
            h,
          ),
        )
        this.formatGroup.append(h)
      } else this.formatGroup.append(button(b, run))
    }
    scroll.append(files, sep(), this.formatGroup)

    const right = document.createElement('div')
    right.className = 'tb-right'
    this.numbersBtn = button({ icon: 'lineNumbers', title: tr('Numéros de ligne'), cmd: 'toggle-line-numbers' }, run)
    this.numbersBtn.classList.add('tb-toggle')
    const modes = document.createElement('div')
    modes.className = 'modes'
    modes.setAttribute('role', 'group')
    modes.setAttribute('aria-label', tr("Mode d'affichage"))
    for (const m of MODES) {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'mode-btn'
      b.textContent = tr(m.label)
      b.title = tr(m.hint)
      b.addEventListener('click', () => run('mode', m.id))
      modes.append(b)
      this.modeButtons.set(m.id, b)
    }
    const language = document.createElement('select')
    language.className = 'language-select'
    language.setAttribute('aria-label', tr('Langue'))
    language.title = tr('Langue')
    language.append(new Option('Français', 'fr'), new Option('English', 'en'))
    language.value = getLanguage()
    language.addEventListener('change', () => {
      void setLanguage(language.value as Language).catch((error) => {
        language.value = getLanguage()
        window.alert(String(error.message))
      })
    })
    right.append(language, this.numbersBtn, modes)
    this.el.append(scroll, right)
  }

  setMode(mode: ViewMode) {
    for (const [id, b] of this.modeButtons) b.setAttribute('aria-pressed', String(id === mode))
    this.formatGroup.classList.toggle('disabled', mode === 'read')
    this.numbersBtn.classList.toggle('disabled', mode === 'read')
  }

  setLineNumbers(on: boolean) {
    this.numbersBtn.setAttribute('aria-pressed', String(on))
  }
}
