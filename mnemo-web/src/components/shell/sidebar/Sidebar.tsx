import { useRef, useState } from "react"

import { AppIcon } from "@/components/icon/AppIcon"
import { useDragRegion } from "@/components/shell/chrome/useDragRegion"
import { NavButton } from "@/components/shell/sidebar/NavButton"
import { ProfileRow } from "@/components/shell/sidebar/ProfileRow"
import { SidebarBrand } from "@/components/shell/sidebar/SidebarBrand"
import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"
import { useNavBadges } from "@/nav/badges"
import { useNavCategories } from "@/nav/store"

interface SidebarProps {
  activeRoute: string
  collapsed: boolean
  onToggle: () => void
}

/**
 * The rail.
 *
 * Groups are unlabelled and separated by space. Labelling one and not the other
 * read as an accident, and "Modules" was implementation vocabulary leaking into
 * the product; the server still groups items, this just stops printing the group
 * names. Footer categories keep their flat placement at the bottom.
 */
export function Sidebar({ activeRoute, collapsed, onToggle }: SidebarProps) {
  const t = useT()
  const categories = useNavCategories()
  const badges = useNavBadges()
  const [hovered, setHovered] = useState(false)
  const brandRef = useRef<HTMLDivElement>(null)

  useDragRegion(brandRef)

  const groups = categories.filter((category) => !category.footer)
  const footer = categories.filter((category) => category.footer)
  const footerItems = footer.flatMap((category) => category.items).filter((item) => item.visible)

  return (
    <nav
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      className="flex shrink-0 flex-col bg-frame transition-[width] ease-out"
      style={{
        width: collapsed ? "var(--sidebar-w-collapsed)" : "var(--sidebar-w)",
        transitionDuration: "var(--duration-slow)",
      }}
    >
      <SidebarBrand ref={brandRef} collapsed={collapsed} hovered={hovered} onToggle={onToggle} />

      <div className="scroll-thin flex-1 overflow-y-auto px-2 pb-2 pt-1">
        {groups.map((category, index) => (
          <div key={category.key} className={cn("space-y-px", index > 0 && "mt-5")}>
            {category.items
              .filter((item) => item.visible)
              .map((item) => (
                <NavButton
                  key={item.route}
                  item={item}
                  active={activeRoute === item.route}
                  collapsed={collapsed}
                  badge={badges[item.route]}
                />
              ))}
          </div>
        ))}
      </div>

      <div className="shrink-0 space-y-px px-2 pb-2">
        {collapsed && (
          <button
            type="button"
            onClick={onToggle}
            aria-label={t("Sidebar", "ExpandSidebar")}
            className="grid h-8 w-full place-items-center rounded-md text-ink-icon transition-colors hover:bg-frame-hover hover:text-ink-2"
            style={{ transitionDuration: "var(--duration-fast)" }}
          >
            <AppIcon name="chevrons-left" size={16} className="rotate-180" />
          </button>
        )}

        {footerItems.map((item) => (
          <NavButton
            key={item.route}
            item={item}
            active={activeRoute === item.route}
            collapsed={collapsed}
            badge={badges[item.route]}
          />
        ))}

        <ProfileRow collapsed={collapsed} />
      </div>
    </nav>
  )
}
