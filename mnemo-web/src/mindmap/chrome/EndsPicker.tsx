import { useT } from "@/i18n/useT"

import type { ArrowCap } from "../model/document"
import { CapRow, Group } from "./menu"

export interface EndsPickerProps {
  start: ArrowCap
  end: ArrowCap
  onStart: (cap: ArrowCap) => void
  onEnd: (cap: ArrowCap) => void
}

export function EndsPicker({ start, end, onStart, onEnd }: EndsPickerProps) {
  const t = useT()
  return (
    <Group label={t("Mindmap", "Ends")}>
      <div className="flex w-full flex-col gap-1">
        <CapRow label={t("Mindmap", "CapStart")} end="start" value={start} onPick={onStart} />
        <CapRow label={t("Mindmap", "CapEnd")} end="end" value={end} onPick={onEnd} />
      </div>
    </Group>
  )
}
