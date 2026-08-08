import type { PointerEvent as ReactPointerEvent } from "react"

import type { WidgetInstanceDto, WidgetSizeDto } from "@/api/types"
import { IconButton } from "@/components/ui/icon-button"
import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"

import { findWidget } from "../widgets/registry"
import { DropSlot } from "./DropSlot"
import { sizeLabel } from "./SizeChip"
import { TileEditStrip } from "./TileEditStrip"
import { UnavailableTile } from "./UnavailableTile"
import { WidgetBoundary } from "./WidgetBoundary"

interface WidgetTileProps {
  instance: WidgetInstanceDto
  isEditMode: boolean
  /** This tile is the one under the pointer, so its slot shows the drop affordance instead. */
  isDragging: boolean
  onRemove: (instanceId: string) => void
  onResize: (instanceId: string, size: WidgetSizeDto) => void
  onHandlePointerDown: (event: ReactPointerEvent, instanceId: string, title: string) => void
}

/**
 * One board tile: the card, its header, and whichever body the widget id resolves to.
 *
 * Chrome belongs to the tile, not the widget, so every widget gets the same title row and the same
 * padding and none of them can drift. Edit mode replaces the header outright with the chrome strip
 * rather than adding controls to it, which is why the two headers are alternatives here and not one
 * header with conditional parts.
 */
export function WidgetTile({
  instance,
  isEditMode,
  isDragging,
  onRemove,
  onResize,
  onHandlePointerDown,
}: WidgetTileProps) {
  const t = useT()
  const registration = findWidget(instance.widgetId)

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

  return (
    <div
      className={cn(
        "flex h-full flex-col overflow-hidden rounded-lg border bg-card shadow-elevation-1 transition-colors duration-150",
        // Every tile is manipulable in edit mode, and the border is what says so before the user
        // has moused over anything.
        isEditMode ? "border-[var(--accent-border-subtle)]" : "border-line",
      )}
    >
      {isEditMode ? (
        <TileEditStrip
          title={title}
          isUnavailable={registration === undefined}
          // An unavailable widget offers no spans: there is no manifest saying which ones it has,
          // and its stored size has to round-trip untouched.
          sizes={registration?.manifest.supportedSizes ?? []}
          current={instance.size}
          onResize={(size) => onResize(instance.instanceId, size)}
          onRemove={() => onRemove(instance.instanceId)}
          onHandlePointerDown={(event) => onHandlePointerDown(event, instance.instanceId, title)}
        />
      ) : (
        <div className="flex items-center gap-2 px-4 pt-2.5">
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-body-small",
              registration === undefined ? "font-mono text-text-tertiary" : "font-semibold text-text-primary",
            )}
          >
            {title}
          </span>

          {/* The one control that renders outside edit mode. A tile whose widget no longer exists
              would otherwise be unremovable without entering edit mode to delete something that
              cannot be shown. */}
          {registration === undefined ? (
            <IconButton
              icon="common/x"
              label={t("Overview", "RemoveWidget")}
              className="-mr-1 shrink-0"
              onClick={() => onRemove(instance.instanceId)}
            />
          ) : null}
        </div>
      )}

      {/* Content goes inert while editing, so a click meant for the tile cannot reach a row inside
          it. The desktop lays a transparent border over the content to the same end; `inert` also
          takes the content out of the tab order, which a transparent overlay does not. */}
      <div className="min-h-0 flex-1 px-4 pt-2 pb-4" inert={isEditMode}>
        {Body === undefined || registration === undefined ? (
          <UnavailableTile />
        ) : (
          <WidgetBoundary widgetId={instance.widgetId}>
            <Body instance={instance} manifest={registration.manifest} />
          </WidgetBoundary>
        )}
      </div>
    </div>
  )
}
