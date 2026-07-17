import { apiFetch, apiSend } from "@/api/client"

// The app-preferences surface (GET/PUT /api/settings), backed by the same setting
// keys the desktop app uses. Theme is the lowercase id the SPA renders with; the
// backend maps it to the canonical name it persists.
export interface AppSettings {
  theme: string
  language: string
}

export function fetchAppSettings(): Promise<AppSettings> {
  return apiFetch<AppSettings>("/settings")
}

function putSetting(path: string, value: string): Promise<void> {
  return apiSend(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value }),
  })
}

export function putTheme(theme: string): Promise<void> {
  return putSetting("/settings/theme", theme)
}

export function putLanguage(language: string): Promise<void> {
  return putSetting("/settings/language", language)
}
