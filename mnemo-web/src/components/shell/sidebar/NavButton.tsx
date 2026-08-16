import { RouteLink } from "@/app/RouteLink"
import { AppIcon } from "@/components/icon/AppIcon"
import { Tooltip } from "@/components/ui/tooltip"
import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"
import type { NavBadge } from "@/nav/badges"
import { navIcon } from "@/nav/icons"
import type { NavItemModel } from "@/nav/types"

interface NavButtonProps {
  item: NavItemModel
  active: boolean
  collapsed: boolean
  badge?: NavBadge
}

/**
 * One row in the rail.
 *
 * The icon is a step lighter than its label and drawn thin. At the label's weight
 * the two compete, which is what made the rail read as heavy.
 */
export function NavButton({ item, active, collapsed, badge }: NavButtonProps) {
  const t = useT()
  const label = t(item.namespace, item.labelKey)

  return (
    // Only the collapsed rail needs the hint: an item that is showing its own name does not want
    // the same words a second time in a box over them.
    <Tooltip label={collapsed ? label : ""} side="right">
      <RouteLink
        to={`#/${item.route}`}
        aria-label={collapsed ? label : undefined}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex h-8 w-full items-center rounded-md text-[14px] tracking-[-0.006em] transition-colors",
          collapsed ? "justify-center px-0" : "gap-2.5 px-2",
          active ? "bg-frame-active font-medium text-ink" : "text-ink-2 hover:bg-frame-hover hover:text-ink",
        )}
        style={{ transitionDuration: "var(--duration-fast)" }}
      >
        <AppIcon
          name={navIcon(item)}
          size={16}
          className={cn("shrink-0 transition-colors", active ? "text-ink-2" : "text-ink-icon")}
        />
        {!collapsed && (
          <>
            <span className="flex-1 truncate text-left">{label}</span>
            {badge && badge.value > 0 && (
              <span
                className={cn(
                  "shrink-0 rounded-full px-1.5 text-[11px] font-medium leading-[17px] tabular-nums",
                  badge.tone === "due" ? "bg-accent text-accent-fg" : "text-ink-3",
                )}
              >
                {badge.value}
              </span>
            )}
          </>
        )}
      </RouteLink>
    </Tooltip>
  )
}
