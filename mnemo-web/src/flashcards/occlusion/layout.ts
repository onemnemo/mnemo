import { fitSize, type Size } from "./geometry"

/** The image box never grows past this, so a revealed card still fits above the grade row. */
export const BOX_HEIGHT_CAP = 446
/** The box never shrinks below this; past it the card column scrolls instead. */
export const BOX_HEIGHT_FLOOR = 160
/** At this window height or less the answer sits beside the image instead of under it. */
export const COMPACT_MAX_HEIGHT = 640
/** Side by side, the image takes at most this share of the card's width. */
export const COMPACT_IMAGE_SHARE = 0.7

export interface BoxHeightInput {
  /** Height of the card column inside its own padding. */
  column: number
  /** Everything in the card that is not the image box: its padding, the question, and the answer block when stacked. */
  chrome: number
  compact: boolean
}

/** Height of the image box: what the column has left, capped when the answer is stacked below. */
export function boxHeight({ column, chrome, compact }: BoxHeightInput): number {
  const room = Math.floor(column - chrome)
  const capped = compact ? room : Math.min(room, BOX_HEIGHT_CAP)
  return Math.max(BOX_HEIGHT_FLOOR, capped)
}

/** What the image is assumed to look like until its real size has loaded. */
export const PLACEHOLDER_IMAGE: Size = { w: 4, h: 3 }

export interface StageLayout {
  /** The clipping box the image sits in. */
  box: Size
  /** The image at fit, centred in the box. */
  fitted: Size
}

/**
 * The box the stage draws in and the fitted image inside it. Stacked, the box spans the card; side
 * by side, it hugs the image so the answer column starts right after it.
 */
export function stageLayout(args: { natural: Size | null; inner: number; height: number; compact: boolean }): StageLayout {
  const natural = args.natural ?? PLACEHOLDER_IMAGE
  const width = args.compact ? Math.floor(args.inner * COMPACT_IMAGE_SHARE) : args.inner
  const fitted = fitSize(natural, { w: width, h: args.height })
  return { fitted, box: args.compact ? fitted : { w: args.inner, h: args.height } }
}
