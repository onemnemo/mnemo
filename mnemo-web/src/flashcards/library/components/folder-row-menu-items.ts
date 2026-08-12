import type { IconName } from "@/components/icon/icon-registry"
import type { TranslateFn } from "@/i18n/types"

import type { FolderRowModel } from "../tree"

/**
 * The folder row's verbs, described once.
 *
 * The overflow button and the row's right-click menu are two Radix families that
 * cannot share components, so they share this instead: one list, rendered twice.
 * Every handler is injected, which keeps the list free of React.
 *
 * A folder holds three verbs and no submenu, so the entry kinds stop at an item
 * and a rule.
 */

export interface FolderMenuItem {
  readonly kind: "item"
  readonly id: string
  readonly label: string
  readonly icon?: IconName
  /** Draws the item as the suggested action. */
  readonly emphasis?: boolean
  readonly danger?: boolean
  readonly run?: () => void
}

export interface FolderMenuSeparator {
  readonly kind: "separator"
  readonly id: string
}

export type FolderMenuEntry = FolderMenuItem | FolderMenuSeparator

export interface FolderMenuHandlers {
  readonly toggle: () => void
  readonly rename: () => void
  readonly remove: () => void
}

/**
 * Twirling the folder leads, because that is what a click on the row already does
 * and a right click has no other way to reach it. It is the suggested action only
 * while the folder is shut, where there is something behind it to show.
 */
export function folderMenuItems({
  row,
  t,
  on,
}: {
  row: FolderRowModel
  t: TranslateFn
  on: FolderMenuHandlers
}): readonly FolderMenuEntry[] {
  const fc = (key: string) => t("Flashcards", key)

  return [
    {
      kind: "item",
      id: "toggle",
      label: row.expanded ? fc("CollapseFolder") : fc("ExpandFolder"),
      // The chevron points the way the row's own will after the click.
      icon: row.expanded ? "common/chevron-right" : "common/chevron-down",
      emphasis: !row.expanded,
      run: on.toggle,
    },
    { kind: "separator", id: "sep.rename" },
    { kind: "item", id: "rename", label: fc("RenameFolder"), icon: "flyout/rename", run: on.rename },
    { kind: "separator", id: "sep.delete" },
    { kind: "item", id: "delete", label: fc("DeleteFolder"), icon: "common/trash", danger: true, run: on.remove },
  ]
}
