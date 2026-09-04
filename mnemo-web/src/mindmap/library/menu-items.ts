import type { IconName } from "@/components/icon/icon-registry"
import type { TranslateFn } from "@/i18n/types"

/**
 * The library's verbs, described once.
 *
 * A card's overflow button and its right-click menu are two Radix families that cannot
 * share components, so they share this instead: one list, rendered twice. Every handler
 * is injected, which keeps the list free of React, of the router and of the transfer
 * store, and lets a test read the whole menu without a DOM.
 */

export interface LibraryMenuItem {
  readonly kind: "item"
  readonly id: string
  readonly label: string
  readonly icon?: IconName
  readonly danger?: boolean
  readonly run: () => void
}

export interface LibraryMenuSeparator {
  readonly kind: "separator"
  readonly id: string
}

export type LibraryMenuEntry = LibraryMenuItem | LibraryMenuSeparator

export interface MapMenuHandlers {
  readonly rename: () => void
  readonly duplicate: () => void
  readonly export: () => void
  readonly remove: () => void
}

export interface FolderMenuHandlers {
  readonly rename: () => void
  readonly remove: () => void
}

/** A map offers the same four verbs wherever it is drawn: card, row, or recent strip. */
export function mapMenuItems({ t, on }: { t: TranslateFn; on: MapMenuHandlers }): readonly LibraryMenuEntry[] {
  const mm = (key: string) => t("Mindmap", key)

  return [
    { kind: "item", id: "rename", label: mm("Rename"), icon: "flyout/rename", run: on.rename },
    { kind: "item", id: "duplicate", label: mm("Duplicate"), icon: "common/copy", run: on.duplicate },
    { kind: "item", id: "export", label: mm("Export"), icon: "common/upload", run: on.export },
    { kind: "separator", id: "sep.delete" },
    { kind: "item", id: "delete", label: mm("Delete"), icon: "common/trash", danger: true, run: on.remove },
  ]
}

/** A folder has two verbs; filing happens by drag, not from a menu. */
export function folderMenuItems({
  t,
  on,
}: {
  t: TranslateFn
  on: FolderMenuHandlers
}): readonly LibraryMenuEntry[] {
  const mm = (key: string) => t("Mindmap", key)

  return [
    { kind: "item", id: "rename", label: mm("Rename"), icon: "flyout/rename", run: on.rename },
    { kind: "separator", id: "sep.delete" },
    { kind: "item", id: "delete", label: mm("Delete"), icon: "common/trash", danger: true, run: on.remove },
  ]
}
