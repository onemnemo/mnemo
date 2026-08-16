import { useState } from "react"

import { AppIcon } from "@/components/icon/AppIcon"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverGroupLabel,
  PopoverTrigger,
} from "@/components/ui/popover"
import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"

import type { MapExportFormat } from "../export/save"

export interface ExportMenuProps {
  onExport: (format: MapExportFormat, transparent: boolean) => void
  /** False for a map with nothing on it, which there is no picture of to take. */
  canExport: boolean
}

/**
 * Taking the map out of the app.
 *
 * A picture and an outline under one control, because "export" is one thing anyone reaches for and
 * the choice between them is which file they want, not which feature they want.
 *
 * The paper is a property of the export rather than of the map, so it is asked here and remembered
 * nowhere. A map dropped into a document usually wants no background and the same map saved to look
 * at usually does, and neither is a thing to have decided in advance.
 */
export function ExportMenu({ onExport, canExport }: ExportMenuProps) {
  const t = useT()
  const [transparent, setTransparent] = useState(false)

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          disabled={!canExport}
          title={t("Mindmap", "ExportMap")}
          aria-label={t("Mindmap", "ExportMap")}
        >
          <AppIcon name="common/download" size={15} />
          {t("Mindmap", "Export")}
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-[228px]">
        <PopoverGroupLabel>{t("Mindmap", "GroupPicture")}</PopoverGroupLabel>
        <div className="px-1">
          <Row icon="common/image" label={t("Mindmap", "Png")} onClick={() => onExport("png", transparent)} />
          <Row icon="common/image" label={t("Mindmap", "Svg")} onClick={() => onExport("svg", transparent)} />

          <button
            type="button"
            role="switch"
            aria-checked={transparent}
            onClick={() => setTransparent(!transparent)}
            className="flex h-8 w-full items-center gap-2 rounded-lg px-2 text-[13px] text-ink-2 transition-colors hover:bg-frame-hover hover:text-ink"
          >
            <span
              className={cn(
                "grid size-[15px] shrink-0 place-items-center rounded-[4px] shadow-[inset_0_0_0_1.5px_currentColor]",
                transparent ? "text-accent" : "text-line",
              )}
            >
              {transparent ? <AppIcon name="check" size={10} strokeWidth={2.5} className="text-accent" /> : null}
            </span>
            {t("Mindmap", "ExportTransparentBackground")}
          </button>
        </div>

        <PopoverGroupLabel>{t("Mindmap", "GroupOutline")}</PopoverGroupLabel>
        <div className="px-1 pb-1">
          <Row
            icon="common/file-text"
            label={t("Mindmap", "Markdown")}
            onClick={() => onExport("markdown", transparent)}
          />
        </div>
      </PopoverContent>
    </Popover>
  )
}

/** One format. Closes the menu, since choosing one is the whole of what this panel is for. */
function Row({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <PopoverClose asChild>
      <button
        type="button"
        onClick={onClick}
        className="flex h-8 w-full items-center gap-2 rounded-lg px-2 text-[13px] text-ink-2 transition-colors hover:bg-frame-hover hover:text-ink"
      >
        <AppIcon name={icon} size={15} />
        {label}
      </button>
    </PopoverClose>
  )
}
