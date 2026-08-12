import type { ReactNode } from "react"

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSectionLabel,
  ContextMenuSeparator,
  ContextMenuSubMenu,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"

import type { DeckMenuEntry } from "./deck-row-menu-items"

/** Renders the deck's verb list with the right-click family. */
function renderDeckContextMenu(entries: readonly DeckMenuEntry[]): ReactNode {
  return entries.map((entry) => {
    switch (entry.kind) {
      case "separator":
        return <ContextMenuSeparator key={entry.id} />
      case "section":
        return <ContextMenuSectionLabel key={entry.id}>{entry.label}</ContextMenuSectionLabel>
      case "submenu":
        return (
          <ContextMenuSubMenu
            key={entry.id}
            label={entry.label}
            icon={entry.icon}
            hint={entry.hint}
            emphasis={entry.emphasis}
          >
            {renderDeckContextMenu(entry.items)}
          </ContextMenuSubMenu>
        )
      case "item":
        return (
          <ContextMenuItem
            key={entry.id}
            icon={entry.icon}
            hint={entry.hint}
            danger={entry.danger}
            emphasis={entry.emphasis}
            disabled={entry.disabled}
            onSelect={entry.run}
          >
            {entry.label}
          </ContextMenuItem>
        )
    }
  })
}

/**
 * Right-click anywhere on a deck row and get the same verbs its overflow button
 * offers, because both surfaces render one list.
 */
export function DeckRowContextMenu({
  entries,
  children,
}: {
  entries: readonly DeckMenuEntry[]
  children: ReactNode
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>{renderDeckContextMenu(entries)}</ContextMenuContent>
    </ContextMenu>
  )
}
