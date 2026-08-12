import { useMemo } from "react"

import { matchesEvent, parseChord, type ParsedChord } from "./chord"
import { useKeybindStore } from "./store"
import type { Keybind } from "./types"

/** A press that landed on one of the namespace's actions. */
export interface LocalActionHit {
  actionId: string
  /** The chord that matched, for a gesture that has to know which key is holding it open. */
  chord: string
}

/** Answers which action a press is, or null for a key the namespace has nothing bound to. */
export type LocalActionMatcher = (event: KeyboardEvent) => LocalActionHit | null

/**
 * Which of a surface's own actions a key press is.
 *
 * Local actions belong to whatever is open rather than to the session, so nothing dispatches them
 * centrally: Escape means one thing on a canvas and another in a dialog, and only the surface
 * holding the keyboard knows which of the two is on screen. What this gives that surface is the one
 * piece it cannot own, which action a press is, so its handler can be a list of what the actions do
 * rather than a list of which keys they are.
 *
 * Actions nobody has bound a chord to, and actions someone has turned off, never come back from here.
 */
export function useLocalActions(namespace: string): LocalActionMatcher {
  const keybinds = useKeybindStore((s) => s.keybinds)
  return useMemo(() => localMatcher(keybinds, namespace), [keybinds, namespace])
}

/**
 * The matcher itself, over a catalog held by the caller.
 *
 * Chords are parsed here, once, rather than on every press: this runs on the keydown path of a
 * canvas someone is typing into.
 */
export function localMatcher(keybinds: readonly Keybind[], namespace: string): LocalActionMatcher {
  const bound = keybinds
    .filter((k) => k.namespace === namespace && k.scope === "Local" && k.enabled)
    .map((k) => ({ actionId: k.actionId, chords: chordsOf(k) }))

  return (event: KeyboardEvent) => {
    for (const action of bound) {
      for (const chord of action.chords) {
        if (matchesEvent(chord.parsed, event)) {
          return { actionId: action.actionId, chord: chord.canonical }
        }
      }
    }
    return null
  }
}

function chordsOf(keybind: Keybind): { canonical: string; parsed: ParsedChord }[] {
  return keybind.bindings
    .filter((binding) => binding.kind === "Chord" && binding.chord)
    .map((binding) => ({ canonical: binding.chord as string, parsed: parseChord(binding.chord as string) }))
}
