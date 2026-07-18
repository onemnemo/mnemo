import { apiFetch, apiSend } from "@/api/client"

import type { Keybind, KeybindBinding } from "./types"

export function fetchKeybinds(): Promise<Keybind[]> {
  return apiFetch<Keybind[]>("/keybinds")
}

/** Replaces one action's bindings. An empty list unbinds it without disabling it. */
export function putKeybindOverride(
  actionId: string,
  bindings: KeybindBinding[],
  enabled = true,
): Promise<void> {
  return apiSend(`/keybinds/${encodeURIComponent(actionId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled, bindings }),
  })
}

/** Drops one action's override, restoring its manifest default. */
export function deleteKeybindOverride(actionId: string): Promise<void> {
  return apiSend(`/keybinds/${encodeURIComponent(actionId)}`, { method: "DELETE" })
}

/** Drops every override at once. */
export function resetKeybindOverrides(): Promise<void> {
  return apiSend("/keybinds", { method: "DELETE" })
}
