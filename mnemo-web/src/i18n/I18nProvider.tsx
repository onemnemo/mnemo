import { type ReactNode, useEffect } from "react"

import { useI18nStore } from "@/i18n/store"

// Loads the persisted/default language bundle once, then renders the app. Gating
// on `ready` avoids a flash of translation keys before the bundle arrives (the
// fetch is local and fast; on failure the store still flips ready with a
// key-on-miss fallback).
export function I18nProvider({ children }: { children: ReactNode }) {
  const ready = useI18nStore((s) => s.ready)

  useEffect(() => {
    void useI18nStore.getState().load(useI18nStore.getState().language)
  }, [])

  if (!ready) return null
  return <>{children}</>
}
