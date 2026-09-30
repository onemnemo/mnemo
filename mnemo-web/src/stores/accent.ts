import { resolveAccent, DEFAULT_ACCENT, type AccentId } from "@/lib/accents"
import { useSettingsStore } from "@/settings/store"

/**
 * The accent colour. The setting in the settings store is the source of truth; this
 * mirrors it onto `data-accent` on <html>, read by styles/accents.css. The default
 * removes the attribute, so tokens.css decides.
 */
export const ACCENT_SETTING_KEY = "Appearance.Accent"

/** First-paint cache, mirroring the theme one. Read by the inline script in index.html. */
const PAINT_HINT_KEY = "mnemo.accent"

export function applyAccent(accent: AccentId): void {
  const root = document.documentElement
  if (accent === DEFAULT_ACCENT) root.removeAttribute("data-accent")
  else root.setAttribute("data-accent", accent)

  try {
    if (accent === DEFAULT_ACCENT) localStorage.removeItem(PAINT_HINT_KEY)
    else localStorage.setItem(PAINT_HINT_KEY, accent)
  } catch {
    // Non-fatal: the accent still applies for this session.
  }
}

/**
 * Applies the stored accent now and on every change, including the store rolling a
 * failed write back. Returns the unsubscribe.
 */
export function syncAccent(): () => void {
  const read = (values: Record<string, unknown>) => resolveAccent(values[ACCENT_SETTING_KEY])
  applyAccent(read(useSettingsStore.getState().values))
  return useSettingsStore.subscribe((state, previous) => {
    const next = read(state.values)
    if (next !== read(previous.values)) applyAccent(next)
  })
}
