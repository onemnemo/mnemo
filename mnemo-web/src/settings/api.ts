import { apiFetch, apiSend } from "@/api/client"

import type { AppInfo, SettingValue, SettingsValues } from "./types"

// The settings surface: the allowlisted key/value store the rows read and write,
// plus the build identity a couple of rows display.

export function fetchSettingValues(): Promise<SettingsValues> {
  return apiFetch<SettingsValues>("/settings/values")
}

/**
 * Persists one key. The JSON kind has to match how the key is registered
 * server-side, so booleans go to toggles and strings to everything else.
 */
export function putSettingValue(key: string, value: SettingValue): Promise<void> {
  return apiSend(`/settings/values/${encodeURIComponent(key)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value }),
  })
}

export function fetchAppInfo(): Promise<AppInfo> {
  return apiFetch<AppInfo>("/app/info")
}

/** Deletes every saved conversation, its memory, and related embeddings. Not undoable. */
export function clearChatHistory(): Promise<void> {
  return apiSend("/chat/history", { method: "DELETE" })
}
