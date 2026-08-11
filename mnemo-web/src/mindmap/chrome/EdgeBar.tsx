import { AppIcon } from "@/components/icon/AppIcon"
import { useT } from "@/i18n/useT"

import type { ArrowCap, EdgeRouting, EdgeStyle, LineStyle } from "../model/document"
import type { SceneEdge } from "../model/scene"
import { FloatBar, Sep, Slot } from "./bits"
import { CapGlyph, LineGlyph, RouteGlyph } from "./glyphs"

const LINES: readonly { value: LineStyle; key: string }[] = [
  { value: "solid", key: "EdgeSolid" },
  { value: "dashed", key: "EdgeDashed" },
  { value: "dotted", key: "EdgeDotted" },
  { value: "double", key: "EdgeDouble" },
]

const ROUTES: readonly { value: EdgeRouting; key: string }[] = [
  { value: "curve", key: "RouteCurve" },
  { value: "straight", key: "RouteStraight" },
  { value: "orthogonal", key: "RouteOrthogonal" },
]

const CAPS: readonly { value: ArrowCap; key: string }[] = [
  { value: "none", key: "CapNone" },
  { value: "arrow", key: "CapArrow" },
  { value: "dot", key: "CapDot" },
]

export interface EdgeBarProps {
  /** The edge the controls read their current values from. */
  edge: SceneEdge
  /** How many edges a press will land on. */
  count: number
  onStyle: (patch: EdgeStyle) => void
  /** Start typing this edge's label, wherever the label itself lives. */
  onLabel: () => void
}

/**
 * What a selected edge can be.
 *
 * Flat, with hairlines between the groups and no popovers anywhere: an edge has four decisions and
 * fourteen values between them, which is few enough to lay out in full. Every value is one press
 * from any other, and nothing is hidden behind a menu that has to be opened to find out what is in
 * it. That is the trade the width buys.
 *
 * Start and end are two controls rather than one. The model has always held them as two fields, and
 * a single combined control can say arrows at both ends or at neither, but not an arrow at the start
 * only, which is a thing people draw.
 */
export function EdgeBar({ edge, count, onStyle, onLabel }: EdgeBarProps) {
  const t = useT()
  const line = edge.lineStyle ?? "solid"
  const routing = edge.routing ?? "curve"

  return (
    <FloatBar>
      {LINES.map((entry) => (
        <Slot
          key={entry.value}
          label={t("Mindmap", entry.key)}
          active={line === entry.value}
          onClick={() => onStyle({ line: entry.value })}
        >
          <LineGlyph line={entry.value} />
        </Slot>
      ))}

      <Sep />

      {ROUTES.map((entry) => (
        <Slot
          key={entry.value}
          label={t("Mindmap", entry.key)}
          active={routing === entry.value}
          onClick={() => onStyle({ routing: entry.value })}
        >
          <RouteGlyph routing={entry.value} />
        </Slot>
      ))}

      <Sep />

      <CapGroup
        end={t("Mindmap", "CapStart")}
        value={edge.startCap ?? "none"}
        onPick={(cap) => onStyle({ startCap: cap })}
        flipped
      />

      <Sep />

      <CapGroup
        end={t("Mindmap", "CapEnd")}
        value={edge.endCap ?? "none"}
        onPick={(cap) => onStyle({ endCap: cap })}
      />

      <Sep />

      <Slot
        wide
        label={t("Mindmap", "EditLabel")}
        // One edge at a time. A label belongs to one edge, and there is no sensible thing for typing
        // into a selection of four of them to mean.
        disabled={count > 1}
        onClick={onLabel}
      >
        <span className="flex items-center gap-1">
          <AppIcon name="type" size={12} strokeWidth={1.8} />
          <span className={edge.label ? "max-w-[90px] truncate" : undefined}>
            {edge.label || t("Mindmap", "LabelPlaceholder")}
          </span>
        </span>
      </Slot>
    </FloatBar>
  )
}

/**
 * One end's three choices.
 *
 * The end's name goes in each tooltip rather than on a visible heading, so six buttons that look
 * like two mirrored sets of three can still say which end they are, without the bar growing labels
 * the dock next to it does not have.
 */
function CapGroup({
  end,
  value,
  onPick,
  flipped,
}: {
  end: string
  value: ArrowCap
  onPick: (cap: ArrowCap) => void
  flipped?: boolean
}) {
  const t = useT()
  return (
    <>
      {CAPS.map((cap) => (
        <Slot
          key={cap.value}
          label={`${end} ${t("Mindmap", cap.key)}`}
          active={value === cap.value}
          onClick={() => onPick(cap.value)}
        >
          <CapGlyph cap={cap.value} flipped={flipped} />
        </Slot>
      ))}
    </>
  )
}
