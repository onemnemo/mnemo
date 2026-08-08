/**
 * Edit-mode state for the overview board, ported from OverviewViewModel's draft semantics.
 *
 * The board is one live list, not two parallel trees. Entering edit takes a deep clone of it as a
 * DTO and keeps editing the live list; Done serialises the live list and writes it; Cancel throws
 * the live list away and repopulates from the clone. That is why adds, removes, resizes, config
 * changes and drags all revert together and there is no partial undo.
 *
 * `order` is never read back off an instance. Both the snapshot and every save re-derive it from
 * list position, because list position is the only thing that knows the order.
 *
 * Persistence is a sink handed in from outside, not the api module: the store decides *when* a
 * write is owed, and nothing here should be able to reach the network. When a write is owed
 * outside edit mode it goes out immediately; inside edit mode it is Done's job alone.
 */

import { create } from "zustand"

import type { OverviewLayoutDto, WidgetInstanceDto, WidgetSizeDto } from "@/api/types"

import { DEFAULT_BOARD_TEMPLATE, DEFAULT_PROFILE_ID, OVERVIEW_SCHEMA_VERSION, seedDefaultLayout } from "./defaults"
import {
  createDefaultSettings,
  nearestSupportedSize,
  sameSize,
  type ManifestLookup,
  type WidgetManifest,
} from "./widgets/manifest"

/** The load outcome. `error` is terminal for the session; only an explicit retry leaves it. */
export type BoardState = "loading" | "ready" | "error"

/** A grid cell, or {-1,-1} for none. */
export interface Cell {
  column: number
  row: number
}

/** The floating tile that follows the pointer during a drag. */
export interface GhostState {
  visible: boolean
  x: number
  y: number
  title: string
  sizeLabel: string
}

/** Everything the store needs from the rest of the module, injected so none of it is imported. */
export interface OverviewDeps {
  /** The client-side widget registry, for size snapping and setting defaults. */
  manifest: ManifestLookup
  /**
   * Where a write goes. The session id travels with it so a response that arrives after the user
   * left Overview can be recognised as stale and dropped, rather than landing on a board that
   * belongs to a session the user already abandoned.
   */
  save: (layout: OverviewLayoutDto, sessionId: number) => void
  newInstanceId: () => string
}

/** The part of the state a layout is built from. */
export interface BoardSlice {
  schemaVersion: number
  profileId: string
  draft: readonly WidgetInstanceDto[]
}

interface OverviewState extends OverviewDeps, BoardSlice {
  boardState: BoardState
  isEditMode: boolean
  /**
   * The live board. Plain instance data rather than widget hosts: content view models are the
   * render layer's business, and the desktop's draft is instance data too.
   */
  draft: WidgetInstanceDto[]
  /** The committed board as of Customize, and the only thing Cancel restores from. */
  snapshot: OverviewLayoutDto | null
  isLibraryOpen: boolean

  /** Drag substate. Only ever set while `isEditMode` is true. */
  dragged: string | null
  dragOrigin: Cell
  /** Index of the dragged tile, which the layout engine places first. -1 = none. */
  anchorIndex: number
  ghost: GhostState

  /** Bumped on leaving Overview, so a write issued by the abandoned session is identifiable. */
  sessionId: number

  configure: (deps: Partial<OverviewDeps>) => void

  layoutLoaded: (layout: OverviewLayoutDto) => void
  layoutMissing: () => void
  layoutFailed: () => void
  retryLoad: () => void

  enterEdit: () => void
  openLibrary: () => void
  closeLibrary: () => void
  done: () => void
  cancelEdit: () => void
  leaveOverview: () => void

  addWidget: (manifest: WidgetManifest) => void
  removeWidget: (instanceId: string) => void
  resizeWidget: (instanceId: string, size: WidgetSizeDto) => void
  applyConfig: (instanceId: string, values: Record<string, string>) => void

  beginDrag: (instanceId: string, title: string) => void
  updateDragTarget: (column: number, row: number) => void
  updateGhostPosition: (x: number, y: number) => void
  completeDrag: () => void
  cancelDrag: () => void
}

const NO_CELL: Cell = { column: -1, row: -1 }

const HIDDEN_GHOST: GhostState = { visible: false, x: 0, y: 0, title: "", sizeLabel: "" }

const NO_DRAG = { dragged: null, dragOrigin: NO_CELL, anchorIndex: -1 }

// Everything a visit to Overview owns. Leaving the page re-spreads it, which is what makes
// navigating away mid-edit equivalent to Cancel without anyone having to remember to cancel.
// The injected dependencies are configuration, not session state, so they are not in here.
const EMPTY_SESSION = {
  boardState: "loading" as BoardState,
  isEditMode: false,
  draft: [] as WidgetInstanceDto[],
  snapshot: null,
  schemaVersion: OVERVIEW_SCHEMA_VERSION,
  profileId: DEFAULT_PROFILE_ID,
  isLibraryOpen: false,
  ...NO_DRAG,
  ghost: HIDDEN_GHOST,
}

/** Deep copy of one instance, so a draft edit can never reach into the snapshot's objects. */
function cloneInstance(widget: WidgetInstanceDto): WidgetInstanceDto {
  return { ...widget, size: { ...widget.size }, settings: { ...widget.settings } }
}

/** The chip and drop-slot label for a span, e.g. 2×1. */
function sizeLabelFor(size: WidgetSizeDto): string {
  return `${size.columns}×${size.rows}`
}

/**
 * The board as it would be persisted. Used for the edit snapshot and for every write, because the
 * two must agree on what the board *is* for Cancel to be able to restore it exactly.
 */
export function buildLayout(board: BoardSlice): OverviewLayoutDto {
  return {
    schemaVersion: board.schemaVersion,
    profileId: board.profileId,
    widgets: board.draft.map((widget, index) => ({ ...cloneInstance(widget), order: index })),
  }
}

/** The draft a stored layout populates: cloned, in stored order, sizes snapped to the manifests. */
function draftFrom(layout: OverviewLayoutDto, manifest: ManifestLookup): WidgetInstanceDto[] {
  return [...layout.widgets]
    .sort((a, b) => a.order - b.order)
    .map((widget) => {
      const found = manifest(widget.widgetId)
      // An unknown widget id keeps its stored size verbatim. There is nothing to snap against, and
      // the unavailable tile still has to round-trip the row it came from unchanged.
      return { ...cloneInstance(widget), size: found ? nearestSupportedSize(found, widget.size) : { ...widget.size } }
    })
}

/**
 * Hands the current board to the save sink, unless the board is not one we read successfully.
 *
 * This guard is the reason a failed load cannot destroy anything: the stored row is intact and
 * unknown to us, and the empty draft standing in for it is not a board anyone authored. Every
 * write goes through here so a future mutation cannot acquire its own way out.
 *
 * It reads the state it is about to write, though, so it only covers callers that have not already
 * changed `boardState`. A transition that moves the board into "ready" has to check its own
 * precondition before it does that, not lean on this.
 */
function persist(get: () => OverviewState): void {
  const state = get()
  if (state.boardState !== "ready") return
  state.save(buildLayout(state), state.sessionId)
}

export const useOverviewStore = create<OverviewState>((set, get) => ({
  ...EMPTY_SESSION,
  sessionId: 0,

  manifest: () => undefined,
  // Reaching a write before configure() has handed the store a sink is a mount-order bug, and a
  // board that quietly stops sticking is the one failure nothing else in here surfaces.
  save: () => console.error("[overview] a board write was dropped: no save sink is configured"),
  newInstanceId: () => crypto.randomUUID(),

  configure: (deps) => set(deps),

  layoutLoaded: (layout) =>
    set((state) => {
      // A load can land mid-session, because every immediate write invalidates the layout query and
      // the user only has to press Customize before the refetch answers. Swapping the draft then
      // would leave edit mode on with a snapshot of a board that is no longer underneath it, and
      // Done would write the refetched board over the whole session's work. The live board belongs
      // to the edit session until Done or Cancel says otherwise.
      if (state.isEditMode) return {}
      return {
        boardState: "ready",
        schemaVersion: layout.schemaVersion,
        profileId: layout.profileId,
        draft: draftFrom(layout, state.manifest),
      }
    }),

  layoutMissing: () => {
    const state = get()
    // Only a load still in flight can be answered with "never saved". A failed read arrives without
    // a board too, and the row behind it is intact and unknown to us, so seeding over it is the one
    // outcome that turns a transient read failure into permanent loss. This has to be checked
    // before the state changes: flipping to "ready" first walks the write straight past the guard
    // on persist, which reads the state it is about to send.
    if (state.boardState !== "loading") return

    const seeded = seedDefaultLayout(state.manifest, state.newInstanceId)
    // Nothing resolving against the manifest means the lookup was not wired up before the load
    // answered, not that first run produces an empty board. Showing one is recoverable; writing one
    // is not, because a stored row of zero widgets reads back as a board the user deliberately
    // cleared and the starter board would never seed again.
    const seededNothing = seeded.widgets.length === 0 && DEFAULT_BOARD_TEMPLATE.length > 0

    set({
      boardState: "ready",
      schemaVersion: seeded.schemaVersion,
      profileId: seeded.profileId,
      draft: seeded.widgets.map(cloneInstance),
    })

    if (seededNothing) {
      console.error("[overview] not seeding a starter board: no template widget resolved against the manifest")
      return
    }

    // The only load path that writes. A profile with no stored row gets the starter board on disk
    // on its first visit, so the desktop and the web app agree on what first run produced.
    persist(get)
  },

  // No draft, no snapshot, no write, now or later.
  layoutFailed: () =>
    set({ ...EMPTY_SESSION, boardState: "error" }),

  // Only from error: a retry against a board that loaded would blank a board the user is reading.
  retryLoad: () => set((state) => (state.boardState === "error" ? { boardState: "loading" } : {})),

  enterEdit: () =>
    set((state) => {
      // An unread board must not be editable, because Done would then have a board to write.
      if (state.isEditMode || state.boardState !== "ready") return {}
      return { isEditMode: true, snapshot: buildLayout(state) }
    }),

  // Both the "Add widget" button and the empty state's "Add First Widget" are this one command:
  // it forces edit mode when the board is not already in it, then shows the library.
  openLibrary: () => {
    if (get().boardState !== "ready") return
    get().enterEdit()
    set({ isLibraryOpen: true })
  },

  closeLibrary: () => set({ isLibraryOpen: false }),

  done: () => {
    if (!get().isEditMode) return
    // Defensive, as on the desktop: Done with a drag still live reverts that drag rather than
    // committing a cell the pointer never released on.
    get().cancelDrag()
    set({ isEditMode: false, snapshot: null, isLibraryOpen: false })
    persist(get)
  },

  cancelEdit: () => {
    const state = get()
    if (!state.isEditMode) return

    state.cancelDrag()
    const snapshot = state.snapshot
    // Restored in the same update that leaves edit mode. The desktop flips its edit flag first and
    // rebuilds the board afterwards, so it can paint the edited draft in view chrome for a frame;
    // there is no reason to reproduce that flash here.
    set({
      isEditMode: false,
      snapshot: null,
      isLibraryOpen: false,
      ...(snapshot === null
        ? {}
        : {
            schemaVersion: snapshot.schemaVersion,
            profileId: snapshot.profileId,
            draft: snapshot.widgets.map(cloneInstance),
          }),
    })
  },

  leaveOverview: () => set((state) => ({ ...EMPTY_SESSION, sessionId: state.sessionId + 1 })),

  addWidget: (manifest) => {
    const state = get()
    if (state.boardState !== "ready") return

    const instance: WidgetInstanceDto = {
      instanceId: state.newInstanceId(),
      widgetId: manifest.widgetId,
      size: { ...manifest.defaultSize },
      // Unassigned on both axes: a new tile has no cell until the engine drops it into a free one.
      column: -1,
      row: -1,
      order: state.draft.length,
      settings: createDefaultSettings(manifest),
    }

    set({ draft: [...state.draft, instance] })
    if (!state.isEditMode) persist(get)
  },

  removeWidget: (instanceId) => {
    const state = get()
    if (state.boardState !== "ready") return

    const draft = state.draft.filter((widget) => widget.instanceId !== instanceId)
    if (draft.length === state.draft.length) return

    set({ draft })
    // In edit mode a removal is part of the draft, persisted by Done and undone by Cancel. Outside
    // it, the only remove affordance is the unavailable tile's, and that commits straight away.
    if (!state.isEditMode) persist(get)
  },

  resizeWidget: (instanceId, size) => {
    const state = get()
    if (state.boardState !== "ready") return

    const target = state.draft.find((widget) => widget.instanceId === instanceId)
    const manifest = target && state.manifest(target.widgetId)
    // Silently ignored, as on the desktop: an unavailable widget offers no chips, and a span the
    // manifest does not list is not a span this widget can be.
    if (!target || !manifest || !manifest.supportedSizes.some((supported) => sameSize(supported, size))) return

    set({ draft: state.draft.map((widget) => (widget === target ? { ...widget, size: { ...size } } : widget)) })
    if (!state.isEditMode) persist(get)
  },

  applyConfig: (instanceId, values) => {
    const state = get()
    if (state.boardState !== "ready") return

    const target = state.draft.find((widget) => widget.instanceId === instanceId)
    if (!target) return

    // Merged rather than replaced: the config modal only submits the keys it rendered, and a key
    // it did not know about still belongs to the instance.
    set({
      draft: state.draft.map((widget) =>
        widget === target ? { ...widget, settings: { ...widget.settings, ...values } } : widget,
      ),
    })
    if (!state.isEditMode) persist(get)
  },

  beginDrag: (instanceId, title) =>
    set((state) => {
      // Drag substate exists only inside an edit session; the handle is edit-mode chrome.
      if (!state.isEditMode) return {}

      const index = state.draft.findIndex((widget) => widget.instanceId === instanceId)
      if (index < 0) return {}

      const target = state.draft[index]
      return {
        dragged: instanceId,
        dragOrigin: { column: target.column, row: target.row },
        anchorIndex: index,
        // x and y stay where they were: the gesture always reports a pointer position before the
        // ghost can be painted, and inventing one here would just be a different wrong place.
        ghost: { ...state.ghost, visible: true, title, sizeLabel: sizeLabelFor(target.size) },
      }
    }),

  // The target cell is written straight onto the dragged tile, which is what re-runs placement.
  updateDragTarget: (column, row) =>
    set((state) =>
      state.dragged === null
        ? {}
        : {
            draft: state.draft.map((widget) =>
              widget.instanceId === state.dragged ? { ...widget, column, row } : widget,
            ),
          },
    ),

  updateGhostPosition: (x, y) => set((state) => ({ ghost: { ...state.ghost, x, y } })),

  // A drop keeps the cell it landed on. Coordinates are part of the draft; Done persists them.
  completeDrag: () => set((state) => ({ ...NO_DRAG, ghost: { ...state.ghost, visible: false } })),

  cancelDrag: () =>
    set((state) => ({
      draft:
        state.dragged === null
          ? state.draft
          : state.draft.map((widget) =>
              widget.instanceId === state.dragged ? { ...widget, ...state.dragOrigin } : widget,
            ),
      ...NO_DRAG,
      ghost: { ...state.ghost, visible: false },
    })),
}))
