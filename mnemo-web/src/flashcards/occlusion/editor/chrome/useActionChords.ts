import { useCallback } from "react"

import { formatChord } from "@/keybinds/chord"
import { firstChord, useKeybindStore } from "@/keybinds/store"

import { ACTION_NAMESPACE, type EditorAction } from "../keys"

export interface ActionChords {
  /** The chord as the platform spells it ("Ctrl D", or the Mac symbols), for a hint beside a label. */
  hint: (action: EditorAction) => string | undefined
  /** The canonical chord, which a tooltip draws as one cap per key. */
  chord: (action: EditorAction) => string | null
}

/** The chords currently bound to the editor's actions, following any remap on the Keyboard page. */
export function useActionChords(): ActionChords {
  const byAction = useKeybindStore((state) => state.byAction)
  const chord = useCallback(
    (action: EditorAction) => firstChord(byAction[`${ACTION_NAMESPACE}.${action}`]) ?? null,
    [byAction],
  )
  const hint = useCallback(
    (action: EditorAction) => {
      const canonical = chord(action)
      return canonical ? formatChord(canonical) : undefined
    },
    [chord],
  )
  return { hint, chord }
}
