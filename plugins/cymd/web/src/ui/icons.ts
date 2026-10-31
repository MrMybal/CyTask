// Icônes de l'interface (Lucide, licence ISC).

import {
  Bold,
  ChevronDown,
  Code,
  EyeOff,
  FilePlus,
  FolderOpen,
  Hash,
  Heading,
  ImagePlus,
  Italic,
  Link,
  List,
  ListOrdered,
  ListTodo,
  Minus,
  Plus,
  Quote,
  Save,
  SavePen,
  SquareCode,
  Strikethrough,
  Table,
  Underline,
  X,
  createElement,
  type IconNode,
} from 'lucide'

export const ICONS = {
  new: FilePlus,
  open: FolderOpen,
  save: Save,
  saveAs: SavePen,
  bold: Bold,
  italic: Italic,
  underline: Underline,
  strike: Strikethrough,
  quote: Quote,
  code: Code,
  spoiler: EyeOff,
  link: Link,
  heading: Heading,
  bullet: List,
  ordered: ListOrdered,
  task: ListTodo,
  codeblock: SquareCode,
  table: Table,
  hr: Minus,
  image: ImagePlus,
  lineNumbers: Hash,
  plus: Plus,
  close: X,
  chevron: ChevronDown,
} satisfies Record<string, IconNode>

export type IconName = keyof typeof ICONS

export function icon(name: IconName, size = 18): SVGElement {
  const svg = createElement(ICONS[name], { width: size, height: size, 'stroke-width': 2, 'aria-hidden': 'true' })
  svg.classList.add('icon')
  return svg
}
