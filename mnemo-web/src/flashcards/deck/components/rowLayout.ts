// The card table's column track, shared by the header strip and every row so the
// two stay locked together: checkbox, flag, front, back, state, due, lapses, edit.
//
// Back drops out below md rather than shrinking. Two truncated halves say less than
// one readable one, and the front is the half you search by.
export const ROW_GRID =
  "grid items-center gap-3 px-2 grid-cols-[15px_12px_minmax(0,1fr)_92px_84px_52px_28px] md:grid-cols-[15px_12px_minmax(0,1fr)_minmax(0,1fr)_92px_84px_52px_28px]"

/** The Back column's own cell, hidden at the same breakpoint the track drops it. */
export const BACK_CELL = "hidden min-w-0 md:block"
