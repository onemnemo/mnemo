// Canonical chord parsing, matching, and display, mirroring the desktop's
// CanonicalKeyGestureCodec. Chords arrive as "Alt+Ctrl+Primary+Shift+KeyToken".
// `Primary` is the command key: Meta (Cmd) on macOS, Ctrl elsewhere.

export interface ParsedChord {
  alt: boolean
  ctrl: boolean
  primary: boolean
  shift: boolean
  /** Avalonia-style key token, e.g. "K", "D1", "OemComma". */
  key: string
}

const isMac =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent)

export function parseChord(canonical: string): ParsedChord {
  const parts = canonical.split("+").map((p) => p.trim()).filter(Boolean)
  const key = parts.pop() ?? ""
  const chord: ParsedChord = { alt: false, ctrl: false, primary: false, shift: false, key }
  for (const part of parts) {
    switch (part.toLowerCase()) {
      case "alt":
        chord.alt = true
        break
      case "ctrl":
      case "control":
        chord.ctrl = true
        break
      case "primary":
      case "cmd":
      case "meta":
        chord.primary = true
        break
      case "shift":
        chord.shift = true
        break
    }
  }
  return chord
}

/** Maps a KeyboardEvent to the Avalonia-style token used in chords, or null if unmapped. */
function eventKeyToken(event: KeyboardEvent): string | null {
  const code = event.code
  const letter = /^Key([A-Z])$/.exec(code)
  if (letter) return letter[1]
  const digit = /^Digit([0-9])$/.exec(code)
  if (digit) return `D${digit[1]}`
  const fn = /^F([1-9]|1[0-2])$/.exec(code)
  if (fn) return code
  return NAMED_CODES[code] ?? null
}

// Enough named keys for the current catalog; the Oem names track Avalonia's Key
// enum. Extended as more actions need them.
const NAMED_CODES: Record<string, string> = {
  Enter: "Enter",
  Escape: "Escape",
  Space: "Space",
  Tab: "Tab",
  Backspace: "Back",
  Delete: "Delete",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  ArrowUp: "Up",
  ArrowDown: "Down",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  Comma: "OemComma",
  Period: "OemPeriod",
  Slash: "OemQuestion",
  Semicolon: "OemSemicolon",
  Quote: "OemQuotes",
  BracketLeft: "OemOpenBrackets",
  BracketRight: "OemCloseBrackets",
  Backslash: "OemPipe",
  Minus: "OemMinus",
  Equal: "OemPlus",
  Backquote: "OemTilde",
}

export function matchesEvent(chord: ParsedChord, event: KeyboardEvent): boolean {
  if (eventKeyToken(event) !== chord.key) return false
  if (event.shiftKey !== chord.shift) return false
  if (event.altKey !== chord.alt) return false

  if (isMac) {
    return event.metaKey === chord.primary && event.ctrlKey === chord.ctrl
  }
  // Off macOS, Primary and Ctrl are both the Ctrl key, and Meta (the Windows key)
  // is not used in chords.
  const ctrlWanted = chord.primary || chord.ctrl
  return event.ctrlKey === ctrlWanted && !event.metaKey
}

const MOD_LABELS_MAC = { primary: "⌘", alt: "⌥", shift: "⇧", ctrl: "⌃" }
const MOD_LABELS_OTHER = { primary: "Ctrl", alt: "Alt", shift: "Shift", ctrl: "Ctrl" }

const KEY_DISPLAY: Record<string, string> = {
  OemComma: ",",
  OemPeriod: ".",
  OemQuestion: "/",
  OemSemicolon: ";",
  OemQuotes: "'",
  OemOpenBrackets: "[",
  OemCloseBrackets: "]",
  OemPipe: "\\",
  OemMinus: "-",
  OemPlus: "+",
  OemTilde: "`",
  Left: "←",
  Right: "→",
  Up: "↑",
  Down: "↓",
}

/** A human-readable pill for the first chord, formatted for the current platform. */
export function formatChord(canonical: string): string {
  const chord = parseChord(canonical)
  const labels = isMac ? MOD_LABELS_MAC : MOD_LABELS_OTHER
  const parts: string[] = []
  // Order matches the desktop pill: command/ctrl first, then alt, then shift.
  if (chord.primary) parts.push(labels.primary)
  if (chord.ctrl && !chord.primary) parts.push(labels.ctrl)
  if (chord.alt) parts.push(labels.alt)
  if (chord.shift) parts.push(labels.shift)
  parts.push(KEY_DISPLAY[chord.key] ?? chord.key)
  return isMac ? parts.join("") : parts.join(" ")
}
