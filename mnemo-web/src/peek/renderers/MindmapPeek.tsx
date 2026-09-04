import { useEffect } from "react"

import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Skeleton } from "@/components/ui/skeleton"
import { useT } from "@/i18n/useT"
import { useMindmap, useMindmapTemplates } from "@/mindmap/api"
import { MindmapThumbnail } from "@/mindmap/page/MindmapThumbnail"

import { closePeekForItem } from "../store"
import { openFullFromPeek } from "../usePeekSubject"

/**
 * A map in the peek: the thumbnail the library draws, and the door to the real thing.
 *
 * Never the canvas. That runtime binds window-level key and blur listeners and captures
 * wheel, pointer and keydown across its pane, so a second one beside the first fights
 * the first for every gesture. The thumbnail goes through the same projector, so what
 * is shown here cannot disagree with what opens.
 */
export function MindmapPeek({ mapId }: { mapId: string }) {
  const t = useT()
  const map = useMindmap(mapId)
  const styling = useMindmapTemplates()

  const gone = isNotFound(map.error)
  useEffect(() => {
    if (gone) closePeekForItem("mindmap", mapId)
  }, [gone, mapId])

  if (map.isPending) {
    return (
      <div className="p-4">
        <Skeleton className="h-[132px] w-full" />
      </div>
    )
  }

  if (map.isError || !map.data) {
    return (
      <EmptyState
        className="mt-10"
        icon="common/triangle-alert"
        title={t("Mindmap", "LibraryLoadFailedTitle")}
        description={t("Mindmap", "LibraryLoadFailedHint")}
        action={
          <Button size="sm" variant="outline" onClick={() => void map.refetch()}>
            {t("Mindmap", "Retry")}
          </Button>
        }
      />
    )
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="overflow-hidden rounded-lg border border-line-soft">
        <MindmapThumbnail
          document={map.data}
          templates={styling.data?.templates ?? []}
          defaultTemplateId={styling.data?.defaultId ?? ""}
        />
      </div>
      <Button size="sm" variant="outline" onClick={() => openFullFromPeek("mindmap", mapId)}>
        {t("App", "PeekOpenFull")}
      </Button>
    </div>
  )
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    (error as { status: unknown }).status === 404
  )
}
