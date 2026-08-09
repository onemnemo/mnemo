// The lucide glyphs this build ships.
//
// Explicit, not `import { icons } from "lucide-react"`. That barrel references all ~1500
// components, which no bundler can shake: it measured at +510 kB raw (+131 kB gzipped)
// over the whole app for icons nothing rendered. Naming them costs one line each and
// keeps the shipped set honest.
//
// To use a new lucide glyph: add it here, kebab-cased under the name lucide documents it
// by, and it becomes available as <AppIcon name="that-name" />. Nothing else changes.

import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Bell,
  BellOff,
  BookOpen,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronsLeft,
  CircleAlert,
  CircleUser,
  CircleCheck,
  CircleHelp,
  Copy,
  CornerDownLeft,
  Ellipsis,
  ExternalLink,
  File,
  FileText,
  Folder,
  FolderOpen,
  House,
  Info,
  Layers,
  LayoutGrid,
  Library,
  ListFilter,
  LoaderCircle,
  Moon,
  Network,
  NotebookText,
  Orbit,
  Palette,
  PanelLeft,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Settings,
  Settings2,
  Sparkles,
  SquareStack,
  Star,
  Terminal,
  Trash2,
  TriangleAlert,
  X,
  type LucideIcon,
} from "lucide-react"

export const LUCIDE_SET: Readonly<Record<string, LucideIcon>> = {
  // Sidebar. Icon set B: what you do in a module, rather than what it contains.
  house: House,
  orbit: Orbit,
  "notebook-text": NotebookText,
  "square-stack": SquareStack,
  network: Network,
  library: Library,
  settings: Settings,
  "settings-2": Settings2,

  // Frame chrome
  "panel-left": PanelLeft,
  "chevrons-left": ChevronsLeft,
  "corner-down-left": CornerDownLeft,
  search: Search,
  bell: Bell,
  "bell-off": BellOff,
  ellipsis: Ellipsis,

  // Direction
  "chevron-up": ChevronUp,
  "chevron-down": ChevronDown,
  "chevron-left": ChevronLeft,
  "chevron-right": ChevronRight,
  "arrow-up": ArrowUp,
  "arrow-down": ArrowDown,
  "arrow-left": ArrowLeft,
  "arrow-right": ArrowRight,

  // Actions
  plus: Plus,
  x: X,
  check: Check,
  "check-check": CheckCheck,
  copy: Copy,
  pencil: Pencil,
  "trash-2": Trash2,
  star: Star,
  "rotate-ccw": RotateCcw,
  "refresh-cw": RefreshCw,
  palette: Palette,
  terminal: Terminal,
  "list-filter": ListFilter,
  "external-link": ExternalLink,
  "layout-grid": LayoutGrid,

  // Content
  file: File,
  "file-text": FileText,
  folder: Folder,
  "folder-open": FolderOpen,
  "book-open": BookOpen,
  layers: Layers,
  sparkles: Sparkles,
  moon: Moon,

  // Status
  info: Info,
  "circle-alert": CircleAlert,
  "circle-check": CircleCheck,
  "circle-help": CircleHelp,
  "circle-user": CircleUser,
  "triangle-alert": TriangleAlert,
  "loader-circle": LoaderCircle,
}
