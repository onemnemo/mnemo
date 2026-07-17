import { NavItem } from "@/components/shell/sidebar/NavItem"
import { SidebarFooter } from "@/components/shell/sidebar/SidebarFooter"
import { SidebarHeader } from "@/components/shell/sidebar/SidebarHeader"
import { SidebarNav } from "@/components/shell/sidebar/SidebarNav"
import { useNavCategories } from "@/nav/store"

interface SidebarProps {
  activeRoute: string
  collapsed: boolean
  onToggle: () => void
}

export function Sidebar({ activeRoute, collapsed, onToggle }: SidebarProps) {
  const categories = useNavCategories()
  if (collapsed) {
    const items = categories.flatMap((category) => category.items).filter((item) => item.visible)
    return (
      <aside
        className="flex shrink-0 flex-col items-center border-r border-[var(--sidebar-border)] bg-sidebar-surface p-2.5"
        style={{ width: "var(--sidebar-collapsed-width)" }}
      >
        <SidebarHeader collapsed onToggle={onToggle} />
        <div className="flex min-h-0 flex-1 flex-col items-center gap-2 overflow-y-auto">
          {items.map((item) => (
            <NavItem key={item.route} item={item} active={activeRoute === item.route} collapsed />
          ))}
        </div>
      </aside>
    )
  }

  return (
    <aside
      className="flex shrink-0 flex-col border-r border-[var(--sidebar-border)] bg-sidebar-surface p-[var(--sidebar-inset)]"
      style={{ width: "var(--sidebar-width)" }}
    >
      <SidebarHeader collapsed={false} onToggle={onToggle} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <SidebarNav activeRoute={activeRoute} />
      </div>
      <SidebarFooter activeRoute={activeRoute} />
    </aside>
  )
}
