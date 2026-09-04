import { useMemo } from "react"

import { navigate } from "@/app/router"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { useT } from "@/i18n/useT"

import { useMindmapFolders, useMindmapLibrary, useMindmapTemplates } from "../api"
import { Breadcrumb } from "../library/components/Breadcrumb"
import { CreateMapDialog } from "../library/components/CreateMapDialog"
import { FolderCard } from "../library/components/FolderCard"
import { LibraryHeader } from "../library/components/LibraryHeader"
import { FolderRow, MapRow } from "../library/components/LibraryRows"
import { LibraryToolbar } from "../library/components/LibraryToolbar"
import { MapCard } from "../library/components/MapCard"
import { NewTile } from "../library/components/NewTile"
import { RecentStrip } from "../library/components/RecentStrip"
import { buildShelf, folderNames, recentMaps, resolveFolderId } from "../library/shelf"
import { useLibraryView } from "../library/store"
import { useDueByMap } from "../library/useDueByMap"
import { useLibraryActions } from "../library/useLibraryActions"
import { MindmapTransferOverlay } from "../transfer/MindmapTransferOverlay"

const RECENT_COUNT = 3

/**
 * The gallery.
 *
 * Each card draws the map it stands for rather than a generic tile, which is why the library
 * endpoint serves whole documents and not headers: a mindmap is recognised by its shape long before
 * its title is read, and a wall of identical rectangles makes a user open three maps to find one.
 */
export function MindmapLibraryRoute() {
  const t = useT()
  const mm = (key: string) => t("Mindmap", key)

  const library = useMindmapLibrary()
  const foldersQuery = useMindmapFolders()
  const templatesQuery = useMindmapTemplates()
  const actions = useLibraryActions()

  const requestedFolderId = useLibraryView((state) => state.folderId)
  const search = useLibraryView((state) => state.search)
  const sort = useLibraryView((state) => state.sort)
  const view = useLibraryView((state) => state.view)
  const openFolder = useLibraryView((state) => state.openFolder)

  const entries = useMemo(() => library.data ?? [], [library.data])
  const folders = useMemo(() => foldersQuery.data ?? [], [foldersQuery.data])
  const dueByMap = useDueByMap(entries)

  const shelf = useMemo(
    () => buildShelf(entries, folders, { folderId: requestedFolderId, sort, search }),
    [entries, folders, requestedFolderId, sort, search],
  )

  // Asked for again rather than read off the shelf, because a folder deleted in another window
  // resolves back to the root and the header has to agree with the shelf about where we are.
  const folderId = resolveFolderId(folders, requestedFolderId)
  const atRoot = folderId === null

  const recents = useMemo(() => recentMaps(entries, RECENT_COUNT), [entries])
  const names = useMemo(() => folderNames(entries, folders), [entries, folders])
  const allMapIds = useMemo(() => entries.map((entry) => entry.document.id), [entries])

  const templates = templatesQuery.data?.templates ?? []
  const defaultTemplateId = templatesQuery.data?.defaultId ?? ""

  const openMap = (id: string) => navigate("mindmap", id)
  const searching = search.trim().length > 0

  // The card for the folder being shown, which the header needs for its own overflow menu and its
  // subtree count. Built from the parent's level so it carries the same counts a card there would.
  const currentFolder = useMemo(() => {
    if (folderId === null) {
      return null
    }
    const folder = folders.find((candidate) => candidate.id === folderId)
    if (!folder) {
      return null
    }
    const parent = buildShelf(entries, folders, {
      folderId: folder.parentId ?? null,
      sort: "name",
      search: "",
    })
    return parent.folders.find((candidate) => candidate.id === folderId) ?? null
  }, [entries, folders, folderId])

  const folderDue = useMemo(() => {
    if (!currentFolder) {
      return 0
    }
    // Every map in the subtree, which is what the header counts. The shelf already walked the tree
    // for the count, so this walks the maps once more rather than threading ids back out of it.
    let total = 0
    for (const [mapId, due] of dueByMap) {
      const entry = entries.find((candidate) => candidate.document.id === mapId)
      if (entry && inSubtree(entry.folderId, folderId, folders)) {
        total += due
      }
    }
    return total
  }, [currentFolder, dueByMap, entries, folderId, folders])

  const loaded = library.isSuccess && foldersQuery.isSuccess
  const hasAnything = entries.length > 0 || folders.length > 0
  const nothingHere = shelf.folders.length === 0 && shelf.maps.length === 0
  const showEmpty = loaded && !hasAnything
  const showNoResults = loaded && hasAnything && nothingHere && searching

  // A failed fetch and an empty library render the same list (nothing), so without this
  // branch a backend outage reads as "you have no mindmaps" rather than as the fetch it
  // actually was.
  if (library.isError || foldersQuery.isError) {
    return (
      <div className="min-h-full bg-canvas-sunken">
        <div className="mx-auto max-w-[1232px] px-8 pt-16">
          <EmptyState
            icon="triangle-alert"
            title={mm("LibraryLoadFailedTitle")}
            description={mm("LibraryLoadFailedHint")}
            action={
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  void library.refetch()
                  void foldersQuery.refetch()
                }}
              >
                {mm("Retry")}
              </Button>
            }
          />
        </div>
      </div>
    )
  }

  if (library.isLoading || foldersQuery.isLoading) {
    return <p className="py-20 text-center text-[13px] text-ink-3">{mm("Loading")}</p>
  }

  return (
    <div className="min-h-full bg-canvas-sunken">
      <div className="mx-auto flex max-w-[1232px] flex-col gap-5 px-8 pb-20 pt-7">
        {atRoot ? null : (
          <Breadcrumb
            crumbs={shelf.crumbs}
            onOpen={openFolder}
            onDropMap={(mapId, target) => void actions.fileMap(mapId, target)}
          />
        )}

        <LibraryHeader
          folder={currentFolder}
          mapCount={entries.length}
          folderCount={folders.length}
          dueCount={folderDue}
          allMapIds={allMapIds}
          actions={actions}
        />

        {atRoot && !searching && recents.length > 0 ? (
          <RecentStrip
            maps={recents}
            folderNames={names}
            templates={templates}
            defaultTemplateId={defaultTemplateId}
            actions={actions}
            onOpen={openMap}
          />
        ) : null}

        {showEmpty ? null : (
          <LibraryToolbar
            label={atRoot ? mm("AllMaps") : mm("MapsLabel")}
            // "All maps" means the whole library, so at rest the root counts every map and not just
            // the unfiled ones on screen. A search makes the grid a filtered view of itself, and a
            // total beside one result would be counting something the page is no longer showing.
            count={atRoot && !searching ? entries.length : shelf.maps.length}
            searchPlaceholder={
              atRoot ? mm("SearchMindmaps") : mm("SearchInFolder").replace("{0}", currentFolder?.folder.name ?? "")
            }
          />
        )}

        {view === "grid" ? (
          <div className="grid grid-cols-3 gap-4">
            {shelf.folders.map((folder) => (
              <FolderCard
                key={folder.id}
                folder={folder}
                templates={templates}
                defaultTemplateId={defaultTemplateId}
                actions={actions}
                onOpen={openFolder}
              />
            ))}
            {shelf.maps.map((map) => (
              <MapCard
                key={map.id}
                map={map}
                templates={templates}
                defaultTemplateId={defaultTemplateId}
                due={dueByMap.get(map.id) ?? 0}
                actions={actions}
                onOpen={openMap}
              />
            ))}
            {/* Inside a folder only: at the root the header's New button is already in view, and a
                create tile mixed into filtered results reads as a result that matched. */}
            {!atRoot && !searching ? (
              <NewTile
                label={mm("NewMapInFolder").replace("{0}", currentFolder?.folder.name ?? "")}
                onClick={actions.createMapHere}
              />
            ) : null}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {shelf.folders.map((folder) => (
              <FolderRow key={folder.id} folder={folder} actions={actions} onOpen={openFolder} />
            ))}
            {shelf.maps.map((map) => (
              <MapRow
                key={map.id}
                map={map}
                due={dueByMap.get(map.id) ?? 0}
                actions={actions}
                onOpen={openMap}
              />
            ))}
          </div>
        )}

        {showEmpty ? (
          <EmptyState
            className="mt-12"
            icon="common/sitemap"
            title={mm("LibraryEmptyTitle")}
            description={mm("LibraryEmptyDescription")}
            action={
              <Button size="sm" onClick={actions.createMapHere}>
                {mm("NewMap")}
              </Button>
            }
          />
        ) : null}

        {showNoResults ? (
          <EmptyState
            className="mt-12"
            icon="common/search"
            title={mm("NoResultsTitle")}
            description={mm("NoResultsDescription")}
          />
        ) : null}
      </div>

      <MindmapTransferOverlay />

      <CreateMapDialog
        open={actions.creating}
        busy={actions.busy}
        onCancel={actions.cancelCreate}
        onCreate={(title, templateId) => void actions.confirmCreate(title, templateId)}
      />
    </div>
  )
}

/** True when a map filed in `folderId` sits anywhere beneath `root`. */
function inSubtree(
  folderId: string | null | undefined,
  root: string | null,
  folders: readonly { id: string; parentId?: string | null }[],
): boolean {
  if (root === null) {
    return true
  }
  const byId = new Map(folders.map((folder) => [folder.id, folder]))
  const seen = new Set<string>()
  let cursor = folderId ?? null
  while (cursor !== null && !seen.has(cursor)) {
    if (cursor === root) {
      return true
    }
    seen.add(cursor)
    cursor = byId.get(cursor)?.parentId ?? null
  }
  return false
}
