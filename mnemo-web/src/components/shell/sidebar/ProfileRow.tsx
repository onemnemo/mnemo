import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"
import { assetUrl, DEFAULT_PROFILE_PICTURE } from "@/settings/assets"
import { useSettingValue } from "@/settings/store"

/**
 * The single home for identity.
 *
 * It moved out of the topbar because identity belongs at the bottom of the rail
 * with the other things that are about you rather than about what you are
 * looking at. Name and picture are the real ones from settings, so onboarding
 * shows up here immediately; the initial is the fallback for an install that has
 * neither.
 */
export function ProfileRow({ collapsed }: { collapsed: boolean }) {
  const t = useT()
  const label = t("Topbar", "ProfileTooltip")
  const name = useSettingValue("User.DisplayName", "")
  const picture = assetUrl(useSettingValue("User.ProfilePicture", DEFAULT_PROFILE_PICTURE))

  return (
    <a
      href="#/settings"
      aria-label={label}
      title={collapsed ? name || label : label}
      className={cn(
        "flex h-8 w-full items-center rounded-md transition-colors hover:bg-frame-hover",
        collapsed ? "justify-center px-0" : "gap-2.5 px-2",
      )}
      style={{ transitionDuration: "var(--duration-fast)" }}
    >
      {picture ? (
        <img src={picture} alt="" className="size-[18px] shrink-0 rounded-full object-cover" />
      ) : (
        <span className="grid size-[18px] shrink-0 place-items-center rounded-full bg-frame-active text-[9px] font-semibold text-ink-2">
          {(name.trim()[0] ?? "M").toUpperCase()}
        </span>
      )}
      {!collapsed && <span className="flex-1 truncate text-left text-[14px] text-ink-2">{name || label}</span>}
    </a>
  )
}
