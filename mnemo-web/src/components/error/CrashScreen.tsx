import { useState } from "react"

import { AppIcon } from "@/components/icon/AppIcon"
import { Button } from "@/components/ui/button"
import { useT } from "@/i18n/useT"

interface CrashScreenProps {
  error: Error
}

/**
 * Fallback for `AppErrorBoundary`. Fills the window it replaces rather than sitting inside
 * whatever chrome was on screen, since that chrome is exactly what just failed to render.
 *
 * Details are hidden behind a toggle rather than shown outright: most readers want the reload
 * button, and a stack trace on first paint reads as more broken than a crash screen already
 * does. It stays here rather than in a report sent anywhere, since this app has no telemetry.
 */
export function CrashScreen({ error }: CrashScreenProps) {
  const t = useT()
  const [showDetails, setShowDetails] = useState(false)

  return (
    <div className="grid min-h-screen place-items-center bg-canvas px-6">
      <div className="flex w-full max-w-[420px] flex-col items-center gap-3 text-center">
        <div className="grid size-14 place-items-center rounded-xl bg-canvas-sunken text-ink-icon shadow-[0_0_0_1px_var(--line)]">
          <AppIcon name="triangle-alert" size={22} strokeWidth={1.5} />
        </div>
        <div>
          <h1 className="text-[15px] font-medium text-ink">{t("App", "CrashTitle")}</h1>
          <p className="mt-0.5 text-[12.5px] text-ink-3">{t("App", "CrashHint")}</p>
        </div>
        <div className="mt-1 flex items-center gap-2">
          <Button onClick={() => window.location.reload()}>{t("App", "CrashReload")}</Button>
          <Button variant="outline" onClick={() => setShowDetails((current) => !current)}>
            {showDetails ? t("App", "CrashHideDetails") : t("App", "CrashShowDetails")}
          </Button>
        </div>
        {showDetails ? (
          <pre className="scroll-thin mt-1 max-h-[240px] w-full overflow-auto rounded-lg border border-line bg-canvas-sunken p-3 text-left text-[11px] leading-[16px] text-ink-3">
            {error.stack ?? error.message}
          </pre>
        ) : null}
      </div>
    </div>
  )
}
