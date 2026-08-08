import { AppIcon } from "@/components/icon/AppIcon"

import { useOverviewStore } from "../store"

/**
 * The floating proxy that follows the pointer during a drag, so the gesture reads as carrying the
 * widget rather than pushing an empty slot around.
 *
 * Positioned in board coordinates, which is the only space the drag works in, and offset below-right
 * of the cursor rather than sitting under it. It is the sole subscriber to the ghost slice, so a
 * pointer move repaints this and nothing else.
 */
export function DragGhost() {
  const ghost = useOverviewStore((state) => state.ghost)
  if (!ghost.visible) return null

  return (
    <div
      className="pointer-events-none absolute z-10 flex items-center gap-[9px] rounded-lg bg-[var(--floating-chrome-background)] px-3 py-[9px] opacity-[0.94] shadow-elevation-3"
      // Lifted very slightly off the board, the same trick as a raised card: enough to read as
      // picked up, not enough to look like a different size.
      style={{ left: ghost.x, top: ghost.y, transform: "scale(1.02)" }}
      aria-hidden="true"
    >
      <AppIcon name="common/grip-vertical" size={16} className="text-[var(--floating-chrome-foreground-muted)]" />
      <span className="whitespace-nowrap text-body-small font-semibold text-[var(--floating-chrome-foreground-strong)]">
        {ghost.title}
      </span>
      <span className="rounded-sm bg-[var(--floating-chrome-hover)] px-1.5 py-0.5 font-mono text-caption text-[var(--floating-chrome-foreground-muted)]">
        {ghost.sizeLabel}
      </span>
    </div>
  )
}
