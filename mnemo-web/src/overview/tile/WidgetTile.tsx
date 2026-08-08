import { IconButton } from "@/components/ui/icon-button"
import { useT } from "@/i18n/useT"
import type { WidgetInstanceDto } from "@/api/types"

import { findWidget } from "../widgets/registry"
import { UnavailableTile } from "./UnavailableTile"
import { WidgetBoundary } from "./WidgetBoundary"

interface WidgetTileProps {
  instance: WidgetInstanceDto
  onRemove: (instanceId: string) => void
}

/**
 * One board tile: the card, its header, and whichever body the widget id resolves to.
 *
 * Chrome belongs to the tile, not the widget, so every widget gets the same title row and the same
 * padding and none of them can drift. This is the view-mode tile only; edit mode replaces the
 * header with a different strip entirely rather than adding to this one.
 */
export function WidgetTile({ instance, onRemove }: WidgetTileProps) {
  const t = useT()
  const registration = findWidget(instance.widgetId)

  const Body = registration?.component

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-line bg-card shadow-elevation-1">
      <div className="flex items-center gap-2 px-4 pt-2.5">
        {registration === undefined ? (
          // The raw id, not a localized name: there is no manifest to look one up in, and the id is
          // the only thing that tells the user which extension is missing.
          <span className="min-w-0 flex-1 truncate font-mono text-body-small text-text-tertiary">
            {instance.widgetId}
          </span>
        ) : (
          <span className="min-w-0 flex-1 truncate text-body-small font-semibold text-text-primary">
            {t(registration.manifest.ns, registration.manifest.displayNameKey ?? "Title")}
          </span>
        )}

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

      <div className="min-h-0 flex-1 px-4 pt-2 pb-4">
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
