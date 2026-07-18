import { cn } from "@/lib/utils"

// Menu styling, shared by the click-triggered flyout (./menu) and the right-click
// variant (./context-menu) so the two are indistinguishable on screen. Kept out of
// the component files so both stay fast-refreshable.

export const CONTENT_CLASS = "z-50 min-w-[168px] rounded-lg border border-line bg-popover p-1 shadow-elevation-2"

export const ITEM_CLASS =
  "flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-body-extra-small outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-45"

export function itemClass(danger?: boolean, emphasis?: boolean): string {
  return cn(
    ITEM_CLASS,
    danger
      ? "text-destructive data-[highlighted]:bg-destructive/10"
      : "text-text-secondary data-[highlighted]:bg-surface-subtle data-[highlighted]:text-foreground",
    emphasis && !danger && "font-medium text-foreground",
  )
}
