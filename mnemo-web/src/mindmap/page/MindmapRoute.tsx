import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { AppIcon } from "@/components/icon/AppIcon"
import { Button } from "@/components/ui/button"
import { useT } from "@/i18n/useT"

import { useMindmap, useMindmapTemplates, type MindmapTemplates } from "../api"
import { MindmapCanvas } from "../canvas/MindmapCanvas"
import type { CanvasRuntime } from "../canvas/runtime"
import { useMindmapEditor } from "../edit/useMindmapEditor"
import type { MovedElement } from "../interaction/controller"
import { EMPTY_SELECTION, retain, selectElements, type Selection } from "../interaction/selection"
import { op, type MindmapOp } from "../model/ops"
import { analyzeHierarchy, descendantsOf } from "../scene/hierarchy"
import { projectScene } from "../scene/project"

/** No rules at all: every node falls through to the theme. Stable, so it does not reproject a scene. */
const EMPTY_TEMPLATES: MindmapTemplates = { defaultId: "", templates: [] }

const NO_SUBTREE: readonly string[] = []

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

  /**
   * Descendants from the document rather than the scene, so a collapsed subtree still travels with
   * the node it hangs off. Memoized per node because a drag asks once per gesture and a big branch
   * is not free to walk.
   */
  const subtreeOf = useMemo(() => {
    const document = map.data
    if (!document) {
      return () => NO_SUBTREE
    }
    const hierarchy = analyzeHierarchy(document)
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
  }, [map.data])

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
        setSelection(EMPTY_SELECTION)
      }
    },
    [deleteSelection, editor, scene],
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
          <Button variant="ghost" size="sm" onClick={() => runtime.current?.zoomBy(1 / 1.2)} aria-label="Zoom out">
            <AppIcon name="minus" size={14} strokeWidth={2} />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => runtime.current?.zoomBy(1.2)} aria-label="Zoom in">
            <AppIcon name="plus" size={14} strokeWidth={2} />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => runtime.current?.fit()}>
            {t("Mindmap", "FitToScreen")}
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1">
        <MindmapCanvas
          scene={scene}
          runtimeRef={runtime}
          selection={selection}
          onSelection={setSelection}
          onCommitMove={commitMove}
          subtreeOf={subtreeOf}
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
