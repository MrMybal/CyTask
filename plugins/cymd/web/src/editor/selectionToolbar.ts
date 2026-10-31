// Barre de mise en forme flottante au-dessus de la sélection, comme sur Discord.
// Elle n'apparaît qu'une fois la sélection terminée (pas pendant le glisser de la souris).

import { StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state'
import { EditorView, showTooltip, type Tooltip } from '@codemirror/view'
import { icon, type IconName } from '../ui/icons'
import { tr } from '../i18n'

const setSelecting = StateEffect.define<boolean>()

const BUTTONS: { cmd: string; icon: IconName; title: string }[] = [
  { cmd: 'bold', icon: 'bold', title: 'Gras (Ctrl+B)' },
  { cmd: 'italic', icon: 'italic', title: 'Italique (Ctrl+I)' },
  { cmd: 'underline', icon: 'underline', title: 'Souligné (Ctrl+U)' },
  { cmd: 'strike', icon: 'strike', title: 'Barré (Ctrl+Shift+X)' },
  { cmd: '|', icon: 'bold', title: '' },
  { cmd: 'quote', icon: 'quote', title: 'Citation' },
  { cmd: 'code', icon: 'code', title: 'Code (Ctrl+E)' },
  { cmd: 'spoiler', icon: 'spoiler', title: 'Spoiler ||texte||' },
  { cmd: 'link', icon: 'link', title: 'Lien (Ctrl+K)' },
]

export function selectionToolbar(run: (cmd: string) => void): Extension {
  const build = (): HTMLElement => {
    const bar = document.createElement('div')
    bar.className = 'cy-selbar'
    for (const b of BUTTONS) {
      if (b.cmd === '|') {
        bar.append(Object.assign(document.createElement('span'), { className: 'cy-selbar-sep' }))
        continue
      }
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.title = tr(b.title)
      btn.setAttribute('aria-label', tr(b.title))
      btn.append(icon(b.icon, 18))
      btn.addEventListener('mousedown', (e) => e.preventDefault()) // garde la sélection
      btn.addEventListener('click', () => run(b.cmd))
      bar.append(btn)
    }
    return bar
  }

  const tooltipFor = (state: EditorState, selecting: boolean): Tooltip | null => {
    const r = state.selection.main
    if (r.empty || selecting || !state.sliceDoc(r.from, r.to).trim()) return null
    return {
      pos: r.from,
      above: true,
      create: () => ({ dom: build(), offset: { x: 0, y: 6 } }),
    }
  }

  const field = StateField.define<{ selecting: boolean; tip: Tooltip | null }>({
    create: (state) => ({ selecting: false, tip: tooltipFor(state, false) }),
    update(v, tr) {
      let selecting = v.selecting
      for (const e of tr.effects) if (e.is(setSelecting)) selecting = e.value
      if (!tr.docChanged && !tr.selection && selecting === v.selecting) return v
      const prev = v.tip
      const r = tr.state.selection.main
      // Même sélection de départ : on garde la barre (évite qu'elle clignote).
      if (prev && !selecting && !r.empty && prev.pos === r.from && tr.state.sliceDoc(r.from, r.to).trim()) return { selecting, tip: prev }
      return { selecting, tip: tooltipFor(tr.state, selecting) }
    },
    provide: (f) => showTooltip.compute([f], (state) => state.field(f).tip),
  })

  return [
    field,
    EditorView.domEventHandlers({
      mousedown(e, view) {
        if (e.button === 0) {
          view.dispatch({ effects: setSelecting.of(true) })
          const up = () => {
            window.removeEventListener('mouseup', up, true)
            // Après le traitement du clic par CodeMirror.
            setTimeout(() => view.dispatch({ effects: setSelecting.of(false) }), 0)
          }
          window.addEventListener('mouseup', up, true)
        }
        return false
      },
    }),
  ]
}
