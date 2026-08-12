import type { ReactNode } from "react"

import { AppIcon } from "@/components/icon/AppIcon"
import { Menu, MenuContent, MenuTrigger } from "@/components/ui/menu"

/**
 * The overflow affordance every card and row shares: hidden until the card is hovered, and pinned
 * open while the menu is.
 *
 * The trigger swallows its own pointer events. A card is a button that opens the map, so a press
 * that reached it would open the map and the menu at once, and the menu would be over a page that
 * had already navigated away.
 */
export function CardMenuButton({
  label,
  className,
  children,
}: {
  label: string
  className?: string
  children: ReactNode
}) {
  return (
    <Menu>
      <MenuTrigger asChild>
        <button
          type="button"
          aria-label={label}
          title={label}
          onClick={(event) => {
            event.stopPropagation()
            event.preventDefault()
          }}
          onPointerDown={(event) => event.stopPropagation()}
          className={
            className ??
            "grid size-7 place-items-center rounded-md bg-canvas/90 text-ink-3 opacity-0 backdrop-blur-sm transition-opacity hover:bg-frame-active hover:text-ink focus-visible:opacity-100 aria-expanded:opacity-100 group-hover/card:opacity-100"
          }
        >
          <AppIcon name="common/dots-vertical" size={15} />
        </button>
      </MenuTrigger>
      <MenuContent align="end">{children}</MenuContent>
    </Menu>
  )
}
