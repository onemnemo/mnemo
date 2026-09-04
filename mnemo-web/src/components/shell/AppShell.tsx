import { useHashRoute } from "@/app/router"
import { resolveRoute } from "@/app/routes"
import { SomaDock } from "@/components/shell/dock/SomaDock"
import { ResizeEdges } from "@/components/shell/chrome/ResizeEdges"
import { Sidebar } from "@/components/shell/sidebar/Sidebar"
import { ToastHost } from "@/components/shell/ToastHost"
import { Topbar } from "@/components/shell/topbar/Topbar"
import { useT } from "@/i18n/useT"
import { activeNavRoute, navItemForRoute, useNavCategories } from "@/nav/store"
import { navIcon } from "@/nav/icons"
import { useTrail, type Crumb } from "@/nav/trail"
import { SidePeek } from "@/peek/SidePeek"
import { useShellStore } from "@/stores/shell"

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
  const collapsed = useShellStore((s) => s.sidebarCollapsed)

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
      <Sidebar activeRoute={activeRoute} collapsed={collapsed} onToggle={useShellStore.getState().toggleSidebar} />

      <div className="flex min-w-0 flex-1 flex-col border-l border-line-soft">
        <Topbar crumbs={crumbs} collapsed={collapsed} onExpand={() => useShellStore.getState().setSidebarCollapsed(false)} />

        {/* Positioned, so an overlaying side peek covers the canvas and the dock and
            nothing else. No z-index of its own: this must not become a stacking context,
            or the peek's tier would stop comparing against the rest of the app's. */}
        <div className="relative flex min-h-0 flex-1">
          {/* min-h-0 as well as min-w-0: without it this wrapper grows to its
              content, and anything absolutely positioned inside it inherits the
              overflow and runs off the bottom of the window. */}
          <div className="relative min-h-0 min-w-0 flex-1">
            <main className="h-full overflow-y-auto">{resolved.element}</main>
            {/* Scoped to the canvas rather than the window, so a toast can only
                ever cover a module's own content, never the rail, the titlebar
                or the dock. */}
            <ToastHost />
          </div>
          {/* Between the canvas and the dock, always. The dock measures its own width
              from the window's right edge, so a panel docked to the right of it would
              make the first drag of its separator jump by this panel's width. */}
          <SidePeek />
          <SomaDock />
        </div>
      </div>

      <ResizeEdges />
    </div>
  )
}
