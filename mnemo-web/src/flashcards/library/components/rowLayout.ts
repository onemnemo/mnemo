// The library table's column track, shared by the header, every row and the
// totals footer so the four numeric columns stay aligned. Mirrors the desktop
// grid: name takes the slack, then New / Learn / Due / Retention / row actions.
export const ROW_GRID = "grid grid-cols-[minmax(0,1fr)_56px_56px_56px_96px_32px] items-center px-[18px]"

/** Left indent per nesting level, in px. */
export const DEPTH_INDENT = 16

export const METRIC_CLASS = "text-right font-mono text-body-extra-small tabular-nums"
