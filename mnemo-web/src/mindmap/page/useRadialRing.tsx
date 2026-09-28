import { useCallback, useRef, useState, type ReactNode } from "react"

import { useT } from "@/i18n/useT"
import type { TranslateFn } from "@/i18n/types"

import type { CanvasRuntime } from "../canvas/runtime"
import type { AlignControl } from "../chrome/AlignBar"
import type { ColorControl } from "../chrome/color-control"
import type { NodeActions } from "../chrome/NodeBar"
import { clampRing, MOST_CUTOUTS } from "../chrome/radial"
import { RadialMenu } from "../chrome/RadialMenu"
import type { PaneBox } from "../chrome/RadialScrim"
import { ON_CANVAS, ON_SEVERAL, onNode, ringContext, splitPick, type RingSector } from "../chrome/sectors"
import { stepMinimapMode } from "../chrome/useMinimapShown"
import type { Held } from "../chrome/useBarAnchor"
import type { AlignOp } from "../edit/align"
import { carriedText } from "../edit/convert"
import { matchStyleOps } from "../edit/match-style"
import type { PlacedBox } from "../edit/placement"
import type { MindmapEditor } from "../edit/useMindmapEditor"
import type { Selection } from "../interaction/selection"
import type { MindmapTool } from "../interaction/tool"
import type {
  ElementKind,
  ElementStyle,
  LayoutAlgorithm,
  MindmapDocument,
  NodeShape,
  ShapeType,
} from "../model/document"
import type { Point, Scene } from "../model/scene"
import { labelEditable, nodeKindOf, type NodeKind, type RefInfo } from "../scene/content"
import { branchToken } from "../scene/tokens"

/** What the hub calls a single element that has no words of its own. */
const UNLABELLED: Record<ElementKind, string> = {
  node: "RadialNode",
  shape: "Shape",
  text: "NewText",
  image: "RadialImage",
  frame: "NewFrame",
}

/** The things the route already does that the ring hands picks to. */
export interface RingActions {
  addChild(id: string): void
  addSibling(id: string): void
  beginEdit(id: string): void
  deleteSelection(): void
  insertImage(): void
  pickNote(at: Point): void
  plantEquation(at: Point): void
  arrange(algorithm?: LayoutAlgorithm): void
  styleNodes(patch: ElementStyle): void
  changeKind(kind: NodeKind): void
  group(ids: readonly string[]): void
  duplicate(): void
}

export interface RingHost {
  readonly stage: Held<HTMLElement>
  readonly runtime: Held<CanvasRuntime>
  readonly pointer: { readonly current: Point }
  readonly scene: Scene | null
  readonly document: MindmapDocument | undefined
  readonly selection: Selection
  readonly refs: ReadonlyMap<string, RefInfo>
  readonly boxes: ReadonlyMap<string, PlacedBox>
  readonly align: AlignControl | null
  readonly color: ColorControl | null
  readonly collapse: NodeActions["collapse"]
  readonly editor: MindmapEditor
  readonly setTool: (tool: MindmapTool) => void
  readonly setShape: (shape: ShapeType) => void
  readonly act: RingActions
}

interface OpenRing {
  at: Point
  key: string
  cutouts: PaneBox[]
  sectors: readonly RingSector[]
  inert: ReadonlySet<string>
  subject: string
}

/**
 * The hold-Q ring's state and what its picks do.
 *
 * The set, its dimmed sectors and the hub's subject are fixed when the ring opens. The hit the ring
 * holds is an index into that set, and a scene update landing mid-gesture must not swap the set out
 * from under it.
 */
export function useRadialRing(host: RingHost): { open: boolean; openRing: (key: string) => void; menu: ReactNode } {
  const t = useT()
  const [ring, setRing] = useState<OpenRing | null>(null)
  // Read through refs so the two callbacks stay stable: the page's key handler depends on one.
  const live = useRef({ host, ring, t })
  live.current = { host, ring, t }

  const openRing = useCallback((key: string) => {
    const { host: h, t: tr } = live.current
    const bounds = h.stage.current?.getBoundingClientRect()
    const at = clampRing(h.pointer.current, { width: bounds?.width ?? 0, height: bounds?.height ?? 0 })
    setRing({ at, key, cutouts: cutoutsOf(h), ...contentsOf(h, tr) })
  }, [])

  const pick = useCallback((picked: string) => {
    const { host: h, ring: open, t: tr } = live.current
    const { selection, act, runtime } = h
    const primary = selection.primary?.kind === "element" ? selection.primary.id : null
    const [id, value] = splitPick(picked)
    const centre = (): Point | null => {
      const bounds = h.stage.current?.getBoundingClientRect()
      return bounds && open && runtime.current
        ? runtime.current.toCanvas(bounds.left + open.at.x, bounds.top + open.at.y)
        : null
    }

    switch (id) {
      case "child":
        if (primary) act.addChild(primary)
        return
      case "sibling":
        if (primary) act.addSibling(primary)
        return
      case "edit":
        if (primary) act.beginEdit(primary)
        return
      case "collapse":
        h.collapse?.onToggle()
        return
      case "delete":
        act.deleteSelection()
        return
      case "shape":
        if (value) h.setShape(value as ShapeType)
        h.setTool("shape")
        return
      case "node":
      case "text":
      case "frame":
      case "connect":
        // Armed rather than planted: the ring closes under the pointer, and planting there would
        // put a node exactly where the hand was resting rather than where it is about to point.
        h.setTool(id)
        return
      case "image":
        act.insertImage()
        return
      case "note-link": {
        const at = centre()
        if (at) act.pickNote(at)
        return
      }
      case "equation": {
        const at = centre()
        if (at) act.plantEquation(at)
        return
      }
      case "arrange":
        act.arrange()
        return
      case "layout":
        act.arrange(value as LayoutAlgorithm)
        return
      case "fit":
        runtime.current?.fit()
        return
      case "actual-size":
        // The anchored arithmetic every other zoom uses, as the view dock's reset does.
        runtime.current?.zoomBy(1 / (runtime.current?.viewport().zoom ?? 1))
        return
      case "minimap":
        stepMinimapMode()
        return
      case "color":
        h.color?.onPick(branchToken(Number(value)), false)
        return
      case "node-shape":
        act.styleNodes({ nodeShape: value as NodeShape })
        return
      case "note":
        act.changeKind("note")
        return
      case "align":
        h.align?.apply(value as AlignOp)
        return
      case "group": {
        const ids = framable(h)
        if (ids.length > 0) act.group(ids)
        return
      }
      case "match":
        matchStyle(h, tr)
        return
      case "duplicate":
        act.duplicate()
        return
      default:
        return
    }
  }, [])

  const menu = ring ? (
    <RadialMenu
      sectors={ring.sectors}
      inert={ring.inert}
      at={ring.at}
      holdKey={ring.key}
      subject={ring.subject}
      cutouts={ring.cutouts}
      onPick={pick}
      onClose={() => setRing(null)}
    />
  ) : null

  return { open: ring !== null, openRing, menu }
}

/** The selection without its frames, which do not nest and so cannot go into a new one. */
function framable({ scene, selection }: RingHost): string[] {
  return [...selection.elements].filter(
    (id) => scene?.elements.find((candidate) => candidate.id === id)?.kind !== "frame",
  )
}

/** Gives the rest of the selection the primary's stored look, as one undo. */
function matchStyle({ selection, document, editor }: RingHost, t: TranslateFn): void {
  const primaryId = selection.primary?.kind === "element" ? selection.primary.id : null
  if (!primaryId) {
    return
  }
  const stored = (id: string) => document?.elements?.find((candidate) => candidate.id === id)?.style
  const others = [...selection.elements].filter((id) => id !== primaryId).map((id) => ({ id, style: stored(id) }))
  if (others.length > 0) {
    void editor.apply(matchStyleOps(stored(primaryId), others), { label: t("Mindmap", "RadialMatchStyle") })
  }
}

/** The selection's boxes on screen, for the scrim to leave clear. */
function cutoutsOf({ runtime, selection, boxes }: RingHost): PaneBox[] {
  const canvas = runtime.current
  if (!canvas || selection.elements.size > MOST_CUTOUTS) {
    return []
  }
  const cutouts: PaneBox[] = []
  for (const id of selection.elements) {
    const box = boxes.get(id)
    if (box) {
      const from = canvas.toPane({ x: box.x, y: box.y })
      const to = canvas.toPane({ x: box.x + box.width, y: box.y + box.height })
      cutouts.push({ x: from.x, y: from.y, width: to.x - from.x, height: to.y - from.y })
    }
  }
  return cutouts
}

/** The set for this selection, which of its sectors do nothing here, and what the hub calls the selection. */
function contentsOf(host: RingHost, t: TranslateFn): Pick<OpenRing, "sectors" | "inert" | "subject"> {
  const { selection, scene, align, color, collapse, refs } = host
  const inert = new Set<string>()
  const context = ringContext(selection.elements.size)

  if (context === "canvas") {
    if (!scene?.elements.length) {
      inert.add("arrange")
    }
    return { sectors: ON_CANVAS, inert, subject: t("Mindmap", "RadialCanvas") }
  }

  if (context === "multi") {
    if (!align) {
      inert.add("align")
    }
    if (!align?.canDistribute) {
      inert.add("distribute")
    }
    if (framable(host).length === 0) {
      inert.add("group")
    }
    const subject = t("Mindmap", "RadialSelectedFormat").replace("{0}", String(selection.elements.size))
    return { sectors: ON_SEVERAL, inert, subject }
  }

  const id = [...selection.elements][0]
  const element = scene?.elements.find((candidate) => candidate.id === id)
  if (element?.kind !== "node") {
    for (const off of ["child", "sibling", "note", "node-shape"]) {
      inert.add(off)
    }
  } else if (nodeKindOf(element.content) === "note") {
    inert.add("note")
  }
  if (!collapse) {
    inert.add("collapse")
  }
  if (!element || !labelEditable(element.content)) {
    inert.add("edit")
  }
  if (!color) {
    inert.add("color")
  }
  const text = element ? carriedText(element.content, refs).trim() : ""
  const subject = text || t("Mindmap", UNLABELLED[element?.kind ?? "node"])
  return { sectors: onNode(collapse?.collapsed === true), inert, subject }
}
