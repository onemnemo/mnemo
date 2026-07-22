import { useQuery } from "@tanstack/react-query"

import { isThemeId } from "@/lib/themes"
import { cn } from "@/lib/utils"
import { useThemeStore } from "@/stores/theme"

import { fetchThemes } from "../../api"
import { SettingRowShell } from "../SettingRowShell"

/**
 * The theme picker. The catalog comes from the server so it agrees with the desktop,
 * but only themes the SPA has token blocks for are offered, an unknown id would
 * apply a data-theme attribute nothing is styled for.
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
  const { data, isPending } = useQuery({ queryKey: ["themes"], queryFn: fetchThemes })
  const theme = useThemeStore((s) => s.theme)
  const setTheme = useThemeStore((s) => s.setTheme)

  const themes = (data ?? []).filter((t) => isThemeId(t.id))

  if (isPending) {
    return <SettingRowShell title={title} description={description} divider={divider} />
  }

  return (
    <div className={cn("py-3.5", divider && "border-b border-divider-subtle")}>
      <div className="text-body-small font-medium text-text-primary">{title}</div>
      {description ? (
        <div className="mt-0.5 text-body-extra-small leading-[17px] text-text-tertiary">{description}</div>
      ) : null}

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {themes.map((option) => {
          const isSelected = option.id === theme

          return (
            <button
              key={option.id}
              type="button"
              onClick={() => isThemeId(option.id) && setTheme(option.id)}
              aria-pressed={isSelected}
              className={cn(
                "rounded-xl border p-2 text-left transition-colors",
                isSelected ? "border-brand ring-1 ring-brand" : "hover:border-text-faded",
              )}
            >
              <div className="mb-2 flex h-12 overflow-hidden rounded-md border">
                {option.previewColors.map((color, i) => (
                  <div key={i} className="flex-1" style={{ background: color }} />
                ))}
              </div>
              <div className="text-body-small font-medium text-text-primary">{option.displayName}</div>
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
