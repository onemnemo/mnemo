import { RouteLink } from "@/app/RouteLink"
import { Tooltip } from "@/components/ui/tooltip"
import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"
import { ProfileMark } from "@/profile/ProfileMark"
import { useProfileIdentity } from "@/profile/useProfileIdentity"

/**
 * The single home for identity.
 *
 * It moved out of the topbar because identity belongs at the bottom of the rail
 * with the other things that are about you rather than about what you are
 * looking at. The mark and name come from settings, so onboarding shows up here
 * immediately.
 */
export function ProfileRow({ collapsed }: { collapsed: boolean }) {
  const t = useT()
  const label = t("Topbar", "ProfileTooltip")
  const profile = useProfileIdentity()

  return (
    <Tooltip label={collapsed ? profile.name || label : label} side={collapsed ? "right" : "top"}>
      <RouteLink
        to="#/settings"
        aria-label={label}
        className={cn(
          "flex h-8 w-full items-center rounded-md transition-colors hover:bg-frame-hover",
          collapsed ? "justify-center px-0" : "gap-2.5 px-2",
        )}
        style={{ transitionDuration: "var(--duration-fast)" }}
      >
        <ProfileMark
          name={profile.name}
          colour={profile.colour}
          pictureUrl={profile.pictureUrl}
          size={18}
        />
        {!collapsed && (
          <span className="flex-1 truncate text-left text-[14px] text-ink-2">{profile.name || label}</span>
        )}
      </RouteLink>
    </Tooltip>
  )
}
