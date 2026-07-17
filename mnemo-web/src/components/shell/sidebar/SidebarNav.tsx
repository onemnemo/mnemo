import { NAV_CATEGORIES } from "@/app/routes"
import { NavItem } from "@/components/shell/sidebar/NavItem"
import { useT } from "@/i18n/useT"

// Main navigation: the non-footer categories. Category headers are uppercase and
// suppressed for the hub category, matching the reference.
export function SidebarNav({ activeRoute }: { activeRoute: string }) {
  const t = useT()
  return (
    <nav className="flex flex-col gap-1 overflow-y-auto">
      {NAV_CATEGORIES.filter((category) => !category.footer).map((category) => (
        <div key={category.key} className="flex flex-col gap-px pb-1">
          {category.showHeader && (
            <div className="mx-2 mb-1.5 mt-3 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-text-faded">
              {t("Sidebar", category.labelKey)}
            </div>
          )}
          {category.items.map((item) => (
            <NavItem key={item.route} item={item} active={activeRoute === item.route} />
          ))}
        </div>
      ))}
    </nav>
  )
}
