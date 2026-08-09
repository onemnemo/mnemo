import { useState } from "react"

import { useHashRoute } from "@/app/router"
import { resolveRoute } from "@/app/routes"
import { SomaDock } from "@/components/shell/dock/SomaDock"
import { ResizeEdges } from "@/components/shell/chrome/ResizeEdges"
import { Sidebar } from "@/components/shell/sidebar/Sidebar"
import { Topbar } from "@/components/shell/topbar/Topbar"
import { useT } from "@/i18n/useT"
import { activeNavRoute, navItemForRoute, useNavCategories } from "@/nav/store"
import { navIcon } from "@/nav/icons"
import { useTrail, type Crumb } from "@/nav/trail"

/**
 * The application frame: rail, titlebar, canvas, dock.
 *
 * The rail and the canvas sit flush with a hairline between them. Modules own the
 * canvas and the breadcrumb trail; they touch nothing else in here.
 */
export function AppShell() {
  const hash = useHashRoute()
  const t = useT()
  const categories = useNavCategories()
  const published = useTrail()
  const [collapsed, setCollapsed] = useState(false)

  const resolved = resolveRoute(hash)
  const activeRoute = activeNavRoute(categories, resolved.key)
  const activeItem = navItemForRoute(categories, activeRoute)

  // Until a module publishes its own trail, the module's name is the whole of it.
  const crumbs: Crumb[] =
    published ??
    (activeItem
      ? [{ label: t(activeItem.namespace, activeItem.labelKey), icon: navIcon(activeItem) }]
      : [{ label: activeRoute }])

  return (
    <div className="flex h-screen overflow-hidden bg-canvas">
      <Sidebar activeRoute={activeRoute} collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />

      <div className="flex min-w-0 flex-1 flex-col border-l border-line-soft">
        <Topbar crumbs={crumbs} collapsed={collapsed} onExpand={() => setCollapsed(false)} />

        <div className="flex min-h-0 flex-1">
          <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">{resolved.element}</main>
          <SomaDock />
        </div>
      </div>

      <ResizeEdges />
    </div>
  )
}
