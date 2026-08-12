import { useState, type ReactNode } from "react"

import { AppIcon } from "@/components/icon/AppIcon"
import { useT } from "@/i18n/useT"

import type { ArrowCap, EdgeRouting, EdgeStyle, LineStyle } from "../model/document"
import type { SceneEdge } from "../model/scene"
import { BRANCH_COUNT, branchColor, branchToken } from "../scene/tokens"
import { FloatBar, Sep, Slot } from "./bits"
import { FlyoutPanel } from "./FlyoutPanel"
import { CapGlyph, CascadeGlyph, LineGlyph, RouteGlyph, SwatchGlyph, ThicknessGlyph } from "./glyphs"

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

/**
 * Three weights rather than a number field.
 *
 * These are the widths the renderer already draws at: 1.5 is what an unstyled link edge is, and the
 * other two are one step either side of it. A map wants a line to read as quiet, normal or emphatic,
 * and nobody has ever wanted 1.7.
 */
const THICKNESSES: readonly { value: number; key: string }[] = [
  { value: 1, key: "ThicknessHairline" },
  { value: 1.5, key: "ThicknessNormal" },
  { value: 2.5, key: "ThicknessBold" },
]

export interface EdgeBarProps {
  /** The edge the controls read their current values from. */
  edge: SceneEdge
  /** How many edges a press will land on. */
  count: number
  /**
   * A null member means take this away rather than set it, which is what the colour reset is.
   *
   * `deep` asks for the same style on every edge below this one as well. It rides along with the
   * patch rather than being a mode the caller has to remember, so one press is still one decision
   * and one undo however far down it reaches.
   */
  onStyle: (patch: EdgeStyle, deep: boolean) => void
  /** Start typing this edge's label, wherever the label itself lives. */
  onLabel: () => void
}

/**
 * What a selected edge can be.
 *
 * Mostly flat, with hairlines between the groups: line, routing and the two ends are four decisions
 * with fourteen values between them, which is few enough to lay out in full, so every one of them is
 * one press from any other with nothing hidden behind a menu. That is the trade the width buys.
 *
 * Colour and thickness are the two that cannot be. Eight hues and a weight ladder laid out flat
 * would make the bar wider than most of the maps it floats over, so each gets one slot showing what
 * the edge is now and opening the rest. They are the same shape of control as the node bar's branch
 * swatch, deliberately.
 *
 * Start and end are two controls rather than one. The model has always held them as two fields, and
 * a single combined control can say arrows at both ends or at neither, but not an arrow at the start
 * only, which is a thing people draw.
 */
export function EdgeBar({ edge, count, onStyle, onLabel }: EdgeBarProps) {
  const t = useT()
  const [colors, setColors] = useState(false)
  const [thicknesses, setThicknesses] = useState(false)
  const [cascade, setCascade] = useState(false)
  const line = edge.lineStyle ?? "solid"
  const routing = edge.routing ?? "curve"

  // A link edge has nothing below it, so the toggle cannot be honoured on one however it was left by
  // the last edge that was selected.
  const branching = edge.kind === "hierarchy"
  const deep = cascade && branching
  const style = (patch: EdgeStyle) => onStyle(patch, deep)

  return (
    <FloatBar>
      {LINES.map((entry) => (
        <Slot
          key={entry.value}
          label={t("Mindmap", entry.key)}
          active={line === entry.value}
          onClick={() => style({ line: entry.value })}
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
          onClick={() => style({ routing: entry.value })}
        >
          <RouteGlyph routing={entry.value} />
        </Slot>
      ))}

      <Sep />

      <CapGroup
        end={t("Mindmap", "CapStart")}
        value={edge.startCap ?? "none"}
        onPick={(cap) => style({ startCap: cap })}
        flipped
      />

      <Sep />

      <CapGroup
        end={t("Mindmap", "CapEnd")}
        value={edge.endCap ?? "none"}
        onPick={(cap) => style({ endCap: cap })}
      />

      <Sep />

      <Popped
        label={t("Mindmap", "EdgeColor")}
        face={<SwatchGlyph color={edge.color ?? "var(--line)"} active={false} />}
        open={colors}
        onOpen={setColors}
      >
        <div className="flex gap-1.5 px-1 py-0.5">
          {Array.from({ length: BRANCH_COUNT }, (_, index) => (
            <button
              key={index}
              type="button"
              title={t("Mindmap", "EdgeColor")}
              aria-label={t("Mindmap", "EdgeColor")}
              aria-pressed={edge.color === branchColor(index)}
              onClick={() => {
                style({ color: branchToken(index) })
                setColors(false)
              }}
              className="grid size-6 place-items-center rounded-lg hover:bg-frame-hover"
            >
              <SwatchGlyph color={branchColor(index)} active={edge.color === branchColor(index)} />
            </button>
          ))}
        </div>
        {/* The way back out. An edge with no colour of its own takes the branch's, which is what
            makes a coloured map read as branches rather than as a hundred separate lines, and
            there has to be one press that gives that back. */}
        <button
          type="button"
          onClick={() => {
            style({ color: null })
            setColors(false)
          }}
          className="mt-1 block w-full rounded-lg px-2 py-1 text-left text-[11.5px] text-ink-2 hover:bg-frame-hover hover:text-ink"
        >
          {t("Mindmap", branching ? "MatchBranch" : "DefaultColor")}
        </button>
      </Popped>

      <Popped
        label={t("Mindmap", "EdgeThickness")}
        face={<ThicknessGlyph thickness={edge.thickness ?? 1.5} />}
        open={thicknesses}
        onOpen={setThicknesses}
      >
        <div className="flex gap-0.5">
          {THICKNESSES.map((entry) => (
            <Slot
              key={entry.value}
              label={t("Mindmap", entry.key)}
              active={edge.thickness === entry.value}
              onClick={() => {
                style({ thickness: entry.value })
                setThicknesses(false)
              }}
            >
              <ThicknessGlyph thickness={entry.value} />
            </Slot>
          ))}
        </div>
      </Popped>

      <Sep />

      <Slot
        label={t("Mindmap", "ApplyBelow")}
        active={deep}
        // Off for a link edge rather than hidden, so the bar keeps the same controls in the same
        // places whichever kind of edge is selected.
        disabled={!branching}
        onClick={() => setCascade((on) => !on)}
      >
        <CascadeGlyph />
      </Slot>

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
 * A slot whose choices are too many to lay out on the bar.
 *
 * The face is the value the edge holds now, so an unopened control still says what the edge is. The
 * wrapper is `relative` because the panel positions against the nearest positioned ancestor, and the
 * control that owns a flyout is the one that has to be it.
 */
function Popped({
  label,
  face,
  open,
  onOpen,
  children,
}: {
  label: string
  face: ReactNode
  open: boolean
  onOpen: (open: boolean) => void
  children: ReactNode
}) {
  return (
    <span className="relative flex">
      <Slot label={label} active={open} onClick={() => onOpen(!open)}>
        {face}
      </Slot>
      {open ? <FlyoutPanel onClose={() => onOpen(false)}>{children}</FlyoutPanel> : null}
    </span>
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
