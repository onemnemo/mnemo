import { AppIcon } from "@/components/icon/AppIcon"
import { cn } from "@/lib/utils"

import { assetUrl } from "../../assets"
import { useSettingsStore, useSettingValue } from "../../store"
import { Block } from "../kit"

/**
 * The picker shared by the profile-picture and app-icon rows: a strip of image tiles
 * where one is selected. Stacked under the label rather than beside it, since the
 * tiles are wider than a row's right-hand control slot.
 */
export function ImageGalleryRow({
  settingKey,
  options,
  defaultValue,
  title,
  description,
  divider,
  shape = "circle",
  size = 56,
  labelFor,
}: {
  settingKey: string
  /** The stored values to offer, in order. */
  options: string[]
  defaultValue: string
  title: string
  description?: string
  divider: boolean
  shape?: "circle" | "rounded"
  size?: number
  /** Accessible name for a tile, given its stored value. */
  labelFor: (stored: string) => string
}) {
  const selected = useSettingValue(settingKey, defaultValue)
  const setValue = useSettingsStore((s) => s.setValue)

  return (
    <div className={cn(divider && "border-b border-line-soft")}>
      <Block label={title} description={description}>
        <div className="flex flex-wrap gap-2.5">
          {options.map((option) => {
            const url = assetUrl(option)
            const isSelected = option === selected

            return (
              <button
                key={option}
                type="button"
                onClick={() => void setValue(settingKey, option)}
                aria-pressed={isSelected}
                aria-label={labelFor(option)}
                style={{ width: size, height: size }}
                className={cn(
                  "relative overflow-hidden bg-canvas-sunken transition-shadow",
                  shape === "circle" ? "rounded-full" : "rounded-xl",
                  // Selection reads as contrast, the way the buttons and the theme cards
                  // do. The second ring is the gap that keeps the first off the artwork.
                  isSelected
                    ? "shadow-[0_0_0_1.5px_var(--solid),0_0_0_4px_var(--canvas)]"
                    : "shadow-[0_0_0_1px_var(--line-soft)] hover:shadow-[0_0_0_1px_var(--line)]",
                )}
              >
                {url ? (
                  <img src={url} alt="" className="h-full w-full object-cover" draggable={false} />
                ) : null}
                {isSelected ? (
                  <span className="absolute bottom-0.5 right-0.5 flex size-[15px] items-center justify-center rounded-full bg-solid">
                    <AppIcon name="check" size={9} strokeWidth={3} className="text-solid-fg" />
                  </span>
                ) : null}
              </button>
            )
          })}
        </div>
      </Block>
    </div>
  )
}
