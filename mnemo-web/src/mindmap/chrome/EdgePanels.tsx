import { AppIcon } from "@/components/icon/AppIcon"
import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"

import type { ArrowCap, EdgeRouting, EdgeStyle } from "../model/document"
import type { SceneEdge } from "../model/scene"
import { branchColor } from "../scene/tokens"
import { CapPreview, PatternGlyph, RoutePreview } from "./bar-glyphs"
import { CAPS, LINES, ROUTES, THICKNESSES, weightOf } from "./choices"
import { HeaderAction, PanelHeader, PanelRule } from "./panel/PanelHeader"
import { Segmented } from "./panel/Segmented"
import { SwatchRow } from "./panel/SwatchRow"
import { SwitchRow } from "./panel/SwitchRow"
import { TileGrid } from "./panel/TileGrid"

type Style = (patch: EdgeStyle) => void

/** The "branches below" switch, shared by every panel whose choice it qualifies. */
export interface Reach {
  branching: boolean
  on: boolean
  onToggle: (on: boolean) => void
}

/** Bar heights for the three weights, exaggerated enough to tell apart at this size. */
const WEIGHT_BAR: Record<number, number> = { 1: 1, 1.5: 2, 2.5: 3.5 }

function ReachSwitch({ reach }: { reach: Reach }) {
  const t = useT()
  return (
    <>
      <PanelRule />
      {/* Off for a link edge rather than hidden, so a panel keeps the same rows whichever kind of
          edge is selected. */}
      <SwitchRow
        title={t("Mindmap", "BranchesBelow")}
        detail={t("Mindmap", "ApplyBelowDetail")}
        on={reach.on}
        disabled={!reach.branching}
        onToggle={reach.onToggle}
      />
    </>
  )
}

export function EdgeLinePanel({ edge, style, reach }: { edge: SceneEdge; style: Style; reach: Reach }) {
  const t = useT()
  return (
    <>
      <PanelHeader label={t("Mindmap", "EdgeLine")} />
      <TileGrid
        height={56}
        value={edge.lineStyle ?? "solid"}
        onPick={(line) => style({ line })}
        tiles={LINES.map((entry) => ({
          value: entry.value,
          label: t("Mindmap", entry.key),
          preview: <PatternGlyph line={entry.value} width={40} weight={2} />,
        }))}
      />
      <PanelHeader label={t("Mindmap", "EdgeThickness")} spaced />
      <Segmented
        label={t("Mindmap", "EdgeThickness")}
        value={weightOf(edge)}
        onPick={(thickness) => style({ thickness })}
        className="justify-start gap-2 px-2.5 text-[12px] font-medium"
        segments={THICKNESSES.map((entry) => ({
          value: entry.value,
          label: t("Mindmap", entry.key),
          face: (
            <>
              <span
                aria-hidden
                className="w-4 shrink-0 rounded-[2px] bg-current"
                style={{ height: WEIGHT_BAR[entry.value] }}
              />
              <span className="truncate">{t("Mindmap", entry.key)}</span>
            </>
          ),
        }))}
      />
      <ReachSwitch reach={reach} />
    </>
  )
}

export function EdgeRoutePanel({ routing, style, reach }: { routing: EdgeRouting; style: Style; reach: Reach }) {
  const t = useT()
  return (
    <>
      <PanelHeader label={t("Mindmap", "Routing")} />
      <TileGrid
        height={70}
        value={routing}
        onPick={(next) => style({ routing: next })}
        tiles={ROUTES.map((entry) => ({
          value: entry.value,
          label: t("Mindmap", entry.key),
          preview: <RoutePreview routing={entry.value} />,
        }))}
      />
      <ReachSwitch reach={reach} />
    </>
  )
}

export function EdgeEndsPanel({
  start,
  end,
  canSwap,
  style,
}: {
  start: ArrowCap
  end: ArrowCap
  /** Off for several edges, since swapping this edge's two caps would copy them onto all the others. */
  canSwap: boolean
  style: Style
}) {
  const t = useT()
  const rows = [
    { key: "start" as const, label: t("Mindmap", "CapStart"), value: start },
    { key: "end" as const, label: t("Mindmap", "CapEnd"), value: end },
  ]
  return (
    <>
      <PanelHeader
        label={t("Mindmap", "Ends")}
        action={
          <HeaderAction
            label={t("Mindmap", "SwapEnds")}
            disabled={!canSwap}
            onClick={() => style({ startCap: end, endCap: start })}
          >
            <AppIcon name="arrow-left-right" size={13} strokeWidth={2} />
          </HeaderAction>
        }
      />
      {rows.map((row) => (
        <div key={row.key} className="flex items-center gap-1 py-0.5">
          <span className="w-11 shrink-0 pl-1 text-[12px] text-ink-2">{row.label}</span>
          {CAPS.map((cap) => {
            const on = row.value === cap.value
            return (
              <button
                key={cap.value}
                type="button"
                aria-label={`${row.label} ${t("Mindmap", cap.key)}`}
                aria-pressed={on}
                onClick={() => style(row.key === "start" ? { startCap: cap.value } : { endCap: cap.value })}
                className={cn(
                  "grid h-[34px] grow place-items-center rounded-[9px] outline-none",
                  "transition-colors duration-(--duration-press) ease-[ease] focus-visible:ring-2 focus-visible:ring-accent",
                  on ? "bg-frame-active text-ink" : "text-ink-2 hover:bg-frame-hover hover:text-ink",
                )}
              >
                <CapPreview cap={cap.value} end={row.key === "end"} />
              </button>
            )
          })}
        </div>
      ))}
    </>
  )
}

export function EdgeColorPanel({
  edge,
  inherit,
  style,
  reach,
}: {
  edge: SceneEdge
  inherit: { inherited: boolean; color: string | undefined }
  style: Style
  reach: Reach
}) {
  const t = useT()
  return (
    <>
      <PanelHeader label={t("Mindmap", "EdgeColor")} />
      <SwatchRow
        label={t("Mindmap", "Color")}
        auto={{
          label: t("Mindmap", reach.branching ? "MatchBranch" : "DefaultColor"),
          color: inherit.color ?? "var(--ink-3)",
        }}
        inherited={inherit.inherited}
        picked={(index) => edge.color === branchColor(index)}
        onPick={(token) => style({ color: token })}
      />
      <ReachSwitch reach={reach} />
    </>
  )
}
