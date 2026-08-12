import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { AppIcon } from "@/components/icon/AppIcon"
import { Button } from "@/components/ui/button"
import { useT } from "@/i18n/useT"
import { parseChord } from "@/keybinds/chord"
import { useLocalActions } from "@/keybinds/local"
import { dialog } from "@/stores/dialog"
import { toast } from "@/stores/toast"

import {
  useDeleteMindmapTemplate,
  useMindmap,
  useMindmapTemplates,
  type MindmapOpsResult,
  type MindmapTemplates,
} from "../api"
import { MindmapCanvas } from "../canvas/MindmapCanvas"
import type { CanvasRuntime } from "../canvas/runtime"
import type { ConnectStyle } from "../chrome/ConnectFlyout"
import { ExportMenu } from "../chrome/ExportMenu"
import { MindmapMinimap } from "../chrome/Minimap"
import { MindmapToolDock } from "../chrome/MindmapToolDock"
import type { BranchControl } from "../chrome/NodeBar"
import { RadialMenu } from "../chrome/RadialMenu"
import { RefPicker, type RefTarget } from "../chrome/RefPicker"
import { ON_CANVAS, ON_NODE } from "../chrome/sectors"
import { SaveTemplateDialog } from "../chrome/SaveTemplateDialog"
import { MindmapSelectionBar } from "../chrome/SelectionBar"
import { useMinimapShown } from "../chrome/useMinimapShown"
import { useMindmapEditor } from "../edit/useMindmapEditor"
import {
  captureOrigin,
  captureSelection,
  heldCopy,
  holdCopy,
  offsetPlacement,
  translated,
  unpinned,
} from "../edit/clipboard"
import { carriedText, isPlainKind, linkContent, plainContent } from "../edit/convert"
import { placeChild, type PlacedBox } from "../edit/placement"
import { clearsAnything, restyledEdge } from "../edit/restyle"
import type { MovedElement, NodeChrome } from "../interaction/controller"
import type { ResizeBox } from "../interaction/resize"
import { EMPTY_SELECTION, retain, selectElements, selectOnly, type Selection } from "../interaction/selection"
import { isOneShot, TOOL_OF_ACTION, type MindmapTool } from "../interaction/tool"
import { MapStyleMenu } from "../chrome/MapStyleMenu"
import { edgeDefaultsFor, materialOf } from "../chrome/material"
import { exportMap, type MapExportFormat } from "../export/save"
import {
  contentText,
  edgeKind,
  LAYOUT_ALGORITHMS,
  type EdgeStyle,
  type ElementContent,
  type ElementStyle,
  type FrameContent,
  type LayoutAlgorithm,
  type ShapeType,
  type StyleTemplate,
} from "../model/document"
import { op, type FrameOp, type MindmapOp, type NodeSpec } from "../model/ops"
import { absoluteUrl, followRef, isFollowable } from "./follow"
import type { Point, Scene, SceneElement } from "../model/scene"
import { branchRootOf, branchSwatchOf } from "../scene/branch"
import { nodeKindOf, type NodeKind } from "../scene/content"
import { analyzeHierarchy, childrenIds, descendantsOf, hierarchyEdgesBelow } from "../scene/hierarchy"
import { frameBox, projectScene, type FrameMemberBox } from "../scene/project"
import { sceneMeasurers } from "../scene/measurers"
import { branchToken } from "../scene/tokens"
import { useMindmapRefs } from "../scene/useRefs"

/** No rules at all: every node falls through to the theme. Stable, so it does not reproject a scene. */
const EMPTY_TEMPLATES: MindmapTemplates = { defaultId: "", templates: [], builtInIds: [] }

const NO_SUBTREE: readonly string[] = []

/** How far a duplicate sits from what it was copied from. Far enough to be two nodes, near enough to be a pair. */
const DUPLICATE_STEP = 48

/** A ref on a top-level spec, which is the only way the ids the server made come back. */
const withRef = (spec: NodeSpec, index: number): NodeSpec => ({ ...spec, ref: `n${index}` })

/**
 * What a node is assumed to be before anything has measured it.
 *
 * A brand new node has no text, so this is the empty-label box the measurer would produce anyway. It
 * only has to be close: it decides where the node is put, and the projector measures it properly on
 * the very next frame.
 */
const NEW_NODE_SIZE = { width: 68, height: 30 }

/**
 * A planted shape's box.
 *
 * Bigger than a node's, because a shape is a region drawn around a label rather than a box measured
 * to fit one, and one dragged out to nothing would be a shape nobody could see to resize.
 */
const NEW_SHAPE_SIZE: [number, number] = [148, 86]

/** What the connect tool draws with until the flyout says otherwise. */
const DEFAULT_CONNECT: ConnectStyle = {
  line: "solid",
  routing: "curve",
  startCap: "none",
  endCap: "arrow",
}

/**
 * One open map.
 *
 * The document and the templates are two queries because they change on completely different clocks:
 * a map changes on every edit, the template library changes when someone saves a template. Projecting
 * them together is memoized on both, so an edit reprojects and a theme flip does not.
 *
 * Selection lives here rather than in the canvas because it is what every piece of chrome is about.
 * The canvas writes the ring straight to the DOM; this only ever hears about it once per gesture.
 */
export function MindmapRoute({ mapId }: { mapId: string | undefined }) {
  const t = useT()
  const map = useMindmap(mapId ?? null)
  const templates = useMindmapTemplates()
  const editor = useMindmapEditor(mapId ?? null)
  const actionFor = useLocalActions("mindmap")
  const runtime = useRef<CanvasRuntime | null>(null)
  const [selection, setSelection] = useState<Selection>(EMPTY_SELECTION)
  const [editing, setEditing] = useState<string | null>(null)
  const [editingEdge, setEditingEdge] = useState<string | null>(null)
  const [tool, setTool] = useState<MindmapTool>("select")
  const [zoom, setZoom] = useState(1)
  const [shape, setShape] = useState<ShapeType>("rectangle")
  const [connectStyle, setConnectStyle] = useState(DEFAULT_CONNECT)
  /** Where the ring is and which key is holding it open, while it is open. Null when it is not. */
  const [radial, setRadial] = useState<{ at: Point; key: string } | null>(null)
  // Tracked continuously rather than sampled when the key goes down, because a key event carries no
  // position of its own and the ring has to open where the hand already is.
  const pointer = useRef<Point>({ x: 0, y: 0 })
  const stage = useRef<HTMLDivElement>(null)
  /** The node this edit created. Abandoning the edit takes it away again. */
  const blank = useRef<string | null>(null)
  /** The node whose branch is being saved as a template, for as long as the dialog is up. */
  const [capturing, setCapturing] = useState<string | null>(null)
  /** The node waiting on a reference to point at, and which library it is being picked from. */
  const [picking, setPicking] = useState<{ id: string; target: RefTarget } | null>(null)

  // Waits for the templates to settle, not to succeed. They style a map rather than make one, so a
  // library that cannot be read costs the map its template rules and nothing else; refusing to draw
  // until they arrive turns a styling problem into a blank page that says "Loading" forever.
  const styling = templates.isPending ? null : (templates.data ?? EMPTY_TEMPLATES)

  // What the map's note and deck nodes point at, resolved before the projector runs so a reference
  // is laid out around the title it reads as rather than around a blank that arrives late.
  const refs = useMindmapRefs(map.data)

  const scene = useMemo(() => {
    if (!map.data || !styling) {
      return null
    }
    return projectScene(map.data, {
      templates: styling.templates,
      defaultTemplateId: styling.defaultId,
      measurers: sceneMeasurers(),
      refs,
    })
  }, [map.data, styling, refs])

  const hierarchy = useMemo(() => (map.data ? analyzeHierarchy(map.data) : null), [map.data])

  /**
   * Descendants from the document rather than the scene, so a collapsed subtree still travels with
   * the node it hangs off. Memoized per node because a drag asks once per gesture and a big branch
   * is not free to walk.
   */
  const subtreeOf = useMemo(() => {
    if (!hierarchy) {
      return () => NO_SUBTREE
    }
    const cache = new Map<string, readonly string[]>()
    return (id: string): readonly string[] => {
      const known = cache.get(id)
      if (known) {
        return known
      }
      const found = descendantsOf(hierarchy, id)
      cache.set(id, found)
      return found
    }
  }, [hierarchy])

  // An edit, an undo or another session's change can all take something out from under a selection.
  useEffect(() => {
    if (!scene) {
      return
    }
    const elements = new Set(scene.elements.map((element) => element.id))
    const edges = new Set(scene.edges.map((edge) => edge.id))
    setSelection((current) =>
      retain(
        current,
        (id) => elements.has(id),
        (id) => edges.has(id),
      ),
    )
  }, [scene])

  const commitMove = useCallback(
    (moves: readonly MovedElement[]) => {
      // Rounded because a position is a stored coordinate, and sub-pixel noise from a pointer is not
      // information about where the user put the node.
      void editor.apply(
        moves.map((move) => op.moveTo(move.id, Math.round(move.x), Math.round(move.y))),
        { label: t("Mindmap", "Move") },
      )

      // A second batch, so joining or leaving a group is its own undo. Dragging a node onto a frame
      // is one action to the hand but two to the document, and someone who only wanted the node back
      // where it was should not have to un-join it first.
      const regroup = scene ? regroupOps(scene, moves) : []
      if (regroup.length > 0) {
        void editor.apply(regroup, {
          label: t("Mindmap", regroup.some((change) => change.add) ? "Group" : "Ungroup"),
        })
      }
    },
    [editor, scene, t],
  )

  const boxes = useMemo(() => {
    const index = new Map<string, PlacedBox>()
    for (const element of scene?.elements ?? []) {
      index.set(element.id, {
        x: element.x,
        y: element.y,
        width: element.width,
        height: element.height,
      })
    }
    return index
  }, [scene])

  const commitResize = useCallback(
    (id: string, box: ResizeBox) => {
      // Rounded for the same reason a move is: a stored size is a number someone will read back, and
      // the fractional part of it is the pointer's noise rather than anything anyone meant.
      const ops: MindmapOp[] = [op.set(id, { wh: [Math.round(box.width), Math.round(box.height)] })]
      // Every grip but the bottom-right one moves the anchor too, and a size committed without its
      // position would slide the box out from under the corner that was not being held.
      const before = boxes.get(id)
      if (
        !before ||
        Math.round(before.x) !== Math.round(box.x) ||
        Math.round(before.y) !== Math.round(box.y)
      ) {
        ops.push(op.moveTo(id, Math.round(box.x), Math.round(box.y)))
      }
      void editor.apply(ops, { label: t("Mindmap", "Resize") })
    },
    [boxes, editor, t],
  )

  /**
   * Where a new child of this node goes.
   *
   * Worked out here rather than left to the server, because layout is freeform until Arrange and a
   * node the server places at no position lands on the origin, on top of the root. Both of the ways
   * to gain a child, typing one and pasting one, ask this.
   */
  const childSpot = useCallback(
    (parentId: string): Point | null => {
      const parent = hierarchy && boxes.get(parentId)
      if (!hierarchy || !parent) {
        return null
      }
      const grandparentId = hierarchy.byId.get(parentId)?.parentId ?? null
      const siblings: PlacedBox[] = []
      for (const childId of childrenIds(hierarchy, parentId)) {
        const box = boxes.get(childId)
        if (box) {
          siblings.push(box)
        }
      }
      return placeChild(
        parent,
        grandparentId ? (boxes.get(grandparentId) ?? null) : null,
        siblings,
        NEW_NODE_SIZE,
      )
    },
    [boxes, hierarchy],
  )

  /** The middle of what is on screen, in canvas coordinates. Where something with nothing to hang off goes. */
  const viewportCentre = useCallback((): Point => {
    const bounds = stage.current?.getBoundingClientRect()
    const canvas = runtime.current
    if (!bounds || !canvas) {
      return { x: 0, y: 0 }
    }
    return canvas.toCanvas(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2)
  }, [])

  /** Adds a child and puts the caret in it. */
  const addChild = useCallback(
    async (parentId: string) => {
      const at = childSpot(parentId)
      if (!at) {
        return
      }
      const result = await editor.apply(
        // Unpinned: the spot is only there so the node does not land on the origin, and a guess
        // should not outrank the layout the way a position someone dragged it to does.
        [op.addNodes([{ ref: "n", t: "", xy: [at.x, at.y], pin: false }], parentId)],
        { label: t("Mindmap", "AddNode") },
      )

      const created = result?.createdIds?.n
      if (created) {
        blank.current = created
        setSelection(selectOnly("element", created))
        setEditing(created)
      }
    },
    [childSpot, editor, t],
  )

  /** A sibling is a child of the same parent. A node with no parent gets a child instead. */
  const addSibling = useCallback(
    (id: string) => {
      const parentId = hierarchy?.byId.get(id)?.parentId ?? null
      return addChild(parentId ?? id)
    },
    [addChild, hierarchy],
  )

  const endEdit = useCallback(
    (id: string, text: string | null) => {
      setEditing(null)
      const wasBlank = blank.current === id
      blank.current = null
      const typed = text?.trim() ?? ""

      if (typed === "") {
        // A node created for this edit and never given a label is a box nobody asked for. One that
        // already had a label keeps it, because emptying a node is what Delete is for.
        if (wasBlank) {
          void editor.apply([op.del([id])], { label: t("Mindmap", "Delete") })
        }
        return
      }
      if (typed === currentText(scene, id)) {
        return
      }
      void editor.apply([op.set(id, { t: typed })], { label: t("Mindmap", "Rename") })
    },
    [editor, scene, t],
  )

  /**
   * Opens a node's label for typing, unless it has no label of its own.
   *
   * A note or deck reference reads as its target's title, which is the target's to change; and the
   * edit protocol's text slot for those two kinds is a plain-text conversion, so committing one
   * would quietly replace the reference with the words it happened to be showing. They are not
   * editable here at all. A link, which does have a title of its own, still is.
   */
  const beginEdit = useCallback(
    (id: string) => {
      const kind = scene?.elements.find((candidate) => candidate.id === id)?.content.$type
      if (kind === "note" || kind === "flashcard") {
        return
      }
      setEditing(id)
    },
    [scene],
  )

  /**
   * A double click, which is how a label asks to be edited, except on a reference: there it opens
   * what the node points at, which is the thing anyone double clicking one is after.
   */
  const activate = useCallback(
    (id: string) => {
      const content = scene?.elements.find((candidate) => candidate.id === id)?.content
      if (content && isFollowable(content)) {
        followRef(content)
        return
      }
      beginEdit(id)
    },
    [beginEdit, scene],
  )

  /**
   * A press on a node's own chrome rather than on the node.
   *
   * Every part acts at once and leaves the selection alone. Ticking a box is not selecting the node
   * the box is on, a reference's mark is a way to leave the map rather than a way to pick something
   * on it, and letting a pin go is a thing you do to a node you can already see.
   */
  const pressChrome = useCallback(
    (id: string, part: NodeChrome) => {
      const content = scene?.elements.find((candidate) => candidate.id === id)?.content
      if (!content) {
        return
      }
      if (part === "ref") {
        followRef(content)
        return
      }
      if (part === "pin") {
        void editor.apply([op.set(id, { pinned: false })], { label: t("Mindmap", "TogglePin") })
        return
      }
      if (content.$type === "task") {
        void editor.apply([op.set(id, { content: { ...content, done: content.done !== true } })], {
          label: t("Mindmap", "ToggleTask"),
        })
      }
    },
    [editor, scene, t],
  )

  /**
   * Turns the selected node into a different kind of node.
   *
   * The words come with it, because they are what is on screen and nobody converting a line into a
   * task meant to lose the line. Four kinds are made of nothing else and land straight away. The
   * other three point at something, which is a question rather than a conversion: a link is asked
   * for as an address, and the two reference kinds open the picker on their own library.
   *
   * An address that will not open is refused rather than stored. The gate is the same function that
   * follows a link, so a link node that exists is a link node that goes somewhere.
   */
  const changeKind = useCallback(
    async (kind: NodeKind) => {
      const id = selection.primary?.kind === "element" ? selection.primary.id : null
      const element = id ? scene?.elements.find((candidate) => candidate.id === id) : null
      if (!id || !element || nodeKindOf(element.content) === kind) {
        return
      }

      const carried = carriedText(element.content, refs)
      const step = { label: t("Mindmap", "ChangeType") }

      if (isPlainKind(kind)) {
        void editor.apply([op.set(id, { content: plainContent(kind, carried) })], step)
        return
      }
      if (kind !== "link") {
        setPicking({ id, target: kind })
        return
      }

      const typed = await dialog.prompt({
        title: t("Mindmap", "LinkUrlTitle"),
        message: t("Mindmap", "LinkUrlDescription"),
        // Only when the node is already showing an address, which is the paste-then-convert route.
        // Anything looser guesses, and a guess here becomes the stored destination.
        defaultValue: /^https?:\/\//i.test(carried) ? carried : "",
        placeholder: "https://",
        confirmLabel: t("Mindmap", "Save"),
        cancelLabel: t("Mindmap", "Cancel"),
      })
      if (typed === null) {
        return
      }

      const url = absoluteUrl(typed)
      if (!url) {
        toast.warning(t("Mindmap", "LinkUrlRejected"), {
          description: t("Mindmap", "LinkUrlDescription"),
        })
        return
      }
      void editor.apply([op.set(id, { content: linkContent(url, carried) })], step)
    },
    [editor, refs, scene, selection, t],
  )

  /** What the picker came back with. It lands on the node the picker was opened for. */
  const pickRef = useCallback(
    (targetId: string) => {
      if (!picking) {
        return
      }
      const content: ElementContent =
        picking.target === "note"
          ? { $type: "note", noteId: targetId }
          : { $type: "flashcard", deckId: targetId }
      void editor.apply([op.set(picking.id, { content })], { label: t("Mindmap", "ChangeType") })
      setPicking(null)
    },
    [editor, picking, t],
  )

  /**
   * Puts a new element where the pointer said, and hands the map back to the select tool.
   *
   * A planted element belongs to nothing: it is its own cluster with no parent, which is what makes
   * it different from Tab's child. Its position is the click, so nothing has to be worked out.
   */
  const plant = useCallback(
    async (armed: MindmapTool, at: Point) => {
      setTool("select")
      const xy: [number, number] = [Math.round(at.x), Math.round(at.y)]
      const result = await editor.apply([plantOp(armed, xy, shape)], {
        label: t("Mindmap", PLANT_LABEL[armed] ?? "AddNode"),
      })

      const created = result?.createdIds?.n
      if (created) {
        // A shape with no label is still a shape someone meant to draw, so it is not taken back the
        // way an unlabelled node is.
        blank.current = armed === "shape" ? null : created
        setSelection(selectOnly("element", created))
        setEditing(created)
      }
    },
    [editor, shape, t],
  )

  /**
   * Puts a frame around whatever the sweep caught.
   *
   * The box is worked out here rather than left to the server, with the helper the projector uses,
   * because a frame's drawn bounds come from its members: a stored box that disagreed would jump the
   * first time anything inside it moved.
   */
  const group = useCallback(
    async (ids: readonly string[]) => {
      setTool("select")
      const caught = new Set(ids)
      const members: string[] = []
      const memberBoxes: FrameMemberBox[] = []
      // Walked in document order rather than in the order the sweep found them, so the membership
      // list reads the same way the map does.
      for (const element of scene?.elements ?? []) {
        if (caught.has(element.id)) {
          members.push(element.id)
          memberBoxes.push(element)
        }
      }

      const box = frameBox(memberBoxes)
      if (!box) {
        return
      }
      const result = await editor.apply(
        [
          op.addElement(
            "frame",
            Math.round(box.x),
            Math.round(box.y),
            { $type: "frame", title: "", childIds: members },
            { ref: "n", wh: [Math.round(box.width), Math.round(box.height)] },
          ),
        ],
        { label: t("Mindmap", "Group") },
      )

      const created = result?.createdIds?.n
      if (created) {
        // Straight into the title, since a group is a thing someone made in order to call it
        // something. Left unnamed it is still a group, so this edit is not one that takes it back.
        setSelection(selectOnly("element", created))
        setEditing(created)
      }
    },
    [editor, scene, t],
  )

  /**
   * Links two nodes, or unlinks them if they are already linked.
   *
   * The prototype's connect gesture could only add, and taking a connector away meant selecting the
   * line and pressing Delete. Drawing the same connector twice is not a thing anyone means, so the
   * second draw is the natural place to put the undo.
   */
  const connect = useCallback(
    (fromId: string, toId: string) => {
      setTool("select")
      const existing = (map.data?.edges ?? []).find(
        (edge) =>
          (edge.fromId === fromId && edge.toId === toId) ||
          (edge.fromId === toId && edge.toId === fromId),
      )
      if (existing) {
        void editor.apply([op.unlinkEdge(existing.id)], { label: t("Mindmap", "Disconnect") })
        return
      }
      void editor.apply([op.link(fromId, toId, { style: connectStyle })], {
        label: t("Mindmap", "Connect"),
      })
    },
    [connectStyle, editor, map.data, t],
  )

  /**
   * Hands the whole map to the layout engine.
   *
   * The sizes go with it. Every node is as wide as its rendered text and the server has never seen
   * the font, so the measurements the projector already made are the only honest ones there are.
   *
   * A named arrangement is chosen and applied in one step: the server writes it onto every cluster
   * in the same batch as the moves it produced, so one undo puts back both.
   */
  const arrange = useCallback(
    (algorithm?: LayoutAlgorithm) => {
      const sizes: Record<string, [number, number]> = {}
      for (const element of scene?.elements ?? []) {
        sizes[element.id] = [element.width, element.height]
      }
      void editor.arrange(sizes, { label: t("Mindmap", "Layout") }, algorithm)
    },
    [editor, scene, t],
  )

  /** What the whole map looks like, as opposed to what one selected thing looks like. */
  const mapStyle = useCallback(
    (patch: Parameters<typeof op.layout>[0]) => {
      void editor.apply([op.layout(patch)], { label: t("Mindmap", "StyleMap") })
    },
    [editor, t],
  )

  /**
   * The arrangement to show as chosen.
   *
   * Null when the clusters disagree, which they can: arrangement is a per-cluster setting and a map
   * with two trees can genuinely have one of each. Lighting the first one found would say something
   * untrue about the other.
   */
  const algorithm = useMemo((): LayoutAlgorithm | null => {
    const clusters = map.data?.clusters ?? []
    const named = new Set(clusters.map((cluster) => cluster.layoutAlgorithm).filter(Boolean))
    const only = named.size === 1 ? [...named][0] : null
    return only && (LAYOUT_ALGORITHMS as readonly string[]).includes(only)
      ? (only as LayoutAlgorithm)
      : null
  }, [map.data])

  /** What a copy or a cut would carry off, with each node's subtree under it. */
  const capture = useCallback(
    (placeAt?: Parameters<typeof captureSelection>[3]) =>
      map.data && hierarchy
        ? captureSelection(map.data, hierarchy, selection.elements, placeAt)
        : { ids: [], specs: [] },
    [hierarchy, map.data, selection],
  )

  /**
   * Selects whatever an add op just made.
   *
   * Every spec sent for a paste or a duplicate carries a ref, and nothing else in the batch does, so
   * what comes back is exactly the new tops and not their children. Selecting them is what makes a
   * paste feel like the thing you pasted arrived, and it puts a second press of the same keys where
   * you would expect it.
   */
  const selectCreated = useCallback((result: MindmapOpsResult | null | undefined) => {
    const created = Object.values(result?.createdIds ?? {})
    if (created.length > 0) {
      setSelection(selectElements(created))
    }
  }, [])

  /**
   * Holds a copy of the selection. An empty selection leaves the last copy alone rather than clearing it.
   *
   * Captured where it is drawn, which a paste then moves as one piece. The absolute coordinates are
   * meaningless anywhere else, but the distances between them are the shape of the branch, and that is
   * what a paste has to arrive with.
   */
  const copySelection = useCallback(() => {
    const taken = map.data
      ? capture(offsetPlacement(map.data, scene?.elements ?? [], 0, 0))
      : { ids: [], specs: [] }
    if (taken.specs.length > 0) {
      holdCopy(taken.specs)
    }
    return taken
  }, [capture, map.data, scene])

  const cutSelection = useCallback(() => {
    const taken = copySelection()
    // Only what the copy actually carried. A selection can hold a shape the capture left behind, and
    // a cut that took it away would be removing something nothing is holding on to.
    if (taken.ids.length > 0) {
      void editor.apply([op.del(taken.ids)], { label: t("Mindmap", "Cut") })
    }
  }, [copySelection, editor, t])

  /**
   * Puts the held copy down, under the selected node.
   *
   * Under rather than beside, because a mindmap is written by hanging things off other things and the
   * node you have selected is the one you are working on. With nothing selected it lands in the middle
   * of what is on screen, which is the only other honest answer: a paste has to arrive somewhere you
   * are looking, and off-screen is the same as lost.
   *
   * Placed here rather than left to the server for the reason a new child is, and moved as one piece
   * so the branch keeps its shape. One op for the whole thing however deep it is: the add op plants a
   * nested subtree in a single step, so a paste of forty nodes is one undo.
   */
  const pasteCopy = useCallback(async () => {
    const held = heldCopy()
    if (held.length === 0) {
      return
    }
    const primary = selection.primary?.kind === "element" ? selection.primary.id : null
    const under = scene?.elements.find(
      (candidate) => candidate.id === primary && candidate.kind === "node",
    )
    const at = (under ? childSpot(under.id) : null) ?? viewportCentre()

    const origin = captureOrigin(held)
    const placed = origin ? translated(held, at.x - origin.x, at.y - origin.y) : held
    const result = await editor.apply(
      [op.addNodes(unpinned(placed, under !== undefined).map(withRef), under?.id)],
      { label: t("Mindmap", "Paste") },
    )
    selectCreated(result)
  }, [childSpot, editor, scene, selectCreated, selection, t, viewportCentre])

  /**
   * A second copy of the selection, a step down and to the right of the first.
   *
   * Each one is planted under the parent of what it was copied from, so a duplicated child is a
   * sibling rather than a child of itself. One op per top and one batch, because a selection can span
   * parents and an add op plants under one.
   *
   * The step is what makes it visible as a second thing. A copy sent with no coordinates would land
   * on the origin rather than beside what it came from, and one sent with the same coordinates would
   * sit exactly on top of it, which reads as nothing having happened.
   */
  const duplicateSelection = useCallback(async () => {
    if (!map.data) {
      return
    }
    const taken = capture(offsetPlacement(map.data, scene?.elements ?? [], DUPLICATE_STEP, DUPLICATE_STEP))
    if (taken.specs.length === 0) {
      return
    }
    const result = await editor.apply(
      taken.specs.map((spec, index) => {
        const parentId = hierarchy?.byId.get(taken.ids[index])?.parentId ?? undefined
        return op.addNodes(unpinned([withRef(spec, index)], parentId !== undefined), parentId)
      }),
      { label: t("Mindmap", "Duplicate") },
    )
    selectCreated(result)
  }, [capture, editor, hierarchy, map.data, scene, selectCreated, t])

  const deleteSelection = useCallback(() => {
    const ops: MindmapOp[] = []
    if (selection.elements.size > 0) {
      // One op for the lot: the server takes each node's subtree with it, and a single batch is a
      // single undo.
      ops.push(op.del([...selection.elements]))
    }
    for (const edgeId of selection.edges) {
      ops.push(op.unlinkEdge(edgeId))
    }
    if (ops.length > 0) {
      void editor.apply(ops, { label: t("Mindmap", "Delete") })
    }
  }, [editor, selection, t])

  /**
   * Restyles every selected edge in one step, and everything below it when asked.
   *
   * One op per edge, since an edge style is written to one edge at a time, but one batch: pressing
   * Dashed with four edges selected is one decision and has to be one undo, and so is pressing it
   * with a branch of forty.
   *
   * Taking a style away is a different op from setting one. The protocol merges a patch member by
   * member and reads a missing member as "leave it alone", so there is no value for "unset this";
   * clearing means sending what the edge should keep with the cleared member left out.
   */
  const styleEdges = useCallback(
    (patch: EdgeStyle, deep = false) => {
      const ids = new Set(selection.edges)
      if (ids.size === 0) {
        return
      }

      const data = map.data
      if (deep && data && hierarchy) {
        for (const id of [...ids]) {
          const edge = data.edges?.find((candidate) => candidate.id === id)
          if (edge && edgeKind(edge) === "hierarchy") {
            for (const below of hierarchyEdgesBelow(data, hierarchy, edge.toId)) {
              ids.add(below)
            }
          }
        }
      }

      const clearing = clearsAnything(patch)
      void editor.apply(
        [...ids].map((id) => {
          if (!clearing) {
            return op.setEdge(id, { style: patch })
          }
          const own = data?.edges?.find((candidate) => candidate.id === id)?.style
          return op.setEdge(id, { clear_style: true, style: restyledEdge(own, patch) })
        }),
        { label: t("Mindmap", deep ? "StyleBranch" : "StyleEdge") },
      )
    },
    [editor, hierarchy, map.data, selection, t],
  )

  /** Restyles every selected node. The bulk form exists, so more than one is still a single op. */
  const styleNodes = useCallback(
    (patch: ElementStyle) => {
      const ids = [...selection.elements]
      if (ids.length === 0) {
        return
      }
      void editor.apply([ids.length === 1 ? op.set(ids[0], { style: patch }) : op.styleIds(ids, patch)], {
        label: t("Mindmap", "StyleNode"),
      })
    },
    [editor, selection, t],
  )

  /**
   * Holds every selected node where it is, or hands them all back to the layout.
   *
   * One op per node rather than a bulk form, because there is no bulk form for a pin: it is not a
   * style, and the subtree op only carries styles. A selection is what someone can point at, so the
   * batch is small even when the map is not.
   */
  const pinNodes = useCallback(
    (pinned: boolean) => {
      const ids = [...selection.elements]
      if (ids.length === 0) {
        return
      }
      void editor.apply(
        ids.map((id) => op.set(id, { pinned })),
        { label: t("Mindmap", "TogglePin") },
      )
    },
    [editor, selection, t],
  )

  /**
   * The branch swatch, or null when this selection has no branch to recolour.
   *
   * Only ever offered for a single node, and never for a root. A multi-selection can span several
   * branches, and "recolour every branch these happen to be in" is not what one swatch reads as.
   */
  const branch = useMemo((): BranchControl | null => {
    if (!hierarchy || !scene || selection.elements.size !== 1) {
      return null
    }
    const id = selection.primary?.kind === "element" ? selection.primary.id : null
    const element = id ? scene.elements.find((candidate) => candidate.id === id) : null
    const rootId = id ? branchRootOf(hierarchy, id) : null
    if (!element || !rootId) {
      return null
    }
    return {
      slot: branchSwatchOf(element),
      // Down the whole branch rather than onto the one node, because a branch's colour is the thing
      // being set and a branch is a subtree. The cascade reads it back off the same override.
      onPick: (index) =>
        void editor.apply([op.styleSubtree(rootId, { stroke: branchToken(index) })], {
          label: t("Mindmap", "BranchColor"),
        }),
    }
  }, [editor, hierarchy, scene, selection, t])

  /**
   * The one selected node, or null when there is not exactly one.
   *
   * Two controls hang off this, for the same reason the branch swatch does. A capture reads a
   * subtree from one root, and a kind change rewrites one node's content and may have to ask what
   * it should point at; a selection spanning several has no single answer to either.
   */
  const soleNode =
    selection.elements.size === 1 && selection.primary?.kind === "element" ? selection.primary.id : null

  const minimap = useMinimapShown((scene?.elements.length ?? 0) > 0)

  const removeTemplate = useDeleteMindmapTemplate()

  const deleteTemplate = useCallback(
    async (template: StyleTemplate) => {
      const ok = await dialog.confirm({
        title: t("Mindmap", "DeleteTemplateTitle"),
        message: t("Mindmap", "DeleteTemplateMessage").replace("{0}", template.name),
        destructive: true,
        confirmLabel: t("Mindmap", "Delete"),
        cancelLabel: t("Mindmap", "Cancel"),
      })
      if (!ok) {
        return
      }
      try {
        await removeTemplate.mutateAsync(template.id)
      } catch (error) {
        toast.warning(t("Mindmap", "ErrorTitle"), {
          description: error instanceof Error ? error.message : undefined,
        })
      }
    },
    [removeTemplate, t],
  )

  /**
   * Saving the map as a file.
   *
   * The scene rather than the document, because a picture of a map is a picture of what is on the
   * screen: a collapsed branch is not in it, and a box is the size its label came out at here. The
   * outline ignores all of that and is fetched from the server instead.
   */
  const runExport = useCallback(
    async (format: MapExportFormat, transparent: boolean) => {
      if (!scene || !mapId) {
        return
      }
      try {
        await exportMap(format, { id: mapId, title: map.data?.title ?? "", scene, transparent })
      } catch (error) {
        toast.warning(t("Mindmap", "ExportFailedTitle"), {
          description: error instanceof Error ? error.message : undefined,
        })
      }
    },
    [map.data?.title, mapId, scene, t],
  )

  const endEdgeLabel = useCallback(
    (id: string, text: string | null) => {
      setEditingEdge(null)
      if (text === null) {
        return
      }
      const typed = text.trim()
      const edge = scene?.edges.find((candidate) => candidate.id === id)
      // An unchanged label costs no revision and no undo step. An emptied one is sent, because an
      // empty string is how the edit protocol says to take a label away.
      if (!edge || (edge.label ?? "") === typed) {
        return
      }
      void editor.apply([op.setEdge(id, { label: typed })], { label: t("Mindmap", "EditLabel") })
    },
    [editor, scene, t],
  )

  /** What a sector does. Everything here is something the map already answers to. */
  const onRadial = useCallback(
    (id: string) => {
      const primary = selection.primary?.kind === "element" ? selection.primary.id : null
      switch (id) {
        case "child":
          if (primary) void addChild(primary)
          return
        case "sibling":
          if (primary) void addSibling(primary)
          return
        case "edit":
          if (primary) beginEdit(primary)
          return
        case "collapse":
          if (primary) {
            void editor.apply([op.set(primary, { collapsed: !collapsed(scene, primary) })], {
              label: t("Mindmap", "ToggleCollapse"),
            })
          }
          return
        case "delete":
          deleteSelection()
          return
        case "connect":
          setTool("connect")
          return
        case "node":
        case "text":
        case "shape":
          // Armed rather than planted: the ring closes under the pointer, and planting there would
          // put a node exactly where the hand was resting rather than where it is about to point.
          setTool(id)
          return
        case "arrange":
          arrange()
          return
        case "fit":
          runtime.current?.fit()
          return
        default:
          return
      }
    },
    [addChild, addSibling, arrange, beginEdit, deleteSelection, editor, scene, selection, t],
  )

  /**
   * The keyboard, as the catalog defines it.
   *
   * Nothing here decides which key does what. The press is resolved to one of the module's actions
   * first and this only says what each action does, which is what makes every one of them
   * rebindable from Settings and what keeps the map's shortcuts in the one list the app shows.
   */
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (isTyping(event.target)) {
        return
      }

      // The ring owns the keyboard while it is up. It reads its own release from the window, and
      // everything else the map answers to would be a second thing happening inside one gesture.
      if (radial) {
        return
      }

      const hit = actionFor(event.nativeEvent)
      if (!hit) {
        return
      }

      const tooled = TOOL_OF_ACTION[hit.actionId]
      if (tooled) {
        event.preventDefault()
        setTool(tooled)
        return
      }

      const primary = selection.primary?.kind === "element" ? selection.primary.id : null

      switch (hit.actionId) {
        case "mindmap.radial":
          // Hold, flick, release. Guarded on the repeat because holding a key fires it about thirty
          // times a second, and each one would reopen the ring around a pointer that had moved on.
          if (!event.repeat) {
            event.preventDefault()
            setRadial({ at: pointer.current, key: parseChord(hit.chord).key })
          }
          return

        // Tab and Enter are the outliner's two moves, and they are why a mindmap is faster to write
        // than a diagram. Both are only reached when nothing is being typed into, since the guard
        // above hands every key to the field while one is open.
        case "mindmap.add-child":
          event.preventDefault()
          if (primary) void addChild(primary)
          return
        case "mindmap.enter":
          event.preventDefault()
          if (primary) void addSibling(primary)
          return
        case "mindmap.edit-edge-label":
          event.preventDefault()
          // A selected edge is what the label belongs to; with a node selected it is the node's own
          // text, since that is the label in front of whoever pressed the key.
          if (selection.primary?.kind === "edge") {
            setEditingEdge(selection.primary.id)
          } else if (primary) {
            beginEdit(primary)
          }
          return

        case "mindmap.undo":
          event.preventDefault()
          editor.undo()
          return
        case "mindmap.redo":
          event.preventDefault()
          editor.redo()
          return
        case "mindmap.select-all":
          event.preventDefault()
          setSelection(selectElements(scene?.elements.map((element) => element.id) ?? []))
          return

        case "mindmap.copy":
          event.preventDefault()
          copySelection()
          return
        case "mindmap.cut":
          event.preventDefault()
          cutSelection()
          return
        case "mindmap.paste":
          event.preventDefault()
          void pasteCopy()
          return
        case "mindmap.duplicate":
          event.preventDefault()
          void duplicateSelection()
          return

        case "mindmap.delete-selection":
          event.preventDefault()
          deleteSelection()
          return
        case "mindmap.recenter":
          event.preventDefault()
          runtime.current?.fit()
          return
        case "mindmap.clear-selection":
          event.preventDefault()
          // An armed tool first: Escape is "never mind", and the thing most recently asked for is
          // the thing it should take back.
          if (isOneShot(tool)) {
            setTool("select")
            return
          }
          setSelection(EMPTY_SELECTION)
          return

        default:
          return
      }
    },
    [
      actionFor,
      addChild,
      addSibling,
      beginEdit,
      copySelection,
      cutSelection,
      deleteSelection,
      duplicateSelection,
      editor,
      pasteCopy,
      radial,
      scene,
      selection,
      tool,
    ],
  )

  if (map.isError) {
    return <Notice icon="triangle-alert" title={t("Mindmap", "MapNotFound")} />
  }
  if (!scene) {
    return <Notice icon="loader-circle" spinning title={t("Mindmap", "Loading")} />
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-canvas" onKeyDown={onKeyDown}>
      <header className="flex shrink-0 items-center gap-2 px-4 py-2.5">
        <h1 className="truncate text-[13.5px] font-medium text-ink">
          {map.data?.title || t("Mindmap", "UntitledMap")}
        </h1>
        <span className="text-[11.5px] text-ink-3">
          {t("Mindmap", "NodeCountFormat").replace("{0}", String(scene.elements.length))}
        </span>

        <div className="ml-auto flex items-center gap-1">
          <MapStyleMenu
            algorithm={algorithm}
            onAlgorithm={arrange}
            onArrange={arrange}
            canArrange={scene.elements.length > 0}
            material={materialOf(map.data?.canvas?.edgeDefaults)}
            onMaterial={(next) => mapStyle({ edge_defaults: edgeDefaultsFor(next) })}
            templates={styling?.templates ?? []}
            templateId={map.data?.canvas?.defaultTemplateId ?? styling?.defaultId ?? null}
            onTemplate={(id) => mapStyle({ template: id })}
            builtInIds={styling?.builtInIds ?? []}
            onDeleteTemplate={(template) => void deleteTemplate(template)}
            background={scene.background}
            onBackground={(next) => mapStyle({ background: next })}
          />
          <ExportMenu
            canExport={scene.elements.length > 0}
            onExport={(format, transparent) => void runExport(format, transparent)}
          />
          <Button
            variant="ghost"
            size="sm"
            disabled={!editor.canUndo}
            onClick={editor.undo}
            title={editor.undoLabel ?? t("Mindmap", "UndoTooltip")}
            aria-label={t("Mindmap", "Undo")}
          >
            <AppIcon name="common/undo" size={15} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={!editor.canRedo}
            onClick={editor.redo}
            title={editor.redoLabel ?? t("Mindmap", "RedoTooltip")}
            aria-label={t("Mindmap", "Redo")}
          >
            {/* Redo is undo the other way round. The icon set ships one arrow, and mirroring it is
                what the desktop does rather than carrying a second file that is the same drawing. */}
            <AppIcon name="common/undo" size={15} className="-scale-x-100" />
          </Button>
        </div>
      </header>

      {/* The dock and the ring float inside this, not under it, so the map keeps the whole pane. */}
      <div
        ref={stage}
        className="relative min-h-0 flex-1"
        onPointerMove={(event) => {
          const bounds = stage.current?.getBoundingClientRect()
          if (bounds) {
            pointer.current = { x: event.clientX - bounds.left, y: event.clientY - bounds.top }
          }
        }}
      >
        <MindmapCanvas
          scene={scene}
          runtimeRef={runtime}
          selection={selection}
          onSelection={setSelection}
          onCommitMove={commitMove}
          onCommitResize={commitResize}
          onActivate={activate}
          onChrome={pressChrome}
          editingId={editing}
          onEditEnd={endEdit}
          editingEdgeId={editingEdge}
          onEdgeLabelEnd={endEdgeLabel}
          subtreeOf={subtreeOf}
          tool={tool}
          onPlant={(armed, at) => void plant(armed, at)}
          onGroup={(ids) => void group(ids)}
          onConnect={connect}
          onCameraSettled={(viewport) => setZoom(viewport.zoom)}
        />

        {/* Not while a label is being typed: the bar would sit over the field, and none of what it
            offers is a thing anyone reaches for mid-word. */}
        {editing === null && editingEdge === null ? (
          <MindmapSelectionBar
            scene={scene}
            selection={selection}
            runtime={runtime}
            pane={stage}
            onEdgeStyle={styleEdges}
            onNodeStyle={styleNodes}
            onEdgeLabel={setEditingEdge}
            branch={branch}
            onKind={soleNode ? (kind) => void changeKind(kind) : null}
            onSaveTemplate={soleNode ? () => setCapturing(soleNode) : null}
            onPin={pinNodes}
          />
        ) : null}

        <MindmapToolDock
          tool={tool}
          onTool={setTool}
          zoom={zoom}
          onZoomBy={(factor) => runtime.current?.zoomBy(factor)}
          // Through the same anchored arithmetic every other zoom uses, so a reset lands on exactly
          // 1 and leaves the middle of the view where it was.
          onZoomReset={() => runtime.current?.zoomBy(1 / (runtime.current?.viewport().zoom ?? 1))}
          onFit={() => runtime.current?.fit()}
          shape={shape}
          onShape={setShape}
          connectStyle={connectStyle}
          onConnectStyle={(patch) => setConnectStyle((current) => ({ ...current, ...patch }))}
        />

        {minimap ? <MindmapMinimap scene={scene} runtime={runtime} pane={stage} /> : null}

        {radial ? (
          <RadialMenu
            sectors={selection.elements.size > 0 ? ON_NODE : ON_CANVAS}
            at={radial.at}
            holdKey={radial.key}
            onPick={onRadial}
            onClose={() => setRadial(null)}
          />
        ) : null}
      </div>

      {scene.elements.length === 0 ? (
        // Reachable by emptying a map, and it has to say so: an empty canvas and a broken one look
        // identical, and the one thing the user cannot tell from the outside is which they have.
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="flex flex-col items-center gap-2 text-ink-3">
            <AppIcon name="common/sitemap" size={22} />
            <p className="text-[13px]">{t("Mindmap", "MapIsEmpty")}</p>
          </div>
        </div>
      ) : null}

      <SaveTemplateDialog mapId={mapId ?? ""} rootId={capturing} onClose={() => setCapturing(null)} />

      <RefPicker target={picking?.target ?? null} onPick={pickRef} onClose={() => setPicking(null)} />

      {editor.rejected ? (
        <Pill>{t("Mindmap", "EditRejected")}</Pill>
      ) : templates.isError ? (
        // Said rather than swallowed. The map is drawn, but every node is a neutral card and every
        // branch is grey, and a map that looks like that for a reason nobody mentioned reads as a
        // rendering fault rather than as a library that could not be read.
        <Pill>{t("Mindmap", "TemplatesUnavailable")}</Pill>
      ) : null}
    </div>
  )
}

/** What an armed tool creates, and what the undo entry for it is called. */
const PLANT_LABEL: Partial<Record<MindmapTool, string>> = {
  node: "AddNode",
  text: "AddText",
  shape: "ToolShape",
}

function plantOp(tool: MindmapTool, xy: [number, number], shape: ShapeType): MindmapOp {
  if (tool === "shape") {
    return op.addElement("shape", xy[0], xy[1], { $type: "shape", shape }, {
      ref: "n",
      // Sized up front, since a shape is a region rather than a box measured around its text, and
      // the projector has no label to measure one from.
      wh: NEW_SHAPE_SIZE,
    })
  }
  if (tool === "text") {
    return op.addElement("text", xy[0], xy[1], { $type: "freeText", text: "" }, { ref: "n" })
  }
  return op.addNodes([{ ref: "n", t: "", xy }])
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <p className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-canvas px-3 py-1 text-[11.5px] text-ink-2 shadow-[0_0_0_1px_var(--line)]">
      {children}
    </p>
  )
}

function Notice({ icon, title, spinning }: { icon: string; title: string; spinning?: boolean }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-ink-3">
      <AppIcon name={icon} size={20} strokeWidth={1.5} className={spinning ? "animate-spin" : undefined} />
      <p className="text-[13px]">{title}</p>
    </div>
  )
}

/** Whether this node is already collapsed, so the ring's one control toggles rather than only closes. */
function collapsed(scene: { elements: readonly { id: string; collapsed?: boolean }[] } | null, id: string): boolean {
  return scene?.elements.find((element) => element.id === id)?.collapsed === true
}

/** The text slot as it stands, so an edit that changed nothing costs no revision and no undo step. */
function currentText(scene: Scene | null, id: string): string {
  const element = scene?.elements.find((candidate) => candidate.id === id)
  // The same slot `t` writes back into: a code node's source, a link's title, a frame's heading.
  // Reading `text` alone answered "" for half the kinds, so an edit that changed nothing still cost
  // a revision on every one of them.
  return element ? (contentText(element.content) ?? "") : ""
}

/**
 * Who changed hands in a drag: what was dropped into a frame, and what was taken out of one.
 *
 * Joining asks for the whole element to be inside the frame and leaving asks for none of it to be,
 * so a member left straddling the edge stays a member and a stranger overlapping a corner does not
 * become one. Both are measured against the frame as it was drawn when the drop happened, since its
 * box comes from its members and would otherwise already have grown around whatever was let go
 * beside it.
 */
function regroupOps(scene: Scene, moves: readonly MovedElement[]): FrameOp[] {
  const frames = scene.elements.filter((element) => element.kind === "frame")
  if (frames.length === 0) {
    return []
  }

  const byId = new Map(scene.elements.map((element) => [element.id, element] as const))
  const moved = new Set(moves.map((move) => move.id))
  const memberOf = new Map<string, string>()
  for (const frame of frames) {
    for (const id of (frame.content as FrameContent).childIds ?? []) {
      if (!memberOf.has(id)) {
        memberOf.set(id, frame.id)
      }
    }
  }

  const joined = new Map<string, string[]>()
  const left = new Map<string, string[]>()
  const note = (into: Map<string, string[]>, frameId: string, id: string) => {
    const list = into.get(frameId)
    if (list) {
      list.push(id)
    } else {
      into.set(frameId, [id])
    }
  }

  for (const move of moves) {
    const element = byId.get(move.id)
    if (!element || element.kind === "frame") {
      continue
    }
    const was = memberOf.get(move.id) ?? null
    // Its frame travelled with it, which is the group being moved rather than anything leaving it.
    if (was && moved.has(was)) {
      continue
    }

    const dropped = { x: move.x, y: move.y, width: element.width, height: element.height }
    let home: SceneElement | null = null
    for (const frame of frames) {
      // Frames do not nest, so overlapping ones are the only way an element sits inside two. The
      // smaller is the one someone aimed at; the larger is the one that happens to be behind it.
      if (moved.has(frame.id) || !contains(frame, dropped)) {
        continue
      }
      if (!home || frame.width * frame.height < home.width * home.height) {
        home = frame
      }
    }

    if (home && home.id !== was) {
      note(joined, home.id, move.id)
    }
    const old = was ? byId.get(was) : null
    if (old && old.id !== home?.id && (home || !overlaps(old, dropped))) {
      note(left, old.id, move.id)
    }
  }

  const ops: FrameOp[] = []
  for (const frame of frames) {
    const add = joined.get(frame.id)
    const remove = left.get(frame.id)
    if (add || remove) {
      ops.push(op.frame(frame.id, { add, remove }))
    }
  }
  return ops
}

function contains(outer: FrameMemberBox, inner: FrameMemberBox): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  )
}

function overlaps(a: FrameMemberBox, b: FrameMemberBox): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

/** Keys belong to whatever is being typed into, not to the map behind it. */
function isTyping(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  if (!element) {
    return false
  }
  return (
    element.isContentEditable ||
    element.tagName === "INPUT" ||
    element.tagName === "TEXTAREA" ||
    element.tagName === "SELECT"
  )
}
