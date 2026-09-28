import { useState } from "react"

import { AppIcon } from "@/components/icon/AppIcon"
import { useT } from "@/i18n/useT"

import type { ElementStyle } from "../model/document"
import type { SceneElement } from "../model/scene"
import { accentOf } from "../scene/branch"
import { KIND_ICON, KIND_LABEL, nodeKindOf, type NodeKind } from "../scene/content"
import type { ColorControl } from "./color-control"
import { NodeShapeGlyph } from "./glyphs"
import { BarButton, BarDivider, SwatchFace } from "./panel/BarButton"
import { NodeColorPanel, NodeKindPanel, NodeMorePanel, NodeShapePanel } from "./NodePanels"
import { PanelBar } from "./panel/PanelBar"
import { usePanel } from "./panel/usePanel"

export type { ColorControl } from "./color-control"

/** Everything the More panel offers, so the bar itself keeps one width as the list grows. */
export interface NodeActions {
  /** Hold everything selected where it is, or hand it all back to the layout. */
  onPin: (pinned: boolean) => void
  /** Fold this node's children out of sight, or null when there is nothing under it. */
  collapse: { collapsed: boolean; onToggle: () => void } | null
  /** Save this branch's styling as a template, or null when the selection is not one branch. */
  onSaveTemplate: (() => void) | null
  /** Move the node out from under its parent, or null when it has no grandparent to land under. */
  onOutdent: (() => void) | null
  onDuplicate: () => void
  onDelete: () => void
  /**
   * How many elements a delete actually removes, selection plus every descendant it takes with it.
   * Always at least the selection's own size; larger the moment a selected node has children,
   * collapsed ones included since a delete reaches those too.
   */
  deleteCount: number
}

export interface NodeBarProps {
  /** The node the controls read their current values from. */
  element: SceneElement
  /** How many nodes a press will land on. */
  count: number
  onStyle: (patch: ElementStyle) => void
  color: ColorControl | null
  /** Turn this node into another kind, or null when the selection is not a single node. */
  onKind: ((kind: NodeKind) => void) | null
  actions: NodeActions
  /** Changes whenever the selection does, which closes any open panel. */
  selectionKey: string
}

type NodePanel = "kind" | "color" | "shape" | "more"

const WIDTH = 272

/**
 * What a selected node can be.
 *
 * What the node is comes first and fills the spare width, then how it looks, then what it can be
 * told to do. Each button shows the current value and opens its panel stacked on the bar.
 */
export function NodeBar({ element, count, onStyle, color, onKind, actions, selectionKey }: NodeBarProps) {
  const t = useT()
  const panel = usePanel<NodePanel>(selectionKey)
  // Whole branch is a choice about one selection, so a new selection starts with it off.
  const [subtree, setSubtree] = useState(false)
  const [subtreeFor, setSubtreeFor] = useState(selectionKey)
  if (subtreeFor !== selectionKey) {
    setSubtreeFor(selectionKey)
    setSubtree(false)
  }
  const kind = nodeKindOf(element.content)
  const drawn = color?.color ?? accentOf(element) ?? "var(--ink-3)"
  const opens = (key: NodePanel) => ({ key, open: panel.open === key })

  const kindName =
    count > 1
      ? t("Mindmap", "SelectedNodesFormat").replace("{0}", String(count))
      : t("Mindmap", kind ? KIND_LABEL[kind] : "NodeType")

  const panels = [
    ...(onKind
      ? [
          {
            key: "kind" as const,
            label: t("Mindmap", "NodeType"),
            content: (
              <NodeKindPanel
                kind={kind}
                onPick={(next) => {
                  panel.close()
                  onKind(next)
                }}
              />
            ),
          },
        ]
      : []),
    ...(color
      ? [
          {
            key: "color" as const,
            label: t("Mindmap", "BranchColor"),
            content: <NodeColorPanel color={color} subtree={subtree} onSubtree={setSubtree} />,
          },
        ]
      : []),
    {
      key: "shape" as const,
      label: t("Mindmap", "ShapeAndSize"),
      content: <NodeShapePanel element={element} tint={drawn} onStyle={onStyle} />,
    },
    {
      key: "more" as const,
      label: t("Mindmap", "More"),
      content: <NodeMorePanel actions={actions} pinned={element.pinned === true} onDone={panel.close} />,
    },
  ]

  return (
    <PanelBar label={t("Mindmap", "NodeOptions")} width={WIDTH} open={panel.open} onClose={panel.close} panels={panels}>
      <BarButton
        label={kindName}
        labelled
        opens={onKind ? opens("kind") : undefined}
        disabled={!onKind}
        undimmed
        onClick={() => panel.toggle("kind")}
        className="min-w-0 grow gap-[7px] pr-1.5 pl-2 text-[12.5px] font-medium"
      >
        <AppIcon name={kind ? KIND_ICON[kind] : "notes/text"} size={16} strokeWidth={1.8} className="shrink-0 text-ink-2" />
        <span className="min-w-0 grow truncate text-left text-ink">{kindName}</span>
        <AppIcon name="chevron-down" size={12} strokeWidth={2.2} className="shrink-0 text-ink-3" />
      </BarButton>

      <BarDivider />

      {color ? (
        <BarButton
          label={t("Mindmap", "BranchColor")}
          opens={opens("color")}
          onClick={() => panel.toggle("color")}
          className="w-8 justify-center"
        >
          <SwatchFace color={drawn} pressed={panel.open === "color"} />
        </BarButton>
      ) : null}

      <BarButton
        label={t("Mindmap", "ShapeAndSize")}
        opens={opens("shape")}
        onClick={() => panel.toggle("shape")}
        className="w-8 justify-center"
      >
        <NodeShapeGlyph shape={element.nodeShape} />
      </BarButton>

      <BarDivider />

      <BarButton
        label={t("Mindmap", "More")}
        opens={opens("more")}
        onClick={() => panel.toggle("more")}
        className="w-8 justify-center"
      >
        <AppIcon name="ellipsis" size={16} strokeWidth={2} />
      </BarButton>
    </PanelBar>
  )
}
