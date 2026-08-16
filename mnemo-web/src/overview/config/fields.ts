/**
 * Decoding and encoding one config-dialog field.
 *
 * This is a *different* ladder from the widget-read one in encode.ts, and the difference is on
 * purpose: it mirrors WidgetConfigViewModel, not WidgetSettingValues. When a stored value will not
 * parse, a Range falls back to its Minimum and a Choice to its first option, where the read path
 * would fall back to the schema default. The two disagree in the desktop too; the dialog copies the
 * dialog.
 *
 * The dialog edits native values (a number, a boolean, an option id), so decode turns the stored
 * strings into those and encode turns them back into the culture-invariant strings the bag holds.
 */

import type { WidgetSettingSchema } from "../widgets/manifest"

/** What .NET double.TryParse accepts with NumberStyles.Float, invariant: sign, decimal, exponent. */
const FLOAT = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/

export interface ToggleFieldValue {
  type: "toggle"
  value: boolean
}
export interface RangeFieldValue {
  type: "range"
  value: number
}
export interface ChoiceFieldValue {
  type: "choice"
  /** An option id, or "" only when the schema declares no options at all. */
  value: string
}

export type FieldValue = ToggleFieldValue | RangeFieldValue | ChoiceFieldValue

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * The value a field opens on. An absent key reads as the schema default first, and only then runs
 * through the per-type parse, so a default that is itself unparseable lands where an unparseable
 * stored value would.
 */
export function decodeField(schema: WidgetSettingSchema, bag: Record<string, string> | undefined): FieldValue {
  const current = bag?.[schema.key] ?? schema.defaultValue

  switch (schema.type) {
    case "toggle":
      // Anything that is not "true" (trimmed, case-insensitive, as .NET bool.TryParse reads it) is
      // false. Not the schema default: an unparseable toggle is off, full stop.
      return { type: "toggle", value: current.trim().toLowerCase() === "true" }

    case "range": {
      const min = schema.minimum ?? 0
      const max = schema.maximum ?? min
      const text = current.trim()
      // A value that will not parse falls back to the minimum, which is the one place this ladder
      // deviates from "degrade to the default".
      if (!FLOAT.test(text)) return { type: "range", value: min }
      return { type: "range", value: clamp(Number(text), min, max) }
    }

    case "choice": {
      const options = schema.options ?? []
      const match = options.find((option) => option.value === current)
      // No match falls to the first option, and no options at all leaves it empty for encode to
      // turn back into the default.
      return { type: "choice", value: match?.value ?? options[0]?.value ?? "" }
    }
  }
}

/** The string the bag stores for a field. Range always persists an integer, whatever the step. */
export function encodeField(schema: WidgetSettingSchema, value: FieldValue): string {
  switch (value.type) {
    case "toggle":
      return value.value ? "true" : "false"
    case "range":
      return String(Math.round(value.value))
    case "choice":
      return value.value !== "" ? value.value : schema.defaultValue
  }
}

/** Every field the manifest declares, decoded from the instance's bag, keyed by setting key. */
export function decodeAll(
  schemas: readonly WidgetSettingSchema[],
  bag: Record<string, string> | undefined,
): Record<string, FieldValue> {
  const fields: Record<string, FieldValue> = {}
  for (const schema of schemas) fields[schema.key] = decodeField(schema, bag)
  return fields
}

/**
 * The full bag to write on Save. Every key is emitted, not just the ones the user touched, matching
 * the desktop, so a widget's stored settings are always a complete set after a save.
 */
export function encodeAll(
  schemas: readonly WidgetSettingSchema[],
  fields: Record<string, FieldValue>,
): Record<string, string> {
  const values: Record<string, string> = {}
  for (const schema of schemas) {
    const field = fields[schema.key]
    if (field !== undefined) values[schema.key] = encodeField(schema, field)
  }
  return values
}
