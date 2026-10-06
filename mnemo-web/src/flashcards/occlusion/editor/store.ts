import { OCCLUSION_MAX_POINTS, type OcclusionDocument, type OcclusionMode } from "../../facts/occlusion"
import { FIT_VIEW, panBy, zoomAt, type View } from "../geometry"
import { alignMasks, type AlignOp } from "./align-ops"
import { cardList, type CardEntry } from "./cards"
import { groupMasks, ungroupMasks } from "./group-ops"
import { canRedo, canUndo, commit, createHistory, redo, undo } from "./history"
import { createMinter, roomForMasks } from "./ids"
import { markCommit, markRedo, markUndo, NO_MARKS } from "./marks"
import {
  addMask,
  deleteMasks,
  duplicateMasks,
  nudgeMasks,
  renameMask,
  setMode,
  type NewShape,
} from "./ops"
import { moveCardTo, moveEarlier, moveLater } from "./order-ops"
import { applySelection, pruneSelection, selectAll, stepCard, type SelectMode } from "./selection"
import { boundsOf, type Point } from "./shape"
import {
  docOf,
  EDITOR_MAX_SCALE,
  EDITOR_MIN_SCALE,
  initialState,
  MIN_MASK_PX,
  sameDocument,
  shownSize,
  zoomPercent,
  ZOOM_FACTOR,
  type EditorState,
  type Metrics,
  type Tool,
} from "./state"

export interface EditorEnv {
  random?: () => number
  now?: () => number
  /** Called with the committed document whenever a change, undo or redo alters it. */
  onChange?: (document: OcclusionDocument) => void
  /** Asks the surrounding UI to start renaming a mask's card. */
  onRename?: (maskId: string) => void
  /** Called when a new mask is refused because the image already holds the most it can. */
  onFull?: () => void
}

export interface CommitOptions {
  /** Commits with one key close together are one undo step. */
  key?: string
  /** The selection after the commit. Left alone (and pruned) when absent. */
  select?: string[]
}

/** The editor's state and every change to it, with no React. A gesture `preview`s a draft and `commitDraft`s once. */
export function createEditorStore(initial: OcclusionDocument, env: EditorEnv = {}) {
  let state = initialState(createHistory(initial))
  const listeners = new Set<() => void>()
  const retired = new Set<string>()
  const remember = (document: OcclusionDocument) => {
    for (const mask of document.masks) {
      retired.add(mask.id)
      if (mask.group) retired.add(mask.group)
    }
  }
  remember(initial)

  const now = () => (env.now ? env.now() : Date.now())

  function set(next: Partial<EditorState>): void {
    const before = state.history.present
    state = { ...state, ...next }
    if (state.history.present !== before) env.onChange?.(state.history.present)
    for (const listener of listeners) listener()
  }

  const doc = () => docOf(state)

  function commitDocument(next: OcclusionDocument, options: CommitOptions = {}): void {
    remember(next)
    const history = commit(state.history, next, { key: options.key, at: now(), equal: sameDocument })
    const selection = pruneSelection(next, options.select ?? state.selection)
    const marks = markCommit(state.marks, state.history, history, { before: state.selection, after: selection })
    set({ history, marks, draft: null, selection })
  }

  const store = {
    env,
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    doc,
    cards: (): CardEntry[] => cardList(doc()),
    canUndo: () => canUndo(state.history),
    canRedo: () => canRedo(state.history),
    zoomPercent: () => zoomPercent(state),

    /** Replaces the document and forgets the history, as when a different fact is opened. */
    reset(document: OcclusionDocument) {
      remember(document)
      state = { ...state, history: createHistory(document), marks: NO_MARKS, draft: null, selection: [], pending: null }
      for (const listener of listeners) listener()
    },
    setMetrics(metrics: Metrics) {
      const same =
        metrics.box.w === state.metrics.box.w &&
        metrics.box.h === state.metrics.box.h &&
        metrics.fitted.w === state.metrics.fitted.w &&
        metrics.fitted.h === state.metrics.fitted.h &&
        metrics.natural?.w === state.metrics.natural?.w &&
        metrics.natural?.h === state.metrics.natural?.h
      if (!same) set({ metrics })
    },

    setTool(tool: Tool) {
      if (tool === state.tool && state.pending === null) return
      set({ tool, pending: null })
    },
    setHovered(id: string | null) {
      if (id !== state.hovered) set({ hovered: id })
    },
    setShowMasks(show: boolean) {
      if (show !== state.showMasks) set({ showMasks: show })
    },
    select(ids: readonly string[], mode: SelectMode = "replace") {
      const selection = applySelection(doc(), state.selection, ids, mode)
      const same = selection.length === state.selection.length && selection.every((id, i) => id === state.selection[i])
      if (!same) set({ selection })
    },
    clearSelection() {
      if (state.selection.length > 0) set({ selection: [] })
    },
    selectAll() {
      set({ selection: selectAll(doc()) })
    },
    stepSelection(direction: -1 | 1) {
      set({ selection: stepCard(doc(), state.selection, direction) })
    },

    /** An id no mask, group or earlier mask of this session has used. */
    mint(): string {
      const id = createMinter(doc(), retired, env.random)()
      retired.add(id)
      return id
    },

    preview(document: OcclusionDocument | null) {
      set({ draft: document })
    },
    cancelDraft() {
      if (state.draft) set({ draft: null })
    },
    commitDraft(options?: CommitOptions) {
      if (state.draft) commitDocument(state.draft, options)
    },
    commit: commitDocument,

    undo() {
      const history = undo(state.history)
      if (history === state.history) return
      const { marks, step } = markUndo(state.marks)
      set({ history, marks, draft: null, selection: pruneSelection(history.present, step?.before ?? state.selection) })
    },
    redo() {
      const history = redo(state.history)
      if (history === state.history) return
      const { marks, step } = markRedo(state.marks)
      set({ history, marks, draft: null, selection: pruneSelection(history.present, step?.after ?? state.selection) })
    },

    /** Marks a pointer gesture as in flight, so Escape knows there is something to cancel. */
    beginGesture() {
      set({ gesture: { live: true, epoch: state.gesture.epoch } })
    },
    endGesture() {
      if (state.gesture.live) set({ gesture: { live: false, epoch: state.gesture.epoch } })
    },
    /** Cancels the gesture in flight: drops its draft, and the gesture sees the new epoch and stops. */
    cancelGesture(): boolean {
      if (!state.gesture.live) return false
      set({ gesture: { live: false, epoch: state.gesture.epoch + 1 }, draft: null })
      return true
    },

    /** Adds a finished shape as the last card and selects it. */
    addShape(shape: NewShape): string | null {
      if (!roomForMasks(state.history.present)) {
        env.onFull?.()
        return null
      }
      const result = addMask(state.history.present, shape, store.mint())
      if (result.ids.length === 0) return null
      commitDocument(result.document, { select: result.ids })
      return result.ids[0]
    },
    deleteSelection() {
      if (state.selection.length === 0) return
      commitDocument(deleteMasks(state.history.present, state.selection), { select: [] })
    },
    duplicateSelection() {
      if (state.selection.length === 0) return
      if (!roomForMasks(state.history.present, state.selection.length)) {
        env.onFull?.()
        return
      }
      const result = duplicateMasks(state.history.present, state.selection, store.mint)
      if (result.ids.length > 0) commitDocument(result.document, { select: result.ids })
    },
    groupSelection() {
      const result = groupMasks(state.history.present, state.selection)
      if (result.ids.length > 0) commitDocument(result.document, { select: result.ids })
    },
    ungroupSelection() {
      const result = ungroupMasks(state.history.present, state.selection)
      if (result.ids.length > 0) commitDocument(result.document, { select: result.ids })
    },
    moveEarlier() {
      commitDocument(moveEarlier(state.history.present, state.selection))
    },
    moveLater() {
      commitDocument(moveLater(state.history.present, state.selection))
    },
    moveCard(id: string, index: number) {
      commitDocument(moveCardTo(state.history.present, id, index))
    },
    align(op: AlignOp) {
      commitDocument(alignMasks(state.history.present, state.selection, op))
    },
    nudge(dxPx: number, dyPx: number): boolean {
      const size = shownSize(state)
      if (state.selection.length === 0 || size.w <= 0) return false
      commitDocument(nudgeMasks(state.history.present, state.selection, dxPx, dyPx, size), { key: `nudge:${state.selection.join(",")}` })
      return true
    },
    rename(id: string, label: string) {
      commitDocument(renameMask(state.history.present, id, label))
    },
    setMode(mode: OcclusionMode) {
      commitDocument(setMode(state.history.present, mode))
    },

    addPoint(point: Point) {
      const points = state.pending ?? []
      if (points.length >= OCCLUSION_MAX_POINTS) return
      set({ pending: [...points, point] })
    },
    removeLastPoint(): boolean {
      if (!state.pending) return false
      set({ pending: state.pending.length <= 1 ? null : state.pending.slice(0, -1) })
      return true
    },
    /** Turns the placed points into a polygon mask. Too few points, or a sliver, leaves them in place. */
    finishPolygon(): boolean {
      const points = state.pending
      if (!points || points.length < 3) return false
      const size = shownSize(state)
      const box = boundsOf(points)
      // A shape too thin to see stays unfinished so the points are not lost.
      if (size.w > 0 && (box.w * size.w < MIN_MASK_PX || box.h * size.h < MIN_MASK_PX)) return false
      if (store.addShape({ shape: "polygon", points }) === null) return false
      set({ pending: null })
      return true
    },
    cancelShape() {
      if (state.pending) set({ pending: null })
    },

    setView(view: View) {
      set({ view })
    },
    /** Zooms by a factor about a pixel in the pane, or the pane's centre. */
    zoomBy(factor: number, anchor?: { x: number; y: number }) {
      const { box, fitted } = state.metrics
      if (fitted.w <= 0) return
      const at = anchor ?? { x: box.w / 2, y: box.h / 2 }
      set({ view: zoomAt(state.view, factor, at, box, fitted, EDITOR_MAX_SCALE, EDITOR_MIN_SCALE) })
    },
    zoomIn(): void {
      store.zoomBy(ZOOM_FACTOR)
    },
    zoomOut(): void {
      store.zoomBy(1 / ZOOM_FACTOR)
    },
    fit() {
      set({ view: FIT_VIEW })
    },
    /** Zooms to a readout percentage, keeping the centre of the pane where it is. */
    zoomTo(percent: number) {
      const { natural, fitted } = state.metrics
      if (!natural || fitted.w <= 0) return
      const target = ((percent / 100) * natural.w) / fitted.w
      store.zoomBy(target / state.view.scale)
    },
    panByPixels(dx: number, dy: number) {
      const { box, fitted } = state.metrics
      set({ view: panBy(state.view, dx, dy, box, fitted, EDITOR_MAX_SCALE, EDITOR_MIN_SCALE) })
    },
  }

  return store
}

export type EditorStore = ReturnType<typeof createEditorStore>