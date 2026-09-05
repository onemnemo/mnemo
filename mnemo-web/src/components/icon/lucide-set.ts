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
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Bell,
  BellOff,
  Bold,
  BookOpen,
  Braces,
  CalendarClock,
  CalendarDays,
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
  Captions,
  ClipboardPaste,
  Clock,
  Columns3,
  Copy,
  CopyPlus,
  CornerDownLeft,
  Crop,
  Download,
  Ellipsis,
  Eraser,
  ExternalLink,
  Eye,
  File,
  FileText,
  Flame,
  Folder,
  FolderOpen,
  Frame,
  Hash,
  Code,
  Highlighter,
  House,
  ImagePlus,
  Info,
  Italic,
  Keyboard,
  Layers,
  LayoutGrid,
  Library,
  List,
  ListFilter,
  Sigma,
  Underline,
  LoaderCircle,
  Maximize,
  Minus,
  Monitor,
  Moon,
  MousePointer2,
  Network,
  NotebookText,
  Orbit,
  Palette,
  PanelLeft,
  Pencil,
  Play,
  Plus,
  Printer,
  RefreshCw,
  RotateCcw,
  Repeat2,
  Rows3,
  Scissors,
  Search,
  Settings,
  Settings2,
  Sparkles,
  Spline,
  Square,
  SquareStack,
  Star,
  Store,
  Table,
  Tag,
  Target,
  Terminal,
  Trash2,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  Type,
  User,
  WrapText,
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
  // The other half of a zoom control. There is no project glyph for it, and a hyphen in a button is
  // not an icon.
  minus: Minus,
  x: X,
  check: Check,
  "check-check": CheckCheck,
  copy: Copy,
  scissors: Scissors,
  "clipboard-paste": ClipboardPaste,
  pencil: Pencil,
  "trash-2": Trash2,
  star: Star,
  "rotate-ccw": RotateCcw,
  "refresh-cw": RefreshCw,
  palette: Palette,
  terminal: Terminal,
  eraser: Eraser,
  "copy-plus": CopyPlus,
  "list-filter": ListFilter,
  "external-link": ExternalLink,
  // The browse table's quick-look action, beside the pencil that opens the full editor.
  eye: Eye,

  // The mindmap's tool dock. Drawing-tool glyphs, and the project has no art of its own for them.
  "mouse-pointer-2": MousePointer2,
  spline: Spline,
  maximize: Maximize,
  square: Square,
  frame: Frame,

  // The card editor's formatting bar.
  bold: Bold,
  italic: Italic,
  underline: Underline,
  code: Code,
  highlighter: Highlighter,
  sigma: Sigma,
  // The library's two ways of showing the same decks.
  list: List,
  "layout-grid": LayoutGrid,

  // The dimensions a card list filters on.
  tag: Tag,
  type: Type,
  "repeat-2": Repeat2,

  // Content
  file: File,
  "file-text": FileText,
  // "Export as PDF", which is page setup and a print preview rather than a file transfer.
  printer: Printer,
  // The add-an-image slot in the card editor's attachment strip.
  "image-plus": ImagePlus,
  folder: Folder,
  "folder-open": FolderOpen,
  "book-open": BookOpen,
  // The cloze marker on a card row: a deletion is written {{c1::like this}}.
  braces: Braces,
  layers: Layers,
  sparkles: Sparkles,
  moon: Moon,

  // The overview's widgets, and the categories the library groups them under.
  play: Play,
  clock: Clock,
  flame: Flame,
  "calendar-days": CalendarDays,
  "calendar-clock": CalendarClock,
  target: Target,
  "trending-up": TrendingUp,
  "trending-down": TrendingDown,
  store: Store,

  // The settings rail, one page each.
  user: User,
  keyboard: Keyboard,
  download: Download,
  // The theme picker's "match system" card.
  monitor: Monitor,

  // The image block's own chrome: where a figure sits, and reframing it. Paragraph alignment
  // rather than the object-alignment art in common/, which is the mindmap's arrangement tools.
  "align-left": AlignLeft,
  "align-center": AlignCenter,
  "align-right": AlignRight,
  crop: Crop,

  // The code and table blocks' own chrome. No project art exists for any of
  // them, and each one names a display option rather than a Mnemo concept.
  "wrap-text": WrapText,
  hash: Hash,
  captions: Captions,
  table: Table,
  "rows-3": Rows3,
  "columns-3": Columns3,

  // Status
  info: Info,
  "circle-alert": CircleAlert,
  "circle-check": CircleCheck,
  "circle-help": CircleHelp,
  "circle-user": CircleUser,
  "triangle-alert": TriangleAlert,
  "loader-circle": LoaderCircle,
}
