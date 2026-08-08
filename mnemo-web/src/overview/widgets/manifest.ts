/**
 * Widget manifests, hand-authored on the client and never fetched.
 *
 * The Host registers IWidgetRegistry but never calls IModule.RegisterWidgets, so every manifest
 * lookup the C# layout store makes behind /api/overview/layout resolves to null. Sizes are not
 * snapped there and migrated settings come back as an empty bag. Rather than build a second
 * registry in C# to serve one code path, the port owns snapping and setting defaults, which is why
 * these types and the two derivations below live on this side of the wire.
 *
 * Mirrors Mnemo.Core/Models/Widgets/WidgetManifest.cs. Not a wire type, so it stays here rather
 * than in @/api/types: nothing in it is ever sent or received.
 */

import type { WidgetSizeDto } from "@/api/types"
import type { IconName } from "@/components/icon/icon-registry"

export type WidgetCategory = "statistics" | "activity" | "insights" | "quickActions"

export type WidgetSettingType = "toggle" | "range" | "choice"

export interface WidgetSettingOption {
  value: string
  labelKey: string
}

export interface WidgetSettingSchema {
  key: string
  labelKey: string
  type: WidgetSettingType
  /** Always a string, culture-invariant. The owning widget is the only thing that can decode it. */
  defaultValue: string
  minimum?: number
  maximum?: number
  step?: number
  /** Choice settings only. */
  options?: WidgetSettingOption[]
}

/**
 * Static description of a widget type: identity, presentation keys, sizing contract and config
 * schema. Pure data, so the library can list a widget without instantiating it.
 */
export interface WidgetManifest {
  widgetId: string
  /** Translation namespace that resolves the display, description and setting label keys. */
  ns: string
  /** Defaults to "Title" at the call site. */
  displayNameKey?: string
  /** Defaults to "Description" at the call site. */
  descriptionKey?: string
  author: string
  /** Owning extension id; absent means built-in. */
  sourceExtensionId?: string
  category: WidgetCategory
  icon: IconName
  /** Sizes the widget offers, in preference order. Must contain {@link defaultSize}. */
  supportedSizes: WidgetSizeDto[]
  defaultSize: WidgetSizeDto
  settings?: WidgetSettingSchema[]
}

/**
 * widgetId to manifest, or undefined when nothing is registered under that id.
 *
 * Passed in rather than imported wherever it is needed, so the state layer can be exercised
 * without the widget registry, and so a build shipped without a widget is a case the callers of
 * this can actually be tested against.
 */
export type ManifestLookup = (widgetId: string) => WidgetManifest | undefined

/** Grid spans are compared by value everywhere; the DTO is a plain pair with no identity. */
export function sameSize(a: WidgetSizeDto, b: WidgetSizeDto): boolean {
  return a.columns === b.columns && a.rows === b.rows
}

/**
 * The closest size the widget actually offers, by column distance and then row distance.
 *
 * Ties keep declaration order, which is why this scans instead of sorting: supportedSizes is
 * written in preference order, and the first of two equally distant sizes is the preferred one.
 * Returns a fresh object so a caller storing it cannot alias the manifest's own array.
 */
export function nearestSupportedSize(manifest: WidgetManifest, size: WidgetSizeDto): WidgetSizeDto {
  const sizes = manifest.supportedSizes
  if (sizes.length === 0) return { ...manifest.defaultSize }

  let best = sizes[0]
  for (const candidate of sizes) {
    if (sameSize(candidate, size)) return { ...candidate }

    const columnDelta = Math.abs(candidate.columns - size.columns) - Math.abs(best.columns - size.columns)
    if (columnDelta < 0) best = candidate
    else if (columnDelta === 0 && Math.abs(candidate.rows - size.rows) < Math.abs(best.rows - size.rows)) best = candidate
  }

  return { ...best }
}

/** A settings bag seeded from the schema's declared defaults. Fresh, never shared. */
export function createDefaultSettings(manifest: WidgetManifest): Record<string, string> {
  const settings: Record<string, string> = {}
  for (const schema of manifest.settings ?? []) settings[schema.key] = schema.defaultValue
  return settings
}
