import { create } from "zustand"

import { formatChord } from "./chord"
import type { Keybind } from "./types"

interface KeybindState {
  keybinds: Keybind[]
  /** actionId -> definition, for display lookups. */
  byAction: Record<string, Keybind>
  setKeybinds: (keybinds: Keybind[]) => void
}

export const useKeybindStore = create<KeybindState>((set) => ({
  keybinds: [],
  byAction: {},
  setKeybinds: (keybinds) =>
    set({
      keybinds,
      byAction: Object.fromEntries(keybinds.map((k) => [k.actionId, k])),
    }),
}))

/** First chord binding of an action, or undefined if it has none. */
function firstChord(keybind: Keybind | undefined): string | undefined {
  const binding = keybind?.bindings.find((b) => b.kind === "Chord" && b.chord)
  return binding?.chord ?? undefined
}

/**
 * The display pill for an action's primary shortcut (e.g. "Ctrl K"), or null if the
 * catalog has not loaded or the action has no chord. Re-renders when the catalog
 * arrives.
 */
export function useShortcutLabel(actionId: string): string | null {
  const keybind = useKeybindStore((s) => s.byAction[actionId])
  const chord = firstChord(keybind)
  return chord ? formatChord(chord) : null
}
