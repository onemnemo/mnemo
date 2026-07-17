import { type ReactNode, useEffect, useState } from "react"

import { fetchAppSettings } from "@/api/settings"
import { DEFAULT_LANGUAGE, useI18nStore } from "@/i18n/store"
import { DEFAULT_THEME, isThemeId } from "@/lib/themes"
import { useThemeStore } from "@/stores/theme"

// Startup gate: hydrate the app preferences (theme, language) from backend
// settings before the first paint, then load the matching translation bundle.
// Ordering matters - the theme applies before render and the language is known
// before the i18n bundle loads, so there is no flash of the wrong theme or of
// translation keys. On any failure (e.g. the host is unreachable) it falls back
// to defaults and still renders.
export function SettingsProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function hydrate(): Promise<void> {
      const settings = await fetchAppSettings().catch(() => null)
      if (cancelled) return

      const theme = isThemeId(settings?.theme) ? settings.theme : DEFAULT_THEME
      useThemeStore.getState().hydrate(theme)

      const language = settings?.language ?? DEFAULT_LANGUAGE
      await useI18nStore.getState().load(language)
      if (cancelled) return

      setReady(true)
    }

    void hydrate()
    return () => {
      cancelled = true
    }
  }, [])

  if (!ready) return null
  return <>{children}</>
}
