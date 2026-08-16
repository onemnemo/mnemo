import { useMemo } from "react"

import type { WidgetInstanceDto, WidgetSizeDto } from "@/api/types"

import { GAP, ROW_HEIGHT } from "../layout/metrics"
import { createDefaultSettings, type WidgetManifest } from "../widgets/manifest"
import { findWidget } from "../widgets/registry"
import { WidgetBoundary } from "../tile/WidgetBoundary"

/** A representative column width, so a 2x1 preview has a 2x1's proportions rather than a box's. */
const PREVIEW_CELL = 170

interface WidgetPreviewProps {
  manifest: WidgetManifest
  size: WidgetSizeDto
  /** Overrides the manifest defaults, so a settings dialog can preview what it is editing. */
  settings?: Record<string, string>
  boxWidth: number
  boxHeight?: number
}

/**
 * A widget rendered at true proportions and scaled to fit its box.
 *
 * Scaled rather than reflowed, on purpose: a preview that lays itself out for the preview box is
 * not a preview, it is a second design that happens to share a name. Shrinking the real thing is
 * the only version that cannot lie about what you are going to get.
 *
 * It renders the real component, so it reads the same queries the board does and shows the reader's
 * own data. Those queries are already cached by the board behind it, so a gallery of thirteen
 * previews costs no extra requests.
 */
export function WidgetPreview({ manifest, size, settings, boxWidth, boxHeight = 168 }: WidgetPreviewProps) {
  const registration = findWidget(manifest.widgetId)

  // A throwaway instance, memoised only so the widget's own effects do not see a new object every
  // render. It never reaches the board or the wire.
  const instance = useMemo<WidgetInstanceDto>(
    () => ({
      instanceId: `preview:${manifest.widgetId}`,
      widgetId: manifest.widgetId,
      size,
      column: -1,
      row: -1,
      order: 0,
      settings: settings ?? createDefaultSettings(manifest),
    }),
    [manifest, size, settings],
  )

  const realWidth = size.columns * PREVIEW_CELL + (size.columns - 1) * GAP
  const realHeight = size.rows * ROW_HEIGHT + (size.rows - 1) * GAP
  // Never scaled up: a 1x1 blown up to fill a 300px box is a different design from the one that
  // will actually land on the board.
  const scale = Math.min(boxWidth / realWidth, boxHeight / realHeight, 1)

  const Body = registration?.component

  return (
    <div
      className="flex items-center justify-center overflow-hidden rounded-lg bg-canvas-sunken"
      style={{ height: boxHeight }}
    >
      <div
        style={{ width: realWidth, height: realHeight, transform: `scale(${scale})` }}
        className="pointer-events-none shrink-0 overflow-hidden rounded-2xl bg-canvas shadow-[0_0_0_1px_var(--line-soft),0_1px_2px_oklch(0_0_0/0.04)]"
      >
        {Body && (
          <WidgetBoundary widgetId={manifest.widgetId}>
            <Body instance={instance} manifest={manifest} renderColumns={size.columns} />
          </WidgetBoundary>
        )}
      </div>
    </div>
  )
}
