import { THEMES } from "@/lib/themes"
import { cn } from "@/lib/utils"
import { useThemeStore } from "@/stores/theme"

// Interim Settings surface. The full grouped/searchable settings tree is its own
// phase; for now it hosts the Appearance/theme picker (which the topbar no longer
// owns). Theme selection persists via the theme store.
export function SettingsPage() {
  const theme = useThemeStore((s) => s.theme)
  const setTheme = useThemeStore((s) => s.setTheme)

  return (
    <div className="p-[var(--page-padding)]">
      <h1 className="text-heading-3 font-semibold text-foreground">Settings</h1>

      <section className="mt-6 max-w-3xl">
        <h2 className="text-body-medium font-semibold text-foreground">Appearance</h2>
        <p className="mt-0.5 text-body-small text-muted-foreground">Choose a theme.</p>

        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {THEMES.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTheme(t.id)}
              aria-pressed={theme === t.id}
              className={cn(
                "rounded-xl border p-2 text-left transition-colors",
                theme === t.id ? "border-brand ring-1 ring-brand" : "hover:border-text-faded",
              )}
            >
              {/* Live preview: scoping data-theme applies that theme's tokens to this subtree only. */}
              <div data-theme={t.id} className="mb-2 flex h-14 overflow-hidden rounded-md border bg-surface">
                <div className="w-1/3 bg-sidebar-surface" />
                <div className="flex-1" />
                <div className="w-1.5 bg-brand" />
              </div>
              <div className="text-body-small font-medium text-foreground">{t.name}</div>
              <div className="text-caption capitalize text-muted-foreground">{t.appearance}</div>
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}
