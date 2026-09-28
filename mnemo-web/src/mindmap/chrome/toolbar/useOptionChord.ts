import { firstChord, useKeybindStore } from "@/keybinds/store"

import type { GroupOption } from "./groups"

/** The key each option answers to: its own letter in the group, or the chord its catalog action is bound to. */
export function useOptionChord(): (option: GroupOption) => string | undefined {
  const byAction = useKeybindStore((s) => s.byAction)
  return (option) => option.key ?? (option.action ? firstChord(byAction[option.action]) : undefined)
}
