import { useEffect, useState } from "react"

import { AppIcon } from "@/components/icon/AppIcon"
import { Button } from "@/components/ui/button"
import { useT } from "@/i18n/useT"
import { isModalOpen } from "@/lib/modal"

import { useOverviewBoard, useSaveOverviewLayout } from "../api"
import { WidgetBoard } from "../board/WidgetBoard"
import { WidgetConfigOverlay } from "../config/WidgetConfigOverlay"
import { OverviewHeader } from "../header/OverviewHeader"
import { WidgetLibraryPanel } from "../library/WidgetLibraryPanel"
import { useOverviewStore } from "../store"
import { findWidget, lookupManifest } from "../widgets/registry"

/**
 * The Overview page: header, board, and the three states a board can be in instead of a board.
 *
 * The load is mirrored into the store rather than read straight out of the query, because what the
 * board may *do* depends on how it was loaded, not just on what came back. A board that was never
 * saved gets seeded and written; a board that failed to read gets neither, and the store is what
 * enforces that. Reading the query directly in the render would put that rule in the renderer,
 * where every future caller would have to remember it.
 */
export function OverviewRoute() {
  const t = useT()
  const { board, settledAt, retry, publish } = useOverviewBoard()
  const { mutate: saveLayout } = useSaveOverviewLayout()

  const boardState = useOverviewStore((state) => state.boardState)
  const isEditMode = useOverviewStore((state) => state.isEditMode)
  const widgets = useOverviewStore((state) => state.draft)
  const removeWidget = useOverviewStore((state) => state.removeWidget)
  const resizeWidget = useOverviewStore((state) => state.resizeWidget)
  const applyConfig = useOverviewStore((state) => state.applyConfig)
  const openLibrary = useOverviewStore((state) => state.openLibrary)

  // Which tile's config dialog is open, if any. Kept here rather than in the store: the dialog is a
  // modal that blocks Done, and leaving the page unmounts it, so it never has to survive a store
  // transition the way the edit session does.
  const [configuringId, setConfiguringId] = useState<string | null>(null)
  const configuring = configuringId === null ? null : widgets.find((widget) => widget.instanceId === configuringId)
  const configuringRegistration = configuring ? findWidget(configuring.widgetId) : undefined

  // `mutate` is referentially stable, so the store is configured once and the sink it holds stays
  // valid for the life of the page.
  useEffect(() => {
    useOverviewStore.getState().configure({
      manifest: lookupManifest,
      save: (layout, sessionId) => {
        // Before the request, not after it. The board being written is the board this profile has
        // from this moment, and the load answer it replaces is the one that would seed a duplicate.
        publish(layout)
        saveLayout(layout, {
          onError: (error) => {
            // A write issued by a visit the user has already left cannot be retried into a board
            // that no longer exists, and reporting it would attach a failure to whatever they are
            // looking at now.
            if (useOverviewStore.getState().sessionId !== sessionId) return
            console.error("[overview] the board could not be saved", error)
          },
        })
      },
    })
  }, [saveLayout, publish])

  const kind = board.kind
  const layout = board.kind === "loaded" ? board.layout : null

  useEffect(() => {
    const store = useOverviewStore.getState()
    switch (kind) {
      case "loading":
        return
      case "loaded":
        if (layout !== null) store.layoutLoaded(layout)
        return
      case "empty":
        store.layoutMissing()
        return
      case "error":
        // Only a board that was never read at all becomes the error state. A refetch that fails
        // under a board already on screen leaves it there: blanking a readable board because a
        // background re-read failed is the behaviour this state exists to avoid, not a milder
        // version of it.
        if (store.boardState === "loading") store.layoutFailed()
        return
    }
    // settledAt moves on every settled fetch, which is what makes a retry that fails identically
    // to the first attempt still count as a new answer.
  }, [kind, layout, settledAt])

  // Leaving Overview ends the visit: any edit in progress is discarded and a write still in flight
  // is marked as belonging to a session nobody is looking at.
  useEffect(() => () => useOverviewStore.getState().leaveOverview(), [])

  // Escape's precedence, top to bottom: the config dialog (Radix owns its own Escape and
  // isModalOpen() then suppresses this handler entirely), a live drag, the non-modal library panel,
  // and only then the edit session. Bound only while editing, so it cannot shadow whatever else on
  // the page answers Escape the rest of the time.
  useEffect(() => {
    if (!isEditMode) return

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return
      // The config dialog is a real modal; let Radix close it and do nothing else this press.
      if (isModalOpen()) return

      const store = useOverviewStore.getState()
      if (store.dragged !== null) store.cancelDrag()
      else if (store.isLibraryOpen) store.closeLibrary()
      else store.cancelEdit()
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [isEditMode])

  // Leaving edit mode with a config dialog somehow still tracked closes it: the gear that opens it
  // only exists inside the session, so its target should not outlive the session either.
  useEffect(() => {
    if (!isEditMode) setConfiguringId(null)
  }, [isEditMode])

  function onRetry() {
    useOverviewStore.getState().retryLoad()
    retry()
  }

  return (
    // The board sits on the sunken surface so the tiles read as raised off the page rather than
    // drawn onto it. min-h-full, not h-full: the shell owns the scrolling, and a fixed height would
    // stop the background at the fold on a board taller than the window.
    <div className="min-h-full bg-canvas-sunken">
      <div className="mx-auto flex max-w-[1232px] flex-col gap-6 px-6 pb-20 pt-7">
        <OverviewHeader />

        {boardState === "loading" ? (
          <p className="py-16 text-center text-[13px] text-ink-3">{t("Overview", "Loading")}</p>
        ) : boardState === "error" ? (
          <div className="mx-auto flex max-w-[360px] flex-col items-center gap-3 py-16 text-center">
            <div className="grid size-14 place-items-center rounded-xl bg-canvas text-ink-icon shadow-[0_0_0_1px_var(--line)]">
              <AppIcon name="triangle-alert" size={22} strokeWidth={1.5} />
            </div>
            <div>
              <h2 className="text-[14px] font-medium text-ink">{t("Overview", "LayoutLoadFailed")}</h2>
              <p className="mt-0.5 text-[12.5px] text-ink-3">{t("Overview", "LayoutLoadFailedHint")}</p>
            </div>
            <Button variant="outline" className="mt-1" onClick={onRetry}>
              {t("Overview", "Retry")}
            </Button>
          </div>
        ) : widgets.length === 0 && !isEditMode ? (
          // Reachable only by removing every tile. A first visit seeds the starter board instead,
          // and a failed read renders the error above, so this never stands in for either. Never in
          // edit mode: emptying the board there has to leave the hint grid standing, or there is
          // nothing left on screen to add a widget back onto.
          <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-line py-20">
            <AppIcon name="layout-grid" size={24} strokeWidth={1.4} className="text-ink-icon" />
            <div className="text-center">
              <p className="text-[14px] font-medium text-ink">{t("Overview", "DashboardEmpty")}</p>
              <p className="mt-0.5 text-[12.5px] text-ink-3">{t("Overview", "DashboardEmptyHint")}</p>
            </div>
            <Button variant="outline" onClick={openLibrary} icon={<AppIcon name="plus" size={14} strokeWidth={2} />}>
              {t("Overview", "AddFirstWidget")}
            </Button>
          </div>
        ) : (
          <WidgetBoard
            widgets={widgets}
            isEditMode={isEditMode}
            onRemove={removeWidget}
            onResize={resizeWidget}
            onConfigure={setConfiguringId}
          />
        )}

        <WidgetLibraryPanel />

        {configuring && configuringRegistration ? (
          <WidgetConfigOverlay
            key={configuring.instanceId}
            instance={configuring}
            manifest={configuringRegistration.manifest}
            onApply={(values) => applyConfig(configuring.instanceId, values)}
            onClose={() => setConfiguringId(null)}
          />
        ) : null}
      </div>
    </div>
  )
}
