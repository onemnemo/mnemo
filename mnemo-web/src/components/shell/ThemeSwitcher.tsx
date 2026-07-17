import { THEMES } from "@/lib/themes"
import { cn } from "@/lib/utils"
import { useThemeStore } from "@/stores/theme"

// Compact segmented theme picker. A temporary home in the topbar until the
// Settings appearance section owns theme selection; the store is the same either
// way, so this keeps working alongside it.
export function ThemeSwitcher() {
  const theme = useThemeStore((s) => s.theme)
  const setTheme = useThemeStore((s) => s.setTheme)

  return (
    <div className="flex items-center gap-0.5 rounded-full bg-muted p-0.5" role="group" aria-label="Theme">
      {THEMES.map((t) => (
        <button
          key={t.id}
          type="button"
          title={`${t.name} — ${t.description}`}
          aria-pressed={theme === t.id}
          onClick={() => setTheme(t.id)}
          className={cn(
            "rounded-full px-2.5 py-1 text-caption font-medium transition-colors",
            theme === t.id
              ? "bg-primary text-primary-foreground"
              : "text-text-tertiary hover:text-text-primary",
          )}
        >
          {t.name}
        </button>
      ))}
    </div>
  )
}
