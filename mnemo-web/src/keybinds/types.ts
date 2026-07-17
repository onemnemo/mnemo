// The keybind catalog the SPA loads from GET /api/keybinds. The server owns the
// definitions and user overrides; the browser (see chord.ts / KeybindProvider)
// owns matching and dispatch. Mirrors Mnemo.Host/Contracts/KeybindDto.

export type KeybindScope = "Global" | "Local"

export interface KeybindBinding {
  kind: "Chord" | "Sequence"
  /** Canonical chord string (e.g. "Primary+K") when kind is "Chord". */
  chord?: string | null
  /** Ordered canonical chord strings when kind is "Sequence". */
  sequence?: string[] | null
}

export interface Keybind {
  actionId: string
  namespace: string
  scope: KeybindScope
  module?: string | null
  enabled: boolean
  /** When true, a global action still fires while a text field has focus. */
  allowedDuringTextCapture: boolean
  toggleOnRepeat: boolean
  labelKey?: string | null
  descriptionKey?: string | null
  categoryKey?: string | null
  bindings: KeybindBinding[]
}

/** Runs when a bound action fires. Returning nothing is fine; matching is one-shot. */
export type KeybindHandler = () => void
