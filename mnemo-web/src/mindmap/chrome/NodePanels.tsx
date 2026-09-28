import type { CSSProperties } from "react"

import { AppIcon } from "@/components/icon/AppIcon"
import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"

import type { ElementStyle, FontScale, NodeShape } from "../model/document"
import type { SceneElement } from "../model/scene"
import { KIND_ICON, KIND_LABEL, NODE_KINDS, type NodeKind } from "../scene/content"
import { fontScaleOf } from "../scene/measure"
import { branchSlot, washOf } from "../scene/tokens"
import { SCALES, SHAPES } from "./choices"
import type { ColorControl } from "./color-control"
import type { NodeActions } from "./NodeBar"
import { PanelHeader, PanelRule } from "./panel/PanelHeader"
import { PanelRow } from "./panel/PanelRow"
import { Segmented } from "./panel/Segmented"
import { SwatchRow } from "./panel/SwatchRow"
import { SwitchRow } from "./panel/SwitchRow"
import { TileGrid } from "./panel/TileGrid"

export function NodeColorPanel({
  color,
  subtree,
  onSubtree,
}: {
  color: ColorControl
  subtree: boolean
  onSubtree: (on: boolean) => void
}) {
  const t = useT()
  const deep = subtree && color.hasSubtree
  const below =
    color.below === 1
      ? t("Mindmap", "RecolorsBelowOne")
      : t("Mindmap", "RecolorsBelowFormat").replace("{0}", String(color.below))

  return (
    <>
      <PanelHeader label={t("Mindmap", "BranchColor")} />
      <SwatchRow
        label={t("Mindmap", "Color")}
        auto={{
          label: t("Mindmap", color.branching ? "MatchBranch" : "DefaultColor"),
          color: color.inheritedColor ?? "var(--ink-3)",
        }}
        inherited={color.inherited}
        picked={(index) => branchSlot(index) === color.slot}
        onPick={(token) => color.onPick(token, deep)}
      />
      <PanelRule />
      {/* Off by default, and only offered when there is something under the node to reach. */}
      <SwitchRow
        title={t("Mindmap", "WholeBranch")}
        detail={color.hasSubtree ? below : undefined}
        on={deep}
        disabled={!color.hasSubtree}
        onToggle={onSubtree}
      />
    </>
  )
}

/** Type sizes of the "Aa" samples, stepping the way the canvas steps. */
const SAMPLE_PX: Record<FontScale, number> = { s: 11, m: 13, l: 15, xl: 17 }

export function NodeShapePanel({
  element,
  tint,
  onStyle,
}: {
  element: SceneElement
  /** The colour the node is drawn in, which the previews are drawn in too. */
  tint: string
  onStyle: (patch: ElementStyle) => void
}) {
  const t = useT()
  const wash = washOf(tint) ?? "var(--canvas-sunken)"

  return (
    <>
      <PanelHeader label={t("Mindmap", "Shape")} />
      <TileGrid
        height={62}
        value={element.nodeShape}
        onPick={(nodeShape) => onStyle({ nodeShape })}
        tiles={SHAPES.map((entry) => ({
          value: entry.value,
          label: t("Mindmap", entry.key),
          preview: <ShapeSample shape={entry.value} tint={tint} wash={wash} />,
        }))}
      />
      <PanelHeader label={t("Mindmap", "TextSize")} spaced />
      <Segmented
        label={t("Mindmap", "TextSize")}
        value={fontScaleOf(element.text.fontSize)}
        onPick={(fontScale) => onStyle({ fontScale })}
        className="font-semibold"
        segments={SCALES.map((entry) => ({
          value: entry.value,
          label: t("Mindmap", entry.key),
          face: <span style={{ fontSize: SAMPLE_PX[entry.value] }}>Aa</span>,
        }))}
      />
    </>
  )
}

/** A node in miniature, in the colour it is drawn in: filled, stroked or underlined as the shape is. */
function ShapeSample({ shape, tint, wash }: { shape: NodeShape; tint: string; wash: string }) {
  const style: CSSProperties =
    shape === "card"
      ? { background: wash, borderRadius: 5 }
      : shape === "pill"
        ? { background: wash, borderRadius: 999 }
        : shape === "outline"
          ? { borderRadius: 6, boxShadow: `inset 0 0 0 1.5px ${tint}` }
          : { borderBottom: `2px solid ${tint}` }
  return <span aria-hidden className={cn("h-[18px] w-[38px]", shape === "card" && "shadow-chip")} style={style} />
}

export function NodeKindPanel({ kind, onPick }: { kind: NodeKind | null; onPick: (kind: NodeKind) => void }) {
  const t = useT()
  return (
    <>
      <PanelHeader label={t("Mindmap", "NodeType")} />
      {NODE_KINDS.map((value) => (
        <PanelRow
          key={value}
          icon={KIND_ICON[value]}
          label={t("Mindmap", KIND_LABEL[value])}
          pressed={value === kind}
          onClick={() => onPick(value)}
          trailing={
            <AppIcon
              name="check"
              size={14}
              strokeWidth={2.4}
              className={cn("shrink-0 text-ink", value === kind ? "opacity-100" : "opacity-0")}
            />
          }
        />
      ))}
    </>
  )
}

export function NodeMorePanel({
  actions,
  pinned,
  onDone,
}: {
  actions: NodeActions
  pinned: boolean
  onDone: () => void
}) {
  const t = useT()
  const { collapse, onOutdent, onSaveTemplate } = actions
  const run = (act: () => void) => () => {
    onDone()
    act()
  }

  return (
    <>
      <PanelRow
        icon="common/pin"
        label={t("Mindmap", pinned ? "Unpin" : "Pin")}
        onClick={run(() => actions.onPin(!pinned))}
      />
      {collapse ? (
        <PanelRow
          icon={collapse.collapsed ? "chevron-down" : "chevron-up"}
          label={t("Mindmap", collapse.collapsed ? "ExpandBranch" : "CollapseBranch")}
          onClick={run(collapse.onToggle)}
        />
      ) : null}
      {onOutdent ? (
        <PanelRow icon="chevron-left" label={t("Mindmap", "Outdent")} shortcut="mindmap.outdent" onClick={run(onOutdent)} />
      ) : null}
      <PanelRow
        icon="copy"
        label={t("Mindmap", "Duplicate")}
        shortcut="mindmap.duplicate"
        onClick={run(actions.onDuplicate)}
      />
      {onSaveTemplate ? (
        <PanelRow icon="palette" label={t("Mindmap", "SaveAsTemplate")} onClick={run(onSaveTemplate)} />
      ) : null}
      <PanelRule tight />
      <PanelRow
        icon="common/trash"
        danger
        label={
          actions.deleteCount > 1
            ? t("Mindmap", "DeleteCountFormat").replace("{0}", String(actions.deleteCount))
            : t("Mindmap", "Delete")
        }
        shortcut="mindmap.delete-selection"
        onClick={run(actions.onDelete)}
      />
    </>
  )
}
