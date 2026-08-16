import { AppIcon } from "@/components/icon/AppIcon"
import { useT } from "@/i18n/useT"

import type { AlignOp } from "../edit/align"
import { FloatBar, Sep, Slot } from "./bits"

/**
 * The order is the one a hand reaches for: the three horizontal edges, then the three vertical ones,
 * then the two that spread things out. The icon names read as the axis the line is drawn on rather
 * than the direction things travel, which is why "start-vertical" is the one that lines left edges up.
 */
const ALIGNS: readonly { op: AlignOp; key: string; icon: string }[] = [
  { op: "left", key: "AlignLeft", icon: "common/align-start-vertical" },
  { op: "centerHorizontal", key: "AlignCenterH", icon: "common/align-center-vertical" },
  { op: "right", key: "AlignRight", icon: "common/align-end-vertical" },
  { op: "top", key: "AlignTop", icon: "common/align-start-horizontal" },
  { op: "middleVertical", key: "AlignMiddleV", icon: "common/align-center-horizontal" },
  { op: "bottom", key: "AlignBottom", icon: "common/align-end-horizontal" },
]

const DISTRIBUTES: readonly { op: AlignOp; key: string; icon: string }[] = [
  { op: "distributeHorizontal", key: "DistributeH", icon: "common/align-horizontal-distribute-center" },
  { op: "distributeVertical", key: "DistributeV", icon: "common/align-vertical-distribute-center" },
]

export interface AlignControl {
  /** False below three elements, where there is nothing between the anchors to space out. */
  canDistribute: boolean
  apply: (op: AlignOp) => void
}

/**
 * What a handful of loose elements can be lined up into.
 *
 * Eight controls with no state between them: each one is a whole decision, and the bar shows nothing
 * as active because there is no such thing as a selection being "in left-aligned mode". Pressing the
 * same one twice is deliberately nothing, since the second press has nothing left to move.
 *
 * The two distributes are dimmed rather than dropped below three elements, so the bar keeps the same
 * controls in the same places however much is selected.
 */
export function AlignBar({ align }: { align: AlignControl }) {
  const t = useT()

  return (
    <FloatBar>
      {ALIGNS.map((entry) => (
        <Slot key={entry.op} label={t("Mindmap", entry.key)} onClick={() => align.apply(entry.op)}>
          <AppIcon name={entry.icon} size={15} strokeWidth={1.7} />
        </Slot>
      ))}

      <Sep />

      {DISTRIBUTES.map((entry) => (
        <Slot
          key={entry.op}
          label={t("Mindmap", entry.key)}
          disabled={!align.canDistribute}
          onClick={() => align.apply(entry.op)}
        >
          <AppIcon name={entry.icon} size={15} strokeWidth={1.7} />
        </Slot>
      ))}
    </FloatBar>
  )
}
