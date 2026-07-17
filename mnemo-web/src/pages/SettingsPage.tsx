import { useQuery } from "@tanstack/react-query"

import { fetchLanguages } from "@/i18n/api"
import { useI18nStore } from "@/i18n/store"
import { useT } from "@/i18n/useT"
import { THEMES } from "@/lib/themes"
import { cn } from "@/lib/utils"
import { useThemeStore } from "@/stores/theme"

// Interim Settings surface. The full grouped/searchable settings tree is its own
// phase; for now it hosts Appearance (theme) and Language, which the shell chrome
// no longer owns. Both persist via their stores.
export function SettingsPage() {
  const t = useT()
  const theme = useThemeStore((s) => s.theme)
  const setTheme = useThemeStore((s) => s.setTheme)
  const language = useI18nStore((s) => s.language)
  const setLanguage = useI18nStore((s) => s.setLanguage)
  const { data: languages } = useQuery({ queryKey: ["i18n", "languages"], queryFn: fetchLanguages })

  return (
    <div className="p-[var(--page-padding)]">
      <h1 className="text-heading-3 font-semibold text-foreground">{t("Sidebar", "Settings")}</h1>

      <section className="mt-6 max-w-3xl">
        <h2 className="text-body-medium font-semibold text-foreground">Appearance</h2>
        <p className="mt-0.5 text-body-small text-muted-foreground">Choose a theme.</p>

        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {THEMES.map((th) => (
            <button
              key={th.id}
              type="button"
              onClick={() => setTheme(th.id)}
              aria-pressed={theme === th.id}
              className={cn(
                "rounded-xl border p-2 text-left transition-colors",
                theme === th.id ? "border-brand ring-1 ring-brand" : "hover:border-text-faded",
              )}
            >
              {/* Live preview: scoping data-theme applies that theme's tokens to this subtree only. */}
              <div data-theme={th.id} className="mb-2 flex h-14 overflow-hidden rounded-md border bg-surface">
                <div className="w-1/3 bg-sidebar-surface" />
                <div className="flex-1" />
                <div className="w-1.5 bg-brand" />
              </div>
              <div className="text-body-small font-medium text-foreground">{th.name}</div>
              <div className="text-caption capitalize text-muted-foreground">{th.appearance}</div>
            </button>
          ))}
        </div>
      </section>

      <section className="mt-8 max-w-3xl">
        <h2 className="text-body-medium font-semibold text-foreground">Language</h2>
        <select
          value={language}
          onChange={(e) => void setLanguage(e.target.value)}
          className="mt-2 h-9 rounded-md border bg-[var(--text-control-background)] px-3 text-body-small text-foreground focus:border-[var(--text-control-border-focused)] focus:outline-none"
        >
          {(languages ?? []).map((l) => (
            <option key={l.code} value={l.code}>
              {l.nativeName}
            </option>
          ))}
        </select>
      </section>
    </div>
  )
}
