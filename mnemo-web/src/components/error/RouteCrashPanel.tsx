import { useState } from "react"

import { DEFAULT_ROUTE } from "@/app/routes"
import { navigateTo, resetToOverview } from "@/app/router"
import { AppIcon } from "@/components/icon/AppIcon"
import { Button } from "@/components/ui/button"
import { useT } from "@/i18n/useT"

interface RouteCrashPanelProps {
  error: Error
}

/**
 * What the canvas shows when one route fails to render. Scoped to the content area on
 * purpose: the sidebar and the titlebar are standing, so the way out is a click on
 * another page, and this only says so. The whole-window crash screen is for the case
 * where the chrome itself is what failed.
 */
export function RouteCrashPanel({ error }: RouteCrashPanelProps) {
  const t = useT()
  const [showDetails, setShowDetails] = useState(false)

  // The boundary lets go of the error when the hash changes. When the overview itself is the
  // route that failed the hash is already the overview's, so assigning it again navigates
  // nowhere and fires nothing; that case takes the whole-window path, a reset and a reload.
  const returnToOverview = () => {
    const overview = `#/${DEFAULT_ROUTE}`
    if (window.location.hash === overview) {
      resetToOverview()
      window.location.reload()
      return
    }
    navigateTo(overview)
  }

  return (
    <div className="grid h-full place-items-center px-6">
      <div className="flex w-full max-w-[420px] flex-col items-center gap-3 text-center">
        <div className="grid size-14 place-items-center rounded-xl bg-canvas-sunken text-ink-icon shadow-[0_0_0_1px_var(--line)]">
          <AppIcon name="triangle-alert" size={22} strokeWidth={1.5} />
        </div>
        <div>
          <h1 className="text-[15px] font-medium text-ink">{t("App", "RouteCrashTitle")}</h1>
          <p className="mt-0.5 text-[12.5px] text-ink-3">{t("App", "RouteCrashHint")}</p>
        </div>
        <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
          <Button onClick={returnToOverview}>{t("App", "CrashReturnToOverview")}</Button>
          <Button variant="outline" onClick={() => window.location.reload()}>
            {t("App", "CrashReload")}
          </Button>
          <Button variant="outline" onClick={() => setShowDetails((current) => !current)}>
            {showDetails ? t("App", "CrashHideDetails") : t("App", "CrashShowDetails")}
          </Button>
        </div>
        {showDetails ? (
          <pre
            data-selectable
            className="scroll-thin mt-1 max-h-[240px] w-full overflow-auto rounded-lg border border-line bg-canvas-sunken p-3 text-left text-[11px] leading-[16px] text-ink-3"
          >
            {error.stack ?? error.message}
          </pre>
        ) : null}
      </div>
    </div>
  )
}
