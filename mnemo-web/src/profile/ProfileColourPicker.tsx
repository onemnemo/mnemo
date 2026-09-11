import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"

import { PROFILE_COLOURS, profileColour, type ProfileColour } from "./profile-colours"

export function ProfileColourPicker({
  value,
  onChange,
  size = "sm",
}: {
  value: string
  onChange: (value: ProfileColour) => void
  size?: "sm" | "md"
}) {
  const t = useT()
  const selected = profileColour(value)

  return (
    <div className="flex items-center gap-2.5">
      {PROFILE_COLOURS.map((colour) => (
        <button
          key={colour.id}
          type="button"
          aria-label={t("Settings", colour.label)}
          title={t("Settings", colour.label)}
          aria-pressed={selected === colour.id}
          onClick={() => onChange(colour.id)}
          className={cn(
            "rounded-full transition-shadow",
            size === "sm" ? "size-5" : "size-[22px]",
            selected === colour.id
              ? "shadow-[0_0_0_1.5px_var(--solid),0_0_0_3.5px_var(--canvas)]"
              : "hover:shadow-[0_0_0_1px_var(--line)]",
          )}
          style={{
            background: colour.background,
            transitionDuration: "var(--duration-fast)",
          }}
        />
      ))}
    </div>
  )
}
