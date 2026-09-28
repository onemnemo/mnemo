import { useT } from "@/i18n/useT"
import { formatChord } from "@/keybinds/chord"
import { useShortcutLabel } from "@/keybinds/store"
import { cn } from "@/lib/utils"

import type { RingHit } from "./radial"
import type { RingItem, RingSector } from "./sectors"

/** Whether the ring shows the key hint along the bottom of the pane. One line to drop it. */
export const SHOW_RING_HINT = true

const CHIP = "grid place-items-center rounded-[5px] bg-canvas-sunken font-semibold text-ink-2 shadow-[inset_0_0_0_1px_var(--line)]"

/**
 * The disc in the middle, which names what a release would do.
 *
 * At rest it names only what the ring acts on. With a sector hot it names that sector under it, and
 * with a sub item hot the sector moves up and the item takes its place, so the bottom line is
 * always the thing a release picks.
 */
export function RadialHub({ sectors, hit, subject }: { sectors: readonly RingSector[]; hit: RingHit; subject: string }) {
  const t = useT()
  const sector = hit.hot === null ? null : sectors[hit.hot]
  const item = sector && hit.sub !== null ? sector.sub?.[hit.sub] : undefined
  const chord = useShortcutLabel((item ?? sector)?.action ?? "")

  const over = sector ? (item ? t("Mindmap", sector.nameKey) : subject) : null
  const name = item ? itemName(t, item) : sector ? t("Mindmap", sector.nameKey) : subject

  return (
    <div className="absolute flex size-24 -translate-1/2 flex-col items-center justify-center gap-[3px] rounded-full bg-surface-float px-2 text-center shadow-float">
      {over !== null ? (
        <span className="max-w-20 truncate text-[10px] leading-[1.1] font-medium tracking-[0.02em] text-ink-3">{over}</span>
      ) : null}
      <span aria-live="polite" className="line-clamp-2 max-w-[84px] text-[13px] leading-[1.15] font-semibold tracking-[-0.01em] text-ink">
        {name}
      </span>
      {chord ? <span className={cn(CHIP, "mt-0.5 h-[18px] min-w-[18px] px-[5px] text-[10.5px]")}>{chord}</span> : null}
    </div>
  )
}

function itemName(t: ReturnType<typeof useT>, item: RingItem): string {
  // Numbered the way the node bar's swatch row names them, since a hue has no name of its own.
  return item.glyph.kind === "swatch" ? `${t("Mindmap", item.nameKey)} ${item.glyph.index + 1}` : t("Mindmap", item.nameKey)
}

/** The two things there are to know while the ring is up: let go to pick, or Escape to call it off. */
export function RadialHint({ holdKey }: { holdKey: string }) {
  const t = useT()
  return (
    <div className="pointer-events-none absolute bottom-9 left-1/2 flex h-8 -translate-x-1/2 items-center gap-2.5 rounded-full bg-surface-float pr-3 pl-2 text-[12px] whitespace-nowrap text-ink-3 shadow-float">
      <span className="inline-flex items-center gap-1.5">
        <kbd className={cn(CHIP, "h-5 min-w-5 rounded-[6px] px-[5px] font-sans text-[11px]")}>{formatChord(holdKey)}</kbd>
        {t("Mindmap", "RadialReleaseToPick")}
      </span>
      <span aria-hidden className="size-[3px] rounded-full" style={{ background: "var(--line)" }} />
      <span className="inline-flex items-center gap-1.5">
        <kbd className={cn(CHIP, "h-5 rounded-[6px] px-1.5 font-sans text-[11px]")}>{formatChord("Escape")}</kbd>
        {t("Mindmap", "Cancel")}
      </span>
    </div>
  )
}
