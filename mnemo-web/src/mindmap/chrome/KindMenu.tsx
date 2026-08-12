import { useState } from "react"

import { AppIcon } from "@/components/icon/AppIcon"
import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"

import { KIND_ICON, KIND_LABEL, NODE_KINDS, type NodeKind } from "../scene/content"
import { Slot } from "./bits"
import { FlyoutPanel } from "./FlyoutPanel"

export interface KindMenuProps {
  /** What the node is now, or null for a kind this build does not know. */
  kind: NodeKind | null
  onPick: (kind: NodeKind) => void
}

/**
 * What a node is, as opposed to what it looks like.
 *
 * A list rather than a row of glyphs, which is what the shapes and sizes beside it get. Those four
 * are drawings of themselves and read at a glance; a mark meaning "code" is a convention, and seven
 * conventions in a row is a quiz. The names are the control here and the marks go with them.
 */
export function KindMenu({ kind, onPick }: KindMenuProps) {
  const t = useT()
  const [open, setOpen] = useState(false)

  return (
    // Relative, because the panel positions against the nearest positioned ancestor and the control
    // that owns it is the one that has to be it.
    <span className="relative flex">
      <Slot label={t("Mindmap", "NodeType")} active={open} onClick={() => setOpen((shown) => !shown)}>
        <AppIcon name={kind ? KIND_ICON[kind] : "notes/text"} size={15} />
      </Slot>
      {open ? (
        <FlyoutPanel onClose={() => setOpen(false)} className="w-[150px]">
          <ul className="flex flex-col">
            {NODE_KINDS.map((value) => (
              <li key={value}>
                <button
                  type="button"
                  aria-pressed={value === kind}
                  onClick={() => {
                    setOpen(false)
                    onPick(value)
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12.5px] transition-colors duration-120",
                    value === kind
                      ? "bg-frame-hover text-ink"
                      : "text-ink-2 hover:bg-frame-hover hover:text-ink",
                  )}
                >
                  <AppIcon name={KIND_ICON[value]} size={14} />
                  {t("Mindmap", KIND_LABEL[value])}
                </button>
              </li>
            ))}
          </ul>
        </FlyoutPanel>
      ) : null}
    </span>
  )
}
