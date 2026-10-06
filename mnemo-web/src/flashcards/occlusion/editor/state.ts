import type { OcclusionDocument } from "../../facts/occlusion"
import { FIT_VIEW, viewFrame, type Box, type Size, type View } from "../geometry"
import type { History } from "./history"
import { NO_MARKS, type Marks } from "./marks"
import type { Point } from "./shape"

export type Tool = "select" | "pan" | "rect" | "ellipse" | "polygon"

/** What the stage measured: its pane, the image fitted into it, and the image's own size. */
export interface Metrics {
  box: Size
  fitted: Size
  natural: Size | null
}

export interface EditorState {
  history: History<OcclusionDocument>
  /** The document while a gesture is in flight. It reaches the history only when the gesture ends. */
  /** Selection before and after each undo step, in line with the history. */
  marks: Marks
  draft: OcclusionDocument | null
  selection: string[]
  tool: Tool
  /** Polygon points placed so far, or null when no polygon is being drawn. */
  pending: Point[] | null
  view: View
  metrics: Metrics
  hovered: string | null
  showMasks: boolean
  /** Whether a pointer gesture is in flight, and how many times one has been cancelled. */
  gesture: { live: boolean; epoch: number }
}

/** Zoom over fit the editor allows. Review stops at 4; editing small masks needs more. */
export const EDITOR_MAX_SCALE = 16
/** The editor zooms out to half of fit, so the image can sit well inside the pane. */
export const EDITOR_MIN_SCALE = 0.5
/** Smallest width or height a resize leaves a rectangle or ellipse, in screen pixels. */
export const MIN_MASK_PX = 6
export const NUDGE_PX = 1
export const NUDGE_BIG_PX = 10
export const ZOOM_FACTOR = 1.25

export const EMPTY_METRICS: Metrics = { box: { w: 0, h: 0 }, fitted: { w: 0, h: 0 }, natural: null }

export function initialState(history: History<OcclusionDocument>): EditorState {
  return {
    history,
    marks: NO_MARKS,
    draft: null,
    selection: [],
    tool: "select",
    pending: null,
    view: FIT_VIEW,
    metrics: EMPTY_METRICS,
    hovered: null,
    showMasks: false,
    gesture: { live: false, epoch: 0 },
  }
}

/** The document to draw: the in-flight draft if there is one, else the last committed. */
export function docOf(state: EditorState): OcclusionDocument {
  return state.draft ?? state.history.present
}

/** Whether two documents say the same thing, so a gesture that ends where it began records nothing. */
export function sameDocument(a: OcclusionDocument, b: OcclusionDocument): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b)
}

/** The image's displayed size in pixels at the current zoom. */
export function shownSize(state: Pick<EditorState, "metrics" | "view">): Size {
  return { w: state.metrics.fitted.w * state.view.scale, h: state.metrics.fitted.h * state.view.scale }
}

/** The zoom readout: displayed width over the image's natural width, as a whole percent. */
export function zoomPercent(state: Pick<EditorState, "metrics" | "view">): number | null {
  const { natural, fitted } = state.metrics
  if (!natural || natural.w <= 0 || fitted.w <= 0) return null
  return Math.round(((fitted.w * state.view.scale) / natural.w) * 100)
}

/** Where the image sits inside the stage's pane, in pixels. Zero until the image has loaded. */
export function frameOf(state: Pick<EditorState, "metrics" | "view">): Box {
  return viewFrame(state.view, state.metrics.box, state.metrics.fitted, EDITOR_MAX_SCALE, EDITOR_MIN_SCALE)
}
