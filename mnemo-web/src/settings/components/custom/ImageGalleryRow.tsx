import { cn } from "@/lib/utils"

import { assetUrl } from "../../assets"
import { useSettingsStore, useSettingValue } from "../../store"
import { SettingRowShell } from "../SettingRowShell"

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
    <div className={cn("py-3.5", divider && "border-b border-divider-subtle")}>
      <div className="text-body-small font-medium text-text-primary">{title}</div>
      {description ? (
        <div className="mt-0.5 text-body-extra-small leading-[17px] text-text-tertiary">{description}</div>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-3">
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
                "overflow-hidden border bg-surface-subtle transition-colors",
                shape === "circle" ? "rounded-full" : "rounded-lg",
                isSelected ? "border-brand ring-2 ring-brand" : "border-border hover:border-text-faded",
              )}
            >
              {url ? (
                <img src={url} alt="" className="h-full w-full object-cover" draggable={false} />
              ) : null}
            </button>
          )
        })}
      </div>
    </div>
  )
}
