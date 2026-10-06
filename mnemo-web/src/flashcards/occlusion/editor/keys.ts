import { isEditableTarget, matchesEvent, parseChord, type ParsedChord } from "@/keybinds/chord"

/** Everything the keys, menus and bars can ask the editor to do. */
export type EditorAction =
  | "tool-select"
  | "tool-pan"
  | "tool-rect"
  | "tool-ellipse"
  | "tool-polygon"
  | "finish-polygon"
  | "cancel"
  | "previous-mask"
  | "next-mask"
  | "nudge-left"
  | "nudge-right"
  | "nudge-up"
  | "nudge-down"
  | "nudge-left-big"
  | "nudge-right-big"
  | "nudge-up-big"
  | "nudge-down-big"
  | "move-earlier"
  | "move-later"
  | "rename"
  | "group"
  | "ungroup"
  | "duplicate"
  | "select-all"
  | "delete"
  | "undo"
  | "redo"
  | "zoom-in"
  | "zoom-out"
  | "zoom-fit"
  | "toggle-masks"

/** The default chords of each action, in the canonical form the keybind catalog uses. */
export const DEFAULT_CHORDS: Record<EditorAction, readonly string[]> = {
  "tool-select": ["V"],
  "tool-pan": ["H"],
  "tool-rect": ["R"],
  "tool-ellipse": ["E"],
  "tool-polygon": ["P"],
  "finish-polygon": ["Enter"],
  cancel: ["Escape"],
  "previous-mask": ["OemOpenBrackets"],
  "next-mask": ["OemCloseBrackets"],
  "nudge-left": ["Left"],
  "nudge-right": ["Right"],
  "nudge-up": ["Up"],
  "nudge-down": ["Down"],
  "nudge-left-big": ["Shift+Left"],
  "nudge-right-big": ["Shift+Right"],
  "nudge-up-big": ["Shift+Up"],
  "nudge-down-big": ["Shift+Down"],
  "move-earlier": ["Alt+Shift+Up"],
  "move-later": ["Alt+Shift+Down"],
  rename: ["F2"],
  group: ["Primary+G"],
  ungroup: ["Primary+Shift+G"],
  duplicate: ["Primary+D"],
  "select-all": ["Primary+A"],
  delete: ["Delete", "Back"],
  undo: ["Primary+Z"],
  redo: ["Primary+Y", "Primary+Shift+Z"],
  "zoom-in": ["Primary+OemPlus", "Primary+Shift+OemPlus", "Primary+Add"],
  "zoom-out": ["Primary+OemMinus", "Primary+Subtract"],
  "zoom-fit": ["Primary+D0", "Primary+NumPad0"],
  "toggle-masks": ["M"],
}

/** The namespace the actions are registered under in the keybind catalog. */
export const ACTION_NAMESPACE = "flashcards-occlusion"

type Bound = { action: EditorAction; chord: ParsedChord }

const BOUND: Bound[] = (Object.entries(DEFAULT_CHORDS) as [EditorAction, readonly string[]][]).flatMap(([action, chords]) =>
  chords.map((chord) => ({ action, chord: parseChord(chord) })),
)

/** The action a key press is bound to by default, or null. */
export function actionForKey(event: KeyboardEvent): EditorAction | null {
  return BOUND.find(({ chord }) => matchesEvent(chord, event))?.action ?? null
}

/**
 * Runs the action a key press means. Keys typed into a field are the field's.
 * Returns whether the press was used, so the caller can leave unused keys to the page.
 */
export function handleKey(event: KeyboardEvent, perform: (action: EditorAction) => boolean): boolean {
  if (event.defaultPrevented) return false
  const action = actionForKey(event)
  if (!action) return false
  if (isEditableTarget(event.target)) return false
  if (event.repeat && !action.startsWith("nudge")) return false

  const used = perform(action)
  if (used) event.preventDefault()
  return used
}
