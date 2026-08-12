import type { ReactNode } from "react"

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"

import type { FolderMenuEntry } from "./folder-row-menu-items"

/** Renders the folder's verb list with the right-click family. */
function renderFolderContextMenu(entries: readonly FolderMenuEntry[]) {
  return entries.map((entry) => {
    switch (entry.kind) {
      case "separator":
        return <ContextMenuSeparator key={entry.id} />
      case "item":
        return (
          <ContextMenuItem
            key={entry.id}
            icon={entry.icon}
            emphasis={entry.emphasis}
            danger={entry.danger}
            onSelect={entry.run}
          >
            {entry.label}
          </ContextMenuItem>
        )
    }
  })
}

/**
 * Right-click anywhere on a folder row and get the same verbs its overflow button
 * offers, because both surfaces render one list.
 *
 * Disabled while the name is being edited: the webview keeps its own menu over a
 * text field, which is where the clipboard commands and the spelling suggestions
 * live, and two menus would answer the one click.
 *
 * `opensEditor` answers whether the verb just chosen was rename, which raises the inline
 * editor and needs the menu to leave focus alone on the way out or the field is blurred,
 * and committed, the instant it appears.
 */
export function FolderRowContextMenu({
  entries,
  disabled,
  opensEditor,
  children,
}: {
  entries: readonly FolderMenuEntry[]
  disabled?: boolean
  opensEditor: () => boolean
  children: ReactNode
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild disabled={disabled}>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent opensDialog={opensEditor}>{renderFolderContextMenu(entries)}</ContextMenuContent>
    </ContextMenu>
  )
}
