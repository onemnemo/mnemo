import type { ReactNode } from "react"

import { AppIcon } from "@/components/icon/AppIcon"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu"

import type { LibraryMenuEntry } from "../menu-items"

/**
 * The library's two menu surfaces over one verb list: the overflow button on a card or a
 * row, and a right-click anywhere on the card. A map offers the same verbs from either,
 * which is what the notes tree and the deck list already do.
 */

/** The verb list in the flyout family, for a `MenuContent` somebody else owns the trigger of. */
export function LibraryMenuItems({ entries }: { entries: readonly LibraryMenuEntry[] }): ReactNode {
  return entries.map((entry) =>
    entry.kind === "separator" ? (
      <MenuSeparator key={entry.id} />
    ) : (
      <MenuItem key={entry.id} icon={entry.icon} danger={entry.danger} onSelect={entry.run}>
        {entry.label}
      </MenuItem>
    ),
  )
}

/** Renders the verb list with the right-click family. */
function renderContextMenu(entries: readonly LibraryMenuEntry[]): ReactNode {
  return entries.map((entry) =>
    entry.kind === "separator" ? (
      <ContextMenuSeparator key={entry.id} />
    ) : (
      <ContextMenuItem key={entry.id} icon={entry.icon} danger={entry.danger} onSelect={entry.run}>
        {entry.label}
      </ContextMenuItem>
    ),
  )
}

/** Hidden until the card is hovered, and pinned open while the menu is. */
const CARD_BUTTON_CLASS =
  "grid size-7 place-items-center rounded-md bg-canvas/90 text-ink-3 opacity-0 backdrop-blur-sm transition-opacity hover:bg-frame-active hover:text-ink focus-visible:opacity-100 aria-expanded:opacity-100 group-hover/card:opacity-100"

/**
 * The overflow affordance every card and row shares.
 *
 * The trigger swallows its own pointer events. A card is a button that opens the map, so a
 * press that reached it would open the map and the menu at once, and the menu would be over
 * a page that had already navigated away.
 */
export function LibraryMenuButton({
  label,
  entries,
  className = CARD_BUTTON_CLASS,
}: {
  label: string
  entries: readonly LibraryMenuEntry[]
  className?: string
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
          className={className}
        >
          <AppIcon name="common/dots-vertical" size={15} />
        </button>
      </MenuTrigger>
      <MenuContent align="end">
        <LibraryMenuItems entries={entries} />
      </MenuContent>
    </Menu>
  )
}

/**
 * Right-click a card, a row or a recent tile and get the verbs its overflow button offers.
 *
 * The trigger is `asChild` so the card itself raises the menu; Radix composes onto the
 * drag handlers the card already carries, so the press that starts a drag still arrives.
 */
export function LibraryContextMenu({
  entries,
  children,
}: {
  entries: readonly LibraryMenuEntry[]
  children: ReactNode
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>{renderContextMenu(entries)}</ContextMenuContent>
    </ContextMenu>
  )
}
