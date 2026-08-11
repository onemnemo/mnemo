import { useMemo, useRef } from "react"

import { AppIcon } from "@/components/icon/AppIcon"
import { Button } from "@/components/ui/button"
import { useT } from "@/i18n/useT"

import { useMindmap, useMindmapTemplates } from "../api"
import { MindmapCanvas } from "../canvas/MindmapCanvas"
import type { CanvasRuntime } from "../canvas/runtime"
import { projectScene } from "../scene/project"

/**
 * One open map.
 *
 * The document and the templates are two queries because they change on completely different clocks:
 * a map changes on every edit, the template library changes when someone saves a template. Projecting
 * them together is memoized on both, so an edit reprojects and a theme flip does not.
 */
export function MindmapRoute({ mapId }: { mapId: string | undefined }) {
  const t = useT()
  const map = useMindmap(mapId ?? null)
  const templates = useMindmapTemplates()
  const runtime = useRef<CanvasRuntime | null>(null)

  const scene = useMemo(() => {
    if (!map.data || !templates.data) {
      return null
    }
    return projectScene(map.data, {
      templates: templates.data.templates,
      defaultTemplateId: templates.data.defaultId,
    })
  }, [map.data, templates.data])

  if (map.isError) {
    return <Notice icon="triangle-alert" title={t("Mindmap", "MapNotFound")} />
  }
  if (!scene) {
    return <Notice icon="loader" title={t("Mindmap", "Loading")} />
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-canvas">
      <header className="flex shrink-0 items-center gap-2 px-4 py-2.5">
        <h1 className="truncate text-[13.5px] font-medium text-ink">
          {map.data?.title || t("Mindmap", "UntitledMap")}
        </h1>
        <span className="text-[11.5px] text-ink-3">
          {t("Mindmap", "ElementCount").replace("{0}", String(scene.elements.length))}
        </span>

        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => runtime.current?.zoomBy(1 / 1.2)} aria-label="Zoom out">
            <AppIcon name="minus" size={14} strokeWidth={2} />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => runtime.current?.zoomBy(1.2)} aria-label="Zoom in">
            <AppIcon name="plus" size={14} strokeWidth={2} />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => runtime.current?.fit()}>
            {t("Mindmap", "Fit")}
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1">
        <MindmapCanvas scene={scene} runtimeRef={runtime} />
      </div>
    </div>
  )
}

function Notice({ icon, title }: { icon: string; title: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-ink-3">
      <AppIcon name={icon} size={20} strokeWidth={1.5} />
      <p className="text-[13px]">{title}</p>
    </div>
  )
}
