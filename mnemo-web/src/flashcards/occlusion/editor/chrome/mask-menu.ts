import type { TranslateFn } from "@/i18n/types"

import type { EditorAction } from "../keys"

export interface MaskMenuItem {
  action: EditorAction
  label: string
  icon: string
  hint?: string
  disabled?: boolean
  danger?: boolean
  separatorBefore?: boolean
}

export interface MaskMenuState {
  /** How many cards the selection spans. */
  cards: number
  /** The selection is exactly one group, so Group reads Ungroup. */
  isGroup: boolean
}

/** The items for a mask or its Cards row. One list, drawn by both menus. */
export function maskMenuItems(
  t: TranslateFn,
  state: MaskMenuState,
  hint: (action: EditorAction) => string | undefined,
): MaskMenuItem[] {
  const label = (key: string) => t("Flashcards", key)
  const grouping: EditorAction = state.isGroup ? "ungroup" : "group"
  return [
    { action: "rename", label: label("OcclusionMenuRename"), icon: "pencil", hint: hint("rename") },
    { action: "duplicate", label: label("OcclusionMenuDuplicate"), icon: "copy", hint: hint("duplicate") },
    {
      action: grouping,
      label: label(state.isGroup ? "OcclusionUngroup" : "OcclusionGroup"),
      icon: "link",
      hint: hint(grouping),
      disabled: !state.isGroup && state.cards < 2,
    },
    { action: "move-earlier", label: label("OcclusionMenuMoveEarlier"), icon: "arrow-up", hint: hint("move-earlier") },
    { action: "move-later", label: label("OcclusionMenuMoveLater"), icon: "arrow-down", hint: hint("move-later") },
    {
      action: "delete",
      label: label("OcclusionMenuDelete"),
      icon: "trash-2",
      hint: hint("delete"),
      danger: true,
      separatorBefore: true,
    },
  ]
}
