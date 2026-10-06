import { useState, type DragEvent } from "react"

import { AppIcon } from "@/components/icon/AppIcon"
import { Button } from "@/components/ui/button"
import { useT } from "@/i18n/useT"
import { formatChordParts } from "@/keybinds/chord"
import { cn } from "@/lib/utils"

/** Where an image goes before there is one: dropped, picked or pasted. */
export function EmptyDropZone({
  onChoose,
  onDragOver,
  onDrop,
}: {
  onChoose: () => void
  onDragOver: (event: DragEvent) => void
  onDrop: (event: DragEvent) => void
}) {
  const t = useT()
  const [over, setOver] = useState(false)

  return (
    <div
      data-testid="occlusion-drop-zone"
      onDragOver={(event) => {
        onDragOver(event)
        setOver(true)
      }}
      // Crossing from the zone onto one of its own children is not leaving it.
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false)
      }}
      onDrop={(event) => {
        setOver(false)
        onDrop(event)
      }}
      className={cn(
        "absolute inset-6 grid place-items-center rounded-xl border-[1.5px] border-dashed transition-colors",
        over ? "border-accent bg-accent-wash" : "border-line",
      )}
    >
      <div className="flex flex-col items-center gap-3">
        <AppIcon name="image-plus" size={22} strokeWidth={1.6} className="text-ink-3" />
        <p className="m-0 text-[14px] font-medium text-ink">{t("Flashcards", "OcclusionEmptyTitle")}</p>
        <Button variant="outline" onClick={onChoose}>
          {t("Flashcards", "OcclusionChooseImage")}
        </Button>
        <p className="m-0 flex items-center gap-1.5 text-[12px] text-ink-3">
          {t("Flashcards", "OcclusionPasteHint")}
          {formatChordParts("Primary+V").map((part) => (
            <kbd
              key={part}
              className="grid h-[22px] min-w-[22px] place-items-center rounded-[5px] px-1.5 font-sans text-[11.5px] font-medium text-ink-2 shadow-[inset_0_0_0_1px_var(--line)]"
            >
              {part}
            </kbd>
          ))}
        </p>
      </div>
    </div>
  )
}
