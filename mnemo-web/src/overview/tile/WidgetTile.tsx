import type { PointerEvent as ReactPointerEvent, SyntheticEvent } from "react"

import type { WidgetInstanceDto, WidgetSizeDto } from "@/api/types"
import { AppIcon } from "@/components/icon/AppIcon"
import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"

import { sameSize } from "../widgets/manifest"
import { findWidget } from "../widgets/registry"
import { DropSlot } from "./DropSlot"
import { sizeLabel } from "./SizeChip"
import { UnavailableTile } from "./UnavailableTile"
import { WidgetBoundary } from "./WidgetBoundary"

interface WidgetTileProps {
  instance: WidgetInstanceDto
  isEditMode: boolean
  /** This tile is the one under the pointer, so its slot shows the drop affordance instead. */
  isDragging: boolean
  onRemove: (instanceId: string) => void
  onResize: (instanceId: string, size: WidgetSizeDto) => void
  onConfigure: (instanceId: string) => void
  onHandlePointerDown: (event: ReactPointerEvent, instanceId: string, title: string) => void
}

/**
 * The frame around a widget, and everything edit mode adds to it.
 *
 * Chrome is hover-only and lives on one tile at a time. Stamping a grip, three
 * size chips, a gear and a close button onto every tile at once puts twenty-four
 * controls on screen for four widgets, and editing starts to feel like filling
 * in a form. Here the resting board in edit mode looks very nearly like the
 * board you were just reading.
 *
 * The whole tile is the drag handle, which is why there is no grip: a 16px grip
 * is not a target anyone hits, and the controls that must not start a drag stop
 * the press themselves.
 */
export function WidgetTile({
  instance,
  isEditMode,
  isDragging,
  onRemove,
  onResize,
  onConfigure,
  onHandlePointerDown,
}: WidgetTileProps) {
  const t = useT()
  const registration = findWidget(instance.widgetId)

  // The gear renders only when the widget declares settings, matching the rule that a widget with
  // no schema is not configurable.
  const isConfigurable = (registration?.manifest.settings?.length ?? 0) > 0
  // An unavailable widget offers no spans: there is no manifest saying which ones it has, and its
  // stored size has to round-trip untouched.
  const sizes = registration?.manifest.supportedSizes ?? []

  const Body = registration?.component
  // The raw id, not a localized name: there is no manifest to look one up in, and the id is the
  // only thing that tells the user which extension is missing.
  const title =
    registration === undefined
      ? instance.widgetId
      : t(registration.manifest.ns, registration.manifest.displayNameKey ?? "Title")

  // The card goes away entirely while this tile is in flight, rather than staying on as a faded
  // stand-in: the ghost is already carrying it, and two copies of one tile reads as two tiles.
  if (isDragging) return <DropSlot sizeLabel={sizeLabel(instance.size)} />

  const stop = (event: SyntheticEvent) => event.stopPropagation()
  const hasStrip = isEditMode && (sizes.length > 1 || isConfigurable)

  return (
    <div
      className={cn("group relative h-full w-full", isEditMode && "cursor-grab")}
      onPointerDown={isEditMode ? (event) => onHandlePointerDown(event, instance.instanceId, title) : undefined}
    >
      <div
        className={cn(
          "relative h-full w-full overflow-hidden rounded-2xl bg-canvas transition-shadow",
          // Every tile is manipulable in edit mode, and the firmer ring is what says so before the
          // user has moused over anything.
          isEditMode
            ? "shadow-[0_0_0_1px_var(--line)]"
            : "shadow-[0_0_0_1px_var(--line-soft),0_1px_2px_oklch(0_0_0/0.03)]",
        )}
        style={{ transitionDuration: "var(--duration-normal)" }}
      >
        {/* Inert while arranging: a tile you are dragging should not also be following its own
            links, and `inert` takes the content out of the tab order too. */}
        <div className="h-full w-full" inert={isEditMode}>
          {Body === undefined || registration === undefined ? (
            <UnavailableTile widgetId={instance.widgetId} />
          ) : (
            <WidgetBoundary widgetId={instance.widgetId}>
              <Body instance={instance} manifest={registration.manifest} />
            </WidgetBoundary>
          )}
        </div>

        {hasStrip && (
          <div
            onPointerDown={stop}
            className={cn(
              "absolute inset-x-0 bottom-0 flex h-8 items-center gap-1 border-t border-line-soft px-1.5",
              "bg-canvas/92 opacity-0 backdrop-blur-[3px] transition-opacity group-hover:opacity-100",
            )}
            style={{ transitionDuration: "var(--duration-fast)" }}
          >
            {sizes.map((size) => {
              const label = sizeLabel(size)
              const selected = sameSize(size, instance.size)
              return (
                <button
                  key={label}
                  type="button"
                  aria-pressed={selected}
                  title={label}
                  onClick={() => onResize(instance.instanceId, size)}
                  className={cn(
                    "h-[22px] rounded-md px-1.5 text-[11px] font-medium tabular-nums transition-colors",
                    selected ? "bg-frame-active text-ink" : "text-ink-3 hover:bg-frame-hover hover:text-ink-2",
                  )}
                  style={{ transitionDuration: "var(--duration-fast)" }}
                >
                  {label}
                </button>
              )
            })}

            {isConfigurable && (
              <button
                type="button"
                onClick={() => onConfigure(instance.instanceId)}
                aria-label={t("Overview", "ConfigureWidget")}
                title={t("Overview", "ConfigureWidget")}
                className="ml-auto grid size-[22px] place-items-center rounded-md text-ink-3 transition-colors hover:bg-frame-hover hover:text-ink"
                style={{ transitionDuration: "var(--duration-fast)" }}
              >
                <AppIcon name="settings-2" size={14} strokeWidth={1.7} />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Outside the clipped card so it sits on the corner rather than inside it, which is what
          makes it read as "remove this tile" instead of "close something inside the tile".
          It renders outside edit mode too when the widget is missing: a tile whose widget no longer
          exists would otherwise be unremovable without entering edit mode to arrange something that
          cannot be shown. */}
      {(isEditMode || registration === undefined) && (
        <button
          type="button"
          onPointerDown={stop}
          onClick={() => onRemove(instance.instanceId)}
          aria-label={t("Overview", "RemoveWidget")}
          title={t("Overview", "RemoveWidget")}
          className={cn(
            "absolute -right-1.5 -top-1.5 z-10 grid size-[22px] place-items-center rounded-full",
            "bg-canvas text-ink-2 shadow-[0_0_0_1px_var(--line),0_2px_6px_oklch(0_0_0/0.1)]",
            "transition-[opacity,color] hover:text-danger",
            isEditMode ? "opacity-0 group-hover:opacity-100" : "opacity-100",
          )}
          style={{ transitionDuration: "var(--duration-fast)" }}
        >
          <AppIcon name="x" size={14} strokeWidth={2.2} />
        </button>
      )}
    </div>
  )
}
