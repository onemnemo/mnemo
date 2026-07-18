import { type ReactNode, useEffect, useState } from "react"

import { fetchAppSettings } from "@/api/settings"
import { DEFAULT_LANGUAGE, useI18nStore } from "@/i18n/store"
import { DEFAULT_THEME, isThemeId } from "@/lib/themes"
import { fetchNav } from "@/nav/api"
import { useNavStore } from "@/nav/store"
import { useSettingsStore } from "@/settings/store"
import { useThemeStore } from "@/stores/theme"

// Startup gate: hydrate from the backend before first paint - app preferences
// (theme, language) and the sidebar nav model - then load the matching
// translation bundle. Ordering matters: the theme applies before render, the
// nav is present so the sidebar does not pop in, and the language is known
// before the i18n bundle loads, so there is no flash of the wrong theme, an
// empty sidebar, or translation keys. On any failure (e.g. the host is
// unreachable) it falls back to defaults and still renders.
export function SettingsProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function hydrate(): Promise<void> {
      // The settings snapshot joins the startup fetch because two things need it
      // before first paint: the first-run gate, and the user's display name in the
      // chat greeting.
      const [settings, nav] = await Promise.all([
        fetchAppSettings().catch(() => null),
        fetchNav().catch(() => []),
        useSettingsStore.getState().load(),
      ])
      if (cancelled) return

      useNavStore.getState().setCategories(nav)

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
