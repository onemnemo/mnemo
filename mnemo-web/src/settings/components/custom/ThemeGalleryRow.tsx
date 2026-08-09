import { THEMES } from "@/lib/themes"
import { cn } from "@/lib/utils"
import { useThemeStore } from "@/stores/theme"

/**
 * The theme picker.
 *
 * The catalog is client-owned. It used to come from GET /themes so the web UI and the
 * desktop app agreed, but the two no longer share a palette: a theme here is a block of
 * CSS tokens in this bundle, so the only build that can say which themes exist is this
 * one. Asking the server would list themes nothing is styled for.
 */
export function ThemeGalleryRow({
  title,
  description,
  divider,
}: {
  title: string
  description?: string
  divider: boolean
}) {
  const theme = useThemeStore((s) => s.theme)
  const setTheme = useThemeStore((s) => s.setTheme)

  return (
    <div className={cn("py-3.5", divider && "border-b border-divider-subtle")}>
      <div className="text-body-small font-medium text-text-primary">{title}</div>
      {description ? (
        <div className="mt-0.5 text-body-extra-small leading-[17px] text-text-tertiary">{description}</div>
      ) : null}

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {THEMES.map((option) => {
          const isSelected = option.id === theme

          return (
            <button
              key={option.id}
              type="button"
              onClick={() => setTheme(option.id)}
              aria-pressed={isSelected}
              className={cn(
                "rounded-xl border p-2 text-left transition-colors",
                isSelected ? "border-brand ring-1 ring-brand" : "hover:border-text-faded",
              )}
            >
              <div className="mb-2 flex h-12 overflow-hidden rounded-md border">
                {option.previewColors.map((color) => (
                  <div key={color} className="flex-1" style={{ background: color }} />
                ))}
              </div>
              <div className="text-body-small font-medium text-text-primary">{option.name}</div>
              <div className="truncate text-caption text-text-tertiary" title={option.description}>
                {option.description}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
