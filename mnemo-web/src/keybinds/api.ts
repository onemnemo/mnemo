import { apiFetch } from "@/api/client"

import type { Keybind } from "./types"

export function fetchKeybinds(): Promise<Keybind[]> {
  return apiFetch<Keybind[]>("/keybinds")
}
