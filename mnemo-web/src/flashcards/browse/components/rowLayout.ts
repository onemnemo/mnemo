// The browse table's column track, shared by the header strip and every row. Same shape as
// the deck table's (see deck/components/rowLayout.ts): checkbox, flag, front, back, state,
// due, lapses - plus a Deck column, since knowing which deck a row belongs to is the one
// thing a single-deck table never has to say. Deck stays visible at every width the back
// column survives at and drops out at the same breakpoint back does, so the row never gets
// narrower than the deck table's ever did.
export const ROW_GRID =
  "grid items-center gap-3 px-2 grid-cols-[15px_12px_minmax(0,1fr)_92px_84px_52px_60px] md:grid-cols-[15px_12px_minmax(0,1fr)_minmax(0,1fr)_96px_92px_84px_52px_60px]"

/** The Back column's own cell, hidden at the same breakpoint the track drops it. */
export const BACK_CELL = "hidden min-w-0 md:block"

/** The Deck column's own cell, hidden at the same breakpoint the track drops it. */
export const DECK_CELL = "hidden min-w-0 md:block"

/** The trailing actions cell: peek and edit, both hover-revealed. */
export const ACTIONS_CELL = "flex items-center justify-end gap-1"
