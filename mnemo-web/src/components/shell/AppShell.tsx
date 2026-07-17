import { useState } from "react"

import { resolveRoute } from "@/app/routes"
import { useHashRoute } from "@/app/router"
import { Sidebar } from "@/components/shell/sidebar/Sidebar"
import { Topbar } from "@/components/shell/topbar/Topbar"
import { useT } from "@/i18n/useT"
import { activeNavRoute, navItemForRoute, useNavCategories } from "@/nav/store"

// Mirrors MainWindow.axaml: full-height sidebar on the left, topbar + module host
// on the right.
export function AppShell() {
  const hash = useHashRoute()
  const t = useT()
  const categories = useNavCategories()
  const [collapsed, setCollapsed] = useState(false)

  const resolved = resolveRoute(hash)
  const activeRoute = activeNavRoute(categories, resolved.key)
  const activeItem = navItemForRoute(categories, activeRoute)
  const title = activeItem ? t(activeItem.namespace, activeItem.labelKey) : activeRoute

  return (
    <div className="flex h-screen overflow-hidden bg-surface">
      <Sidebar activeRoute={activeRoute} collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar title={title} />
        <main className="min-h-0 flex-1 overflow-y-auto">{resolved.element}</main>
      </div>
    </div>
  )
}
