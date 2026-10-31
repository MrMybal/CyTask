// Petit menu contextuel / déroulant en HTML (titres, clic droit sur un onglet…).

export interface MenuItem {
  label?: string
  hint?: string
  className?: string
  disabled?: boolean
  separator?: boolean
  action?: () => void
}

let current: { el: HTMLElement; close: () => void } | null = null

export function closeMenu() {
  current?.close()
}

/** Ouvre un menu sous un élément, ou à une position (x, y) de la fenêtre. */
export function showMenu(items: MenuItem[], at: HTMLElement | { x: number; y: number }) {
  closeMenu()
  const el = document.createElement('div')
  el.className = 'cy-menu'
  el.setAttribute('role', 'menu')
  for (const it of items) {
    if (it.separator) {
      el.append(Object.assign(document.createElement('div'), { className: 'cy-menu-sep' }))
      continue
    }
    const b = document.createElement('button')
    b.type = 'button'
    b.className = `cy-menu-item ${it.className ?? ''}`
    b.disabled = !!it.disabled
    b.setAttribute('role', 'menuitem')
    const label = document.createElement('span')
    label.textContent = it.label ?? ''
    b.append(label)
    if (it.hint) {
      const hint = document.createElement('span')
      hint.className = 'cy-menu-hint'
      hint.textContent = it.hint
      b.append(hint)
    }
    b.addEventListener('mousedown', (e) => e.preventDefault())
    b.addEventListener('click', () => {
      close()
      it.action?.()
    })
    el.append(b)
  }
  document.body.append(el)

  const rect = at instanceof HTMLElement ? at.getBoundingClientRect() : { left: at.x, bottom: at.y, top: at.y }
  const w = el.offsetWidth
  const h = el.offsetHeight
  let x = rect.left
  let y = rect.bottom + 4
  if (x + w > innerWidth - 8) x = innerWidth - w - 8
  if (y + h > innerHeight - 8) y = Math.max(8, rect.top - h - 4)
  el.style.left = `${Math.max(8, x)}px`
  el.style.top = `${y}px`

  const onDown = (e: MouseEvent) => {
    if (!el.contains(e.target as Node)) close()
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close()
  }
  const close = () => {
    el.remove()
    window.removeEventListener('mousedown', onDown, true)
    window.removeEventListener('keydown', onKey, true)
    window.removeEventListener('blur', close)
    window.removeEventListener('resize', close)
    if (current?.el === el) current = null
  }
  window.addEventListener('mousedown', onDown, true)
  window.addEventListener('keydown', onKey, true)
  window.addEventListener('blur', close)
  window.addEventListener('resize', close)
  current = { el, close }
}
