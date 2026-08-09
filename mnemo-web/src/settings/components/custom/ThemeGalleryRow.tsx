import { THEMES } from "@/lib/themes"
import { cn } from "@/lib/utils"
import { useThemeStore } from "@/stores/theme"

import { Block } from "../kit"

/**
 * The theme picker.
 *
 * The catalog is client-owned. It used to come from GET /themes so the web UI and the desktop app
 * agreed, but the two no longer share a palette: a theme here is a block of CSS tokens in this
 * bundle, so the only build that can say which themes exist is this one. Asking the server would
 * list themes nothing is styled for.
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
    <div className={cn(divider && "border-b border-line-soft")}>
      {/* A block, not a row: two swatch cards do not belong squeezed into the control column
          beside their own label. */}
      <Block label={title} description={description}>
        <div className="grid grid-cols-2 gap-3">
          {THEMES.map((option) => {
            const selected = option.id === theme

            return (
              <button
                key={option.id}
                type="button"
                onClick={() => setTheme(option.id)}
                aria-pressed={selected}
                className={cn(
                  "rounded-xl p-2 text-left transition-shadow",
                  selected
                    ? "shadow-[0_0_0_2px_var(--accent)]"
                    : "shadow-[0_0_0_1px_var(--line)] hover:shadow-[0_0_0_1px_var(--ink-3)]",
                )}
                style={{ transitionDuration: "var(--duration-fast)" }}
              >
                <div className="mb-2 flex h-14 overflow-hidden rounded-lg shadow-[0_0_0_1px_var(--line-soft)]">
                  {option.previewColors.map((color) => (
                    <div key={color} className="flex-1" style={{ background: color }} />
                  ))}
                </div>
                <p className="text-[13px] font-medium text-ink">{option.name}</p>
                <p className="text-[12px] leading-snug text-ink-3">{option.description}</p>
              </button>
            )
          })}
        </div>
      </Block>
    </div>
  )
}
