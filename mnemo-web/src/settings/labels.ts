import type { TranslateFn } from "@/i18n/types"

import type { Labelled, SettingOption } from "./types"

// Every settings string resolves from one namespace, matching the desktop's
// T(key) => Localization.T(key, "Settings") shorthand. A literal always wins, for
// the handful of rows the desktop never translated.

export const SETTINGS_NS = "Settings"

export function rowTitle(row: Labelled, t: TranslateFn): string {
  return row.titleText ?? (row.title ? t(SETTINGS_NS, row.title) : "")
}

export function rowDescription(row: Labelled, t: TranslateFn): string {
  return row.descriptionText ?? (row.description ? t(SETTINGS_NS, row.description) : "")
}

/** What an option reads as. Falls back to its stored value when it carries no label. */
export function optionLabel(option: SettingOption, t: TranslateFn): string {
  if (option.labelText) return option.labelText
  if (option.label) return t(SETTINGS_NS, option.label)
  return option.value ?? ""
}

/**
 * What an option persists. Normally its `value`; for rows the desktop stores
 * translated labels in, the resolved label *is* the stored value — which is why those
 * rows' saved values change meaning when the language changes.
 */
export function optionValue(option: SettingOption, t: TranslateFn, localizedValues?: boolean): string {
  if (localizedValues) return optionLabel(option, t)
  return option.value ?? optionLabel(option, t)
}
