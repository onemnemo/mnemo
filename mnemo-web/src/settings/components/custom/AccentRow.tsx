import { AppIcon } from "@/components/icon/AppIcon"
import { useT } from "@/i18n/useT"
import { ACCENTS, DEFAULT_ACCENT, resolveAccent } from "@/lib/accents"
import { cn } from "@/lib/utils"
import { ACCENT_SETTING_KEY } from "@/stores/accent"

import { useSettingsStore, useSettingValue } from "../../store"
import { Block } from "../kit"

/**
 * The accent presets. Each swatch carries its own `data-accent`, so it paints that
 * preset's accent for the current theme straight from the tokens.
 */
export function AccentRow({
  title,
  description,
  divider,
}: {
  title: string
  description?: string
  divider: boolean
}) {
  const t = useT()
  const selected = resolveAccent(useSettingValue(ACCENT_SETTING_KEY, DEFAULT_ACCENT))
  const setValue = useSettingsStore((s) => s.setValue)
  const current = ACCENTS.find((accent) => accent.id === selected)

  return (
    <div className={cn(divider && "border-b border-line-soft")}>
      <Block label={title} description={description}>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex flex-wrap items-center gap-2.5" role="group" aria-label={title}>
            {ACCENTS.map((accent) => {
              const isSelected = accent.id === selected
              return (
                <button
                  key={accent.id}
                  type="button"
                  data-accent={accent.id}
                  aria-label={t("Settings", accent.label)}
                  title={t("Settings", accent.label)}
                  aria-pressed={isSelected}
                  onClick={() => void setValue(ACCENT_SETTING_KEY, accent.id)}
                  className={cn(
                    "grid size-[22px] place-items-center rounded-full bg-accent transition-shadow",
                    // Contrast rather than accent for the ring, like the theme cards.
                    isSelected
                      ? "shadow-[0_0_0_1.5px_var(--solid),0_0_0_3.5px_var(--canvas)]"
                      : "hover:shadow-[0_0_0_1px_var(--line)]",
                  )}
                  style={{ transitionDuration: "var(--duration-fast)" }}
                >
                  {isSelected ? <AppIcon name="check" size={11} strokeWidth={3} className="text-accent-fg" /> : null}
                </button>
              )
            })}
          </div>
          {current ? <span className="text-[12.5px] text-ink-2">{t("Settings", current.label)}</span> : null}
        </div>
      </Block>
    </div>
  )
}
