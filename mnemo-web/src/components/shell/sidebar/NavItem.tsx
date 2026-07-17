import type { NavItemDef } from "@/app/routes"
import { AppIcon } from "@/components/icon/AppIcon"
import { cn } from "@/lib/utils"

interface NavItemProps {
  item: NavItemDef
  active: boolean
  collapsed?: boolean
}

// A single sidebar nav row (the Avalonia NavigationButton). The icon tints
// independently of the label, matching the reference's NavigationButtonIcon vs
// NavigationButtonForeground token split.
export function NavItem({ item, active, collapsed = false }: NavItemProps) {
  const iconClass = active
    ? "text-[var(--navigation-button-icon-selected)]"
    : "text-[var(--navigation-button-icon)]"

  if (collapsed) {
    return (
      <a
        href={`#/${item.route}`}
        title={item.label}
        aria-current={active ? "page" : undefined}
        className={cn(
          "grid size-9 place-items-center rounded-md transition-colors",
          active
            ? "bg-[var(--navigation-button-background-selected)]"
            : "hover:bg-[var(--navigation-button-background-hover)]",
        )}
      >
        <AppIcon name={item.icon} size={16} className={iconClass} />
      </a>
    )
  }

  return (
    <a
      href={`#/${item.route}`}
      title={item.label}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-[29px] items-center rounded-md px-2 text-navigation transition-colors",
        active
          ? "bg-[var(--navigation-button-background-selected)] font-medium text-[var(--navigation-button-foreground-selected)]"
          : "text-[var(--navigation-button-foreground)] hover:bg-[var(--navigation-button-background-hover)] hover:text-[var(--navigation-button-foreground-hover)]",
      )}
    >
      <AppIcon name={item.icon} size={16} className={iconClass} />
      <span className="ml-[9px] truncate">{item.label}</span>
    </a>
  )
}
