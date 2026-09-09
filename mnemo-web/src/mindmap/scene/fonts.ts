/**
 * Whether the faces a map is measured in have finished loading, and when that changes.
 *
 * Measurement runs on a canvas, which reports the fallback face's widths until the real one is in.
 * A box built from those is wrong for the label drawn a moment later, and the layout packs boxes,
 * so a map measured too early overlaps itself for the rest of the session. So the first projection
 * waits for the fonts the page has already asked for, and every later batch (the mono face a code
 * node pulls in, a Greek or Cyrillic subset) bumps the epoch the route projects against again.
 *
 * The map settling once more when a late face lands is the accepted cost: the alternative is a box
 * that stays the wrong size for as long as the page is open.
 */

/** The slice of `FontFaceSet` this reads, so a test can stand one in. */
export interface FontLoading {
  readonly status: "loading" | "loaded"
  addEventListener(type: "loadingdone", listener: () => void): void
}

export interface FontEpoch {
  /** Zero until the first load settles, then one more for every batch that lands after it. */
  readonly current: () => number
  readonly subscribe: (listener: () => void) => () => void
}

export function createFontEpoch(fonts: FontLoading | null): FontEpoch {
  // No font set at all (a test, an engine without the API) means nothing to wait for.
  let epoch = fonts === null || fonts.status === "loaded" ? 1 : 0
  const listeners = new Set<() => void>()

  // `loadingdone` fires at the end of every loading period, failures included, which is the one
  // moment the widths the canvas reports can have changed.
  fonts?.addEventListener("loadingdone", () => {
    epoch += 1
    for (const listener of listeners) listener()
  })

  return {
    current: () => epoch,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

export const fontEpoch: FontEpoch = createFontEpoch(
  typeof document !== "undefined" && "fonts" in document ? document.fonts : null,
)
