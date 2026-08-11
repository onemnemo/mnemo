import { useMemo, useRef } from "react"

import { AppIcon } from "@/components/icon/AppIcon"
import { Button } from "@/components/ui/button"
import { useT } from "@/i18n/useT"

import { useMindmap, useMindmapTemplates, type MindmapTemplates } from "../api"
import { MindmapCanvas } from "../canvas/MindmapCanvas"
import type { CanvasRuntime } from "../canvas/runtime"
import { projectScene } from "../scene/project"

/** No rules at all: every node falls through to the theme. Stable, so it does not reproject a scene. */
const EMPTY_TEMPLATES: MindmapTemplates = { defaultId: "", templates: [] }

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

  // Waits for the templates to settle, not to succeed. They style a map rather than make one, so a
  // library that cannot be read costs the map its template rules and nothing else; refusing to draw
  // until they arrive turns a styling problem into a blank page that says "Loading" forever.
  const styling = templates.isPending ? null : (templates.data ?? EMPTY_TEMPLATES)

  const scene = useMemo(() => {
    if (!map.data || !styling) {
      return null
    }
    return projectScene(map.data, {
      templates: styling.templates,
      defaultTemplateId: styling.defaultId,
    })
  }, [map.data, styling])

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
          {t("Mindmap", "NodeCountFormat").replace("{0}", String(scene.elements.length))}
        </span>

        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => runtime.current?.zoomBy(1 / 1.2)} aria-label="Zoom out">
            <AppIcon name="minus" size={14} strokeWidth={2} />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => runtime.current?.zoomBy(1.2)} aria-label="Zoom in">
            <AppIcon name="plus" size={14} strokeWidth={2} />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => runtime.current?.fit()}>
            {t("Mindmap", "FitToScreen")}
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1">
        <MindmapCanvas scene={scene} runtimeRef={runtime} />
      </div>

      {scene.elements.length === 0 ? (
        // Reachable by emptying a map, and it has to say so: an empty canvas and a broken one look
        // identical, and the one thing the user cannot tell from the outside is which they have.
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="flex flex-col items-center gap-2 text-ink-3">
            <AppIcon name="git-fork" size={22} strokeWidth={1.4} />
            <p className="text-[13px]">{t("Mindmap", "MapIsEmpty")}</p>
          </div>
        </div>
      ) : null}

      {templates.isError ? (
        // Said rather than swallowed. The map is drawn, but every node is a neutral card and every
        // branch is grey, and a map that looks like that for a reason nobody mentioned reads as a
        // rendering fault rather than as a library that could not be read.
        <p className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-canvas px-3 py-1 text-[11.5px] text-ink-2 shadow-[0_0_0_1px_var(--line)]">
          {t("Mindmap", "TemplatesUnavailable")}
        </p>
      ) : null}
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
