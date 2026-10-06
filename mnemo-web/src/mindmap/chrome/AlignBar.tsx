import type { ReactNode } from "react"

import { AppIcon } from "@/components/icon/AppIcon"
import { useT } from "@/i18n/useT"

import type { AlignOp } from "../edit/align"
import { FloatBar, Sep, Slot } from "./bits"
import { ALIGNS, DISTRIBUTES } from "./choices"

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
 * same one twice is deliberately nothing, since the second press has nothing left to move. A
 * surface with one more verb to offer, such as grouping, passes it as `leading`.
 *
 * The two distributes are dimmed rather than dropped below three elements, so the bar keeps the same
 * controls in the same places however much is selected.
 */
export function AlignBar({ align, leading }: { align: AlignControl; leading?: ReactNode }) {
  const t = useT()

  return (
    <FloatBar>
      {leading ? (
        <>
          {leading}
          <Sep />
        </>
      ) : null}

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
