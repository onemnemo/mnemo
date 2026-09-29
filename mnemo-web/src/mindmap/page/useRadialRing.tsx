import { useCallback, useRef, useState, type ReactNode } from "react"

import type { TranslateFn } from "@/i18n/types"
import { useT } from "@/i18n/useT"

import type { CanvasRuntime } from "../canvas/runtime"
import type { AlignControl } from "../chrome/AlignBar"
import { clampRing, MOST_CUTOUTS } from "../chrome/radial"
import { RadialMenu } from "../chrome/RadialMenu"
import type { PaneBox } from "../chrome/RadialScrim"
import { ON_CANVAS, onElements, splitPick, type RingContext, type RingSector } from "../chrome/sectors"
import type { RefTarget } from "../chrome/RefPicker"
import { stepMinimapMode } from "../chrome/useMinimapShown"
import type { Held } from "../chrome/useBarAnchor"
import type { AlignOp } from "../edit/align"
import { carriedText } from "../edit/convert"
import type { PlacedBox } from "../edit/placement"
import {
  collapseExpands,
  collapseOps,
  colorOps,
  connectManyOps,
  nodeShapeOps,
  pinOps,
  pinUnpins,
  type RingTarget,
} from "../edit/ring-ops"
import type { MindmapEditor } from "../edit/useMindmapEditor"
import { selectElements, type Selection } from "../interaction/selection"
import type { MindmapTool } from "../interaction/tool"
import type { EdgeStyle, ElementKind, LayoutAlgorithm, MindmapDocument, NodeShape, ShapeType } from "../model/document"
import type { MindmapOp } from "../model/ops"
import type { Point, Scene } from "../model/scene"
import type { NodeKind, RefInfo } from "../scene/content"
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
  plant(tool: MindmapTool, at: Point, extra?: { opens?: "equation"; shape?: ShapeType }): void
  pickRef(target: RefTarget, at: Point): void
  changeKind(kind: NodeKind, id: string): void
  insertImage(at: Point): void
  arrange(algorithm?: LayoutAlgorithm): void
  group(ids: readonly string[]): void
}

export interface RingHost {
  readonly stage: Held<HTMLElement>
  readonly runtime: Held<CanvasRuntime>
  /** The pointer in pane pixels, or null once it has left the pane. */
  readonly pointer: { readonly current: Point | null }
  readonly scene: Scene | null
  readonly document: MindmapDocument | undefined
  readonly selection: Selection
  readonly setSelection: (next: Selection) => void
  readonly refs: ReadonlyMap<string, RefInfo>
  readonly boxes: ReadonlyMap<string, PlacedBox>
  /** Lines the selection up; null when the selection is not loose elements. */
  readonly align: AlignControl | null
  readonly hasChildren: (id: string) => boolean
  readonly shape: ShapeType
  readonly connector: EdgeStyle | undefined
  readonly editor: MindmapEditor
  readonly setTool: (tool: MindmapTool) => void
  readonly setShape: (shape: ShapeType) => void
  readonly act: RingActions
}

interface OpenRing {
  context: RingContext
  at: Point
  key: string
  targets: RingTarget[]
  /** The element under the pointer, which a many-target Connect links the rest to. */
  primary: string | null
  cutouts: PaneBox[]
  sectors: readonly RingSector[]
  inert: ReadonlySet<string>
  subject: string
}

/**
 * The hold-Q ring, acting on the element under the pointer (with the selection if it is part of it)
 * or on empty canvas. Fixed when the ring opens; the selection only changes on a pick.
 */
export function useRadialRing(host: RingHost): { open: boolean; openRing: (key: string) => void; menu: ReactNode } {
  const t = useT()
  const [ring, setRing] = useState<OpenRing | null>(null)
  /** The item last picked from each sector's sub-ring, which a release on the sector repeats. */
  const memory = useRef(new Map<string, string>())
  const live = useRef({ host, ring, t })
  live.current = { host, ring, t }

  const openRing = useCallback((key: string) => {
    const { host: h, t: tr } = live.current
    const pane = h.stage.current
    const bounds = pane?.getBoundingClientRect()
    if (!pane || !bounds) {
      return
    }
    const pointer = h.pointer.current ?? { x: bounds.width / 2, y: bounds.height / 2 }
    const at = clampRing(pointer, bounds)

    const { targets, primary } = targetsAt(h, h.pointer.current ? under(pane, bounds, pointer) : null)
    const context: RingContext = targets.length > 0 ? "element" : "canvas"
    memory.current.set("canvas:shape", `shape:${h.shape}`)
    setRing({
      context,
      at,
      key,
      targets,
      primary,
      cutouts: cutoutsOf(h, targets),
      ...(context === "canvas" ? canvasRing(h, tr) : elementRing(h, targets, primary, tr)),
    })
  }, [])

  const pick = useCallback((picked: string, sectorId: string) => {
    const { host: h, ring: open } = live.current
    if (!open) {
      return
    }
    if (picked !== sectorId) {
      memory.current.set(`${open.context}:${sectorId}`, picked)
    }
    if (open.context === "canvas") {
      pickOnCanvas(h, open, picked)
    } else {
      pickOnElements(h, open, picked, live.current.t)
    }
  }, [])

  const remembered = useCallback(
    (sectorId: string) => memory.current.get(`${live.current.ring?.context}:${sectorId}`) ?? null,
    [],
  )

  const menu = ring ? (
    <RadialMenu
      sectors={ring.sectors}
      inert={ring.inert}
      at={ring.at}
      holdKey={ring.key}
      subject={ring.subject}
      cutouts={ring.cutouts}
      remembered={remembered}
      onPick={pick}
      onClose={() => setRing(null)}
    />
  ) : null

  return { open: ring !== null, openRing, menu }
}

/** The element under a pane point, if the canvas is what is there rather than chrome over it. */
function under(pane: HTMLElement, bounds: DOMRect, point: Point): string | null {
  const hit = document.elementFromPoint(bounds.left + point.x, bounds.top + point.y)
  const node = hit instanceof HTMLElement ? hit.closest<HTMLElement>(".mm-node") : null
  return node && pane.contains(node) ? (node.dataset.mmId ?? null) : null
}

/** The element under the pointer, with the rest of the selection when it is part of it. */
function targetsAt(host: RingHost, id: string | null): { targets: RingTarget[]; primary: string | null } {
  const { scene, selection } = host
  const element = id ? scene?.elements.find((candidate) => candidate.id === id) : undefined
  if (!element || !id) {
    return { targets: [], primary: null }
  }
  const ids = selection.elements.has(id) ? [...selection.elements] : [id]
  const primary = id
  const targets = ids.flatMap((target): RingTarget[] => {
    const found = scene?.elements.find((candidate) => candidate.id === target)
    return found
      ? [
          {
            id: target,
            isNode: found.kind === "node",
            pinned: found.pinned,
            collapsed: found.collapsed,
            hasChildren: found.kind === "node" && host.hasChildren(target),
          },
        ]
      : []
  })
  return { targets, primary }
}

/** The ring's centre on the canvas, which is where anything the canvas ring makes goes. */
function centreOf(host: RingHost, open: OpenRing): Point | null {
  const bounds = host.stage.current?.getBoundingClientRect()
  return bounds && host.runtime.current
    ? host.runtime.current.toCanvas(bounds.left + open.at.x, bounds.top + open.at.y)
    : null
}

function pickOnCanvas(host: RingHost, open: OpenRing, picked: string): void {
  const { act, runtime } = host
  const [id, value] = splitPick(picked)
  const at = centreOf(host, open)
  switch (id) {
    case "node":
    case "text":
      if (at) act.plant(id, at)
      return
    case "shape": {
      const shape = (value || host.shape) as ShapeType
      host.setShape(shape)
      if (at) act.plant("shape", at, { shape })
      return
    }
    case "note-link":
      if (at) act.pickRef("note", at)
      return
    case "deck-link":
      if (at) act.pickRef("flashcard", at)
      return
    case "equation":
      if (at) act.plant("node", at, { opens: "equation" })
      return
    case "image":
      if (at) act.insertImage(at)
      return
    case "frame":
      // A frame is drawn around what it holds, so the sweep is still the way to say what that is.
      host.setTool("frame")
      return
    case "layout":
      act.arrange(value as LayoutAlgorithm)
      return
    case "arrange":
      act.arrange()
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
    default:
      return
  }
}

function pickOnElements(host: RingHost, open: OpenRing, picked: string, t: TranslateFn): void {
  const { editor, act, selection } = host
  const { targets, primary } = open
  const [id, value] = splitPick(picked)
  const ids = targets.map((target) => target.id)
  const apply = (ops: MindmapOp[], label: string) => {
    if (ops.length > 0) void editor.apply(ops, { label: t("Mindmap", label) })
  }

  // Acting on something unselected selects it, so what just changed is what the bars now show. Not
  // for a link, whose picker can still be cancelled.
  if (id !== "link" && (selection.elements.size !== ids.length || !ids.every((target) => selection.elements.has(target)))) {
    host.setSelection(selectElements(ids))
  }

  switch (id) {
    case "color":
      apply(colorOps(targets, branchToken(Number(value))), "StyleNode")
      return
    case "node-shape":
      apply(nodeShapeOps(targets, value as NodeShape), "StyleNode")
      return
    case "connect":
      if (targets.length === 1 || !primary) {
        host.setTool("connect")
        return
      }
      apply(connectManyOps(primary, framable(host, ids), host.document, host.connector), "Connect")
      return
    case "link":
      if (targets.length === 1) act.changeKind(value as NodeKind, targets[0].id)
      return
    case "collapse":
      apply(collapseOps(targets), "ToggleCollapse")
      return
    case "group": {
      const members = framable(host, ids)
      if (members.length > 0) act.group(members)
      return
    }
    case "align":
      host.align?.apply(value as AlignOp)
      return
    case "pin":
      apply(pinOps(targets), "TogglePin")
      return
    default:
      return
  }
}

/** Without frames, which do not nest and are not linked. */
function framable({ scene }: RingHost, ids: readonly string[]): string[] {
  return ids.filter((id) => scene?.elements.find((candidate) => candidate.id === id)?.kind !== "frame")
}

/** The targets' boxes on screen, for the scrim to leave clear. */
function cutoutsOf({ runtime, boxes }: RingHost, targets: readonly RingTarget[]): PaneBox[] {
  const canvas = runtime.current
  if (!canvas || targets.length > MOST_CUTOUTS) {
    return []
  }
  const cutouts: PaneBox[] = []
  for (const { id } of targets) {
    const box = boxes.get(id)
    if (box) {
      const from = canvas.toPane({ x: box.x, y: box.y })
      const to = canvas.toPane({ x: box.x + box.width, y: box.y + box.height })
      cutouts.push({ x: from.x, y: from.y, width: to.x - from.x, height: to.y - from.y })
    }
  }
  return cutouts
}

type RingContents = Pick<OpenRing, "sectors" | "inert" | "subject">

function canvasRing({ scene }: RingHost, t: TranslateFn): RingContents {
  const inert = new Set<string>()
  if (!scene?.elements.length) {
    inert.add("layout")
  }
  return { sectors: ON_CANVAS, inert, subject: t("Mindmap", "RadialCanvas") }
}

function elementRing(host: RingHost, targets: readonly RingTarget[], primary: string | null, t: TranslateFn): RingContents {
  const { scene, selection, align, refs } = host
  const inert = new Set<string>()
  const nodes = targets.filter((target) => target.isNode)
  const primaryKind = scene?.elements.find((candidate) => candidate.id === primary)?.kind
  if (nodes.length === 0) {
    inert.add("node-shape")
    inert.add("pin")
  }
  if (
    primaryKind === "frame" ||
    (targets.length > 1 &&
      primary &&
      connectManyOps(primary, framable(host, targets.map((target) => target.id)), host.document)
        .length === 0)
  ) {
    inert.add("connect")
  }
  if (targets.length !== 1 || nodes.length !== 1) {
    inert.add("link")
  }
  if (!targets.some((target) => target.hasChildren)) {
    inert.add("collapse")
  }
  if (framable(host, targets.map((target) => target.id)).length === 0) {
    inert.add("group")
  }
  // The align control is built for the selection, so it applies only when the targets are the selection.
  const onSelection =
    targets.length === selection.elements.size && targets.every((target) => selection.elements.has(target.id))
  if (!align || !onSelection) {
    inert.add("align")
  } else if (!align.canDistribute) {
    inert.add("align:distributeHorizontal")
    inert.add("align:distributeVertical")
  }

  let subject = t("Mindmap", "RadialSelectedFormat").replace("{0}", String(targets.length))
  if (targets.length === 1) {
    const element = scene?.elements.find((candidate) => candidate.id === targets[0].id)
    const text = element ? carriedText(element.content, refs).trim() : ""
    subject = text || t("Mindmap", UNLABELLED[element?.kind ?? "node"])
  }
  const sectors = onElements({ collapsed: collapseExpands(targets), pinned: pinUnpins(targets) })
  return { sectors, inert, subject }
}
