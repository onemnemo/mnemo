/**
 * Reading and writing the per-instance widget settings bag.
 *
 * The desktop reads the same bag out of the same stored row, so these have to agree with
 * WidgetSettingValues byte for byte, not merely in spirit. Every rule below exists because the C#
 * side has it: whitespace counts as absent, parsing is culture-invariant, and a value that will
 * not parse falls back to the schema's own default before it falls back to zero.
 */

import type { WidgetSettingSchema } from "../widgets/manifest"

/**
 * What .NET's int.TryParse accepts with NumberStyles.Integer, which is narrower than Number():
 * no decimal point, no exponent, no hex, and not the empty string. A setting stored as "3.5" is a
 * parse failure on the desktop and has to be one here too, or the two apps disagree on a value
 * neither of them wrote.
 */
const INTEGER = /^[+-]?\d+$/

/** The stored value when there is one, otherwise the schema's default. Whitespace is absent. */
export function getString(bag: Record<string, string> | undefined, schema: WidgetSettingSchema): string {
  const stored = bag?.[schema.key]
  return stored !== undefined && stored.trim() !== "" ? stored : schema.defaultValue
}

export function getInt(bag: Record<string, string> | undefined, schema: WidgetSettingSchema): number {
  const parse = (raw: string) => (INTEGER.test(raw.trim()) ? Number(raw.trim()) : undefined)
  // The schema default is parsed rather than trusted: it is authored as a string like every other
  // value in the bag, so a typo in a manifest degrades to 0 instead of to NaN.
  return parse(getString(bag, schema)) ?? parse(schema.defaultValue) ?? 0
}

export function getBool(bag: Record<string, string> | undefined, schema: WidgetSettingSchema): boolean {
  const parse = (raw: string) => {
    const text = raw.trim().toLowerCase()
    return text === "true" ? true : text === "false" ? false : undefined
  }
  return parse(getString(bag, schema)) ?? parse(schema.defaultValue) ?? false
}

/** Culture-invariant, always. Never format a value into this bag for display. */
export const fromInt = (value: number) => String(Math.trunc(value))

export const fromBool = (value: boolean) => (value ? "true" : "false")

/**
 * What a widget actually calls: the effective value of one of its own settings.
 *
 * A key the manifest does not declare yields the empty value rather than throwing, matching the
 * desktop. There is no schema to take a default from in that case, and a widget asking for a
 * setting it never declared is a bug in the widget, not something a user can reach.
 */
function schemaFor(manifest: SettingsOwner, key: string): WidgetSettingSchema | undefined {
  return manifest.settings?.find((schema) => schema.key === key)
}

/** Just the part of a manifest these need, so a caller can pass a manifest or a bare schema list. */
interface SettingsOwner {
  settings?: WidgetSettingSchema[]
}

export function settingString(manifest: SettingsOwner, bag: Record<string, string> | undefined, key: string): string {
  const schema = schemaFor(manifest, key)
  return schema === undefined ? "" : getString(bag, schema)
}

export function settingInt(manifest: SettingsOwner, bag: Record<string, string> | undefined, key: string): number {
  const schema = schemaFor(manifest, key)
  return schema === undefined ? 0 : getInt(bag, schema)
}

export function settingBool(manifest: SettingsOwner, bag: Record<string, string> | undefined, key: string): boolean {
  const schema = schemaFor(manifest, key)
  return schema !== undefined && getBool(bag, schema)
}
