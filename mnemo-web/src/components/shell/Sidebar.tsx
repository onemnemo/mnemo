import { Brain } from "lucide-react"

import { NAV_GROUPS } from "@/app/routes"
import { cn } from "@/lib/utils"

interface SidebarProps {
  activeRoute: string
  collapsed: boolean
}

export function Sidebar({ activeRoute, collapsed }: SidebarProps) {
  return (
    <aside
      className="flex shrink-0 flex-col border-r bg-sidebar-surface transition-[width] duration-200"
      style={{ width: collapsed ? "var(--sidebar-collapsed-width)" : "var(--sidebar-width)" }}
    >
      {/* Brand */}
      <div className="flex h-[var(--topbar-height)] items-center gap-2 px-3">
        <Brain className="size-6 shrink-0 text-brand" aria-hidden />
        {!collapsed && <span className="text-heading-6 font-semibold text-foreground">Mnemo</span>}
      </div>

      {/* Nav */}
      <nav className="flex flex-1 flex-col gap-4 overflow-y-auto p-[var(--sidebar-inset)]">
        {NAV_GROUPS.map((group) => (
          <div key={group.id} className="flex flex-col gap-0.5">
            {group.label && !collapsed && (
              <div className="px-2 pb-1 text-caption font-medium uppercase tracking-wide text-text-faded">
                {group.label}
              </div>
            )}
            {group.items.map((item) => {
              const isActive = activeRoute === item.route
              const Icon = item.icon
              return (
                <a
                  key={item.route}
                  href={`#/${item.route}`}
                  title={collapsed ? item.label : undefined}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-navigation transition-colors",
                    collapsed && "justify-center",
                    isActive
                      ? "bg-[var(--navigation-button-background-selected)] font-medium text-[var(--navigation-button-foreground-selected)]"
                      : "text-[var(--navigation-button-foreground)] hover:bg-[var(--navigation-button-background-hover)] hover:text-[var(--navigation-button-foreground-hover)]",
                  )}
                >
                  <Icon
                    className="size-5 shrink-0"
                    style={{ color: isActive ? "var(--navigation-button-icon-selected)" : "var(--navigation-button-icon)" }}
                    aria-hidden
                  />
                  {!collapsed && <span className="truncate">{item.label}</span>}
                </a>
              )
            })}
          </div>
        ))}
      </nav>

      {/* Footer */}
      {!collapsed && (
        <div className="px-4 py-3 text-caption text-[var(--version-text)]">v0.0.0</div>
      )}
    </aside>
  )
}
