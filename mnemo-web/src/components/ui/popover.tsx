import type { ReactNode } from "react"
import { Popover as RadixPopover } from "radix-ui"

import { cn } from "@/lib/utils"

// A panel anchored to a control, for choices that are a layout rather than a list.
//
// The menu next door is the right shape for a column of labelled actions; it is the wrong one for a
// grid of previews, where the items are pictures of what they do and arrowing between them in
// reading order is not how anyone uses them. Same surface, same border, same shadow, so the two read
// as one family.

export const Popover = RadixPopover.Root
export const PopoverTrigger = RadixPopover.Trigger
export const PopoverClose = RadixPopover.Close

export function PopoverContent({
  children,
  align = "start",
  side = "bottom",
  className,
  onOpenAutoFocus,
  onEscapeKeyDown,
}: {
  children: ReactNode
  align?: "start" | "center" | "end"
  /** Which way the panel opens. Set it when the trigger sits at the edge it would open into. */
  side?: "top" | "right" | "bottom" | "left"
  className?: string
  /** Preventing the default keeps the focus where the content already put it, such as a field. */
  onOpenAutoFocus?: (event: Event) => void
  /** Preventing the default keeps the panel open, for a field inside it that uses Escape itself. */
  onEscapeKeyDown?: (event: KeyboardEvent) => void
}) {
  return (
    <RadixPopover.Portal>
      <RadixPopover.Content
        align={align}
        side={side}
        sideOffset={4}
        // Collision handling is Radix's, which is the entire reason for using it: a panel opened from
        // a control near the window edge has to flip and shift, and hand-rolling that is how every
        // other app ends up with a menu half off the screen.
        collisionPadding={8}
        onOpenAutoFocus={onOpenAutoFocus}
        onEscapeKeyDown={onEscapeKeyDown}
        className={cn(
          // Z_LAYERS.menu, spelled out because Tailwind reads class names from the source.
          "z-[95] rounded-lg border border-line bg-popover p-1 shadow-elevation-2 outline-none",
          className,
        )}
      >
        {children}
      </RadixPopover.Content>
    </RadixPopover.Portal>
  )
}

/** A heading over one group of choices. Small, quiet, and never a control. */
export function PopoverGroupLabel({ children }: { children: ReactNode }) {
  return (
    <h3 className="px-2 pb-1 pt-2 text-[9.5px] font-semibold uppercase tracking-[0.06em] text-ink-3 first:pt-1">
      {children}
    </h3>
  )
}
