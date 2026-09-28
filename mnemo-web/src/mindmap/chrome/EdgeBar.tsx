import { useState } from "react"

import { AppIcon } from "@/components/icon/AppIcon"
import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"

import type { EdgeStyle } from "../model/document"
import type { SceneEdge } from "../model/scene"
import { EndsFace, PatternGlyph, RouteFace } from "./bar-glyphs"
import { weightOf } from "./choices"
import { EdgeColorPanel, EdgeEndsPanel, EdgeLinePanel, EdgeRoutePanel } from "./EdgePanels"
import { BarButton, BarDivider, SwatchFace } from "./panel/BarButton"
import { PanelBar } from "./panel/PanelBar"
import { usePanel } from "./panel/usePanel"

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
  /** Whether the edge has no colour of its own, and what Auto would give it back. */
  inherit: { inherited: boolean; color: string | undefined }
  /** Changes whenever the selection does, which closes any open panel. */
  selectionKey: string
}

type EdgePanel = "line" | "route" | "ends" | "color"

const WIDTH = 296

/**
 * What a selected edge can be.
 *
 * One button per decision, each showing the edge as it is now, and the label filling the rest.
 * How far a choice reaches is a switch inside the panels it qualifies rather than a button of its own.
 */
export function EdgeBar({ edge, count, onStyle, onLabel, inherit, selectionKey }: EdgeBarProps) {
  const t = useT()
  const panel = usePanel<EdgePanel>(selectionKey)
  const [cascade, setCascade] = useState(false)
  const line = edge.lineStyle ?? "solid"
  const routing = edge.routing ?? "curve"
  const startCap = edge.startCap ?? "none"
  const endCap = edge.endCap ?? "none"
  const opens = (key: EdgePanel) => ({ key, open: panel.open === key })

  // A link edge has nothing below it, so the switch cannot be honoured on one however it was left by
  // the last edge that was selected.
  const branching = edge.kind === "hierarchy"
  const deep = cascade && branching
  const style = (patch: EdgeStyle) => onStyle(patch, deep)
  const reach = { branching, on: deep, onToggle: setCascade }

  const panels = [
    {
      key: "line" as const,
      label: t("Mindmap", "EdgeLine"),
      content: <EdgeLinePanel edge={edge} style={style} reach={reach} />,
    },
    {
      key: "route" as const,
      label: t("Mindmap", "Routing"),
      content: <EdgeRoutePanel routing={routing} style={style} reach={reach} />,
    },
    {
      key: "ends" as const,
      label: t("Mindmap", "Ends"),
      // No switch here, so a cap never goes down the branch however another panel left it.
      content: (
        <EdgeEndsPanel start={startCap} end={endCap} canSwap={count === 1} style={(patch) => onStyle(patch, false)} />
      ),
    },
    {
      key: "color" as const,
      label: t("Mindmap", "EdgeColor"),
      content: <EdgeColorPanel edge={edge} inherit={inherit} style={style} reach={reach} />,
    },
  ]

  return (
    <PanelBar label={t("Mindmap", "EdgeOptions")} width={WIDTH} open={panel.open} onClose={panel.close} panels={panels}>
      <BarButton
        label={t("Mindmap", "EdgeLine")}
        opens={opens("line")}
        onClick={() => panel.toggle("line")}
        className="w-12 gap-[3px] pr-1 pl-1.5"
      >
        <PatternGlyph line={line} width={24} weight={Math.max(1.6, weightOf(edge) + 0.4)} />
        <AppIcon name="chevron-down" size={11} strokeWidth={2.4} className="text-ink-3" />
      </BarButton>

      <BarButton
        label={t("Mindmap", "Routing")}
        opens={opens("route")}
        onClick={() => panel.toggle("route")}
        className="w-[34px] justify-center"
      >
        <RouteFace routing={routing} />
      </BarButton>

      <BarButton
        label={t("Mindmap", "Ends")}
        opens={opens("ends")}
        onClick={() => panel.toggle("ends")}
        className="w-10 justify-center"
      >
        <EndsFace start={startCap} end={endCap} />
      </BarButton>

      <BarButton
        label={t("Mindmap", "EdgeColor")}
        opens={opens("color")}
        onClick={() => panel.toggle("color")}
        className="w-8 justify-center"
      >
        <SwatchFace color={edge.color ?? "var(--ink-3)"} pressed={panel.open === "color"} />
      </BarButton>

      <BarDivider />

      <BarButton
        // Named after what it shows, so a spoken name and the words on screen agree.
        label={edge.label ? `${t("Mindmap", "EditLabel")}: ${edge.label}` : t("Mindmap", "AddLabel")}
        labelled
        // One edge at a time. A label belongs to one edge, and there is no sensible thing for typing
        // into a selection of four of them to mean.
        disabled={count > 1}
        onClick={() => {
          panel.close()
          onLabel()
        }}
        className="min-w-0 grow cursor-text gap-[7px] px-2 text-[12.5px]"
      >
        <AppIcon name="type" size={14} strokeWidth={2} className="shrink-0" />
        <span className={cn("truncate", edge.label ? "text-ink" : "text-ink-3")}>
          {edge.label || t("Mindmap", "AddLabel")}
        </span>
      </BarButton>

      {count > 1 ? (
        <>
          <BarDivider />
          <span className="px-1 text-[11.5px] tabular-nums text-ink-3">{count}</span>
        </>
      ) : null}
    </PanelBar>
  )
}
