import { useState } from "react"

import { activeNavRoute, NAV_GROUPS, resolveRoute } from "@/app/routes"
import { useHashRoute } from "@/app/router"
import { Sidebar } from "@/components/shell/Sidebar"
import { Topbar } from "@/components/shell/Topbar"

function routeTitle(activeRoute: string): string {
  for (const group of NAV_GROUPS) {
    for (const item of group.items) {
      if (item.route === activeRoute) return item.label
    }
  }
  return activeRoute.charAt(0).toUpperCase() + activeRoute.slice(1)
}

export function AppShell() {
  const hash = useHashRoute()
  const [collapsed, setCollapsed] = useState(false)

  const resolved = resolveRoute(hash)
  const activeRoute = activeNavRoute(resolved.key)

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar activeRoute={activeRoute} collapsed={collapsed} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar title={routeTitle(activeRoute)} onToggleSidebar={() => setCollapsed((c) => !c)} />
        <main className="min-h-0 flex-1 overflow-y-auto">{resolved.element}</main>
      </div>
    </div>
  )
}
