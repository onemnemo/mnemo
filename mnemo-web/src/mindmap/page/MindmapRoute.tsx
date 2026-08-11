import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { AppIcon } from "@/components/icon/AppIcon"
import { Button } from "@/components/ui/button"
import { useT } from "@/i18n/useT"

import { useMindmap, useMindmapTemplates, type MindmapTemplates } from "../api"
import { MindmapCanvas } from "../canvas/MindmapCanvas"
import type { CanvasRuntime } from "../canvas/runtime"
import type { ConnectStyle } from "../chrome/ConnectFlyout"
import { MindmapToolDock } from "../chrome/MindmapToolDock"
import { useMindmapEditor } from "../edit/useMindmapEditor"
import { placeChild, type PlacedBox } from "../edit/placement"
import type { MovedElement } from "../interaction/controller"
import { EMPTY_SELECTION, retain, selectElements, selectOnly, type Selection } from "../interaction/selection"
import { isOneShot, TOOL_KEYS, type MindmapTool } from "../interaction/tool"
import type { ShapeType } from "../model/document"
import { op, type MindmapOp } from "../model/ops"
import type { Point } from "../model/scene"
import { analyzeHierarchy, childrenIds, descendantsOf } from "../scene/hierarchy"
import { projectScene } from "../scene/project"

/** No rules at all: every node falls through to the theme. Stable, so it does not reproject a scene. */
const EMPTY_TEMPLATES: MindmapTemplates = { defaultId: "", templates: [] }

const NO_SUBTREE: readonly string[] = []

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
  const runtime = useRef<CanvasRuntime | null>(null)
  const [selection, setSelection] = useState<Selection>(EMPTY_SELECTION)
  const [editing, setEditing] = useState<string | null>(null)
  const [tool, setTool] = useState<MindmapTool>("select")
  const [zoom, setZoom] = useState(1)
  const [shape, setShape] = useState<ShapeType>("rectangle")
  const [connectStyle, setConnectStyle] = useState(DEFAULT_CONNECT)
  /** The node this edit created. Abandoning the edit takes it away again. */
  const blank = useRef<string | null>(null)

  // Waits for the templates to settle, not to succeed. They style a map rather than make one, so a
  // library that cannot be read costs the map its template rules and nothing else; refusing to draw
  // until they arrive turns a styling problem into a blank page that says "Loading" forever.
  const styling = templates.isPending ? null : (templates.data ?? EMPTY_TEMPLATES)

  const scene = useMemo(() => {
    if (!map.data || !styling) {
      return null
    }
    return projectScene(map.data, {
      templates: styling.templates,
      defaultTemplateId: styling.defaultId,
    })
  }, [map.data, styling])

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
    },
    [editor, t],
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

  /**
   * Adds a child and puts the caret in it.
   *
   * The position is worked out here rather than left to the server, because layout is freeform until
   * Arrange and a node the server places at no position lands on the origin, on top of the root.
   */
  const addChild = useCallback(
    async (parentId: string) => {
      const parent = hierarchy && boxes.get(parentId)
      if (!hierarchy || !parent) {
        return
      }
      const grandparentId = hierarchy.byId.get(parentId)?.parentId ?? null
      const siblings: PlacedBox[] = []
      for (const childId of childrenIds(hierarchy, parentId)) {
        const box = boxes.get(childId)
        if (box) {
          siblings.push(box)
        }
      }

      const at = placeChild(
        parent,
        grandparentId ? (boxes.get(grandparentId) ?? null) : null,
        siblings,
        NEW_NODE_SIZE,
      )
      const result = await editor.apply(
        [op.addNodes([{ ref: "n", t: "", xy: [at.x, at.y] }], parentId)],
        { label: t("Mindmap", "AddNode") },
      )

      const created = result?.createdIds?.n
      if (created) {
        blank.current = created
        setSelection(selectOnly("element", created))
        setEditing(created)
      }
    },
    [boxes, editor, hierarchy, t],
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
   */
  const arrange = useCallback(() => {
    const sizes: Record<string, [number, number]> = {}
    for (const element of scene?.elements ?? []) {
      sizes[element.id] = [element.width, element.height]
    }
    void editor.arrange(sizes, { label: t("Mindmap", "Layout") })
  }, [editor, scene, t])

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

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (isTyping(event.target)) {
        return
      }
      const modified = event.ctrlKey || event.metaKey
      const key = event.key.toLowerCase()
      const primary = selection.primary?.kind === "element" ? selection.primary.id : null

      // One letter each, no modifier, which is what makes a tool worth switching to for one node.
      // Checked before anything else claims a bare letter.
      if (!modified && !event.altKey && TOOL_KEYS[key]) {
        event.preventDefault()
        setTool(TOOL_KEYS[key])
        return
      }

      // Tab and Enter are the outliner's two moves, and they are why a mindmap is faster to write
      // than a diagram. Both are only reached when nothing is being typed into, since the guard
      // above hands every key to the field while one is open.
      if (!modified && primary && (event.key === "Tab" || event.key === "Enter" || event.key === "F2")) {
        event.preventDefault()
        if (event.key === "Tab") {
          void addChild(primary)
        } else if (event.key === "Enter") {
          void addSibling(primary)
        } else {
          setEditing(primary)
        }
        return
      }

      if (modified && key === "z") {
        event.preventDefault()
        if (event.shiftKey) {
          editor.redo()
        } else {
          editor.undo()
        }
        return
      }
      if (modified && key === "y") {
        event.preventDefault()
        editor.redo()
        return
      }
      if (modified && key === "a") {
        event.preventDefault()
        setSelection(selectElements(scene?.elements.map((element) => element.id) ?? []))
        return
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault()
        deleteSelection()
        return
      }
      if (event.key === "Escape") {
        // An armed tool first: Escape is "never mind", and the thing most recently asked for is the
        // thing it should take back.
        if (isOneShot(tool)) {
          setTool("select")
          return
        }
        setSelection(EMPTY_SELECTION)
      }
    },
    [addChild, addSibling, deleteSelection, editor, scene, selection, tool],
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
          <Button
            variant="ghost"
            size="sm"
            onClick={arrange}
            disabled={scene.elements.length === 0}
            title={t("Mindmap", "LayoutTooltip")}
          >
            <AppIcon name="common/sitemap" size={15} className="mr-1.5" />
            {t("Mindmap", "Layout")}
          </Button>
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

      {/* The dock floats inside this, not under it, so the map keeps the whole pane. */}
      <div className="relative min-h-0 flex-1">
        <MindmapCanvas
          scene={scene}
          runtimeRef={runtime}
          selection={selection}
          onSelection={setSelection}
          onCommitMove={commitMove}
          onActivate={setEditing}
          editingId={editing}
          onEditEnd={endEdit}
          subtreeOf={subtreeOf}
          tool={tool}
          onPlant={(armed, at) => void plant(armed, at)}
          onConnect={connect}
          onCameraSettled={(viewport) => setZoom(viewport.zoom)}
        />

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

/** The label as it stands, so an edit that changed nothing costs no revision and no undo step. */
function currentText(scene: { elements: readonly { id: string; content: unknown }[] } | null, id: string): string {
  const element = scene?.elements.find((candidate) => candidate.id === id)
  const content = element?.content as { text?: string } | undefined
  return content?.text ?? ""
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
