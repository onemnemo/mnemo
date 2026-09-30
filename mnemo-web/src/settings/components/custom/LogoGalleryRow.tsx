import { BrandLogo } from "@/components/brand/BrandLogo"
import { LOGO_SETTING_KEY, useLogo } from "@/components/brand/useLogo"
import { AppIcon } from "@/components/icon/AppIcon"
import { useT } from "@/i18n/useT"
import { brandMark, LOGO_IDS } from "@/lib/brand/marks"
import { cn } from "@/lib/utils"

import { useSettingsStore } from "../../store"
import { Block } from "../kit"

export function LogoGalleryRow({
  title,
  description,
  divider,
}: {
  title: string
  description?: string
  divider: boolean
}) {
  const t = useT()
  const selected = useLogo()
  const setValue = useSettingsStore((s) => s.setValue)

  return (
    <div className={cn(divider && "border-b border-line-soft")}>
      <Block label={title} description={description}>
        <div className="grid grid-cols-4 gap-2.5">
          {LOGO_IDS.map((id) => {
            const isSelected = id === selected
            const name = t("Settings", brandMark(id)?.label ?? "LogoAccent")
            return (
              <button
                key={id}
                type="button"
                aria-pressed={isSelected}
                onClick={() => void setValue(LOGO_SETTING_KEY, id)}
                className={cn(
                  "rounded-xl p-1.5 text-left transition-shadow",
                  isSelected
                    ? "shadow-[0_0_0_1.5px_var(--solid)]"
                    : "shadow-[0_0_0_1px_var(--line-soft)] hover:shadow-[0_0_0_1px_var(--line)]",
                )}
                style={{ transitionDuration: "var(--duration-fast)" }}
              >
                <span className="grid h-[52px] place-items-center rounded-md bg-canvas-sunken">
                  <BrandLogo variant="icon" logo={id} width={30} height={25} />
                </span>
                <span className="mt-1.5 flex items-center gap-1.5 px-0.5 pb-0.5">
                  <span className="flex-1 truncate text-[12.5px] font-medium text-ink">{name}</span>
                  {isSelected ? (
                    <span className="flex size-[14px] shrink-0 items-center justify-center rounded-full bg-solid">
                      <AppIcon name="check" size={9} strokeWidth={3} className="text-solid-fg" />
                    </span>
                  ) : null}
                </span>
              </button>
            )
          })}
        </div>
      </Block>
    </div>
  )
}
