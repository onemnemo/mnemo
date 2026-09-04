/**
 * What a list says when it has no rows to show.
 *
 * One component for all three answers, because they are not the same answer and
 * a surface that renders "nothing here" while a request is still in flight, or
 * after one failed, tells the reader their data is gone.
 */
export function ListState({
  message,
  action,
}: {
  message: string
  /** Offered by the failed state, so the reader has something to do about it. */
  action?: { label: string; onClick: () => void }
}) {
  return (
    <div className="flex flex-col items-center gap-2 py-10">
      <p className="text-center text-[13px] text-ink-3">{message}</p>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="rounded-md px-2 py-1 text-[12.5px] text-ink-2 transition-colors hover:bg-frame-hover hover:text-ink"
          style={{ transitionDuration: "var(--duration-fast)" }}
        >
          {action.label}
        </button>
      )}
    </div>
  )
}
