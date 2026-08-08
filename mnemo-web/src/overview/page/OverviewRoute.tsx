import { useEffect } from "react"

import { AppIcon } from "@/components/icon/AppIcon"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { useT } from "@/i18n/useT"

import { useOverviewBoard, useSaveOverviewLayout } from "../api"
import { WidgetBoard } from "../board/WidgetBoard"
import { OverviewHeader } from "../header/OverviewHeader"
import { useOverviewStore } from "../store"
import { lookupManifest } from "../widgets/registry"

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
  const widgets = useOverviewStore((state) => state.draft)
  const removeWidget = useOverviewStore((state) => state.removeWidget)

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

  function onRetry() {
    useOverviewStore.getState().retryLoad()
    retry()
  }

  return (
    // 1120 is the 1040px content column plus the 40px page padding on each side. The cap has to
    // land on the border box, because the desktop's padding sits outside its MaxWidth rather than
    // inside it, and capping the outer width instead would run the board 80px narrow at every
    // width wide enough for the cap to bite.
    <div className="mx-auto flex max-w-[1120px] flex-col gap-[22px] px-10 py-7">
      <OverviewHeader />

      {boardState === "loading" ? (
        <p className="py-16 text-center text-body-medium text-text-secondary">{t("Overview", "Loading")}</p>
      ) : boardState === "error" ? (
        <div className="mx-auto flex max-w-[360px] flex-col items-center gap-3 py-16 text-center">
          <div className="grid size-14 place-items-center rounded-xl border border-line bg-surface-subtle text-text-faded">
            <AppIcon name="common/triangle-alert" size={22} />
          </div>
          <h2 className="text-heading-6 font-semibold text-text-primary">{t("Overview", "LayoutLoadFailed")}</h2>
          <p className="text-body-small text-text-tertiary">{t("Overview", "LayoutLoadFailedHint")}</p>
          <Button variant="outline" size="sm" className="mt-1" onClick={onRetry}>
            {t("Overview", "Retry")}
          </Button>
        </div>
      ) : widgets.length === 0 ? (
        // Reachable only by removing every tile. A first visit seeds the starter board instead, and
        // a failed read renders the error above, so this never stands in for either.
        <EmptyState
          className="py-16"
          icon="common/layout-grid"
          title={t("Overview", "DashboardEmpty")}
          description={t("Overview", "DashboardEmptyHint")}
        />
      ) : (
        <WidgetBoard widgets={widgets} onRemove={removeWidget} />
      )}
    </div>
  )
}
