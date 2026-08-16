import { Skeleton } from "@/components/ui/skeleton"
import { useT } from "@/i18n/useT"

/**
 * The two widget states the desktop does not have.
 *
 * Neither is decoration. The desktop has no loading state at all, so a widget paints its "has
 * data" layout with zeroes and blanks for the length of its first fetch and then snaps; and it has
 * no error state, so a database failure resets the widget to zeroes and is indistinguishable from
 * "you have not studied yet" except in the log. A user cannot tell a broken widget from an idle
 * one, which is the worse of the two failures by a distance.
 */

/** Placeholder bars sized to the shape the widget is about to render. */
export function WidgetLoading({ rows = 3 }: { rows?: number }) {
  // Widths vary so the placeholder reads as text rather than as a progress bar. They are decorative
  // and deliberately not derived from the real content, which is not known yet.
  const widths = ["w-2/5", "w-3/5", "w-1/3", "w-1/2", "w-2/3"]

  return (
    <div className="flex h-full flex-col gap-2 pt-1">
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className={`h-3 ${widths[index % widths.length]}`} />
      ))}
    </div>
  )
}

/**
 * A centered line, for a widget with nothing to show. The desktop's own empty wording, so the two
 * apps read identically; only the widget knows which string that is.
 */
export function WidgetMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center px-2 text-center text-body-small text-text-tertiary">
      {children}
    </div>
  )
}

/**
 * A widget whose data could not be read, with a way back.
 *
 * Compact rather than a full error panel: a tile is 120px tall at its smallest, and the board has
 * to stay readable when one widget of five is broken.
 */
export function WidgetError({ onRetry }: { onRetry: () => void }) {
  const t = useT()

  return (
    <div className="flex h-full flex-col items-center justify-center gap-1.5 px-2 text-center">
      <p className="text-body-small text-text-tertiary">{t("Overview", "WidgetLoadFailed")}</p>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-sm text-caption text-brand underline-offset-2 hover:underline"
      >
        {t("Overview", "Retry")}
      </button>
    </div>
  )
}
