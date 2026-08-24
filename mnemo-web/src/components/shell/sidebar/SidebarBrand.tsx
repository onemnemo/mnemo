import { AppIcon } from "@/components/icon/AppIcon"
import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"

interface SidebarBrandProps {
  collapsed: boolean
  hovered: boolean
  onToggle: () => void
}

/**
 * The rail's top row, at topbar height so the wordmark and the breadcrumb share a
 * baseline.
 *
 * A drag surface like the topbar. Its one control appears only on hover, so the
 * row keeps reading as a place to take hold of the window.
 */
export function SidebarBrand({ collapsed, hovered, onToggle }: SidebarBrandProps) {
  const t = useT()

  return (
    <div
      className={cn("drag-region flex shrink-0 items-center", collapsed ? "justify-center px-2" : "justify-between pl-3 pr-2")}
      style={{ height: "var(--topbar-h)" }}
    >
      {/* The mark is not a control, and swallowing the press would leave a hole in
          the titlebar you cannot grab the window by. */}
      {/* Sizes are the marks' own aspect ratios (340x50 and 60x50) against the
          heights the design sets, so neither is stretched to fit its box. */}
      {collapsed ? (
        <AppIcon name="branding/logo-icon" width={20} height={17} className="pointer-events-none text-accent" />
      ) : (
        <AppIcon name="branding/logo-full" width={129} height={19} className="pointer-events-none text-accent" />
      )}

      {!collapsed && (
        <button
          type="button"
          onClick={onToggle}
          aria-label={t("Sidebar", "CollapseSidebar")}
          className={cn(
            "grid size-7 shrink-0 place-items-center rounded-md text-ink-icon transition-[opacity,color,background-color]",
            "hover:bg-frame-hover hover:text-ink-2",
            hovered ? "opacity-100" : "opacity-0",
          )}
          style={{ transitionDuration: "var(--duration-normal)" }}
        >
          <AppIcon name="chevrons-left" size={16} />
        </button>
      )}
    </div>
  )
}
