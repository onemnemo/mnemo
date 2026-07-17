import { NavItem } from "@/components/shell/sidebar/NavItem"
import { useT } from "@/i18n/useT"
import { categoryShowsHeader, useNavCategories } from "@/nav/store"

// Main navigation: the non-footer categories. Category headers are uppercase and
// suppressed for the hub category, matching the reference.
export function SidebarNav({ activeRoute }: { activeRoute: string }) {
  const t = useT()
  const categories = useNavCategories()
  return (
    <nav className="flex flex-col gap-1 overflow-y-auto">
      {categories
        .filter((category) => !category.footer)
        .map((category) => (
          <div key={category.key} className="flex flex-col gap-px pb-1">
            {categoryShowsHeader(category) && (
              <div className="mx-2 mb-1.5 mt-3 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-text-faded">
                {t(category.namespace, category.key)}
              </div>
            )}
            {category.items
              .filter((item) => item.visible)
              .map((item) => (
                <NavItem key={item.route} item={item} active={activeRoute === item.route} />
              ))}
          </div>
        ))}
    </nav>
  )
}
