// The library list is flex rather than grid: a folder row and a deck row are
// different heights and hold different things, and only the numbers on the right
// have to line up. Those keep fixed widths instead.

/** Left indent per nesting level, in px. */
export const DEPTH_INDENT = 24

/** The retention cell, which drops out before the counts do. */
export const RETENTION_CELL = "hidden w-[104px] shrink-0 lg:flex lg:justify-end"
