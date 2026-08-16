import { useState } from "react"

import { AppIcon } from "@/components/icon/AppIcon"
import { useT } from "@/i18n/useT"

import type { EdgeStyle } from "../model/document"
import type { SceneEdge } from "../model/scene"
import { BRANCH_COUNT, branchColor, branchToken } from "../scene/tokens"
import { FloatBar, Sep, Slot } from "./bits"
import { LINES, ROUTES, THICKNESSES } from "./choices"
import { EndsGlyph, LineGlyph, RouteGlyph, SwatchGlyph, ThicknessGlyph } from "./glyphs"
import { CapRow, Cell, Group, MenuToggle, Popped } from "./menu"

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
 * Four slots, one per decision. Laid out flat this was sixteen buttons, six of which were the same
 * three caps drawn twice in opposite directions, and the bar was wider than most of the maps it
 * floats over. Grouped, each slot shows what the edge is now and holds the values behind it, and
 * the two ends are one control that shows the direction the edge points rather than two that each
 * show half of it.
 *
 * How far a choice reaches lives inside each panel rather than in a slot of its own. It is part of
 * making a choice, not a choice in itself, and next to the values it applies to it says what it
 * means without a tooltip.
 */
export function EdgeBar({ edge, count, onStyle, onLabel }: EdgeBarProps) {
  const t = useT()
  const [open, setOpen] = useState<"line" | "route" | "ends" | "color" | null>(null)
  const [cascade, setCascade] = useState(false)
  const line = edge.lineStyle ?? "solid"
  const routing = edge.routing ?? "curve"
  const startCap = edge.startCap ?? "none"
  const endCap = edge.endCap ?? "none"
  const shown = (which: typeof open) => (on: boolean) => setOpen(on ? which : null)

  // A link edge has nothing below it, so the toggle cannot be honoured on one however it was left by
  // the last edge that was selected.
  const branching = edge.kind === "hierarchy"
  const deep = cascade && branching
  const style = (patch: EdgeStyle) => onStyle(patch, deep)

  /** The same switch in every panel, because it qualifies whatever that panel is about to set. */
  const reach = (
    <MenuToggle
      label={t("Mindmap", "ApplyBelow")}
      on={deep}
      // Off for a link edge rather than hidden, so a panel keeps the same rows whichever kind of
      // edge is selected.
      disabled={!branching}
      onToggle={setCascade}
    />
  )

  return (
    <FloatBar>
      <Popped
        label={t("Mindmap", "EdgeLine")}
        face={<LineGlyph line={line} />}
        open={open === "line"}
        onOpen={shown("line")}
        width="w-[196px]"
      >
        <Group label={t("Mindmap", "EdgeLine")}>
          {LINES.map((entry) => (
            <Cell
              key={entry.value}
              label={t("Mindmap", entry.key)}
              active={line === entry.value}
              onClick={() => style({ line: entry.value })}
            >
              <LineGlyph line={entry.value} />
            </Cell>
          ))}
        </Group>
        {/* With the line styles rather than in a slot of its own: a stroke's weight and its pattern
            are one decision about how loud the edge is, and nobody sets one without looking at the
            other. */}
        <Group label={t("Mindmap", "EdgeThickness")}>
          {THICKNESSES.map((entry) => (
            <Cell
              key={entry.value}
              label={t("Mindmap", entry.key)}
              active={(edge.thickness ?? 1.5) === entry.value}
              onClick={() => style({ thickness: entry.value })}
            >
              <ThicknessGlyph thickness={entry.value} />
            </Cell>
          ))}
        </Group>
        {reach}
      </Popped>

      <Popped
        label={t("Mindmap", "Routing")}
        face={<RouteGlyph routing={routing} />}
        open={open === "route"}
        onOpen={shown("route")}
        width="w-[168px]"
      >
        <Group label={t("Mindmap", "Routing")}>
          {ROUTES.map((entry) => (
            <Cell
              key={entry.value}
              label={t("Mindmap", entry.key)}
              active={routing === entry.value}
              onClick={() => style({ routing: entry.value })}
            >
              <RouteGlyph routing={entry.value} />
            </Cell>
          ))}
        </Group>
        {reach}
      </Popped>

      <Popped
        label={t("Mindmap", "Ends")}
        face={<EndsGlyph start={startCap} end={endCap} />}
        open={open === "ends"}
        onOpen={shown("ends")}
        width="w-[196px]"
      >
        {/* Two rows rather than one control with four directions. The model has always held the two
            ends as two fields, and a combined control can say arrows at both ends or at neither but
            not an arrow at the start only, which is a thing people draw. */}
        <Group label={t("Mindmap", "Ends")}>
          <div className="flex w-full flex-col gap-1">
            <CapRow
              label={t("Mindmap", "CapStart")}
              end="start"
              value={startCap}
              onPick={(cap) => style({ startCap: cap })}
            />
            <CapRow
              label={t("Mindmap", "CapEnd")}
              end="end"
              value={endCap}
              onPick={(cap) => style({ endCap: cap })}
            />
          </div>
        </Group>
        {reach}
      </Popped>

      <Popped
        label={t("Mindmap", "EdgeColor")}
        face={<SwatchGlyph color={edge.color ?? "var(--line)"} active={false} />}
        open={open === "color"}
        onOpen={shown("color")}
        width="w-[188px]"
      >
        <Group label={t("Mindmap", "EdgeColor")}>
          <div className="grid w-full grid-cols-4 gap-1">
            {Array.from({ length: BRANCH_COUNT }, (_, index) => (
              <Cell
                key={index}
                label={`${t("Mindmap", "EdgeColor")} ${index + 1}`}
                active={edge.color === branchColor(index)}
                onClick={() => {
                  style({ color: branchToken(index) })
                  setOpen(null)
                }}
              >
                <SwatchGlyph color={branchColor(index)} active={edge.color === branchColor(index)} />
              </Cell>
            ))}
          </div>
        </Group>
        {reach}
        {/* The way back out. An edge with no colour of its own takes the branch's, which is what
            makes a coloured map read as branches rather than as a hundred separate lines, and
            there has to be one press that gives that back. */}
        <button
          type="button"
          onClick={() => {
            style({ color: null })
            setOpen(null)
          }}
          className="block w-full rounded-lg px-2 py-1.5 text-left text-[11.5px] text-ink-2 hover:bg-frame-hover hover:text-ink"
        >
          {t("Mindmap", branching ? "MatchBranch" : "DefaultColor")}
        </button>
      </Popped>

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

      {count > 1 ? (
        <>
          <Sep />
          <span className="px-1 text-[11.5px] tabular-nums text-ink-3">{count}</span>
        </>
      ) : null}
    </FloatBar>
  )
}
