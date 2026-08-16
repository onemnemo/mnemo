import type { Keybind } from "./types"

/**
 * Actions that would answer to the same keys as another action.
 *
 * Scoping matches how the keymap actually dispatches: a Global action fires anywhere,
 * so it clashes with every scope, while two Local actions in different namespaces are
 * never live at the same time and can share a chord quite happily. Flagging those would
 * bury the clash that matters under a list of ones that do not.
 *
 * Computed here rather than read off the server: the merged catalog is the only thing
 * the API returns, there is no conflicts endpoint, and the answer is a pure function of
 * what has already been fetched.
 */
export function findConflicts(keybinds: readonly Keybind[]): Map<string, string[]> {
  const globalOwners = new Map<string, string[]>()
  for (const action of keybinds) {
    if (!action.enabled || action.scope !== "Global") continue
    for (const chord of chordsOf(action)) push(globalOwners, chord, action.actionId)
  }

  const conflicts = new Map<string, string[]>()
  const scopeOwners = new Map<string, string[]>()

  for (const action of keybinds) {
    if (!action.enabled) continue
    const scope = action.scope === "Global" ? "global" : action.namespace

    for (const chord of chordsOf(action)) {
      const slot = `${scope}:${chord}`
      for (const other of scopeOwners.get(slot) ?? []) {
        push(conflicts, action.actionId, other)
        push(conflicts, other, action.actionId)
      }
      push(scopeOwners, slot, action.actionId)

      // A local action also has to clear the globals, which fire over the top of it.
      if (action.scope === "Global") continue
      for (const owner of globalOwners.get(chord) ?? []) {
        push(conflicts, action.actionId, owner)
        push(conflicts, owner, action.actionId)
      }
    }
  }

  return conflicts
}

/** Every chord an action answers to. Sequences are not chords and cannot clash with one. */
function chordsOf(action: Keybind): string[] {
  return action.bindings
    .filter((binding) => binding.kind === "Chord" && binding.chord)
    .map((binding) => binding.chord as string)
}

function push(map: Map<string, string[]>, key: string, value: string): void {
  const existing = map.get(key)
  if (!existing) map.set(key, [value])
  else if (!existing.includes(value)) existing.push(value)
}
